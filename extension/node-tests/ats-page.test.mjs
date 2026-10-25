// Actual exported/injected adapter against bounded DOM doubles. No browser/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {interactWithATSPage as rawInteractWithATSPage, matchATSSelectOption, parseATSInspectionResult, parseATSFillResult} from '../ats-page.js';
import {autofillSuggestion, approvedAutofillAnswers} from '../popup-review.js';
import {preparationPatch} from '../popup-preparation.js';

const interactWithATSPage = async payload => {
  const result = await rawInteractWithATSPage(payload);
  return payload.action === 'fill' ? parseATSFillResult([{frameId: 0, documentId: 'bound-node-document', result}], 'bound-node-document') : result;
};

const greenhouse = 'https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123';
const lever = 'https://jobs.lever.co/acme/abc-123/apply';
const ashby = 'https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application';
const all = node => node.children.flatMap(child => [child, ...all(child)]);
class Element {
  constructor(tagName = 'DIV', {id = '', classes = [], text = '', attributes = {}, ...rest} = {}) {
    Object.assign(this, {tagName, id, children: [], parentElement: null, textContent: text, attributes,
      visible: true, disabled: false, readOnly: false, isConnected: true, handlers: {}, events: []}, rest);
    this.classList = {contains: name => classes.includes(name)}; this.className = classes.join(' ');
  }
  append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector === '[id]') return !!this.id;
    const role = selector.match(/^\[role="([^"]+)"\]$/)?.[1];
    if (role) return this.getAttribute('role') === role;
    if (selector === 'fieldset.phone-input') return this.tagName === 'FIELDSET' && this.classList.contains('phone-input');
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  querySelectorAll(selector) { return all(this).filter(node => selector.split(',').some(part => node.matches(part.trim()))); }
  contains(node) { return all(this).includes(node); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  getAttribute(key) { return key === 'id' ? this.id || null : this.attributes[key] || null; }
  getClientRects() { return this.visible && this.parentElement?.visible !== false ? [{}] : []; }
  focus() { document.activeElement = this; this.handlers.focus?.(); }
  click() { this.handlers.click?.(); }
  blur() { if (document.activeElement === this) document.activeElement = null; this.handlers.blur?.(); }
  dispatchEvent(event) { this.events.push(event.type); this.handlers[event.type]?.(event); }
}
class Input extends Element {
  static nativeTag = 'INPUT';
  static [Symbol.hasInstance](value) { return value?.tagName === this.nativeTag; }
  constructor({name = '', value = '', label = '', type = 'text', ...rest} = {}) {
    super('INPUT', rest);
    Object.assign(this, {name, _value: value, type, maxLength: -1, labels: label ? [new Element('LABEL', {text: label})] : [], required: false,
      form: null, files: [], accept: '', checked: false, validity: {valid: true}}, rest);
  }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}
