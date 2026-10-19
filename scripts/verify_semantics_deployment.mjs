// Real local HTTP + built UI acceptance. No route interception or model calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium, expect} from '../extension/node_modules/@playwright/test/index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const web = process.env.SEMANTICS_WEB_ORIGIN || 'http://127.0.0.1:15176';
const api = process.env.SEMANTICS_API_ORIGIN || 'http://127.0.0.1:18316';
for (const origin of [web, api]) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port || url.origin !== origin)
    throw new Error('Acceptance permits explicit loopback origins only');
}
const seed = JSON.parse(await fs.readFile(path.join(root, 'output/semantics-deployment-seed.json'), 'utf8'));
const output = path.join(root, 'output/semantics-deployment');
await fs.mkdir(output, {recursive: true});
const browser = await chromium.launch({headless: true});
const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
const page = await context.newPage();
const checks = [];
try {
  const ids = seed.jobs;
  for (const entry of Object.values(ids)) {
    const response = await context.request.get(api + '/jobs/' + entry.job_id);
    expect(response.status()).toBe(entry.status === 'closed' ? 404 : 200);
    if (entry.status !== 'closed') {
      const data = await response.json();
      expect(data.source.name).toContain('ACCEPTANCE ONLY');
    }
  }
  const email = `semantics-${randomBytes(6).toString('hex')}@example.com`;
  const password = `Test!${randomBytes(16).toString('hex')}`;
  const registration = await context.request.post(api + '/auth/register', {data: {email, password}});
  expect(registration.status()).toBe(201);
  await page.goto(web + '/');
  await page.getByLabel('Email', {exact: true}).fill(email);
  await page.getByLabel('Password', {exact: true}).fill(password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page).toHaveURL(web + '/jobs');
  const token = await page.evaluate(() => localStorage.getItem('jobpilot_token'));
  const headers = {Authorization: `Bearer ${token}`};
  async function profile(skills) {
    const response = await context.request.put(api + '/profile', {headers, data: {full_name: 'Fictional Project Acceptance', skills}});
    expect(response.status()).toBe(200);
  }
  async function recommendations() {
    await page.goto(web + '/jobs');
    const response = page.waitForResponse(r => r.url() === api + '/jobs/recommendations' && r.request().method() === 'POST');
    await page.getByRole('button', {name: 'Find jobs for me', exact: true}).click();
    const data = await (await response).json();
    return data;
  }
  await profile(['Python']);
  const python = await recommendations();
  expect(python.status).toBe('ready');
  expect(python.items.map(j => j.job_id)).toEqual([ids.wovenstack_software_data_automation.job_id]);
  expect(python.items[0].overlaps.length).toBeGreaterThan(0);
  expect(python.items[0].supported).toEqual([]);
  expect(python.items[0].work_constraints).toHaveLength(5);
  expect(python.items[0].work_constraints.every(i => i.outcome === 'unknown')).toBe(true);
  checks.push('Python-only: one specific overlap, partial conditions, no AI-title/retail/closed filler recommendations');
  await page.goto(web + '/jobs/' + ids.wovenstack_software_data_automation.job_id);
  await page.getByRole('button', {name: 'Check my match', exact: true}).click();
  await page.locator('.job-match-evidence > summary').first().click();
  await expect(page.locator('.job-match')).toContainText('All listed conditions are required together.');
  await page.getByText('Work conditions to review', {exact: true}).click();
  await expect(page.locator('.job-work-constraints')).toContainText('compatibility unknown');
  await page.getByText('Role & responsibilities', {exact: true}).click();
  await expect(page.locator('.job-match')).toContainText('Conditional responsibility');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.locator('.job-match').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: path.join(output, `actual-software-${name}.png`)});
    await page.locator('.job-work-constraints').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(output, `actual-work-constraints-${name}.png`)});
  }
  checks.push('Built Docker UI: actual v2 conditions, conditional duties, evidence and unknown constraints at desktop/mobile');
  await profile(['想学 Python', '正在学 Python']);
  const learning = await recommendations();
  expect(learning.status).toBe('profile_needed');
  expect(learning.items).toEqual([]);
  await expect(page.locator('.job-recommendations')).toContainText('learning goals alone do not generate suggestions');
  checks.push('Learning-only Chinese profile: no mastered skill and no recommendations');
  await profile(['Canva']);
  const canva = await recommendations();
  expect(canva.items.map(j => j.job_id)).toEqual([ids.ilodia_retail.job_id]);
  expect(canva.items[0].supported).toEqual([]);
  const concrete = new Set(canva.items[0].overlaps.flatMap(i => i.skill_overlaps.map(s => s.skill_id)));
  expect([...concrete]).toEqual(['canva']);
  expect(canva.items[0].work_constraints.every(i => i.outcome === 'unknown')).toBe(true);
  await page.getByText('Review reasons and evidence', {exact: true}).click();
  await expect(page.locator('.recommendation-list')).toContainText('all listed conditions', {ignoreCase: true});
  await expect(page.locator('.recommendation-list')).toContainText('remote: not allowed');
  await expect(page.locator('.recommendation-list')).toContainText('Part-Time/Flexi');
  checks.push('Canva-only: compound partial, no language/trait score, part-time scope and remote prohibitions retained');
  await page.goto(web + '/jobs/' + ids.cynapse_ai_evaluation_quality_2.job_id);
  await page.getByRole('button', {name: 'Check my match', exact: true}).click();
  await page.getByText('Work conditions to review', {exact: true}).click();
  await expect(page.locator('.job-work-constraints')).toContainText('extracted number/unit requires review');
  await expect(page.locator('.job-work-constraints')).not.toContainText('4–unknown hours per week');
  checks.push('Actual model days-to-hours error: raw artifact retained, unsupported hours not presented as confirmed fact');
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({
    verified_at: new Date().toISOString(), web, api, checks,
    result: 'passed', model_calls_during_deployment: 0,
    provenance: 'Three actual live model outputs replayed into fresh PostgreSQL; synthetic test account; no HTTP mocks.',
    limits: 'Local isolated Docker only, not cloud deployment or human semantic approval.',
  }, null, 2));
  console.log(JSON.stringify({status: 'passed', checks: checks.length, output}));
} finally {
  await context.close();
  await browser.close();
}
