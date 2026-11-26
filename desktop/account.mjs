import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { validClientId } from './session.mjs';

const microsoft = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const minecraft = 'https://api.minecraftservices.com';
export const registeredRedirect = 'http://localhost/callback';

async function json(url, { body, access, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (access) headers.Authorization = `Bearer ${access}`;
  if (body) headers['Content-Type'] = body instanceof URLSearchParams
    ? 'application/x-www-form-urlencoded' : 'application/json';
  let response;
  try {
    response = await fetch(url, {
      method: body ? 'POST' : 'GET', headers, redirect: 'error',
      body: body instanceof URLSearchParams ? body : body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
    });
  } catch {
    if (signal?.aborted) throw new Error('已关闭 Microsoft 登录窗口');
    throw new Error(`连接认证服务失败（${new URL(url).hostname}）`);
  }
  if (!response.ok) throw authenticationError(url, response.status);
  return response.json();
}

const authenticationSteps = {
  '/consumers/oauth2/v2.0/token': 'Microsoft 凭据交换',
  '/user/authenticate': 'Xbox Live 登录',
  '/xsts/authorize': 'Xbox 账号授权',
  '/authentication/login_with_xbox': 'Minecraft Services 应用授权',
  '/entitlements/mcstore': 'Minecraft Java 版所有权检查',
  '/minecraft/profile': 'Minecraft 玩家资料',
};

export function authenticationError(address, status) {
  const { pathname, hostname } = new URL(address);
  const stage = authenticationSteps[pathname] ?? hostname;
  let guidance = '';
  if (pathname === '/authentication/login_with_xbox' && status === 403) {
    guidance = '。微软登录已返回，但 Minecraft Services 拒绝了授权交换。请让应用注册所有者确认 Zephyr 客户端 ID 已获 Minecraft API 访问批准。';
  } else if (pathname === '/entitlements/mcstore' && status === 403) {
    guidance = '。Minecraft 拒绝读取此账号的所有权信息，可尝试用持有 Java 版的 Microsoft 账号重新登录。';
  } else if (pathname === '/minecraft/profile' && status === 404) {
    guidance = '。请在 Minecraft 官方启动器中完成 Java 版玩家资料创建。';
  }
  return new Error(`${stage}失败（HTTP ${status}）${guidance}`);
}

export function minecraftSkinUrl(value) {
  return typeof value === 'string' && /^https?:\/\/textures\.minecraft\.net\/texture\/[a-f0-9]+$/i.test(value)
    ? value.replace(/^http:/i, 'https:') : undefined;
}

export async function minecraftIdentity(microsoftToken, request = json) {
  const xbl = await request('https://user.auth.xboxlive.com/user/authenticate', {
    body: {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + microsoftToken },
      RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
    },
  });
  const xsts = await request('https://xsts.auth.xboxlive.com/xsts/authorize', {
    body: {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    },
  });
  const hash = xsts.DisplayClaims?.xui?.[0]?.uhs;
  if (!hash || !xsts.Token) throw new Error('Xbox 返回的身份信息不完整');
  const game = await request(minecraft + '/authentication/login_with_xbox', {
    body: { identityToken: `XBL3.0 x=${hash};${xsts.Token}` },
  });
  if (!game.access_token || !Number.isFinite(game.expires_in)) throw new Error('Minecraft 返回的凭据不完整');
  const access = game.access_token;
  const entitlements = await request(minecraft + '/entitlements/mcstore', { access });
  const javaOwnership = new Set(['game_minecraft', 'product_minecraft', 'game_minecraft_java', 'product_minecraft_java']);
  if (!entitlements.items?.some(item => javaOwnership.has(item.name))) throw new Error('此账号未通过 Minecraft Java 版所有权验证');
  const profile = await request(minecraft + '/minecraft/profile', { access });
  if (!/^[a-f0-9]{32}$/i.test(profile.id ?? '') || !profile.name) throw new Error('账号缺少有效的 Java 版玩家资料');
  const skin = profile.skins?.find(entry => entry.state === 'ACTIVE')?.url;
  return {
    skin: minecraftSkinUrl(skin),
    id: profile.id, name: profile.name, access, expires: Date.now() + game.expires_in * 1000,
  };
}

export async function signIn(clientId, openBrowser, signal) {
  if (!validClientId(clientId)) throw new Error('请先配置已获授权的 Microsoft 客户端 ID');
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  let finish;
  let fail;
  const callback = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  callback.catch(() => {});
  const abort = () => fail(new Error('已关闭 Microsoft 登录窗口'));
  if (signal?.aborted) throw new Error('已关闭 Microsoft 登录窗口');
  signal?.addEventListener('abort', abort, { once: true });
  const server = createServer((incoming, outgoing) => {
    const registered = new URL(registeredRedirect);
    if (incoming.headers.host !== `localhost:${server.address().port}`) {
      outgoing.writeHead(400).end();
      return;
    }
    if (!URL.canParse(incoming.url, registered)) {
      outgoing.writeHead(400).end();
      return;
    }
    const url = new URL(incoming.url, registered);
    if (url.origin !== registered.origin) {
      outgoing.writeHead(400).end();
      return;
    }
    const returned = url.searchParams.get('state');
    const candidate = Buffer.from(returned ?? '');
    if (incoming.method !== 'GET' || url.pathname !== registered.pathname ||
        candidate.length !== state.length || !timingSafeEqual(candidate, Buffer.from(state))) {
      outgoing.writeHead(400).end();
      return;
    }
    const code = url.searchParams.get('code');
    outgoing.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    outgoing.end(code ? '授权响应已收到，请返回启动器。' : '授权未完成，请返回启动器。');
    if (code) finish(code);
    else fail(new Error('Microsoft 登录已取消或被拒绝'));
  });
  let timeout;
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    // Microsoft's dynamic port exception applies to the hostname localhost.
    const address = new URL(registeredRedirect);
    address.port = String(server.address().port);
    const redirect = address.href;
    const authorize = new URL(microsoft + '/authorize');
    authorize.search = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirect,
      scope: 'XboxLive.signin offline_access', prompt: 'select_account', state, code_challenge: challenge, code_challenge_method: 'S256',
    }).toString();
    timeout = setTimeout(() => fail(new Error('登录超时')), 180_000);
    await openBrowser(authorize.toString(), redirect);
    const token = await json(microsoft + '/token', {
      signal, body: new URLSearchParams({
        client_id: clientId, code: await callback, redirect_uri: redirect,
        grant_type: 'authorization_code', code_verifier: verifier,
      }),
    });
    if (!token.access_token) throw new Error('Microsoft 返回的凭据不完整');
    return { ...(await minecraftIdentity(token.access_token, (url, options) => json(url, { ...options, signal }))),
      clientId, refresh: token.refresh_token };
  } catch (error) {
    if (signal?.aborted) throw new Error('已关闭 Microsoft 登录窗口');
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    clearTimeout(timeout);
    server.close();
    server.closeAllConnections();
  }
}

export async function refreshSignIn({ clientId, refresh }) {
  if (!validClientId(clientId) || !refresh) throw new Error('会话已过期，请重新登录 Microsoft');
  const token = await json(microsoft + '/token', {
    body: new URLSearchParams({ client_id: clientId, refresh_token: refresh,
      grant_type: 'refresh_token', scope: 'XboxLive.signin offline_access' }),
  });
  if (!token.access_token) throw new Error('Microsoft 返回的凭据不完整');
  return { ...(await minecraftIdentity(token.access_token)), clientId, refresh: token.refresh_token ?? refresh };
}
