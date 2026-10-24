import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for admin dashboard checks.');

const source = {id: 'source-1', name: 'Fictional Board', source_type: 'mock',
  base_url: 'https://jobs.example.test', schedule: null, enabled: true, status: 'healthy'};
const run = {id: 'run-1', source_id: source.id, status: 'succeeded', trigger: 'manual',
  items_found: 2, items_new: 1, items_updated: 0, items_failed: 0,
  created_at: '2026-10-23T08:00:00Z', error_summary: []};
const audit = {id: 'audit-1', actor_id: null, action: 'ingestion.run',
  entity_type: 'crawl_run', entity_id: run.id, created_at: '2026-10-23T08:01:00Z'};

test('administrator sees read-only sources, runs and safe audit fields', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'admin-fixture'));
  await page.route('**/*', route => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const url = new URL(route.request().url());
    if (url.pathname === '/users/me') return route.fulfill({json: {role: 'admin'}});
    if (url.pathname === '/profile') return route.fulfill({json: {full_name: 'Fictional admin'}});
    if (url.pathname === '/sources') return route.fulfill({json: [source]});
    if (url.pathname === '/runs') return route.fulfill({json: {items: [run], total: 1, pages: 1, page: 1, page_size: 20}});
    if (url.pathname === '/audit-events') return route.fulfill({json: {items: [audit], total: 1, pages: 1, page: 1, page_size: 20}});
    return route.fulfill({status: 404, json: {}});
  });
  await page.goto(base + '/admin');
  await expect(page.getByRole('heading', {name: 'Source operations'})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Configured sources'}).getByText('Fictional Board')).toBeVisible();
  await expect(page.getByText('ingestion.run')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Admin', exact: true})).toBeVisible();
  await expect(page.getByText('private_note')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /Run source|Start crawl|Delete/})).toHaveCount(0);
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: '../output/admin-dashboard-mobile.png', fullPage: true});
});

test('non-admin does not see operational data or admin navigation', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'seeker-fixture'));
  await page.route('**/*', route => {
    if (!['fetch', 'xhr'].includes(route.request().resourceType())) return route.continue();
    const url = new URL(route.request().url());
    if (url.pathname === '/users/me') return route.fulfill({json: {role: 'job_seeker'}});
    if (url.pathname === '/profile') return route.fulfill({json: {full_name: 'Fictional seeker'}});
    return route.fulfill({status: 403, json: {detail: 'Not permitted'}});
  });
  await page.goto(base + '/admin');
  await expect(page.getByRole('alert')).toContainText('Administrator access required');
  await expect(page.getByRole('button', {name: 'Admin', exact: true})).toHaveCount(0);
  await expect(page.getByText('Fictional Board')).toHaveCount(0);
});