class TextArea extends Input {
  static nativeTag = 'TEXTAREA';
  constructor(details) { super(details); this.tagName = 'TEXTAREA'; this.type = 'textarea'; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}
class Select extends Input {
  static nativeTag = 'SELECT';
  constructor({options = [], ...details} = {}) {
    super({...details, type: 'select-one'}); this.tagName = 'SELECT'; this.multiple = false;
    this.options = options.map(option => new Element('OPTION', {text: option.label, value: option.value,
      hidden: false, disabled: false, ...option}));
    this.append(...this.options);
    if (details.value === undefined) this._value = this.options[0]?.value || '';
  }
  get value() { return this._value; }
  set value(value) { this._value = this.options.some(option => option.value === value) ? value : ''; }
  get selectedIndex() { return this.options.findIndex(option => option.value === this._value); }
}
function fixture(nodes, {url = greenhouse, outside = []} = {}) {
  const root = new Element('HTML');
  const scope = new Element(url === ashby ? 'DIV' : 'FORM', {classes: url === ashby ? ['ashby-application-form-container'] : []});
  scope.append(...nodes); root.append(scope, ...outside);
  for (const node of all(scope)) if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) && !url.includes('ashbyhq')) {
    if (!node.form || node.form === node.boundScope) node.form = scope;
    node.boundScope = scope;
  }
  globalThis.HTMLInputElement = Input; globalThis.HTMLTextAreaElement = TextArea; globalThis.HTMLSelectElement = Select;
  globalThis.getComputedStyle = node => ({visibility: node.cssVisibility || 'visible'});
  globalThis.location = {href: url};
  globalThis.document = {querySelectorAll: selector => root.querySelectorAll(selector), activeElement: null, defaultView: {closed: false}};
  globalThis.KeyboardEvent = class extends Event { constructor(type, details) { super(type, details); this.key = details.key; } };
  globalThis.MouseEvent = class extends Event { constructor(type, details) { super(type, details); this.button = details.button; this.buttons = details.buttons; } };
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', {value: webcrypto});
  globalThis.DataTransfer = class { constructor() { this.files = []; this.items = {add: file => this.files.push(file)}; } };
  return {root, scope};
}
const countryOptions = [{value: '', label: 'Select a country'}, {value: 'CN', label: 'China'}, {value: 'SG', label: 'Singapore'}];
const country = (details = {}) => new Select({name: 'nationality', label: 'Nationality✱', options: countryOptions, ...details});
function approval(field, value) {
  return {id: field.id, key: field.key, label: field.label, kind: field.kind, evidenceKey: field.evidenceKey,
    value, confirmed: true, ...(['select', 'combobox'].includes(field.kind) ? {
      optionLabel: field.kind === 'combobox' ? value : field.options.find(option => option.value === value)?.label,
    } : {})};
}
const inspect = () => interactWithATSPage({action: 'inspect'});
function question(node, label, {ashbyField = false, path = 'date-unique-path'} = {}) {
  const row = new Element(ashbyField ? 'DIV' : 'LI', {classes: ashbyField ? ['ashby-application-form-field-entry'] : [], attributes: {'data-field-path': path}});
  const title = new Element('LABEL', {text: label, classes: [ashbyField ? 'ashby-application-form-question-title' : 'application-label']});
  row.append(title, node); return row;
}
function ashbyEducation() {
  const row = new Element('DIV', {classes: ['ashby-application-form-field-entry'], attributes: {'data-field-path': '_systemfield_education_history'}});
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const result = {row};
  for (const edge of ['start', 'end']) {
    const id = `_systemfield_education_history-${edge}Date`;
    const caption = new Element('LABEL', {text: `${edge === 'start' ? 'Start' : 'End'} Date`, attributes: {for: id}});
    const container = new Element('DIV', {id});
    const month = new Select({options: [{value: '', label: 'Month...', disabled: true}, ...monthNames.map((label, index) => ({value: String(index + 1), label}))]});
    const year = new Select({options: [{value: '', label: 'Year...', disabled: true}, ...['2027', '2026', '2025'].map(value => ({value, label: value}))]});
    container.append(month, year); row.append(caption, container);
    Object.assign(result, {[`${edge}Container`]: container, [`${edge}Caption`]: caption, [`${edge}Month`]: month, [`${edge}Year`]: year});
  }
  return result;
}
function ashbyCombo({purpose = 'school', root, labels = ['National University of Singapore'], accepts = true, disappears = false, delay = 40} = {}) {
  const input = new Input({classes: ['ashby-application-form-input-autocomplete'], attributes: {
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-haspopup': 'listbox', 'aria-expanded': 'false'}});
  const wrapper = new Element('DIV'); wrapper.append(input);
  const parent = new Element('DIV');
  const path = purpose === 'school' ? '_systemfield_education_history' : '_systemfield_location';
  const caption = new Element('LABEL', {classes: ['ashby-application-form-question-title'],
    text: purpose === 'school' ? 'School' : 'Where are you currently based?',
    attributes: {for: purpose === 'school' ? '_systemfield_education_history-school' : '_systemfield_location'}});
  parent.append(caption, wrapper);
  let list = null;
  const model = {clicks: [], queries: [], labels: [...labels], close() {
    if (list) list.visible = false;
    input.attributes['aria-expanded'] = 'false'; delete input.attributes['aria-controls'];
  }};
  input.handlers.input = () => {
    model.queries.push(input.value);
    model.close();
    list = new Element('DIV', {id: `:${purpose}-list:`, text: 'Loading...', attributes: {role: 'listbox'}});
    root().append(list); input.attributes['aria-controls'] = list.id; input.attributes['aria-expanded'] = 'true';
    setTimeout(() => {
      list.textContent = '';
      for (const [index, label] of model.labels.entries()) {
        const option = new Element('DIV', {id: `:${purpose}-option-${index}:`, text: purpose === 'school' ? `${label}Singaporeexample.test` : label,
          attributes: {role: 'option', 'aria-selected': index === 0 ? 'true' : 'false'}});
        if (purpose === 'school') option.append(new Element('SPAN', {classes: ['_canonicalSchoolResultName_1e3gg_205'], text: label}),
          new Element('SPAN', {classes: ['_canonicalSchoolResultCountry_1e3gg_209'], text: 'Singapore'}));
        option.handlers.click = () => { model.clicks.push(label); if (accepts) { input.value = label; model.close(); } };
        list.append(option);
      }
    }, delay);
  };
  input.handlers.blur = () => { model.close(); if (disappears) setTimeout(() => { input.value = ''; }, 100); };
  input.handlers.keydown = event => { if (event.key === 'Escape') model.close(); };
  const row = new Element('DIV', {classes: ['ashby-application-form-field-entry'], attributes: {'data-field-path': path}});
  row.append(parent);
  return {input, row, parent, wrapper, caption, model};
}
function ashbyRadio(label, optionLabels, {questionId = 'question-available', name = `session_${questionId}`} = {}) {
  const group = new Element('FIELDSET', {classes: ['ashby-application-form-input-radio-group']});
  const title = new Element('LABEL', {text: label, classes: ['ashby-application-form-question-title'], attributes: {for: questionId}});
  group.append(title);
  const members = optionLabels.map((text, index) => {
    const node = new Input({name, id: `${name}-option-${index}`, type: 'radio'});
    const caption = new Element('LABEL', {text, attributes: {for: node.id}}); node.labels = [caption];
    const wrapper = new Element('DIV'); wrapper.append(node, caption); group.append(wrapper);
    return node;
  });
  for (const node of members) node.handlers.click = () => { for (const member of members) member.checked = member === node; node.events.push('click'); };
  return {group, title, members};
}
function ashbyStudent(education = ashbyEducation()) {
  const node = new Input({id: '_systemfield_education_history-isCurrent', type: 'checkbox'});
  const label = new Element('LABEL', {text: 'Still Student?', attributes: {for: node.id}});
  node.labels = [label]; label.append(node); education.row.append(label);
  node.handlers.click = () => {
    node.checked = !node.checked; node.events.push('click');
    education.endMonth.disabled = node.checked; education.endYear.disabled = node.checked;
  };
  return {node, label, ...education};
}
function combo({id = 'degree--0', label = 'Degree', options = ["Bachelor's Degree", "Master's Degree"], selected = '', persist = true, onQuery = null} = {}) {
  const input = new Input({id, label, attributes: {role: 'combobox'}});
  const container = new Element('DIV', {classes: ['select']}); container.append(input);
  let list = null, selection = null;
  const model = {options: [...options], select(value) {
    if (selection) container.children = container.children.filter(node => node !== selection);
    selection = new Element('DIV', {text: value, classes: ['select__single-value']});
    container.append(selection); input.value = '';
    if (!persist) setTimeout(() => { container.children = container.children.filter(node => node !== selection); }, 190);
  }};
  const close = () => {
    if (list) list.visible = false;
    delete input.attributes['aria-controls']; input.value = '';
    input.attributes['aria-expanded'] = 'false';
  };
  const open = () => {
    if (list) list.visible = false;
    list = new Element('DIV', {id: 'list-' + id, attributes: {role: 'listbox'}});
    for (const value of model.options) {
      const option = new Element('DIV', {text: value, attributes: {role: 'option', 'aria-disabled': 'false'}});
      option.handlers.click = () => { model.select(value); close(); };
      list.append(option);
    }
    container.children = container.children.filter(node => node.id !== list.id); container.append(list);
    input.attributes['aria-controls'] = list.id;
    input.attributes['aria-expanded'] = 'true';
  };
  input.handlers.click = open;
  input.handlers.keydown = event => { if (event.key === 'Escape') close(); };
  input.handlers.blur = close;
  input.handlers.input = () => { if (onQuery) onQuery(input.value, model, open); };
  if (selected) model.select(selected);
  return {container, input, model};
}

test('exact matching supports explicit country/month facts without guessing telephone or partial text', () => {
  const field = {kind: 'select', evidenceKey: 'nationality_country', options: countryOptions.slice(1)};
  assert.equal(matchATSSelectOption(field, 'cn'), 'CN');
  assert.equal(matchATSSelectOption(field, 'Chinese'), '');
  assert.equal(matchATSSelectOption({...field, evidenceKey: 'phone_country_code'}, '+86'), '');
  assert.equal(matchATSSelectOption({...field, options: [...field.options, {value: 'China', label: 'China'}]}, 'CN'), '');
  assert.equal(matchATSSelectOption({kind: 'combobox', evidenceKey: 'education_start_month', options: [{value: 'January', label: 'January'}]}, '01'), 'January');
});

test('explicit saved phone calling code selects the unique complete observed GH label', () => {
  const options = ['Singapore +65', 'China +86', 'Hong Kong SAR China +852'].map(label => ({value: label, label}));
  const field = {kind: 'combobox', evidenceKey: 'phone_country_code', options};
  assert.equal(matchATSSelectOption(field, '+65'), 'Singapore +65');
  assert.equal(matchATSSelectOption(field, '+86'), 'China +86');
  assert.equal(matchATSSelectOption(field, '+6'), '');
  assert.equal(matchATSSelectOption(field, '+65 81234567'), '', 'a full telephone number is not a saved calling-code fact');
});

test('ambiguous shared calling codes never choose a country', () => {
  const options = ['United States +1', 'Canada +1', 'Singapore +65'].map(label => ({value: label, label}));
  const field = {kind: 'combobox', evidenceKey: 'phone_country_code', options};
  assert.equal(matchATSSelectOption(field, '+1'), '');
  assert.equal(matchATSSelectOption({...field, evidenceKey: 'nationality_country'}, '+65'), '');
});

test('a saved country code never accepts a contradictory visible option label', () => {
  const field = {kind: 'select', evidenceKey: 'current_country', options: [{value: 'US', label: 'China'}]};
  assert.equal(matchATSSelectOption(field, 'US'), '');
  assert.equal(matchATSSelectOption({...field, options: [{value: 'US', label: 'United States'}]}, 'US'), 'US');
  assert.equal(matchATSSelectOption({...field, options: [{value: 'US', label: 'US'}]}, 'US'), 'US');
});

test('verified degree facts normalize only to one existing explicit taxonomy option', () => {
  const options = ["Bachelor's Degree", "Master's Degree", 'Doctor of Philosophy (Ph.D.)'].map(label => ({value: label, label}));
  const field = {kind: 'combobox', evidenceKey: 'degree', options};
  for (const value of ['M.Tech.', 'Master of Technology', 'MSc', 'M.Eng.']) assert.equal(matchATSSelectOption(field, value), "Master's Degree");
  for (const value of ['B.Eng.', 'Bachelor of Science', 'BSc']) assert.equal(matchATSSelectOption(field, value), "Bachelor's Degree");
  assert.equal(matchATSSelectOption(field, 'Ph.D.'), 'Doctor of Philosophy (Ph.D.)');
  assert.equal(matchATSSelectOption(field, 'Studying M.Tech. at NUS'), '');
  assert.equal(matchATSSelectOption(field, 'M.Tech.; B.Eng.'), '');
  assert.equal(matchATSSelectOption({...field, options: [...options, {value: 'msc', label: 'Master of Science'}]}, 'M.Tech.'), "Master's Degree");
  assert.equal(matchATSSelectOption({...field, options: [...options, {value: 'mtech', label: 'Master of Technology'}]}, 'M.Tech.'), '');
  assert.equal(matchATSSelectOption({...field, options: [...options, {value: 'msc', label: 'Master of Science'}]}, 'Master of Science'), 'msc');
  assert.equal(matchATSSelectOption({...field, evidenceKey: 'education'}, 'M.Tech.'), '');
});

test('school abbreviation equivalence strips only a verified trailing uppercase initialism and still rejects canonical duplicates', () => {
  const field = {kind: 'combobox', evidenceKey: 'school', options: [{value: 'National University of Singapore', label: 'National University of Singapore'}]};
  assert.equal(matchATSSelectOption(field, 'National University of Singapore (NUS)'), 'National University of Singapore');
  for (const value of ['National University of Singapore (NTU)', 'National University of Singapore (Singapore)',
    'National University of Singapore (NUS) - Downtown', 'National University of Singapore, Downtown (NUS)']) {
    assert.equal(matchATSSelectOption(field, value), '');
  }
  assert.equal(matchATSSelectOption({...field, evidenceKey: 'current_city'}, 'National University of Singapore (NUS)'), '');
  assert.equal(matchATSSelectOption({...field, options: [...field.options, {value: 'National University of Singapore (NUS)', label: 'National University of Singapore (NUS)'}]}, 'National University of Singapore (NUS)'), '');
});

test('degree options preserve the explicit qualification instead of translating M.Tech. into an MSc', () => {
  const field = label => ({kind: 'select', evidenceKey: 'degree', options: [{value: 'degree-id', label}]});
  assert.equal(matchATSSelectOption(field("Master's Degree"), 'M.Tech.'), 'degree-id');
  assert.equal(matchATSSelectOption(field('Master of Technology'), 'M.Tech.'), 'degree-id');
  assert.equal(matchATSSelectOption(field('Master of Science'), 'M.Tech.'), '');
  assert.equal(matchATSSelectOption(field('M.Sc.'), 'M.Tech.'), '');
  assert.equal(matchATSSelectOption(field('Master of Science'), "Master's Degree"), '');
});

test('highest or completed degree questions are manual even if a verified ongoing degree exists', async () => {
  fixture([new Input({name: 'first_name'}), new Input({name: 'completed', label: 'Highest completed degree'}),
    new Input({name: 'highest', label: 'Highest degree'}), new Input({name: 'awarded', label: 'Degree awarded'}),
    new Input({name: 'degree', label: 'Degree'})]);
  const review = await inspect();
  assert.ok(review.fields.filter(field => ['name:completed', 'name:highest', 'name:awarded'].includes(field.key)).every(field => field.manualOnly));
  assert.equal(review.fields.find(field => field.key === 'name:degree').evidenceKey, 'degree');
});

test('language alias is fillable; actual Age, visa and consent remain manual', async () => {
  fixture([new Input({name: 'first_name'}), new TextArea({name: 'languages', label: 'Programming languages'}),
    new Input({name: 'age', label: 'Age'}), new Input({name: 'visa', label: 'Do you require visa sponsorship?'}),
    new Input({name: 'consent', label: 'I agree to privacy terms', type: 'checkbox'})]);
  const review = await inspect();
  assert.equal(review.fields.find(field => field.key === 'name:languages').evidenceKey, 'skills');
  assert.ok(review.fields.filter(field => ['name:age', 'name:visa', 'name:consent'].includes(field.key)).every(field => field.manualOnly));
  const field = review.fields.find(field => field.key === 'name:languages');
  assert.deepEqual((await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, 'Python, C++')]})).filled, [field.id]);
});

test('ordinary unknown text and native dropdowns keep null evidence keys and allow explicit one-off answers', async () => {
  const unknown = new Input({name: 'context', label: 'Your preferred working hours'});
  const location = country({name: 'location', label: 'Country'});
  fixture([new Input({name: 'first_name'}), unknown, location]);
  const review = await inspect();
  const fields = review.fields.filter(field => ['name:context', 'name:location'].includes(field.key));
  assert.ok(fields.every(field => field.evidenceKey === null && field.needsMapping && !field.manualOnly));
  const result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse,
    approved: [approval(fields[0], 'Weekdays'), approval(fields[1], 'SG')]});
  assert.deepEqual(result.filled, fields.map(field => field.id));
  assert.equal(unknown.value, 'Weekdays'); assert.equal(location.value, 'SG');
});

test('required country labels map, while citizenship cannot be filled even with forged factKey', async () => {
  const nationality = country(), study = country({name: 'campus', label: 'Country of study ✱'});
  const citizen = country({name: 'citizenship', label: 'Country of citizenship ✱'});
  fixture([new Input({name: 'name'}), nationality, study, citizen], {url: lever});
  const review = await inspect();
  assert.equal(review.fields.find(field => field.key === 'name:nationality').evidenceKey, 'nationality_country');
  assert.equal(review.fields.find(field => field.key === 'name:campus').evidenceKey, 'study_country');
  const field = review.fields.find(field => field.key === 'name:citizenship');
  await assert.rejects(interactWithATSPage({action: 'fill', expectedUrl: lever,
    approved: [{...approval(field, 'CN'), factKey: 'nationality_country'}]}), /Invalid reviewed/);
  assert.equal(citizen.value, '');
});

test('native selects preserve actual defaults and disabled meaningful choices; placeholders stay empty', async () => {
  const node = country({value: 'SG'}); fixture([new Input({name: 'first_name'}), node]);
  let field = (await inspect()).fields.find(field => field.kind === 'select');
  assert.equal(field.occupied, true);
  let result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, 'CN')]});
  assert.deepEqual(result.skipped, [field.id]); assert.equal(node.value, 'SG');
  node.options[2].disabled = true;
  field = (await inspect()).fields.find(field => field.kind === 'select');
  assert.equal(field.occupied, true);
  node.value = '';
  field = (await inspect()).fields.find(field => field.kind === 'select');
  result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, 'CN')]});
  assert.deepEqual(result.filled, [field.id]); assert.deepEqual(node.events, ['input', 'change']);
});

