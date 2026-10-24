import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for the isolated saved job advice journey.');
const tokenA = 'fixture-advice-account-a', tokenB = 'fixture-advice-account-b';
const jobId = 'advice-fixture';
const runId = '33333333-4444-4555-8666-777777777777';
const job = {
  id: jobId, status: 'active', title: 'Fictional developer — test fixture', company: 'Offline fixture company',
  city: 'Singapore', job_type: 'internship', deadline: null, salary_min: null, salary_max: null,
  description: 'About this role\n\nBuild tools.\n\nRequirements:\n- Python\n- Graduate in 2028',
  description_blocks: [{kind: 'heading', text: 'About this role'}, {kind: 'paragraph', text: 'Build tools.'},
    {kind: 'heading', text: 'Requirements'}, {kind: 'list', items: ['Python', 'Graduate in 2028'], ordered: false}],
  source: {name: 'Offline fixture'}, tags: [], source_url: null, apply_url: null,
};
const assessment = {
  job_id: jobId, rank: 1, summary: 'Long model summary must not be the application decision.', warnings: ['Check the original job description.'],
  requirements: [{
    requirement: 'Graduate in 2028', category: 'education', outcome: 'unknown',
    jd_quote: 'Graduate in 2028', profile_field: 'education', profile_quote: 'Master programme, 2026',
    reason: 'The saved graduation timing does not confirm the required cohort.',
  }, {
    requirement: 'Python', category: 'skill', outcome: 'supported', jd_quote: 'Python required.',
    profile_field: 'skills', profile_quote: 'Python', reason: 'Python is named in both sources; proficiency is not verified.',
  }, {
    requirement: 'SQL', category: 'skill', outcome: 'unknown', jd_quote: 'SQL preferred.',
    profile_field: null, profile_quote: null, reason: 'No explicit saved SQL evidence; this does not prove a gap.',
  }, {
    requirement: 'Develop software tools', category: 'responsibility', outcome: 'unknown', jd_quote: 'Develop software tools.',
    profile_field: 'experience', profile_quote: 'Built an internal application.', reason: 'Related project activity does not confirm this complete duty.',
  }],
};
const advice = {
  version: 'action-advice-v3', status: 'check_first', headline: 'Check the graduation cohort before applying.',
  reasons: ['The required cohort is not confirmed.'], blockers: [{...assessment.requirements[0], requirement_index: 0}],
  strengths: [{...assessment.requirements[1], requirement_index: 1}], counts: {supported: 1, gap: 0, unknown: 3},
};
const available = {
  job_id: jobId, status: 'available', source_run_id: runId, assessment, advice,
  execution_mode: 'live', model: 'fixture-model', finished_at: '2026-10-24T04:00:00Z', reason: null,
};
const missing = status => ({...available, status, assessment: null, advice: null,
  source_run_id: status === 'not_analyzed' ? null : runId, model: null, finished_at: null});
const run = {id: runId, status: 'succeeded', reused: false, result: {requires_review: true, items: [assessment]},
  advice: {[jobId]: advice}, display_order: [jobId], candidates: [{id: jobId, title: job.title, company: job.company}],
  execution_mode: 'live', provider: 'fixture-only', model: 'fixture-model', usage: {input_tokens: 20, output_tokens: 20}};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function setup(page, {initial = available, afterPost = available, get, post, authenticated = true, changes = {}, query = ''} = {}) {
  const calls = {reads: 0, posts: 0, legacy: 0};
  await page.addInitScript(({authenticated, token}) => { if (authenticated) localStorage.setItem('jobpilot_token', token); }, {authenticated, token: tokenA});
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Fictional applicant'}}));
  await page.route('**/users/me', route => route.fulfill({json: {id: 'fixture-user', role: 'user'}}));
  await page.route('**/job-sources/status', route => route.fulfill({json: {sources: []}}));
  await page.route(/\/favorites(\?.*)?$/, route => route.fulfill({json: {items: [], total: 0, pages: 1}}));
  await page.route(/\/jobs(\?.*)?$/, route => route.request().resourceType() === 'document' ? route.continue()
    : route.fulfill({json: {items: [job], total: 1, pages: 1}}));
  await page.route(`**/jobs/${jobId}`, route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: {...job, ...changes}}));
  await page.route(`**/jobs/${jobId}/match-analysis`, route => { calls.legacy++; return route.fulfill({status: 500, json: {detail: 'Legacy flow must not run'}}); });
  await page.route(`**/jobs/${jobId}/ai-assessment`, route => {
    calls.reads++;
    expect(route.request().method()).toBe('GET');
    return get ? get(route, calls) : route.fulfill({json: calls.posts ? afterPost : initial});
  });
  await page.route('**/jobs/ai-recommendations', route => {
    calls.posts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    expect(route.request().postDataJSON()).toEqual({confirmed: true, job_ids: [jobId]});
    return post ? post(route, calls) : route.fulfill({status: 201, json: run});
  });
  await page.goto(`${base}/jobs/${jobId}${query}`);
  await expect(page.getByRole('heading', {name: job.title, exact: true})).toBeVisible();
  return calls;
}

