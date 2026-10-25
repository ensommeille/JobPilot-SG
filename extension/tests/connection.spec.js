import {test, expect} from '@playwright/test';
import {createConnectionHandler} from '../connection.js';

const id = 'a'.repeat(32), site = 'http://127.0.0.1:5173';
function fixture(platform = site) {
  const stored = {}, calls = [];
  const chrome = {
    runtime: {id, getURL: name => 'chrome-extension://' + id + '/' + name, getManifest: () => ({version: '0.8.3'})},
    permissions: {contains: async () => true},
    storage: {session: {
      get: async () => ({...stored}),
      set: async value => Object.assign(stored, value),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    }},
    tabs: {create: async value => { calls.push(value); return {id: 7}; }},
  };
  const fetcher = async (url, options) => {
    calls.push({url, ...options});
    return new Response(JSON.stringify({access_token: 'jpx_test', user_id: 'user-1', email: 'user@example.test', expires_at: Date.now() / 1000 + 3600}));
  };
  const handle = createConnectionHandler(chrome, fetcher);
  const internal = {id, url: chrome.runtime.getURL('popup.html')};
  const external = {url: platform + '/connect-extension', origin: platform, frameId: 0, tab: {id: 7}};
  return {stored, calls, chrome, handle, internal, external};
}

test('PKCE handshake keeps verifier and session token out of webpage messages', async () => {
  const f = fixture();
  await f.handle({kind: 'begin', site}, f.internal);
  const pending = f.stored.jobpilotPending;
  const detail = await f.handle({kind: 'connection-details', state: pending.state}, f.external, true);
  expect(detail.challenge).toHaveLength(43);
  expect(detail).not.toHaveProperty('verifier');
  expect(f.calls[0].url).not.toContain(pending.verifier);
  const result = await f.handle({kind: 'complete', state: pending.state, code: 'c'.repeat(43)}, f.external, true);
  expect(result).toEqual({ok: true});
  expect(f.stored.jobpilotSession.token).toBe('jpx_test');
  expect(f.stored.jobpilotPending).toBeUndefined();
  const request = f.calls[1];
  expect(JSON.parse(request.body).verifier).toBe(pending.verifier);
  expect(request.headers.Authorization).toBeUndefined();
  expect(request.credentials).toBe('omit');
  await expect(f.handle({kind: 'complete', state: pending.state, code: 'c'.repeat(43)}, f.external, true)).rejects.toThrow();
});

test('isolated ATS acceptance deployment uses its exact local API pair', async () => {
  const f = fixture();
  await f.handle({kind: 'begin', site: 'http://127.0.0.1:5174'}, f.internal);
  expect(f.stored.jobpilotPending.api).toBe('http://127.0.0.1:8002');
  expect(f.calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:5174\/connect-extension#/);
});

test('current local deployment completes PKCE using only its exact API pair', async () => {
  const platform = 'http://127.0.0.1:15523', api = 'http://127.0.0.1:18523';
  const f = fixture(platform);
  await f.handle({kind: 'begin', site: platform}, f.internal);
  const pending = f.stored.jobpilotPending;
  expect(pending.api).toBe(api);
  expect(f.calls[0].url).toMatch(/^http:\/\/127\.0\.0\.1:15523\/connect-extension#/);
  const details = await f.handle({kind: 'connection-details', state: pending.state}, f.external, true);
  expect(details.api).toBe(api);
  await f.handle({kind: 'complete', state: pending.state, code: 'c'.repeat(43)}, f.external, true);
  expect(f.calls[1].url).toBe(api + '/auth/extension/exchange');
  expect(f.calls[1].headers.Authorization).toBeUndefined();
  expect(f.stored.jobpilotSession).toMatchObject({site: platform, api, token: 'jpx_test'});
  for (const unsupported of ['http://localhost:15523', 'http://127.0.0.1:15524', 'https://127.0.0.1:15523']) {
    await expect(f.handle({kind: 'begin', site: unsupported}, f.internal)).rejects.toThrow('Unsupported platform');
  }
});

test('connection status verifies the restricted session and exposes metadata only', async () => {
  const platform = 'http://127.0.0.1:15523', api = 'http://127.0.0.1:18523';
  const f = fixture(platform);
  f.stored.jobpilotSession = {site: platform, api, token: 'jpx_test', userId: 'user-1', expiresAt: Date.now() / 1000 + 1800};
  const result = await f.handle({kind: 'connection-status', version: 1}, f.external, true);
  expect(result).toEqual({ok: true, version: 1, extension_version: '0.8.3', connected: true, platform_origin: platform, api_origin: api,
    user_id: 'user-1', expires_at: f.stored.jobpilotSession.expiresAt});
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]).toMatchObject({url: api + '/auth/extension/session', method: 'GET', credentials: 'omit',
    redirect: 'error', cache: 'no-store', headers: {Authorization: 'Bearer jpx_test'}});
  expect(JSON.stringify(result)).not.toMatch(/jpx_|access_token|verifier|email|profile/);
  expect(f.stored.jobpilotPending).toBeUndefined();
});

