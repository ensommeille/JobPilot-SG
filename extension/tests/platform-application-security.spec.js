import {test, expect} from '@playwright/test';
import {createApplicationHandler} from '../application-bridge.js';

const extensionId = 'a'.repeat(32);
const site = 'http://127.0.0.1:5173';
const api = 'http://127.0.0.1:8001';
const jobId = '11111111-2222-4333-8444-555555555555';
const pageUrl = 'https://www.internsg.com/job-apply/123/';
const parentUrl = `${site}/jobs/${jobId}/apply-external`;
const fields = [
  {id: 'applicant_name', label: 'Full name', maxLength: 200, occupied: false},
  {id: 'applicant_email', label: 'Email address', maxLength: 320, occupied: false},
  {id: 'applicant_contact', label: 'Contact number', maxLength: 40, occupied: false},
  {id: 'applicant_period', label: 'Availability period', maxLength: 500, occupied: false},
  {id: 'applicant_summary', label: 'Resume summary', maxLength: 3000, occupied: false},
];
const draft = {
  values: {applicant_name: 'Fictional applicant', applicant_email: 'fixture@example.test',
    applicant_contact: '123', applicant_period: 'January to March 2027', applicant_summary: 'My handwritten introduction.'},
  countries: {nationality: 'cn', campus: 'sg'}, profile_source: 'jobpilot', summary_status: 'manual_only',
  requires_review: true, submission_supported: false,
};

async function fingerprint(data) {
  const value = {values: Object.fromEntries(fields.map(({id}) => [id, data.values[id] || ''])),
    countries: {nationality: data.countries.nationality || '', campus: data.countries.campus || ''}};
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture() {
  let time = Date.now();
  const identity = {userId: 'fixture-user-a', sessionHash: 'b'.repeat(64), profileHash: await fingerprint(draft), parentUrl};
  const stored = {jobpilotSession: {site, api, token: 'jpx_fixture_only', userId: identity.userId,
    email: 'fixture@example.test', expiresAt: time / 1000 + 3600}};
  const state = {permission: true, serverUser: identity.userId, serverStatus: 200, frameDocument: 'child-a',
    duplicate: false, topDocument: 'top-a', fillFailure: false, fillResult: null, afterFill: null,
    draft: structuredClone(draft)};
  const calls = [], writes = [], network = [];
  const chrome = {
    runtime: {id: extensionId, getURL: name => `chrome-extension://${extensionId}/${name}`},
    permissions: {contains: async () => state.permission},
    storage: {session: {
      get: async () => structuredClone(stored),
      set: async value => Object.assign(stored, structuredClone(value)),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; },
    }},
    tabs: {query: async () => { throw new Error('The bridge must not choose the active tab'); }},
    scripting: {executeScript: async request => {
      calls.push(request);
      const name = request.func.name;
      if (name === 'verifyPlatformApplication') return [{frameId: 0, documentId: state.topDocument, result: {...identity}}];
      if (name === 'matchEmbeddedApplication') return [
        {frameId: 0, documentId: state.topDocument, result: null},
        {frameId: 2, documentId: state.frameDocument, result: {url: pageUrl}},
        ...(state.duplicate ? [{frameId: 3, documentId: 'duplicate-child', result: {url: pageUrl}}] : []),
      ];
      if (name === 'interactWithPage') {
        if (request.args[0] === 'inspect') return [{frameId: 2, documentId: state.frameDocument,
          result: {url: pageUrl, title: 'Fictional form', fields: structuredClone(fields)}}];
        expect(request.args[0]).toBe('fill');
        writes.push(request);
        if (state.fillFailure) throw new Error('A reply was lost after dispatch');
        state.afterFill?.();
        return [{frameId: 2, documentId: state.frameDocument, result: {
          filled: request.args[2].map(item => item.id), skipped: [], reasons: {}, submitted: false,
          ...state.fillResult,
        }}];
      }
      if (name === 'interactWithWidgets') {
        if (request.args[0] === 'inspect') return [{frameId: 2, documentId: state.frameDocument, result: {
          richReady: true, summaryOccupied: false, summaryReason: '',
          countries: [{code: 'cn', name: 'China'}, {code: 'sg', name: 'Singapore'}],
          countryState: {nationality: 'sg', campus: 'sg', same: true, nationalityText: 'Singapore', campusText: 'Singapore'},
          countryReason: '',
        }}];
        expect(request.args[0]).toBe('fill');
        writes.push(request);
        return [{frameId: 2, documentId: state.frameDocument, result: {
          filled: request.args[2].map(item => item.id), skipped: [], reasons: {}, submitted: false,
        }}];
      }
      throw new Error(`Unexpected injection: ${name}`);
    }},
  };
  const fetcher = async (url, options) => {
    network.push({url, options});
    if (url === `${api}/auth/extension/session`) return new Response(JSON.stringify({
      user_id: state.serverUser, expires_at: time / 1000 + 3600,
    }), {status: state.serverStatus});
    if (url === `${api}/browser-assistant/draft`) return new Response(JSON.stringify(state.draft));
    throw new Error(`Unexpected backend endpoint: ${url}`);
  };
  const handle = createApplicationHandler(chrome, fetcher, () => time);
  const sender = {url: parentUrl, origin: site, frameId: 0, documentId: 'top-a', tab: {id: 7, url: parentUrl}};
  const inspect = {kind: 'application-inspect', version: 1, job_id: jobId, page_url: pageUrl, profile_fingerprint: identity.profileHash};
  const approved = [{id: 'applicant_name', value: draft.values.applicant_name, confirmed: true}];
  const fill = review => ({kind: 'application-fill', version: 1, job_id: jobId, page_url: pageUrl, review_id: review.review_id, approved});
  return {handle, sender, inspect, fill, identity, state, stored, chrome, calls, writes, network,
    advance: amount => { time += amount; }};
}

