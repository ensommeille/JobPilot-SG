// Real loopback HTTP + built UI. Requires the disposable PR #45 review workspace.
// No intercepted responses, paid model calls or employer submissions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium, expect} from '../extension/node_modules/@playwright/test/index.mjs';

if (process.env.JOURNEY_ALLOW_TEST_WRITES !== 'disposable-local-only')
  throw new Error('Set JOURNEY_ALLOW_TEST_WRITES=disposable-local-only for a disposable workspace');
const workspace = process.env.JOURNEY_REVIEW_WORKSPACE;
if (!workspace || !path.isAbsolute(workspace)) throw new Error('An absolute review workspace is required');
const marker = JSON.parse(await fs.readFile(path.join(workspace, '.jobpilot-review-workspace.json'), 'utf8'));
const seed = JSON.parse(await fs.readFile(path.join(workspace, 'seed.json'), 'utf8'));
expect(marker.kind).toBe('jobpilot-local-review-workspace-v1');
expect(seed.kind).toBe(marker.kind);
expect(seed.workspace).toBe(path.resolve(workspace));
expect(marker.workspace).toBe(seed.workspace);
const web = seed.web_origin, api = seed.api_origin;
for (const origin of [web, api]) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || !url.port || url.origin !== origin) throw new Error('Explicit loopback origins only');
}
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/application-journey');
await fs.mkdir(output, {recursive: true});
const checks = [], failures = [], blocked = [];
const optionalFonts = new Set();
const fontStylesheet = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
// Use the existing system-font fallback for repeatable offline acceptance. Only
// that deliberately blocked, exact stylesheet's network warning is expected.
// Employer pages, model APIs and all other remote requests remain blocked.
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url());
  if ([web, api].includes(url.origin)) return route.continue();
  if (request.method() === 'GET' && request.resourceType() === 'stylesheet'
      && request.url() === fontStylesheet) {
    optionalFonts.add(request.url());
    return route.abort();
  }
  blocked.push(url.origin);
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => failures.push(error.message));
page.on('console', event => {
  if (event.type() !== 'error') return;
  if (event.text() === 'Failed to load resource: net::ERR_FAILED'
      && optionalFonts.has(event.location().url)) return;
  failures.push(event.text());
});
const profile = {
  full_name: 'Fictional End-to-End Applicant', contact_email: 'journey-contact@example.com',
  phone: '+65 8000 0000', education: 'Fictional computing student',
  experience: 'Built web applications for a class project. Implemented automated tests for the application.',
};
const password = `Test!${randomBytes(20).toString('hex')}`;
const email = `journey-${randomBytes(8).toString('hex')}@example.com`;
let token;
async function request(method, route, data, status = 200, credential = token) {
  const response = await context.request.fetch(api + route, {
    method, data, maxRedirects: 0, timeout: 15000,
    headers: credential ? {Authorization: `Bearer ${credential}`} : {},
  });
  expect(response.status(), `${method} ${route}`).toBe(status);
  return response;
}
async function recommendations() {
  await page.goto(web + '/jobs');
  const pending = page.waitForResponse(response => response.url() === api + '/jobs/recommendations'
    && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Find jobs for me', exact: true}).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response.json();
}
try {
  const job = await (await request('GET', `/jobs/${seed.job_id}`)).json();
  expect(job.company).toBe('Stripe');
  expect(job.source.name).toBe('Stripe - isolated source review');
  expect(job.source_url).toContain('8130883');
  await page.goto(web + '/register');
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByLabel('Confirm password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  await expect(page).toHaveURL(web + '/');
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page).toHaveURL(web + '/jobs');
  token = await page.evaluate(() => localStorage.getItem('jobpilot_token'));
  expect(token).toBeTruthy();
  checks.push('UI register and sign in using a generated ordinary test account');

  await page.goto(web + '/profile');
  for (const [label, value] of [['Full Name', profile.full_name], ['Contact Email', profile.contact_email],
    ['Phone', profile.phone], ['Education', profile.education], ['Experience', profile.experience]])
    await page.getByLabel(label, {exact: true}).fill(value);
  await page.getByLabel('Custom skill', {exact: true}).fill('Python');
  await page.getByRole('button', {name: 'Add', exact: true}).click();
  await page.getByRole('button', {name: 'Save Profile', exact: true}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  const saved = await (await request('GET', '/profile')).json();
  for (const [key, value] of Object.entries(profile)) expect(saved[key]).toBe(value);
  expect(saved.skills).toEqual(['Python']);
  await page.reload();
  await expect(page.getByLabel('Experience', {exact: true})).toHaveValue(profile.experience);
  checks.push('Profile saved through UI, persisted through API and reload');

  const report = await recommendations();
  expect(report.status).toBe('ready');
  expect(report.evaluated).toBe(1);
  expect(report.matched).toBe(1);
  const item = report.items.find(value => value.job_id === seed.job_id);
  expect(item).toBeTruthy();
  expect(item.source_review.requires_human_review).toBe(true);
  const related = item.responsibility_matches.filter(value => value.outcome === 'related_evidence');
  expect(related.length).toBeGreaterThan(0);
  for (const reason of related) {
    expect(job.description).toContain(reason.job_evidence);
    for (const quote of reason.profile_evidence) expect(profile.experience).toContain(quote);
  }
  expect(item.supported).toEqual([]);
  expect(item.unknown.length).toBeGreaterThan(0);
  await expect(page.getByText('Locally corrected draft').first()).toBeVisible();
  await expect(page.getByRole('region', {name: 'Related project experience'})).toContainText('class project');
  await page.screenshot({path: path.join(output, 'real-job-recommendation.png'), fullPage: true});
  checks.push('One real Stripe snapshot suggested with exact JD/profile evidence; human review remains pending');

  // Negative controls must not manufacture suggestions from unrelated or learning-only profiles.
  await request('PUT', '/profile', {full_name: profile.full_name, skills: ['AutoCAD']});
  const unrelated = await (await request('POST', '/jobs/recommendations', {include_experience: true})).json();
  expect(unrelated.matched).toBe(0);
  await request('PUT', '/profile', {full_name: profile.full_name, experience: 'I want to learn Python.'});
  const learning = await (await request('POST', '/jobs/recommendations', {include_experience: true})).json();
  expect(learning.items).toEqual([]);
  await request('PUT', '/profile', {...profile, skills: ['Python']});
  checks.push('Unrelated and learning-only negative profiles do not generate suggestions');

  await page.goto(web + `/jobs/${seed.job_id}`);
  await page.getByRole('button', {name: '☆ Add to Favorites', exact: true}).click();
  await page.reload();
  await expect(page.getByRole('button', {name: '★ Favorited', exact: true})).toBeVisible();
  await page.goto(web + '/favorites');
  await expect(page.getByRole('article', {name: job.title})).toBeVisible();
  checks.push('Real job favorited, retained on reload and listed in Favorites');

  // A draft, not a false statement that we personally applied on the employer site.
  const realDraft = await (await request('POST', `/jobs/${seed.job_id}/applications`, {status: 'draft'}, 201)).json();
  expect(realDraft.status).toBe('draft');
  expect(realDraft.submitted_at).toBeNull();
  await request('POST', `/jobs/${seed.job_id}/applications`, {status: 'draft'}, 409);
  await page.goto(web + '/applications');
  await expect(page.getByRole('article', {name: job.title})).toContainText('Draft');
  checks.push('Real-job draft displayed in history with no submitted timestamp; duplicate refused');

  // The in-platform form is explicitly a separate sandbox use case, not a Stripe form.
  const bootstrap = await (await request('GET', '/assistant/bootstrap')).json();
  const fixture = bootstrap.forms.find(value => value.is_fixture);
  expect(fixture).toBeTruthy();
  const form = await (await request('GET', `/assistant/forms/${fixture.id}`)).json();
  const fixtureJob = await (await request('GET', `/jobs/${fixture.job_id}`)).json();
  expect(fixtureJob.company).toBe('JobPilot Sandbox Labs');
  await page.goto(web + `/jobs/${fixture.job_id}/apply`);
  await expect(page.getByLabel('Full name', {exact: false})).toHaveValue(profile.full_name);
  await expect(page.getByLabel('Contact email', {exact: false})).toHaveValue(profile.contact_email);
  await expect(page.getByRole('button', {name: 'Save application record', exact: true})).toBeDisabled();
  const finalValues = {};
  for (const field of form.fields_json) {
    const input = page.locator(`#application-${field.field_id}`);
    let value = await input.inputValue();
    if (field.field_id === 'motivation') {
      value = 'Fictional test answer: I want to practise building reliable backend services.';
      await input.fill(value);
    } else if (field.required) {
      const card = input.locator('..');
      await card.getByRole('button', {name: 'Confirm this field', exact: false}).click();
    }
    if (field.required || field.field_id === 'motivation') finalValues[field.field_id] = value;
  }
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Application record saved', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'View My Applications', exact: true}).click();
  const card = page.getByRole('article', {name: fixtureJob.title});
  await expect(card).toContainText('Record saved');
  await card.getByRole('button', {name: 'View saved answers', exact: true}).click();
  for (const value of Object.values(finalValues)) await expect(card).toContainText(value);
  await page.reload();
  await page.getByRole('article', {name: fixtureJob.title}).getByRole('button', {name: 'View saved answers', exact: true}).click();
  await expect(page.getByRole('article', {name: fixtureJob.title})).toContainText(finalValues.motivation);
  const history = await (await request('GET', '/applications')).json();
  expect(history.total).toBe(2);
  const assistant = history.items.find(value => value.method === 'assistant');
  const answers = await request('GET', `/applications/${assistant.id}/answers`);
  expect(answers.headers()['cache-control']).toBe('no-store');
  expect(Object.fromEntries((await answers.json()).answers.map(value => [value.field_id, value.value]))).toEqual(finalValues);
  checks.push('Sandbox profile prefill, required confirmation, manual motivation, save and answer display after reload');

  await page.screenshot({path: path.join(output, 'saved-answers-desktop.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path: path.join(output, 'saved-answers-mobile.png'), fullPage: true});
  checks.push('Desktop and mobile history/answers inspected without horizontal overflow');

  const secondEmail = `journey-other-${randomBytes(8).toString('hex')}@example.com`;
  await request('POST', '/auth/register', {email: secondEmail, password}, 201, null);
  const otherToken = (await (await request('POST', '/auth/login', {email: secondEmail, password}, 200, null)).json()).access_token;
  await request('GET', `/applications/${assistant.id}/answers`, undefined, 404, otherToken);
  await request('GET', `/applications/${realDraft.id}`, undefined, 404, otherToken);
  expect((await (await request('GET', '/applications', undefined, 200, otherToken)).json()).total).toBe(0);
  await request('GET', `/applications/${assistant.id}/answers`, undefined, 401, null);
  checks.push('Other ordinary account and unauthenticated clients cannot read private records/answers');
  const logout = page.waitForResponse(response => response.url() === api + '/auth/logout'
    && response.request().method() === 'POST');
  await page.getByRole('button', {name: 'Logout', exact: true}).click();
  expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(web + '/');
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBeNull();
  await request('GET', '/applications', undefined, 401);
  await page.goto(web + '/applications');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Sign in');
  checks.push('Logout clears access to application history');
  expect(failures).toEqual([]);
  expect(blocked).toEqual([]);
  const result = {
    result: 'passed', checked_at: new Date().toISOString(), checks,
    real_job: {title: job.title, company: job.company, source_url: job.source_url},
    source: 'Saved actual live artifact plus explicit source-bound agent correction; final human review pending',
    new_model_calls: 0, employer_submissions: 0, test_accounts: 2,
    optional_font_stylesheet_blocked: optionalFonts.size > 0,
    note: 'Isolated integration snapshot of pending PRs; not current main or a new live model acceptance.',
  };
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({result: 'passed', checks: checks.length, output}));
} finally {
  await context.close();
  await browser.close();
}
