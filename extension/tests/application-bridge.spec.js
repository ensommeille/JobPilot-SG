import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {createApplicationHandler, verifyPlatformApplication} from '../application-bridge.js';

const jobId = '12345678-1234-1234-1234-123456789012';
const site = 'http://127.0.0.1:5173', api = 'http://127.0.0.1:8001';
const parentUrl = `${site}/jobs/${jobId}/apply-external`;
const applicationUrl = 'https://www.internsg.com/job-apply/123/';
const ids = ['applicant_name', 'applicant_email', 'applicant_contact', 'applicant_period', 'applicant_summary'];
const fingerprint = draft => createHash('sha256').update(JSON.stringify({values: Object.fromEntries(ids.map(id => [id, draft.values[id] || ''])),
  countries: {nationality: draft.countries.nationality || '', campus: draft.countries.campus || ''}})).digest('hex');
const html = `<form method="post"><input id="applicant_name" name="applicant_name">
<input id="applicant_email" name="applicant_email"><input id="applicant_contact" name="applicant_contact">
<input id="applicant_period" name="applicant_period"><textarea id="applicant_summary" name="applicant_summary" style="display:none"></textarea>
<div id="editor" contenteditable></div><input id="applicant_nationality" name="applicant_nationality">
<input type="hidden" id="applicant_nationality_code" name="applicant_nationality_code">
<input type="checkbox" id="campus_same_nationality" name="campus_same_nationality" checked>
<input id="applicant_campus" name="applicant_campus"><input type="hidden" id="applicant_campus_code" name="applicant_campus_code">
<input type="checkbox" id="consent"><div id="captcha">Manual CAPTCHA fixture</div><button type="submit">Submit</button></form>`;

