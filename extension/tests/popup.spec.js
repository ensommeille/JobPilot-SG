import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
async function setup(page, {expired = false, unsupported = false, skipped = false, widgetsReady = false, embeddedAccess = true} = {}) {
  await page.addInitScript(({expired, unsupported, skipped, widgetsReady, embeddedAccess}) => {
    window.operations = []; window.drafts = []; window.stored = {}; window.atsCalls = [];
    window.embeddedAccess = embeddedAccess; window.permissionAllowed = true; window.permissionRequests = [];
    window.applicationUrl = 'https://www.internsg.com/job-apply/123';
    window.connect = email => {
      window.stored = {jobpilotSession: {api: 'http://localhost:8000', site: 'http://localhost:5173', token: 'jpx_fixture', userId: email, email}};
      window.storageListener({jobpilotSession: {newValue: window.stored.jobpilotSession}}, 'session');
    };
    window.chrome = {
      runtime: {id: 'a'.repeat(32), sendMessage: async () => ({ok: true})},
      permissions: {contains: async () => window.embeddedAccess,
        onAdded: {addListener: listener => { window.permissionsAdded = listener; }},
        onRemoved: {addListener: listener => { window.permissionsRemoved = listener; }},
        request: async request => {
          window.permissionRequests.push(request);
          if (request.origins.some(origin => origin.includes('internsg.com')) && window.permissionAllowed) window.embeddedAccess = true;
          return window.permissionAllowed;
        }},
      storage: {onChanged: {addListener: listener => { window.storageListener = listener; }}, local: {setAccessLevel: async () => {}, get: async () => window.localSaved || {}, set: async value => { window.localSaved = {...window.localSaved, ...value}; }, remove: async key => { delete window.localSaved?.[key]; }}, session: {setAccessLevel: async () => {}, get: async () => window.stored,
        set: async value => { window.stored = value; }, remove: async () => { window.stored = {}; }}},
      tabs: {query: async () => [{id: 7}]},
      scripting: {executeScript: async request => {
        if (request.func.name === 'interactWithATSPage') {
          window.atsCalls.push(request.args[0]);
          if (request.args[0].action === 'inspect') return [{documentId: 'ats-document', result: {
            provider: 'Lever', url: 'https://jobs.lever.co/acme/abc-123/apply',
            fields: [{id: 'full_name', available: true, occupied: false, maxLength: 200},
              {id: 'email', available: true, occupied: false, maxLength: 200},
              {id: 'phone', available: false, occupied: false, maxLength: 200}]}}];
          return [{documentId: 'ats-document', result: {filled: request.args[0].approved.map(item => item.id), skipped: [], submitted: false}}];
        }
        if (request.func.name === 'discoverApplication') {
          if (unsupported) throw new Error('Open an InternSG application page first.');
          return [{documentId: 'document-1', result: {mode: 'direct', url: window.applicationUrl}}];
        }
        if (request.func.name === 'submissionPage') {
          if (request.args[0] === 'review') return [{documentId: 'document-1', result: {url: 'https://www.internsg.com/job-apply/123', title: 'Fictional job', values: {Email: 'fictional@example.test', 'Application recipient': 'Fictional employer'}, fingerprint: 'a'.repeat(64), reviewedAt: Date.now(), captchaReady: true}}];
          if (request.args[0] === 'submit') {
            window.submitCalls = (window.submitCalls || 0) + 1;
            if (window.submissionOutcome === 'throw') throw new Error('Document navigated');
            return [{result: {state: window.submissionOutcome || 'click_attempted', reason: 'Answers changed.'}}];
          }
          return [{result: {state: 'unverified', messages: []}}];
        }
        if (request.world === 'MAIN') {
          if (request.args[0] === 'fill') { window.widgetFill = request.args; return [{result: {filled: request.args[2].map(x => x.id), skipped: [], reasons: {}, submitted: false}}]; }
          return [{documentId: 'document-1', result: {richReady: widgetsReady, countryState: widgetsReady ? {nationality: 'sg', campus: 'sg', same: true, nationalityText: 'Singapore', campusText: 'Singapore'} : null, countries: [{code: 'cn', name: 'China'}, {code: 'sg', name: 'Singapore'}], countryReason: 'Country widgets unavailable.'}}];
        }
        window.operations.push(request.args);
        if (unsupported) throw new Error('Open an InternSG application page first.');
        return [{documentId: 'document-1', result: request.args[0] === 'inspect'
          ? {url: window.applicationUrl, title: 'Fictional Intern', fields: [
            {id: 'applicant_name', label: 'Full name', maxLength: 200, occupied: false},
            {id: 'applicant_summary', label: 'Resume summary', maxLength: 3000, occupied: false}]}
          : {filled: request.args[2].map(x => x.id).filter(id => !skipped && !window.skippedIds?.includes(id)),
            skipped: request.args[2].map(x => x.id).filter(id => skipped || window.skippedIds?.includes(id)), submitted: false}}];
      }},
    };
    window.fetch = async (url, options) => {
      const payload = options.body ? JSON.parse(options.body) : {};
      if (window.offline) throw new Error('Network unavailable');
      if (window.expired) return new Response('', {status: 401});
      if (url.endsWith('/auth/extension/session')) return new Response(JSON.stringify({user_id: window.stored.jobpilotSession.userId}));
      window.drafts.push({url, payload});
      if (url.endsWith('/auth/login')) return new Response(JSON.stringify({access_token: 'fixture-token', user: {id: payload.email, email: payload.email}}));
      if (expired) return new Response('', {status: 401});
      if (url.endsWith('/profile/import-local')) {
        window.platformValues ||= {};
        const imported = [], skipped = [];
        for (const [key, value] of Object.entries(payload)) {
          if (key === 'confirmed') continue;
          if (window.platformValues[key]) skipped.push(key);
          else { window.platformValues[key] = value; imported.push(key); }
        }
        return new Response(JSON.stringify({imported, skipped}));
      }
      const profile = window.platformValues || {};
      return new Response(JSON.stringify({profile_source: 'jobpilot', countries: {nationality: profile.nationality, campus: profile.study_country}, values: {applicant_name: 'Fictional Applicant', applicant_summary: profile.resume_summary || '', applicant_period: profile.availability_period || ''}, summary_status: 'manual_only'}));
    };
  }, {expired, unsupported, skipped, widgetsReady, embeddedAccess});
  await page.route('https://popup.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (!['popup.html', 'popup.css', 'popup.js', 'ats-page.js', 'page.js', 'widgets.js', 'submission.js', 'frames.js', 'connection.js'].includes(name)) return route.abort();
    await route.fulfill({body: await readFile(path.join(root, name)), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'});
  });
  await page.goto('https://popup.test/popup.html');
}
async function login(page, email = 'fictional@example.test', {expand = true} = {}) {
  await page.getByRole('button', {name: 'Connect through JobPilot', exact: true}).click();
  await page.evaluate(email => window.connect(email), email);
  await expect(page.getByRole('link', {name: 'Open JobPilot'})).toBeVisible();
  if (expand) {
    await page.locator('#original-tools > summary').click();
    await page.locator('#advanced-submission > summary').click();
    await page.locator('#settings > summary').click();
  }
}

test('sign in, inspect, approve and fill without automatic model call', async ({page}) => {
  await setup(page); await login(page);
  await expect(page.locator('#password, #email')).toHaveCount(0);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  const fill = page.getByRole('button', {name: 'Fill application form', exact: true});
  await expect(fill).toBeEnabled();
  await fill.click();
  await expect(page.locator('#status')).toContainText('Nothing was submitted');
  const calls = await page.evaluate(() => window.drafts);
  expect(calls.some(c => c.payload.generate_summary)).toBe(false);
  const operations = await page.evaluate(() => window.operations);
  expect(operations[1][2]).toEqual([{id: 'applicant_name', value: 'Fictional Applicant', confirmed: true}]);
});

test('public ATS popup reviews profile before one fill and never submits', async ({page}) => {
  await setup(page); await login(page, 'fictional@example.test', {expand: false});
  await page.locator('#ats-tools > summary').click();
  await page.getByRole('button', {name: 'Read form & load saved details'}).click();
  await expect(page.locator('#ats-full_name')).toHaveValue('Fictional Applicant');
  await page.getByRole('button', {name: 'Fill reviewed fields only'}).click();
  await expect(page.locator('#ats-result')).toContainText('Nothing was submitted');
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect', 'fill']);
  expect(await page.evaluate(() => window.atsCalls[1].approved)).toEqual([
    {id: 'full_name', value: 'Fictional Applicant', confirmed: true},
  ]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});
test('the fill click approves the current edited answer without individual checkboxes or generation controls', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await page.getByLabel('Full name', {exact: true}).fill('Edited Applicant');
  await expect(page.locator('#fields input[type=checkbox]')).toHaveCount(0);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.operations.filter(x => x[0] === 'fill').length)).toBe(1);
  expect(await page.evaluate(() => window.operations.find(x => x[0] === 'fill')[2])).toEqual([{id: 'applicant_name', value: 'Edited Applicant', confirmed: true}]);
  await expect(page.locator('#generate, #ai-consent')).toHaveCount(0);
});
test('expired login clears session and form', async ({page}) => {
  await setup(page); await login(page);
  await page.evaluate(() => { window.expired = true; });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.locator('#status')).toContainText('Session expired');
  await expect(page.getByRole('button', {name: 'Connect through JobPilot', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.stored)).toEqual({});
});
test('unsupported page never requests profile draft', async ({page}) => {
  await setup(page, {unsupported: true}); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.locator('#status')).toContainText('Open an InternSG');
  expect((await page.evaluate(() => window.drafts)).length).toBe(0);
});
test('logout clears session and private draft', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await page.getByRole('button', {name: 'Disconnect'}).click();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.stored)).toEqual({});
});