test('opening a detail reuses a valid saved assessment for free and shares the application advice', async ({page}) => {
  const calls = await setup(page);
  const section = page.locator('.job-ai-advice');
  await expect(section).toContainText(advice.headline);
  await expect(section.locator('.job-advice-status')).toHaveText('Check conditions first');
  await expect(section).toContainText('Opening this page did not call the model.');
  await expect(section).toContainText('AI-assisted advice, not a hiring decision.');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Check my match'})).toHaveCount(0);
  await expect(page.locator('.job-advice-headline')).not.toContainText(assessment.summary);
  expect(calls.reads).toBeGreaterThan(0);
  expect(calls.posts).toBe(0);
  expect(calls.legacy).toBe(0);
});

test('the main advice prioritizes the cohort condition while preserving source quotes in collapsed evidence', async ({page}) => {
  await setup(page);
  await expect(page.locator('.job-advice-reasons')).toContainText('The required cohort is not confirmed.');
  await expect(page.locator('.job-advice-evidence dd').first()).not.toBeVisible();
  await page.getByText('Review 4 requirements and source quotes', {exact: true}).click();
  await expect(page.locator('.job-advice-evidence')).toContainText('Original AI assessments may still be uncertain. Application advice applies extra conservative evidence checks.');
  await expect(page.locator('.job-advice-quotes dd').first()).toHaveText('Graduate in 2028');
  await expect(page.locator('.job-advice-outcome-supported')).toHaveText('Supported');
  await expect(page.locator('.job-advice-outcome-unknown')).toHaveCount(3);
  await expect(page.locator('.job-advice-requirements')).toContainText('this does not prove a gap');
  await expect(page.locator('.job-advice-requirements')).toContainText('Related project activity does not confirm this complete duty.');
  await expect(page.locator('.job-advice-outcome-gap')).toHaveCount(0);
});

for (const status of ['not_analyzed', 'outdated', 'failed']) test(`${status} needs an explicit single-job request, with no automatic model retry`, async ({page}) => {
  const calls = await setup(page, {initial: missing(status)});
  const button = page.getByRole('button', {name: 'Analyze this job', exact: true});
  await expect(button).toBeVisible();
  await expect(page.locator('.job-ai-consent')).toContainText('may incur a charge');
  expect(calls.posts).toBe(0);
  await button.click();
  await expect(page.locator('.job-advice-headline')).toHaveText(advice.headline);
  await expect(button).toHaveCount(0);
  expect(calls.posts).toBe(1);
  expect(calls.reads).toBeGreaterThan(1);
});