async function setup(page, {requestedUrl = applicationUrl, redirectUrl = null} = {}) {
  const frameUrl = redirectUrl || requestedUrl;
  const frameResponseUrl = new URL(frameUrl);
  frameResponseUrl.hash = '';
  const f = {requests: [], injections: [], writes: [], permitted: true, sessionValid: true, jobActive: true, jobUrl: requestedUrl,
    childDocumentId: 'child-document',
    draft: {values: {applicant_name: 'Fictional Applicant', applicant_email: 'fixture@example.test', applicant_contact: '12345678',
      applicant_period: 'January to March', applicant_summary: 'A user-written summary'}, countries: {nationality: 'cn', campus: 'sg'}},
    platformUser: 'account-a', session: {site, api, token: 'jpx_fixture', userId: 'account-a', expiresAt: Date.now() / 1000 + 3600}};
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(api)) {
      f.requests.push({url, headers: route.request().headers(), method: route.request().method(), body: route.request().postDataJSON()});
      const headers = {'Access-Control-Allow-Origin': site, 'Access-Control-Allow-Headers': 'Authorization,Content-Type'};
      if (route.request().method() === 'OPTIONS') return route.fulfill({status: 204, headers});
      await f.beforeApiReply?.(url);
      const body = url.endsWith('/users/me') ? {id: f.platformUser}
        : url.includes('/jobs/') ? {id: jobId, status: f.jobActive ? 'active' : 'closed', apply_url: f.jobUrl} : f.draft;
      return route.fulfill({json: body, headers});
    }
    if (url === parentUrl) return route.fulfill({contentType: 'text/html', body: `<input id="applicant_name" value="Parent untouched"><iframe data-jobpilot-internsg src="${requestedUrl}"></iframe>`});
    // A fresh browser navigation keeps both legs intercepted; HTTP redirects can bypass page.route.
    if (redirectUrl && url === requestedUrl) return route.fulfill({contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(redirectUrl)})</script>`});
    if (url === frameResponseUrl.href) return route.fulfill({contentType: 'text/html', body: html});
    return route.abort();
  });
  await page.goto(parentUrl);
  await page.evaluate(() => localStorage.setItem('jobpilot_token', 'platform-fixture-token'));
  await expect.poll(() => page.frames().some(frame => frame.url() === frameUrl)).toBe(true);
  const frame = page.frames().find(frame => frame.url() === frameUrl);
  await frame.evaluate(() => {
    const countries = [{iso2: 'sg', name: 'Singapore'}, {iso2: 'cn', name: 'China'}];
    const nationality = document.getElementById('applicant_nationality'), campus = document.getElementById('applicant_campus');
    for (const el of [nationality, campus]) { el.value = 'Singapore'; document.getElementById(el.id + '_code').value = 'sg'; }
    window.jQuery = el => ({data: () => true, trigger: () => {}, countrySelect: (operation, code) => {
      if (operation === 'getSelectedCountryData') return countries.find(country => country.iso2 === document.getElementById(el.id + '_code').value);
      if (operation === 'selectCountry') { el.value = countries.find(country => country.iso2 === code).name; document.getElementById(el.id + '_code').value = code; }
    }});
    window.jQuery.fn = {countrySelect: {getCountryData: () => countries}};
    const summary = document.getElementById('applicant_summary'), editor = document.getElementById('editor');
    window.FroalaEditor = {INSTANCES: [{el: editor, $oel: [summary], html: {get: () => editor.innerHTML, set: html => { editor.innerHTML = html; }},
      core: {isEmpty: () => !editor.textContent.trim()}, events: {trigger: () => {}}}]};
    window.submits = 0;
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.submits++; });
  });
  f.sender = {url: parentUrl, origin: site, frameId: 0, tab: {id: 7}, documentId: 'parent-document'};
  f.chrome = {permissions: {contains: async () => f.permitted}, storage: {session: {get: async () => ({jobpilotSession: f.session})},
    onChanged: {addListener: callback => { f.storageChanged = callback; }}}, scripting: {executeScript: async request => {
      f.injections.push(request);
      const documents = request.target.allFrames ? [['parent-document', 0, page.mainFrame()], [f.childDocumentId, 1, frame]]
        : request.target.documentIds?.map(document => document === 'parent-document' ? [document, 0, page.mainFrame()] : [document, 1, frame]);
      if (!documents || documents.some(([id]) => !['parent-document', f.childDocumentId].includes(id))) throw new Error('Wrong target');
      const results = [];
      for (const [documentId, frameId, target] of documents) {
        const result = await target.evaluate(({source, args}) => (0, eval)(`(${source})`)(...args), {source: request.func.toString(), args: request.args});
        results.push({documentId, frameId, result});
      }
      if (request.args?.[0] === 'fill') { f.writes.push(request); await f.afterWrite?.(); }
      return results;
    }}};
  f.handle = createApplicationHandler(f.chrome, async (url, options) => {
    f.requests.push({url, ...options});
    return new Response(JSON.stringify({user_id: f.session?.userId, expires_at: Date.now() / 1000 + 3600}), {status: f.sessionValid ? 200 : 401});
  });
  f.inspect = () => f.handle({kind: 'application-inspect', version: 1, job_id: jobId, page_url: requestedUrl, profile_fingerprint: fingerprint(f.draft)}, f.sender);
  f.fill = (review, approved) => f.handle({kind: 'application-fill', version: 1, job_id: jobId, page_url: requestedUrl, review_id: review.review_id, approved}, f.sender);
  f.frame = frame;
  return f;
}

test('full bridge inspects and fills original text, rich text and linked countries without submitting', async ({page}) => {
  const f = await setup(page);
  await f.frame.locator('#applicant_email').fill('already-private@example.test');
  await f.frame.evaluate(() => { window.jQuery.fn.countrySelect.getCountryData()[0].name = 'Private source text must not cross the bridge'; });
  const review = await f.inspect();
  expect(review.fields).toHaveLength(5);
  expect(review.fields.find(field => field.id === 'applicant_summary')).toMatchObject({widget: true, occupied: false});
  expect(review.fields.find(field => field.id === 'applicant_email').occupied).toBe(true);
  expect(JSON.stringify(review)).not.toContain('already-private');
  expect(JSON.stringify(review)).not.toContain('platform-fixture-token');
  expect(JSON.stringify(review)).not.toContain('jpx_fixture');
  expect(JSON.stringify(review)).not.toContain('Private source text');
  expect(review).not.toHaveProperty('countryState');
  const approved = [
    {id: 'applicant_name', value: 'Fictional Applicant', confirmed: true},
    {id: 'applicant_summary', value: 'User summary\n<script>not executed</script>', confirmed: true},
    {id: 'applicant_countries', value: JSON.stringify({nationality: 'cn', campus: 'sg'}), confirmed: true},
  ];
  const result = await f.fill(review, approved);
  expect(result).toEqual({ok: true, filled: ['applicant_name', 'applicant_summary', 'applicant_countries'], skipped: [], reasons: {}, submitted: false});
  await expect(page.locator('#applicant_name')).toHaveValue('Parent untouched');
  await expect(f.frame.locator('#applicant_name')).toHaveValue('Fictional Applicant');
  await expect(f.frame.locator('#applicant_email')).toHaveValue('already-private@example.test');
  await expect(f.frame.locator('#editor')).toContainText('<script>not executed</script>');
  await expect(f.frame.locator('#applicant_nationality_code')).toHaveValue('cn');
  await expect(f.frame.locator('#applicant_campus_code')).toHaveValue('sg');
  await expect(f.frame.locator('#campus_same_nationality')).not.toBeChecked();
  await expect(f.frame.locator('#consent')).not.toBeChecked();
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
  await expect(f.fill(review, approved)).rejects.toThrow('already used');
  expect(f.writes).toHaveLength(2);
  expect(f.injections.filter(request => request.func === verifyPlatformApplication).every(request => request.world === 'ISOLATED'
    && request.target.tabId === 7 && request.target.documentIds[0] === 'parent-document')).toBe(true);
  expect(f.requests.every(request => request.url.startsWith(api + '/'))).toBe(true);
});

test('stale saved-profile preview, job mismatch, closed job and different account all fail before writing', async ({page}) => {
  const f = await setup(page);
  const oldHash = fingerprint(f.draft);
  f.draft.values.applicant_contact = 'Changed';
  await expect(f.handle({kind: 'application-inspect', version: 1, job_id: jobId, page_url: applicationUrl, profile_fingerprint: oldHash}, f.sender)).rejects.toThrow('Saved details changed');
  f.jobUrl = 'https://www.internsg.com/job-apply/999/';
  await expect(f.inspect()).rejects.toThrow('Could not verify');
  f.jobUrl = applicationUrl; f.jobActive = false;
  await expect(f.inspect()).rejects.toThrow('Could not verify');
  f.jobActive = true; f.platformUser = 'account-b';
  await expect(f.inspect()).rejects.toThrow('changed');
  expect(f.writes).toEqual([]);
});

test('profile changed or explicitly cleared after review prevents all old filling', async ({page}) => {
  const f = await setup(page);
  const review = await f.inspect();
  f.draft.values = {};
  await expect(f.fill(review, [{id: 'applicant_name', value: 'Old applicant', confirmed: true}])).rejects.toThrow('changed');
  expect(f.writes).toEqual([]);
  await expect(f.frame.locator('#applicant_name')).toHaveValue('');
});

test('identity change after first write stops later widget write and does not undo original filled answers', async ({page}) => {
  const f = await setup(page);
  const review = await f.inspect();
  f.afterWrite = () => page.evaluate(() => localStorage.setItem('jobpilot_token', 'replacement-platform-token'));
  await expect(f.fill(review, [
    {id: 'applicant_name', value: 'Confirmed before switch', confirmed: true},
    {id: 'applicant_summary', value: 'Must not be written afterwards', confirmed: true},
  ])).rejects.toThrow('Some confirmed answers may already be filled');
  await expect(f.frame.locator('#applicant_name')).toHaveValue('Confirmed before switch');
  await expect(f.frame.locator('#editor')).toHaveText('');
  expect(f.writes).toHaveLength(1);
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
});

test('user edits made after review are preserved and skipped reasons do not expose values', async ({page}) => {
  const f = await setup(page);
  const review = await f.inspect();
  await f.frame.locator('#applicant_name').fill('Private original edit');
  const result = await f.fill(review, [{id: 'applicant_name', value: 'Replacement attempt', confirmed: true}]);
  expect(result.skipped).toEqual(['applicant_name']);
  expect(result.reasons.applicant_name).toContain('occupied');
  expect(JSON.stringify(result)).not.toContain('Private original edit');
  await expect(f.frame.locator('#applicant_name')).toHaveValue('Private original edit');
});

test('a fill delayed in the background queue consumes its review without any late injection', async ({page}) => {
  const f = await setup(page);
  const review = await f.inspect();
  const before = f.injections.length;
  const message = {kind: 'application-fill', version: 1, job_id: jobId, page_url: applicationUrl, review_id: review.review_id,
    approved: [{id: 'applicant_name', value: 'Must not be written', confirmed: true}]};
  await expect(f.handle(message, f.sender, Date.now() - 1)).rejects.toThrow('timed out');
  expect(f.injections).toHaveLength(before);
  await expect(f.handle(message, f.sender)).rejects.toThrow('already used');
  await expect(f.frame.locator('#applicant_name')).toHaveValue('');
});

test('late adapter execution checks deadline inside the original document before writing', async ({page}) => {
  const f = await setup(page);
  const review = await f.inspect();
  const execute = f.chrome.scripting.executeScript;
  f.chrome.scripting.executeScript = request => {
    if (request.args?.[0] === 'fill') request = {...request, args: [...request.args.slice(0, 3), Date.now() - 1]};
    return execute(request);
  };
  await expect(f.fill(review, [{id: 'applicant_name', value: 'Must not be written', confirmed: true}])).rejects.toThrow('uncertain');
  await expect(f.frame.locator('#applicant_name')).toHaveValue('');
  expect(f.writes).toEqual([]);
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
});

test('SPA inspection trusts the current injected route rather than the cached sender URL path', async ({page}) => {
  const f = await setup(page);
  await page.evaluate(url => { history.pushState({}, '', '/jobs'); history.pushState({}, '', url); }, parentUrl);
  let review;
  for (const initialUrl of [`${site}/jobs`, `${site}/jobs?sort=new#recent`, `${site}/connect-extension#old-state`]) {
    f.sender.url = initialUrl;
    review = await f.inspect();
    expect(review.ok).toBe(true);
  }
  const checks = f.injections.filter(request => request.func === verifyPlatformApplication);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.every(request => request.args[0] === site && request.world === 'ISOLATED'
    && request.target.tabId === 7 && request.target.documentIds[0] === 'parent-document')).toBe(true);
  const result = await f.fill(review, [{id: 'applicant_name', value: 'Confirmed on the actual application route', confirmed: true}]);
  expect(result.filled).toEqual(['applicant_name']);
  expect(result.submitted).toBe(false);
  await expect(f.frame.locator('#applicant_name')).toHaveValue('Confirmed on the actual application route');
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
});

