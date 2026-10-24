import {test, expect} from '@playwright/test';
import {interactWithATSPage, matchATSSelectOption, parseATSInspectionResult} from '../ats-page.js';

const greenhouse = 'https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123';
const lever = 'https://jobs.lever.co/acme/abc-123/apply';
const ashby = 'https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application';
const approved = (field, value) => ({id: field.id, key: field.key, label: field.label, kind: field.kind,
  evidenceKey: field.evidenceKey, value, confirmed: true,
  ...(['select', 'combobox'].includes(field.kind) ? {optionLabel: field.kind === 'combobox' ? value
    : field.options.find(option => option.value === value)?.label} : {})});
async function fixture(page, url, markup, script = '', formless = false) {
  await page.route(url, route => route.fulfill({status: 200, contentType: 'text/html', body: `<!doctype html><html><body>
    ${formless ? markup : '<form id="application">' + markup + '<button type="submit">Submit</button></form>'}
    <script>window.submits=0;document.querySelector('form')?.addEventListener('submit',event=>{event.preventDefault();window.submits++});${script}</script>
    </body></html>`}));
  await page.goto(url);
}
test('Greenhouse reviewed identity fields persist after blur while legal controls and submit stay untouched', async ({page}) => {
  await fixture(page, greenhouse, `<label>First name<input name="first_name"></label><label>Last name<input name="last_name"></label>
    <label>Email<input name="email" type="email"></label><label>Phone<input name="phone" type="tel"></label>
    <label>Cover letter<textarea name="cover_letter"></textarea></label><label><input name="agree" type="checkbox">I agree to privacy terms</label>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [approved(review.fields.find(field => field.id === 'first_name'), 'MING'),
      approved(review.fields.find(field => field.id === 'last_name'), 'LI'), approved(review.fields.find(field => field.id === 'email'), 'user@example.test')]});
  expect(result).toEqual({filled: ['first_name', 'last_name', 'email'], skipped: [], reasons: {}, submitted: false});
  await expect(page.locator('input[name="first_name"]')).toHaveValue('MING');
  await expect(page.locator('textarea[name="cover_letter"]')).toHaveValue('');
  await expect(page.locator('input[name="agree"]')).not.toBeChecked();
  expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('Lever keeps occupied answers, uses unique sibling availability label and forbids negative skills inference', async ({page}) => {
  await fixture(page, lever, `<label>Name<input name="name"></label><label>Email<input name="email" value="existing@example.test"></label>
    <ul><li><div class="application-label">When is your availability (eg. Jan to Jun 2027)?✱</div><input name="cards[123][field1]"></li></ul>
    <label>Programming languages<textarea name="skills"></textarea></label>
    <label>Which technical skills do you not have?<textarea name="negative"></textarea></label>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const availability = review.fields.find(field => field.evidenceKey === 'availability');
  expect(review.fields.find(field => field.key === 'name:skills').evidenceKey).toBe('skills');
  expect(review.fields.find(field => field.key === 'name:negative').manualOnly).toBe(true);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: lever,
    approved: [approved(review.fields.find(field => field.id === 'full_name'), 'LI MING'),
      approved(review.fields.find(field => field.id === 'email'), 'new@example.test'), approved(availability, 'Jan to Jun 2027')]});
  expect(result.filled).toEqual(['full_name', availability.id]); expect(result.skipped).toEqual(['email']);
  await expect(page.locator('input[name="email"]')).toHaveValue('existing@example.test');
  await expect(page.locator('textarea[name="negative"]')).toHaveValue('');
  expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('ordinary native choices and unknown text may be explicitly filled without turning citizenship into a saved fact', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><label for="country">Nationality✱</label><select id="country" name="nationality">
    <option value="">Choose one</option><option value="CN">China</option><option value="SG">Singapore</option></select>
    <label>Preferred working hours<input name="hours"></label><label>Citizenship<select name="citizen"><option value="">Choose one</option><option value="CN">China</option></select></label>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const country = review.fields.find(field => field.evidenceKey === 'nationality_country');
  const hours = review.fields.find(field => field.key === 'name:hours');
  expect(hours.evidenceKey).toBeNull(); expect(hours.needsMapping).toBe(true);
  expect(matchATSSelectOption(country, 'cn')).toBe('CN');
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [approved(country, 'CN'), approved(hours, 'Weekdays')]});
  expect(result.filled).toEqual([country.id, hours.id]);
  await expect(page.locator('select[name="citizen"]')).toHaveValue('');
});
test('changed question or dropdown meaning rejects the whole preview before the first write', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><label for="campus">Country of study</label><select id="campus" name="campus">
    <option value="">Choose one</option><option value="SG">Singapore</option></select>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const country = review.fields.find(field => field.kind === 'select');
  await page.locator('option[value="SG"]').evaluate(node => { node.textContent = 'Different meaning'; });
  await expect(page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [approved(review.fields.find(field => field.id === 'first_name'), 'MING'), approved(country, 'SG')]})).rejects.toThrow('option changed');
  await expect(page.locator('input[name="first_name"]')).toHaveValue('');
});
test('asynchronous blur clearing is a skipped answer and never a success', async ({page}) => {
  await fixture(page, greenhouse, '<label>First name<input name="first_name"></label>',
    `document.querySelector('input').addEventListener('blur',event=>setTimeout(()=>{event.target.value=''},180));`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse, approved: [approved(review.fields[0], 'MING')]});
  expect(result.filled).toEqual([]); expect(result.skipped).toEqual(['first_name']); expect(result.reasons.first_name).toContain('disappeared');
});
test('observed GH React-select semantics require real option selection, not query input text', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><label id="degree-label" for="degree--0">Degree</label>
    <div class="select"><div class="select__value-container"><input id="degree--0" role="combobox" aria-labelledby="degree-label"></div></div>`, `
    const input=document.getElementById('degree--0'), container=input.closest('.select');
    input.addEventListener('click',()=>{document.getElementById('degree-options')?.remove();
      const box=document.createElement('div');box.id='degree-options';box.setAttribute('role','listbox');
      for(const name of ["Bachelor's Degree","Master's Degree"]){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=name;
        option.addEventListener('click',()=>{container.querySelector('.select__single-value')?.remove();const value=document.createElement('div');value.className='select__single-value';value.textContent=name;container.append(value);input.value='';box.remove();});box.append(option);}
      document.body.append(box);input.setAttribute('aria-controls',box.id);});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){document.getElementById('degree-options')?.remove();input.removeAttribute('aria-controls')}});`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const degree = review.fields.find(field => field.kind === 'combobox');
  expect(degree.options.map(option => option.label)).toEqual(["Bachelor's Degree", "Master's Degree"]);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse, approved: [approved(degree, "Master's Degree")]});
  expect(result.filled).toEqual([degree.id]); await expect(page.locator('.select__single-value')).toHaveText("Master's Degree");
  await expect(page.locator('#degree--0')).toHaveValue(''); expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('Ashby formless scope uses real date path and excludes the separate résumé parser', async ({page}) => {
  await fixture(page, ashby, `<input id="outside-parser" type="file" aria-label="Resume">
    <div class="ashby-application-form-container"><label>Name<input name="_systemfield_name"></label><label>Email<input type="email" name="_systemfield_email"></label>
      <div class="ashby-application-form-field-entry" data-field-path="start-path"><label class="ashby-application-form-question-title">Start Date of Internship</label>
      <div class="react-datepicker__input-container"><input class="ashby-application-form-input-date" placeholder="Pick date..."></div></div>
      <label>Resume<input id="_systemfield_resume" type="file" accept=".pdf" style="width:1px;height:1px"></label></div>`, '', true);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  expect(review.provider).toBe('Ashby'); expect(review.resumeTarget.key).toBe('id:_systemfield_resume');
  const date = review.fields.find(field => field.kind === 'date'); expect(date.key).toBe('ashby:start-path');
  expect((await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: ashby, approved: [approved(date, '2026-10-30')]})).filled).toEqual([date.id]);
  await expect(page.locator('.ashby-application-form-input-date')).toHaveValue('10/30/2026');
});
test('attachment is separate, exact-target and hash checked without submitting', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><label>Resume/CV<input name="resume" type="file" accept=".pdf"></label>
    <label>Cover letter<input name="cover" type="file"></label>`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const target = review.resumeTarget;
  const file = await page.evaluate(async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nfixture');
    return {name: 'fixture.pdf', base64: btoa(String.fromCharCode(...bytes)), size_bytes: bytes.length,
      sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')};
  });
  const result = await page.evaluate(interactWithATSPage, {action: 'attach', expectedUrl: greenhouse,
    targetKey: target.key, targetLabel: target.label, confirmed: true, file});
  expect(result.selected).toBe(true); expect(result.submitted).toBe(false);
  expect(await page.locator('input[name="resume"]').evaluate(node => node.files[0].name)).toBe('fixture.pdf');
  expect(await page.locator('input[name="cover"]').evaluate(node => node.files.length)).toBe(0);
  expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('canonical EU and Ashby hosts are exact, and nearby origins/paths cannot fill', async ({page}) => {
  for (const url of [greenhouse.replace('?gh_jid=123', '?gh_jid=456'),
    'https://jobs.lever.co.evil.test/acme/abc-123/apply', ashby + '?x=1', ashby + '#apply', ashby.replace('/application', '/application/else')]) {
    await fixture(page, url, '<input name="name">');
    const result = await page.evaluate(interactWithATSPage, {action: 'inspect'});
    expect(result.error.code).toBe('unsupported_page');
    expect(() => parseATSInspectionResult([{frameId: 0, documentId: 'fixture-doc', result}])).toThrow('supported hosted application');
  }
  const eu = 'https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101';
  await fixture(page, eu, '<input name="first_name">');
  expect((await page.evaluate(interactWithATSPage, {action: 'inspect'})).provider).toBe('Greenhouse');
});
