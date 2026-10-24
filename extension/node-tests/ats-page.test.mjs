// Actual exported/injected adapter against bounded DOM doubles. No browser/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {interactWithATSPage, matchATSSelectOption, parseATSInspectionResult} from '../ats-page.js';
import {autofillSuggestion} from '../popup-review.js';

const greenhouse = 'https://job-boards.greenhouse.io/acme/jobs/123?gh_jid=123';
const lever = 'https://jobs.lever.co/acme/abc-123/apply';
const ashby = 'https://jobs.ashbyhq.com/goventi/dec35151-7bee-45ae-b088-a04986145d93/application';
const all = node => node.children.flatMap(child => [child, ...all(child)]);
class Element {
  constructor(tagName = 'DIV', {id = '', classes = [], text = '', attributes = {}, ...rest} = {}) {
    Object.assign(this, {tagName, id, children: [], parentElement: null, textContent: text, attributes,
      visible: true, disabled: false, readOnly: false, isConnected: true, handlers: {}, events: []}, rest);
    this.classList = {contains: name => classes.includes(name)};
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
      form: null, files: [], accept: '', validity: {valid: true}}, rest);
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

test('verified degree facts normalize only to one existing explicit taxonomy option', () => {
  const options = ["Bachelor's Degree", "Master's Degree", 'Doctor of Philosophy (Ph.D.)'].map(label => ({value: label, label}));
  const field = {kind: 'combobox', evidenceKey: 'degree', options};
  for (const value of ['M.Tech.', 'Master of Technology', 'MSc', 'M.Eng.']) assert.equal(matchATSSelectOption(field, value), "Master's Degree");
  for (const value of ['B.Eng.', 'Bachelor of Science', 'BSc']) assert.equal(matchATSSelectOption(field, value), "Bachelor's Degree");
  assert.equal(matchATSSelectOption(field, 'Ph.D.'), 'Doctor of Philosophy (Ph.D.)');
  assert.equal(matchATSSelectOption(field, 'Studying M.Tech. at NUS'), '');
  assert.equal(matchATSSelectOption(field, 'M.Tech.; B.Eng.'), '');
  assert.equal(matchATSSelectOption({...field, options: [...options, {value: 'msc', label: 'Master of Science'}]}, 'M.Tech.'), '');
  assert.equal(matchATSSelectOption({...field, options: [...options, {value: 'msc', label: 'Master of Science'}]}, 'Master of Science'), 'msc');
  assert.equal(matchATSSelectOption({...field, evidenceKey: 'education'}, 'M.Tech.'), '');
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
  const injected = (0, eval)(`(${interactWithATSPage.toString()})`);
  const eu = 'https://job-boards.eu.greenhouse.io/straitsx/jobs/4942133101';
  fixture([new Input({name: 'first_name'})], {url: eu}); assert.equal((await injected({action: 'inspect'})).provider, 'Greenhouse');
  await assert.rejects(injected({action: 'fill', expectedUrl: eu + '#changed', approved: []}), /URL changed/);
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
  const injected = (0, eval)(`(${interactWithATSPage.toString()})`);
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

test('serialized reader runtime failures survive Chrome JSON results without private exception text or generic unsupported claims', async () => {
  fixture([new Input({name: 'first_name'})]);
  document.querySelectorAll = () => { throw new TypeError('private-contact@example.test must not be returned'); };
  const injected = (0, eval)(`(${interactWithATSPage.toString()})`);
  const result = await injected({action: 'inspect'});
  const results = JSON.parse(JSON.stringify([{frameId: 0, documentId: 'bound-doc', result}]));
  assert.deepEqual(results[0].result, {inspection_version: 1, ok: false, error: {code: 'reader_failed', stage: 'read_form_scope'}});
  assert.doesNotMatch(JSON.stringify(results), /private-contact/);
  assert.throws(() => parseATSInspectionResult(results), /reader_failed:read_form_scope/);
});

test('a transient unchanged dropdown read failure preserves usable identity fields and returns a safe manual reason', async () => {
  const degree = combo(); degree.input.handlers.click = () => { throw new TypeError('private page internals'); };
  fixture([new Input({name: 'first_name', label: 'First name'}), degree.container]);
  const injected = (0, eval)(`(${interactWithATSPage.toString()})`);
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
  const injected = (0, eval)(`(${interactWithATSPage.toString()})`);
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