test('a trusted cached sender cannot authorize a wrong current route, job, query or fragment', async ({page}) => {
  const f = await setup(page);
  for (const currentUrl of [`${site}/profile`, `${site}/jobs/99999999-1234-1234-1234-123456789012/apply-external`,
    `${parentUrl}?override=1`, `${parentUrl}#different-context`]) {
    await page.evaluate(url => history.replaceState({}, '', url), currentUrl);
    await expect(f.inspect()).rejects.toThrow(/verify|application|changed/i);
  }
  expect(f.requests.some(request => request.url.endsWith('/users/me'))).toBe(false);
  expect(f.writes).toEqual([]);
});

test('route navigation while platform identity is being verified invalidates inspection', async ({page}) => {
  const f = await setup(page);
  f.sender.url = `${site}/jobs`;
  f.beforeApiReply = async url => {
    if (url.endsWith('/users/me')) {
      f.beforeApiReply = null;
      await page.evaluate(() => history.replaceState({}, '', '/profile'));
    }
  };
  await expect(f.inspect()).rejects.toThrow(/verify|application|changed/i);
  expect(f.writes).toEqual([]);
});

test('changing the actual route after review rejects fill even when sender URL remains unchanged', async ({page}) => {
  const f = await setup(page);
  f.sender.url = `${site}/jobs`;
  const review = await f.inspect();
  await page.evaluate(() => history.pushState({}, '', '/profile'));
  const approved = [{id: 'applicant_name', value: 'Must not fill after navigation', confirmed: true}];
  await expect(f.fill(review, approved)).rejects.toThrow(/verify|application|changed/i);
  await expect(f.fill(review, approved)).rejects.toThrow('already used');
  expect(f.writes).toEqual([]);
  await expect(f.frame.locator('#applicant_name')).toHaveValue('');
});

