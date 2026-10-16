import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for job-list favorite state checks.');
const jobId = '33333333-3333-4333-8333-333333333333';
const job = {
  id: jobId, title: 'Fictional Test Engineer', company: 'Offline Company', city: 'Singapore',
  job_type: 'internship', status: 'active', posted_at: '2026-10-15', deadline: null,
  salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
  tags: [], source: {name: 'Offline fixture'},
};

test('job-list saved state comes from the current account and is cleared when accounts switch', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'fixture-account-a'));
  await page.route('**/*', route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    const path = new URL(request.url()).pathname;
    if (path === '/jobs') return route.fulfill({json: {items: [job], page: 1, page_size: 100, total: 1, pages: 1}});
    if (path === '/favorites') {
      const accountA = request.headers().authorization === 'Bearer fixture-account-a';
      const items = accountA ? [{id: 'favorite-a', job}] : [];
      return route.fulfill({json: {items, page: 1, page_size: 100, total: items.length, pages: items.length ? 1 : 0}});
    }
    if (path === '/profile') return route.fulfill({json: {full_name: 'Fixture applicant'}});
    return route.fulfill({status: 404, json: {detail: 'No fixture for this request'}});
  });
  await page.goto(`${base}/jobs`);
  await expect(page.getByRole('button', {name: 'Remove from saved'})).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    localStorage.setItem('jobpilot_token', 'fixture-account-b');
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue: 'fixture-account-a', newValue: 'fixture-account-b'}));
  });
  await expect(page.getByRole('button', {name: 'Save job'})).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', {name: 'Remove from saved'})).toHaveCount(0);
});

test('favorite load failure is visible and retry restores the saved state', async ({page}) => {
  let favoriteReads = 0;
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'fixture-account-a'));
  await page.route('**/*', route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    const path = new URL(request.url()).pathname;
    if (path === '/jobs') return route.fulfill({json: {items: [job], page: 1, page_size: 100, total: 1, pages: 1}});
    if (path === '/favorites') {
      favoriteReads += 1;
      // StrictMode may start and cancel the first read before the settled load.
      if (favoriteReads <= 2) return route.fulfill({status: 503, json: {detail: 'Temporary fixture failure'}});
      return route.fulfill({json: {items: [{id: 'favorite-a', job}], page: 1, page_size: 100, total: 1, pages: 1}});
    }
    if (path === '/profile') return route.fulfill({json: {full_name: 'Fixture applicant'}});
    return route.fulfill({status: 404, json: {detail: 'No fixture for this request'}});
  });
  await page.goto(`${base}/jobs`);
  await expect(page.getByRole('alert')).toContainText('Could not load saved jobs');
  await expect(page.getByRole('button', {name: 'Save job'})).toBeDisabled();
  await page.getByRole('button', {name: 'Reload saved jobs'}).click();
  await expect(page.getByRole('button', {name: 'Remove from saved'})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('job-list checks later favorite pages before marking a saved job', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'fixture-account-a'));
  await page.route('**/*', route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    const url = new URL(request.url());
    if (url.pathname === '/jobs') return route.fulfill({json: {items: [job], page: 1, page_size: 100, total: 1, pages: 1}});
    if (url.pathname === '/favorites') {
      const pageNumber = Number(url.searchParams.get('page'));
      const otherJob = {...job, id: '44444444-4444-4444-8444-444444444444'};
      const favoriteJob = pageNumber === 1 ? otherJob : job;
      return route.fulfill({json: {items: [{id: `favorite-${pageNumber}`, job: favoriteJob}], page: pageNumber, page_size: 100, total: 2, pages: 2}});
    }
    if (url.pathname === '/profile') return route.fulfill({json: {full_name: 'Fixture applicant'}});
    return route.fulfill({status: 404, json: {detail: 'No fixture for this request'}});
  });
  await page.goto(`${base}/jobs`);
  await expect(page.getByRole('button', {name: 'Remove from saved'})).toHaveAttribute('aria-pressed', 'true');
});
