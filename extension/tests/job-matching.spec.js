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
  version: 'action-advice-v5', status: 'check_first', headline: 'Check the graduation cohort before applying.',
  reasons: ['The required cohort is not confirmed.'], blockers: [{...assessment.requirements[0], requirement_index: 0}],
  strengths: [{...assessment.requirements[1], requirement_index: 1}], counts: {supported: 1, gap: 0, unknown: 3},
  application_recommendation: {verdict: 'consider', summary: 'Your Python background is relevant; confirm the graduation cohort.',
    strengths: ['Python programming experience'], considerations: ['The required graduation cohort is not confirmed.']},
};
const available = {
  job_id: jobId, status: 'available', source_run_id: runId, assessment, advice,
  context_hash: 'a'.repeat(64),
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
    expect([`Bearer ${tokenA}`, `Bearer ${tokenB}`]).toContain(route.request().headers().authorization);
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
  await expect(section).toContainText(advice.application_recommendation.summary);
  await expect(section.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  await expect(section.locator('.job-fit-counts, .job-fit-heading')).toHaveCount(0);
  await expect(section.getByRole('heading', {name: 'Application recommendation', exact: true})).toBeVisible();
  await expect(section.locator('.job-advice-status')).toHaveText('Worth considering');
  await expect(section.locator('.job-ai-about')).not.toHaveAttribute('open');
  await expect(section).not.toContainText('verified');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Check my match'})).toHaveCount(0);
  await expect(page.locator('.job-advice-summary')).not.toContainText(assessment.summary);
  expect(calls.reads).toBeGreaterThan(0);
  expect(calls.posts).toBe(0);
  expect(calls.legacy).toBe(0);
});

test('the main recommendation has two concise groups without the old audit checklist', async ({page}) => {
  await setup(page);
  await expect(page.getByRole('region', {name: 'Strengths', exact: true})).toContainText('Python programming experience');
  await expect(page.getByRole('region', {name: 'Things to consider', exact: true})).toContainText('graduation cohort');
  await expect(page.locator('.job-advice-evidence, .job-advice-requirements, .job-advice-quotes, .job-fit-counts')).toHaveCount(0);
  await expect(page.locator('.job-advice')).not.toContainText('Unknown');
  await expect(page.locator('.job-advice')).not.toContainText('Supported');
  await page.getByText('About this analysis', {exact: true}).click();
  await expect(page.locator('.job-ai-about')).toContainText('fixture-model');
  await expect(page.locator('.job-ai-about')).not.toContainText('Graduate in 2028');
});

for (const [verdict, label] of [['priority_apply', 'Prioritize applying'], ['consider', 'Worth considering'], ['not_priority', 'Not a priority'], ['insufficient_information', 'More information needed']]) test(`the server ${verdict} verdict is displayed without a computed match percentage`, async ({page}) => {
  const product = {...advice.application_recommendation, verdict};
  const calls = await setup(page, {initial: {...available, advice: {...advice, status: 'check_first', counts: {supported: 0, gap: 0, unknown: 8}, application_recommendation: product}}});
  await expect(page.locator('.job-advice-status')).toHaveText(label);
  await expect(page.locator('.job-advice-summary')).toHaveText(product.summary);
  await expect(page.locator('.job-advice')).not.toContainText('%');
  await expect(page.locator('.job-advice')).not.toContainText('Insufficient evidence');
  await expect(page.locator('.job-fit-counts, .job-fit-heading')).toHaveCount(0);
  expect(calls.posts).toBe(0);
});

test('a partial Python background remains useful without claiming the whole C++ requirement is met', async ({page}) => {
  const product = {verdict: 'consider', summary: 'Your Python project is relevant; C++ remains a stretch.',
    strengths: ['Built a Python service'], considerations: ['C++ experience and the internship dates need confirmation.']};
  const calls = await setup(page, {initial: {...available, advice: {...advice, counts: {supported: 0, gap: 0, unknown: 8}, application_recommendation: product}}});
  await expect(page.locator('.job-advice-summary')).toHaveText(product.summary);
  await expect(page.locator('.job-advice-strengths')).toContainText('Built a Python service');
  await expect(page.locator('.job-advice-considerations')).toContainText('C++ experience');
  await expect(page.locator('.job-advice')).not.toContainText('0 supported');
  expect(calls.posts).toBe(0);
});

