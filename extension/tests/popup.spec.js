import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
async function setup(page, {expired = false, unsupported = false, skipped = false, widgetsReady = false, embeddedAccess = true} = {}) {
  await page.addInitScript(({expired, unsupported, skipped, widgetsReady, embeddedAccess}) => {
    window.operations = []; window.drafts = []; window.stored = {}; window.atsCalls = []; window.grant = 0;
    window.embeddedAccess = embeddedAccess; window.permissionAllowed = true; window.permissionRequests = [];
    window.applicationUrl = 'https://www.internsg.com/job-apply/123';
    window.connect = email => {
      window.stored = {jobpilotSession: {api: 'http://localhost:8000', site: 'http://localhost:5173', token: 'jpx_fixture_' + (++window.grant), userId: email, email}};
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
      tabs: {query: async () => [{id: 7, url: window.activeUrl}]},
      scripting: {executeScript: async request => {
        if (request.func.name === 'popupDocumentBinding') return [{documentId: request.target.documentIds[0], result: {url: request.args[0]}}];
        if (request.func.name === 'interactWithATSPage') {
          window.atsCalls.push(request.args[0]);
          if (request.args[0].action === 'inspect') return [{documentId: 'ats-document', result: {
            provider: window.activeUrl?.includes('greenhouse.io') ? 'Greenhouse' : 'Lever',
            url: window.activeUrl || 'https://jobs.lever.co/acme/abc-123/apply',
            fields: window.atsFields || [{id: 'full_name', key: 'name:name', label: 'Full name', kind: 'text', evidenceKey: 'full_name', available: true, occupied: false, maxLength: 200},
              {id: 'email', key: 'name:email', label: 'Email', kind: 'text', evidenceKey: 'contact_email', available: true, occupied: false, maxLength: 200},
              {id: 'phone', key: 'name:phone', label: 'Phone', kind: 'text', evidenceKey: 'phone', available: false, occupied: false, maxLength: 200},
              {id: 'custom:0', kind: 'text', label: 'LinkedIn Profile', key: 'name:urls[LinkedIn]', evidenceKey: 'linkedin', available: true, occupied: false, maxLength: 2000}],
            manualQuestions: ['Why this company?'], resumeTarget: window.atsResumeTarget || null}}];
          if (request.args[0].action === 'attach') return [{documentId: 'ats-document', result: {submitted: false, selected: true, upload_status: 'selected_on_form', filename: request.args[0].file.name, sha256: request.args[0].file.sha256}}];
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
      const facts = () => {
        const values = {full_name: 'Fictional Applicant', linkedin: 'https://www.linkedin.com/in/fictional', ...(window.platformValues || {})};
        for (const key of Object.keys(values)) if (typeof values[key] !== 'string' || !values[key]) delete values[key];
        return window.autofillProfile || {values, sources: Object.fromEntries(Object.keys(values).map(key => [key, {source: 'profile', quote: null, resume_id: null}])),
          missing_fields: [], resume: null, resumes: [], requires_resume_selection: false, extraction_status: 'no_resume', fingerprint: JSON.stringify(values)};
      };
      if (url.endsWith('/browser-assistant/autofill-profile')) return new Response(JSON.stringify(facts()));
      if (url.endsWith('/browser-assistant/form-plan')) return new Response(JSON.stringify({mappings: window.planMappings || [], execution_mode: 'not_needed', reused: false, profile_fingerprint: facts().fingerprint}));
      if (url.endsWith('/browser-assistant/resume-content')) {
        const resume = facts().resume, bytes = '%PDF-1.4\nfictional UI fixture';
        return new Response(JSON.stringify({resume_id: resume.id, page_url: payload.page_url, filename: resume.filename,
          sha256: resume.sha256, base64: btoa(bytes), size_bytes: bytes.length}));
      }

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
      throw new Error('Unexpected popup fixture API: ' + url);
    };
  }, {expired, unsupported, skipped, widgetsReady, embeddedAccess});
  await page.route('https://popup.test/**', async route => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (!['popup.html', 'popup.css', 'popup.js', 'popup-autoload.js', 'popup-review.js', 'ats-page.js', 'page.js', 'widgets.js', 'submission.js', 'frames.js', 'connection.js'].includes(name)) return route.abort();
    await route.fulfill({body: await readFile(path.join(root, name)), contentType: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html'});
  });
  await page.goto('https://popup.test/popup.html');
}
async function login(page, email = 'fictional@example.test', {expand = true} = {}) {
  await page.getByRole('button', {name: 'Connect through JobPilot', exact: true}).click();
  await page.evaluate(email => {
    // Connection itself explicitly requests platform access. From the completed
    // grant onward, automatic previewing must request no new permissions.
    window.permissionRequests = [];
    window.connect(email);
  }, email);
  await expect(page.getByRole('link', {name: 'Open JobPilot'})).toBeVisible();
  await expect(page.locator('#open-jobpilot')).toHaveAttribute('href', 'http://localhost:5173/jobs');
  if (expand) {
    await openDetails(page, '#original-tools');
    await openDetails(page, '#settings');
  }
}

async function openDetails(page, selector) {
  if (!await page.locator(selector).evaluate(node => node.open)) await page.locator(selector + ' > summary').click();
}
// A new mock connection grant exercises the real restore/automatic-load entrypoint.
// Do not dispatch a hidden Refresh click: these cases also cover current-tab changes.
async function connectApplication(page, tool = 'internsg') {
  const keepSettingsOpen = await page.locator('#settings').evaluate(node => node.open);
  const keepDeviceDetailsOpen = await page.locator('#local-profile').evaluate(node => node.open);
  const expired = await page.evaluate(tool => {
    window.activeUrl = tool === 'ats' ? 'https://jobs.lever.co/acme/abc-123/apply' : window.applicationUrl;
    window.connect(window.stored.jobpilotSession.email);
    return !!window.expired;
  }, tool);
  if (!expired) {
    await expect(page.locator(tool === 'ats' ? '#ats-tools' : '#original-tools')).toHaveAttribute('open');
    if (keepSettingsOpen) await openDetails(page, '#settings');
    if (keepDeviceDetailsOpen) await openDetails(page, '#local-profile');
  }
}

test('opening a supported InternSG application loads saved answers and needs only a Fill click', async ({page}) => {
  await setup(page);
  await page.evaluate(() => { window.activeUrl = window.applicationUrl; });
  await login(page);
  await expect(page.locator('#password, #email')).toHaveCount(0);
  await expect(page.locator('#inspect')).toBeHidden();
  const fill = page.getByRole('button', {name: 'Fill application form', exact: true});
  await expect(fill).toBeEnabled();
  expect(await page.evaluate(() => window.operations.map(call => call[0]))).toEqual(['inspect']);
  expect(await page.evaluate(() => window.permissionRequests)).toEqual([]);
  expect(await page.evaluate(() => window.drafts.every(call => call.url.endsWith('/autofill-profile')))).toBe(true);
  await fill.click();
  await expect(page.locator('#status')).toContainText('Nothing was submitted');
  const calls = await page.evaluate(() => window.drafts);
  expect(calls.some(c => c.payload.generate_summary)).toBe(false);
  const operations = await page.evaluate(() => window.operations);
  expect(operations[1][2]).toEqual([{id: 'applicant_name', value: 'Fictional Applicant', confirmed: true}]);
});

test('public ATS popup authorizes the edited preview in one click without per-answer checkboxes', async ({page}) => {
  await setup(page);
  await page.evaluate(() => { window.activeUrl = 'https://jobs.lever.co/acme/abc-123/apply'; });
  await login(page, 'fictional@example.test', {expand: false});
  await expect(page.locator('#ats-full_name')).toHaveValue('Fictional Applicant');
  await expect(page.locator('#ats-inspect')).toBeHidden();
  expect(await page.evaluate(() => window.permissionRequests)).toEqual([]);
  expect(await page.evaluate(() => window.drafts.every(call => call.url.endsWith('/autofill-profile')))).toBe(true);
  await expect(page.locator('[id="ats-custom:0"]')).toHaveValue('https://www.linkedin.com/in/fictional');
  await expect(page.locator('#ats-fields input[type=checkbox]')).toHaveCount(0);
  await expect(page.locator('#ats-manual > summary')).toContainText('Other fields to check (2)');
  await expect(page.locator('#ats-manual')).not.toHaveAttribute('open');
  await page.locator('#ats-manual > summary').click();
  await expect(page.locator('#ats-manual')).toContainText('Why this company?');
  await expect(page.locator('#ats-manual')).toContainText('This scan is partial.');
  await page.locator('[id="ats-custom:0"]').fill('https://www.linkedin.com/in/edited');
  await expect(page.locator('#ats-fill')).toBeEnabled();
  await page.locator('#ats-fill').click();
  await expect(page.locator('#ats-result')).toContainText('Nothing was submitted');
  await expect(page.locator('#ats-fill')).toBeDisabled();
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect', 'fill']);
  expect(await page.evaluate(() => window.atsCalls[1].approved)).toEqual([
    {id: 'full_name', value: 'Fictional Applicant', confirmed: true, kind: 'text', key: 'name:name', label: 'Full name', evidenceKey: 'full_name', factKey: 'full_name'},
    {id: 'custom:0', value: 'https://www.linkedin.com/in/edited', confirmed: true, kind: 'text',
      key: 'name:urls[LinkedIn]', label: 'LinkedIn Profile', evidenceKey: 'linkedin', factKey: 'linkedin'},
  ]);
  expect(await page.evaluate(() => window.drafts.some(call => call.url.includes('generate')))).toBe(false);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('a failed automatic facts read offers one free Refresh action without filling or attaching', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    window.activeUrl = 'https://jobs.lever.co/acme/abc-123/apply';
    window.failFacts = true;
    const fetcher = window.fetch;
    window.fetch = (url, options) => {
      if (url.endsWith('/browser-assistant/autofill-profile') && window.failFacts) throw new Error('Saved answers unavailable');
      return fetcher(url, options);
    };
  });
  await login(page, undefined, {expand: false});
  const refresh = page.getByRole('button', {name: 'Refresh form', exact: true});
  await expect(page.locator('#status')).toContainText('Saved answers unavailable');
  await expect(page.locator('#ats-inspect')).toBeVisible();
  await expect(page.locator('#ats-fill')).toBeDisabled();
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect']);
  await page.evaluate(() => { window.failFacts = false; });
  await refresh.click();
  await expect(page.locator('#ats-full_name')).toHaveValue('Fictional Applicant');
  await expect(page.locator('#ats-inspect')).toBeHidden();
  await expect(page.locator('#ats-fill')).toBeEnabled();
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect', 'inspect']);
  expect(await page.evaluate(() => window.drafts.every(call => call.url.endsWith('/autofill-profile')))).toBe(true);
  expect(await page.evaluate(() => window.permissionRequests)).toEqual([]);
});

test('saved async search candidates load for free while personal questions never enter a plan or Fill', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await page.evaluate(() => {
    window.platformValues = {school: 'National University of Singapore'};
    window.atsFields = [
      {id: 'school', key: 'id:school', label: 'School', kind: 'combobox', evidenceKey: null, available: true, occupied: false,
        searchable: true, needsMapping: true, maxLength: 3000, options: [{value: 'Other initial school', label: 'Other initial school'}]},
      {id: 'personal', key: 'id:personal', label: 'Work authorization', kind: 'text', evidenceKey: null,
        available: false, occupied: false, manualOnly: true, needsMapping: true, manualReason: 'This declaration or sensitive question must be answered on the original website.'},
    ];
  });
  await connectApplication(page, 'ats');
  await expect(page.locator('#ats-school')).toHaveJSProperty('tagName', 'INPUT');
  await expect(page.locator('#ats-school')).toHaveValue('National University of Singapore');
  await expect(page.locator('#ats-personal')).toHaveCount(0);
  const plans = await page.evaluate(() => window.drafts.filter(call => call.url.endsWith('/form-plan')));
  expect(plans).toHaveLength(0);
  await page.locator('#ats-fill').click();
  await expect(page.locator('#ats-result')).toContainText('Filled 1');
  await expect(page.locator('#ats-counts')).toContainText('0 ready');
  await expect(page.locator('#ats-counts')).toContainText('1 already filled');
  expect(await page.evaluate(() => window.atsCalls.find(call => call.action === 'fill').approved)).toEqual([
    {id: 'school', key: 'id:school', label: 'School', kind: 'combobox', evidenceKey: null, value: 'National University of Singapore',
      optionLabel: 'National University of Singapore', factKey: 'school', confirmed: true},
  ]);
  expect(await page.evaluate(() => window.drafts.filter(call => call.url.endsWith('/form-plan')))).toHaveLength(0);
});

test('saved PDF selection requires its own Attach click and remains available after a Fill', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await page.evaluate(() => {
    const resume = {id: '11111111-2222-4333-8444-555555555555', filename: 'Fictional test resume.pdf', sha256: 'b'.repeat(64), has_file: true};
    window.autofillProfile = {values: {full_name: 'Fictional PDF Applicant'}, sources: {full_name: {source: 'resume', quote: 'Fictional PDF Applicant', resume_id: resume.id}},
      missing_fields: [], resume, resumes: [resume], extraction_status: 'ready', requires_resume_selection: false, fingerprint: 'fixture-selected-pdf'};
    window.atsFields = [{id: 'full_name', key: 'name:name', label: 'Full name', kind: 'text', evidenceKey: 'full_name', available: true, occupied: false, maxLength: 200}];
    window.atsResumeTarget = {key: 'id:resume', label: 'Resume', multiple: false, occupied: false, accept: '.pdf'};
  });
  await connectApplication(page, 'ats');
  await expect(page.locator('#ats-attach')).toBeEnabled();
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect']);
  await page.locator('#ats-fill').click();
  await expect(page.locator('#ats-result')).toContainText('Filled 1');
  await expect(page.locator('#ats-attach')).toBeEnabled();
  expect(await page.evaluate(() => window.drafts.filter(call => call.url.endsWith('/resume-content')))).toHaveLength(0);
  await page.locator('#ats-attach').click();
  await expect(page.locator('#ats-attach-result')).toContainText('PDF selected on the form');
  await expect(page.locator('#ats-attach')).toBeDisabled();
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect', 'fill', 'attach']);
  const [content] = await page.evaluate(() => window.drafts.filter(call => call.url.endsWith('/resume-content')));
  expect(content.payload).toEqual({page_url: 'https://jobs.lever.co/acme/abc-123/apply', resume_id: '11111111-2222-4333-8444-555555555555', sha256: 'b'.repeat(64), confirmed: true});
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('the fill click approves the current edited answer without individual checkboxes or generation controls', async ({page}) => {
  await setup(page); await login(page);
  await connectApplication(page);
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
  await connectApplication(page);
  await expect(page.locator('#status')).toContainText('Session expired');
  await expect(page.getByRole('button', {name: 'Connect through JobPilot', exact: true})).toBeVisible();
  expect(await page.evaluate(() => window.stored)).toEqual({});
});
test('unsupported page never requests profile draft', async ({page}) => {
  await setup(page, {unsupported: true}); await login(page);
  await connectApplication(page);
  await expect(page.locator('#status')).toContainText('Open an InternSG');
  expect((await page.evaluate(() => window.drafts)).length).toBe(0);
});
test('logout clears session and private draft', async ({page}) => {
  await setup(page); await login(page);
  await connectApplication(page);
  await page.getByRole('button', {name: 'Disconnect'}).click();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.stored)).toEqual({});
});

test('revocation between review and fill prevents page writes', async ({page}) => {
  await setup(page); await login(page);
  await connectApplication(page);
  await expect(page.locator('#fill')).toBeEnabled();
  await page.evaluate(() => { window.expired = true; });
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.locator('#status')).toContainText('expired or revoked');
  expect(await page.evaluate(() => window.operations.some(x => x[0] === 'fill'))).toBe(false);
});