test('complete-batch preflight rejects changed option meaning or question before any write', async () => {
  const first = new Input({name: 'first_name'}), node = country(); fixture([first, node]);
  const review = await inspect(), firstField = review.fields.find(field => field.id === 'first_name');
  const select = review.fields.find(field => field.kind === 'select');
  const approved = [approval(firstField, 'MING'), approval(select, 'CN')];
  node.options[1].textContent = 'Different meaning';
  await assert.rejects(interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved}), /option changed/);
  assert.equal(first.value, '');
  node.options[1].textContent = 'China'; node.labels[0].textContent = 'Country of study';
  await assert.rejects(interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved}), /Invalid reviewed/);
  assert.equal(first.value, '');
});

test('duplicate native choices and controls, hidden and multiple selects never become available', async () => {
  const duplicate = country({options: [{value: '', label: 'Choose one'}, {value: 'x', label: 'China'}, {value: 'x', label: 'Singapore'}]});
  const hidden = country({name: 'hidden', visible: false}), multiple = country({name: 'multiple'}); multiple.multiple = true;
  fixture([new Input({name: 'first_name'}), duplicate, hidden, multiple]);
  assert.ok((await inspect()).fields.filter(field => field.kind === 'select').every(field => field.manualOnly));
  const sameLabels = country({options: [{value: '', label: 'Choose one'}, {value: 'a', label: 'Singapore'}, {value: 'b', label: 'Singapore'}]});
  fixture([new Input({name: 'first_name'}), sameLabels]);
  assert.equal((await inspect()).fields.find(field => field.kind === 'select').manualOnly, true);
  fixture([new Input({name: 'first_name'}), country(), country()]);
  const ambiguous = await inspect();
  assert.equal(ambiguous.error.code, 'ambiguous_fields');
  assert.throws(() => parseATSInspectionResult([{frameId: 0, documentId: 'doc', result: ambiguous}]), /ambiguous identifiers/);
});

test('blur readback rejects a React-like field cleared asynchronously and preserves unrelated existing answers', async () => {
  const first = new Input({name: 'first_name'}), email = new Input({name: 'email', value: 'existing@example.test'});
  first.handlers.blur = () => setTimeout(() => { first.value = ''; }, 180);
  fixture([first, email]); const review = await inspect();
  const result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse,
    approved: [approval(review.fields.find(field => field.id === 'first_name'), 'MING'), approval(review.fields.find(field => field.id === 'email'), 'other@example.test')]});
  assert.equal(result.filled.length, 0); assert.equal(result.skipped.length, 2);
  assert.match(result.reasons.first_name, /disappeared/); assert.equal(email.value, 'existing@example.test');
});

test('different primary forms cannot anchor filling or attachment', async () => {
  const first = new Input({name: 'first_name'}), email = new Input({name: 'email'}), other = new Element('FORM');
  email.form = other;
  fixture([first, email, country()]);
  assert.deepEqual((await inspect()).fields, []);
});

test('Lever real nearest-row availability label works, multi-control labels are not borrowed', async () => {
  const availability = new Input({name: 'cards[123][field1]'});
  const row = question(availability, 'When is your availability (eg. Jan to Jun 2027)?✱');
  const first = new Input({name: 'cards[123][field2]'}), second = new Input({name: 'cards[123][field3]'});
  const ambiguous = question(first, 'Availability period'); ambiguous.append(second);
  fixture([new Input({name: 'name'}), row, ambiguous], {url: lever});
  const review = await inspect();
  const fields = review.fields.filter(field => field.evidenceKey === 'availability');
  assert.equal(fields.length, 1);
  assert.deepEqual((await interactWithATSPage({action: 'fill', expectedUrl: lever, approved: [approval(fields[0], 'Jan to Jun 2027')]})).filled, [fields[0].id]);
  assert.equal(first.value, ''); assert.equal(second.value, '');
});

test('Lever stable question captions exclude live location messages and never manufacture hidden address selection or employer facts', async () => {
  const location = new Input({id: 'location-input', name: 'location', label: 'Current location ✱No location found. Try entering a different locationLoading'});
  const selectedLocation = new Input({id: 'selected-location', name: 'selectedLocation', type: 'hidden', visible: false});
  const locationRow = question(location, 'Current location ✱'); locationRow.append(selectedLocation);
  const company = new Input({name: 'org', label: 'Current company ✱'});
  const combined = new Input({name: 'urls[Github / Portfolio]', label: 'Github / Portfolio URL'});
  fixture([new Input({name: 'name', label: 'Full name'}), locationRow, question(company, 'Current company ✱'), question(combined, 'Github / Portfolio URL')], {url: lever});
  const review = await inspect();
  const locationField = review.fields.find(field => field.key === 'name:location');
  const companyField = review.fields.find(field => field.key === 'name:org');
  const linkField = review.fields.find(field => field.key === 'name:urls[Github / Portfolio]');
  assert.equal(locationField.label, 'Current location ✱'); assert.equal(locationField.evidenceKey, 'current_city');
  assert.equal(locationField.kind, 'text'); assert.equal(locationField.requiresWebsiteChoice, true);
  assert.equal(companyField.evidenceKey, 'current_company'); assert.equal(companyField.manualOnly, false);
  assert.equal(linkField.evidenceKey, null); assert.equal(linkField.kind, 'text'); assert.equal(linkField.manualOnly, false);
  assert.equal(autofillSuggestion(companyField, {values: {experience: 'Previously worked at a fictional company'}}).value, '');
  const savedCity = autofillSuggestion(locationField, {values: {current_city: 'Singapore'}}).value;
  location.labels[0].textContent = 'Current location ✱Loading a new result';
  const result = await interactWithATSPage({action: 'fill', expectedUrl: lever, approved: [approval(locationField, savedCity)]});
  assert.deepEqual(result.filled, [locationField.id]); assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.needsWebsiteChoice, [locationField.id]); assert.deepEqual(result.reasons, {});
  assert.equal(selectedLocation.value, ''); assert.deepEqual(selectedLocation.events, []);
  location.attributes.role = 'combobox'; location.value = '';
  const unsupported = (await inspect()).fields.find(field => field.key === 'name:location');
  assert.equal(unsupported.manualOnly, true); assert.equal(unsupported.evidenceKey, null);
});

test('persistent ordinary URL templates report copied plus needsCorrection while lost values remain skipped', async () => {
  const name = new Input({name: '_systemfield_name', label: 'Name'});
  const email = new Input({name: '_systemfield_email', label: 'Email', type: 'email'});
  const linkedin = new Input({id: 'linkedin-unique', name: 'linkedin-unique', label: 'LinkedIn URL', type: 'url', validity: {valid: false}});
  fixture([name, email, linkedin], {url: ashby});
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  const field = review.fields.find(field => field.evidenceKey === 'linkedin');
  const approved = [approval(review.fields.find(field => field.id === 'full_name'), 'Avery Ng'), approval(field, 'Your LinkedIn URL')];
  const result = parseATSFillResult([{documentId: 'doc', result: await injected({action: 'fill', expectedUrl: ashby, approved})}], 'doc');
  assert.deepEqual(result.filled, ['full_name', field.id]); assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.needsCorrection, [field.id]); assert.deepEqual(result.reasons, {});
  assert.equal(linkedin.value, 'Your LinkedIn URL'); assert.equal(linkedin.validity.valid, false);
  assert.equal(result.submitted, false); assert.equal(Object.hasOwn(result, 'needsWebsiteChoice'), false);
  linkedin.value = ''; linkedin.handlers.blur = () => { linkedin.value = ''; };
  const lost = await injected({action: 'fill', expectedUrl: ashby, approved: [approval(field, 'Your LinkedIn URL')]});
  assert.deepEqual(lost.filled, []); assert.deepEqual(lost.skipped, [field.id]);
  assert.match(lost.reasons[field.id], /did not persist/);
  assert.equal(Object.hasOwn(lost, 'needsCorrection'), false); assert.equal(linkedin.value, '');
});

test('Greenhouse React select reads actual associated choices, clicks one exact option and verifies persistent selection', async () => {
  const degree = combo(); fixture([new Input({name: 'first_name'}), degree.container]);
  const field = (await inspect()).fields.find(field => field.kind === 'combobox');
  assert.equal(field.evidenceKey, 'degree'); assert.equal(degree.input.value, '');
  assert.deepEqual(field.options.map(option => option.label), ["Bachelor's Degree", "Master's Degree"]);
  const choice = matchATSSelectOption(field, 'M.Tech.');
  assert.equal(choice, "Master's Degree");
  const result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, choice)]});
  assert.deepEqual(result.filled, [field.id]);
  assert.equal(degree.container.querySelectorAll('.select__single-value')[0].textContent, "Master's Degree");
});

test('real GH React-select control opens on mousedown, avoids toggling an open menu and fills an exact observed phone code', async () => {
  const telephone = combo({id: 'country', label: 'Country*', options: ['China +86', 'Singapore +65']});
  const actualOpen = telephone.input.handlers.click;
  delete telephone.input.handlers.click;
  const control = new Element('DIV', {classes: ['select__control']});
  telephone.container.children = []; control.append(telephone.input); telephone.container.append(control);
  let opens = 0;
  control.handlers.mousedown = () => { opens++; actualOpen(); };
  const phoneGroup = new Element('FIELDSET', {classes: ['phone-input']}); phoneGroup.append(telephone.container, new Input({id: 'phone', type: 'tel'}));
  fixture([new Input({id: 'first_name', label: 'First Name*'}), phoneGroup]);
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  const phoneCountry = review.fields.find(field => field.key === 'id:country');
  assert.equal(phoneCountry.evidenceKey, 'phone_country_code');
  assert.equal(matchATSSelectOption(phoneCountry, '+86'), 'China +86');
  assert.equal(opens, 1); assert.equal(telephone.input.value, '');
  // A menu opened by the user must not be closed/reopened before selection.
  actualOpen(); telephone.input.attributes['aria-expanded'] = 'true';
  const result = parseATSFillResult([{documentId: 'doc', result: await injected({action: 'fill', expectedUrl: greenhouse,
    approved: [approval(phoneCountry, 'China +86')]})}], 'doc');
  assert.deepEqual(result.filled, [phoneCountry.id]); assert.equal(opens, 1);
  assert.equal(telephone.container.querySelectorAll('.select__single-value')[0].textContent, 'China +86');
});

test('React search waits for exact async city choice; query text alone is never a match', async () => {
  const city = combo({id: 'candidate-location', label: 'Location (City)', options: ['Singapore, Other'], onQuery: (query, model, open) => {
    if (query === 'Singapore, Singapore') setTimeout(() => { model.options = ['Singapore, Singapore']; open(); }, 220);
  }});
  fixture([new Input({name: 'first_name'}), city.container]);
  const field = (await inspect()).fields.find(field => field.kind === 'combobox');
  assert.equal(field.evidenceKey, 'current_city');
  const result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, 'Singapore, Singapore')]});
  assert.deepEqual(result.filled, [field.id]);
});