test('revocation between review and fill prevents page writes', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.locator('#fill')).toBeEnabled();
  await page.evaluate(() => { window.expired = true; });
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.locator('#status')).toContainText('expired or revoked');
  expect(await page.evaluate(() => window.operations.some(x => x[0] === 'fill'))).toBe(false);
});

test('offline validation blocks sending an already reviewed application', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Review website answers before sending'}).click();
  await page.getByLabel('I reviewed this recipient', {exact: false}).check();
  await page.evaluate(() => { window.offline = true; });
  await page.getByRole('button', {name: 'Confirm & send this application'}).click();
  await expect(page.locator('#status')).toContainText('Network unavailable');
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});
test('partial fill preserves the skipped draft and marks successful fields without automatic retry', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await page.getByLabel('Resume summary', {exact: true}).fill('My skipped draft');
  await page.evaluate(() => { window.skippedIds = ['applicant_summary']; });
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.locator('#status')).toContainText('Filled 1. Skipped Resume summary');
  await expect(page.getByLabel('Full name', {exact: true})).toBeDisabled();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('My skipped draft');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeDisabled();
  expect(await page.evaluate(() => window.operations.filter(x => x[0] === 'fill').length)).toBe(1);
});
test('skipped fields preserve drafts and require review again', async ({page}) => {
  await setup(page, {skipped: true}); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.locator('#status')).toContainText('Skipped Full name');
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue('Fictional Applicant');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeDisabled();
});
test('manual summary editing and filling remain available', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await page.getByLabel('Resume summary', {exact: true}).fill('My reviewed manual summary.');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
});
test('capture disconnected, ready, permission and fallback states at the shipped popup width', async ({page}) => {
  await page.setViewportSize({width: 420, height: 700});
  await setup(page, {widgetsReady: true});
  await page.screenshot({path: '../output/popup-disconnected.png', fullPage: true});
  await login(page, undefined, {expand: false});
  await page.screenshot({path: '../output/popup-ready.png', fullPage: true});
  await page.evaluate(() => { window.embeddedAccess = false; window.permissionsRemoved({origins: ['https://www.internsg.com/*']}); });
  await expect(page.locator('#enable-embedded')).toBeVisible();
  await page.screenshot({path: '../output/popup-permission.png', fullPage: true});
  await page.locator('#enable-embedded').click();
  await expect(page.locator('#enable-embedded')).toBeHidden();
  await page.locator('#original-tools > summary').click();
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue('Fictional Applicant');
  await page.screenshot({path: '../output/popup-fallback.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('supplementary details are isolated by API and account and can be deleted', async ({page}) => {
  await setup(page); await login(page);
  await page.locator('#local-profile summary').click();
  await page.getByLabel('Availability period', {exact: true}).fill('January to March 2027');
  await page.getByLabel('Reusable summary (plain text)').fill('My local summary');
  await page.getByRole('button', {name: 'Save on this device'}).click();
  await expect(page.locator('#status')).toContainText('Device copy saved');
  const saved = await page.evaluate(() => window.localSaved);
  expect(Object.keys(saved)).toHaveLength(1);
  expect(Object.keys(saved)[0]).toContain('http://localhost:8000');
  await page.getByRole('button', {name: 'Disconnect'}).click();
  await login(page, 'other@example.test');
  await expect(page.getByLabel('Reusable summary (plain text)')).toHaveValue('');
  await page.getByRole('button', {name: 'Disconnect'}).click();
  await login(page);
  await expect(page.getByLabel('Reusable summary (plain text)')).toHaveValue('My local summary');
  await page.locator('#local-profile summary').click();
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('');
  await page.getByLabel('I confirm importing', {exact: false}).check();
  await page.getByRole('button', {name: 'Import reviewed details to JobPilot'}).click();
  await expect(page.locator('#status')).toContainText('Imported:');
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('My local summary');
  await page.getByRole('button', {name: 'Delete saved details'}).click();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.localSaved)).toEqual({});
});

