import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for isolated platform application checks.');
const extensionId = 'a'.repeat(32);
const tokenA = 'fictional-platform-application-a';
const tokenB = 'fictional-platform-application-b';
const jobA = 'ac123456-1234-4123-8123-1234567890ab';
const jobB = 'bc123456-1234-4123-8123-1234567890ab';
const pageUrl = 'https://www.internsg.com/job-apply/271036/';
const fields = [
  {id: 'applicant_name', label: 'Full name', maxLength: 200, occupied: false},
  {id: 'applicant_email', label: 'Contact email', maxLength: 254, occupied: false},
  {id: 'applicant_contact', label: 'Phone', maxLength: 40, occupied: false},
  {id: 'applicant_period', label: 'Availability period', maxLength: 500, occupied: false},
  {id: 'applicant_summary', label: 'Personal introduction', maxLength: 3000, occupied: false, widget: true},
];
const savedDraft = {
  values: {
    applicant_name: 'Fictional Saved Applicant', applicant_email: 'fixture@example.test',
    applicant_contact: '+65 8000 0000', applicant_period: 'January to March 2027',
    applicant_summary: 'My user-written introduction. 我学习计算机。',
  }, countries: {nationality: 'cn', campus: 'sg'}, profile_source: 'jobpilot',
  summary_status: 'manual_only', requires_review: true, submission_supported: false,
};
const inspectResult = {
  ok: true, version: 1, review_id: 'cc123456-1234-4123-8123-1234567890ab', fields,
  countries: [{code: 'cn', name: 'China'}, {code: 'sg', name: 'Singapore'}],
  countries_available: true,
};
const preparedIntro = (value, source = 'ai_draft') => ({status: 'ready', profile_fingerprint: 'fixture-platform-empty', resume_id: null,
  preparation_id: 'fixture-platform-preparation', answers: [{field_id: 'intro', value, source, fact_key: null, citations: []}],
  omitted: [], reused: false, execution_mode: 'mock', elapsed_ms: 3, error_code: null});

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function setup(page, {signedIn = true, installed = true, bridgeMode = 'normal', inspection = {}, fillResult, draftHandler, draftData = savedDraft, factsData, warmHandler} = {}) {
  const calls = {drafts: [], warm: [], externalGets: 0, externalPosts: 0, applicationWrites: 0, unexpected: []};
  const facts = factsData || {values: {}, sources: {}, missing_fields: [], resume: null, resumes: [],
    requires_resume_selection: false, extraction_status: 'no_resume', fingerprint: 'fixture-platform-empty'};
  await page.addInitScript(({signedIn, installed, bridgeMode, extensionId, tokenA, inspectResult, inspection, fillResult}) => {
    if (signedIn) localStorage.setItem('jobpilot_token', tokenA);
    if (installed) localStorage.setItem('jobpilot_extension_id', extensionId);
    window.applicationBridge = {
      mode: bridgeMode, messages: [], pendingInspect: null, pendingFill: null,
      inspect: {...inspectResult, ...inspection, expires_at: Date.now() + 300000},
      fill: fillResult ?? null, pendingFillResult: null,
    };
    if (installed) window.chrome = {runtime: {sendMessage: (client, message, callback) => {
      const bridge = window.applicationBridge;
      bridge.messages.push({client, message});
      if (message.kind === 'connection-status') callback({ok: true, version: 1, connected: true,
        platform_origin: location.origin, api_origin: 'http://127.0.0.1:8001', user_id: 'fixture-platform-user', expires_at: Date.now() / 1000 + 300});
      else if (message.kind === 'application-inspect') {
        if (bridge.mode === 'hold-inspect') bridge.pendingInspect = callback;
        else if (bridge.mode === 'old-protocol') callback({ok: true, version: 0});
        else if (bridge.mode === 'inspect-error') callback({ok: false, error: 'Extension connection expired. Connect through JobPilot again.'});
        else callback(structuredClone(bridge.inspect));
      } else if (message.kind === 'application-fill') {
        const result = bridge.fill ?? {ok: true, filled: message.approved.map(item => item.id), skipped: [], reasons: {}, submitted: false};
        bridge.pendingFillResult = result;
        if (bridge.mode === 'hold-fill') bridge.pendingFill = callback;
        else callback(structuredClone(result));
      } else callback({ok: true});
    }}};
  }, {signedIn, installed, bridgeMode, extensionId, tokenA, inspectResult, inspection, fillResult});
  // No unhandled API or employer request reaches a real service in this fixture.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin) return route.continue();
    calls.unexpected.push(url.pathname);
    if (url.pathname.includes('/applications')) calls.applicationWrites++;
    return route.fulfill({status: 503, json: {detail: 'Isolated test: unexpected request blocked'}});
  });
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType: 'text/css', body: ''}));
  await page.route('**/profile', route => route.request().resourceType() === 'document' ? route.continue()
    : route.fulfill({json: {full_name: 'Fictional platform account'}}));
  await page.route('**/profile/resumes', route => route.fulfill({json: []}));
  await page.route('**/browser-assistant/autofill-profile', route => route.fulfill({json: facts}));
  await page.route('**/browser-assistant/prepare-answers/warm', route => {
    calls.warm.push({body: route.request().postDataJSON(), authorization: route.request().headers().authorization});
    if (warmHandler) return warmHandler(route, calls);
    return route.fulfill({json: {status: 'ready', profile_fingerprint: facts.fingerprint, resume_id: facts.resume?.id ?? null,
      preparation_id: 'fixture-platform-preparation', answers: [], omitted: [], reused: false, execution_mode: 'not_needed', elapsed_ms: 2, error_code: null}});
  });
  await page.route('**/users/me', route => route.fulfill({json: {id: 'fixture-platform-user', role: 'job_seeker'}}));
  await page.route(new RegExp(`/jobs/(${jobA}|${jobB})$`), route => {
    if (route.request().resourceType() === 'document') return route.continue();
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    return route.fulfill({json: {
      id, title: `Fictional ${id} — fixture only`, company: 'Test only, no employer', status: 'active',
      apply_url: id === jobA ? pageUrl : 'https://www.internsg.com/job-apply/271037/',
    }});
  });
  await page.route('**/browser-assistant/draft', async route => {
    calls.drafts.push({body: route.request().postDataJSON(), authorization: route.request().headers().authorization});
    if (route.request().headers().authorization === `Bearer ${tokenB}`) {
      return route.fulfill({json: {...savedDraft, values: {applicant_name: 'Second fictional account'}, countries: {nationality: null, campus: null}}});
    }
    if (draftHandler) return draftHandler(route);
    return route.fulfill({json: draftData});
  });
  await page.route('https://www.internsg.com/**', route => {
    if (route.request().method() === 'GET') calls.externalGets++;
    else calls.externalPosts++;
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated employer fixture</title><label>Original name<input id="applicant_name"></label><p>Fixture only — no delivery.</p>'});
  });
  await page.goto(`${base}/jobs/${jobA}/apply-external`);
  return calls;
}

