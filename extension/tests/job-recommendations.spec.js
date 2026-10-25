import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for the isolated unified job recommendation journey.');
const tokenA = 'fixture-recommendation-account-a';
const tokenB = 'fixture-recommendation-account-b';
const runId = '11111111-2222-4333-8444-555555555555';
const jobs = Array.from({length: 22}, (_, index) => ({
  id: `fixture-job-${index}`, title: `Fictional fixture role ${String(index).padStart(2, '0')} — test only`,
  company: 'Fictional fixture company', city: 'Singapore', job_type: index < 18 ? 'internship' : 'graduate',
  deadline: null, posted_at: `2026-10-${String(index + 1).padStart(2, '0')}`,
  salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
  source: {name: 'Isolated fixture board'}, tags: [],
  application_assistance: index === 0 ? 'ats_extension' : 'manual_external',
}));
const report = {
  id: runId, status: 'succeeded', reused: false, is_current: true, input_hash: 'fixture-input-hash',
  provider: 'fixture-provider', model: 'fixture-model', prompt_version: 'fixture-only', execution_mode: 'live',
  profile_skill_count: 2, candidates: [{
    id: jobs[0].id, title: jobs[0].title, company: jobs[0].company, city: 'Singapore', job_type: 'internship',
  }],
  result: {requires_review: true, items: [{
    job_id: jobs[0].id, rank: 1, summary: 'Python is explicitly listed in the saved profile and the job. Other conditions need review.',
    warnings: ['Availability is not supplied in the saved profile.'], requirements: [{
      requirement: 'Python', category: 'skill', outcome: 'supported', jd_quote: 'Python required.',
      profile_field: 'skills', profile_quote: 'Python', reason: 'Python is named in both sources; proficiency is not verified.',
    }, {
      requirement: 'Full-time availability', category: 'work_constraint', outcome: 'unknown', jd_quote: 'Full-time availability required.',
      profile_field: null, profile_quote: null, reason: 'The saved profile does not explicitly confirm availability.',
    }],
  }]},
  error_code: null, usage: {input_tokens: 100, output_tokens: 80},
  started_at: '2026-10-24T04:00:00Z', expires_at: '2026-10-24T04:03:00Z', finished_at: '2026-10-24T04:00:05Z',
};
report.advice = {[jobs[0].id]: {
  version: 'action-advice-v5', status: 'check_first', headline: 'Check your full-time availability before applying.',
  reasons: ['Availability is not confirmed.'],
  blockers: [{...report.result.items[0].requirements[1], requirement_index: 1}],
  strengths: [{...report.result.items[0].requirements[0], requirement_index: 0}],
  counts: {supported: 1, gap: 0, unknown: 1},
  application_recommendation: {verdict: 'consider', summary: 'Your Python background is relevant; confirm your full-time availability.',
    strengths: ['Python programming experience'], considerations: ['Full-time availability needs confirmation.']},
}};
report.display_order = [jobs[0].id];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function setup(page, {post, get, authenticated = true, path = '/jobs'} = {}) {
  const calls = {posts: 0, reads: 0, jobs: 0, legacy: 0};
  await page.addInitScript(({token, authenticated}) => {
    if (authenticated) localStorage.setItem('jobpilot_token', token);
  }, {token: tokenA, authenticated});
  await page.route('**/profile', route => route.request().resourceType() === 'document' ? route.continue()
    : route.fulfill({json: {full_name: 'Fictional fixture applicant', skills: ['Python']}}));
  await page.route('**/job-sources/status', route => route.fulfill({json: {sources: []}}));
  await page.route('**/users/me', route => route.fulfill({json: {id: 'fixture-user', role: 'user'}}));
  await page.route(/\/favorites(\?.*)?$/, route => route.fulfill({json: {items: [], total: 0, pages: 1}}));
  await page.route(/\/jobs(\?.*)?$/, route => {
    if (route.request().resourceType() === 'document') return route.continue();
    calls.jobs++;
    return route.fulfill({json: {items: jobs, total: jobs.length, pages: 1}});
  });
  await page.route('**/jobs/recommendations', route => { calls.legacy++; return route.fulfill({status: 500, json: {detail: 'Legacy flow must not be called'}}); });
  await page.route('**/jobs/ai-recommendations/candidates*', route => { calls.legacy++; return route.fulfill({status: 500, json: {detail: 'No manual candidate step'}}); });
  await page.route('**/jobs/ai-recommendations', route => {
    calls.posts++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({confirmed: true});
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    return post ? post(route, calls) : route.fulfill({status: 201, json: report});
  });
  await page.route(`**/ai-recommendations/${runId}`, route => {
    calls.reads++;
    expect(route.request().method()).toBe('GET');
    return get ? get(route, calls) : route.fulfill({json: {...report, reused: true}});
  });
  await page.goto(base + path);
  return calls;
}

