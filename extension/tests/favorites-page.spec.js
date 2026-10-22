import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for saved-job page checks.');
const favorite = index => ({id: `favorite-${index}`, job: {
  id: `job-${index}`, title: `Fictional role ${index}`, company: 'Offline fixture',
  city: 'Singapore', job_type: 'internship', status: 'active', tags: [],
  salary_min: null, salary_max: null, deadline: null, source: {name: 'Fixture'},
}});
const savedPage = (items, page = 1, total = items.length) =>
  ({items, page, page_size: 20, total, pages: Math.ceil(total / 20)});

async function setup(page, handler) {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'account-a'));
  await page.route('**/*', route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    if (new URL(request.url()).pathname === '/profile') return route.fulfill({json: {full_name: 'Fictional test user'}});
    return handler(route);
  });
  await page.goto(`${base}/favorites`);
}

function collection(saved) {
  return route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/favorites') {
      const page = Number(url.searchParams.get('page'));
      expect(url.searchParams.get('page_size')).toBe('20');
      return route.fulfill({json: savedPage(saved.slice((page - 1) * 20, page * 20), page, saved.length)});
    }
    if (route.request().method() === 'DELETE') {
      const index = saved.findIndex(item => `/jobs/${item.job.id}/favorite` === url.pathname);
      expect(index).toBeGreaterThanOrEqual(0);
      saved.splice(index, 1);
      return route.fulfill({status: 204});
    }
    return route.fulfill({status: 404, json: {}});
  };
}

test('saved jobs use server pagination and expose the 21st job', async ({page}) => {
  await setup(page, collection(Array.from({length: 21}, (_, i) => favorite(i + 1))));
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(page.getByText('Showing 1–20 of 21 saved jobs')).toBeVisible();
  await page.getByRole('button', {name: 'Next', exact: true}).click();
  await expect(page.getByText('Showing 21–21 of 21 saved jobs')).toBeVisible();
  await expect(page.getByRole('link', {name: 'Fictional role 21', exact: true})).toHaveAttribute('href', '/jobs/job-21');
  await expect(page.getByRole('button', {name: 'Next', exact: true})).toBeDisabled();
  await page.screenshot({path: '../output/favorites-page-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Previous', exact: true}).click();
  await expect(page.getByRole('article')).toHaveCount(20);
});

test('removing the only job on the final page returns to a valid page', async ({page}) => {
  await setup(page, collection(Array.from({length: 21}, (_, i) => favorite(i + 1))));
  await page.getByRole('button', {name: 'Next', exact: true}).click();
  await page.getByRole('button', {name: 'Remove saved job Fictional role 21', exact: true}).click();
  await expect(page.getByText('Showing 1–20 of 20 saved jobs')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(page.getByRole('navigation', {name: 'Saved jobs pages'})).toHaveCount(0);
  await expect(page.getByText('No saved jobs yet.')).toHaveCount(0);
});

test('removing from an earlier page refills the page and updates totals', async ({page}) => {
  await setup(page, collection(Array.from({length: 21}, (_, i) => favorite(i + 1))));
  await page.getByRole('button', {name: 'Remove saved job Fictional role 1', exact: true}).click();
  await expect(page.getByText('Showing 1–20 of 20 saved jobs')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(20);
  await expect(page.getByRole('link', {name: 'Fictional role 21', exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Fictional role 1', exact: true})).toHaveCount(0);
});

test('load and removal failures remain visible and can recover', async ({page}) => {
  let loadFails = true, deleteFails = true;
  const saved = [favorite(1)];
  const handler = collection(saved);
  await setup(page, route => {
    if (new URL(route.request().url()).pathname === '/favorites' && loadFails) return route.fulfill({status: 503, json: {}});
    if (route.request().method() === 'DELETE' && deleteFails) return route.fulfill({status: 503, json: {}});
    return handler(route);
  });
  await expect(page.getByRole('alert')).toContainText('Could not load saved jobs');
  loadFails = false;
  await page.getByRole('button', {name: 'Retry saved jobs'}).click();
  const remove = page.getByRole('button', {name: 'Remove saved job Fictional role 1', exact: true});
  await remove.click();
  await expect(page.getByRole('alert')).toContainText('Could not remove this saved job');
  await expect(page.getByRole('article')).toHaveCount(1);
  deleteFails = false;
  await remove.click();
  await expect(page.getByText('No saved jobs yet.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('late responses cannot restore the previous account and sign-out clears records', async ({page}) => {
  const releases = [];
  let completedA = 0, anonymousCalls = 0;
  await setup(page, async route => {
    const auth = route.request().headers().authorization;
    if (auth === 'Bearer account-a') {
      await new Promise(resolve => releases.push(resolve));
      try { await route.fulfill({json: savedPage([favorite('private-a')])}); }
      catch { /* The old session request may already have been aborted. */ }
      finally { completedA++; }
      return;
    }
    if (!auth) anonymousCalls++;
    return route.fulfill({json: savedPage([favorite('account-b')])});
  });
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    localStorage.setItem('jobpilot_token', 'account-b');
    window.dispatchEvent(new Event('jobpilot-auth-changed'));
  });
  await expect(page.getByRole('article', {name: 'Fictional role account-b', exact: true})).toBeVisible();
  releases.forEach(release => release());
  await expect.poll(() => completedA).toBe(releases.length);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Fictional role private-a')).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.removeItem('jobpilot_token');
    window.dispatchEvent(new Event('jobpilot-auth-changed'));
  });
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot');
  expect(anonymousCalls).toBe(0);
});

test('an in-flight removal stays pinned to its original account', async ({page}) => {
  let release, completed = false;
  const deletes = [];
  await setup(page, async route => {
    const request = route.request();
    const accountA = request.headers().authorization === 'Bearer account-a';
    if (request.method() === 'DELETE') {
      deletes.push(request.headers().authorization);
      await new Promise(resolve => { release = resolve; });
      try { await route.fulfill({status: 204}); }
      catch { /* Account switching aborts the old mutation. */ }
      finally { completed = true; }
      return;
    }
    return route.fulfill({json: savedPage([favorite(accountA ? 'account-a' : 'account-b')])});
  });
  await page.getByRole('button', {name: 'Remove saved job Fictional role account-a'}).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem('jobpilot_token', 'account-b');
    window.dispatchEvent(new Event('jobpilot-auth-changed'));
  });
  await expect(page.getByRole('article', {name: 'Fictional role account-b'})).toBeVisible();
  release();
  await expect.poll(() => completed).toBe(true);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', {name: 'Fictional role account-b'})).toBeVisible();
  expect(deletes).toEqual(['Bearer account-a']);
});