async function showLoadedAnswers(page) {
  const edit = page.getByRole('button', {name: 'Edit loaded answers for this application', exact: true});
  const reviewing = page.getByRole('button', {name: 'Show only missing answers', exact: true});
  await expect(edit.or(reviewing)).toBeVisible();
  if (await edit.isVisible()) await edit.click();
  const saved = page.locator('.preparation-saved-details');
  if (!await saved.evaluate(element => element.open)) await saved.locator('summary').click();
}

async function loadForm(page) {
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Load application form'}).click();
  await expect(page.frameLocator('iframe').locator('#applicant_name')).toBeVisible();
}

async function loadAndFill(page) {
  await loadForm(page);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
}

async function messages(page, kind) {
  return page.evaluate(kind => window.applicationBridge.messages.filter(row => row.message.kind === kind), kind);
}

async function switchAccount(page) {
  await page.evaluate(({tokenA, tokenB}) => {
    localStorage.setItem('jobpilot_token', tokenB);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue: tokenA, newValue: tokenB}));
  }, {tokenA, tokenB});
}

test('saved profile is editable on JobPilot without loading or filling the original form', async ({page}) => {
  const calls = await setup(page);
  await showLoadedAnswers(page);
  for (const field of fields) await expect(page.getByLabel(field.label, {exact: true})).toHaveValue(savedDraft.values[field.id]);
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('cn');
  await expect(page.getByLabel('Country of study / graduation', {exact: true})).toHaveValue('sg');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Check form with extension'})).toHaveCount(0);
  expect(calls.drafts.length).toBeGreaterThan(0);
  for (const call of calls.drafts) {
    expect(call.authorization).toBe(`Bearer ${tokenA}`);
    expect(call.body).toEqual({page_url: pageUrl, field_ids: fields.map(field => field.id)});
  }
  expect(await messages(page, 'application-inspect')).toHaveLength(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.externalGets).toBe(0);
});

