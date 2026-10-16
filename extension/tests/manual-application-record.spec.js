import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for manual application record checks.');
const jobId = '11111111-1111-4111-8111-111111111111';
const application = (method = 'manual') => ({
  id: '22222222-2222-4222-8222-222222222222', method, status: 'submitted',
  job: {id: jobId, title: 'Fictional Software Engineer', company: 'Offline employer'},
  created_at: '2026-10-15T09:00:00Z', updated_at: '2026-10-15T09:00:00Z', submitted_at: '2026-10-15T09:00:00Z',
});

async function setup(page, onApplication, onHistory = () => ({items: [], page: 1, page_size: 100, total: 0, pages: 0})) {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'fixture-applicant-token'));
  await page.route('**/*', route => {
    const request = route.request();
    if (!['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    const path = new URL(request.url()).pathname;
    if (path === `/jobs/${jobId}` && request.method() === 'GET') return route.fulfill({json: {
      id: jobId, status: 'active', title: 'Fictional Software Engineer', company: 'Offline employer',
      city: 'Singapore', job_type: 'internship', deadline: null, salary_min: null, salary_max: null,
      salary_currency: null, salary_period: null, description: 'Controlled fixture.', requirements: [],
      apply_url: 'https://example.invalid/apply', source_url: 'https://example.invalid/job',
      assistant_form_available: false, is_favorited: false, source: {name: 'Offline fixture'}, tags: [],
    }});
    if (path === `/jobs/${jobId}/applications` && request.method() === 'POST') return onApplication(route);
    if (path === '/applications' && request.method() === 'GET') return route.fulfill({json: onHistory()});
    if (path === '/profile') return route.fulfill({json: {full_name: 'Fixture Applicant', skills: []}});
    return route.fulfill({status: 404, json: {detail: 'No controlled fixture for this endpoint'}});
  });
  await page.goto(`${base}/jobs/${jobId}`);
  await page.getByRole('button', {name: 'Record an application I made on the original site'}).click();
}

test('manual record requires an explicit user report and sends one UUID-keyed request', async ({page}) => {
  let release, requests = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await setup(page, async route => {
    requests++;
    expect(route.request().headers().authorization).toBe('Bearer fixture-applicant-token');
    expect(route.request().postDataJSON()).toEqual({status: 'submitted'});
    await pending;
    return route.fulfill({status: 201, json: application()});
  });
  const save = page.getByRole('button', {name: 'Save my report'});
  await expect(save).toBeDisabled();
  await page.getByRole('checkbox', {name: 'I personally submitted this application on the original site.'}).check();
  await save.click();
  await expect(page.getByRole('button', {name: 'Saving...'})).toBeDisabled();
  expect(requests).toBe(1);
  release();
  await expect(page.getByRole('status')).toContainText('Employer receipt is not verified');
  expect(requests).toBe(1);
});

test('duplicate record conflict shows the existing assistant record without relabeling it as applied', async ({page}) => {
  await setup(page, route => route.fulfill({status: 409, json: {detail: 'Already exists'}}), () => ({
    items: [application('assistant')], page: 1, page_size: 100, total: 1, pages: 1,
  }));
  await page.getByRole('checkbox', {name: 'I personally submitted this application on the original site.'}).check();
  await page.getByRole('button', {name: 'Save my report'}).click();
  await expect(page.getByRole('status')).toContainText('assisted record saved, not a verified employer submission');
  await expect(page.getByRole('status')).toContainText('View My Applications');
});