test('an outdated cache never displays its previous advice as current', async ({page}) => {
  await setup(page, {initial: {...available, status: 'outdated'}});
  await expect(page.locator('.job-ai-advice')).toContainText('previous result is no longer current');
  await expect(page.locator('.job-advice')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toBeVisible();
});

test('an unavailable or closed posting has no paid analysis entry', async ({page}) => {
  const calls = await setup(page, {initial: missing('unavailable'), changes: {status: 'closed'}});
  await expect(page.locator('.job-ai-advice')).toContainText('not available for a current AI assessment');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  expect(calls.posts).toBe(0);
});

test('a running saved analysis uses bounded free status checks rather than another POST', async ({page}) => {
  let ready = false;
  const calls = await setup(page, {get: route => route.fulfill({json: ready ? available : missing('running')})});
  await expect(page.getByRole('button', {name: 'Check saved status'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  ready = true;
  await page.getByRole('button', {name: 'Check saved status'}).click();
  await expect(page.locator('.job-advice-headline')).toHaveText(advice.headline);
  expect(calls.posts).toBe(0);
});

test('free lookup failure offers a free retry, without implicitly starting analysis', async ({page}) => {
  let fail = true;
  const calls = await setup(page, {get: route => route.fulfill(fail ? {status: 503, json: {}} : {json: available})});
  await expect(page.locator('.job-ai-advice').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  fail = false;
  await page.getByRole('button', {name: 'Check saved status'}).click();
  await expect(page.locator('.job-advice-headline')).toHaveText(advice.headline);
  expect(calls.posts).toBe(0);
});

test('a paid request failure leaves no invented recommendation and never auto-retries', async ({page}) => {
  const calls = await setup(page, {initial: missing('not_analyzed'), post: route => route.fulfill({status: 503, json: {}})});
  await page.getByRole('button', {name: 'Analyze this job'}).click();
  await expect(page.locator('.job-ai-advice').getByRole('alert')).toContainText('AI model is unavailable');
  await expect(page.locator('.job-advice')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Check saved status'})).toBeVisible();
  expect(calls.posts).toBe(1);
});

test('mock saved assessments stay visibly identified outside collapsed evidence', async ({page}) => {
  await setup(page, {initial: {...available, execution_mode: 'mock'}});
  await expect(page.locator('.job-ai-notice')).toHaveText('Mock preview: this is not a live AI recommendation.');
  await expect(page.locator('.job-advice-evidence dd').first()).not.toBeVisible();
});

test('saved availability is shown as existing profile evidence rather than requested again', async ({page}) => {
  const availability = {...assessment.requirements[0], requirement: 'Available January to June', category: 'work_constraint', outcome: 'supported',
    jd_quote: 'Available January to June', profile_field: 'availability', profile_quote: 'January to June 2027', reason: 'Saved availability covers the stated period.'};
  await setup(page, {initial: {...available, assessment: {...assessment, requirements: [availability]}}});
  await page.getByText('Review 1 requirement and source quotes', {exact: true}).click();
  await expect(page.locator('.job-advice-quotes')).toContainText('Saved availability');
  await expect(page.locator('.job-advice-quotes')).toContainText('January to June 2027');
});

test('structured job descriptions render headings, paragraphs and ordered or unordered lists', async ({page}) => {
  await setup(page, {changes: {description_blocks: [...job.description_blocks, {kind: 'list', ordered: true, items: ['First step', 'Second step']}]}});
  const description = page.getByRole('region', {name: 'Job Description'});
  await expect(description.getByRole('heading', {name: 'About this role'})).toBeVisible();
  await expect(description.locator('p')).toHaveText('Build tools.');
  await expect(description.locator('ul li')).toHaveText(['Python', 'Graduate in 2028']);
  await expect(description.locator('ol li')).toHaveText(['First step', 'Second step']);
});

test('newline descriptions retain paragraphs and bullets when structured blocks are absent', async ({page}) => {
  await setup(page, {changes: {description_blocks: null}});
  const description = page.getByRole('region', {name: 'Job Description'});
  await expect(description.getByRole('heading', {name: 'Requirements:'})).toBeVisible();
  await expect(description.locator('ul li')).toHaveText(['Python', 'Graduate in 2028']);
  await expect(description).toContainText('Build tools.');
});

test('JD blocks and private evidence are escaped text, never executable HTML', async ({page}) => {
  const markup = '<img src=x onerror="window.fixtureExecuted=true">';
  const unsafe = {...available, assessment: {...assessment, requirements: [{...assessment.requirements[0], jd_quote: markup, profile_quote: markup}]}};
  await setup(page, {initial: unsafe, changes: {description_blocks: [{kind: 'paragraph', text: markup}]}});
  await expect(page.locator('.job-description')).toContainText(markup);
  await page.getByText('Review 1 requirement and source quotes', {exact: true}).click();
  await expect(page.locator('.job-advice-quotes')).toContainText(markup);
  await expect(page.locator('.job-description img, .job-advice img')).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureExecuted)).toBeUndefined();
});

test('signed out users do not request private saved advice or start a model call', async ({page}) => {
  const calls = await setup(page, {authenticated: false});
  await expect(page.locator('.job-ai-advice')).toContainText('Sign in');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  expect(calls.reads).toBe(0);
  expect(calls.posts).toBe(0);
});

test('account replacement while a GET is pending cannot show the old private advice', async ({page}) => {
  const started = deferred(), release = deferred();
  await setup(page, {get: async route => {
    if (route.request().headers().authorization === `Bearer ${tokenB}`) return route.fulfill({json: missing('not_analyzed')});
    started.resolve(); await release.promise; return route.fulfill({json: available});
  }});
  await started.promise;
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenB});
  release.resolve();
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(advice.headline);
});

test('clearing storage removes displayed private advice immediately', async ({page}) => {
  await setup(page);
  await expect(page.locator('.job-advice-headline')).toHaveText(advice.headline);
  await page.evaluate(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', {key: null})); });
  await expect(page.locator('.job-ai-advice')).toContainText('Sign in');
  await expect(page.locator('body')).not.toContainText(advice.headline);
});

test('account replacement cancels an in-flight paid request without exposing its result', async ({page}) => {
  const started = deferred(), release = deferred();
  const calls = await setup(page, {initial: missing('not_analyzed'), post: async route => {
    started.resolve(); await release.promise; return route.fulfill({json: run});
  }, get: route => route.fulfill({json: missing('not_analyzed')})});
  await page.getByRole('button', {name: 'Analyze this job'}).click();
  await started.promise;
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenB});
  release.resolve();
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toBeEnabled();
  await expect(page.locator('body')).not.toContainText(advice.headline);
  expect(calls.posts).toBe(1);
});

test('the list return target accepts only a recommendation UUID rather than an external URL', async ({page}) => {
  await setup(page, {query: `?recommendation_run=${runId}`});
  await page.getByRole('button', {name: 'Back to Jobs', exact: true}).click();
  await expect(page).toHaveURL(`${base}/jobs?ai_run=${runId}`);
  await page.goto(`${base}/jobs/${jobId}?recommendation_run=${encodeURIComponent('https://example.test/escape')}`);
  await page.getByRole('button', {name: 'Back to Jobs', exact: true}).click();
  await expect(page).toHaveURL(`${base}/jobs`);
});