test('React duplicate or disappearing selections are skipped and existing selections are preserved', async () => {
  const duplicate = combo({options: ["Master's Degree", "Master's Degree"]});
  fixture([new Input({name: 'first_name'}), duplicate.container]);
  let field = (await inspect()).fields.find(field => field.kind === 'combobox');
  let result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, "Master's Degree")]});
  assert.deepEqual(result.skipped, [field.id]); assert.equal(duplicate.input.value, '');
  const disappearing = combo({persist: false}); fixture([new Input({name: 'first_name'}), disappearing.container]);
  field = (await inspect()).fields.find(field => field.kind === 'combobox');
  result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, "Master's Degree")]});
  assert.deepEqual(result.skipped, [field.id]);
  const occupied = combo({selected: "Bachelor's Degree"}); fixture([new Input({name: 'first_name'}), occupied.container]);
  field = (await inspect()).fields.find(field => field.kind === 'combobox'); assert.equal(field.occupied, true);
  result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(field, "Master's Degree")]});
  assert.deepEqual(result.skipped, [field.id]); assert.equal(occupied.container.querySelectorAll('.select__single-value')[0].textContent, "Bachelor's Degree");
});

test('GH country is telephone only inside the observed phone fieldset; school/date parts use exact observed identifiers', async () => {
  const telephone = combo({id: 'country', label: 'Country', options: ['China (+86)', 'Singapore (+65)']});
  const fieldset = new Element('FIELDSET', {classes: ['phone-input']}); fieldset.append(telephone.container, new Input({id: 'phone', name: 'phone', type: 'tel'}));
  const month = combo({id: 'start-month--0', label: 'Month', options: ['January', 'February']});
  fixture([new Input({name: 'first_name'}), fieldset, month.container]);
  const review = await inspect();
  assert.equal(review.fields.find(field => field.key === 'id:country').evidenceKey, 'phone_country_code');
  assert.equal(review.fields.find(field => field.key === 'id:start-month--0').evidenceKey, 'education_start_month');
});

test('real formless Ashby scope excludes résumé parser and fills anonymous date fields with observed display format', async () => {
  const start = new Input({classes: ['ashby-application-form-input-date']});
  const end = new Input({classes: ['ashby-application-form-input-date']});
  const resume = new Input({id: '_systemfield_resume', type: 'file', label: 'Resume', visible: false, accept: '.pdf,.doc,.docx'});
  const outsideResume = new Input({id: 'parser', type: 'file', label: 'Resume'});
  fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email', type: 'email'}),
    question(start, 'Start Date of Internship', {ashbyField: true, path: 'start-uuid'}), question(end, 'End Date of Internship', {ashbyField: true, path: 'end-uuid'}),
    resume], {url: ashby, outside: [outsideResume]});
  const review = await inspect();
  const fields = review.fields.filter(field => field.kind === 'date');
  assert.deepEqual(fields.map(field => field.key), ['ashby:start-uuid', 'ashby:end-uuid']);
  assert.deepEqual(fields.map(field => field.evidenceKey), ['internship_start_date', 'internship_end_date']);
  assert.equal(review.resumeTarget.key, 'id:_systemfield_resume');
  const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby,
    approved: [approval(fields[0], '2026-10-30'), approval(fields[1], '2027-04-30')]});
  assert.equal(result.filled.length, 2); assert.equal(start.value, '10/30/2026'); assert.equal(end.value, '04/30/2027');
  assert.equal(outsideResume.events.length, 0);
});

test('actual Ashby two-container layout anchors 26 real controls to identity and excludes the separate parser container', async () => {
  const name = new Input({id: '_systemfield_name', name: '_systemfield_name', label: 'Name'});
  const email = new Input({id: '_systemfield_email', name: '_systemfield_email', label: 'Email', type: 'email'});
  const phone = new Input({id: '46da96c7-720f-4960-82d2-861b9e5873b7', name: '46da96c7-720f-4960-82d2-861b9e5873b7', label: 'Phone Number', type: 'tel'});
  const linkedin = new Input({id: '3fe74e32-c004-4a63-a3bd-a5d4391ae0ab', name: '3fe74e32-c004-4a63-a3bd-a5d4391ae0ab', label: 'LinkedIn URL', type: 'url'});
  const resume = new Input({id: '_systemfield_resume', type: 'file', label: 'Resume', visible: false});
  const education = new Element('DIV', {classes: ['ashby-application-form-field-entry'], attributes: {'data-field-path': '_systemfield_education_history'}});
  const degree = new Input({id: 'education-degree', label: 'Degree'}), major = new Input({id: 'education-major', label: 'Field of Study'});
  const school = new Input({id: 'education-school', label: 'School', attributes: {role: 'combobox'}});
  education.append(degree, major, school, ...Array.from({length: 4}, (_, index) => new Select({name: `unlabelled-education-${index}`})));
  const based = new Input({attributes: {role: 'combobox'}});
  const parserFile = new Input({id: 'parser-resume', type: 'file', label: 'Resume'});
  const parser = new Element('DIV', {classes: ['ashby-application-form-container']}); parser.append(parserFile);
  const extra = Array.from({length: 13}, (_, index) => new Input({name: `ordinary-${index}`, label: `Ordinary question ${index}`}));
  const bound = fixture([name, email, phone, linkedin, resume, education,
    question(based, 'Where are you currently based?', {ashbyField: true, path: '_systemfield_location'}), ...extra], {url: ashby, outside: [parser]});
  assert.equal(bound.scope.querySelectorAll('input, textarea, select').length, 26);
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  assert.equal(review.ok, true); assert.equal(review.provider, 'Ashby'); assert.ok(review.fields.length > 6);
  assert.equal(review.resumeTarget.key, 'id:_systemfield_resume');
  assert.equal(review.fields.find(field => field.key === 'ashby:_systemfield_location').manualOnly, true);
  assert.equal(review.fields.find(field => field.key === 'id:education-school').manualOnly, true);
  const expected = [['full_name', 'Avery Ng'], ['email', 'avery@example.test'], ['phone', '+6512345678'], ['linkedin', 'https://www.linkedin.com/in/fictional-avery'], ['degree', 'M.Tech.'], ['discipline', 'Software Engineering']];
  const approved = expected.map(([evidenceKey, value]) => approval(review.fields.find(field => field.evidenceKey === evidenceKey), value));
  const result = await injected({action: 'fill', expectedUrl: ashby, approved});
  assert.equal(result.filled.length, 6); assert.deepEqual(result.skipped, []);
  assert.equal(name.value, 'Avery Ng'); assert.equal(degree.value, 'M.Tech.');
  assert.deepEqual(parserFile.events, []); assert.equal(based.value, '');
});

test('Ashby refuses identities split across containers or duplicated instead of selecting one form by position', async () => {
  for (const duplicate of [false, true]) {
    const other = new Element('DIV', {classes: ['ashby-application-form-container']});
    other.append(new Input({name: '_systemfield_email', label: 'Email'}));
    if (duplicate) other.append(new Input({name: '_systemfield_name', label: 'Name'}));
    fixture([new Input({name: '_systemfield_name', label: 'Name'}),
      ...(duplicate ? [new Input({name: '_systemfield_email', label: 'Email'})] : [])], {url: ashby, outside: [other]});
    const result = await inspect();
    assert.equal(result.ok, false); assert.equal(result.error.code, 'ambiguous_fields');
  }
});

test('actual BlockTech same-name manual radio groups cannot prevent unique Ashby text fields from being read and filled', async () => {
  const snapshot = JSON.parse(readFileSync(new URL('./fixtures/ashby-blocktech-controls.json', import.meta.url), 'utf8'));
  const rows = new Map(), nodes = [], radios = [], selects = [];
  const actualUrl = 'https://jobs.ashbyhq.com/blocktech/0b610536-94c4-4a42-b937-c163ea2cc8a1/application';
  for (const metadata of snapshot.slice(1).filter(node => node.name !== 'g-recaptcha-response')) {
    const attributes = {...(metadata.role ? {role: metadata.role} : {}), ...(metadata.ariaLabel ? {'aria-label': metadata.ariaLabel} : {})};
    const details = {id: metadata.id, name: metadata.name, type: metadata.type, label: metadata.labels[0] || '',
      visible: metadata.visible, disabled: metadata.disabled, attributes, classes: metadata.classes.split(/\s+/).filter(Boolean)};
    const node = metadata.tag === 'SELECT' ? new Select(details) : new Input(details);
    if (node.type === 'radio') radios.push(node);
    if (metadata.tag === 'SELECT') selects.push(node);
    if (metadata.path) {
      if (!rows.has(metadata.path)) {
        const row = new Element('DIV', {classes: ['ashby-application-form-field-entry'], attributes: {'data-field-path': metadata.path}});
        if (metadata.path === '_systemfield_location') row.append(new Element('LABEL', {text: 'Where are you currently based?', classes: ['ashby-application-form-question-title']}));
        rows.set(metadata.path, row); nodes.push(row);
      }
      rows.get(metadata.path).append(node);
    } else nodes.push(node);
  }
  const parser = new Element('DIV', {classes: ['ashby-application-form-container']}); parser.append(new Input({type: 'file'}));
  // The fixture scope factory uses the canonical Ashby shape; its exact URL is
  // then bound to the actual public form without changing any control identity.
  const bound = fixture(nodes, {url: ashby, outside: [parser]}); location.href = actualUrl;
  assert.equal(bound.scope.querySelectorAll('input, textarea, select').length, 27);
  assert.equal(radios.length, 10); assert.equal(new Set(radios.map(node => node.name)).size, 3);
  assert.equal(selects.length, 4); assert.ok(selects.every(node => !node.id && !node.name && !node.labels.length));
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  assert.equal(review.ok, true, JSON.stringify(review.error)); assert.equal(review.provider, 'Ashby');
  assert.ok(review.fields.some(field => field.id === 'full_name')); assert.ok(review.fields.some(field => field.id === 'email'));
  assert.ok(radios.every(node => !review.fields.some(field => field.key === `name:${node.name}`)));
  assert.ok(radios.every(node => review.manualQuestions.includes(node.labels[0].textContent.replace(/\s+/g, ' ').trim())));
  const groupKey = `name:${radios[0].name}`;
  let groupHash = 2166136261;
  for (const char of groupKey) groupHash = Math.imul(groupHash ^ char.charCodeAt(0), 16777619) >>> 0;
  const forged = {id: 'field:' + groupHash.toString(36), key: groupKey, label: radios[0].labels[0].textContent,
    kind: 'text', evidenceKey: null, value: 'Never choose for the applicant', confirmed: true};
  const rejected = await injected({action: 'fill', expectedUrl: actualUrl,
    approved: [approval(review.fields.find(field => field.id === 'full_name'), 'Avery Ng'), forged]});
  assert.equal(rejected.mutation_started, false); assert.equal(rejected.error.mismatch, 'missing_field');
  assert.equal(bound.scope.querySelectorAll('input').find(node => node.name === '_systemfield_name').value, '');
  const expected = [['full_name', 'Avery Ng'], ['email', 'avery@example.test'], ['phone', '+6512345678'], ['linkedin', 'https://www.linkedin.com/in/fictional-avery'], ['degree', 'M.Tech.'], ['discipline', 'Software Engineering']];
  const approved = expected.map(([key, value]) => approval(review.fields.find(field => field.evidenceKey === key), value));
  const result = await injected({action: 'fill', expectedUrl: actualUrl, approved});
  assert.equal(result.filled.length, 6); assert.deepEqual(result.skipped, []); assert.equal(result.submitted, false);
  assert.ok(radios.concat(selects).every(node => node.events.length === 0 && !node.value));
});

