// Explicit deployment pairs. Never accept an API URL supplied by a webpage.
export const DEPLOYMENTS = {
  'http://127.0.0.1:5173': 'http://127.0.0.1:8001',
  'http://localhost:5173': 'http://localhost:8000',
  'http://127.0.0.1:5174': 'http://127.0.0.1:8002',
};
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const challengeFor = async value => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export function createConnectionHandler(chromeApi, fetcher = fetch) {
  async function request(api, path, body, token) {
    const response = await fetcher(api + path, {method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
    if (path.endsWith('/disconnect') && response.status === 401) return {};
    if (!response.ok) throw new Error(`Connection failed (${response.status}). Check the platform login and registered extension ID.`);
    return response.status === 204 ? {} : response.json();
  }
  async function handle(message, sender, external = false) {
    if (!message || typeof message !== 'object') throw new Error('Invalid message');
    const url = new URL(sender.url || 'about:blank');
    if (!external) {
      if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL('popup.html')) throw new Error('Untrusted extension caller');
      if (message.kind === 'disconnect') {
        const {jobpilotSession: session} = await chromeApi.storage.session.get('jobpilotSession');
        if (session?.token?.startsWith('jpx_') && DEPLOYMENTS[session.site] === session.api) await request(session.api, '/auth/extension/disconnect', {}, session.token);
        await chromeApi.storage.session.remove(['jobpilotSession', 'jobpilotPending']);
        return {ok: true};
      }
      if (message.kind !== 'begin' || !Object.hasOwn(DEPLOYMENTS, message.site)) throw new Error('Unsupported platform');
      if (!await chromeApi.permissions.contains({origins: [`${DEPLOYMENTS[message.site]}/*`]})) throw new Error('Grant API access from the extension first');
      const {jobpilotSession: old} = await chromeApi.storage.session.get('jobpilotSession');
      if (old?.token?.startsWith('jpx_') && DEPLOYMENTS[old.site] === old.api) await request(old.api, '/auth/extension/disconnect', {}, old.token);
      await chromeApi.storage.session.remove('jobpilotSession');
      const verifier = random(), state = random();
      const pending = {site: message.site, api: DEPLOYMENTS[message.site], state, verifier, challenge: await challengeFor(verifier), expires: Date.now() + 5 * 60000};
      await chromeApi.storage.session.set({jobpilotPending: pending});
      const tab = await chromeApi.tabs.create({url: `${message.site}/connect-extension#extension_id=${chromeApi.runtime.id}&state=${state}`});
      pending.tabId = tab.id;
      await chromeApi.storage.session.set({jobpilotPending: pending});
      return {ok: true};
    }
    if (sender.id || sender.frameId !== 0 || !Object.hasOwn(DEPLOYMENTS, url.origin) || sender.origin !== url.origin) throw new Error('Untrusted platform caller');
    if (message.kind === 'platform-signed-out') {
      const data = await chromeApi.storage.session.get(['jobpilotSession', 'jobpilotPending']);
      if (data.jobpilotSession?.site === url.origin) await chromeApi.storage.session.remove('jobpilotSession');
      if (data.jobpilotPending?.site === url.origin) await chromeApi.storage.session.remove('jobpilotPending');
      return {ok: true};
    }
    const {jobpilotPending: pending} = await chromeApi.storage.session.get('jobpilotPending');
    if (url.pathname !== '/connect-extension' || !pending || pending.site !== url.origin || pending.tabId !== sender.tab?.id
        || pending.state !== message.state || pending.expires <= Date.now()) throw new Error('Connection request expired or does not match this tab. Start again from the extension.');
    if (message.kind === 'connection-details') return {ok: true, challenge: pending.challenge, api: pending.api, client_id: chromeApi.runtime.id};
    if (message.kind !== 'complete' || !/^[A-Za-z0-9_-]{43}$/.test(message.code || '')) throw new Error('Invalid authorization response');
    await chromeApi.storage.session.remove('jobpilotPending');
    const result = await request(pending.api, '/auth/extension/exchange', {code: message.code, verifier: pending.verifier, client_id: chromeApi.runtime.id});
    if (!result.access_token?.startsWith('jpx_') || typeof result.user_id !== 'string' || typeof result.email !== 'string' || result.expires_at * 1000 <= Date.now()) throw new Error('Invalid session response');
    await chromeApi.storage.session.set({jobpilotSession: {api: pending.api, site: pending.site, token: result.access_token,
      userId: result.user_id, email: result.email, expiresAt: result.expires_at}});
    // No token, verifier or profile contents are returned to the webpage.
    return {ok: true};
  }
  return handle;
}
