import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL to test recommendations.');
const evidence = {
  requirement: 'Python', importance: 'required', reason: 'Python is explicitly listed; proficiency is not verified.',
  job_evidence: 'Python required.', profile_evidence: 'Python',
};
const report = {
  status: 'ready', scanned: 3, evaluated: 2, matched: 1, truncated: false,
  profile_skill_count: 2, preferred_job_type: null,
  excluded: {missing_extraction: 1},
  items: [{job_id: 'fixture', title: 'Fictional Python intern — test only', company: 'Demo only',
    city: 'Singapore', job_type: 'internship', supported: [evidence], gaps: [],
    unknown: [{...evidence, requirement: 'Degree', reason: 'Review education manually.', job_evidence: 'Degree required.', profile_evidence: null}]}],
};
async function setup(page, handler, authenticated = true) {
  await page.addInitScript(authenticated => { if (authenticated) localStorage.setItem('jobpilot_token', 'fixture-token'); }, authenticated);
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Demo applicant'}}));
  await page.route(/\/jobs(\?.*)?$/, route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: {items: [], total: 0}}));
  await page.route('**/jobs/recommendations', handler);
  await page.goto(base + '/jobs');
}
test('explicit request, evidence, detail link and responsive layout', async ({page}) => {
  let calls = 0;
  await setup(page, route => { calls++; expect(route.request().postDataJSON()).toEqual({keyword: '', city: '', job_type: '', limit: 10}); return route.fulfill({json: report}); });
  expect(calls).toBe(0);
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.recommendation-list')).toContainText('Python named in both the JD and your saved skills.');
  await expect(page.locator('.job-recommendations')).toContainText('Using 2 distinct named tool or domain skills');
  await page.getByText('Review reasons and evidence', {exact: true}).click();
  await expect(page.locator('.recommendation-evidence dd').first()).toHaveText('Python required.');
  await expect(page.getByRole('link', {name: 'View job and full analysis'})).toHaveAttribute('href', '/jobs/fixture');
  await page.setViewportSize({width: 1440, height: 1000});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: '../output/recommendations-desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: '../output/recommendations-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const [status, text] of [
  ['profile_needed', 'Add specific tools'],
  ['no_candidates', 'No active, unexpired jobs'],
  ['no_evidence', 'requirements are not ready'],
  ['no_matches', 'No explicit tool or domain-skill overlaps'],
]) test(status + ' is explained without invented suggestions', async ({page}) => {
  await setup(page, route => route.fulfill({json: {...report, status, matched: 0, items: []}}));
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.job-recommendations')).toContainText(text);
  await expect(page.locator('.recommendation-list')).toHaveCount(0);
});
test('failure, retry and filter edits invalidate previous result', async ({page}) => {
  let fail = true;
  let body;
  await setup(page, route => { body = route.request().postDataJSON(); return route.fulfill(fail ? {status: 503, json: {}} : {json: report}); });
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.job-recommendations').getByRole('alert')).toContainText('Could not load');
  fail = false;
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.recommendation-list')).toBeVisible();
  await page.getByLabel('Role or company (optional)').fill('Engineer');
  await expect(page.locator('.recommendation-list')).toHaveCount(0);
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.recommendation-list')).toBeVisible();
  expect(body.keyword).toBe('Engineer');
});
test('signed out does not send a request', async ({page}) => {
  let calls = 0;
  await setup(page, route => { calls++; return route.fulfill({json: report}); }, false);
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.job-recommendations').getByRole('alert')).toContainText('Sign in');
  expect(calls).toBe(0);
});
test('account switch aborts in-flight data', async ({page}) => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  await setup(page, async route => { await waiting; await route.fulfill({json: report}); });
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.getByRole('button', {name: 'Finding jobs…'})).toBeDisabled();
  await page.evaluate(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', {key: null}));
  });
  release();
  await expect(page.locator('.job-recommendations').getByRole('alert')).toContainText('Account changed');
  await expect(page.locator('.recommendation-list')).toHaveCount(0);
});

test('natural-language overlaps never claim the compound requirement is satisfied', async ({page}) => {
  const partial = {...evidence, requirement: 'Comfortable using Microsoft Excel or Google Sheets.',
    reason: 'Shared skill mentions only. Proficiency, years, alternatives and other conditions remain unverified.',
    job_evidence: 'Comfortable using Microsoft Excel or Google Sheets.',
    profile_evidence: 'I use Excel for monthly reports.', outcome: 'unknown',
    skill_overlaps: [{skill_id: 'excel', label: 'Microsoft Excel', kind: 'specific', profile_evidence: 'I use Excel for monthly reports.'}]};
  const natural = {...report, items: [{...report.items[0], title: 'Fictional finance intern — test only', supported: [], overlaps: [partial], unknown: [partial, report.items[0].unknown[0]]}]};
  await setup(page, route => route.fulfill({json: natural}));
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.recommendation-list')).toContainText('Microsoft Excel named in both the JD and your saved skills.');
  await expect(page.locator('.recommendation-list')).toContainText('2 requirements still need');
  await page.getByText('Review reasons and evidence', {exact: true}).click();
  await expect(page.locator('.recommendation-evidence').filter({hasText: 'Comfortable using'})).toHaveCount(1);
  await expect(page.locator('.recommendation-evidence').first()).toContainText('conditions unverified');
  await expect(page.locator('.recommendation-evidence').first()).toContainText('I use Excel for monthly reports.');
  await expect(page.locator('.recommendation-caveat')).toContainText('model-assigned priorities do not improve rank');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path: `../output/natural-recommendations-${name}.png`, fullPage: true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('explicit internship preference and profile evidence scope are explained', async ({page}) => {
  await setup(page, route => route.fulfill({json: {...report, profile_skill_count: 1, preferred_job_type: 'internship'}}));
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.job-recommendations')).toContainText('Using 1 distinct named tool or domain skill');
  await expect(page.locator('.job-recommendations')).toContainText('Internship jobs appear before other job types');
  await expect(page.locator('.job-recommendations')).toContainText('Resume files are not parsed');
});