test('Ashby education month/year controls use labelled semantic option sets rather than select position', async () => {
  const education = ashbyEducation();
  // The two controls and their options can reorder without changing semantics.
  education.startContainer.children.reverse(); education.endMonth.options.reverse();
  const name = new Input({name: '_systemfield_name', label: 'Name'}), email = new Input({name: '_systemfield_email', label: 'Email'});
  fixture([new Input({name: 'optional', label: 'Optional ordinary question'}), name, email, education.row], {url: ashby});
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  const facts = {education_start_month: '01', education_start_year: '2026', education_end_month: '06', education_end_year: '2027'};
  const fields = review.fields.filter(field => /^education_(?:start|end)_(?:month|year)$/.test(field.evidenceKey || ''));
  assert.equal(fields.length, 4); assert.ok(fields.every(field => field.kind === 'select' && field.available));
  assert.ok(fields.every(field => field.key.startsWith('ashby:_systemfield_education_history-')));
  assert.ok(fields.every(field => field.label === field.evidenceKey.replaceAll('_', ' ').replace(/^education/, 'Education')));
  const editors = new Map(fields.map(field => [field.id, {field, input: {value: autofillSuggestion(field, {values: facts}).value}}]));
  const result = await injected({action: 'fill', expectedUrl: ashby, approved: approvedAutofillAnswers(editors)});
  assert.equal(result.filled.length, 4); assert.deepEqual(result.skipped, []);
  assert.deepEqual([education.startMonth.value, education.startYear.value, education.endMonth.value, education.endYear.value], ['1', '2026', '6', '2027']);
});

test('ambiguous or relabelled Ashby education date parts reject before neighbouring identity writes and preserve existing dates', async () => {
  for (const change of ['caption', 'duplicate_kind', 'duplicate_row']) {
    const education = ashbyEducation(), name = new Input({name: '_systemfield_name', label: 'Name'});
    const bound = fixture([name, new Input({name: '_systemfield_email', label: 'Email'}), education.row], {url: ashby});
    const review = await inspect();
    const month = review.fields.find(field => field.evidenceKey === 'education_start_month');
    const approved = [approval(review.fields.find(field => field.id === 'full_name'), 'Avery Ng'), approval(month, '1')];
    if (change === 'caption') education.startCaption.textContent = 'Eligibility date';
    if (change === 'duplicate_kind') education.startYear.options = [...education.startMonth.options];
    if (change === 'duplicate_row') bound.scope.append(ashbyEducation().row);
    const result = await rawInteractWithATSPage({action: 'fill', expectedUrl: ashby, approved});
    assert.equal(result.ok, false); assert.equal(result.mutation_started, false); assert.equal(name.value, '');
  }
  const education = ashbyEducation(); education.startYear.value = '2025';
  fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}), education.row], {url: ashby});
  const field = (await inspect()).fields.find(field => field.evidenceKey === 'education_start_year');
  assert.equal(field.occupied, true);
  const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, '2026')]});
  assert.deepEqual(result.skipped, [field.id]); assert.equal(education.startYear.value, '2025');
});

test('Ashby school and city search their bound async portals and explicitly click unique exact primary labels before blur', async () => {
  let bound;
  const school = ashbyCombo({root: () => bound.root, labels: ['National University of Salta', 'National University of Singapore']});
  const city = ashbyCombo({purpose: 'city', root: () => bound.root, labels: ['Singapore']});
  bound = fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}), school.row, city.row], {url: ashby});
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  const fields = review.fields.filter(field => ['school', 'current_city'].includes(field.evidenceKey));
  assert.equal(fields.length, 2); assert.ok(fields.every(field => field.kind === 'combobox' && field.available && field.searchable && field.optionsPending));
  assert.deepEqual(school.model.queries, []); assert.deepEqual(city.model.queries, []);
  const profile = {values: {school: 'National University of Singapore (NUS)', current_city: 'Singapore'}};
  const editors = new Map(fields.map(field => [field.id, {field, input: {value: autofillSuggestion(field, profile).value}}]));
  const result = await injected({action: 'fill', expectedUrl: ashby, approved: approvedAutofillAnswers(editors)});
  assert.equal(result.filled.length, 2); assert.deepEqual(result.skipped, []);
  assert.deepEqual(school.model.clicks, ['National University of Singapore']); assert.deepEqual(city.model.clicks, ['Singapore']);
  assert.deepEqual(school.model.queries, ['National University of Singapore']);
  assert.equal(profile.values.school, 'National University of Singapore (NUS)');
  assert.equal(school.input.value, 'National University of Singapore'); assert.equal(city.input.value, 'Singapore');
});

test('Ashby school aliases never strip a different acronym, country or campus and never choose among canonical duplicates', async () => {
  const cases = [
    {value: 'National University of Singapore (NTU)', labels: ['National University of Singapore']},
    {value: 'National University of Singapore (Singapore)', labels: ['National University of Singapore']},
    {value: 'National University of Singapore (NUS) - Downtown', labels: ['National University of Singapore']},
    {value: 'National University of Singapore (NUS)', labels: ['National University of Singapore', 'National University of Singapore (NUS)']},
  ];
  for (const {value, labels} of cases) {
    let bound;
    const school = ashbyCombo({root: () => bound.root, labels});
    bound = fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}), school.row], {url: ashby});
    const field = (await inspect()).fields.find(field => field.evidenceKey === 'school');
    const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, value)]});
    assert.deepEqual(result.filled, []); assert.deepEqual(result.skipped, [field.id]); assert.deepEqual(school.model.clicks, []);
    assert.deepEqual(school.model.queries, [value.endsWith('(NUS)') ? 'National University of Singapore' : value]);
  }
});

test('Ashby dropdown query text or active highlight is never a selection and duplicates or disappearing choices stay skipped', async () => {
  for (const scenario of ['ignored_click', 'duplicates', 'disappears']) {
    let bound;
    const school = ashbyCombo({root: () => bound.root, labels: scenario === 'duplicates' ? ['National University of Singapore', 'National University of Singapore'] : ['National University of Singapore'],
      accepts: scenario !== 'ignored_click', disappears: scenario === 'disappears'});
    bound = fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}), school.row], {url: ashby});
    const field = (await inspect()).fields.find(field => field.evidenceKey === 'school');
    const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, 'National University of Singapore')]});
    assert.deepEqual(result.filled, []); assert.deepEqual(result.skipped, [field.id]);
    if (scenario === 'duplicates') assert.deepEqual(school.model.clicks, []);
    if (scenario === 'ignored_click') assert.match(result.reasons[field.id], /Query text alone/);
    if (scenario === 'disappears') assert.equal(school.input.value, '');
  }
});

test('Ashby dropdowns preserve an existing value and reject a changed labelled school group before another field is written', async () => {
  let bound;
  const school = ashbyCombo({root: () => bound.root}); school.input.value = 'Existing institution';
  bound = fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}), school.row], {url: ashby});
  const field = (await inspect()).fields.find(field => field.evidenceKey === 'school');
  assert.equal(field.occupied, true);
  const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, 'National University of Singapore')]});
  assert.deepEqual(result.skipped, [field.id]); assert.equal(school.input.value, 'Existing institution'); assert.deepEqual(school.model.queries, []);
  school.input.value = '';
  const review = await inspect();
  const old = review.fields.find(field => field.evidenceKey === 'school'); school.caption.textContent = 'Different qualification';
  const rejected = await rawInteractWithATSPage({action: 'fill', expectedUrl: ashby,
    approved: [approval(review.fields.find(field => field.id === 'full_name'), 'Avery Ng'), approval(old, 'National University of Singapore')]});
  assert.equal(rejected.mutation_started, false); assert.equal(rejected.ok, false); assert.deepEqual(school.model.queries, []);
});

test('Ashby manual group isolation never hides duplicate ordinary controls or a mixed radio/text name collision', async () => {
  for (const mixed of [false, true]) {
    fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}),
      new Input({id: 'answer-one', name: 'shared-answer', type: mixed ? 'radio' : 'text', label: 'First answer'}),
      new Input({id: 'answer-two', name: 'shared-answer', label: 'Second answer'})], {url: ashby});
    const result = await inspect();
    assert.equal(result.ok, false); assert.equal(result.error.code, 'ambiguous_fields');
    assert.equal(result.error.stage, 'read_fields');
  }
});

test('Ashby ordinary radios bind the entire parent question and choose only an explicit saved preference', async () => {
  const radio = ashbyRadio('When would you be available to start a full-time role?', ['2027', '2028', '2029']);
  fixture([new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'}), radio.group], {url: ashby});
  const review = await inspect(), field = review.fields.find(field => field.evidenceKey === 'fulltime_start_year');
  assert.equal(field.label, radio.title.textContent); assert.equal(field.kind, 'select'); assert.equal(field.available, true);
  assert.equal(review.fields.filter(candidate => candidate.key === field.key).length, 1);
  assert.equal(autofillSuggestion(field, {values: {education_end_year: '2027'}}).value, '');
  const suggestion = autofillSuggestion(field, {values: {fulltime_start_year: '2028'}});
  assert.equal(suggestion.value, radio.members[1].id);
  const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, suggestion.value)]});
  assert.deepEqual(result.filled, [field.id]); assert.deepEqual(radio.members.map(node => node.checked), [false, true, false]);
  const existing = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, radio.members[0].id)]});
  assert.deepEqual(existing.skipped, [field.id]); assert.equal(radio.members[1].checked, true);
});