test('a legacy saved result does not synthesize a product verdict or trigger another model call', async ({page}) => {
  let latest = false;
  const calls = await setup(page, {get: route => route.fulfill({json: latest ? available : {...available, advice: {...advice, application_recommendation: null}}})});
  await expect(page.locator('.job-advice-pending')).toContainText('latest application recommendation is not ready');
  await expect(page.locator('.job-advice-status')).toHaveCount(0);
  await expect(page.locator('.job-ai-advice')).not.toContainText(advice.headline);
  latest = true;
  await page.getByRole('button', {name: 'Refresh status', exact: true}).click();
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(0);
});

for (const status of ['not_analyzed', 'outdated']) test(`${status} automatically starts one current single-job analysis without a manual gate`, async ({page}) => {
  const started = deferred(), release = deferred();
  const calls = await setup(page, {initial: missing(status), post: async route => { started.resolve(); await release.promise; return route.fulfill({json: run}); }});
  await started.promise;
  await expect(page.locator('.job-ai-advice')).toContainText('AI is comparing');
  await expect(page.locator('.job-ai-advice')).toContainText('may incur a charge');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  expect(calls.posts).toBe(1);
  release.resolve();
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(1);
  expect(calls.reads).toBeGreaterThan(1);
});

test('a failed saved analysis never starts another paid request on open or refresh', async ({page}) => {
  let failed = true;
  const calls = await setup(page, {get: route => route.fulfill({json: missing(failed ? 'failed' : 'not_analyzed')})});
  await expect(page.locator('.job-ai-advice')).toContainText('No repeat analysis was started');
  failed = false;
  await page.getByRole('button', {name: 'Refresh status'}).click();
  await expect(page.locator('.job-ai-advice')).toContainText('Your application recommendation is not ready yet');
  expect(calls.posts).toBe(0);
});

test('an outdated cache never displays its previous advice as current', async ({page}) => {
  const release = deferred();
  await setup(page, {initial: {...available, status: 'outdated'}, post: async route => { await release.promise; return route.fulfill({json: run}); }});
  await expect(page.locator('.job-ai-advice')).toContainText('AI is comparing');
  await expect(page.locator('.job-advice')).toHaveCount(0);
  release.resolve();
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
});

test('an unavailable or closed posting has no paid analysis entry', async ({page}) => {
  const calls = await setup(page, {initial: missing('unavailable'), changes: {status: 'closed'}});
  await expect(page.locator('.job-ai-advice')).toContainText('application recommendation is unavailable');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  expect(calls.posts).toBe(0);
});

test('a running saved analysis uses bounded free status checks rather than another POST', async ({page}) => {
  let ready = false;
  const calls = await setup(page, {get: route => route.fulfill({json: ready ? available : missing('running')})});
  await expect(page.locator('.job-ai-advice')).toContainText('AI is comparing');
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  ready = true;
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(0);
});

test('a failed running-status lookup offers a free refresh while preserving the no-repeat-model boundary', async ({page}) => {
  let ready = false;
  const calls = await setup(page, {get: (route, state) => route.fulfill(ready ? {json: available} : state.reads === 1 ? {json: missing('running')} : {status: 503, json: {}})});
  await expect(page.locator('.job-ai-advice').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Refresh status'})).toBeVisible();
  ready = true;
  await page.getByRole('button', {name: 'Refresh status'}).click();
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(0);
});

test('free lookup failure offers a free retry, without implicitly starting analysis', async ({page}) => {
  let fail = true;
  const calls = await setup(page, {get: route => route.fulfill(fail ? {status: 503, json: {}} : {json: available})});
  await expect(page.locator('.job-ai-advice').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Analyze this job'})).toHaveCount(0);
  fail = false;
  await page.getByRole('button', {name: 'Refresh status'}).click();
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(0);
});

test('a paid request failure leaves no invented recommendation and never auto-retries', async ({page}) => {
  const calls = await setup(page, {initial: missing('not_analyzed'), afterPost: missing('not_analyzed'), post: route => route.fulfill({status: 503, json: {}})});
  await expect(page.locator('.job-ai-advice').getByRole('alert')).toContainText('AI is unavailable');
  await expect(page.locator('.job-advice')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Refresh status'})).toBeVisible();
  await page.getByRole('button', {name: 'Refresh status'}).click();
  await page.reload();
  await expect(page.locator('.job-ai-advice').getByRole('alert')).toContainText('already requested');
  expect(calls.posts).toBe(1);
});

test('returning to the same job during analysis uses the running request rather than posting again', async ({page}) => {
  const started = deferred(), release = deferred(); let complete = false;
  const calls = await setup(page, {get: (route, state) => route.fulfill({json: complete ? available : missing(state.posts ? 'running' : 'not_analyzed')}),
    post: async route => { started.resolve(); await release.promise; complete = true; return route.fulfill({json: run}); }});
  await started.promise;
  await page.getByRole('button', {name: 'Back to Jobs', exact: true}).click();
  await page.getByRole('link', {name: job.title, exact: true}).click();
  await expect(page.locator('.job-ai-advice')).toContainText('AI is comparing');
  expect(calls.posts).toBe(1);
  release.resolve();
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(1);
});

test('a changed canonical profile or JD context permits one new analysis while same-context refresh is free', async ({page}) => {
  let changed = false;
  const secondHash = 'b'.repeat(64);
  const calls = await setup(page, {get: (route, state) => {
    const context_hash = changed ? secondHash : available.context_hash;
    return route.fulfill({json: state.posts < (changed ? 2 : 1) ? {...missing(changed ? 'outdated' : 'not_analyzed'), context_hash} : {...available, context_hash}});
  }});
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  expect(calls.posts).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => calls.reads).toBeGreaterThan(2);
  expect(calls.posts).toBe(1);
  changed = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => calls.posts).toBe(2);
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => calls.reads).toBeGreaterThan(4);
  expect(calls.posts).toBe(2);
});