test('one explicit recommendation entry uses the saved profile and replaces the browse list', async ({page}) => {
  const calls = await setup(page);
  await expect(page.locator('.job-card')).toHaveCount(10);
  await expect(page.locator('.job-card').first()).toContainText('Assisted filling · extension required');
  await expect(page.getByRole('button', {name: 'Recommend to me', exact: true})).toHaveCount(1);
  await expect(page.getByRole('button', {name: 'Find jobs for me'})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'AI recommendations'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Load candidate jobs'})).toHaveCount(0);
  expect(calls.posts).toBe(0);
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Recommended for you'})).toBeVisible();
  await expect(page.locator('.ai-run-state')).toContainText('Live AI');
  await expect(page.locator('.ai-run-state')).not.toContainText('Needs your review');
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  await expect(page.locator('.job-card')).toHaveCount(0);
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByRole('complementary', {name: 'Filters'})).toHaveCount(0);
  await expect(page.locator('.ai-ranked-jobs')).toContainText(report.advice[jobs[0].id].application_recommendation.summary);
  await expect(page.locator('.ai-ranked-jobs').getByText(report.result.items[0].warnings[0], {exact: true})).not.toBeVisible();
  await expect(page.locator('.ai-ranked-jobs').getByRole('link', {name: 'Prepare application'})).toHaveAttribute('href', `/jobs/${jobs[0].id}/prepare`);
  expect(calls.posts).toBe(1);
  expect(calls.legacy).toBe(0);
});

