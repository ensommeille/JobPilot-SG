import {test, expect} from '@playwright/test';
import {createConnectionHandler} from '../connection.js';

const id = 'a'.repeat(32), site = 'http://127.0.0.1:5173';
function fixture() {
  const stored = {}, calls = [];
  const chrome = {
    runtime: {id, getURL: name => 'chrome-extension://' + id + '/' + name},
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
  const external = {url: site + '/connect-extension', origin: site, frameId: 0, tab: {id: 7}};
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