test('offline validation blocks an already previewed ATS fill without page writes', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await connectApplication(page, 'ats');
  await expect(page.locator('#ats-fill')).toBeEnabled();
  await page.evaluate(() => { window.offline = true; });
  await page.locator('#ats-fill').click();
  await expect(page.locator('#status')).toContainText('Network unavailable');
  await expect(page.locator('#status')).toBeVisible();
  expect(await page.evaluate(() => window.atsCalls.filter(x => x.action === 'fill'))).toHaveLength(0);
});

test('partial fill preserves the skipped draft and marks successful fields without automatic retry', async ({page}) => {
  await setup(page); await login(page);
  await connectApplication(page);
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
  await connectApplication(page);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.locator('#status')).toContainText('Skipped Full name');
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue('Fictional Applicant');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeDisabled();
});
test('manual summary editing and filling remain available', async ({page}) => {
  await setup(page); await login(page);
  await connectApplication(page);
  await page.getByLabel('Resume summary', {exact: true}).fill('My reviewed manual summary.');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
});
test('capture disconnected, ready, permission and fallback states at the shipped popup width', async ({page}) => {
  await page.setViewportSize({width: 440, height: 700});
  await setup(page, {widgetsReady: true});
  await page.screenshot({path: '../output/popup-disconnected.png', fullPage: true});
  await login(page, undefined, {expand: false});
  await page.screenshot({path: '../output/popup-ready.png', fullPage: true});
  await openDetails(page, '#original-tools');
  await page.evaluate(() => { window.embeddedAccess = false; window.permissionsRemoved({origins: ['https://www.internsg.com/*']}); });
  await expect(page.locator('#enable-embedded')).toBeVisible();
  await page.screenshot({path: '../output/popup-permission.png', fullPage: true});
  await page.locator('#enable-embedded').click();
  await expect(page.locator('#enable-embedded')).toBeHidden();
  await connectApplication(page);
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
  await connectApplication(page);
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('');
  await page.getByLabel('I confirm importing', {exact: false}).check();
  await page.getByRole('button', {name: 'Import reviewed details to JobPilot'}).click();
  await expect(page.locator('#status')).toContainText('Imported:');
  await connectApplication(page);
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('My local summary');
  await page.getByRole('button', {name: 'Delete saved details'}).click();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.localSaved)).toEqual({});
});

