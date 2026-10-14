import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL to test job-detail session isolation.');
const tokenA = 'fixture-job-detail-account-a';
const tokenB = 'fixture-job-detail-account-b';
const jobOne = 'session-fixture-one';
const jobTwo = 'session-fixture-two';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function job(id, isFavorited = false) {
  return {
    id, title: `Fictional role ${id}`, company: 'Offline test employer', status: 'active',
    city: 'Singapore', job_type: 'internship', deadline: null, salary_min: null,
    salary_max: null, salary_currency: null, salary_period: null,
    description: 'Deterministic test fixture. Never submits an application.', requirements: [],
    source: {name: 'Offline fixture'}, tags: [], source_url: null,
    apply_url: 'https://example.invalid/application', assistant_form_available: false,
    is_favorited: isFavorited,
  };
}

const favoriteButton = page => page.getByRole('button', {name: /^(?:★ Favorited|☆ Add to Favorites)$/});

async function setup(page, context, options = {}) {
  const calls = [];
  const favorites = new Map([[`${tokenA}:${jobOne}`, options.initialFavorite ?? false]]);
  await page.addInitScript(token => {
    if (sessionStorage.getItem('job-detail-fixture-seeded')) return;
    sessionStorage.setItem('job-detail-fixture-seeded', 'true');
    if (token) localStorage.setItem('jobpilot_token', token);
    else localStorage.removeItem('jobpilot_token');
  }, options.anonymous ? null : tokenA);
  await context.route('**/*', async route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    const path = new URL(request.url()).pathname;
    const authorization = request.headers().authorization ?? '';
    const token = authorization.replace(/^Bearer /, '');
    const detail = path.match(/^\/jobs\/(session-fixture-(?:one|two))$/);
    const favorite = path.match(/^\/jobs\/(session-fixture-(?:one|two))\/favorite$/);
    if (detail) {
      calls.push({kind: 'detail', id: detail[1], token, method: request.method()});
      if (options.onDetail && await options.onDetail(route, detail[1], token)) return;
      return route.fulfill({json: job(detail[1], favorites.get(`${token}:${detail[1]}`) ?? false)});
    }
    if (favorite) {
      calls.push({kind: 'favorite', id: favorite[1], token, method: request.method()});
      if (options.onFavorite && await options.onFavorite(route, favorite[1], token)) return;
      favorites.set(`${token}:${favorite[1]}`, request.method() === 'POST');
      return route.fulfill({status: 204});
    }
    if (path === '/profile') return route.fulfill({json: {full_name: 'Fictional Applicant', skills: []}});
    if (path === '/users/me') return route.fulfill({json: {id: token, email: 'fictional@example.invalid'}});
    if (path === '/assistant/bootstrap') return route.fulfill({json: {forms: [], manual_fallback: true}});
    if (options.onOther && await options.onOther(route, path, token)) return;
    return route.fulfill({status: 404, json: {detail: 'No offline fixture for this API request'}});
  });
  await page.goto(`${base}/jobs/${jobOne}`);
  return {calls, favorites};
}

async function secondTab(context) {
  const other = await context.newPage();
  await other.goto(`${base}/`);
  return other;
}

async function changeAccount(other, token) {
  await other.evaluate(value => {
    if (value) localStorage.setItem('jobpilot_token', value);
    else localStorage.clear();
  }, token);
}

