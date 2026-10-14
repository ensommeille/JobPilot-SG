import {test, expect} from '@playwright/test';
import {interactWithPage} from '../page.js';

const url = 'https://www.internsg.com/job-apply/123';
const fixture = `<title>Fictional Job — Test only</title><form method="post">
<input id="applicant_name" name="applicant_name"><input id="applicant_email" name="applicant_email">
<input id="applicant_contact" name="applicant_contact"><input id="applicant_period" name="applicant_period">
<textarea id="applicant_summary" name="applicant_summary"></textarea>
<input id="applicant_nationality" name="applicant_nationality"><input type="hidden" name="token" value="untouched">
<input type="checkbox" id="consent"><button type="submit" id="btnSubmit">Submit</button></form>`;

async function setup(page, html = fixture, target = url) {
  await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: html}));
  await page.goto(target);
  await page.evaluate(() => { window.submits = 0; document.addEventListener('submit', e => { e.preventDefault(); window.submits++; }); });
}
const inspect = page => page.evaluate(interactWithPage, 'inspect');
async function fill(page, values, expectedUrl = url) {
  return page.evaluate(({source, values, expectedUrl}) => {
    const fn = (0, eval)(`(${source})`);
    return fn('fill', expectedUrl, values);
  }, {source: interactWithPage.toString(), values, expectedUrl});
}
test('extracts supported fields without leaking existing values or hidden secrets', async ({page}) => {
  await setup(page);
  await page.locator('#applicant_email').fill('private@example.test');
  const result = await inspect(page);
  expect(result.fields).toHaveLength(5);
  expect(result.fields.find(f => f.id === 'applicant_email').occupied).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private@example.test');
  expect(JSON.stringify(result)).not.toContain('untouched');
});
test('fills only confirmed empty fields and never submits or checks consent', async ({page}) => {
  await setup(page);
  const result = await fill(page, [{id: 'applicant_name', value: 'Fictional Applicant', confirmed: true}]);
  expect(result).toEqual({filled: ['applicant_name'], skipped: [], reasons: {}, submitted: false});
  await expect(page.locator('#applicant_name')).toHaveValue('Fictional Applicant');
  await expect(page.locator('#consent')).not.toBeChecked();
  expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('protects user edits made after inspection and is repeat-safe', async ({page}) => {
  await setup(page); await inspect(page);
  await page.locator('#applicant_name').fill('My own answer');
  const values = [{id: 'applicant_name', value: 'Replacement', confirmed: true}];
  expect((await fill(page, values)).skipped).toEqual(['applicant_name']);
  await expect(page.locator('#applicant_name')).toHaveValue('My own answer');
});
test('rejects unconfirmed, unknown, duplicate and oversized fields before any writes', async ({page}) => {
  await setup(page);
  for (const values of [
    [{id: 'applicant_name', value: 'Test', confirmed: false}],
    [{id: 'btnSubmit', value: 'Submit', confirmed: true}],
    [{id: 'applicant_name', value: 'x'.repeat(201), confirmed: true}],
    [{id: 'applicant_name', value: 'One', confirmed: true}, {id: 'applicant_name', value: 'Two', confirmed: true}],
  ]) await expect(fill(page, values)).rejects.toThrow();
  await expect(page.locator('#applicant_name')).toHaveValue('');
});
test('rejects navigation and unrelated hosts', async ({page}) => {
  await setup(page);
  await expect(fill(page, [], url + '4')).rejects.toThrow('Page changed');
  await page.goto('https://www.internsg.com.evil.test/job-apply/123');
  await expect(inspect(page)).rejects.toThrow('Open an InternSG');
});
test('skips hidden, disabled, duplicated and wrong-type controls', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    document.getElementById('applicant_name').style.display = 'none';
    document.getElementById('applicant_contact').disabled = true;
    document.getElementById('applicant_email').type = 'password';
    document.querySelector('form').append(document.getElementById('applicant_period').cloneNode());
  });
  expect((await inspect(page)).fields.map(f => f.id)).toEqual(['applicant_summary']);
});
test('dispatches input/change and respects native maxlength', async ({page}) => {
  await setup(page);
  await page.evaluate(() => {
    window.events = [];
    const input = document.getElementById('applicant_name'); input.maxLength = 3;
    for (const name of ['input', 'change']) input.addEventListener(name, () => window.events.push(name));
  });
  expect((await fill(page, [{id: 'applicant_name', value: 'Long name', confirmed: true}])).skipped).toHaveLength(1);
  await fill(page, [{id: 'applicant_name', value: 'Ada', confirmed: true}]);
  expect(await page.evaluate(() => window.events)).toEqual(['input', 'change']);
});
test('does not accept a form posting to an unrelated origin', async ({page}) => {
  await setup(page, fixture.replace('method="post"', 'method="post" action="https://evil.test"'));
  expect((await inspect(page)).fields).toEqual([]);
});
