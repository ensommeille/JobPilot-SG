import {test, expect, chromium} from '@playwright/test';
import {copyFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';

test.skip(process.env.PLAYWRIGHT_NATIVE_EXTENSION !== '1',
  'Opt-in native extension probe requires the full Playwright Chromium binary, not headless shell.');

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/application-sender/', import.meta.url));
const site = 'http://127.0.0.1:5173';
const api = 'http://127.0.0.1:8001';
const jobId = '12345678-1234-4123-8123-1234567890ab';
const parentUrl = `${site}/jobs/${jobId}/apply-external`;
const applicationUrl = 'https://www.internsg.com/job-apply/271036/';
const fieldIds = ['applicant_name', 'applicant_email', 'applicant_contact', 'applicant_period', 'applicant_summary'];
const draft = {
  values: {applicant_name: 'Fictional Sender Applicant', applicant_email: 'sender@example.test',
    applicant_contact: '80000000', applicant_period: 'January 2027', applicant_summary: 'User-written fixture introduction.'},
  countries: {nationality: 'cn', campus: 'sg'},
};
const fingerprint = createHash('sha256').update(JSON.stringify({
  values: Object.fromEntries(fieldIds.map(id => [id, draft.values[id]])), countries: draft.countries,
})).digest('hex');

async function setup(testInfo) {
  const extensionPath = testInfo.outputPath('sender-fixture-extension');
  await mkdir(extensionPath, {recursive: true});
  for (const file of ['manifest.json', 'background.js']) await copyFile(path.join(fixture, file), path.join(extensionPath, file));
  for (const file of ['application-bridge.js', 'connection.js', 'page.js', 'widgets.js']) {
    await copyFile(path.join(root, file), path.join(extensionPath, file));
  }
  // Empty userDataDir creates a disposable Playwright profile, never the user's Chrome profile.
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'],
    proxy: {server: 'http://127.0.0.1:9', bypass: '<-loopback>'},
  });
  try {
  const requests = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({url: url.href, method: request.method()});
    if (url.origin === api) {
      const headers = {'Access-Control-Allow-Origin': site, 'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'};
      if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
      expect(request.headers().authorization).toBe('Bearer fictional_sender_platform_token');
      const body = url.pathname === '/users/me' ? {id: 'fictional-sender-account'}
        : url.pathname === `/jobs/${jobId}` ? {id: jobId, status: 'active', apply_url: applicationUrl}
          : url.pathname === '/browser-assistant/draft' ? draft : null;
      expect(body, `Unexpected fixture API path ${url.pathname}`).not.toBeNull();
      return route.fulfill({json: body, headers});
    }
    if (url.origin === site) return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated SPA sender fixture</title><h1>Fixture only</h1>'});
    if (url.href === applicationUrl && request.method() === 'GET') {
      expect(request.headers().authorization).toBeUndefined();
      return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated application fixture</title><form method="post"><label>Full name<input id="applicant_name" name="applicant_name"></label><label>Availability<input id="applicant_period" name="applicant_period"></label></form>'});
    }
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`${site}/jobs`);
  await page.evaluate(() => localStorage.setItem('jobpilot_token', 'fictional_sender_platform_token'));
  const message = payload => page.evaluate(({extensionId, payload}) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(extensionId, payload, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  }), {extensionId, payload});
  const navigateToApplication = async () => {
    await page.evaluate(({parentUrl, applicationUrl}) => {
      history.pushState({}, '', parentUrl);
      const frame = document.createElement('iframe');
      frame.dataset.jobpilotInternsg = ''; frame.src = applicationUrl;
      document.body.append(frame);
    }, {parentUrl, applicationUrl});
    await expect(page.frameLocator('iframe').locator('#applicant_name')).toBeVisible();
  };
  const inspect = () => message({kind: 'application-inspect', version: 1, job_id: jobId,
    page_url: applicationUrl, profile_fingerprint: fingerprint});
  return {context, page, message, navigateToApplication, inspect, requests};
  } catch (error) {
    await context.close();
    throw error;
  }
}

test('native external messaging across SPA navigation uses the current isolated route for production inspect and fill', async ({}, testInfo) => {
  test.setTimeout(45000);
  const f = await setup(testInfo);
  try {
    const before = await f.message({kind: 'fixture-observe'});
    expect(before.observed.currentUrl).toBe(`${site}/jobs`);
    await f.navigateToApplication();
    const inspected = await f.inspect();
    console.log('Native MessageSender evidence:', JSON.stringify({before: before.observed, after: inspected.observed}));
    await testInfo.attach('native-sender-evidence', {body: JSON.stringify({before: before.observed, after: inspected.observed}, null, 2), contentType: 'application/json'});
    expect(inspected.fixtureError).toBeUndefined();
    expect(inspected.observed.currentUrl).toBe(parentUrl);
    expect(inspected.observed.documentId).toBe(before.observed.documentId);
    expect(inspected.observed.frameId).toBe(0);
    expect(inspected.observed.origin).toBe(site);
    // Browser versions may update sender.url; either way, it is not the route authority.
    expect([`${site}/jobs`, parentUrl]).toContain(inspected.observed.senderUrl);
    expect(inspected.result).toMatchObject({ok: true, version: 1});
    expect(inspected.result.fields.find(field => field.id === 'applicant_name')).toMatchObject({occupied: false});
    const filled = await f.message({kind: 'application-fill', version: 1, job_id: jobId, page_url: applicationUrl,
      review_id: inspected.result.review_id, approved: [{id: 'applicant_name', value: draft.values.applicant_name, confirmed: true}]});
    expect(filled.result).toEqual({ok: true, filled: ['applicant_name'], skipped: [], reasons: {}, submitted: false});
    await expect(f.page.frameLocator('iframe').locator('#applicant_name')).toHaveValue(draft.values.applicant_name);
    expect(f.requests.filter(request => request.url === applicationUrl && request.method !== 'GET')).toHaveLength(0);
  } finally { await f.context.close(); }
});

test('native external messaging cannot reuse an application review after SPA navigation away', async ({}, testInfo) => {
  test.setTimeout(45000);
  const f = await setup(testInfo);
  try {
    await f.navigateToApplication();
    const inspected = await f.inspect();
    expect(inspected.result).toMatchObject({ok: true});
    await f.page.evaluate(() => history.pushState({}, '', '/profile'));
    const rejected = await f.message({kind: 'application-fill', version: 1, job_id: jobId, page_url: applicationUrl,
      review_id: inspected.result.review_id, approved: [{id: 'applicant_name', value: draft.values.applicant_name, confirmed: true}]});
    expect(rejected.observed.currentUrl).toBe(`${site}/profile`);
    expect(rejected.result.ok).toBe(false);
    expect(rejected.result.error).toMatch(/changed|verify|inspect/i);
    await expect(f.page.frameLocator('iframe').locator('#applicant_name')).toHaveValue('');
    expect(f.requests.filter(request => request.url === applicationUrl && request.method !== 'GET')).toHaveLength(0);
  } finally { await f.context.close(); }
});