test('a prepared introduction is an editable one-off answer and keeps the original saved-draft fingerprint', async ({page}) => {
  const draft = {...savedDraft, values: {...savedDraft.values, applicant_summary: ''}};
  const text = 'Fictional application draft grounded in the saved project.';
  const calls = await setup(page, {draftData: draft, warmHandler: route => route.fulfill({json: preparedIntro(text)})});
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue(text);
  await expect(page.locator('#applicant_summary-reason')).toContainText('AI draft for this application');
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.externalGets).toBe(0);
  await loadAndFill(page);
  await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
  const [check] = await messages(page, 'application-inspect');
  expect(check.message.profile_fingerprint).toBe(createHash('sha256').update(JSON.stringify({values: draft.values, countries: draft.countries})).digest('hex'));
  const [fill] = await messages(page, 'application-fill');
  expect(fill.message.approved.find(item => item.id === 'applicant_summary')).toEqual({id: 'applicant_summary', value: text, confirmed: true});
  expect(calls.warm.filter(call => !call.body.cache_only)).toHaveLength(0);
  expect(calls.applicationWrites).toBe(0);
  expect(calls.externalPosts).toBe(0);
});

test('a late prepared introduction never replaces a saved introduction or a manual one-off edit', async ({page}) => {
  const started = gate(), release = gate();
  const draft = {...savedDraft, values: {...savedDraft.values, applicant_summary: ''}};
  await setup(page, {draftData: draft, warmHandler: async route => {
    started.resolve(); await release.promise;
    return route.fulfill({json: preparedIntro('Late AI draft that must stay out of the edited answer.')});
  }});
  await started.promise;
  await page.getByLabel('Personal introduction', {exact: true}).fill('My own one-off introduction.');
  release.resolve();
  await expect(page.locator('.prepared-answers-status')).toContainText('1 saved application answer ready');
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue('My own one-off introduction.');
  expect(await messages(page, 'application-fill')).toHaveLength(0);
});

test('saved user introductions take priority over optional generated drafts', async ({page}) => {
  await setup(page, {warmHandler: route => route.fulfill({json: preparedIntro('Optional AI draft that must not replace saved text.')})});
  await expect(page.locator('.prepared-answers-status')).toContainText('1 saved application answer ready');
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue(savedDraft.values.applicant_summary);
  await expect(page.locator('#applicant_summary-reason')).toHaveCount(0);
});

test('pending confirmation is not adopted and waiting for optional preparation never blocks Fill', async ({page}) => {
  const started = gate(), release = gate();
  const draft = {...savedDraft, values: {...savedDraft.values, applicant_summary: ''}};
  const calls = await setup(page, {draftData: draft, warmHandler: async route => {
    started.resolve(); await release.promise;
    return route.fulfill({json: preparedIntro('An unresolved answer must not be inserted.', 'pending_confirmation')});
  }});
  await started.promise;
  await loadForm(page);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.getByText(/^Filled 5; skipped 1/)).toBeVisible();
  release.resolve();
  await expect(page.locator('.prepared-answers-status')).toContainText('Saved details are ready');
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue('');
  const [fill] = await messages(page, 'application-fill');
  expect(fill.message.approved.some(item => item.id === 'applicant_summary')).toBe(false);
  expect(calls.externalPosts).toBe(0);
});

test('a delayed previous-account preparation cannot expose or replace the current account answer', async ({page}) => {
  const started = gate(), release = gate(), answered = gate();
  const draft = {...savedDraft, values: {...savedDraft.values, applicant_summary: ''}};
  const calls = await setup(page, {draftData: draft, warmHandler: async route => {
    if (route.request().headers().authorization === `Bearer ${tokenA}`) {
      started.resolve(); await release.promise;
      try { await route.fulfill({json: preparedIntro('PRIVATE OLD ACCOUNT DRAFT')}); } catch { /* The old client request was aborted. */ }
      finally { answered.resolve(); }
      return;
    }
    return route.fulfill({json: preparedIntro('Current account B application draft.')});
  }});
  await started.promise;
  await switchAccount(page);
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue('Current account B application draft.');
  release.resolve(); await answered.promise;
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue('Current account B application draft.');
  await expect(page.locator('body')).not.toContainText('PRIVATE OLD ACCOUNT DRAFT');
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.warm.filter(call => !call.body.cache_only)).toHaveLength(0);
});

