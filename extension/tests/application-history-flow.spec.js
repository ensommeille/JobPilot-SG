import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for application-history checks.');
const record = (id, method = 'assistant', status = 'submitted') => ({
  id, method, status, job: {id: `job-${id}`, title: `Fictional ${id} role`, company: 'Test employer'},
  created_at: '2026-10-14T09:00:00Z', submitted_at: '2026-10-14T09:00:00Z',
});

async function setup(page, history) {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'account-a-token'));
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Fixture account'}}));
  await page.route(/\/applications(?:\?.*)?$/, route => route.request().resourceType() === 'document' ? route.continue() : history(route));
  await page.goto(base + '/applications');
}

test('history distinguishes saved answers from user-reported applications and tracked progress', async ({page}) => {
  await setup(page, route => route.fulfill({json: {items: [record('assistant'), record('manual', 'manual'), record('interview', 'assistant', 'interview')]}}));
  const saved = page.getByRole('article', {name: 'Fictional assistant role'});
  const manual = page.getByRole('article', {name: 'Fictional manual role'});
  await expect(saved).toContainText('Record saved');
  await expect(saved).toContainText('JobPilot has not sent these answers to an employer');
  await expect(saved).toContainText('Recorded:');
  await expect(manual).toContainText('Reported applied');
  await expect(manual).toContainText('User-reported record');
  await expect(page.getByRole('article', {name: 'Fictional interview role'})).toContainText('Interview');
  await expect(page.getByText('These are your JobPilot records and tracked statuses', {exact: false})).toContainText('not verified employer receipts');
  await expect(page.getByText('Applied:', {exact: false})).toHaveCount(0);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.screenshot({path: '../output/application-history-desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: '../output/application-history-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an old delayed history response cannot expose the previous account after switching', async ({page}) => {
  const releases = [], headers = [];
  let completedA = 0;
  await setup(page, async route => {
    const authorization = route.request().headers().authorization;
    headers.push(authorization);
    if (authorization === 'Bearer account-a-token') {
      await new Promise(resolve => releases.push(resolve));
      try { await route.fulfill({json: {items: [record('private-account-a')]}}); }
      catch { /* The old request may already be aborted by the session guard. */ }
      finally { completedA++; }
      return;
    }
    await route.fulfill({json: {items: [record('account-b')]}});
  });
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    localStorage.setItem('jobpilot_token', 'account-b-token');
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue: 'account-a-token', newValue: 'account-b-token'}));
  });
  await expect(page.getByRole('article', {name: 'Fictional account-b role'})).toBeVisible();
  for (const release of releases) release();
  await expect.poll(() => completedA).toBe(releases.length);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Fictional private-account-a role')).toHaveCount(0);
  expect(headers).toContain('Bearer account-a-token');
  expect(headers).toContain('Bearer account-b-token');
  expect(headers.every(header => ['Bearer account-a-token', 'Bearer account-b-token'].includes(header))).toBe(true);
});

test('failed history can retry and cross-tab sign-out immediately clears private records', async ({page}) => {
  let failing = true, calls = 0;
  await setup(page, route => {
    calls++;
    return route.fulfill(failing ? {status: 503, json: {}} : {json: {items: [record('private-account-a')]}});
  });
  await expect(page.getByRole('alert')).toContainText('Could not load your application records');
  failing = false;
  await page.getByRole('button', {name: 'Retry history'}).click();
  await expect(page.getByRole('article')).toBeVisible();
  const beforeLogout = calls;
  await page.evaluate(() => {
    localStorage.removeItem('jobpilot_token');
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue: 'account-a-token', newValue: null}));
  });
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot');
  await expect(page.getByRole('button', {name: 'Sign in', exact: true})).toBeVisible();
  expect(calls).toBe(beforeLogout);
});