test('the full injected parent URL remains bound to the review, including a trailing-slash route change', async ({page}) => {
  const f = await setup(page);
  f.sender.url = `${site}/jobs`;
  const review = await f.inspect();
  await page.evaluate(url => history.pushState({}, '', url + '/'), parentUrl);
  await expect(f.fill(review, [{id: 'applicant_name', value: 'Must not reuse changed route review', confirmed: true}])).rejects.toThrow('changed');
  expect(f.writes).toEqual([]);
});

test('SPA navigation after a dispatched text fill stops later widget writes without undoing prior answers', async ({page}) => {
  const f = await setup(page);
  f.sender.url = `${site}/jobs`;
  const review = await f.inspect();
  f.afterWrite = () => page.evaluate(() => history.pushState({}, '', '/profile'));
  await expect(f.fill(review, [
    {id: 'applicant_name', value: 'Already confirmed and filled', confirmed: true},
    {id: 'applicant_summary', value: 'Must not fill after SPA navigation', confirmed: true},
  ])).rejects.toThrow('Some confirmed answers may already be filled');
  expect(f.writes).toHaveLength(1);
  await expect(f.frame.locator('#applicant_name')).toHaveValue('Already confirmed and filled');
  await expect(f.frame.locator('#editor')).toHaveText('');
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
});