test('platform values refresh across applications and cleared values never fall back to device', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'Platform introduction', nationality: 'cn', study_country: 'sg'}; });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('Platform introduction');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('cn');
  await expect(page.getByLabel('Country of study / graduation')).toHaveValue('sg');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  await page.locator('#local-profile summary').click();
  await page.getByLabel('Reusable summary (plain text)').fill('Old device introduction');
  await page.getByRole('button', {name: 'Save on this device'}).click();
  await page.getByLabel('I confirm importing', {exact: false}).check();
  await page.getByRole('button', {name: 'Import reviewed details to JobPilot'}).click();
  await expect(page.locator('#status')).toContainText('Preserved existing platform values: resume_summary');
  await page.evaluate(() => { window.platformValues = {}; });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('');
});

test('country defaults are not assumed and the fill click explicitly approves both selected countries', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('');
  await page.getByLabel('Nationality', {exact: true}).selectOption('cn');
  await page.getByLabel('Country of study / graduation').selectOption('sg');
  await expect(page.locator('#fields')).toContainText('will replace both website country selections');
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.locator('#status')).toContainText('Filled 2.');
  await expect(page.getByLabel('Nationality', {exact: true})).toBeDisabled();
  const operation = await page.evaluate(() => window.widgetFill);
  expect(operation[2][0].expectedState.nationality).toBe('sg');
  expect(JSON.parse(operation[2][0].value)).toEqual({nationality: 'cn', campus: 'sg'});
  await expect(page.getByLabel('Nationality', {exact: true})).toBeDisabled();
});

