// Native Node tests: mocked Chrome APIs and fetch; no browser or external sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createConnectionHandler} from '../connection.js';

const id = 'a'.repeat(32), site = 'http://127.0.0.1:15523', api = 'http://127.0.0.1:18523';
function fixture() {
  const stored = {}, calls = [];
  const chrome = {
    runtime: {id, getURL: name => `chrome-extension://${id}/${name}`, getManifest: () => ({version: '0.8.3'})},
    permissions: {contains: async () => true},
    storage: {session: {
      get: async () => structuredClone(stored),
      set: async value => Object.assign(stored, value),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    }},
    tabs: {create: async value => { calls.push(value); return {id: 7}; }},
  };
  const fetcher = async (url, options) => {
    calls.push({url, ...options});
    return new Response(JSON.stringify({access_token: 'jpx_test', user_id: 'user-1', email: 'user@example.test', expires_at: Date.now() / 1000 + 3600}));
  };
  return {stored, calls, chrome, handle: createConnectionHandler(chrome, fetcher),
    internal: {id, url: chrome.runtime.getURL('popup.html')},
    external: {url: site + '/connect-extension', origin: site, frameId: 0, tab: {id: 7}},
  };
}
const savedSession = () => ({site, api, token: 'jpx_test', userId: 'user-1', expiresAt: Date.now() / 1000 + 1800});
const status = {kind: 'connection-status', version: 1};

test('current local PKCE keeps verifier and restricted token out of platform messages', async () => {
  const f = fixture();
  await f.handle({kind: 'begin', site}, f.internal);
  const pending = f.stored.jobpilotPending;
  assert.equal(pending.api, api);
  assert.match(f.calls[0].url, /^http:\/\/127\.0\.0\.1:15523\/connect-extension#/);
  assert.ok(!f.calls[0].url.includes(pending.verifier));
  const details = await f.handle({kind: 'connection-details', state: pending.state}, f.external, true);
  assert.equal(details.api, api);
  assert.equal(details.challenge.length, 43);
  assert.equal(details.verifier, undefined);
  const result = await f.handle({kind: 'complete', state: pending.state, code: 'c'.repeat(43)}, f.external, true);
  assert.deepEqual(result, {ok: true});
  assert.equal(f.calls[1].url, api + '/auth/extension/exchange');
  assert.equal(f.calls[1].headers.Authorization, undefined);
  assert.equal(f.calls[1].credentials, 'omit');
  assert.equal(JSON.parse(f.calls[1].body).verifier, pending.verifier);
  assert.equal(f.stored.jobpilotSession.token, 'jpx_test');
  assert.equal(f.stored.jobpilotPending, undefined);
  await assert.rejects(f.handle({kind: 'complete', state: pending.state, code: 'c'.repeat(43)}, f.external, true));
  for (const unsupported of ['http://localhost:15523', 'http://127.0.0.1:15524', 'https://127.0.0.1:15523']) {
    await assert.rejects(f.handle({kind: 'begin', site: unsupported}, f.internal), /Unsupported platform/);
  }
});

test('status verifies the fixed API and returns only connection metadata', async () => {
  const f = fixture();
  f.stored.jobpilotSession = savedSession();
  const result = await f.handle(status, f.external, true);
  assert.deepEqual(result, {ok: true, version: 1, extension_version: '0.8.3', connected: true, platform_origin: site, api_origin: api,
    user_id: 'user-1', expires_at: f.stored.jobpilotSession.expiresAt});
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, api + '/auth/extension/session');
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].credentials, 'omit');
  assert.equal(f.calls[0].redirect, 'error');
  assert.equal(f.calls[0].cache, 'no-store');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer jpx_test');
  assert.doesNotMatch(JSON.stringify(result), /jpx_|access_token|verifier|email|profile/);
  assert.equal(f.stored.jobpilotPending, undefined);
});

test('untrusted status callers and versions stop before reading a session', async () => {
  const f = fixture();
  let reads = 0;
  f.chrome.storage.session.get = async () => { reads++; return {}; };
  for (const sender of [
    {...f.external, origin: 'http://localhost:15523'}, {...f.external, frameId: 1},
    {...f.external, url: 'http://127.0.0.1:15524/jobs'}, {...f.external, id: 'b'.repeat(32)},
  ]) await assert.rejects(f.handle(status, sender, true));
  await assert.rejects(f.handle({...status, version: 2}, f.external, true));
  assert.equal(reads, 0);
  assert.deepEqual(f.calls, []);
});

test('missing, expired, wrong-pair and platform-token sessions make no status requests', async () => {
  const session = savedSession();
  for (const saved of [undefined, {...session, expiresAt: 0}, {...session, expiresAt: 'never'},
    {...session, site: 'http://127.0.0.1:5173'}, {...session, api: 'http://127.0.0.1:8001'}, {...session, token: 'platform-token'}]) {
    const f = fixture();
    f.stored.jobpilotSession = saved;
    assert.deepEqual(await f.handle(status, f.external, true), {
      ok: true, version: 1, extension_version: '0.8.3', connected: false, platform_origin: site, api_origin: api,
    });
    assert.deepEqual(f.calls, []);
  }
});

test('backend refusal, mismatched account, expired response and disconnect cannot claim connected', async () => {
  for (const scenario of ['refused', 'other-account', 'expired', 'disconnected', 'reconnected']) {
    const f = fixture();
    f.stored.jobpilotSession = savedSession();
    const handle = createConnectionHandler(f.chrome, async () => {
      if (scenario === 'disconnected') delete f.stored.jobpilotSession;
      if (scenario === 'reconnected') f.stored.jobpilotSession.token = 'jpx_new_connection';
      return new Response(JSON.stringify({user_id: scenario === 'other-account' ? 'user-2' : 'user-1',
        expires_at: scenario === 'expired' ? 0 : Date.now() / 1000 + 3600}), {status: scenario === 'refused' ? 401 : 200});
    });
    const result = await handle(status, f.external, true);
    assert.equal(result.connected, false);
    assert.equal(result.user_id, undefined);
  }
});

test('a status network failure fails visibly without an automatic request retry', async () => {
  const f = fixture();
  f.stored.jobpilotSession = savedSession();
  let attempts = 0;
  const handle = createConnectionHandler(f.chrome, async () => { attempts++; throw new Error('Offline fixture'); });
  await assert.rejects(handle(status, f.external, true), /Offline fixture/);
  assert.equal(attempts, 1);
});