test('platform values refresh across applications and cleared values never fall back to device', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'Platform introduction', nationality: 'cn', study_country: 'sg'}; });
  await connectApplication(page);
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
  await connectApplication(page);
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('');
});

test('country defaults are not assumed and the fill click explicitly approves both selected countries', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await connectApplication(page);
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

test('fill-only popup hides sending controls and rejects programmatic legacy send events', async ({page}) => {
  await setup(page); await login(page);
  await expect(page.locator('#advanced-submission')).toBeHidden();
  for (const id of ['prepare-submit', 'send-application', 'check-result']) {
    await expect(page.locator('#' + id)).toBeDisabled();
    await page.locator('#' + id).dispatchEvent('click');
  }
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
  await expect(page.locator('#submission-preview')).toBeHidden();
  await expect(page.locator('#submission-values')).toBeEmpty();
});

test('ATS preview never guesses given and family names from a full name', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await page.evaluate(() => { window.atsFields = ['first_name', 'last_name'].map(id => ({id, key: 'id:' + id, label: id === 'first_name' ? 'First name' : 'Last name', kind: 'text', evidenceKey: id === 'first_name' ? 'given_name' : 'family_name', available: true, occupied: false, maxLength: 100})); });
  await connectApplication(page, 'ats');
  await expect(page.getByLabel('First name', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Last name', {exact: true})).toHaveValue('');
  await expect(page.locator('#ats-fields')).toContainText('No saved answer.');
  await expect(page.locator('#ats-fields a').first()).toHaveAttribute('href', 'http://localhost:5173/profile');
  await expect(page.locator('#ats-fill')).toBeDisabled();
  await page.evaluate(() => { window.platformValues = {given_name: 'MING', family_name: 'LI'}; });
  await connectApplication(page, 'ats');
  await expect(page.getByLabel('First name', {exact: true})).toHaveValue('MING');
  await expect(page.getByLabel('Last name', {exact: true})).toHaveValue('LI');
  expect(await page.evaluate(() => window.atsCalls.filter(call => call.action === 'fill'))).toHaveLength(0);
  await page.locator('#ats-fill').click();
  // Fill first revalidates the grant, saved-facts fingerprint and document.
  // A completed click event does not mean its asynchronous page command ran.
  await expect(page.locator('#ats-result')).toHaveText('Filled 2; skipped 0. Nothing was submitted.');
  expect(await page.evaluate(() => window.atsCalls.filter(call => call.action === 'fill'))).toHaveLength(1);
  expect(await page.evaluate(() => window.atsCalls.find(x => x.action === 'fill').approved)).toEqual([
    {id: 'first_name', value: 'MING', confirmed: true, kind: 'text', key: 'id:first_name', label: 'First name', evidenceKey: 'given_name', factKey: 'given_name'},
    {id: 'last_name', value: 'LI', confirmed: true, kind: 'text', key: 'id:last_name', label: 'Last name', evidenceKey: 'family_name', factKey: 'family_name'},
  ]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('a delayed draft body cannot expose the previous account after reconnecting', async ({page}) => {
  await setup(page); await login(page);
  await page.evaluate(() => {
    window.platformValues = {resume_summary: 'Private account A introduction'};
    const fetcher = window.fetch;
    window.fetch = async (url, options) => {
      const response = await fetcher(url, options);
      if (!url.endsWith('/browser-assistant/autofill-profile')) return response;
      const value = await response.json();
      return {ok: true, status: 200, json: () => new Promise(resolve => { window.releaseOldDraft = () => resolve(value); })};
    };
  });
  await connectApplication(page);
  await expect.poll(() => page.evaluate(() => typeof window.releaseOldDraft)).toBe('function');
  await page.evaluate(() => { window.activeUrl = 'http://localhost:5173/jobs'; window.connect('account-b@example.test'); });
  await expect(page.locator('#account')).toBeEmpty();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.stored.jobpilotSession.userId)).toBe('account-b@example.test');
  await page.evaluate(() => window.releaseOldDraft());
  await expect(page.locator('#inspect')).toBeEnabled();
  await expect(page.locator('#fields')).toBeEmpty();
  await expect(page.locator('#status')).not.toContainText('Loaded your JobPilot profile');
  await expect(page.locator('#account')).toContainText('account-b@example.test');
});

test('account switch stops later widget writes after a normal fill was already dispatched', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'Account A introduction'}; });
  await connectApplication(page);
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
  await page.evaluate(() => { window.activeUrl = 'http://localhost:5173/jobs'; window.connect('account-b@example.test'); });
  await expect(page.locator('#account')).toBeEmpty();
  await expect(page.locator('#fields')).toBeEmpty();
  await page.evaluate(() => window.releaseNormalFill());
  await expect(page.locator('#account')).toContainText('account-b@example.test');
  await expect(page.locator('#inspect')).toBeEnabled();
  expect(await page.evaluate(() => window.operations.filter(x => x[0] === 'fill'))).toHaveLength(1);
  expect(await page.evaluate(() => window.widgetFill)).toBeUndefined();
  await expect(page.locator('#fields')).toBeEmpty();
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('a late ATS profile check cannot fill or expose answers after sign-out', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await connectApplication(page, 'ats');
  await page.evaluate(() => {
    const fetcher = window.fetch;
    window.fetch = async (url, options) => {
      const response = await fetcher(url, options);
      if (!url.endsWith('/browser-assistant/autofill-profile')) return response;
      const value = await response.json();
      return {ok: true, status: 200, json: () => new Promise(resolve => { window.releaseATSProfile = () => resolve(value); })};
    };
  });
  await page.locator('#ats-fill').click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseATSProfile)).toBe('function');
  await page.evaluate(() => { window.stored = {}; window.storageListener({jobpilotSession: {newValue: undefined}}, 'session'); window.releaseATSProfile(); });
  await expect(page.locator('#ats-fields')).toBeEmpty();
  await expect(page.locator('#ats-fill')).toBeDisabled();
  expect(await page.evaluate(() => window.atsCalls.filter(x => x.action === 'fill'))).toHaveLength(0);
});

