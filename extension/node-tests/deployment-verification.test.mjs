// Synthetic globals verify the serialized adapter without starting a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPlatformApplication} from '../application-bridge.js';

const jobId = '11111111-2222-4333-8444-555555555555';
const applicationUrl = 'https://www.internsg.com/job-apply/123/';

async function verifyAt(site, expectedOrigin = site) {
  const requests = [];
  const parentUrl = `${site}/jobs/${jobId}/apply-external`;
  const window = {}; window.top = window;
  const globals = {
    location: new URL(parentUrl), window,
    document: {querySelectorAll: () => [{src: applicationUrl}]},
    localStorage: {getItem: () => 'platform-fixture-token'},
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
    const identity = await verifyPlatformApplication(expectedOrigin, applicationUrl, jobId);
    return {identity, requests};
  } catch (error) {
    return {error, requests};
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