test('one explicit click inspects and fills the shown answers without submitting', async ({page}) => {
  const calls = await setup(page);
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  await page.getByLabel('Full name', {exact: true}).fill('Reviewed Fictional Applicant');
  await loadForm(page);
  expect(await messages(page, 'application-inspect')).toHaveLength(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  await expect(page.locator('#fill-permission')).toContainText('Clicking Fill approves these answers, including your nationality and study-country choices.');
  await expect(page.locator('#fill-permission')).toContainText('Existing text stays unchanged.');
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
  const checks = await messages(page, 'application-inspect');
  expect(checks).toHaveLength(1);
  expect(checks[0].client).toBe(extensionId);
  expect(checks[0].message).toMatchObject({kind: 'application-inspect', version: 1, job_id: jobA, page_url: pageUrl});
  expect(Object.keys(checks[0].message).sort()).toEqual(['job_id', 'kind', 'page_url', 'profile_fingerprint', 'version']);
  expect(checks[0].message.profile_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(checks[0].message.profile_fingerprint).toBe(createHash('sha256').update(JSON.stringify({
    values: Object.fromEntries(fields.map(field => [field.id, savedDraft.values[field.id] || ''])),
    countries: {nationality: savedDraft.countries.nationality || '', campus: savedDraft.countries.campus || ''},
  })).digest('hex'));
  const fill = await messages(page, 'application-fill');
  expect(fill).toHaveLength(1);
  expect(fill[0].message).toEqual({
    kind: 'application-fill', version: 1, job_id: jobA, page_url: pageUrl,
    review_id: inspectResult.review_id, approved: [
      ...fields.map(field => ({id: field.id, value: field.id === 'applicant_name' ? 'Reviewed Fictional Applicant' : savedDraft.values[field.id], confirmed: true})),
      {id: 'applicant_countries', value: JSON.stringify(savedDraft.countries), confirmed: true},
    ],
  });
  await expect(page.getByText(/Nothing (was|has been) submitted|No application (was|has been) submitted/i).first()).toBeVisible();
  expect(JSON.stringify(fill)).not.toContain(tokenA);
  expect((await page.evaluate(() => window.applicationBridge.messages))
    .some(row => /submit|send-application/.test(row.message.kind))).toBe(false);
  expect(calls.applicationWrites).toBe(0);
  expect(calls.externalPosts).toBe(0);
});

test('changing jobs reuses all seven saved details without carrying over one-off edits or filling automatically', async ({page}) => {
  const calls = await setup(page);
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  await loadForm(page);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
  const firstFill = (await messages(page, 'application-fill'))[0].message;
  await page.getByLabel('Full name', {exact: true}).fill('One-off name for the first role');
  await page.getByLabel('Personal introduction', {exact: true}).fill('First-role-only introduction');
  await page.getByLabel('Nationality', {exact: true}).selectOption('sg');
  await page.getByLabel('Country of study / graduation', {exact: true}).selectOption('cn');

  await page.evaluate(jobId => {
    history.pushState({}, '', `/jobs/${jobId}/apply-external`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, jobB);
  await expect(page.getByText(`Fictional ${jobB} — fixture only`, {exact: false})).toBeVisible();
  await showLoadedAnswers(page);
  for (const field of fields) await expect(page.getByLabel(field.label, {exact: true})).toHaveValue(savedDraft.values[field.id]);
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue(savedDraft.countries.nationality);
  await expect(page.getByLabel('Country of study / graduation', {exact: true})).toHaveValue(savedDraft.countries.campus);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByText(/^Filled \d/)).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toHaveCount(0);
  expect(await messages(page, 'application-fill')).toHaveLength(1);
  expect(calls.externalGets).toBe(1);

  await loadForm(page);
  expect(await messages(page, 'application-fill')).toHaveLength(1);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
  const secondUrl = 'https://www.internsg.com/job-apply/271037/';
  const fills = await messages(page, 'application-fill');
  expect(fills).toHaveLength(2);
  expect(fills[1].message).toMatchObject({job_id: jobB, page_url: secondUrl, approved: firstFill.approved});
  expect((await messages(page, 'application-inspect')).map(row => row.message.job_id)).toEqual([jobA, jobB]);
  expect(calls.drafts.map(call => call.body.page_url)).toContain(secondUrl);
  expect(calls.drafts.every(call => call.authorization === `Bearer ${tokenA}`)).toBe(true);
  expect(calls.unexpected).toEqual([]);
  expect(calls.externalPosts).toBe(0);
  expect(calls.applicationWrites).toBe(0);
});

test('the explicit fill click includes the displayed country pair without extra checkboxes', async ({page}) => {
  await setup(page);
  await loadForm(page);
  await page.getByLabel('Nationality', {exact: true}).selectOption('sg');
  await page.getByLabel('Country of study / graduation', {exact: true}).selectOption('cn');
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.getByText(/^Filled 6/)).toBeVisible();
  expect((await messages(page, 'application-fill'))[0].message.approved.find(item => item.id === 'applicant_countries')).toEqual(
    {id: 'applicant_countries', value: JSON.stringify({nationality: 'sg', campus: 'cn'}), confirmed: true});
});

test('occupied unavailable and overlong answers are skipped with reasons while valid answers fill', async ({page}) => {
  await setup(page, {inspection: {
    fields: fields.map(field => field.id === 'applicant_name' ? {...field, occupied: true}
      : field.id === 'applicant_contact' ? {...field, unavailable: true}
        : field.id === 'applicant_email' ? {...field, maxLength: 10} : field),
    countries_available: false, country_reason: 'Country widget unavailable in this fixture.',
  }});
  await loadAndFill(page);
  await expect(page.getByText(/^Filled 2; skipped 4/)).toBeVisible();
  expect((await messages(page, 'application-fill'))[0].message.approved.map(item => item.id)).toEqual(['applicant_period', 'applicant_summary']);
  await expect(page.locator('body')).toContainText(/already|occupied/i);
  await expect(page.locator('body')).toContainText(/not found|unavailable|unsupported/i);
  await expect(page.locator('body')).toContainText('Country widget unavailable in this fixture.');
  await expect(page.locator('body')).toContainText('allows 10 characters');
});

test('skipped fill results retain the draft and show the extension reason', async ({page}) => {
  await setup(page, {fillResult: {ok: true, filled: ['applicant_email', 'applicant_contact', 'applicant_period', 'applicant_summary', 'applicant_countries'], skipped: ['applicant_name'], reasons: {applicant_name: 'The original page changed after review.'}, submitted: false}});
  await loadAndFill(page);
  await expect(page.locator('body')).toContainText('The original page changed after review.');
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  await expect(page.getByText(/^Filled 5; skipped 1/)).toBeVisible();
  expect(await messages(page, 'application-fill')).toHaveLength(1);
});

test('missing extension keeps profile preview but does not fake fill support', async ({page}) => {
  const calls = await setup(page, {installed: false});
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  await loadForm(page);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeDisabled();
  await expect(page.locator('.application-extension-status')).toContainText('Extension not connected.');
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.externalPosts).toBe(0);
});

test('saved answers start in a review fold and only missing details need input', async ({page}) => {
  const calls = await setup(page);
  await expect(page.getByRole('button', {name: 'Edit loaded answers for this application'})).toBeVisible();
  await expect(page.getByLabel('Full name', {exact: true})).toHaveCount(0);
  await page.getByText('Review the details already loaded', {exact: true}).click();
  await expect(page.locator('.preparation-saved-details')).toContainText(savedDraft.values.applicant_name);
  expect(await messages(page, 'application-inspect')).toHaveLength(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.externalPosts).toBe(0);
});

test('Load is the first primary action and is replaced by nearby Fill without automatic input', async ({page}) => {
  await setup(page);
  const fill = page.getByRole('button', {name: 'Fill application form', exact: true});
  const load = page.getByRole('button', {name: 'Load application form', exact: true});
  await expect(fill).toHaveCount(0);
  await expect(load).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await messages(page, 'application-inspect')).toHaveLength(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  await load.click();
  await expect(page.frameLocator('iframe').locator('#applicant_name')).toBeVisible();
  await expect(load).toHaveCount(0);
  await expect(page.locator('.application-extension-status')).toContainText('Extension connected to this account.');
  await expect(fill).toBeEnabled();
  await fill.click();
  await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
  expect(await messages(page, 'application-fill')).toHaveLength(1);
});

test('an old extension protocol fails closed with upgrade guidance', async ({page}) => {
  await setup(page, {bridgeMode: 'old-protocol'});
  await loadAndFill(page);
  await expect(page.getByRole('alert')).toContainText(/update|reload|version|protocol/i);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
});

test('expired extension connection is explained and never silently falls back to submission', async ({page}) => {
  const calls = await setup(page, {bridgeMode: 'inspect-error'});
  await loadAndFill(page);
  await expect(page.getByRole('alert')).toContainText('Connect through JobPilot again');
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.applicationWrites).toBe(0);
});