test('submission requires separate confirmation and blocks a second attempt', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Review website answers before sending'}).click();
  await expect(page.locator('#submission-values')).toContainText('Fictional employer');
  const send = page.getByRole('button', {name: 'Confirm & send this application'});
  await expect(send).toBeDisabled();
  await page.getByLabel('I reviewed this recipient', {exact: false}).check();
  await send.click();
  await expect(page.locator('#submission-status')).toContainText('delivery is unverified');
  expect(await page.evaluate(() => window.submitCalls)).toBe(1);
  const stored = await page.evaluate(() => window.localSaved);
  expect(JSON.stringify(Object.values(stored))).not.toContain('fictional@example.test');
  await page.getByRole('button', {name: 'Review website answers before sending'}).click();
  await expect(page.locator('#submission-status')).toContainText('retry is blocked');
  expect(await page.evaluate(() => window.submitCalls)).toBe(1);
});
test('known no-click releases reservation, unknown interruption retains it', async ({page}) => {
  await setup(page); await login(page);
  await page.evaluate(() => { window.submissionOutcome = 'not_clicked'; });
  const prepare = page.getByRole('button', {name: 'Review website answers before sending'});
  await prepare.click(); await page.getByLabel('I reviewed this recipient', {exact: false}).check();
  await page.getByRole('button', {name: 'Confirm & send this application'}).click();
  await expect(page.locator('#submission-status')).toContainText('Nothing was clicked');
  expect(await page.evaluate(() => Object.keys(window.localSaved))).toHaveLength(0);
  await page.evaluate(() => { window.submissionOutcome = 'throw'; });
  await prepare.click(); await page.getByLabel('I reviewed this recipient', {exact: false}).check();
  await page.getByRole('button', {name: 'Confirm & send this application'}).click();
  await expect(page.locator('#submission-status')).toContainText('outcome is unknown');
  expect(await page.evaluate(() => Object.keys(window.localSaved))).toHaveLength(1);
  await prepare.click(); await expect(page.locator('#submission-status')).toContainText('retry is blocked');
});

