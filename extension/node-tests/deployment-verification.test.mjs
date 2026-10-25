// Synthetic globals verify the serialized adapter without starting a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlatformApplication, createApplicationHandler} from '../application-bridge.js';

const jobId = '11111111-2222-4333-8444-555555555555';
const applicationUrl = 'https://www.internsg.com/job-apply/123/';

async function verifyAt(site, expectedOrigin = site, {suffix = '', serialized = false} = {}) {
  const requests = [];
  let tokenReads = 0;
  const parentUrl = `${site}/jobs/${jobId}/apply-external${suffix}`;
  const window = {}; window.top = window;
  const globals = {
    location: new URL(parentUrl), window,
    document: {querySelectorAll: () => [{src: applicationUrl}]},
    localStorage: {getItem: () => { tokenReads++; return 'platform-fixture-token'; }},
    fetch: async (url, options) => {
      requests.push({url, options});
      return new Response(JSON.stringify(url.endsWith('/users/me') ? {id: 'fixture-account'}
        : url.includes('/jobs/') ? {id: jobId, status: 'active', apply_url: applicationUrl}
          : {values: {applicant_name: 'Fictional Applicant'}, countries: {nationality: 'cn', campus: 'sg'}}));
    },
  };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  try {
    const verify = serialized ? (0, eval)('(' + verifyPlatformApplication.toString() + ')') : verifyPlatformApplication;
    const identity = await verify(expectedOrigin, applicationUrl, jobId);
    return {identity, requests, tokenReads};
  } catch (error) {
    return {error, requests, tokenReads};
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('current local InternSG verification sends the platform credential only to the fixed API', async () => {
  const {identity, requests, error} = await verifyAt('http://127.0.0.1:15523');
  assert.equal(error, undefined);
  assert.equal(identity.userId, 'fixture-account');
  assert.equal(identity.parentUrl, `http://127.0.0.1:15523/jobs/${jobId}/apply-external`);
  assert.deepEqual(requests.map(item => item.url), [
    'http://127.0.0.1:18523/users/me', `http://127.0.0.1:18523/jobs/${jobId}`,
    'http://127.0.0.1:18523/browser-assistant/draft',
  ]);
  assert.ok(requests.every(item => item.options.headers.Authorization === 'Bearer platform-fixture-token'
    && item.options.redirect === 'error' && item.options.credentials === 'omit'));
  assert.ok(!JSON.stringify(identity).includes('platform-fixture-token'));
  assert.match(identity.sessionHash, /^[a-f0-9]{64}$/);
  assert.match(identity.profileHash, /^[a-f0-9]{64}$/);
});

test('nearby origins and mismatched expected origin stop before any credential request', async () => {
  for (const [site, expected] of [
    ['http://localhost:15523', 'http://localhost:15523'],
    ['http://127.0.0.1:15524', 'http://127.0.0.1:15524'],
    ['https://127.0.0.1:15523', 'https://127.0.0.1:15523'],
    ['http://127.0.0.1:15523', 'http://127.0.0.1:5173'],
  ]) {
    const {error, requests} = await verifyAt(site, expected);
    assert.ok(error instanceof Error);
    assert.deepEqual(requests, []);
  }
});

test('serialized verifier accepts only one optional resume UUID and retains its exact parent URL', async () => {
  const suffix = '?resume=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const {identity, error, requests} = await verifyAt('http://127.0.0.1:15523', undefined, {suffix, serialized: true});
  assert.equal(error, undefined);
  assert.equal(identity.parentUrl, `http://127.0.0.1:15523/jobs/${jobId}/apply-external${suffix}`);
  assert.equal(requests.length, 3);
});

test('serialized verifier blocks duplicate, unknown, malformed query and hash before reading credentials', async () => {
  const selection = '?resume=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  for (const suffix of [selection + '&resume=ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee', selection + '&x=1', '?x=1',
    '?resume=', '?resume=not-a-uuid', '?resume=%61aaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '?', selection + '#changed']) {
    const {error, requests, tokenReads} = await verifyAt('http://127.0.0.1:15523', undefined, {suffix, serialized: true});
    assert.ok(error instanceof Error, suffix); assert.equal(tokenReads, 0, suffix); assert.deepEqual(requests, [], suffix);
  }
});

test('bridge permits a stable selected-resume route but changing that exact URL prevents every write', async () => {
  const site = 'http://127.0.0.1:15523', api = 'http://127.0.0.1:18523';
  const initial = `${site}/jobs/${jobId}/apply-external?resume=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`;
  for (const changeRoute of [false, true]) {
    let parentUrl = initial, writes = 0;
    const expires = Date.now() / 1000 + 3600, profileHash = 'a'.repeat(64);
    const session = {site, api, userId: 'fixture-account', token: 'jpx_fixture', expiresAt: expires};
    const chrome = {storage: {session: {get: async () => ({jobpilotSession: session})}}, permissions: {contains: async () => true}, scripting: {executeScript: async request => {
      const name = request.func.name;
      if (name === 'verifyPlatformApplication') return [{documentId: 'parent-doc', result: {userId: session.userId, sessionHash: 'b'.repeat(64), profileHash, parentUrl}}];
      if (name === 'matchEmbeddedApplication') return [{documentId: 'child-doc', frameId: 2, result: {url: applicationUrl}}];
      if (name === 'interactWithWidgets') return [{documentId: 'child-doc', result: {richReady: false, countries: [], countryState: null}}];
      if (name === 'interactWithPage' && request.args[0] === 'inspect') return [{documentId: 'child-doc', result: {url: applicationUrl, fields: [{id: 'applicant_name', occupied: false, maxLength: 200}]}}];
      if (name === 'interactWithPage' && request.args[0] === 'fill') { writes++; return [{documentId: 'child-doc', result: {filled: ['applicant_name'], skipped: [], submitted: false}}]; }
      throw new Error('Unexpected boundary call');
    }}};
    const handle = createApplicationHandler(chrome, async () => new Response(JSON.stringify({user_id: session.userId, expires_at: expires})));
    const sender = {url: initial, origin: site, frameId: 0, documentId: 'parent-doc', tab: {id: 7}};
    const review = await handle({kind: 'application-inspect', version: 1, job_id: jobId, page_url: applicationUrl, profile_fingerprint: profileHash}, sender);
    if (changeRoute) parentUrl = initial.replace('aaaaaaaa', 'ffffffff');
    const filling = handle({kind: 'application-fill', version: 1, job_id: jobId, page_url: applicationUrl, review_id: review.review_id,
      approved: [{id: 'applicant_name', value: 'Fictional applicant', confirmed: true}]}, sender);
    if (changeRoute) { await assert.rejects(filling, /Application, account or saved details changed/); assert.equal(writes, 0); }
    else { assert.deepEqual((await filling).filled, ['applicant_name']); assert.equal(writes, 1); }
  }
});