test('account change clears the old draft, closes the frame and ignores a late inspect response', async ({page}) => {
  await setup(page, {bridgeMode: 'hold-inspect'});
  await loadAndFill(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.applicationBridge.pendingInspect))).toBe(true);
  await switchAccount(page);
  await page.evaluate(() => window.applicationBridge.pendingInspect(structuredClone(window.applicationBridge.inspect)));
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText: /Account changed/i}).first()).toBeVisible();
  expect(await page.locator('input,textarea').evaluateAll(nodes => nodes.map(node => node.value))).not.toContain(savedDraft.values.applicant_name);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toHaveCount(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
});

test('route change discards the previous page review rather than filling a different job', async ({page}) => {
  await setup(page, {bridgeMode: 'hold-inspect'});
  await loadAndFill(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.applicationBridge.pendingInspect))).toBe(true);
  await page.evaluate(jobId => {
    history.pushState({}, '', `/jobs/${jobId}/apply-external`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, jobB);
  await expect(page.getByText(`Fictional ${jobB} — fixture only`, {exact: false})).toBeVisible();
  await page.evaluate(() => window.applicationBridge.pendingInspect(structuredClone(window.applicationBridge.inspect)));
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toHaveCount(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
});

test('a delayed old-account draft response cannot repopulate the application preview', async ({page}) => {
  const started = gate(), release = gate();
  await setup(page, {draftHandler: async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({json: savedDraft});
  }});
  await started.promise;
  await switchAccount(page);
  release.resolve();
  await expect(page.getByRole('alert').filter({hasText: /Account changed/i}).first()).toBeVisible();
  expect(await page.locator('input,textarea').evaluateAll(nodes => nodes.map(node => node.value))).not.toContain(savedDraft.values.applicant_name);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('duplicate clicks send one fill and a late reply cannot acknowledge success for a new account', async ({page}) => {
  const calls = await setup(page, {bridgeMode: 'hold-fill'});
  await loadForm(page);
  await page.getByRole('button', {name: 'Fill application form', exact: true}).evaluate(button => { button.click(); button.click(); });
  await expect.poll(async () => (await messages(page, 'application-fill')).length).toBe(1);
  await switchAccount(page);
  await page.evaluate(() => window.applicationBridge.pendingFill(structuredClone(window.applicationBridge.pendingFillResult)));
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText: /Account changed/i}).first()).toBeVisible();
  await expect(page.getByText(/^Filled \d/)).toHaveCount(0);
  expect(await messages(page, 'application-inspect')).toHaveLength(1);
  expect(calls.externalPosts).toBe(0);
  expect(calls.applicationWrites).toBe(0);
});