test('the product recommendation has at most three strengths and three considerations', async ({page}) => {
  const application_recommendation = {...report.advice[jobs[0].id].application_recommendation,
    strengths: ['First strength.', 'Second strength.', 'Third strength.', 'Fourth strength.'],
    considerations: ['First condition.', 'Second condition.', 'Third condition.', 'Fourth condition.']};
  const verbose = {...report, advice: {[jobs[0].id]: {...report.advice[jobs[0].id], application_recommendation}}};
  await setup(page, {post: route => route.fulfill({json: verbose}), get: route => route.fulfill({json: verbose})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.job-advice-strengths li')).toHaveCount(3);
  await expect(page.locator('.job-advice-considerations li')).toHaveCount(3);
  await expect(page.locator('.job-advice')).not.toContainText('Fourth');
  await expect(page.locator('.job-advice')).not.toContainText('Needs your review');
});

test('recommendations stay focused on the decision and useful conditions without an audit checklist', async ({page}) => {
  await setup(page);
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  const results = page.locator('.ai-ranked-jobs');
  await expect(results.locator('.job-advice-status')).toHaveText('Worth considering');
  await expect(results.locator('.job-advice-strengths')).toContainText('Python programming experience');
  await expect(results.locator('.job-advice-considerations')).toContainText('Full-time availability needs confirmation.');
  await expect(results.locator('.job-advice-evidence, .job-advice-outcome-unknown, .job-advice-quotes')).toHaveCount(0);
  await expect(results).not.toContainText('No explicit saved evidence');
  await expect(page.locator('.ai-run-details')).not.toHaveAttribute('open');
  await expect(results.getByRole('link', {name: 'View job and original posting'})).toHaveAttribute('href', `/jobs/${jobs[0].id}?recommendation_run=${runId}`);
});

test('server action advice order replaces the raw model rank without inventing a percentage', async ({page}) => {
  const second = {...report.result.items[0], job_id: jobs[1].id, rank: 2};
  const reordered = {...report, candidates: [...report.candidates, {...report.candidates[0], id: jobs[1].id, title: jobs[1].title}],
    result: {requires_review: true, items: [report.result.items[0], second]}, display_order: [jobs[1].id, jobs[0].id],
    advice: {...report.advice, [jobs[1].id]: {...report.advice[jobs[0].id], status: 'consider', application_recommendation: {verdict: 'consider', summary: 'This role is relevant to your saved projects.', strengths: ['Software project experience'], considerations: []}}}};
  await setup(page, {post: route => route.fulfill({json: reordered}), get: route => route.fulfill({json: reordered})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-ranked-jobs > li').first()).toContainText(jobs[1].title);
  await expect(page.locator('.ai-ranked-jobs > li').first().locator('.job-advice-summary')).toHaveText('This role is relevant to your saved projects.');
  await expect(page.locator('.ai-rank')).toHaveCount(0);
  await expect(page.locator('.ai-ranked-jobs')).not.toContainText('%');
});

test('Show all jobs restores filters, sorting and page without a model or job request', async ({page}) => {
  const calls = await setup(page);
  await expect(page.locator('.job-card')).toHaveCount(10);
  await page.getByRole('group', {name: 'Job type', exact: true}).getByRole('checkbox', {name: /internship/}).check();
  await page.getByLabel('Sort by').selectOption('newest');
  await page.getByRole('button', {name: 'Next', exact: true}).click();
  await expect(page.getByRole('button', {name: '2', exact: true})).toHaveAttribute('aria-current', 'page');
  const before = await page.locator('.job-card h3').allTextContents();
  const jobsBefore = calls.jobs;
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  await expect(page.locator('.job-card')).toHaveCount(before.length);
  expect(await page.locator('.job-card h3').allTextContents()).toEqual(before);
  await expect(page.getByRole('group', {name: 'Job type', exact: true}).getByRole('checkbox', {name: /internship/})).toBeChecked();
  await expect(page.getByLabel('Sort by')).toHaveValue('newest');
  await expect(page.getByRole('button', {name: '2', exact: true})).toHaveAttribute('aria-current', 'page');
  await expect(page).not.toHaveURL(/ai_run=/);
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  expect(calls.posts).toBe(1);
  expect(calls.jobs).toBe(jobsBefore);
});

test('browse location, sorting and page survive recommendation-detail-back navigation', async ({page}) => {
  const calls = await setup(page);
  await page.route(new RegExp(`/jobs/${jobs[0].id}(?:/(?:ai-assessment|application-context))?(?:\\?.*)?$`), route => {
    if (route.request().resourceType() === 'document') return route.continue();
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/ai-assessment')) return route.fulfill({json: {job_id: jobs[0].id, status: 'not_analyzed', assessment: null, advice: null}});
    if (path.endsWith('/application-context')) return route.fulfill({json: {job: jobs[0], channel: 'external', profile: {}, instructions: [], original_application_url: null}});
    return route.fulfill({json: {...jobs[0], status: 'active', description: 'Fixture detail used only for navigation.'}});
  });
  await expect(page.locator('.job-card')).toHaveCount(10);
  await page.getByLabel('Location', {exact: true}).fill('Singapore');
  await page.getByLabel('Sort by').selectOption('newest');
  await page.getByRole('button', {name: 'Next', exact: true}).click();
  await expect(page.getByRole('button', {name: '2', exact: true})).toHaveAttribute('aria-current', 'page');
  const before = await page.locator('.job-card h3').allTextContents();
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  await page.getByRole('link', {name: 'View job and original posting', exact: true}).click();
  await expect(page.getByRole('heading', {name: jobs[0].title, exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Back to Jobs', exact: true}).click();
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  await page.getByRole('button', {name: 'Show all jobs', exact: true}).click();
  await expect(page.getByLabel('Location', {exact: true})).toHaveValue('Singapore');
  await expect(page.getByLabel('Sort by')).toHaveValue('newest');
  await expect(page.getByRole('button', {name: '2', exact: true})).toHaveAttribute('aria-current', 'page');
  expect(await page.locator('.job-card h3').allTextContents()).toEqual(before);
  expect(calls.posts).toBe(1);
});

test('a valid recommendation with no strengths remains a complete result, without invented positives', async ({page}) => {
  const application_recommendation = {verdict: 'not_priority', summary: 'Your software background is a different direction from this HR role.',
    strengths: [], considerations: ['This role focuses on HR, Business or Psychology qualifications.']};
  const unrelated = {...report, advice: {[jobs[0].id]: {...report.advice[jobs[0].id], application_recommendation}}};
  await setup(page, {post: route => route.fulfill({json: unrelated}), get: route => route.fulfill({json: unrelated})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.job-advice-status')).toHaveText('Not a priority');
  await expect(page.locator('.job-advice-summary')).toHaveText(application_recommendation.summary);
  await expect(page.locator('.job-advice-strengths')).toHaveCount(0);
  await expect(page.locator('.job-advice-considerations')).toContainText('HR, Business or Psychology');
  await expect(page.locator('.job-fit-heading, .job-fit-counts, .job-advice-pending')).toHaveCount(0);
  await expect(page.locator('.job-advice')).toHaveAttribute('data-advice-status', 'not_priority');
});

test('requesting the same saved inputs displays the reused result', async ({page}) => {
  const calls = await setup(page, {post: (route, state) => route.fulfill({status: state.posts === 1 ? 201 : 200, json: {...report, reused: state.posts > 1}})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-run-state')).toContainText('Saved result');
  await page.getByText('About this analysis', {exact: true}).click();
  await expect(page.locator('.ai-run-details')).toContainText('This view uses a saved result.');
  expect(calls.posts).toBe(2); // The server owns hash-based caching; UI never auto-retries.
  expect(calls.legacy).toBe(0);
});

for (const [status, detail, text] of [
  [422, 'profile_needed', 'Save your skills, education or project experience'],
  [422, 'no_candidates', 'No current jobs with enough profile relevance'],
  [429, '', 'AI request limit'],
  [503, '', 'AI model is unavailable'],
]) test(`HTTP ${status} ${detail || 'failure'} explains recovery without a ranking or automatic retry`, async ({page}) => {
  const calls = await setup(page, {post: route => route.fulfill({status, json: {detail}})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-recommendations').getByRole('alert')).toContainText(text);
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Recommend to me', exact: true})).toBeEnabled();
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  await expect(page.locator('.job-card')).toHaveCount(10);
  expect(calls.posts).toBe(1);
});

test('a rejected model output is never rendered as a recommendation', async ({page}) => {
  const failed = {...report, status: 'failed', result: null, error_code: 'invalid_evidence'};
  const calls = await setup(page, {post: route => route.fulfill({json: failed}), get: route => route.fulfill({json: failed})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.ai-recommendations').getByRole('alert')).toContainText('could not complete these recommendations reliably');
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  expect(calls.posts).toBe(1);
});

test('running state can return from Show all jobs using only saved GET status checks', async ({page}) => {
  const running = {...report, status: 'running', result: null, finished_at: null};
  const calls = await setup(page, {post: route => route.fulfill({status: 202, json: running}), get: route => route.fulfill({json: running})});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Check saved status'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Finding recommendations…'})).toBeDisabled();
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  await expect(page.locator('.job-card')).toHaveCount(10);
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Check saved status'})).toBeVisible();
  expect(calls.posts).toBe(1);
  expect(calls.reads).toBeGreaterThan(0);
});

test('restoring an ai_run link is read-only and Show all removes the restoration parameter', async ({page}) => {
  const calls = await setup(page, {path: `/jobs?ai_run=${runId}`});
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  expect(calls.posts).toBe(0);
  expect(calls.reads).toBeGreaterThan(0);
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  await expect(page.locator('.job-card')).toHaveCount(10);
  await expect(page).not.toHaveURL(/ai_run=/);
  expect(calls.posts).toBe(0);
});

for (const changed of ['profile', 'job description', 'analysis rules']) test(`a historical run after ${changed} changes does not display a stale recommendation or private audit checklist`, async ({page}) => {
  const historical = {...report, is_current: false, advice: {}, display_order: []};
  const calls = await setup(page, {path: `/jobs?ai_run=${runId}`, get: route => route.fulfill({json: historical})});
  await expect(page.getByRole('heading', {name: 'Historical comparison'})).toBeVisible();
  await expect(page.locator('.ai-notice')).toContainText('no new analysis starts automatically');
  await expect(page.locator('.ai-run-state')).toContainText('Out of date');
  await expect(page.locator('.job-advice-status')).toHaveCount(0);
  await expect(page.locator('.job-advice-headline')).toHaveCount(0);
  await expect(page.locator('.ai-recommendations')).not.toContainText('ranked using your saved profile');
  await expect(page.locator('.ai-ranked-jobs').getByRole('link', {name: 'Prepare application'})).toHaveCount(0);
  await expect(page.locator('.job-advice-summary, .job-advice-evidence, .job-advice-quotes')).toHaveCount(0);
  await expect(page.locator('.ai-ranked-jobs')).not.toContainText(report.advice[jobs[0].id].application_recommendation.summary);
  await expect(page.getByRole('button', {name: 'Recommend to me', exact: true})).toBeEnabled();
  expect(calls.posts).toBe(0);
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  await expect(page.locator('.job-card')).toHaveCount(10);
  await expect(page).not.toHaveURL(/ai_run=/);
  expect(calls.posts).toBe(0);
});

test('a delayed saved-run GET cannot reopen recommendations after Show all jobs', async ({page}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  const calls = await setup(page, {path: `/jobs?ai_run=${runId}`, get: async route => {
    started.resolve();
    await release.promise;
    try { await route.fulfill({json: report}); } finally { answered.resolve(); }
  }});
  await started.promise;
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  release.resolve();
  await answered.promise;
  await expect(page.locator('.job-card')).toHaveCount(10);
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  await expect(page).not.toHaveURL(/ai_run=/);
  expect(calls.posts).toBe(0);
});

test('an already-started POST may finish without reopening recommendations after Show all jobs', async ({page}) => {
  const started = deferred(), release = deferred();
  const calls = await setup(page, {post: async route => {
    started.resolve();
    await release.promise;
    return route.fulfill({json: report});
  }});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await started.promise;
  await page.getByRole('button', {name: 'Show all jobs'}).click();
  release.resolve();
  await expect(page.getByRole('button', {name: 'Recommend to me', exact: true})).toBeEnabled();
  await expect(page.locator('.job-card')).toHaveCount(10);
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  await expect(page).not.toHaveURL(/ai_run=/);
  expect(calls.posts).toBe(1);
});

test('signed out users cannot trigger a model call', async ({page}) => {
  const calls = await setup(page, {authenticated: false});
  await expect(page.getByRole('button', {name: 'Recommend to me', exact: true})).toBeDisabled();
  await expect(page.locator('.recommendation-toolbar')).toContainText('Sign in');
  await expect(page.locator('.job-card')).toHaveCount(10);
  expect(calls.posts).toBe(0);
});

test('account replacement discards an in-flight private result', async ({page}) => {
  const started = deferred(), release = deferred();
  const calls = await setup(page, {post: async route => { started.resolve(); await release.promise; await route.fulfill({json: report}); }});
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await started.promise;
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenB});
  release.resolve();
  await expect(page.getByRole('button', {name: 'Recommend to me', exact: true})).toBeEnabled();
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(report.advice[jobs[0].id].application_recommendation.summary);
  expect(calls.posts).toBe(1);
});

test('recommended job favorite action uses the existing account endpoint', async ({page}) => {
  await setup(page);
  let saved = 0;
  await page.route(`**/jobs/${jobs[0].id}/favorite`, route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    saved++;
    return route.fulfill({status: 201, json: {job_id: jobs[0].id}});
  });
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await page.getByRole('button', {name: `Save job: ${jobs[0].title}`, exact: true}).click();
  await expect(page.getByRole('button', {name: `Remove from saved: ${jobs[0].title}`, exact: true})).toHaveAttribute('aria-pressed', 'true');
  expect(saved).toBe(1);
});

test('switching accounts on a saved run removes the previous account result before access is denied', async ({page}) => {
  const calls = await setup(page, {path: `/jobs?ai_run=${runId}`, get: route => route.request().headers().authorization === `Bearer ${tokenB}`
    ? route.fulfill({status: 404, json: {detail: 'Not found'}}) : route.fulfill({json: report})});
  await expect(page.locator('.ai-ranked-jobs > li')).toHaveCount(1);
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenB});
  await expect(page.locator('.ai-recommendations').getByRole('alert')).toContainText('unavailable for your account');
  await expect(page.locator('.ai-ranked-jobs')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(report.advice[jobs[0].id].application_recommendation.summary);
  expect(calls.posts).toBe(0);
});