test('a delayed draft body cannot expose the previous account after reconnecting', async ({page}) => {
  await setup(page); await login(page);
  await page.evaluate(() => {
    window.platformValues = {resume_summary: 'Private account A introduction'};
    const fetcher = window.fetch;
    window.fetch = async (url, options) => {
      const response = await fetcher(url, options);
      if (!url.endsWith('/browser-assistant/draft')) return response;
      const value = await response.json();
      return {ok: true, status: 200, json: () => new Promise(resolve => { window.releaseOldDraft = () => resolve(value); })};
    };
  });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseOldDraft)).toBe('function');
  await page.evaluate(() => window.connect('account-b@example.test'));
  await expect(page.locator('#account')).toContainText('account-b@example.test');
  await page.evaluate(() => window.releaseOldDraft());
  await expect(page.locator('#inspect')).toBeEnabled();
  await expect(page.locator('#fields')).toBeEmpty();
  await expect(page.locator('#status')).not.toContainText('Loaded your JobPilot profile');
  await expect(page.locator('#account')).toContainText('account-b@example.test');
});

test('account switch stops later widget writes after a normal fill was already dispatched', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'Account A introduction'}; });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('Account A introduction');
  await page.evaluate(() => {
    const execute = window.chrome.scripting.executeScript;
    window.chrome.scripting.executeScript = async request => {
      const result = await execute(request);
      if (request.func.name === 'interactWithPage' && request.args[0] === 'fill') {
        await new Promise(resolve => { window.releaseNormalFill = resolve; });
      }
      return result;
    };
  });
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseNormalFill)).toBe('function');
  await page.evaluate(() => window.connect('account-b@example.test'));
  await expect(page.locator('#account')).toContainText('account-b@example.test');
  await page.evaluate(() => window.releaseNormalFill());
  await expect(page.locator('#inspect')).toBeEnabled();
  expect(await page.evaluate(() => window.operations.filter(x => x[0] === 'fill'))).toHaveLength(1);
  expect(await page.evaluate(() => window.widgetFill)).toBeUndefined();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('a late website review cannot restore submission confirmation after sign-out', async ({page}) => {
  await setup(page); await login(page);
  await page.evaluate(() => {
    const execute = window.chrome.scripting.executeScript;
    window.chrome.scripting.executeScript = async request => {
      const result = await execute(request);
      if (request.func.name === 'submissionPage' && request.args[0] === 'review') {
        await new Promise(resolve => { window.releaseReview = resolve; });
      }
      return result;
    };
  });
  await page.getByRole('button', {name: 'Review website answers before sending'}).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseReview)).toBe('function');
  await page.evaluate(() => {
    window.stored = {};
    window.storageListener({jobpilotSession: {newValue: undefined}}, 'session');
    window.releaseReview();
  });
  await expect(page.getByRole('button', {name: 'Connect through JobPilot', exact: true})).toBeEnabled();
  await expect(page.locator('#submission-preview')).toBeHidden();
  await expect(page.locator('#submission-values')).toBeEmpty();
  await expect(page.locator('#send-application')).toBeDisabled();
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('sign-out while reserving an attempt stops before dispatch and releases the unused reservation', async ({page}) => {
  await setup(page); await login(page);
  await page.getByRole('button', {name: 'Review website answers before sending'}).click();
  await page.getByLabel('I reviewed this recipient', {exact: false}).check();
  await page.evaluate(() => {
    const save = window.chrome.storage.local.set;
    window.chrome.storage.local.set = async value => {
      await save(value);
      if (Object.keys(value).some(key => key.startsWith('jobpilotAttempt:'))) {
        await new Promise(resolve => { window.releaseReservation = resolve; });
      }
    };
  });
  await page.getByRole('button', {name: 'Confirm & send this application'}).click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseReservation)).toBe('function');
  await page.evaluate(() => {
    window.stored = {};
    window.storageListener({jobpilotSession: {newValue: undefined}}, 'session');
    window.releaseReservation();
  });
  await expect(page.getByRole('button', {name: 'Connect through JobPilot', exact: true})).toBeEnabled();
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
  expect(await page.evaluate(() => Object.keys(window.localSaved))).toHaveLength(0);
  await expect(page.locator('#submission-preview')).toBeHidden();
});

