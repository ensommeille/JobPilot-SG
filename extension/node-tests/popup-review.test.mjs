import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {autofillSuggestion, formPlanFields, approvedAutofillAnswers, activeApplicationTool, professionalUrlTemplate, autofillTextTemplate} from '../popup-review.js';

test('full names never supply guessed given/family names, including Chinese and compound names', () => {
  for (const name of ['LI MING', '王小明', 'María del Carmen García', 'Cher']) {
    const profile = {values: {full_name: name}};
    assert.equal(autofillSuggestion({id: 'first_name'}, profile).value, '');
    assert.equal(autofillSuggestion({id: 'last_name'}, profile).value, '');
  }
  const profile = {values: {full_name: 'LI MING', given_name: 'MING', family_name: 'LI'}};
  assert.equal(autofillSuggestion({id: 'first_name'}, profile).value, 'MING');
  assert.equal(autofillSuggestion({id: 'last_name'}, profile).value, 'LI');
});

test('only ordinary unknown fields reach a bounded form plan, without answers or extra descriptor properties', () => {
  const field = {id: 'custom:1', label: 'School', kind: 'combobox', key: 'private-key', value: 'Private saved answer',
    available: true, occupied: false, needsMapping: true, evidenceKey: null, options: [{value: 'NUS', label: 'NUS', extra: 'omit'}]};
  const planned = formPlanFields([field, {...field, id: 'personal', manualOnly: true}, {...field, id: 'occupied', occupied: true}, {...field, id: 'known', needsMapping: false}]);
  assert.deepEqual(planned, [{id: 'custom:1', label: 'School', kind: 'combobox', manualOnly: false, options: [{value: 'NUS', label: 'NUS'}]}]);
  assert.equal(formPlanFields(Array.from({length: 60}, (_, i) => ({...field, id: 'field:' + i}))).length, 40);
});

