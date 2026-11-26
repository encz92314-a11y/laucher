const authHosts = new Set([
  'login.microsoftonline.com', 'login.microsoft.com', 'login.live.com',
  'account.live.com', 'account.microsoft.com', 'signup.live.com', 'privacynotice.account.microsoft.com',
]);

export function allowedAuthNavigation(address, callback) {
  try {
    const url = new URL(address);
    const target = new URL(callback);
    if (url.username || url.password) return false;
    if (url.origin === target.origin && url.pathname === target.pathname) return true;
    return url.protocol === 'https:' && !url.port && authHosts.has(url.hostname);
  } catch {
    return false;
  }
}
