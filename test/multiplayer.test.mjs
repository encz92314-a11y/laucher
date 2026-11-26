import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { allowedAuthNavigation } from '../desktop/oauth-window.mjs';
import { relayAddress, observeRelay, quickConnectArguments } from '../desktop/multiplayer.mjs';
import { registeredRedirect, signIn } from '../desktop/account.mjs';

test('the sign-in window allows Microsoft origins and the exact loopback callback only', async () => {
  const controller = new AbortController();
  await assert.rejects(signIn('00000000-0000-0000-0000-000000000001', async (address, callback) => {
    const auth = new URL(address);
    assert.equal(auth.searchParams.get('prompt'), 'select_account');
    assert.equal(auth.searchParams.get('redirect_uri'), callback);
    const redirect = new URL(callback);
    assert.equal(redirect.hostname, 'localhost');
    assert.ok(Number(redirect.port) > 0);
    redirect.port = '';
    assert.equal(redirect.href, registeredRedirect);
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(allowedAuthNavigation(address, callback), true);
    assert.equal(allowedAuthNavigation('https://login.live.com/', callback), true);
    assert.equal(allowedAuthNavigation(callback + '?state=example', callback), true);
    for (const invalid of [callback + '/extra', 'http://login.live.com/', 'https://user@login.live.com/',
      'https://login.live.com.other.example/', 'file:///tmp/index.html', 'http://127.0.0.1:7777/callback']) {
      assert.equal(allowedAuthNavigation(invalid, callback), false);
    }
    controller.abort();
  }, controller.signal), /已关闭/);
});

test('localhost callback rejects mismatched OAuth state or an unregistered host', async () => {
  const client = '00000000-0000-0000-0000-000000000001';
  await assert.rejects(signIn(client, async (address, callback) => {
    const rejected = await fetch(callback + '?state=unexpected');
    assert.equal(rejected.status, 400);
    const alternateHost = callback.replace('localhost', '127.0.0.1');
    const rejectedHost = await fetch(alternateHost + '?state=' + new URL(address).searchParams.get('state'));
    assert.equal(rejectedHost.status, 400);
    const valid = await fetch(callback + '?state=' + new URL(address).searchParams.get('state') + '&error=access_denied');
    assert.equal(valid.status, 200);
  }), /已取消或被拒绝/);
});

test('detects an e4mc address across split output without forwarding raw logs', () => {
  const output = new PassThrough();
  const state = [];
  observeRelay(output, value => state.push(value));
  output.write('message with unrelated info\n[thread/INFO]: Domain ass');
  output.write('igned: room.e4mc.link\n[thread/INFO]: Domain assigned: evil.example\n');
  output.write('Local game no longer publicly hosted\nerror in e4mc\n');
  assert.deepEqual(state, [{ state: 'shared', address: 'room.e4mc.link' }, { state: 'waiting' }, { state: 'error' }]);
});

test('Quick Play only accepts validated e4mc hostnames and supported versions', () => {
  const version = { arguments: { game: [{ value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }] } };
  assert.deepEqual(quickConnectArguments(version, '  FRIEND.e4mc.link  '), ['--quickPlayMultiplayer', 'friend.e4mc.link']);
  for (const invalid of ['e4mc.link.other.example', 'http://room.e4mc.link', 'room.e4mc.link:25565', '127.0.0.1']) {
    assert.equal(relayAddress(invalid), undefined);
    assert.throws(() => quickConnectArguments(version, invalid), /地址/);
  }
  assert.throws(() => quickConnectArguments({}, 'friend.e4mc.link'), /不支持/);
});
