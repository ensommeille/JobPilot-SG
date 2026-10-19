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