test('a same-job trailing-slash redirect supports inspection and both fill adapters without changing the backend URL', async ({page}) => {
  const requestedUrl = applicationUrl.slice(0, -1);
  const f = await setup(page, {requestedUrl, redirectUrl: applicationUrl});
  expect(f.frame.url()).toBe(applicationUrl);
  await expect(page.locator('iframe')).toHaveAttribute('src', requestedUrl);
  const review = await f.inspect();
  expect(review.ok).toBe(true);
  expect(review.fields).toHaveLength(5);
  const result = await f.fill(review, [
    {id: 'applicant_name', value: 'Redirect fixture applicant', confirmed: true},
    {id: 'applicant_summary', value: 'Confirmed user-written summary', confirmed: true},
    {id: 'applicant_countries', value: JSON.stringify({nationality: 'cn', campus: 'sg'}), confirmed: true},
  ]);
  expect(result).toEqual({ok: true, filled: ['applicant_name', 'applicant_summary', 'applicant_countries'],
    skipped: [], reasons: {}, submitted: false});
  await expect(f.frame.locator('#applicant_name')).toHaveValue('Redirect fixture applicant');
  await expect(f.frame.locator('#editor')).toHaveText('Confirmed user-written summary');
  await expect(f.frame.locator('#applicant_nationality_code')).toHaveValue('cn');
  await expect(f.frame.locator('#applicant_campus_code')).toHaveValue('sg');
  await expect(f.frame.locator('#consent')).not.toBeChecked();
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
  const adapters = f.injections.filter(request => ['inspect', 'fill'].includes(request.args?.[0]));
  expect(adapters.length).toBeGreaterThan(0);
  expect(adapters.every(request => request.args[1] === applicationUrl)).toBe(true);
  const drafts = f.requests.filter(request => request.url.endsWith('/browser-assistant/draft') && request.method === 'POST');
  expect(drafts.length).toBeGreaterThan(0);
  expect(drafts.every(request => request.body.page_url === requestedUrl)).toBe(true);
  expect(f.jobUrl).toBe(requestedUrl);
});

for (const [kind, redirectUrl] of [
  ['different job', 'https://www.internsg.com/job-apply/999/'],
  ['different exact host', 'https://internsg.com/job-apply/123/'],
  ['query', `${applicationUrl}?override=1`],
  ['fragment', `${applicationUrl}#different-context`],
]) {
  test(`a redirect to a ${kind} is not accepted as trailing-slash canonicalization`, async ({page}) => {
    const f = await setup(page, {requestedUrl: applicationUrl.slice(0, -1), redirectUrl});
    await expect(f.inspect()).rejects.toThrow('Load exactly one ready InternSG form');
    expect(f.writes).toEqual([]);
    await expect(f.frame.locator('#applicant_name')).toHaveValue('');
    expect(await f.frame.evaluate(() => window.submits)).toBe(0);
  });
}

test('a new frame document reached through the same slash redirect cannot reuse an earlier review', async ({page}) => {
  const requestedUrl = applicationUrl.slice(0, -1);
  const f = await setup(page, {requestedUrl, redirectUrl: applicationUrl});
  const review = await f.inspect();
  await f.frame.goto(requestedUrl);
  await expect.poll(() => f.frame.url()).toBe(applicationUrl);
  // Chrome assigns a new document ID even when the new document ends at the same URL.
  f.childDocumentId = 'replacement-child-document';
  const approved = [{id: 'applicant_name', value: 'Must not enter a replacement document', confirmed: true}];
  await expect(f.fill(review, approved)).rejects.toThrow('changed');
  await expect(f.fill(review, approved)).rejects.toThrow('already used');
  expect(f.writes).toEqual([]);
  await expect(f.frame.locator('#applicant_name')).toHaveValue('');
});

test('even a same-document slash URL change after review invalidates the exact reviewed frame URL', async ({page}) => {
  const requestedUrl = applicationUrl.slice(0, -1);
  const f = await setup(page, {requestedUrl, redirectUrl: applicationUrl});
  const review = await f.inspect();
  await f.frame.evaluate(url => history.replaceState({}, '', url), requestedUrl);
  await expect(f.fill(review, [{id: 'applicant_name', value: 'Must not use a changed frame URL', confirmed: true}])).rejects.toThrow('changed');
  expect(f.writes).toEqual([]);
  await expect(f.frame.locator('#applicant_name')).toHaveValue('');
  expect(await f.frame.evaluate(() => window.submits)).toBe(0);
});