test('original-frame navigation clears a previous successful fill report', async ({page}) => {
  const calls = await setup(page);
  await loadAndFill(page);
  await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
  await expect(page.getByText('Filled. Check the answer on the original form.', {exact: true})).toHaveCount(5);

  const originalFrame = page.frames().find(frame => frame.url() === pageUrl);
  expect(originalFrame).toBeTruthy();
  await originalFrame.evaluate(() => location.reload());
  await expect.poll(() => calls.externalGets).toBe(2);
  await expect(page.getByText(/^Filled \d/)).toHaveCount(0);
  await expect(page.getByText('Filled. Check the answer on the original form.', {exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  expect(await messages(page, 'application-fill')).toHaveLength(1);
  expect(calls.externalPosts).toBe(0);
  expect(calls.applicationWrites).toBe(0);
});

test('editing text or either country clears a previous fill report without filling the new value', async ({page}) => {
  const calls = await setup(page);
  await loadForm(page);
  const edits = [
    () => page.getByLabel('Full name', {exact: true}).fill('New unsent fictional name'),
    () => page.getByLabel('Nationality', {exact: true}).selectOption('sg'),
    () => page.getByLabel('Country of study / graduation', {exact: true}).selectOption('cn'),
  ];
  for (const [index, edit] of edits.entries()) {
    await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
    await expect(page.getByText(/^Filled 6; skipped 0/)).toBeVisible();
    await edit();
    await expect(page.getByText(/^Filled \d/)).toHaveCount(0);
    await expect(page.getByText('Filled. Check the answer on the original form.', {exact: true})).toHaveCount(0);
    expect(await messages(page, 'application-fill')).toHaveLength(index + 1);
    expect(await messages(page, 'application-inspect')).toHaveLength(index + 1);
  }
  expect(calls.externalPosts).toBe(0);
  expect(calls.applicationWrites).toBe(0);
});

test('saving the linked profile and returning loads the new reusable application details', async ({page}) => {
  let profile = {
    full_name: savedDraft.values.applicant_name, contact_email: savedDraft.values.applicant_email,
    given_name: null, family_name: null,
    phone: savedDraft.values.applicant_contact, availability_period: savedDraft.values.applicant_period,
    resume_summary: savedDraft.values.applicant_summary, nationality: 'cn', study_country: 'sg',
    education: '', experience: '', skills: [], links: {},
  };
  const calls = await setup(page, {draftHandler: route => route.fulfill({json: {
    ...savedDraft, values: {
      applicant_name: profile.full_name, applicant_email: profile.contact_email, applicant_contact: profile.phone,
      applicant_period: profile.availability_period, applicant_summary: profile.resume_summary,
    }, countries: {nationality: profile.nationality, campus: profile.study_country},
  }})});
  let saves = 0;
  await page.route('**/profile', route => {
    if (route.request().resourceType() === 'document') return route.continue();
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    if (route.request().method() === 'PUT') {
      saves++;
      profile = {...profile, ...route.request().postDataJSON()};
    }
    return route.fulfill({json: profile});
  });
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  await page.getByLabel('Full name', {exact: true}).fill('Unsaved review-only name');
  const before = calls.drafts.length;
  await page.getByRole('link', {name: 'Update my saved profile'}).click();
  await expect(page).toHaveURL(`${base}/profile?returnTo=${encodeURIComponent(`/jobs/${jobA}/apply-external`)}`);
  await expect(page.locator('#saved-profile-details')).not.toHaveAttribute('open');
  await page.locator('#saved-profile-details > summary').click();
  await expect(page.getByLabel('Full Name', {exact: true})).toBeVisible();
  await expect(page.getByLabel('Full Name', {exact: true})).toHaveValue(savedDraft.values.applicant_name);
  await page.getByLabel('Full Name', {exact: true}).fill('New saved fictional applicant');
  await page.getByLabel('Personal introduction (written by you)').fill('My newly saved reusable introduction.');
  await page.getByLabel('Nationality', {exact: true}).selectOption('ca');
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  expect(saves).toBe(1);
  await page.getByRole('link', {name: 'Return to application', exact: true}).click();
  await expect(page).toHaveURL(`${base}/jobs/${jobA}/apply-external`);
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toHaveValue('New saved fictional applicant');
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue('My newly saved reusable introduction.');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('ca');
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(calls.drafts.length).toBeGreaterThan(before);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  expect(calls.externalGets).toBe(0);
  expect(calls.externalPosts).toBe(0);
  expect(calls.applicationWrites).toBe(0);
});

test('original-frame navigation during fill warns of uncertain results without retrying', async ({page}) => {
  const calls = await setup(page, {bridgeMode: 'hold-fill'});
  await loadAndFill(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.applicationBridge.pendingFill))).toBe(true);

  const originalFrame = page.frames().find(frame => frame.url() === pageUrl);
  expect(originalFrame).toBeTruthy();
  await originalFrame.evaluate(() => location.reload());
  await expect.poll(() => calls.externalGets).toBe(2);
  const warning = page.getByRole('alert').filter({hasText: 'The original form navigated while filling.'});
  await expect(warning).toContainText('Some answers may already be filled');
  await expect(warning).toContainText('No automatic retry or submission was made.');
  await expect(page.getByRole('button', {name: 'Filling application form…'})).toBeDisabled();
  await page.evaluate(() => window.applicationBridge.pendingFill(structuredClone(window.applicationBridge.pendingFillResult)));
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  await expect(warning).toBeVisible();
  await expect(page.getByText(/^Filled \d/)).toHaveCount(0);
  expect(await messages(page, 'application-fill')).toHaveLength(1);
  expect(calls.externalPosts).toBe(0);
  expect(calls.applicationWrites).toBe(0);
});

test('signed-out visitors cannot load profile data or an external application frame', async ({page}) => {
  const calls = await setup(page, {signedIn: false});
  await expect(page.locator('body')).toContainText(/Sign in/i);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(calls.drafts).toHaveLength(0);
  expect(calls.externalGets).toBe(0);
});

test('the click freezes displayed values and countries while the fresh inspection is pending', async ({page}) => {
  await setup(page, {bridgeMode: 'hold-inspect'});
  await loadAndFill(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.applicationBridge.pendingInspect))).toBe(true);
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Full name', {exact: true})).toBeDisabled();
  await expect(page.getByLabel('Nationality', {exact: true})).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Reload saved details'})).toBeDisabled();
  await page.evaluate(() => {
    const input = document.querySelector('#review-applicant_name');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Not the approved snapshot');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    const country = document.querySelector('#review-country-nationality');
    country.value = 'sg'; country.dispatchEvent(new Event('change', {bubbles: true}));
    window.applicationBridge.pendingInspect(structuredClone(window.applicationBridge.inspect));
  });
  await expect(page.getByText(/^Filled 6/)).toBeVisible();
  const approved = (await messages(page, 'application-fill'))[0].message.approved;
  expect(approved.find(item => item.id === 'applicant_name').value).toBe(savedDraft.values.applicant_name);
  expect(JSON.parse(approved.find(item => item.id === 'applicant_countries').value)).toEqual(savedDraft.countries);
});

