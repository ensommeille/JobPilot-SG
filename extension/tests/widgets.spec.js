import {test, expect} from '@playwright/test';
import {interactWithWidgets} from '../widgets.js';
import path from 'node:path';

const url = 'https://www.internsg.com/job-apply/123';
const html = `<form method="post"><input id="applicant_nationality" name="applicant_nationality">
<input type="hidden" id="applicant_nationality_code" name="applicant_nationality_code">
<input type="checkbox" id="campus_same_nationality" name="campus_same_nationality" checked>
<div id="row_campus_location" style="display:none"><input id="applicant_campus" name="applicant_campus">
<input type="hidden" id="applicant_campus_code" name="applicant_campus_code"></div>
<textarea id="applicant_summary" name="applicant_summary"></textarea><button type="submit">Submit</button></form>`;
async function setup(page) {
  await page.route('**/*', route => route.fulfill({body: html, contentType: 'text/html'}));
  await page.goto(url);
  await page.evaluate(() => { window.submits = 0; document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.submits++; }); });
}
const inspect = page => page.evaluate(interactWithWidgets, 'inspect');
const fill = (page, items) => page.evaluate(({source, items, url}) => (0, eval)(`(${source})`)('fill', url, items), {source: interactWithWidgets.toString(), items, url});

test('uninitialized widgets produce explicit reasons and never write', async ({page}) => {
  await setup(page);
  expect((await inspect(page)).countryReason).toContain('unavailable');
  const result = await fill(page, [{id: 'applicant_summary', value: 'Example', confirmed: true}]);
  expect(result.reasons.applicant_summary).toContain('not ready');
  expect(result.filled).toEqual([]);
});
test('rejects unsafe hosts and unconfirmed widget operations', async ({page}) => {
  await setup(page);
  await expect(fill(page, [{id: 'applicant_summary', value: 'Test', confirmed: false}])).rejects.toThrow();
  await expect(fill(page, [{id: 'btnSubmit', value: 'Test', confirmed: true}])).rejects.toThrow();
  await page.goto('https://evil.test/job-apply/123');
  await expect(inspect(page)).rejects.toThrow();
});

// Offline coverage of extension-style key reordering, independent of downloaded libraries.
async function mockCountries(page) {
  await setup(page);
  await page.evaluate(() => {
    const countries = [{iso2: 'sg', name: 'Singapore'}, {iso2: 'cn', name: 'China'}];
    for (const id of ['applicant_nationality', 'applicant_campus']) {
      document.getElementById(id).value = 'Singapore'; document.getElementById(id + '_code').value = 'sg';
    }
    window.jQuery = el => ({data: () => true, trigger: () => {}, countrySelect: (operation, code) => {
      if (operation === 'getSelectedCountryData') return countries.find(c => c.iso2 === document.getElementById(el.id + '_code').value);
      if (operation === 'selectCountry') { el.value = countries.find(c => c.iso2 === code).name; document.getElementById(el.id + '_code').value = code; }
    }});
    window.jQuery.fn = {countrySelect: {getCountryData: () => countries}};
  });
}
test('offline: reordered snapshot keys do not imply changed selections', async ({page}) => {
  await mockCountries(page);
  const before = await inspect(page);
  const expectedState = Object.fromEntries(Object.entries(before.countryState).reverse());
  const result = await fill(page, [{id: 'applicant_countries', value: JSON.stringify({nationality: 'cn', campus: 'sg'}), expectedState, confirmed: true}]);
  expect(result.filled).toEqual(['applicant_countries']);
  expect(result.reasons).toEqual({});
  await expect(page.locator('#applicant_nationality')).toHaveValue('China');
  await expect(page.locator('#campus_same_nationality')).not.toBeChecked();
});
test('offline: every changed or missing snapshot field still blocks replacement', async ({page}) => {
  await mockCountries(page);
  const before = await inspect(page);
  for (const key of Object.keys(before.countryState)) {
    for (const missing of [false, true]) {
      const expectedState = {...before.countryState};
      if (missing) delete expectedState[key];
      else expectedState[key] = key === 'same' ? false : 'different';
      const result = await fill(page, [{id: 'applicant_countries', value: JSON.stringify({nationality: 'cn', campus: 'sg'}), expectedState, confirmed: true}]);
      expect(result.filled).toEqual([]);
      expect(result.reasons.applicant_countries).toContain('changed');
    }
  }
  await expect(page.locator('#applicant_nationality')).toHaveValue('Singapore');
  expect(await page.evaluate(() => window.submits)).toBe(0);
});

