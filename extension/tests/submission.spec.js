import {test, expect} from '@playwright/test';
import {submissionPage, reserveAttempt} from '../submission.js';

const url = 'https://www.internsg.com/job-apply/123';
const fixture = `<title>Apply for Job</title><form method="post">
<div class="alert-info"><div class="text-center">Application for: Fictional Intern. Fictional employer.</div></div>
<input id="applicant_name" name="applicant_name" value="Fictional Applicant">
<input id="applicant_email" name="applicant_email" value="fictional@example.test">
<input id="applicant_contact" name="applicant_contact" value="12345678">
<input id="applicant_period" name="applicant_period" value="January to March 2027">
<input id="applicant_nationality" name="applicant_nationality" value="Singapore">
<input id="applicant_nationality_code" name="applicant_nationality_code" type="hidden" value="sg">
<input id="applicant_campus" name="applicant_campus" value="Singapore">
<input id="applicant_campus_code" name="applicant_campus_code" type="hidden" value="sg">
<input id="campus_same_nationality" name="campus_same_nationality" type="checkbox" checked>
<textarea id="applicant_summary" name="applicant_summary">Fictional summary only.</textarea>
<textarea name="g-recaptcha-response" hidden>DO-NOT-RETURN-CAPTCHA-TOKEN</textarea>
<input id="btnSubmit" name="btnSubmit" type="submit" value="Submit Application"></form>`;
async function setup(page) {
  await page.route('**/*', route => route.fulfill({body: fixture, contentType: 'text/html'}));
  await page.goto(url);
  await page.evaluate(() => {
    window.submits = 0; window.clicks = 0; window.captchaComplete = true;
    document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.submits++; });
    document.querySelector('#btnSubmit').addEventListener('click', () => window.clicks++);
    window.grecaptcha = {getResponse: () => window.captchaComplete ? 'DO-NOT-RETURN-CAPTCHA-TOKEN' : ''};
    window.jQuery = () => ({data: () => true, countrySelect: () => ({iso2: 'sg', name: 'Singapore'})});
    window.jQuery.fn = {countrySelect: true};
  });
}
const invoke = (page, command, approval = null) => page.evaluate(({source, command, approval, url}) => (0, eval)(`(${source})`)(command, url, approval), {source: submissionPage.toString(), command, approval, url});
const approve = review => ({fingerprint: review.fingerprint, reviewedAt: review.reviewedAt, confirmed: true});

test('review exposes actual answers and recipient but never captcha tokens or submission', async ({page}) => {
  await setup(page);
  const review = await invoke(page, 'review');
  expect(review.values['Application recipient']).toContain('Fictional employer');
  expect(review.values.Email).toBe('fictional@example.test');
  expect(review.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(review)).not.toContain('DO-NOT-RETURN');
  expect(await page.evaluate(() => window.clicks)).toBe(0);
});
test('explicit fresh approval invokes the actual button and native submit handlers once', async ({page}) => {
  await setup(page);
  const review = await invoke(page, 'review');
  expect((await invoke(page, 'submit', approve(review))).state).toBe('click_attempted');
  expect(await page.evaluate(() => [window.clicks, window.submits])).toEqual([1, 1]);
});
test('missing or expired CAPTCHA blocks without clicking and never solves it', async ({page}) => {
  await setup(page);
  const review = await invoke(page, 'review');
  await page.evaluate(() => { window.captchaComplete = false; });
  expect((await invoke(page, 'submit', approve(review))).state).toBe('not_clicked');
  expect((await invoke(page, 'review')).captchaReady).toBe(false);
  expect(await page.evaluate(() => window.clicks)).toBe(0);
});
test('edited answers, recipient changes, expired or missing approval cannot submit', async ({page}) => {
  await setup(page);
  const review = await invoke(page, 'review');
  expect((await invoke(page, 'submit', {...approve(review), confirmed: false})).state).toBe('not_clicked');
  expect((await invoke(page, 'submit', {...approve(review), reviewedAt: Date.now() - 180000})).state).toBe('not_clicked');
  await page.locator('#applicant_contact').fill('87654321');
  expect((await invoke(page, 'submit', approve(review))).state).toBe('not_clicked');
  const next = await invoke(page, 'review');
  await page.locator('.text-center').evaluate(el => { el.textContent = 'Different employer'; });
  expect((await invoke(page, 'submit', approve(next))).state).toBe('not_clicked');
  expect(await page.evaluate(() => window.clicks)).toBe(0);
});
test('missing fields, foreign action, ambiguous submit controls fail closed', async ({page}) => {
  await setup(page);
  await page.locator('#applicant_contact').fill('');
  await expect(invoke(page, 'review')).rejects.toThrow('Contact number');
  await page.locator('#applicant_contact').fill('12345678');
  await page.locator('form').evaluate(el => { el.action = 'https://evil.test/'; });
  await expect(invoke(page, 'review')).rejects.toThrow('Unsupported');
  await page.locator('form').evaluate(el => { el.removeAttribute('action'); el.append(document.querySelector('#btnSubmit').cloneNode()); });
  await expect(invoke(page, 'review')).rejects.toThrow('ambiguous');
  expect(await page.evaluate(() => window.clicks)).toBe(0);
});
test('result messages, including apparent success, do not imply confirmed delivery', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    const note = document.createElement('div'); note.className = 'alert-success'; note.textContent = 'Application received'; document.body.append(note);
  });
  const result = await invoke(page, 'result');
  expect(result.state).toBe('unverified');
  expect(result.messages).toEqual(['Application received']);
  expect(await page.evaluate(() => window.clicks)).toBe(0);
});
test('durable reservation survives reopen and serializes competing popup attempts', async ({page}) => {
  await setup(page);
  const result = await page.evaluate(async source => {
    const reserve = (0, eval)(`(${source})`);
    const storage = {get: async key => ({[key]: JSON.parse(localStorage.getItem(key))}), set: async items => { for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value)); }};
    const attempts = await Promise.allSettled([reserve(storage, navigator.locks, 'attempt-1', {state: 'reserved'}), reserve(storage, navigator.locks, 'attempt-1', {state: 'reserved'})]);
    return attempts.map(item => item.status);
  }, reserveAttempt.toString());
  expect(result.sort()).toEqual(['fulfilled', 'rejected']);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('attempt-1')).state)).toBe('reserved');
});
