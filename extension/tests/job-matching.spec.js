import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL to test the matching UI.');
const report = {
  status: 'preliminary', reason: null,
  warnings: ['Extracted requirements have not been human-verified. All comparisons are preliminary.'],
  items: [
    {category: 'required_skills', requirement: 'Python', importance: 'required', outcome: 'supported',
      reason: 'The same skill is explicitly listed in your profile; proficiency is not verified.',
      job_evidence: 'Python required.', profile_evidence: 'Python', profile_field: 'skills'},
    {category: 'required_skills', requirement: 'Java', importance: 'required', outcome: 'gap',
      reason: 'Your profile explicitly states no experience/knowledge of this skill.',
      job_evidence: 'Java required.', profile_evidence: 'No experience with Java', profile_field: 'skills'},
    {category: 'preferred_skills', requirement: 'SQL', importance: 'preferred', outcome: 'unknown',
      reason: 'This skill is not explicitly listed. Missing information is not a proven gap.',
      job_evidence: 'SQL preferred.', profile_evidence: null, profile_field: null},
  ],
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function setup(page, handler, loggedIn = true, job = {}) {
  await page.addInitScript(loggedIn => { if (loggedIn) localStorage.setItem('jobpilot_token', 'test-account-token'); }, loggedIn);
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Fictional Applicant'}}));
  await page.route('**/jobs/match-fixture', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: {
    id: 'match-fixture', title: 'Fictional developer — test fixture', company: 'Demo only',
    city: 'Singapore', job_type: 'internship', deadline: null, salary_min: null, salary_max: null,
    description: 'Python required. Java required. SQL preferred.', source: {name: 'Offline fixture'}, tags: [], source_url: null, ...job,
  }}));
  await page.route('**/jobs/match-fixture/match-analysis', handler);
  await page.goto(base + '/jobs/match-fixture');
}

test('explicit analysis renders three outcomes and safe paired evidence at desktop/mobile', async ({page}) => {
  let calls = 0;
  await setup(page, route => { calls++; expect(route.request().postDataJSON()).toEqual({}); return route.fulfill({json: report}); });
  await expect(page.getByRole('button', {name: 'Analyze my match'})).toBeVisible();
  expect(calls).toBe(0);
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.getByText('Preliminary evidence comparison — not an eligibility decision')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Explicit gaps to review'})).toBeVisible();
  await page.getByText('Compare evidence', {exact: true}).first().click();
  await expect(page.locator('.job-match dd').first()).toHaveText('Python required.');
  await page.setViewportSize({width: 1440, height: 1000});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: '../output/match-desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: '../output/match-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('missing or stale extraction is explained without fabricated matches', async ({page}) => {
  await setup(page, route => route.fulfill({json: {...report, status: 'unavailable', reason: 'stale_extraction', items: []}}));
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.getByText('Analysis unavailable', {exact: true})).toBeVisible();
  await expect(page.locator('.job-match')).toContainText('Updated extraction is needed');
  await expect(page.locator('.job-match-group')).toHaveCount(0);
});

test('network failure allows retry and new results replace old ones', async ({page}) => {
  let fail = true;
  await setup(page, route => fail ? route.fulfill({status: 503, json: {}}) : route.fulfill({json: report}));
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.getByRole('alert')).toContainText('Could not analyze');
  fail = false;
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.locator('.job-match-group')).toHaveCount(4);
});

test('logged-out users are asked to sign in without sending profile analysis', async ({page}) => {
  let calls = 0;
  await setup(page, route => { calls++; return route.fulfill({json: report}); }, false);
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot');
  expect(calls).toBe(0);
});

test('account change while request is pending cannot expose previous account results', async ({page, context}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  const credentials = [];
  const privateA = 'Private account A evidence must never appear for B';
  const evidenceB = 'Current account B evidence from a fresh explicit analysis';
  await setup(page, async route => {
    const authorization = route.request().headers().authorization;
    credentials.push(authorization);
    if (authorization === 'Bearer test-account-token') {
      started.resolve();
      await release.promise;
      await route.fulfill({json: {...report, items: [{...report.items[0], profile_evidence: privateA}]}});
      answered.resolve();
    } else {
      expect(authorization).toBe('Bearer another-account');
      await route.fulfill({json: {...report, items: [{...report.items[0], profile_evidence: evidenceB}]}});
    }
  });
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await started.promise;
  await expect(page.getByRole('button', {name: 'Analyzing…'})).toBeDisabled();
  const other = await context.newPage();
  await other.goto(base + '/');
  await other.evaluate(() => {
    localStorage.setItem('jobpilot_token', 'another-account');
  });
  await expect(page.getByRole('button', {name: 'Analyze my match'})).toBeEnabled();
  release.resolve();
  await answered.promise;
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privateA);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe('another-account');
  expect(credentials).toEqual(['Bearer test-account-token']);
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.locator('.job-match-group')).toHaveCount(4);
  await page.getByText('Compare evidence', {exact: true}).click();
  await expect(page.locator('.job-match dd').last()).toHaveText(evidenceB);
  await expect(page.locator('body')).not.toContainText(privateA);
  expect(credentials).toEqual(['Bearer test-account-token', 'Bearer another-account']);
});

test('partial shared skills are separate from unconditional support and retain full evidence', async ({page}) => {
  const partial = {category: 'required_skills', requirement: 'Basic knowledge of AutoCAD.',
    importance: 'required', outcome: 'unknown',
    reason: 'Shared skill mentions only. Proficiency remains unverified.',
    job_evidence: 'Basic knowledge of AutoCAD.', profile_evidence: 'AutoCAD drafting projects', profile_field: 'skills',
    skill_overlaps: [{skill_id: 'autocad', label: 'AutoCAD', kind: 'specific', profile_evidence: 'AutoCAD drafting projects'}]};
  await setup(page, route => route.fulfill({json: {...report, items: [partial]}}), true,
    {title: 'Fictional AutoCAD intern — test fixture', description: 'Basic knowledge of AutoCAD.'});
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  const group = page.locator('.job-match-group').filter({has: page.getByRole('heading', {name: 'Shared skill mentions — conditions unverified'})});
  await expect(group).toContainText('Shared mentions: AutoCAD.');
  await expect(page.locator('.job-match-group').filter({hasText: 'Exact skill entries shared'})).toContainText('No unconditional skill entries');
  await group.getByText('Compare evidence', {exact: true}).click();
  await expect(group.locator('dd').first()).toHaveText('Basic knowledge of AutoCAD.');
  await expect(group.locator('dd').last()).toHaveText('AutoCAD drafting projects');
  await expect(page.locator('.job-match-group li')).toHaveCount(1);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path: `../output/natural-matching-${name}.png`, fullPage: true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('clearing storage in another tab removes displayed private analysis', async ({page, context}) => {
  let calls = 0;
  const privateEvidence = 'Private signed-in profile evidence that must be cleared';
  await setup(page, route => {
    calls++;
    return route.fulfill({json: {...report, items: [{...report.items[0], profile_evidence: privateEvidence}]}});
  });
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.locator('.job-match-group')).toHaveCount(4);
  await page.getByText('Compare evidence', {exact: true}).click();
  await expect(page.locator('.job-match dd').last()).toHaveText(privateEvidence);
  const other = await context.newPage();
  await other.goto(base + '/');
  await other.evaluate(() => localStorage.clear());
  await expect(page.getByRole('button', {name: 'Analyze my match'})).toBeEnabled();
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privateEvidence);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBeNull();
  expect(calls).toBe(1);
  await page.getByRole('button', {name: 'Analyze my match'}).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot');
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  expect(calls).toBe(1);
});