test('one Fill click freezes edited values and cannot approve occupied, empty or personal fields', () => {
  const input = {value: ' Edited name '};
  const field = {available: true, key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name'};
  const items = approvedAutofillAnswers(new Map([
    ['first_name', {input, field}],
    ['email', {input: {value: 'occupied@example.test'}, field: {...field, occupied: true}}],
    ['personal', {input: {value: 'Yes'}, field: {...field, manualOnly: true}}],
    ['phone', {input: {value: '123'}, field: {...field, available: false}}],
    ['empty', {input: {value: '  '}, field}],
  ]));
  input.value = 'Changed during validation';
  assert.equal(items.length, 1); assert.equal(items[0].value, 'Edited name');
  assert.equal(items[0].confirmed, true); assert.equal(items[0].key, 'id:first');
  assert.ok(Object.isFrozen(items)); assert.ok(Object.isFrozen(items[0]));
});

test('missing ordinary professional links get explicit editable template text, never a saved fact', () => {
  for (const [key, value] of [['linkedin', 'Your LinkedIn URL'], ['github', 'Your GitHub URL'], ['portfolio', 'Your website or portfolio URL']]) {
    const field = {id: 'url-' + key, evidenceKey: key, key: 'id:' + key, label: key, kind: 'text', available: true, maxLength: 255};
    const template = professionalUrlTemplate(field, {values: {}});
    assert.deepEqual(template, {key, value, source: 'template'});
    assert.equal(autofillSuggestion(field, {values: {}}).value, '', 'The template is not part of saved-fact projection');
    const approved = approvedAutofillAnswers(new Map([[field.id, {field, input: {value: template.value}, factKey: null}]]));
    assert.equal(approved[0].value, value, 'Fill receives actual text, not an HTML placeholder');
    assert.equal(Object.hasOwn(approved[0], 'factKey'), false);
    assert.equal(approved[0].evidenceKey, key, 'The original question contract is unchanged');
    assert.equal(professionalUrlTemplate(field, {values: {[key]: 'https://example.test/real'}}), null);
    for (const extra of [{occupied: true}, {manualOnly: true}, {available: false}, {kind: 'date'}, {kind: 'number'}, {kind: 'select'}, {maxLength: 3}]) {
      assert.equal(professionalUrlTemplate({...field, ...extra}, {values: {}}), null);
    }
  }
  for (const key of ['email', 'phone', 'given_name', 'internship_start_date', 'nationality', 'work_authorization', 'summary']) {
    assert.equal(professionalUrlTemplate({id: key, evidenceKey: key, kind: 'text', available: true}, {values: {}}), null);
  }
});

test('ordinary missing text gets a labelled template while personal declarations and genuine value formats stay empty', () => {
  const ordinary = (label, evidenceKey = null, extra = {}) => ({id: 'field:q', label, evidenceKey, kind: 'text', available: true, maxLength: 500, ...extra});
  for (const [label, key, text] of [['Current company', 'current_company', 'Your current company'],
    ['Current location', 'current_city', 'Your current city'], ['Github / Portfolio URL', null, 'Your GitHub or portfolio URL'],
    ['Preferred First Name', null, 'Your preferred first name (optional)']]) {
    assert.equal(autofillTextTemplate(ordinary(label, key), {values: {}}).value, text);
  }
  assert.equal(autofillTextTemplate(ordinary('Cover letter', null, {draftable: true}), {values: {}}).value, 'Your cover letter');
  assert.equal(autofillTextTemplate(ordinary('Current location', 'current_city'), {values: {current_city: 'Singapore'}}), null);
  for (const label of ['Email', 'Phone', 'Expected salary', 'Start date', 'Graduation year', 'Notice period', 'Employment status',
    'Nationality', 'PDPA consent', 'Work authorization', 'Do you require sponsorship?', 'Date of birth']) {
    assert.equal(autofillTextTemplate(ordinary(label), {values: {}}), null, label);
  }
  for (const extra of [{kind: 'number'}, {kind: 'date'}, {kind: 'select'}, {kind: 'combobox'}, {manualOnly: true}, {occupied: true}, {available: false}, {maxLength: 2}]) {
    assert.equal(autofillTextTemplate(ordinary('Current company', null, extra), {values: {}}), null);
  }
});

test('combined GitHub and portfolio uses only one unambiguous saved URL and keeps the original field contract', () => {
  const field = {id: 'combined', key: 'name:urls[Github / Portfolio]', label: 'Github / Portfolio URL', kind: 'text', evidenceKey: null, available: true};
  const github = 'https://github.com/avery', portfolio = 'https://avery.example.test';
  for (const values of [{github}, {portfolio}, {github, portfolio: github}]) {
    const projected = autofillSuggestion(field, {values});
    assert.ok([github, portfolio].includes(projected.value));
    assert.equal(autofillTextTemplate(field, {values}), null);
    assert.equal(field.evidenceKey, null);
  }
  const profile = {values: {github, portfolio}};
  assert.equal(autofillSuggestion(field, profile).value, '');
  assert.equal(autofillTextTemplate(field, profile).value, 'Your GitHub or portfolio URL');
});

test('native and searchable choices bind option meaning without inventing a native choice', () => {
  const field = {available: true, kind: 'select', key: 'id:country', label: 'Country of study', evidenceKey: 'study_country', options: [{value: 'sg', label: 'Singapore'}]};
  const input = {value: 'sg'};
  assert.equal(approvedAutofillAnswers(new Map([['select:0', {input, field}]]))[0].optionLabel, 'Singapore');
  input.value = 'invented'; assert.deepEqual(approvedAutofillAnswers(new Map([['select:0', {input, field}]])), []);
  const combo = {...field, kind: 'combobox', options: []};
  assert.equal(approvedAutofillAnswers(new Map([['custom:0', {input: {value: 'National University of Singapore'}, field: combo}]]))[0].optionLabel, 'National University of Singapore');
});

test('suggestions use existing mapped facts with exact choices and valid dates, never nationality as phone code', () => {
  const profile = {values: {school: 'National University of Singapore', nationality: 'cn', internship_start_date: '2027-01-05'}};
  assert.equal(autofillSuggestion({id: 'unknown', kind: 'text'}, profile, [{field_id: 'unknown', fact_key: 'school'}]).value, 'National University of Singapore');
  assert.equal(autofillSuggestion({id: 'phone-country', evidenceKey: 'phone_country_code', kind: 'text'}, profile).value, '');
  assert.equal(autofillSuggestion({id: 'start', evidenceKey: 'internship_start_date', kind: 'date'}, profile).value, '2027-01-05');
  assert.equal(autofillSuggestion({id: 'sensitive', evidenceKey: 'nationality', manualOnly: true}, profile).value, '');
});

test('popup projection integrates explicit phone prefixes, ISO countries and saved education months', () => {
  const profile = {values: {phone_country_code: '+65', nationality: 'CN', education_start_month: '01'}};
  const field = (id, evidenceKey, labels, kind = 'select') => ({id, evidenceKey, kind, options: labels.map(label => ({value: label, label}))});
  assert.equal(autofillSuggestion(field('phone-country', 'phone_country_code', ['China +86', 'Singapore +65'], 'combobox'), profile).value, 'Singapore +65');
  assert.equal(autofillSuggestion(field('nationality', 'nationality_country', ['China', 'Singapore']), profile).value, 'China');
  assert.equal(autofillSuggestion(field('start-month', null, ['January', 'February']), profile,
    [{field_id: 'start-month', fact_key: 'education_start_month'}]).value, 'January');
  assert.equal(autofillSuggestion(field('ambiguous-phone', 'phone_country_code', ['United States +1', 'Canada +1'], 'combobox'), {values: {phone_country_code: '+1'}}).value, '');
  assert.equal(autofillSuggestion(field('degree', 'degree', ["Master's Degree", "Bachelor's Degree"]), {values: {degree: 'M.Tech.'}}).value, "Master's Degree");
  assert.equal(autofillSuggestion(field('degree', 'degree', ["Master's Degree", 'Master of Science']), {values: {degree: 'M.Tech.'}}).value, "Master's Degree");
  assert.equal(autofillSuggestion(field('degree', 'degree', ["Master's Degree", 'Master of Technology']), {values: {degree: 'M.Tech.'}}).value, '');
  assert.equal(autofillSuggestion(field('degree', 'degree', ['Master of Science']), {values: {degree: 'M.Tech.'}}).value, '');
});

test('saved school and city reach exact async search even when absent from the first option page', () => {
  const profile = {values: {school: 'National University of Singapore', current_city: 'Singapore'}};
  for (const key of ['school', 'current_city']) {
    const field = {id: 'field-' + key, key: 'id:' + key, label: key, kind: 'combobox', evidenceKey: key,
      available: true, occupied: false, searchable: true, options: [{value: 'Other initial option', label: 'Other initial option'}]};
    const suggestion = autofillSuggestion(field, profile);
    assert.equal(suggestion.value, profile.values[key]); assert.equal(suggestion.candidate, true);
    const approved = approvedAutofillAnswers(new Map([[field.id, {field, input: {value: suggestion.value}, factKey: suggestion.key}]]));
    assert.equal(approved[0].value, profile.values[key]); assert.equal(approved[0].optionLabel, profile.values[key]);
    assert.equal(autofillSuggestion({...field, searchable: false}, profile).value, '');
    assert.equal(autofillSuggestion({...field, kind: 'select'}, profile).value, '');
  }
});

test('tool disclosure uses exact trusted HTTPS hosts and never authorizes a read', () => {
  assert.equal(activeApplicationTool('https://jobs.lever.co/acme/123/apply'), 'ats-tools');
  assert.equal(activeApplicationTool('https://job-boards.greenhouse.io/acme/jobs/123'), 'ats-tools');
  assert.equal(activeApplicationTool('https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101'), 'ats-tools');
  assert.equal(activeApplicationTool('https://www.internsg.com/job-apply/123/'), 'original-tools');
  for (const url of ['https://jobs.lever.co.evil.test/x', 'http://jobs.lever.co/x', 'https://user@jobs.lever.co/x',
    'https://www.internsg.com/job/foo', 'http://127.0.0.1:15523/jobs', undefined]) assert.equal(activeApplicationTool(url), null);
});

test('shipped popup is fill-only and has no per-answer confirmation DOM or full-name splitting', async () => {
  const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  assert.match(html, /id="advanced-submission"[^>]*hidden/);
  assert.match(source, /const SUBMISSION_ENABLED = false/);
  for (const id of ['prepare-submit', 'send-application', 'check-result']) {
    assert.ok(source.includes(`$('${id}').addEventListener('click', () => SUBMISSION_ENABLED && run`));
  }
  assert.doesNotMatch(source, /editor\.confirm|I checked this answer|applicant_name[^;\n]+\.split/);
});

test('preview actions live outside the single bounded workspace scroll region', async () => {
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../popup.css', import.meta.url), 'utf8');
  assert.match(html, /id="workspace-content"[^>]*tabindex="0"/);
  assert.match(html, /<\/div>\s*<footer id="review-actions"/);
  const footer = html.slice(html.indexOf('<footer id="review-actions"'), html.indexOf('</footer>'));
  assert.match(footer, /id="ats-fill"/); assert.match(footer, /id="fill"/);
  assert.match(css, /--popup-width:\s*440px/);
  assert.match(css, /html\s*\{[^}]*width:\s*var\(--popup-width\)[^}]*min-width:\s*var\(--popup-width\)/);
  assert.match(css, /body\s*\{[^}]*width:\s*var\(--popup-width\)[^}]*min-width:\s*var\(--popup-width\)/);
  assert.doesNotMatch(css, /max-width:\s*100vw/);
  assert.match(css, /max-height:\s*580px/);
  assert.match(css, /#workspace-content\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /#review-actions\s*\{[^}]*flex-shrink:\s*0/);
  assert.doesNotMatch(css, /#ats-fields\s*\{[^}]*overflow/);
});


test('Fill performs only a free fingerprint read; PDF attachment has its own explicit action', async () => {
  const source = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
  const fill = source.slice(source.indexOf("$('ats-fill').addEventListener"), source.indexOf("$('ats-attach').addEventListener"));
  assert.match(fill, /loadAutofillProfile/); assert.match(fill, /latest.fingerprint !== current.profileFingerprint/);
  assert.doesNotMatch(fill, /form-plan|resume-content|action: 'attach'/);
  const attach = source.slice(source.indexOf("$('ats-attach').addEventListener"), source.indexOf("$('fill').addEventListener"));
  assert.match(attach, /resume-content/); assert.match(attach, /action: 'attach'/);
  assert.doesNotMatch(attach, /action: 'fill'/);
});