test('missing answers do not invent values or prevent other ready fields from filling', async ({page}) => {
  await setup(page, {draftData: {...savedDraft, values: {applicant_name: 'Only this answer exists'}, countries: {nationality: null, campus: null}}});
  await loadAndFill(page);
  await expect(page.getByText(/^Filled 1; skipped 5/)).toBeVisible();
  expect((await messages(page, 'application-fill'))[0].message.approved).toEqual([
    {id: 'applicant_name', value: 'Only this answer exists', confirmed: true},
  ]);
  await expect(page.locator('#applicant_email-reason')).toContainText('No answer provided');
  await expect(page.locator('body')).toContainText('Both nationality and study country are needed');
});

test('an entirely occupied or unsupported form reports reasons without issuing a fill', async ({page}) => {
  await setup(page, {inspection: {fields: fields.map(field => ({...field, occupied: true})), countries_available: false}});
  await loadAndFill(page);
  await expect(page.getByText(/^Filled 0; skipped 6/)).toBeVisible();
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  await expect(page.locator('#applicant_name-reason')).toContainText('left unchanged');
});

test('native email validation prevents sending invalid displayed data', async ({page}) => {
  await setup(page);
  await loadForm(page);
  await page.getByLabel('Contact email', {exact: true}).fill('not-an-email');
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  expect(await page.getByLabel('Contact email', {exact: true}).evaluate(input => input.validity.valid)).toBe(false);
  expect(await messages(page, 'application-inspect')).toHaveLength(0);
  expect(await messages(page, 'application-fill')).toHaveLength(0);
});