test('platform bridge rejects untrusted callers before reading account or form', async () => {
  for (const change of [
    {origin: 'https://evil.test'}, {url: 'https://evil.test/jobs/x/apply-external'}, {frameId: 1},
    {id: 'b'.repeat(32)}, {documentId: ''}, {tab: undefined},
  ]) {
    const f = await fixture();
    await expect(f.handle(f.inspect, {...f.sender, ...change})).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
    expect(f.network).toHaveLength(0);
  }
});

test('caller cannot add identity, API, target-document or submit instructions', async () => {
  for (const patch of [
    {userId: 'fixture-user-a'}, {api: 'https://evil.test'}, {tabId: 99}, {documentId: 'child-a'},
    {expectedState: {}}, {submit: true}, {kind: 'application-submit'}, {version: 2},
    {page_url: 'https://www.internsg.com.evil.test/job-apply/123/'},
  ]) {
    const f = await fixture();
    await expect(f.handle({...f.inspect, ...patch}, f.sender)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('cached SPA sender URLs do not override the verified live document route', async () => {
  for (const cachedUrl of [`${site}/profile`, `${site}/?next=%2Fjobs#old-login-state`, parentUrl + '?old-route=1']) {
    const f = await fixture();
    const sender = {...f.sender, url: cachedUrl, tab: {...f.sender.tab, url: cachedUrl}};
    const review = await f.handle(f.inspect, sender);
    const result = await f.handle(f.fill(review), sender);
    expect(result).toMatchObject({ok: true, filled: ['applicant_name'], submitted: false});
    for (const request of f.calls.filter(call => call.func.name === 'verifyPlatformApplication')) {
      expect(request.world).toBe('ISOLATED');
      expect(request.args[0]).toBe(site);
      expect(request.target).toEqual({tabId: sender.tab.id, documentIds: [sender.documentId]});
    }
  }
});

test('verified live parent route must match the trusted origin and requested job without query or hash', async () => {
  for (const route of [
    `${site}/profile`, `${site}/jobs/99999999-2222-4333-8444-555555555555/apply-external`,
    parentUrl + '?unexpected=1', parentUrl + '#unexpected', 'https://evil.test/jobs/' + jobId + '/apply-external',
    `${site}/jobs/${jobId}/apply-external/extra`, `${site}/jobs/${jobId}/apply-external//`, undefined,
  ]) {
    const f = await fixture();
    f.identity.parentUrl = route;
    await expect(f.handle(f.inspect, f.sender)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('cached sender metadata cannot hide a current route or session change after inspection', async () => {
  for (const mutate of [
    f => { f.identity.parentUrl = `${site}/profile`; },
    f => { f.identity.parentUrl = parentUrl + '/'; },
    f => { f.identity.sessionHash = 'e'.repeat(64); },
    f => { f.identity.userId = 'fixture-user-b'; },
  ]) {
    const f = await fixture();
    const sender = {...f.sender, url: `${site}/profile`};
    const review = await f.handle(f.inspect, sender);
    mutate(f);
    await expect(f.handle(f.fill(review), sender)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('server-verified platform and extension identities must agree', async () => {
  for (const mutate of [
    f => { f.identity.userId = 'another-platform-account'; },
    f => { f.state.serverUser = 'another-extension-account'; },
    f => { f.state.serverStatus = 401; },
    f => { f.stored.jobpilotSession.expiresAt = 1; },
    f => { f.stored.jobpilotSession.token = 'not-a-restricted-token'; },
  ]) {
    const f = await fixture(); mutate(f);
    await expect(f.handle(f.inspect, f.sender)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('missing host permission stops execution and duplicate frames cannot be selected', async () => {
  const missing = await fixture(); missing.state.permission = false;
  await expect(missing.handle(missing.inspect, missing.sender)).rejects.toThrow();
  expect(missing.calls).toHaveLength(0);
  const duplicate = await fixture(); duplicate.state.duplicate = true;
  await expect(duplicate.handle(duplicate.inspect, duplicate.sender)).rejects.toThrow();
  expect(duplicate.writes).toHaveLength(0);
});

test('inspect and fill use originating tab and isolated account verification without leaking credentials', async () => {
  const f = await fixture();
  const review = await f.handle(f.inspect, f.sender);
  expect(review.ok).toBe(true);
  expect(JSON.stringify(review)).not.toContain('jpx_fixture_only');
  expect(JSON.stringify(review)).not.toContain(f.identity.sessionHash);
  expect(f.writes).toHaveLength(0);
  const result = await f.handle(f.fill(review), f.sender);
  expect(result).toMatchObject({ok: true, submitted: false, filled: ['applicant_name']});
  expect(f.calls.every(call => call.target.tabId === f.sender.tab.id)).toBe(true);
  for (const call of f.calls.filter(call => call.func.name === 'verifyPlatformApplication')) {
    expect(call.world ?? 'ISOLATED').toBe('ISOLATED');
    expect(call.target.documentIds).toEqual(['top-a']);
  }
  for (const call of f.writes) expect(call.target.documentIds).toEqual(['child-a']);
  for (const {url, options} of f.network) {
    expect(url.startsWith(api + '/')).toBe(true);
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    expect(options.cache).toBe('no-store');
  }
});

test('a review cannot be replayed, filled in another tab or another top document', async () => {
  const replay = await fixture();
  const review = await replay.handle(replay.inspect, replay.sender);
  await replay.handle(replay.fill(review), replay.sender);
  const count = replay.writes.length;
  await expect(replay.handle(replay.fill(review), replay.sender)).rejects.toThrow();
  expect(replay.writes).toHaveLength(count);
  for (const changed of [{tab: {id: 8, url: parentUrl}}, {documentId: 'top-b'}]) {
    const f = await fixture(); const reviewed = await f.handle(f.inspect, f.sender);
    await expect(f.handle(f.fill(reviewed), {...f.sender, ...changed})).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('account, session, profile, frame and expiry changes invalidate a prepared fill', async () => {
  for (const mutate of [
    f => { f.identity.userId = 'account-b'; },
    f => { f.identity.sessionHash = 'c'.repeat(64); },
    f => { f.identity.profileHash = 'd'.repeat(64); },
    f => { f.state.serverUser = 'account-b'; },
    f => { f.state.serverStatus = 401; },
    f => { f.state.frameDocument = 'reloaded-child'; },
    f => { f.state.topDocument = 'reloaded-top'; },
    f => { delete f.stored.jobpilotSession; },
    f => { f.advance(60 * 60 * 1000); },
  ]) {
    const f = await fixture(); const review = await f.handle(f.inspect, f.sender); mutate(f);
    await expect(f.handle(f.fill(review), f.sender)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('simultaneous fills consume the review once even without the background lock', async () => {
  const f = await fixture(); const review = await f.handle(f.inspect, f.sender);
  const outcomes = await Promise.allSettled([f.handle(f.fill(review), f.sender), f.handle(f.fill(review), f.sender)]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
  expect(f.writes).toHaveLength(1);
});

test('unconfirmed, duplicate and submit fields cannot reach page mutation', async () => {
  for (const approved of [
    [{id: 'applicant_name', value: 'Fictional applicant', confirmed: false}],
    [{id: 'submit', value: 'yes', confirmed: true}],
    [{id: 'g-recaptcha-response', value: 'fake', confirmed: true}],
    [{id: 'applicant_name', value: 'A', confirmed: true}, {id: 'applicant_name', value: 'B', confirmed: true}],
    [{id: 'applicant_name', value: 'A', confirmed: true, selector: 'button[type=submit]'}],
  ]) {
    const f = await fixture(); const review = await f.handle(f.inspect, f.sender);
    await expect(f.handle({...f.fill(review), approved}, f.sender)).rejects.toThrow();
    expect(f.writes).toHaveLength(0);
  }
});

test('stale platform preview cannot prepare a review and a fresh inspection replaces the previous one', async () => {
  const stale = await fixture();
  await expect(stale.handle({...stale.inspect, profile_fingerprint: 'e'.repeat(64)}, stale.sender)).rejects.toThrow();
  expect(stale.writes).toHaveLength(0);
  const f = await fixture();
  const first = await f.handle(f.inspect, f.sender);
  const latest = await f.handle(f.inspect, f.sender);
  expect(latest.review_id).not.toBe(first.review_id);
  await expect(f.handle(f.fill(first), f.sender)).rejects.toThrow();
  expect(f.writes).toHaveLength(0);
  await expect(f.handle(f.fill(latest), f.sender)).resolves.toMatchObject({submitted: false});
});

test('lost fill replies consume the review and cannot trigger an automatic second dispatch', async () => {
  const f = await fixture(); const review = await f.handle(f.inspect, f.sender);
  f.state.fillFailure = true;
  await expect(f.handle(f.fill(review), f.sender)).rejects.toThrow(/uncertain/);
  expect(f.writes).toHaveLength(1);
  f.state.fillFailure = false;
  await expect(f.handle(f.fill(review), f.sender)).rejects.toThrow(/already used/);
  expect(f.writes).toHaveLength(1);
});

test('untrusted page replies cannot claim submission or leak arbitrary reason text', async () => {
  const submitted = await fixture(); const review = await submitted.handle(submitted.inspect, submitted.sender);
  submitted.state.fillResult = {submitted: true};
  await expect(submitted.handle(submitted.fill(review), submitted.sender)).rejects.toThrow(/uncertain/);
  const f = await fixture(); const safeReview = await f.handle(f.inspect, f.sender);
  f.state.fillResult = {filled: ['unrequested-field'], skipped: ['applicant_name'],
    reasons: {applicant_name: 'PRIVATE_SOURCE_PAGE_DATA_MUST_NOT_RETURN'}};
  const result = await f.handle(f.fill(safeReview), f.sender);
  expect(result).toMatchObject({filled: [], skipped: ['applicant_name'], submitted: false});
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE_PAGE_DATA_MUST_NOT_RETURN');
  expect(JSON.stringify(result)).not.toContain('unrequested-field');
});

test('account change after ordinary fields stops widget filling and never reports success', async () => {
  const f = await fixture(); const review = await f.handle(f.inspect, f.sender);
  f.state.afterFill = () => { f.identity.userId = 'fixture-user-b'; };
  const message = f.fill(review);
  message.approved.push({id: 'applicant_summary', value: 'My handwritten introduction.', confirmed: true});
  await expect(f.handle(message, f.sender)).rejects.toThrow(/uncertain/);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].func.name).toBe('interactWithPage');
});

test('permissions revoked after preparation prevent any fill dispatch', async () => {
  const f = await fixture(); const review = await f.handle(f.inspect, f.sender);
  f.state.permission = false;
  await expect(f.handle(f.fill(review), f.sender)).rejects.toThrow(/access/);
  expect(f.writes).toHaveLength(0);
});
