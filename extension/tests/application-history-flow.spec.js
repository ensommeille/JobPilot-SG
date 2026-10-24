import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for application-history checks.');
const cap = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const record = (id, method = 'assistant', status = 'submitted') => {
  const manual = method === 'manual';
  const display_status = manual
    ? (status === 'draft' ? 'Preparation draft' : `${cap(status)} (self-reported)`)
    : (status === 'submitted' ? 'Application record saved' : `${cap(status)} (recorded)`);
  return {
    id: `doc:${id}`, record_id: `rec:${id}`, kind: 'application',
    job: {id: `job-${id}`, title: `Fictional ${id} role`, company: 'Test employer'},
    channel: manual ? 'manual' : 'assistant', method, status, display_status,
    next_action: manual
      ? 'This status was recorded by you; employer receipt is not verified.'
      : 'Review the saved record. It does not establish submission to or receipt by an employer.',
    created_at: '2026-10-14T09:00:00Z', updated_at: '2026-10-14T09:00:00Z', submitted_at: '2026-10-14T09:00:00Z',
    sent_at: null, resume_filename: null, actual_recipient: null, original_recipient: null,
    receipt: null, failure_code: null,
  };
};
const historyPage = (items, page = 1, total = items.length, pages = total ? Math.ceil(total / 20) : 0) =>
  ({items, page, page_size: 20, total, pages});

async function setup(page, history) {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'account-a-token'));
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Fixture account'}}));
  await page.route(/\/application-history(?:\?.*)?$/, route => route.request().resourceType() === 'document' ? route.continue() : history(route));
  await page.goto(base + '/applications');
}

test('history distinguishes saved answers from user-reported applications and tracked progress', async ({page}) => {
  await setup(page, route => route.fulfill({json: historyPage([record('assistant'), record('manual', 'manual'), record('interview', 'manual', 'interviewing')])}));
  const saved = page.getByRole('article', {name: 'Fictional assistant role'});
  const manual = page.getByRole('article', {name: 'Fictional manual role'});
  await expect(saved).toContainText('Application record saved');
  await expect(saved).toContainText('does not establish submission to or receipt by an employer');
  await expect(saved).toContainText('Updated');
  await expect(manual).toContainText('Submitted (self-reported)');
  await expect(manual).toContainText('Manually tracked');
  await expect(page.getByRole('article', {name: 'Fictional interview role'})).toContainText('Interviewing (self-reported)');
  await expect(page.getByText('Preparation drafts, saved answers and email records in one place', {exact: false})).toContainText('do not verify employer receipt');
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
      try { await route.fulfill({json: historyPage([record('private-account-a')])}); }
      catch { /* The old request may already be aborted by the session guard. */ }
      finally { completedA++; }
      return;
    }
    await route.fulfill({json: historyPage([record('account-b')])});
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
    return route.fulfill(failing ? {status: 503, json: {}} : {json: historyPage([record('private-account-a')])});
  });
  await expect(page.getByRole('alert')).toContainText('Could not load your applications. Check your connection and retry.');
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

test('history uses server pagination and only offers backend-supported status transitions', async ({page}) => {
  const first = [record('manual', 'manual'), ...Array.from({length: 19}, (_, index) => record(`other-${index}`))];
  const updates = [];
  await setup(page, route => {
    const currentPage = Number(new URL(route.request().url()).searchParams.get('page'));
    return route.fulfill({json: historyPage(currentPage === 2 ? [record('last')] : first, currentPage, 21, 2)});
  });
  await page.route('**/applications/manual', route => {
    updates.push({method: route.request().method(), payload: route.request().postDataJSON()});
    return route.fulfill({json: record('manual', 'manual', 'interviewing')});
  });
  await expect(page.getByText('Showing 1–20 of 21 records')).toBeVisible();
  const manual = page.getByRole('article', {name: 'Fictional manual role'});
  await manual.getByLabel('Update reported status').selectOption('interviewing');
  await manual.getByRole('button', {name: 'Save status'}).click();
  await expect(manual).toContainText('Interviewing');
  expect(updates).toEqual([{method: 'PATCH', payload: {status: 'interviewing'}}]);
  await expect(manual.getByRole('option', {name: 'Reported applied'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Next'}).click();
  await expect(page.getByText('Showing 21–21 of 21 records')).toBeVisible();
  await expect(page.getByRole('article', {name: 'Fictional last role'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Next'})).toBeDisabled();
});

test('a status conflict offers an explicit reload instead of claiming the update succeeded', async ({page}) => {
  let current = record('manual', 'manual');
  await setup(page, route => route.fulfill({json: historyPage([current])}));
  await page.route('**/applications/manual', route => {
    current = record('manual', 'manual', 'rejected');
    return route.fulfill({status: 409, json: {detail: 'Invalid transition'}});
  });
  const manual = page.getByRole('article', {name: 'Fictional manual role'});
  await manual.getByLabel('Update reported status').selectOption('interviewing');
  await manual.getByRole('button', {name: 'Save status'}).click();
  await expect(manual.getByRole('alert')).toContainText('The status could not be saved. Reload the record before trying again.');
  await expect(manual).toContainText('Submitted (self-reported)');
  await manual.getByRole('button', {name: 'Reload history'}).click();
  await expect(page.getByRole('article', {name: 'Fictional manual role'})).toContainText('Rejected');
});