test('an old service without a canonical context never starts an unbound automatic model request', async ({page}) => {
  const calls = await setup(page, {initial: {...missing('not_analyzed'), context_hash: null}});
  await expect(page.locator('.job-ai-advice')).toContainText('latest recommendation is not ready in this service');
  expect(calls.posts).toBe(0);
});

test('mock saved recommendations stay visibly identified outside About this analysis', async ({page}) => {
  await setup(page, {initial: {...available, execution_mode: 'mock'}});
  await expect(page.locator('.job-ai-notice')).toHaveText('Mock preview: this is not a live AI recommendation.');
  await expect(page.locator('.job-ai-about')).not.toHaveAttribute('open');
});

test('saved availability is reflected in the supplied recommendation without requesting it again', async ({page}) => {
  const product = {...advice.application_recommendation, strengths: ['Your January to June 2027 availability fits the stated period.']};
  await setup(page, {initial: {...available, advice: {...advice, application_recommendation: product}}});
  await expect(page.locator('.job-advice-strengths')).toContainText('January to June 2027');
  await expect(page.locator('.job-ai-advice input')).toHaveCount(0);
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

test('JD blocks and product recommendation text are escaped, never executable HTML', async ({page}) => {
  const markup = '<img src=x onerror="window.fixtureExecuted=true">';
  const product = {verdict: 'consider', summary: markup, strengths: [markup], considerations: [markup]};
  await setup(page, {initial: {...available, advice: {...advice, application_recommendation: product}}, changes: {description_blocks: [{kind: 'paragraph', text: markup}]}});
  await expect(page.locator('.job-description')).toContainText(markup);
  await expect(page.locator('.job-advice-summary')).toHaveText(markup);
  await expect(page.locator('.job-advice-strengths li')).toHaveText(markup);
  await expect(page.locator('.job-advice-considerations li')).toHaveText(markup);
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
    if (route.request().headers().authorization === `Bearer ${tokenB}`) return route.fulfill({json: missing('failed')});
    started.resolve(); await release.promise; return route.fulfill({json: available});
  }});
  await started.promise;
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenB});
  release.resolve();
  await expect(page.locator('.job-ai-advice')).toContainText('No repeat analysis was started');
  await expect(page.locator('body')).not.toContainText(advice.application_recommendation.summary);
});

test('clearing storage removes displayed private advice immediately', async ({page}) => {
  await setup(page);
  await expect(page.locator('.job-advice-summary')).toHaveText(advice.application_recommendation.summary);
  await page.evaluate(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', {key: null})); });
  await expect(page.locator('.job-ai-advice')).toContainText('Sign in');
  await expect(page.locator('body')).not.toContainText(advice.application_recommendation.summary);
});

test('account replacement cancels an in-flight paid request without exposing its result', async ({page}) => {
  const started = deferred(), release = deferred();
  const calls = await setup(page, {initial: missing('not_analyzed'), post: async route => {
    started.resolve(); await release.promise; return route.fulfill({json: run});
  }, get: route => route.fulfill({json: missing(route.request().headers().authorization === `Bearer ${tokenB}` ? 'failed' : 'not_analyzed')})});
  await started.promise;
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenB});
  release.resolve();
  await expect(page.locator('.job-ai-advice')).toContainText('No repeat analysis was started');
  await expect(page.locator('body')).not.toContainText(advice.application_recommendation.summary);
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