test('status rejects untrusted callers and wrong versions without reading a session or making requests', async () => {
  const f = fixture('http://127.0.0.1:15523');
  let reads = 0;
  f.chrome.storage.session.get = async () => { reads++; return {}; };
  const message = {kind: 'connection-status', version: 1};
  for (const sender of [
    {...f.external, origin: 'http://localhost:15523'}, {...f.external, frameId: 1},
    {...f.external, url: 'http://127.0.0.1:15524/jobs'}, {...f.external, id: 'b'.repeat(32)},
  ]) await expect(f.handle(message, sender, true)).rejects.toThrow();
  await expect(f.handle({...message, version: 2}, f.external, true)).rejects.toThrow();
  expect(reads).toBe(0);
  expect(f.calls).toEqual([]);
});

test('missing, expired, wrong-origin and platform-token sessions never make status requests', async () => {
  const platform = 'http://127.0.0.1:15523', api = 'http://127.0.0.1:18523';
  const session = {site: platform, api, token: 'jpx_test', userId: 'user-1', expiresAt: Date.now() / 1000 + 3600};
  for (const saved of [undefined, {...session, expiresAt: 0}, {...session, expiresAt: 'never'},
    {...session, site}, {...session, api: 'http://127.0.0.1:8001'}, {...session, token: 'platform-token'}]) {
    const f = fixture(platform);
    f.stored.jobpilotSession = saved;
    expect(await f.handle({kind: 'connection-status', version: 1}, f.external, true)).toEqual({
      ok: true, version: 1, extension_version: '0.8.3', connected: false, platform_origin: platform, api_origin: api,
    });
    expect(f.calls).toEqual([]);
  }
});

test('backend refusal, account mismatch, expired response and disconnect during status cannot claim connected', async () => {
  const platform = 'http://127.0.0.1:15523', api = 'http://127.0.0.1:18523';
  for (const scenario of ['refused', 'other-account', 'expired', 'disconnected']) {
    const f = fixture(platform);
    f.stored.jobpilotSession = {site: platform, api, token: 'jpx_test', userId: 'user-1', expiresAt: Date.now() / 1000 + 3600};
    const handle = createConnectionHandler(f.chrome, async () => {
      if (scenario === 'disconnected') delete f.stored.jobpilotSession;
      return new Response(JSON.stringify({user_id: scenario === 'other-account' ? 'user-2' : 'user-1',
        expires_at: scenario === 'expired' ? 0 : Date.now() / 1000 + 3600}), {status: scenario === 'refused' ? 401 : 200});
    });
    const result = await handle({kind: 'connection-status', version: 1}, f.external, true);
    expect(result.connected).toBe(false);
    expect(result).not.toHaveProperty('user_id');
  }
});

test('origin, top frame, requesting tab, state, expiry and internal caller are bound', async () => {
  const f = fixture();
  await expect(f.handle({kind: 'begin', site: 'https://evil.test'}, f.internal)).rejects.toThrow();
  await expect(f.handle({kind: 'begin', site}, {...f.internal, id: 'b'.repeat(32)})).rejects.toThrow();
  await f.handle({kind: 'begin', site}, f.internal);
  const message = {kind: 'connection-details', state: f.stored.jobpilotPending.state};
  for (const sender of [
    {...f.external, origin: 'https://evil.test'},
    {...f.external, frameId: 1},
    {...f.external, tab: {id: 8}},
    {...f.external, url: site + '/profile'},
    {...f.external, id: 'b'.repeat(32)},
  ]) await expect(f.handle(message, sender, true)).rejects.toThrow();
  await expect(f.handle({...message, state: 'wrong'}, f.external, true)).rejects.toThrow();
  f.stored.jobpilotPending.expires = 0;
  await expect(f.handle(message, f.external, true)).rejects.toThrow();
});

test('platform logout clears only its connection; disconnect revokes before clearing', async () => {
  const f = fixture();
  f.stored.jobpilotSession = {site, api: 'http://127.0.0.1:8001', token: 'jpx_test'};
  await f.handle({kind: 'platform-signed-out'}, {...f.external, origin: 'http://localhost:5173', url: 'http://localhost:5173/'}, true);
  expect(f.stored.jobpilotSession).toBeDefined();
  await f.handle({kind: 'disconnect'}, f.internal);
  expect(f.calls[0].url).toContain('/disconnect');
  expect(f.stored.jobpilotSession).toBeUndefined();
  await f.handle({kind: 'begin', site}, f.internal);
  await f.handle({kind: 'platform-signed-out'}, f.external, true);
  expect(f.stored.jobpilotPending).toBeUndefined();
});

test('failed exchange consumes local pending request and never stores a session', async () => {
  const f = fixture();
  await f.handle({kind: 'begin', site}, f.internal);
  const handle = createConnectionHandler(f.chrome, async () => new Response('', {status: 401}));
  await expect(handle({kind: 'complete', state: f.stored.jobpilotPending.state, code: 'c'.repeat(43)}, f.external, true)).rejects.toThrow();
  expect(f.stored.jobpilotPending).toBeUndefined();
  expect(f.stored.jobpilotSession).toBeUndefined();
});