test.describe('actual InternSG widget libraries in an isolated form', () => {
  test.skip(!process.env.WIDGET_ASSET_DIR, 'Optional verification using downloaded public widget libraries; no employer form is submitted.');
  test.beforeEach(async ({page}) => {
    await setup(page);
    for (const name of ['jquery.js', 'country.js', 'froala.js']) await page.addScriptTag({path: path.join(process.env.WIDGET_ASSET_DIR, name)});
    await page.evaluate(() => {
      const $ = window.jQuery;
      $('#applicant_nationality, #applicant_campus').countrySelect({preferredCountries: ['sg', 'cn']});
      $('#applicant_nationality').on('change', () => $('#applicant_campus').countrySelect('setCountry', $('#applicant_nationality').countrySelect('getSelectedCountryData').name));
      $('#campus_same_nationality').on('change', () => $('#row_campus_location').toggle(!$('#campus_same_nationality')[0].checked));
      new window.FroalaEditor('#applicant_summary', {attribution: false});
    });
    await expect.poll(async () => (await inspect(page)).richReady).toBe(true);
  });
  test('fills rich text as escaped text and synchronizes backing textarea', async ({page}) => {
    const result = await fill(page, [{id: 'applicant_summary', value: 'Fictional summary\n<script>bad()</script> & 中文', confirmed: true}]);
    expect(result.reasons).toEqual({});
    expect(result.filled).toEqual(['applicant_summary']);
    const value = await page.locator('#applicant_summary').inputValue();
    expect(value).toContain('&lt;script&gt;');
    expect(await page.locator('.fr-element').innerText()).toContain('<script>bad()</script> & 中文');
    expect((await fill(page, [{id: 'applicant_summary', value: 'Overwrite', confirmed: true}])).reasons.applicant_summary).toContain('not overwritten');
    expect(await page.evaluate(() => window.submits)).toBe(0);
  });
  test('sets both countries and hidden codes, restores campus after nationality change', async ({page}) => {
    const before = await inspect(page);
    const result = await fill(page, [{id: 'applicant_countries', value: JSON.stringify({nationality: 'cn', campus: 'sg'}), expectedState: before.countryState, confirmed: true}]);
    expect(result.filled).toEqual(['applicant_countries']);
    await expect(page.locator('#applicant_nationality_code')).toHaveValue('cn');
    await expect(page.locator('#applicant_campus_code')).toHaveValue('sg');
    await expect(page.locator('#campus_same_nationality')).not.toBeChecked();
    await expect(page.locator('#row_campus_location')).toBeVisible();
    expect((await fill(page, [{id: 'applicant_countries', value: JSON.stringify({nationality: 'sg', campus: 'sg'}), expectedState: before.countryState, confirmed: true}])).reasons.applicant_countries).toContain('changed');
    expect(await page.evaluate(() => window.submits)).toBe(0);
  });
  test('unchanged country values survive reordered keys across an extension boundary', async ({page}) => {
    const before = await inspect(page);
    const expectedState = Object.fromEntries(Object.entries(before.countryState).sort(([a], [b]) => a.localeCompare(b)));
    expect(JSON.stringify(expectedState)).not.toBe(JSON.stringify(before.countryState));
    const result = await fill(page, [{id: 'applicant_countries', value: JSON.stringify({nationality: 'cn', campus: 'sg'}), expectedState, confirmed: true}]);
    expect(result.reasons).toEqual({});
    expect(result.filled).toEqual(['applicant_countries']);
    await expect(page.locator('#applicant_nationality_code')).toHaveValue('cn');
    await expect(page.locator('#applicant_campus_code')).toHaveValue('sg');
    expect(await page.evaluate(() => window.submits)).toBe(0);
  });
});