test('changed or cleared saved ATS facts require a fresh preview and never dispatch stale answers', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await connectApplication(page, 'ats');
  await page.evaluate(() => { window.platformValues = {given_name: 'New explicit name'}; });
  await page.locator('#ats-fill').click();
  await expect(page.locator('#status')).toContainText('Your saved answers changed');
  await expect(page.locator('#ats-fields')).toBeEmpty();
  await expect(page.locator('#ats-inspect')).toBeVisible();
  expect(await page.evaluate(() => window.atsCalls.filter(x => x.action === 'fill'))).toHaveLength(0);
  await page.locator('#ats-inspect').click();
  await expect(page.locator('#ats-full_name')).toHaveValue('Fictional Applicant');
  await expect(page.locator('#ats-inspect')).toBeHidden();
  expect(await page.evaluate(() => window.atsCalls.filter(x => x.action === 'fill'))).toHaveLength(0);
  expect(await page.evaluate(() => window.drafts.filter(call => call.url.endsWith('/form-plan')))).toHaveLength(0);
});

test('ATS Fill binds the clicked preview while asynchronous checks disable editing', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await connectApplication(page, 'ats');
  await page.locator('#ats-full_name').fill('Clicked preview');
  await page.evaluate(() => {
    const fetcher = window.fetch;
    window.fetch = async (url, options) => {
      if (url.endsWith('/auth/extension/session')) await new Promise(resolve => { window.releaseATSValidation = resolve; });
      return fetcher(url, options);
    };
  });
  await page.locator('#ats-fill').click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseATSValidation)).toBe('function');
  await expect(page.locator('#ats-full_name')).toBeDisabled();
  await page.evaluate(() => { document.getElementById('ats-full_name').value = 'Later unapproved edit'; window.releaseATSValidation(); });
  await expect(page.locator('#ats-result')).toContainText('Nothing was submitted');
  expect(await page.evaluate(() => window.atsCalls.find(x => x.action === 'fill').approved[0].value)).toBe('Clicked preview');
});