test('iframe navigation during inspection prevents the automatic fill dispatch', async ({page}) => {
  const calls = await setup(page, {bridgeMode: 'hold-inspect'});
  await loadAndFill(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.applicationBridge.pendingInspect))).toBe(true);
  await page.frames().find(frame => frame.url() === pageUrl).evaluate(() => location.reload());
  await expect.poll(() => calls.externalGets).toBe(2);
  await expect(page.getByRole('alert')).toContainText('No answers were sent');
  await page.evaluate(() => window.applicationBridge.pendingInspect(structuredClone(window.applicationBridge.inspect)));
  await expect(page.getByRole('button', {name: 'Fill application form', exact: true})).toBeEnabled();
  expect(await messages(page, 'application-fill')).toHaveLength(0);
});

test('an expired inspection never dispatches a fill and a malformed fill report never claims success', async ({page}) => {
  await setup(page, {bridgeMode: 'hold-inspect'});
  await loadAndFill(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.applicationBridge.pendingInspect))).toBe(true);
  await page.evaluate(() => window.applicationBridge.pendingInspect({...window.applicationBridge.inspect, expires_at: Date.now() - 1}));
  await expect(page.getByRole('alert')).toContainText('No answers were sent');
  expect(await messages(page, 'application-fill')).toHaveLength(0);
  await page.evaluate(() => {
    window.applicationBridge.mode = 'normal';
    window.applicationBridge.fill = {ok: true, filled: [], skipped: [], reasons: {}, submitted: true};
  });
  await page.getByRole('button', {name: 'Fill application form', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Some answers may already be filled');
  await expect(page.getByText(/^Filled \d/)).toHaveCount(0);
  expect(await messages(page, 'application-fill')).toHaveLength(1);
});

test('long user-written text remains readable and editable on desktop and mobile', async ({page}) => {
  const text = 'A user-authored account of my fictional project. '.repeat(30) + '我学习计算机。';
  const calls = await setup(page, {draftData: {...savedDraft, values: {...savedDraft.values, applicant_summary: text}}});
  await showLoadedAnswers(page);
  await expect(page.getByLabel('Personal introduction', {exact: true})).toHaveValue(text);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.screenshot({path: `../output/platform-application-${name}.png`, fullPage: true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', {name: 'Load application form'})).toBeVisible();
  }
  expect(calls.externalGets).toBe(0);
  expect(calls.externalPosts).toBe(0);
});
