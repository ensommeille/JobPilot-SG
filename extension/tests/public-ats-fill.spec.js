import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {interactWithATSPage, matchATSSelectOption, parseATSInspectionResult, parseATSFillResult} from '../ats-page.js';

const greenhouse = 'https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123';
const lever = 'https://jobs.lever.co/acme/abc-123/apply';
const ashby = 'https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application';
// Captured React DOM state: each native education select has value='' and
// selectedIndex=0 even though its placeholder is disabled. outerHTML omits
// that live property; an HTML parser would otherwise choose the first value.
const restoreAshbyEmptyDateState = `for(const id of ['_systemfield_education_history-startDate','_systemfield_education_history-endDate']) {
  for(const select of document.getElementById(id)?.querySelectorAll('select') || []) select.selectedIndex=0;
}`;
const approved = (field, value) => ({id: field.id, key: field.key, label: field.label, kind: field.kind,
  evidenceKey: field.evidenceKey, value, confirmed: true,
  ...(['select', 'combobox'].includes(field.kind) ? {optionLabel: field.kind === 'combobox' ? value
    : field.options.find(option => option.value === value)?.label} : {})});
async function fixture(page, url, markup, script = '', formless = false) {
  // Real hosted forms declare their encoding. Without it, the browser can
  // decode UTF-8 question text (notably the required-field ✱) as Windows-1252.
  await page.route(url, route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"></head><body>
    ${formless ? markup : '<form id="application">' + markup + '<button type="submit">Submit</button></form>'}
    <script>window.submits=0;document.querySelector('form')?.addEventListener('submit',event=>{event.preventDefault();window.submits++});${script}</script>
    </body></html>`}));
  await page.goto(url);
  expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
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
  expect(availability?.label).toBe('When is your availability (eg. Jan to Jun 2027)?✱');
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
  expect(country?.label).toBe('Nationality✱');
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
  const rejected = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [approved(review.fields.find(field => field.id === 'first_name'), 'MING'), approved(country, 'SG')]});
  expect(rejected).toMatchObject({fill_version: 1, ok: false, mutation_started: false, error: {code: 'option_changed', stage: 'fill_preflight'}});
  expect(() => parseATSFillResult([{documentId: 'fixture-doc', result: rejected}], 'fixture-doc')).toThrow('option changed');
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

test('observed GH control mousedown opens phone-country options while an empty unrelated field cannot block identity fill', async ({page}) => {
  await fixture(page, greenhouse, `<label for="first_name">First Name*</label><input id="first_name" maxlength="255">
    <label for="preferred_name">Preferred First Name</label><input id="preferred_name" maxlength="255">
    <fieldset class="phone-input"><legend>Phone</legend><div class="select"><div class="select__control">
      <label id="country-label" for="country">Country*</label><input id="country" role="combobox" aria-labelledby="country-label" aria-expanded="false">
      </div><div class="select__value-container"></div></div><input id="phone" type="tel"></fieldset>`, `
    window.countryOpens=0;const input=document.getElementById('country'),container=input.closest('.select');
    container.querySelector('.select__control').addEventListener('mousedown',()=>{window.countryOpens++;if(input.getAttribute('aria-expanded')==='true')throw new Error('Unexpected toggle');
      const list=document.createElement('div');list.id='country-options';list.setAttribute('role','listbox');
      for(const value of ['China +86','Singapore +65']){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=value;
        option.addEventListener('click',()=>{const selected=document.createElement('div');selected.className='select__single-value';selected.textContent=value;
          container.querySelector('.select__value-container').append(selected);list.remove();input.value='';input.setAttribute('aria-expanded','false');});list.append(option);}
      container.append(list);input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','true');});
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){document.getElementById('country-options')?.remove();input.removeAttribute('aria-controls');input.setAttribute('aria-expanded','false')}});`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const country = review.fields.find(field => field.evidenceKey === 'phone_country_code');
  expect(country.options.map(option => option.label)).toEqual(['China +86', 'Singapore +65']);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [approved(review.fields.find(field => field.id === 'first_name'), 'Avery'), approved(country, 'China +86')]});
  expect(result.filled).toEqual(['first_name', country.id]);
  await expect(page.locator('#first_name')).toHaveValue('Avery'); await expect(page.locator('#preferred_name')).toHaveValue('');
  await expect(page.locator('.select__single-value')).toHaveText('China +86'); expect(await page.evaluate(() => window.submits)).toBe(0);
});

test('observed GH cover-letter upload becomes a draft target without an automatic click, and opens only during Fill', async ({page}) => {
  await fixture(page, greenhouse, `<input name="first_name"><div class="file-upload" role="group" aria-labelledby="upload-label-cover_letter" data-allow-s3="false">
    <div id="upload-label-cover_letter" class="label upload-label">Cover Letter</div><div class="file-upload__wrapper"><div class="button-container">
    <input id="cover_letter" type="file" hidden><button type="button" data-testid="cover_letter-text">Enter manually</button></div></div></div>`, `
    window.manualClicks=0;document.querySelector('[data-testid="cover_letter-text"]').addEventListener('click',()=>{
      window.manualClicks++;if(document.getElementById('cover_letter_text'))return;
      const wrapper=document.createElement('div');wrapper.className='text-input-wrapper';
      const textarea=document.createElement('textarea');textarea.id='cover_letter_text';textarea.rows=6;wrapper.append(textarea);
      document.querySelector('.file-upload').append(wrapper);});`);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const cover = review.fields.find(field => field.key === 'gh:cover_letter_text');
  expect(cover.label).toBe('Cover letter'); expect(cover.draftable).toBe(true);
  expect(await page.evaluate(() => window.manualClicks)).toBe(0);
  await expect(page.locator('#cover_letter_text')).toHaveCount(0);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse, approved: [approved(cover, 'Reviewed evidence-based draft.')]});
  expect(result.filled).toEqual([cover.id]); expect(await page.evaluate(() => window.manualClicks)).toBe(1);
  await expect(page.locator('#cover_letter_text')).toHaveValue('Reviewed evidence-based draft.');
  expect(await page.locator('#cover_letter').evaluate(node => node.files.length)).toBe(0);
  const occupied = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const second = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: greenhouse,
    approved: [approved(occupied.fields.find(field => field.key === cover.key), 'Do not replace')]});
  expect(second.skipped).toEqual([cover.id]);
  await expect(page.locator('#cover_letter_text')).toHaveValue('Reviewed evidence-based draft.');
  expect(await page.evaluate(() => window.submits)).toBe(0);
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
test('actual empty BlockTech Ashby markup represents each ordinary radio group once and preserves unapproved choices', async ({page}) => {
  const actualUrl = 'https://jobs.ashbyhq.com/blocktech/0b610536-94c4-4a42-b937-c163ea2cc8a1/application';
  const markup = await readFile(new URL('./fixtures/ashby-blocktech-form.html', import.meta.url), 'utf8');
  await fixture(page, actualUrl, '<div class="ashby-application-form-container"><input id="outside-parser" type="file" aria-label="Resume"></div>' + markup, restoreAshbyEmptyDateState, true);
  const protectedSelector = 'input[type=radio], input[type=checkbox], select';
  const before = await page.locator(protectedSelector).evaluateAll(nodes => nodes.map(node => ({id: node.id, name: node.name, value: node.value, checked: !!node.checked})));
  expect(before.filter(node => /labeled-radio/.test(node.id))).toHaveLength(10);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  expect(review.ok).toBe(true); expect(review.provider).toBe('Ashby');
  const radioNames = await page.locator('input[type=radio]').evaluateAll(nodes => [...new Set(nodes.map(node => node.name))]);
  expect(radioNames).toHaveLength(3);
  const groups = review.fields.filter(field => field.key.startsWith('ashby:radio:'));
  expect(groups).toHaveLength(3);
  expect(groups.every(field => radioNames.includes(field.key.replace(/^ashby:radio:/, '')) && field.kind === 'select')).toBe(true);
  const values = {full_name: 'Avery Ng', email: 'avery@example.test', phone: '+6512345678',
    linkedin: 'https://www.linkedin.com/in/fictional-avery', degree: 'M.Tech.', discipline: 'Software Engineering'};
  const answers = Object.entries(values).map(([key, value]) => approved(review.fields.find(field => field.evidenceKey === key), value));
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: actualUrl, approved: answers});
  expect(result.filled).toHaveLength(6); expect(result.skipped).toEqual([]); expect(result.submitted).toBe(false);
  await expect(page.locator('#_systemfield_name')).toHaveValue('Avery Ng');
  await expect(page.locator('#_systemfield_education_history-degree')).toHaveValue('M.Tech.');
  expect(await page.locator(protectedSelector).evaluateAll(nodes => nodes.map(node => ({id: node.id, name: node.name, value: node.value, checked: !!node.checked})))).toEqual(before);
  expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('actual Ashby ordinary radio and student controls click explicit facts and protect consent and dependent dates', async ({page}) => {
  const actualUrl = 'https://jobs.ashbyhq.com/blocktech/0b610536-94c4-4a42-b937-c163ea2cc8a1/application';
  const markup = await readFile(new URL('./fixtures/ashby-blocktech-form.html', import.meta.url), 'utf8');
  const script = restoreAshbyEmptyDateState + `document.getElementById('_systemfield_education_history-isCurrent').addEventListener('change',event=>{
    for(const select of document.getElementById('_systemfield_education_history-endDate').querySelectorAll('select'))select.disabled=event.target.checked;
  });`;
  await fixture(page, actualUrl, markup, script, true);
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const answers = Object.entries({current_student: 'Yes', fulltime_start_year: '2028', job_discovery_source: 'LinkedIn'}).map(([key, value]) => {
    const field = review.fields.find(candidate => candidate.evidenceKey === key);
    expect(field.available).toBe(true);
    const option = field.options.find(candidate => candidate.label === value);
    return approved(field, option.value);
  });
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: actualUrl, approved: answers});
  expect(result.filled).toHaveLength(3); expect(result.skipped).toEqual([]);
  await expect(page.locator('#_systemfield_education_history-isCurrent')).toBeChecked();
  const fulltime = review.fields.find(field => field.evidenceKey === 'fulltime_start_year');
  expect(await page.evaluate(id => document.getElementById(id).checked, fulltime.options.find(option => option.label === '2028').value)).toBe(true);
  expect(await page.locator('input[type=checkbox]').evaluateAll(nodes => nodes.filter(node => /consent|agree/i.test(node.name)).some(node => node.checked))).toBe(false);
  expect(await page.locator('#_systemfield_education_history-endDate select').evaluateAll(nodes => nodes.every(node => node.disabled && node.value === ''))).toBe(true);
  expect(await page.evaluate(() => window.submits)).toBe(0);
});
test('Ashby actual education containers and observed async school/city portals require exact option clicks and persistent native choices', async ({page}) => {
  const actualUrl = 'https://jobs.ashbyhq.com/blocktech/0b610536-94c4-4a42-b937-c163ea2cc8a1/application';
  const markup = await readFile(new URL('./fixtures/ashby-blocktech-form.html', import.meta.url), 'utf8');
  const script = restoreAshbyEmptyDateState + `window.ashbyChoiceClicks=[];window.ashbyQueries=[];
    for(const [purpose,id] of [['school','_systemfield_education_history-school'],['city','_systemfield_location']]) {
      const input=document.querySelector('label[for="'+id+'"]').parentElement.querySelector('input[role="combobox"]');
      input.addEventListener('input',()=>{
        window.ashbyQueries.push(purpose);document.getElementById('qa-'+purpose+'-list')?.remove();
        const list=document.createElement('div');list.id='qa-'+purpose+'-list';list.setAttribute('role','listbox');list.textContent='Loading...';
        document.body.append(list);input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','true');
        setTimeout(()=>{
          list.textContent='';
          for(const label of purpose==='school'?['National University of Salta','National University of Singapore']:['Singapore']) {
            const option=document.createElement('div');option.setAttribute('role','option');option.setAttribute('aria-selected','true');
            if(purpose==='school') {const name=document.createElement('span');name.className='_canonicalSchoolResultName_fixture';name.textContent=label;option.append(name);const country=document.createElement('span');country.textContent='Singaporeexample.test';option.append(country)}
            else option.textContent=label;
            option.addEventListener('click',()=>{window.ashbyChoiceClicks.push(label);input.value=label;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-controls');list.remove()});
            list.append(option);
          }
        },40);
      });
    }`;
  await fixture(page, actualUrl, markup, script, true);
  const before = await page.locator('input[type=radio],input[type=checkbox]').evaluateAll(nodes => nodes.map(node => ({id: node.id, checked: node.checked})));
  const review = await page.evaluate(interactWithATSPage, {action: 'inspect'});
  const values = {school: 'National University of Singapore', current_city: 'Singapore', education_start_month: '1', education_start_year: '2026', education_end_month: '6', education_end_year: '2027'};
  expect(await page.evaluate(() => window.ashbyQueries)).toEqual([]);
  for (const key of Object.keys(values)) expect(review.fields.some(field => field.evidenceKey === key && field.available)).toBe(true);
  const result = await page.evaluate(interactWithATSPage, {action: 'fill', expectedUrl: actualUrl,
    approved: Object.entries(values).map(([key, value]) => approved(review.fields.find(field => field.evidenceKey === key), value))});
  expect(result.filled).toHaveLength(6); expect(result.skipped).toEqual([]);
  expect(await page.evaluate(() => window.ashbyChoiceClicks)).toEqual(['National University of Singapore', 'Singapore']);
  expect(await page.locator('input[type=radio],input[type=checkbox]').evaluateAll(nodes => nodes.map(node => ({id: node.id, checked: node.checked})))).toEqual(before);
  expect(await page.evaluate(() => window.submits)).toBe(0);
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