test('profile updates and explicit clearing are reloaded for a different job without local fallback', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'First introduction', nationality: 'cn', study_country: 'sg'}; });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('First introduction');
  await expect(page.locator('#status')).toContainText('After changing your platform profile');
  await page.evaluate(() => {
    window.applicationUrl = 'https://www.internsg.com/job-apply/456';
    window.platformValues = {resume_summary: 'Updated introduction', nationality: 'sg', study_country: 'sg'};
  });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.locator('#target')).toContainText('/456');
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('Updated introduction');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('sg');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  await page.evaluate(() => {
    window.applicationUrl = 'https://www.internsg.com/job-apply/789';
    window.platformValues = {resume_summary: '', nationality: null, study_country: null};
    window.localSaved = {'jobpilotProfile:["http://localhost:8000","fictional@example.test"]': {summary: 'Old device introduction', countries: {nationality: 'cn', campus: 'sg'}}};
  });
  await page.getByRole('button', {name: 'Read page & load profile'}).click();
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('');
  const drafts = await page.evaluate(() => window.drafts.filter(x => x.url.endsWith('/browser-assistant/draft')));
  expect(drafts.map(x => x.payload.page_url)).toEqual(['123', '456', '789'].map(id => `https://www.internsg.com/job-apply/${id}`));
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('default popup exposes only connection or platform navigation and never reads or fills a form', async ({page}) => {
  await setup(page);
  await expect(page.locator('button:visible')).toHaveCount(1);
  await expect(page.locator('#platform')).toBeHidden();
  await expect(page.locator('#extension-id')).toBeHidden();
  await login(page, undefined, {expand: false});
  await expect(page.locator('button:visible')).toHaveCount(0);
  await expect(page.locator('a.primary-action:visible')).toHaveCount(1);
  await expect(page.locator('#open-jobpilot')).toHaveAttribute('href', 'http://localhost:5173/jobs');
  await expect(page.locator('#original-tools')).not.toHaveAttribute('open');
  await expect(page.locator('#settings')).not.toHaveAttribute('open');
  await expect(page.locator('#embedded-status')).toContainText('Ready for InternSG');
  expect(await page.evaluate(() => window.operations)).toEqual([]);
  expect(await page.evaluate(() => window.drafts)).toEqual([]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('missing permission can be denied, granted and revoked without automatic page actions', async ({page}) => {
  await setup(page, {embeddedAccess: false});
  await login(page, undefined, {expand: false});
  await expect(page.locator('button:visible')).toHaveCount(1);
  const enable = page.getByRole('button', {name: 'Enable embedded InternSG access'});
  await page.evaluate(() => { window.permissionAllowed = false; });
  await enable.click();
  await expect(page.locator('#status')).toContainText('not granted');
  await expect(enable).toBeVisible();
  await page.evaluate(() => { window.permissionAllowed = true; });
  await enable.click();
  await expect(enable).toBeHidden();
  await expect(page.locator('#embedded-status')).toContainText('Ready for InternSG');
  expect(await page.evaluate(() => window.permissionRequests.at(-1))).toEqual({origins: [
    'https://www.internsg.com/*', 'https://internsg.com/*', 'http://localhost:5173/*',
  ]});
  await page.evaluate(() => { window.embeddedAccess = false; window.permissionsRemoved({origins: ['https://www.internsg.com/*']}); });
  await expect(enable).toBeVisible();
  await expect(page.locator('#embedded-status')).toContainText('access is needed');
  expect(await page.evaluate(() => window.operations)).toEqual([]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('permission revocation invalidates an open fallback review instead of retaining a fill action', async ({page}) => {
  await setup(page); await login(page);
  await page.locator('#inspect').click();
  await expect(page.locator('#fill')).toBeEnabled();
  await page.evaluate(() => { window.embeddedAccess = false; window.permissionsRemoved({origins: ['https://www.internsg.com/*']}); });
  await expect(page.locator('#fields')).toBeEmpty();
  await expect(page.locator('#fill')).toBeDisabled();
  expect(await page.evaluate(() => window.operations.filter(item => item[0] === 'fill'))).toEqual([]);
});

test('one click captures text and countries before asynchronous validation and never approves later edits', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'Reviewed summary', nationality: 'cn', study_country: 'sg'}; });
  await page.locator('#inspect').click();
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('cn');
  await page.evaluate(() => {
    const fetcher = window.fetch;
    window.fetch = async (url, options) => {
      if (url.endsWith('/auth/extension/session')) await new Promise(resolve => { window.releaseFillValidation = resolve; });
      return fetcher(url, options);
    };
  });
  await page.locator('#fill').click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseFillValidation)).toBe('function');
  await expect(page.getByLabel('Full name', {exact: true})).toBeDisabled();
  await expect(page.getByLabel('Nationality', {exact: true})).toBeDisabled();
  await page.evaluate(() => {
    document.getElementById('edit-applicant_name').value = 'Unreviewed later edit';
    const nationality = document.getElementById('country-nationality');
    nationality.value = 'sg'; nationality.dispatchEvent(new Event('change'));
    window.releaseFillValidation();
  });
  await expect(page.locator('#status')).toContainText('Nothing was submitted');
  expect(await page.evaluate(() => window.operations.find(item => item[0] === 'fill')[2])).toEqual([
    {id: 'applicant_name', value: 'Fictional Applicant', confirmed: true},
  ]);
  const countries = await page.evaluate(() => window.widgetFill[2].find(item => item.id === 'applicant_countries'));
  expect(JSON.parse(countries.value)).toEqual({nationality: 'cn', campus: 'sg'});
  expect(countries.expectedState.nationality).toBe('sg');
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('missing country selections stay skipped and original occupied fields have no replacement editor', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => {
    const execute = window.chrome.scripting.executeScript;
    window.chrome.scripting.executeScript = async request => {
      const result = await execute(request);
      if (request.func.name === 'interactWithPage' && request.args[0] === 'inspect') result[0].result.fields[0].occupied = true;
      return result;
    };
    window.platformValues = {resume_summary: 'My introduction'};
  });
  await page.locator('#inspect').click();
  await expect(page.locator('#edit-applicant_name')).toHaveCount(0);
  await expect(page.locator('#fields')).toContainText('Already filled on the website');
  await page.getByLabel('Nationality', {exact: true}).selectOption('cn');
  await expect(page.locator('#fields')).toContainText('Incomplete country details are skipped');
  await page.locator('#fill').click();
  await expect(page.locator('#status')).toContainText('Nothing was submitted');
  expect(await page.evaluate(() => window.widgetFill[2].map(item => item.id))).toEqual(['applicant_summary']);
  expect(await page.evaluate(() => window.operations.filter(item => item[0] === 'fill'))).toEqual([]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('interrupted dispatched fills keep the draft, warn about partial changes and cannot retry the same review', async ({page}) => {
  await setup(page); await login(page);
  await page.locator('#inspect').click();
  await expect(page.locator('#fill')).toBeEnabled();
  await page.evaluate(() => {
    const execute = window.chrome.scripting.executeScript;
    window.chrome.scripting.executeScript = async request => {
      const result = await execute(request);
      if (request.func.name === 'interactWithPage' && request.args[0] === 'fill') throw new Error('Document navigated');
      return result;
    };
  });
  await page.locator('#fill').click();
  await expect(page.locator('#status')).toContainText('Some answers may already be filled');
  await expect(page.locator('#status')).toContainText('will not retry automatically');
  await expect(page.locator('#fill')).toBeDisabled();
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue('Fictional Applicant');
  expect(await page.evaluate(() => window.operations.filter(item => item[0] === 'fill'))).toHaveLength(1);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('malformed fill reports never claim success or trigger a second fill', async ({page}) => {
  await setup(page); await login(page);
  await page.evaluate(() => {
    const execute = window.chrome.scripting.executeScript;
    window.chrome.scripting.executeScript = async request => {
      const result = await execute(request);
      if (request.func.name === 'interactWithPage' && request.args[0] === 'fill') result[0].result = window.invalidReport;
      return result;
    };
  });
  for (const invalidReport of [
    {filled: [], skipped: [], submitted: false},
    {filled: ['applicant_name', 'applicant_name'], skipped: [], submitted: false},
    {filled: ['unknown_field'], skipped: [], submitted: false},
    {filled: ['applicant_name'], skipped: [], submitted: true},
    {filled: ['applicant_name'], skipped: []},
    {filled: ['applicant_name'], skipped: [], submitted: 'false'},
  ]) {
    await page.locator('#inspect').click();
    await expect(page.locator('#fill')).toBeEnabled();
    await page.evaluate(report => { window.invalidReport = report; }, invalidReport);
    await page.locator('#fill').click();
    await expect(page.locator('#status')).toContainText('Some answers may already be filled');
    await expect(page.locator('#status')).not.toContainText('Filled 1');
    await expect(page.locator('#fill')).toBeDisabled();
  }
  expect(await page.evaluate(() => window.operations.filter(item => item[0] === 'fill'))).toHaveLength(6);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});