test('radio parent/option changes and declarations reject before another answer is written', async () => {
  for (const change of ['parent', 'option', 'group_name', 'declaration']) {
    const radio = ashbyRadio('When would you be available to start a full-time role?', ['2027', '2028', '2029']);
    const name = new Input({name: '_systemfield_name', label: 'Name'});
    fixture([name, new Input({name: '_systemfield_email', label: 'Email'}), radio.group], {url: ashby});
    const review = await inspect(), field = review.fields.find(field => field.evidenceKey === 'fulltime_start_year');
    const answers = [approval(review.fields.find(candidate => candidate.id === 'full_name'), 'Avery Ng'), approval(field, radio.members[0].id)];
    if (change === 'parent') radio.title.textContent = 'Different year preference';
    if (change === 'option') radio.members[0].labels[0].textContent = 'A different meaning';
    if (change === 'group_name') radio.members[0].name = 'unrelated-group';
    if (change === 'declaration') radio.title.textContent = 'Do you require a work permit?';
    const result = await rawInteractWithATSPage({action: 'fill', expectedUrl: ashby, approved: answers});
    assert.equal(result.ok, false); assert.equal(result.mutation_started, false); assert.equal(name.value, '');
    assert.ok(radio.members.every(node => !node.checked));
  }
});

test('ongoing student checkbox is an ordinary exact choice, precedes dependents and never toggles consent or erases end dates', async () => {
  const student = ashbyStudent(), name = new Input({name: '_systemfield_name', label: 'Name'});
  const consent = new Input({name: 'consent', type: 'checkbox', label: 'I agree to the privacy policy'});
  const order = []; name.handlers.input = () => order.push('name');
  const toggle = student.node.handlers.click; student.node.handlers.click = () => { order.push('student'); toggle(); };
  fixture([name, new Input({name: '_systemfield_email', label: 'Email'}), student.row, consent], {url: ashby});
  const review = await inspect(), field = review.fields.find(candidate => candidate.evidenceKey === 'current_student');
  assert.equal(field.available, true); assert.equal(field.kind, 'select');
  const selected = autofillSuggestion(field, {values: {current_student: 'Yes'}}).value;
  const result = await interactWithATSPage({action: 'fill', expectedUrl: ashby,
    approved: [approval(review.fields.find(candidate => candidate.id === 'full_name'), 'Avery Ng'), approval(field, selected)]});
  assert.equal(result.filled.length, 2); assert.deepEqual(order.slice(0, 2), ['student', 'name']);
  assert.equal(student.node.checked, true); assert.equal(student.endYear.disabled, true); assert.equal(consent.checked, false);
  assert.deepEqual(consent.events, []);
  student.node.checked = false; student.endYear.disabled = false; student.endYear.value = '2027';
  const preserved = await interactWithATSPage({action: 'fill', expectedUrl: ashby, approved: [approval(field, 'yes')]});
  assert.deepEqual(preserved.skipped, [field.id]); assert.equal(student.node.checked, false); assert.equal(student.endYear.value, '2027');
});

test('incompatible ongoing-student and end-date approvals reject the complete batch before any write', async () => {
  const student = ashbyStudent(), name = new Input({name: '_systemfield_name', label: 'Name'});
  fixture([name, new Input({name: '_systemfield_email', label: 'Email'}), student.row], {url: ashby});
  const review = await inspect();
  const answers = [approval(review.fields.find(field => field.id === 'full_name'), 'Avery Ng'),
    approval(review.fields.find(field => field.evidenceKey === 'current_student'), 'yes'),
    approval(review.fields.find(field => field.evidenceKey === 'education_end_year'), '2027')];
  const result = await rawInteractWithATSPage({action: 'fill', expectedUrl: ashby, approved: answers});
  assert.equal(result.mutation_started, false); assert.equal(result.error.mismatch, 'incompatible_answers');
  assert.equal(name.value, ''); assert.equal(student.node.checked, false);
});

test('only the observed non-binary Lever internship category unblocks, while visa and agreement stay manual', async () => {
  const type = new Select({name: 'internship_type', label: 'Is your internship - ?✱', options: [{value: '', label: 'Select...'},
    ...['Credit Bearing', 'Leave of Absence', 'Outside of School', 'Others'].map(value => ({value, label: value}))]});
  const visa = new Select({name: 'visa', label: 'Citizenship/Visa Status', options: countryOptions});
  fixture([new Input({name: 'name', label: 'Name'}), type, visa], {url: lever});
  const review = await inspect(), field = review.fields.find(candidate => candidate.key === 'name:internship_type');
  assert.equal(field.available, true); assert.equal(field.evidenceKey, 'internship_type');
  assert.equal(autofillSuggestion(field, {values: {degree: 'M.Tech.'}}).value, '');
  assert.equal(autofillSuggestion(field, {values: {internship_type: 'Credit Bearing'}}).value, 'Credit Bearing');
  assert.equal(review.fields.find(candidate => candidate.key === 'name:visa').manualOnly, true);
});

test('Ashby startup waits only for bounded identity hydration and reports an explicit loading state when absent', async () => {
  const bound = fixture([], {url: ashby});
  const timer = setTimeout(() => bound.scope.append(new Input({name: '_systemfield_name', label: 'Name'}), new Input({name: '_systemfield_email', label: 'Email'})), 25);
  try { assert.deepEqual((await inspect()).fields.map(field => field.id), ['full_name', 'email']); }
  finally { clearTimeout(timer); }
  fixture([], {url: ashby});
  const started = Date.now();
  const result = await inspect();
  assert.equal(result.ok, false); assert.equal(result.error.code, 'form_not_ready');
  assert.ok(Date.now() - started < 2600);
  assert.throws(() => parseATSInspectionResult([{documentId: 'doc', result}]), /still loading/);
});

test('invalid dates are rejected before any write', async () => {
  const date = new Input({name: 'start_date', type: 'date', label: 'Start date of internship'});
  const first = new Input({name: 'first_name'}); fixture([first, date]);
  const review = await inspect();
  await assert.rejects(interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [
    approval(review.fields.find(field => field.id === 'first_name'), 'MING'), approval(review.fields.find(field => field.kind === 'date'), '2026-02-30'),
  ]}), /real ISO date/);
  assert.equal(first.value, '');
});

test('explicit attachment verifies unique CV target, PDF bytes/hash and leaves cover letter and submission untouched', async () => {
  const resume = new Input({name: 'resume', type: 'file', label: 'Resume/CV', accept: '.pdf', visible: false});
  const cover = new Input({name: 'cover', type: 'file', label: 'Cover letter'});
  fixture([new Input({name: 'first_name'}), resume, cover]);
  const target = (await inspect()).resumeTarget;
  const bytes = new TextEncoder().encode('%PDF-1.7\nfixture');
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const file = {name: 'resume.pdf', base64: Buffer.from(bytes).toString('base64'), sha256, size_bytes: bytes.length};
  await assert.rejects(interactWithATSPage({action: 'attach', expectedUrl: greenhouse, targetKey: target.key, targetLabel: target.label,
    confirmed: true, file: {...file, sha256: '0'.repeat(64)}}), /hash changed/);
  assert.equal(resume.files.length, 0);
  const result = await interactWithATSPage({action: 'attach', expectedUrl: greenhouse, targetKey: target.key, targetLabel: target.label, confirmed: true, file});
  assert.deepEqual(result, {submitted: false, selected: true, upload_status: 'selected_on_form', filename: 'resume.pdf', sha256});
  assert.equal(resume.files[0].name, 'resume.pdf'); assert.equal(cover.files.length, 0);
  await assert.rejects(interactWithATSPage({action: 'attach', expectedUrl: greenhouse, targetKey: target.key, targetLabel: target.label, confirmed: true, file}), /empty résumé/);
});

test('attachment needs its own click, refuses unknown/multiple targets, and never appears in ordinary fill', async () => {
  const resume = new Input({name: 'resume', type: 'file', label: 'Resume', visible: false});
  fixture([new Input({name: 'first_name'}), resume, new Input({name: 'resume2', type: 'file', label: 'CV', visible: false})]);
  assert.equal((await inspect()).resumeTarget, null);
  await assert.rejects(interactWithATSPage({action: 'attach', expectedUrl: greenhouse, confirmed: true}), /upload target/);
  fixture([new Input({name: 'first_name'}), resume]);
  const review = await inspect(); assert.equal(review.fields.some(field => field.key === 'name:resume'), false);
  await assert.rejects(interactWithATSPage({action: 'attach', expectedUrl: greenhouse,
    targetKey: review.resumeTarget.key, targetLabel: review.resumeTarget.label}), /upload target/);
});

test('self-contained injected function accepts exact EU/Ashby routes and rejects spoofed or changed URLs', async () => {
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const eu = 'https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101';
  fixture([new Input({name: 'first_name'})], {url: eu}); assert.equal((await injected({action: 'inspect'})).provider, 'Greenhouse');
  assert.throws(() => parseATSFillResult([{documentId: 'doc', result: {fill_version: 1, ok: false, mutation_started: false, error: {code: 'url_changed', stage: 'validate_page'}}}], 'doc'), /URL changed/);
  assert.equal((await injected({action: 'fill', expectedUrl: eu + '#changed', approved: []})).error.code, 'url_changed');
  for (const url of [eu.replace('.greenhouse.io', '.greenhouse.io.evil.example'), eu + '?gh_jid=123', eu + '#apply',
    ashby + '?tracking=1', ashby.replace('/application', '/application/extra'), ashby.replace('https:', 'http:'), ashby.replace('jobs.ashbyhq.com', 'jobs.ashbyhq.com.evil.example')]) {
    fixture([new Input({name: 'first_name'})], {url});
    const result = await injected({action: 'inspect'});
    assert.equal(result.error.code, 'unsupported_page');
    assert.throws(() => parseATSInspectionResult([{frameId: 0, documentId: 'doc', result}]), /supported hosted application/);
  }
});

test('serialized GH inspect survives the real unnamed aria-hidden React companion inputs through Chrome result serialization', async () => {
  const helper = new Input({attributes: {'aria-hidden': 'true', tabindex: '-1'}, cssOpacity: '0'});
  fixture([new Input({name: 'first_name', label: 'First name'}), new Input({name: 'email', label: 'Email'}), helper]);
  const failures = [];
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  let result;
  try { result = await injected({action: 'inspect'}); }
  catch (error) { failures.push(error.message); }
  // Chrome may resolve an InjectionResult with no result when injected code throws.
  const [response] = JSON.parse(JSON.stringify([{frameId: 0, documentId: 'actual-serialized-qa-document', result}]));
  assert.deepEqual(failures, []);
  const bound = parseATSInspectionResult([response], greenhouse);
  assert.equal(bound.result.url, greenhouse);
  assert.deepEqual(bound.result.fields.map(field => field.id), ['first_name', 'email']);
  const profile = {values: {given_name: 'Fictional Avery', contact_email: 'avery@example.test'}};
  assert.deepEqual(bound.result.fields.map(field => autofillSuggestion(field, profile).value), ['Fictional Avery', 'avery@example.test']);
});

