import {test, expect} from '@playwright/test';
import {interactWithATSPage} from '../ats-page.js';

const greenhouse = 'https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123';
const lever = 'https://jobs.lever.co/acme/abc-123/apply';

async function fixture(page, url, markup) {
  await page.route(url, route => route.fulfill({status: 200, contentType: 'text/html', body: `
    <!doctype html><html><body><form id="application">${markup}<button type="submit">Submit</button></form>
    <script>window.submits=0;document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submits++})</script>
    </body></html>`}));
  await page.goto(url);
}

test('Greenhouse fills only explicitly reviewed identity fields, never submits', async ({page}) => {
  await fixture(page, greenhouse, '<input name="first_name"><input name="last_name"><input name="email" type="email"><input name="phone" type="tel"><textarea name="cover_letter"></textarea>');
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  expect(review.provider).toBe('Greenhouse');
  expect(review.fields.map(field => field.id)).toEqual(['first_name', 'last_name', 'email', 'phone']);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [
      {id: 'first_name', value: 'Lin', confirmed: true},
      {id: 'last_name', value: 'Xinda', confirmed: true},
      {id: 'email', value: 'lin@example.test', confirmed: true},
    ]});
  expect(result).toEqual({filled: ['first_name', 'last_name', 'email'], skipped: [], submitted: false});
  await expect(page.locator('input[name="first_name"]')).toHaveValue('Lin');
  await expect(page.locator('textarea[name="cover_letter"]')).toHaveValue('');
  expect(await page.evaluate(() => window.submits)).toBe(0);
});

test('Lever preserves existing answers and rejects changed URL or unreviewed fields', async ({page}) => {
  await fixture(page, lever, '<input name="name"><input name="email" value="existing@example.test"><input name="phone">');
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  expect(review.provider).toBe('Lever');
  expect(review.fields.find(field => field.id === 'email').occupied).toBe(true);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: lever,
    approved: [{id: 'full_name', value: 'Lin Xinda', confirmed: true}, {id: 'email', value: 'new@example.test', confirmed: true}]});
  expect(result).toEqual({filled: ['full_name'], skipped: ['email'], submitted: false});
  await expect(page.locator('input[name="email"]')).toHaveValue('existing@example.test');
  expect(await page.evaluate(() => window.submits)).toBe(0);
  await expect(page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: lever + 'changed', approved: []})).rejects.toThrow('URL changed');
  await expect(page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: lever,
    approved: [{id: 'consent', value: 'yes', confirmed: true}]})).rejects.toThrow('Invalid reviewed');
});

test('Greenhouse rejects a mismatched job id in query parameters', async ({page}) => {
  const mismatched = 'https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=456';
  await fixture(page, mismatched, '<input name="first_name">');
  await expect(page.evaluate(interactWithATSPage, {action: 'inspect'})).rejects.toThrow('supported');
});

test('only exact hosted application origins are accepted', async ({page}) => {
  const spoof = 'https://jobs.lever.co.evil.test/acme/abc-123/apply';
  await fixture(page, spoof, '<input name="name">');
  await expect(page.evaluate(interactWithATSPage, {action: 'inspect'})).rejects.toThrow('supported');
});

test('reviewed profile-backed questions fill while legal and unsupported questions remain untouched', async ({page}) => {
  await fixture(page, lever, `<input name="name"><input name="email">
    <label for="linkedin">LinkedIn Profile</label><input id="linkedin" name="urls[LinkedIn]" type="url">
    <label for="skills">Relevant technical skills</label><textarea id="skills" name="questions[1]"></textarea>
    <label for="visa">Will you need visa sponsorship?</label><textarea id="visa" name="questions[2]"></textarea>
    <label for="why">Why this company?</label><textarea id="why" name="questions[3]"></textarea>
    <label for="missing">Which technical skills do you not have?</label><textarea id="missing" name="questions[4]"></textarea>
    <input name="resume" type="file"><input name="agree" type="checkbox">`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  expect(review.fields.filter(field => field.evidenceKey).map(field => field.evidenceKey)).toEqual(['linkedin', 'skills']);
  expect(review.manualQuestions).toEqual(['Will you need visa sponsorship?', 'Why this company?', 'Which technical skills do you not have?']);
  const [linkedin, skills] = review.fields.filter(field => field.evidenceKey);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: lever, approved: [
    {id: linkedin.id, key: linkedin.key, label: linkedin.label, evidenceKey: linkedin.evidenceKey, value: 'https://www.linkedin.com/in/example', confirmed: true},
    {id: skills.id, key: skills.key, label: skills.label, evidenceKey: skills.evidenceKey, value: 'Python, SQL', confirmed: true},
  ]});
  expect(result).toEqual({filled: [linkedin.id, skills.id], skipped: [], submitted: false});
  await expect(page.locator('#linkedin')).toHaveValue('https://www.linkedin.com/in/example');
  await expect(page.locator('#skills')).toHaveValue('Python, SQL');
  await expect(page.locator('#visa')).toHaveValue('');
  await expect(page.locator('#why')).toHaveValue('');
  await expect(page.locator('#missing')).toHaveValue('');
  expect(await page.evaluate(() => window.submits)).toBe(0);
});

test('custom question label changes invalidate review and never fill a different question', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><label for="skills">Relevant skills</label><textarea id="skills" name="questions[1]"></textarea>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const field = review.fields.find(item => item.evidenceKey === 'skills');
  await page.locator('label[for="skills"]').evaluate(node => { node.textContent = 'Why this company?'; });
  await expect(page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse, approved: [
    {id: field.id, key: field.key, label: field.label, evidenceKey: field.evidenceKey, value: 'Python', confirmed: true},
  ]})).rejects.toThrow('Invalid reviewed');
  await expect(page.locator('#skills')).toHaveValue('');
});

test('occupied custom answer is not overwritten and unlabeled field is ignored', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><label for="summary">Tell us about yourself</label>
    <textarea id="summary" name="questions[1]">Existing answer</textarea><textarea name="questions[2]"></textarea>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const field = review.fields.find(item => item.evidenceKey === 'summary');
  expect(field.occupied).toBe(true);
  expect(review.fields.some(item => item.key === 'name:questions[2]')).toBe(false);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse, approved: [
    {id: field.id, key: field.key, label: field.label, evidenceKey: field.evidenceKey, value: 'New answer', confirmed: true},
  ]});
  expect(result.skipped).toEqual([field.id]);
  await expect(page.locator('#summary')).toHaveValue('Existing answer');
});