test('ATS country selects use explicit saved facts and telephone country remains manual', async ({page}) => {
  await setup(page); await login(page, undefined, {expand: false});
  await page.evaluate(() => {
    window.platformValues = {nationality: 'cn'};
    window.atsFields = [
      {id: 'country:0', kind: 'select', key: 'id:nationality', label: 'Nationality', evidenceKey: 'nationality_country', available: true, occupied: false,
        options: [{value: 'cn', label: 'China'}, {value: 'sg', label: 'Singapore'}]},
      {id: 'country:1', kind: 'select', key: 'id:phone-country', label: 'Phone country code', evidenceKey: 'phone_country_code', available: true, occupied: false,
        options: [{value: '86', label: 'China (+86)'}, {value: '65', label: 'Singapore (+65)'}]},
    ];
  });
  await connectApplication(page, 'ats');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('cn');
  await expect(page.getByLabel('Phone country code', {exact: true})).toHaveValue('');
  expect(await page.evaluate(() => window.drafts.filter(x => x.url.endsWith('/ats-evidence')))).toHaveLength(0);
  await page.getByLabel('Phone country code', {exact: true}).selectOption('65');
  expect(await page.evaluate(() => window.atsCalls.filter(call => call.action === 'fill'))).toHaveLength(0);
  await page.locator('#ats-fill').click();
  await expect(page.locator('#ats-result')).toHaveText('Filled 2; skipped 0. Nothing was submitted.');
  expect(await page.evaluate(() => window.atsCalls.filter(call => call.action === 'fill'))).toHaveLength(1);
  expect(await page.evaluate(() => window.atsCalls.find(x => x.action === 'fill').approved)).toEqual([
    {id: 'country:0', value: 'cn', confirmed: true, kind: 'select', optionLabel: 'China', key: 'id:nationality', label: 'Nationality', evidenceKey: 'nationality_country', factKey: 'nationality'},
    {id: 'country:1', value: '65', confirmed: true, kind: 'select', optionLabel: 'Singapore (+65)', key: 'id:phone-country', label: 'Phone country code', evidenceKey: 'phone_country_code', factKey: 'phone_country_code'},
  ]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('the current ATS provider opens with a saved-answer preview and no read, permission or paid action', async ({page}) => {
  await setup(page);
  await page.evaluate(() => { window.activeUrl = 'https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101'; });
  await login(page, undefined, {expand: false});
  await expect(page.locator('#ats-tools')).toHaveAttribute('open');
  await expect(page.locator('#original-tools')).not.toHaveAttribute('open');
  await expect(page.locator('#settings')).not.toHaveAttribute('open');
  await expect(page.locator('#ats-full_name')).toHaveValue('Fictional Applicant');
  await expect(page.locator('#ats-inspect')).toBeHidden();
  await expect(page.locator('#ats-fill')).toBeEnabled();
  expect(await page.evaluate(() => window.atsCalls.map(call => call.action))).toEqual(['inspect']);
  expect(await page.evaluate(() => window.drafts.every(call => call.url.endsWith('/autofill-profile')))).toBe(true);
  expect(await page.evaluate(() => window.permissionRequests)).toEqual([]);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('long ATS previews scroll once while the Fill action remains visible at popup size', async ({page}) => {
  await page.setViewportSize({width: 440, height: 580});
  await setup(page); await login(page, undefined, {expand: false});
  await page.evaluate(() => {
    window.platformValues = {given_name: 'Fictional', family_name: 'Applicant'};
    window.atsFields = [
      ...['first_name', 'last_name', 'email', 'phone'].map(id => ({id, key: 'id:' + id, label: id.replaceAll('_', ' '), kind: 'text', evidenceKey: ({first_name: 'given_name', last_name: 'family_name', email: 'contact_email', phone: 'phone'})[id], available: true, occupied: false, maxLength: 200})),
      ...['education', 'experience'].map((evidenceKey, index) => ({id: 'custom:' + index, label: 'Describe your ' + evidenceKey,
        key: 'id:custom-' + index, kind: 'text', evidenceKey, available: true, occupied: false, maxLength: 3000})),
    ];
  });
  await connectApplication(page, 'ats');
  await expect(page.locator('#ats-profile-note')).toBeVisible();
  await expect(page.locator('#ats-intro')).toBeHidden();
  await expect(page.locator('#ats-consent')).toBeHidden();
  await expect(page.locator('#ats-target')).toHaveText('jobs.lever.co');
  await expect(page.locator('#ats-target')).toHaveAttribute('title', 'https://jobs.lever.co/acme/abc-123/apply');
  await expect(page.locator('#ats-fields')).not.toContainText('Saved in JobPilot Profile');
  const preview = await page.locator('#workspace-content').boundingBox();
  for (const id of ['ats-first_name', 'ats-last_name', 'ats-email']) {
    const field = await page.locator('#' + id).boundingBox();
    expect(field.y).toBeGreaterThanOrEqual(preview.y);
    expect(field.y + field.height).toBeLessThanOrEqual(preview.y + preview.height);
  }
  const before = await page.locator('#ats-fill').boundingBox();
  expect(before.y + before.height).toBeLessThanOrEqual(580);
  await page.locator('#workspace-content').evaluate(node => { node.scrollTop = node.scrollHeight; });
  const after = await page.locator('#ats-fill').boundingBox();
  expect(after.y).toBe(before.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('#workspace-content').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
});

test('profile updates and explicit clearing are reloaded for a different job without local fallback', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'First introduction', nationality: 'cn', study_country: 'sg'}; });
  await connectApplication(page);
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('First introduction');
  await page.evaluate(() => {
    window.applicationUrl = 'https://www.internsg.com/job-apply/456';
    window.platformValues = {resume_summary: 'Updated introduction', nationality: 'sg', study_country: 'sg'};
  });
  await connectApplication(page);
  await expect(page.locator('#target')).toContainText('/456');
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('Updated introduction');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('sg');
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  await page.evaluate(() => {
    window.applicationUrl = 'https://www.internsg.com/job-apply/789';
    window.platformValues = {resume_summary: '', nationality: null, study_country: null};
    window.localSaved = {'jobpilotProfile:["http://localhost:8000","fictional@example.test"]': {summary: 'Old device introduction', countries: {nationality: 'cn', campus: 'sg'}}};
  });
  await connectApplication(page);
  await expect(page.getByLabel('Resume summary', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('');
  const drafts = await page.evaluate(() => window.drafts.filter(x => x.url.endsWith('/browser-assistant/autofill-profile')));
  expect(drafts).toHaveLength(3);
  expect(await page.evaluate(() => window.operations.filter(x => x[0] === 'inspect').map(() => true))).toHaveLength(3);
  expect(await page.evaluate(() => window.submitCalls || 0)).toBe(0);
});

test('an unsupported current tab exposes platform navigation without reading saved facts or a form', async ({page}) => {
  await setup(page);
  await page.evaluate(() => { window.activeUrl = 'http://localhost:5173/jobs'; });
  await expect(page.locator('button:visible')).toHaveCount(1);
  await expect(page.locator('#platform')).toBeHidden();
  await expect(page.locator('#extension-id')).toBeHidden();
  await login(page, undefined, {expand: false});
  await expect(page.locator('button:visible')).toHaveCount(0);
  await expect(page.locator('#open-jobpilot')).toBeVisible();
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
  await openDetails(page, '#original-tools');
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
  await connectApplication(page);
  await expect(page.locator('#fill')).toBeEnabled();
  await page.evaluate(() => { window.embeddedAccess = false; window.permissionsRemoved({origins: ['https://www.internsg.com/*']}); });
  await expect(page.locator('#fields')).toBeEmpty();
  await expect(page.locator('#fill')).toBeDisabled();
  expect(await page.evaluate(() => window.operations.filter(item => item[0] === 'fill'))).toEqual([]);
});

test('one click captures text and countries before asynchronous validation and never approves later edits', async ({page}) => {
  await setup(page, {widgetsReady: true}); await login(page);
  await page.evaluate(() => { window.platformValues = {resume_summary: 'Reviewed summary', nationality: 'cn', study_country: 'sg'}; });
  await connectApplication(page);
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
  await connectApplication(page);
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
  await connectApplication(page);
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
    await connectApplication(page);
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