test('serialized actual nameless GH identity, school, degree and numeric-year metadata fill through the real popup approval contract', async () => {
  const liveUrl = 'https://job-boards.greenhouse.io/simplifynext/jobs/5174810007';
  const first = new Input({id: 'first_name', label: 'First Name*', maxLength: 255});
  const last = new Input({id: 'last_name', label: 'Last Name*', maxLength: 255});
  const email = new Input({id: 'email', label: 'Email*', type: 'text', maxLength: 255});
  const phone = new Input({id: 'phone', label: 'Phone', type: 'tel', maxLength: 255});
  const preferred = new Input({id: 'preferred_name', label: 'Preferred First Name', maxLength: 255});
  const countryCode = combo({id: 'country', label: 'Country*', options: ['Singapore +65', 'China +86']});
  const phoneGroup = new Element('FIELDSET', {classes: ['phone-input']}); phoneGroup.append(countryCode.container, phone);
  const school = combo({id: 'school--0', label: 'School', options: ['Other institution'], onQuery: (query, model, open) => {
    if (query === 'National University of Singapore') { model.options = [query]; open(); }
  }});
  const degree = combo({id: 'degree--0', label: 'Degree'});
  const year = new Input({id: 'end-year--0', label: 'End Year', type: 'number'});
  const helpers = Array.from({length: 9}, () => new Input({attributes: {'aria-hidden': 'true', tabindex: '-1'}}));
  fixture([first, last, email, preferred, phoneGroup, school.container, degree.container, year, ...helpers], {url: liveUrl});
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const transport = result => JSON.parse(JSON.stringify([{frameId: 0, documentId: 'gh-live-shape', result}]));
  const review = parseATSInspectionResult(transport(await injected({action: 'inspect'})), liveUrl).result;
  const profile = {values: {given_name: 'Avery', family_name: 'Ng', contact_email: 'avery@example.test', phone: '+6512345678',
    school: 'National University of Singapore', degree: 'M.Tech.', education_end_year: '2027'}};
  const entries = new Map(review.fields.map(field => [field.id, {field, input: {value: autofillSuggestion(field, profile).value}, factKey: autofillSuggestion(field, profile).key}]));
  const approved = approvedAutofillAnswers(entries);
  assert.equal(approved.length, 7); assert.equal(preferred.value, '');
  const result = parseATSFillResult(transport(await injected({action: 'fill', expectedUrl: liveUrl, approved})), 'gh-live-shape');
  assert.equal(result.filled.length, 7); assert.deepEqual(result.skipped, []);
  assert.deepEqual([first.value, last.value, email.value, phone.value, year.value], ['Avery', 'Ng', 'avery@example.test', '+6512345678', '2027']);
  assert.equal(preferred.value, ''); assert.equal(countryCode.input.value, '');
});

test('serialized fill preflight rejections survive Chrome JSON and identify a known no-write outcome', async () => {
  const first = new Input({id: 'first_name', label: 'First Name*'}), question = new Input({name: 'availability', label: 'Availability period'});
  fixture([first, question]);
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  const approved = [approval(review.fields.find(field => field.id === 'first_name'), 'Avery'), approval(review.fields.find(field => field.key === 'name:availability'), 'Jan to Jun 2027')];
  question.labels[0].textContent = 'Visa eligibility';
  const serialized = JSON.parse(JSON.stringify([{frameId: 0, documentId: 'doc', result: await injected({action: 'fill', expectedUrl: greenhouse, approved})}]));
  assert.deepEqual(serialized[0].result, {fill_version: 1, ok: false, mutation_started: false,
    error: {code: 'invalid_review', stage: 'fill_preflight', field_id: approved[1].id, mismatch: 'manual_only'}});
  assert.equal(first.value, ''); assert.deepEqual(first.events, []);
  assert.throws(() => parseATSFillResult(serialized, 'doc'), error => error.fillRejected === true && !error.fillUncertain && /Nothing was filled/.test(error.message));
  for (const results of [[{documentId: 'doc'}], [{documentId: 'wrong', result: {filled: [], skipped: [], submitted: false}}]]) {
    assert.throws(() => parseATSFillResult(results, 'doc'), error => error.fillUncertain === true && !error.fillRejected);
  }
});

test('serialized preflight identifies each changed descriptor part without returning question or answer content', async () => {
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const cases = [
    ['missing_field', (item) => { item.id = 'field:missing'; }],
    ['key', (item) => { item.key = 'name:private-key'; }],
    ['label', (item) => { item.label = 'Private question text'; }],
    ['kind', (item) => { item.kind = 'number'; }],
    ['evidence_key', (item) => { item.evidenceKey = null; }],
    ['max_length', (_item, node) => { node.maxLength = 3; }],
    ['manual_only', (_item, node) => { node.labels[0].textContent = 'Private visa eligibility'; }],
  ];
  for (const [expected, change] of cases) {
    const first = new Input({id: 'first_name', label: 'First Name*'});
    const question = new Input({name: 'availability', label: 'Availability period'});
    fixture([first, question]);
    const review = await injected({action: 'inspect'});
    const item = approval(review.fields.find(field => field.key === 'name:availability'), 'Private saved answer');
    change(item, question);
    const result = await injected({action: 'fill', expectedUrl: greenhouse,
      approved: [approval(review.fields.find(field => field.id === 'first_name'), 'Avery'), item]});
    const results = JSON.parse(JSON.stringify([{frameId: 0, documentId: 'doc', result}]));
    assert.deepEqual(result.error, {code: 'invalid_review', stage: 'fill_preflight', field_id: item.id, mismatch: expected,
      ...(expected === 'evidence_key' ? {expected_evidence_type: 'string', received_evidence_type: 'null'} : {})});
    assert.equal(result.mutation_started, false);
    assert.equal(first.value, ''); assert.equal(question.value, '');
    assert.doesNotMatch(JSON.stringify(result), /Private|Avery|Availability/);
    assert.throws(() => parseATSFillResult(results, 'doc'), error => error.fillRejected === true
      && error.fillFieldId === item.id && error.fillMismatch === expected && error.message.includes(`${item.id}/${expected}`)
      && (expected !== 'evidence_key' || error.fillExpectedEvidenceType === 'string' && error.fillReceivedEvidenceType === 'null'));
  }
  assert.throws(() => parseATSFillResult([{documentId: 'doc', result: {fill_version: 1, ok: false, mutation_started: false,
    error: {code: 'invalid_review', stage: 'fill_preflight', field_id: 'private@example.test', mismatch: 'Private text'}}}], 'doc'),
  error => !error.fillFieldId && !error.fillMismatch && !/private/i.test(error.message));
});