async function changeRoute(page, id) {
  await page.evaluate(value => {
    history.pushState({}, '', `/jobs/${value}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, id);
}

test('detail uses server favorite state and reloads it on actual cross-tab switch and sign-out', async ({page, context}) => {
  const {calls} = await setup(page, context, {initialFavorite: true});
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'true');
  const other = await secondTab(context);
  await changeAccount(other, tokenB);
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => calls.some(call => call.kind === 'detail' && call.token === tokenB)).toBe(true);
  await changeAccount(other, null);
  await expect.poll(() => calls.some(call => call.kind === 'detail' && call.token === '')).toBe(true);
  await expect(page.getByRole('heading', {name: job(jobOne).title})).toBeVisible();
  await favoriteButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot');
  expect(calls.filter(call => call.kind === 'favorite')).toHaveLength(0);
});

test('late detail for account A cannot replace account B after another tab changes the session', async ({page, context}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  await setup(page, context, {onDetail: async (route, id, token) => {
    if (token !== tokenA) return false;
    started.resolve();
    await release.promise;
    await route.fulfill({json: {...job(id, true), title: 'Private account A stale detail'}});
    answered.resolve();
    return true;
  }});
  await started.promise;
  const other = await secondTab(context);
  await changeAccount(other, tokenB);
  await expect(page.getByRole('heading', {name: job(jobOne).title})).toBeVisible();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  release.resolve();
  await answered.promise;
  await expect(page.getByText('Private account A stale detail')).toHaveCount(0);
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('late favorite write remains pinned to account A and cannot update or block account B', async ({page, context}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  const {calls} = await setup(page, context, {onFavorite: async (route, _id, token) => {
    if (token !== tokenA) return false;
    started.resolve();
    await release.promise;
    await route.fulfill({status: 204});
    answered.resolve();
    return true;
  }});
  await favoriteButton(page).click();
  await started.promise;
  await expect(favoriteButton(page)).toBeDisabled();
  const other = await secondTab(context);
  await changeAccount(other, tokenB);
  await expect(favoriteButton(page)).toBeEnabled();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  release.resolve();
  await answered.promise;
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  await favoriteButton(page).click();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(calls.filter(call => call.kind === 'favorite').map(call => call.token)).toEqual([tokenA, tokenB]);
});

test('an uncancelled old 401 cannot remove the new session or redirect its detail page', async ({page, context}) => {
  const started = deferred(), release = deferred();
  await setup(page, context, {onOther: async (route, path, token) => {
    if (path !== '/job-detail-late-401') return false;
    expect(token).toBe(tokenA);
    started.resolve();
    await release.promise;
    await route.fulfill({status: 401, json: {detail: 'Expired fixture account A'}});
    return true;
  }});
  await expect(favoriteButton(page)).toBeVisible();
  await page.evaluate(async () => {
    const {default: api} = await import('/src/services/api.ts');
    window.jobDetailLate401Finished = false;
    api.get('/job-detail-late-401').catch(() => {}).finally(() => { window.jobDetailLate401Finished = true; });
  });
  await started.promise;
  const other = await secondTab(context);
  await changeAccount(other, tokenB);
  await expect(favoriteButton(page)).toBeVisible();
  release.resolve();
  await expect.poll(() => page.evaluate(() => window.jobDetailLate401Finished)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe(tokenB);
  await expect(page).toHaveURL(`${base}/jobs/${jobOne}`);
});

test('late detail for the previous route cannot overwrite the next job', async ({page, context}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  await setup(page, context, {onDetail: async (route, id) => {
    if (id !== jobOne) return false;
    started.resolve();
    await release.promise;
    await route.fulfill({json: job(id, true)});
    answered.resolve();
    return true;
  }});
  await started.promise;
  await changeRoute(page, jobTwo);
  await expect(page.getByRole('heading', {name: job(jobTwo).title})).toBeVisible();
  release.resolve();
  await answered.promise;
  await expect(page.getByRole('heading', {name: job(jobTwo).title})).toBeVisible();
  await expect(page.getByRole('heading', {name: job(jobOne).title})).toHaveCount(0);
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('late favorite response for a previous job cannot mark the new job as saved', async ({page, context}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  const {calls} = await setup(page, context, {onFavorite: async (route, id) => {
    if (id !== jobOne) return false;
    started.resolve();
    await release.promise;
    await route.fulfill({status: 204});
    answered.resolve();
    return true;
  }});
  await favoriteButton(page).click();
  await started.promise;
  await changeRoute(page, jobTwo);
  await expect(page.getByRole('heading', {name: job(jobTwo).title})).toBeVisible();
  release.resolve();
  await answered.promise;
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  await favoriteButton(page).click();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(calls.filter(call => call.kind === 'favorite').map(call => call.id)).toEqual([jobOne, jobTwo]);
});

test('rapid clicks send one mutation, report failure, and allow an explicit retry', async ({page, context}) => {
  const started = deferred(), release = deferred();
  let fail = true;
  const {calls} = await setup(page, context, {onFavorite: async route => {
    if (!fail) return false;
    started.resolve();
    await release.promise;
    await route.fulfill({status: 503, json: {detail: 'Offline fixture temporarily unavailable'}});
    return true;
  }});
  await favoriteButton(page).evaluate(button => { button.click(); button.click(); button.click(); });
  await started.promise;
  await expect(favoriteButton(page)).toBeDisabled();
  expect(calls.filter(call => call.kind === 'favorite')).toHaveLength(1);
  release.resolve();
  await expect(page.getByRole('alert')).toContainText('Could not update your favorites');
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(favoriteButton(page)).toBeEnabled();
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.screenshot({path: `../output/job-detail-favorite-error-${name}.png`, fullPage: true});
  }
  fail = false;
  await favoriteButton(page).click();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls.filter(call => call.kind === 'favorite')).toHaveLength(2);
  await favoriteButton(page).click();
  await expect(favoriteButton(page)).toHaveAttribute('aria-pressed', 'false');
  expect(calls.filter(call => call.kind === 'favorite').map(call => call.method)).toEqual(['POST', 'POST', 'DELETE']);
});

test('anonymous detail is readable and does not send a favorite mutation', async ({page, context}) => {
  const {calls} = await setup(page, context, {anonymous: true});
  await expect(page.getByRole('heading', {name: job(jobOne).title})).toBeVisible();
  await favoriteButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot');
  expect(calls.filter(call => call.kind === 'detail').every(call => call.token === '')).toBe(true);
  expect(calls.filter(call => call.kind === 'favorite')).toHaveLength(0);
});

test('explicitly pinned requests keep their original credential and a current 401 still signs out', async ({page, context}) => {
  const seen = [];
  await setup(page, context, {onOther: async (route, path, token) => {
    if (path !== '/job-detail-pinned' && path !== '/job-detail-current-401') return false;
    seen.push(token);
    await route.fulfill({status: path.endsWith('current-401') ? 401 : 200, json: {}});
    return true;
  }});
  await expect(favoriteButton(page)).toBeVisible();
  await page.evaluate(async () => {
    const {default: api} = await import('/src/services/api.ts');
    await api.get('/job-detail-pinned', {headers: {Authorization: 'Bearer fixture-explicit-session'}});
    await api.get('/job-detail-pinned', {headers: {Authorization: ''}});
  });
  expect(seen).toEqual(['fixture-explicit-session', '']);
  await page.evaluate(async () => {
    const {default: api} = await import('/src/services/api.ts');
    api.get('/job-detail-current-401').catch(() => {});
  });
  await expect(page).toHaveURL(`${base}/`);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBeNull();
});