test('all rejected approval shapes carry a fixed safe diagnostic before any website write', async () => {
  const first = new Input({id: 'first_name', label: 'First Name*'});
  fixture([first]);
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const review = await injected({action: 'inspect'});
  const valid = approval(review.fields[0], 'Private applicant answer');
  const cases = [
    ['action', {action: 'other', approved: [valid]}],
    ['answers_type', {approved: null}],
    ['answers_count', {approved: Array.from({length: 61}, () => valid)}],
    ['duplicate_id', {approved: [valid, valid]}, 'first_name'],
    ['item_shape', {approved: [null]}],
    ['id_type', {approved: [{...valid, id: 123}]}],
    ['value_type', {approved: [{...valid, value: null}]}, 'first_name'],
    ['empty_value', {approved: [{...valid, value: '  '}]}, 'first_name'],
    ['value_limit', {approved: [{...valid, value: 'a'.repeat(10001)}]}, 'first_name'],
    ['confirmation', {approved: [{...valid, confirmed: false}]}, 'first_name'],
  ];
  for (const [mismatch, payload, fieldId] of cases) {
    const result = await injected({action: 'fill', expectedUrl: greenhouse, ...payload});
    assert.deepEqual(result, {fill_version: 1, ok: false, mutation_started: false,
      error: {code: 'invalid_review', stage: 'fill_preflight', mismatch, ...(fieldId ? {field_id: fieldId} : {})}});
    assert.equal(first.value, ''); assert.deepEqual(first.events, []);
    assert.doesNotMatch(JSON.stringify(result), /Private|applicant|answer"/);
    assert.throws(() => parseATSFillResult(JSON.parse(JSON.stringify([{documentId: 'doc', result}])), 'doc'),
      error => error.fillRejected && error.fillMismatch === mismatch && error.fillFieldId === fieldId
        && error.message.includes(`${fieldId || 'approved'}/${mismatch}`));
  }
});

test('every generated stable answer identifier fits the public diagnostic whitelist', async () => {
  fixture([new Input({id: 'first_name', label: 'First Name*'}), new Input({id: 'last_name', label: 'Last Name*'}),
    new Input({id: 'email', label: 'Email*'}), new Input({id: 'phone', label: 'Phone'}),
    ...Array.from({length: 50}, (_, index) => new Input({name: `question-${index}`, label: `Ordinary question ${index}`}))]);
  const review = await inspect();
  assert.equal(review.fields.length, 54);
  assert.ok(review.fields.every(field => /^(?:field:[a-z0-9]{1,7}|first_name|last_name|full_name|email|phone)$/.test(field.id)));
});

test('serialized reader runtime failures survive Chrome JSON results without private exception text or generic unsupported claims', async () => {
  fixture([new Input({name: 'first_name'})]);
  document.querySelectorAll = () => { throw new TypeError('private-contact@example.test must not be returned'); };
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const result = await injected({action: 'inspect'});
  const results = JSON.parse(JSON.stringify([{frameId: 0, documentId: 'bound-doc', result}]));
  assert.deepEqual(results[0].result, {inspection_version: 1, ok: false, error: {code: 'reader_failed', stage: 'read_form_scope'}});
  assert.doesNotMatch(JSON.stringify(results), /private-contact/);
  assert.throws(() => parseATSInspectionResult(results), /reader_failed:read_form_scope/);
});

test('a transient unchanged dropdown read failure preserves usable identity fields and returns a safe manual reason', async () => {
  const degree = combo(); degree.input.handlers.click = () => { throw new TypeError('private page internals'); };
  fixture([new Input({name: 'first_name', label: 'First name'}), degree.container]);
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const result = await injected({action: 'inspect'});
  const response = parseATSInspectionResult(JSON.parse(JSON.stringify([{frameId: 0, documentId: 'doc', result}])));
  assert.equal(response.result.ok, true);
  assert.equal(response.result.fields.find(field => field.id === 'first_name').available, true);
  const dropdown = response.result.fields.find(field => field.kind === 'combobox');
  assert.equal(dropdown.available, false); assert.equal(dropdown.manualOnly, true);
  assert.doesNotMatch(JSON.stringify(result), /private page internals/);
});

test('a real dropdown selection mutation fails closed with its own error and is never silently restored', async () => {
  const degree = combo(); const open = degree.input.handlers.click;
  degree.input.handlers.click = () => { open(); degree.model.select("Bachelor's Degree"); };
  fixture([new Input({name: 'first_name'}), degree.container]);
  const result = await inspect();
  assert.equal(result.error.code, 'dropdown_changed');
  assert.equal(degree.container.querySelectorAll('.select__single-value')[0].textContent, "Bachelor's Degree");
  assert.throws(() => parseATSInspectionResult([{frameId: 0, documentId: 'doc', result}]), /selection changed while reading/);
});

test('popup parser distinguishes missing Chrome result from missing document binding and rejects a changed URL', () => {
  assert.throws(() => parseATSInspectionResult([{frameId: 0, documentId: 'doc'}]), /missing_inspection_result/);
  assert.throws(() => parseATSInspectionResult([{frameId: 0, result: {provider: 'Greenhouse', url: greenhouse, fields: []}}]), /could not bind/);
  assert.throws(() => parseATSInspectionResult([{frameId: 1, documentId: 'child', result: {}}]), /one bound application document/);
  assert.throws(() => parseATSInspectionResult([{frameId: 0, documentId: 'doc', result: {provider: 'Greenhouse', url: greenhouse, fields: []}}], greenhouse + '#changed'), /URL changed/);
});

test('real GH Attach-only file label resolves solely the exact resume caption in its own single-file wrapper', async () => {
  const resume = new Input({id: 'resume', type: 'file', label: 'Attach', accept: '.pdf', visible: false});
  const wrapper = new Element('DIV', {classes: ['file-upload']});
  const caption = new Element('DIV', {id: 'upload-label-resume', classes: ['upload-label'], text: 'Resume/CV*'});
  wrapper.append(caption, resume);
  const coverWrapper = new Element('DIV', {classes: ['file-upload']});
  const cover = new Input({id: 'cover_letter', type: 'file', label: 'Attach', visible: false});
  coverWrapper.append(new Element('DIV', {id: 'upload-label-cover_letter', text: 'Cover letter'}), cover);
  fixture([new Input({name: 'first_name'}), wrapper, coverWrapper]);
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  const response = parseATSInspectionResult(JSON.parse(JSON.stringify([{frameId: 0, documentId: 'doc', result: await injected({action: 'inspect'})}])));
  assert.deepEqual(response.result.resumeTarget, {key: 'id:resume', label: 'Resume/CV*', accept: '.pdf', multiple: false, occupied: false});
  const bytes = new TextEncoder().encode('%PDF-1.7\nfictional');
  const sha256 = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const payload = {action: 'attach', expectedUrl: greenhouse, targetKey: 'id:resume', targetLabel: 'Resume/CV*', confirmed: true,
    file: {name: 'fictional.pdf', base64: Buffer.from(bytes).toString('base64'), sha256, size_bytes: bytes.length}};
  caption.textContent = 'Transcript';
  await assert.rejects(injected(payload), /upload target/);
  assert.equal(resume.files.length, 0);
  caption.textContent = 'Resume/CV*';
  const attached = await injected(payload);
  assert.equal(attached.selected, true); assert.equal(cover.files.length, 0);
});

test('narrative questions are draftable while legal qualifications and missing numbers remain manual facts', async () => {
  const intro = new TextArea({name: 'intro', label: 'Tell us about yourself'});
  const motive = new TextArea({name: 'motive', label: 'Why do you want this role?'});
  const project = new TextArea({name: 'project', label: 'Describe a relevant project'});
  const visa = new TextArea({name: 'visa', label: 'Why do you require visa sponsorship?'});
  const numeric = new Input({name: 'salary', type: 'number', label: 'Expected stipend'});
  fixture([new Input({name: 'first_name'}), intro, motive, project, visa, numeric]);
  const review = await inspect();
  for (const name of ['intro', 'motive', 'project']) assert.equal(review.fields.find(field => field.key === 'name:' + name).draftable, true);
  assert.equal(review.fields.find(field => field.key === 'name:visa').manualOnly, true);
  assert.equal(review.fields.find(field => field.key === 'name:visa').draftable, false);
  assert.equal(review.fields.find(field => field.key === 'name:salary').kind, 'number');
});

test('only the exact ordinary Lever Additional information label receives the introduction draft intent', async () => {
  const extra = new TextArea({name: 'comments', label: 'Additional information✱'});
  const unrelated = new TextArea({name: 'additional', label: 'Additional information about work status'});
  const dependent = new TextArea({name: 'other', label: 'If you selected “Other” in the last question, please specify below:'});
  fixture([new Input({name: 'name'}), extra, unrelated, dependent], {url: lever});
  const review = await inspect();
  assert.equal(review.fields.find(field => field.key === 'name:comments').draftable, true);
  assert.equal(review.fields.find(field => field.key === 'name:additional').manualOnly, true);
  assert.equal(review.fields.find(field => field.key === 'name:other').manualOnly, true);
  assert.equal(extra.value, '');
  fixture([new Input({name: 'first_name'}), new TextArea({name: 'comments', label: 'Additional information'})]);
  assert.equal((await inspect()).fields.find(field => field.key === 'name:comments').draftable, false);
});

test('real GH virtual cover-letter target opens only on explicit Fill and preserves an attached file or changed button', async () => {
  const caption = new Element('DIV', {id: 'upload-label-cover_letter', text: 'Cover Letter'});
  const file = new Input({id: 'cover_letter', type: 'file'});
  const button = new Element('BUTTON', {text: 'Enter manually', attributes: {type: 'button', 'data-testid': 'cover_letter-text'}});
  const wrapper = new Element('DIV', {classes: ['file-upload__wrapper']}); wrapper.append(file, button);
  const group = new Element('DIV', {classes: ['file-upload'], attributes: {role: 'group', 'aria-labelledby': 'upload-label-cover_letter'}}); group.append(caption, wrapper);
  const bound = fixture([new Input({name: 'first_name'}), group]);
  let clicks = 0;
  button.handlers.click = () => { clicks++; const textarea = new TextArea({id: 'cover_letter_text', label: 'Enter manually'}); textarea.form = bound.scope; group.append(textarea); };
  const draft = (await inspect()).fields.find(field => field.key === 'gh:cover_letter_text');
  assert.equal(draft.label, 'Cover letter'); assert.equal(draft.draftable, true); assert.equal(clicks, 0);
  file.files = [{name: 'existing-cover.pdf'}];
  let result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(draft, 'Reviewed cover letter')]});
  assert.deepEqual(result.skipped, [draft.id]); assert.equal(clicks, 0);
  file.files = [];
  button.attributes.type = 'submit';
  await assert.rejects(interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(draft, 'Reviewed cover letter')]}), /Invalid reviewed/);
  assert.equal(clicks, 0); button.attributes.type = 'button';
  result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(draft, 'Reviewed cover letter')]});
  assert.deepEqual(result.filled, [draft.id]); assert.equal(clicks, 1);
  const expanded = (await inspect()).fields.find(field => field.key === 'gh:cover_letter_text');
  assert.equal(expanded.label, 'Cover letter'); assert.equal(expanded.occupied, true);
  result = await interactWithATSPage({action: 'fill', expectedUrl: greenhouse, approved: [approval(expanded, 'Must not overwrite')]});
  assert.deepEqual(result.skipped, [draft.id]); assert.equal(clicks, 1);
});

test('actual cover-letter popup preparation survives an omitted null evidence binding without accepting changed fact keys', async () => {
  const injected = (0, eval)(`(${rawInteractWithATSPage.toString()})`);
  for (const initiallyExpanded of [false, true]) {
    const first = new Input({id: 'first_name', label: 'First Name*'});
    const caption = new Element('DIV', {id: 'upload-label-cover_letter', text: 'Cover Letter'});
    const file = new Input({id: 'cover_letter', type: 'file'});
    const button = new Element('BUTTON', {text: 'Enter manually', attributes: {type: 'button', 'data-testid': 'cover_letter-text'}});
    const wrapper = new Element('DIV', {classes: ['file-upload__wrapper']}); wrapper.append(file, button);
    const group = new Element('DIV', {classes: ['file-upload'], attributes: {role: 'group', 'aria-labelledby': 'upload-label-cover_letter'}});
    group.append(caption, wrapper);
    let textarea = initiallyExpanded ? new TextArea({id: 'cover_letter_text', label: 'Enter manually'}) : null;
    if (textarea) group.append(textarea);
    const bound = fixture([first, group]);
    button.handlers.click = () => { textarea = new TextArea({id: 'cover_letter_text', label: 'Enter manually'}); textarea.form = bound.scope; group.append(textarea); };
    const review = JSON.parse(JSON.stringify(await injected({action: 'inspect'})));
    const cover = review.fields.find(field => field.key === 'gh:cover_letter_text');
    assert.equal(cover.id, 'field:lflj1e'); assert.equal(cover.evidenceKey, null);
    const profile = {values: {given_name: 'Avery'}};
    const editors = new Map(review.fields.map(field => [field.id, {field, input: {value: autofillSuggestion(field, profile).value}, factKey: autofillSuggestion(field, profile).key}]));
    const editor = editors.get(cover.id);
    const patch = preparationPatch({field_id: cover.id, value: 'Reviewed evidence-based cover letter.', source: 'ai_draft', fact_key: null,
      citations: [{source: 'resume', source_id: 'fictional-resume', quote: 'Fictional software project.'}]}, editor, profile);
    assert.ok(patch); editor.input.value = patch.value; editor.factKey = patch.factKey;
    const approved = approvedAutofillAnswers(editors);
    // A missing property carries no fact binding, just like explicit null. Do
    // not rely on one API transport preserving an optional nested null member.
    const transported = JSON.parse(JSON.stringify(approved, (_key, value) => value === null ? undefined : value));
    assert.equal(Object.hasOwn(transported.find(item => item.id === cover.id), 'evidenceKey'), false);
    for (const evidenceKey of ['summary', '', false, {}]) {
      const forged = transported.map(item => item.id === cover.id ? {...item, evidenceKey, factKey: 'summary'} : item);
      const rejected = await injected({action: 'fill', expectedUrl: greenhouse, approved: forged});
      assert.equal(rejected.error.mismatch, 'evidence_key'); assert.equal(rejected.mutation_started, false); assert.equal(first.value, '');
      assert.equal(rejected.error.expected_evidence_type, 'null');
      assert.equal(rejected.error.received_evidence_type, typeof evidenceKey);
    }
    const knownBindingMissing = transported.map(item => item.id === 'first_name' ? {...item, evidenceKey: undefined} : item);
    const knownRejected = await injected({action: 'fill', expectedUrl: greenhouse, approved: knownBindingMissing});
    assert.equal(knownRejected.error.field_id, 'first_name'); assert.equal(knownRejected.error.mismatch, 'evidence_key'); assert.equal(first.value, '');
    caption.textContent = 'Consent';
    const changedTarget = await injected({action: 'fill', expectedUrl: greenhouse, approved: transported});
    assert.equal(changedTarget.mutation_started, false); assert.equal(changedTarget.error.field_id, cover.id);
    assert.equal(changedTarget.error.mismatch, 'missing_field'); assert.equal(first.value, '');
    caption.textContent = 'Cover Letter';
    const result = parseATSFillResult([{documentId: 'doc', result: await injected({action: 'fill', expectedUrl: greenhouse, approved: transported})}], 'doc');
    assert.deepEqual(result.filled, ['first_name', cover.id]); assert.deepEqual(result.skipped, []);
    assert.equal(first.value, 'Avery'); assert.equal(textarea.value, patch.value); assert.equal(file.files.length, 0);
  }
});
