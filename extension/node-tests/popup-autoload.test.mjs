// Real popup module entrypoint with bounded browser/API doubles. No network or employer writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {capturePopupTarget, popupConnectionKey} from '../popup-autoload.js';

const gh = 'https://job-boards.greenhouse.io/acme/jobs/123';
const intern = 'https://www.internsg.com/job-apply/123';
const local = 'http://127.0.0.1:15523/jobs/11111111-2222-3333-4444-555555555555/apply-external';
const grant = id => ({site: 'http://127.0.0.1:15523', api: 'http://127.0.0.1:18523', token: 'jpx_fixture_' + id, userId: id, email: id + '@example.test'});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
let sequence = 0;

async function fixture({url = gh, connected = true, embeddedAccess = true, start = true} = {}) {
  const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
  const nodes = [], byId = new Map();
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.handlers = new Map(); this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this._value = ''; this._text = ''; this.scrollTop = 0; this.isConnected = true; this.attributes = {}; this.classes = new Set(); this.classList = {add: (...x) => x.forEach(v => this.classes.add(v)), remove: (...x) => x.forEach(v => this.classes.delete(v)), contains: x => this.classes.has(x), toggle: (x, on) => on ?? !this.classes.has(x) ? this.classes.add(x) : this.classes.delete(x)}; nodes.push(this); }
    set id(id) { this._id = id; byId.set(id, this); } get id() { return this._id || ''; }
    set value(value) { this._value = String(value); } get value() { return this._value; }
    set className(value) { this.classes = new Set(value.split(/\s+/)); } get className() { return [...this.classes].join(' '); }
    set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map(x => typeof x === 'string' ? x : x.textContent).join(''); }
    get childElementCount() { return this.children.filter(x => typeof x !== 'string').length; }
    append(...items) { for (const item of items) { if (item.parentElement) item.parentElement.children = item.parentElement.children.filter(x => x !== item); this.children.push(item); if (typeof item !== 'string') { item.parentElement = this; item.isConnected = true; } } }
    add(item) { this.append(item); }
    replaceChildren(...items) { for (const item of this.children) if (typeof item !== 'string') item.isConnected = false; this.children = []; this._text = ''; this.append(...items); }
    insertBefore(item, other) { if (item.parentElement) item.parentElement.children = item.parentElement.children.filter(x => x !== item); const i = this.children.indexOf(other); this.children.splice(i < 0 ? this.children.length : i, 0, item); item.parentElement = this; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    querySelector(selector) { return this.children.find(x => typeof x !== 'string' && x.tagName.toLowerCase() === selector) || null; }
    getBoundingClientRect() { return {top: 0}; }
    addEventListener(event, fn) { if (!this.handlers.has(event)) this.handlers.set(event, []); this.handlers.get(event).push(fn); }
    async emit(event = 'click') { if (this.disabled && event === 'click') return; for (const fn of this.handlers.get(event) || []) await fn({preventDefault() {}}); await settle(); }
  }
  class Input extends Element { constructor() { super('input'); } }
  for (const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) { const node = match[1] === 'input' ? new Input() : new Element(match[1]); node.id = match[2]; node.hidden = /\shidden(?:\s|>)/.test(match[0]); }
  byId.get('login').append(new Element('button'));
  byId.get('workspace-content').append(byId.get('ats-tools'), byId.get('original-tools'));
  const state = {url, documentId: 'document-1', saved: connected ? grant('A') : null, calls: [], requests: [], permissionRequests: 0, factsGate: null, prepareGate: null, prepareResponse: null, atsFields: null, richReady: false, inspectError: null, onQuery: null, onInspect: null, facts: {fingerprint: 'f'.repeat(64), values: {given_name: 'Avery', family_name: 'Ng', full_name: 'Avery Ng', contact_email: 'avery@example.test', school: 'National University of Singapore'}, sources: {}, resumes: [], resume: null}};
  let storageListener;
  globalThis.document = {getElementById: id => byId.get(id), createElement: tag => tag === 'input' ? new Input() : new Element(tag), createTextNode: value => String(value)};
  globalThis.HTMLInputElement = Input;
  globalThis.Option = class extends Element { constructor(label, value) { super('option'); this.textContent = label; this.value = value; } };
  globalThis.chrome = {
    runtime: {id: 'a'.repeat(32), sendMessage: async () => ({ok: true})},
    permissions: {contains: async () => embeddedAccess, request: async () => { state.permissionRequests++; return true; }, onAdded: {addListener() {}}, onRemoved: {addListener() {}}},
    storage: {onChanged: {addListener(fn) { storageListener = fn; }}, local: {setAccessLevel: async () => {}, get: async () => ({}), set: async () => {}, remove: async () => {}}, session: {setAccessLevel: async () => {}, get: async () => ({jobpilotSession: state.saved}), remove: async () => { state.saved = null; }}},
    tabs: {query: async () => { state.onQuery?.(); return [{id: 7, url: state.url}]; }},
    scripting: {executeScript: async request => {
      state.calls.push(request);
      const name = request.func.name, doc = state.documentId;
      if (name === 'popupDocumentBinding') return request.target.documentIds[0] === doc || request.target.documentIds[0] === 'parent-document' ? [{documentId: request.target.documentIds[0], result: {url: request.args[0]}}] : [];
      if (name === 'discoverApplication') return [{documentId: state.url === local ? 'parent-document' : doc, result: state.url === local ? {mode: 'embedded', parentUrl: local, url: intern} : {mode: 'direct', url: intern}}];
      if (name === 'matchApplicationFrame') return [{documentId: doc, result: {url: intern}}];
      if (name === 'interactWithPage') return [{documentId: doc, result: request.args[0] === 'inspect' ? {url: intern, title: 'Fictional job', fields: [{id: 'applicant_name', label: 'Name', maxLength: 200, occupied: false}]} : {filled: request.args[2].map(x => x.id), skipped: [], submitted: false}}];
      if (name === 'interactWithWidgets') return [{documentId: doc, result: {richReady: state.richReady, countries: [], countryState: null, countryReason: 'Complete countries manually.'}}];
      if (name !== 'interactWithATSPage') throw new Error('Unexpected injected function: ' + name);
      const action = request.args[0].action;
      if (action === 'inspect') {
        if (state.inspectError) throw new Error(state.inspectError);
        const result = [{documentId: doc, result: {url: state.url, provider: 'Greenhouse', fields: state.atsFields || [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false}, {id: 'custom:unknown', key: 'id:question', label: 'Ordinary unknown', kind: 'text', evidenceKey: null, needsMapping: true, available: true, occupied: false}], manualQuestions: ['Consent'], resumeTarget: null}}];
        state.onInspect?.(); return result;
      }
      if (action === 'fill') {
        if (state.fillError) throw new Error(state.fillError);
        if (state.fillMissing) return [{documentId: doc}];
        return [{documentId: doc, result: state.fillResponse || {filled: request.args[0].approved.map(x => x.id), skipped: [], submitted: false}}];
      }
      throw new Error('Unexpected write: ' + action);
    }},
  };
  globalThis.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    state.requests.push({url, method: options.method, body, authorization: options.headers.Authorization});
    if (url.endsWith('/browser-assistant/prepare-answers')) {
      assert.equal(options.method, 'POST');
      const gate = state.prepareGate; if (gate) await gate.promise;
      if (state.prepareError) throw new Error(state.prepareError);
      return {ok: true, status: 200, json: async () => structuredClone(state.prepareResponse || {status: 'partial', profile_fingerprint: body.profile_fingerprint, answers: [], omitted: body.fields.map(field => ({field_id: field.id, reason: 'No saved fact'})), execution_mode: 'not_needed', reused: false})};
    }
    assert.equal(options.method, 'GET', 'Only the bounded preparation endpoint may POST automatically');
    const owner = options.headers.Authorization.split('jpx_fixture_')[1];
    if (url.endsWith('/auth/extension/session')) { if (state.authGate) await state.authGate.promise; return {ok: true, status: 200, json: async () => ({user_id: owner})}; }
    assert.ok(url.endsWith('/browser-assistant/autofill-profile'), 'No model, parser or PDF bytes endpoint');
    const gate = state.factsGate; if (gate) await gate.promise;
    return {ok: true, status: 200, json: async () => structuredClone(state.facts)};
  };
  const launch = () => import('../popup.js?autoload=' + (++sequence));
  const loaded = start ? launch() : null;
  const connect = async (id = 'B') => { const oldValue = state.saved; state.saved = grant(id); storageListener({jobpilotSession: {oldValue, newValue: state.saved}}, 'session'); await settle(); };
  return {state, get: id => byId.get(id), loaded, launch, connect, async duplicate() { storageListener({jobpilotSession: {newValue: {...state.saved}}}, 'session'); await settle(); }};
}

test('strict canonical routes are the automatic injection boundary', () => {
  const current = grant('A');
  for (const url of ['https://job-boards.greenhouse.io/', gh + '#apply', gh + '?tracking=1', gh.replace('https:', 'http:'), gh.replace('greenhouse.io', 'greenhouse.io.evil.test'), local.replace(':15523', ':5173'), 'https://chatgpt.com/canvas']) assert.equal(capturePopupTarget({id: 7, url}, current), null, url);
  for (const url of [gh, gh + '?gh_jid=123', intern, local]) assert.ok(capturePopupTarget({id: 7, url}, current), url);
  assert.equal(popupConnectionKey({...current, token: 'not-extension'}), '');
});

test('real popup loads saved facts immediately and only shows unfinished pending text after the batch returns no verified answer', async () => {
  const f = await fixture(); await f.loaded;
  await settle();
  assert.equal(f.get('ats-first_name').value, 'Avery');
  assert.equal(f.get('ats-fields').readyGroup.open, true, 'Loaded answers are visible without opening a disclosure');
  assert.equal(f.get('ats-first_name').parentElement.parentElement, f.get('ats-fields').readyGroup.readyBody,
    'Saved rows retain an inner layout container after grouping');
  assert.equal(f.get('ats-custom:unknown').value, 'Your ordinary unknown');
  assert.match(f.get('source-ats-custom:unknown').textContent, /AI did not return a verified answer/);
  assert.doesNotMatch(f.get('source-ats-custom:unknown').textContent, /Profile/);
  assert.equal(f.get('ats-inspect').hidden, true);
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'inspect').length, 1);
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 0);
  assert.equal(f.state.requests.filter(x => x.url.endsWith('autofill-profile')).length, 1);
  assert.equal(f.state.permissionRequests, 0);
  await f.duplicate();
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'inspect').length, 1);
  await f.get('ats-fill').emit();
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 1);
  assert.equal(f.state.calls.find(x => x.args?.[0]?.action === 'fill').args[0].approved[0].value, 'Avery');
});

test('only model-confirmed missing links get pending text; current questions and narrative answers share one batch', async () => {
  const f = await fixture({start: false});
  const field = (id, key, label, extra = {}) => ({id, key: 'id:' + id, label, kind: 'text', evidenceKey: key,
    available: true, occupied: false, maxLength: 1000, ...extra});
  f.state.atsFields = [field('first_name', 'given_name', 'First name'), field('link', 'linkedin', 'LinkedIn URL'),
    field('code', 'github', 'GitHub URL'), field('site', 'portfolio', 'Portfolio URL'),
    field('cover', null, 'Cover letter', {draftable: true, needsMapping: true})];
  f.state.prepareGate = deferred();
  f.state.prepareResponse = {status: 'ready', profile_fingerprint: f.state.facts.fingerprint,
    answers: ['link', 'code', 'site'].map(field_id => ({field_id, value: 'To be confirmed', source: 'pending_confirmation', fact_key: null, citations: []})).concat(
      [{field_id: 'cover', value: 'I built a small Python service.', source: 'ai_draft', fact_key: null,
      citations: [{source: 'profile', source_id: 'profile:experience', quote: 'Built a small Python service.'}]}]),
    omitted: [], execution_mode: 'mock', reused: false};
  await f.launch();
  assert.equal(f.get('ats-first_name').value, 'Avery');
  assert.equal(f.get('ats-link').value, '');
  assert.equal(f.get('ats-code').value, '');
  assert.equal(f.get('ats-site').value, '');
  assert.match(f.get('source-ats-link').textContent, /AI is checking/);
  assert.match(f.get('ats-counts').textContent, /1 ready/);
  assert.deepEqual(f.state.requests.find(call => call.url.endsWith('/prepare-answers')).body.fields.map(item => item.id), ['link', 'code', 'site', 'cover']);
  f.get('ats-link').value = 'https://www.linkedin.com/in/avery'; await f.get('ats-link').emit('input');
  assert.match(f.get('source-ats-link').textContent, /Your entry for this application only/);
  f.state.prepareGate.resolve(); await settle();
  assert.equal(f.get('ats-cover').value, 'I built a small Python service.');
  assert.equal(f.get('ats-link').value, 'https://www.linkedin.com/in/avery');
  assert.equal(f.get('ats-code').value, 'Your GitHub URL');
  assert.match(f.get('source-ats-code').textContent, /AI found no supporting information/);
  assert.match(f.get('source-ats-cover').textContent, /AI answer/);
  await f.get('ats-fill').emit();
  const approved = f.state.calls.find(call => call.args?.[0]?.action === 'fill').args[0].approved;
  assert.equal(approved.find(item => item.id === 'code').value, 'Your GitHub URL');
  assert.equal(Object.hasOwn(approved.find(item => item.id === 'code'), 'factKey'), false);
  assert.equal(approved.find(item => item.id === 'link').value, 'https://www.linkedin.com/in/avery');
  assert.ok(f.state.requests.every(call => call.method === 'GET' || call.url.endsWith('/prepare-answers')), 'No template or one-off edit is saved globally');
});

test('AI answers actual non-narrative Lever questions from evidence and only explicit missing questions receive pending text', async () => {
  const f = await fixture({url: 'https://jobs.lever.co/acme/abc-123/apply', start: false});
  const descriptor = (id, label, evidenceKey, extra = {}) => ({id, label, evidenceKey, key: 'id:' + id,
    kind: 'text', available: true, occupied: false, maxLength: 1000, ...extra});
  f.state.facts.values.current_city = 'Singapore';
  f.state.atsFields = [descriptor('first_name', 'First name', 'given_name'),
    descriptor('location', 'Current location', 'current_city', {requiresWebsiteChoice: true}),
    descriptor('company', 'Current company', 'current_company'),
    descriptor('combined', 'Github / Portfolio URL', null, {needsMapping: true}),
    descriptor('institution', 'Institution attended', null, {needsMapping: true}),
    descriptor('intro', 'Relevant technical strengths', null, {draftable: false, needsMapping: true}),
    descriptor('legal_question', 'Privacy consent', null, {manualOnly: true})];
  f.state.prepareGate = deferred();
  f.state.prepareResponse = {status: 'partial', profile_fingerprint: f.state.facts.fingerprint, answers: [
    {field_id: 'company', value: 'To be confirmed', source: 'pending_confirmation', fact_key: null, citations: []},
    {field_id: 'combined', value: 'To be confirmed', source: 'pending_confirmation', fact_key: null, citations: []},
    {field_id: 'institution', value: 'National University of Singapore', source: 'saved', fact_key: 'school', citations: []},
    {field_id: 'intro', value: 'I built a small Python service.', source: 'ai_draft', fact_key: null,
      citations: [{source: 'profile', source_id: 'profile:experience', quote: 'Built a small Python service.'}]}],
    omitted: [], analyzed_field_ids: ['company', 'combined', 'institution', 'intro'], execution_mode: 'mock', reused: false};
  await f.launch();
  assert.equal(f.get('ats-location').value, 'Singapore');
  assert.match(f.get('source-ats-location').textContent, /Choose the suggested location on the website/);
  assert.equal(f.get('ats-company').value, '');
  assert.equal(f.get('ats-combined').value, '');
  assert.equal(f.get('ats-institution').value, '');
  assert.equal(f.get('ats-intro').value, '');
  assert.equal(f.get('ats-legal_question'), undefined);
  assert.match(f.get('ats-counts').textContent, /2 ready · 4 preparing/);
  const request = f.state.requests.find(call => call.url.endsWith('/prepare-answers'));
  assert.deepEqual(request.body.fields.map(field => field.id), ['company', 'combined', 'institution', 'intro']);
  f.get('ats-company').value = 'My own company answer'; await f.get('ats-company').emit('input');
  f.state.prepareGate.resolve(); await settle();
  assert.equal(f.get('ats-institution').value, 'National University of Singapore');
  assert.equal(f.get('ats-intro').value, 'I built a small Python service.');
  assert.equal(f.get('ats-company').value, 'My own company answer');
  assert.equal(f.get('ats-combined').value, 'Your GitHub or portfolio URL');
  assert.match(f.get('ats-counts').textContent, /5 ready · 1 templates to replace/);
  assert.equal(f.state.calls.filter(call => call.args?.[0]?.action === 'fill').length, 0);
  f.state.fillResponse = {filled: ['first_name', 'location', 'company', 'combined', 'institution', 'intro'], skipped: [], reasons: {},
    submitted: false, needsWebsiteChoice: ['location']};
  await f.get('ats-fill').emit();
  const approved = f.state.calls.find(call => call.args?.[0]?.action === 'fill').args[0].approved;
  assert.equal(approved.find(field => field.id === 'combined').value, 'Your GitHub or portfolio URL');
  assert.equal(approved.find(field => field.id === 'institution').evidenceKey, null, 'Mapped fact does not alter the original form contract');
  assert.equal(approved.find(field => field.id === 'institution').factKey, 'school');
  assert.match(f.get('ats-result').textContent, /Filled 6; skipped 0.*1 website choice still needed.*Nothing was submitted/);
  assert.equal(f.get('ats-fill').textContent, 'Fill finished');
  assert.ok(f.state.requests.every(call => call.method === 'GET' || call.url.endsWith('/prepare-answers')));
});

test('actual text GPA and year questions receive pending values after missing evidence or failure; native number/date remain empty', async () => {
  for (const unavailable of [false, true]) {
    const f = await fixture({url: 'https://jobs.lever.co/acme/abc-123/apply', start: false});
    const field = (id, label, kind = 'text', extra = {}) => ({id, label, kind, key: 'id:' + id, evidenceKey: null,
      available: true, occupied: false, maxLength: 100, ...extra});
    f.state.atsFields = [field('first_name', 'First name', 'text', {evidenceKey: 'given_name'}), field('gpa', 'GPA'),
      field('year', 'Year of study'), field('numeric', 'GPA', 'number'), field('date', 'Internship start date', 'date'),
      field('legal_question', 'Privacy consent', 'text', {manualOnly: true})];
    f.state.prepareResponse = {status: unavailable ? 'unavailable' : 'partial', profile_fingerprint: f.state.facts.fingerprint,
      execution_mode: unavailable ? 'unavailable' : 'mock', error_code: unavailable ? 'answer_preparation_timeout' : null,
      answers: unavailable ? [] : ['gpa', 'year'].map(field_id => ({field_id, value: 'To be confirmed', source: 'pending_confirmation', fact_key: null, citations: []})),
      omitted: ['numeric', 'date'].map(field_id => ({field_id, reason: 'model_confirmed_missing'})), reused: false};
    await f.launch(); await settle();
    assert.equal(f.get('ats-gpa').value, 'To be confirmed'); assert.equal(f.get('ats-year').value, 'To be confirmed');
    assert.equal(f.get('ats-numeric').value, ''); assert.equal(f.get('ats-date').value, '');
    assert.equal(f.get('ats-legal_question'), undefined);
    assert.match(f.get('source-ats-gpa').textContent, unavailable ? /AI did not finish/ : /AI found no supporting information/);
    assert.match(f.get('ats-counts').textContent, /1 ready · 2 templates to replace/);
    await f.get('ats-fill').emit();
    const approved = f.state.calls.find(call => call.args?.[0]?.action === 'fill').args[0].approved;
    assert.deepEqual(approved.map(item => item.id), ['first_name', 'gpa', 'year']);
    assert.ok(approved.filter(item => item.id !== 'first_name').every(item => item.value === 'To be confirmed' && !Object.hasOwn(item, 'factKey')));
    assert.equal(f.state.requests.filter(call => call.url.endsWith('/prepare-answers')).length, 1);
  }
});

test('more than forty current questions use one capped batch and mark overflow text unanalysed without losing edits or filling typed controls', async () => {
  const f = await fixture({start: false}); const gate = deferred();
  const field = (id, label, kind = 'text', extra = {}) => ({id, label, kind, key: 'id:' + id, evidenceKey: null,
    available: true, occupied: false, maxLength: 300, ...extra});
  f.state.atsFields = [field('first_name', 'First name', 'text', {evidenceKey: 'given_name'}),
    ...Array.from({length: 45}, (_, i) => field('question_' + i, 'Question ' + i)),
    field('native_number', 'GPA', 'number'), field('native_date', 'Start date', 'date'),
    field('legal_question', 'Privacy consent', 'text', {manualOnly: true})];
  f.state.prepareGate = gate;
  const ids = Array.from({length: 40}, (_, i) => 'question_' + i);
  f.state.prepareResponse = {status: 'partial', profile_fingerprint: f.state.facts.fingerprint, execution_mode: 'mock',
    answers: ids.map(field_id => ({field_id, value: 'To be confirmed', source: 'pending_confirmation', fact_key: null, citations: []})),
    analyzed_field_ids: ids, omitted: [], reused: false};
  await f.launch();
  assert.match(f.get('preparation-status').textContent, /Only the first 40 questions are sent for analysis/);
  assert.equal(f.get('ats-question_40').value, '', 'Overflow is not prefilled before preparation settles');
  f.get('ats-question_44').value = 'My own overflow answer'; await f.get('ats-question_44').emit('input');
  await f.get('ats-fill').emit();
  assert.equal(f.state.calls.filter(call => call.args?.[0]?.action === 'fill').length, 0);
  gate.resolve(); await settle();
  assert.equal(f.get('ats-question_40').value, 'Your question 40');
  assert.match(f.get('source-ats-question_40').textContent, /Not analyzed:.*beyond the first 40/);
  assert.doesNotMatch(f.get('source-ats-question_40').textContent, /AI found no supporting/);
  assert.equal(f.get('ats-question_44').value, 'My own overflow answer');
  assert.equal(f.get('ats-native_number').value, ''); assert.equal(f.get('ats-native_date').value, '');
  assert.equal(f.get('ats-legal_question'), undefined);
  const requests = f.state.requests.filter(call => call.url.endsWith('/prepare-answers'));
  assert.equal(requests.length, 1); assert.equal(requests[0].body.fields.length, 40);
  assert.deepEqual(requests[0].body.fields.map(field => field.id), ids);
  const calls = f.state.calls.filter(call => call.args?.[0]?.action === 'fill');
  assert.equal(calls.length, 1);
  const approved = calls[0].args[0].approved;
  assert.equal(approved.length, 46);
  assert.equal(approved.find(item => item.id === 'question_40').value, 'Your question 40');
  assert.equal(approved.find(item => item.id === 'question_44').value, 'My own overflow answer');
  assert.equal(approved.some(item => ['native_number', 'native_date', 'legal_question'].includes(item.id)), false);
});

test('malformed website-choice or correction reports are uncertain after a write and never cause an automatic retry', async () => {
  for (const key of ['needsWebsiteChoice', 'needsCorrection']) {
  for (const invalid of [['unapproved'], ['first_name', 'first_name'], 'first_name', [1], null]) {
    const f = await fixture({start: false});
    f.state.atsFields = [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false}];
    f.state.fillResponse = {filled: ['first_name'], skipped: [], reasons: {}, submitted: false, [key]: invalid};
    await f.launch(); await f.get('ats-fill').emit();
    assert.match(f.get('status').textContent, /Could not verify filling.*Check the original page/);
    assert.equal(f.get('ats-fill').disabled, true);
    assert.equal(f.state.calls.filter(call => call.args?.[0]?.action === 'fill').length, 1);
    assert.doesNotMatch(f.get('status').textContent, /Nothing was filled/);
  }
  const f = await fixture({start: false});
  f.state.atsFields = [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false}];
  f.state.fillResponse = {filled: [], skipped: ['first_name'], reasons: {first_name: 'Already answered'}, submitted: false, [key]: ['first_name']};
  await f.launch(); await f.get('ats-fill').emit();
  assert.match(f.get('status').textContent, /Could not verify filling/);
  }
});

test('direct InternSG and already granted embedded InternSG load automatically without requesting permission', async () => {
  for (const url of [intern, local]) {
    const f = await fixture({url}); await f.loaded;
    assert.equal(f.get('edit-applicant_name').value, 'Avery Ng');
    assert.equal(f.get('inspect').hidden, true);
    assert.equal(f.state.permissionRequests, 0);
    assert.equal(f.state.calls.filter(x => x.func.name === 'interactWithPage' && x.args[0] === 'fill').length, 0);
    assert.ok(f.state.calls.some(x => x.func.name === 'interactWithPage' && x.target.documentIds[0] === 'document-1'));
  }
});

test('unsupported routes and missing embedded permission do not inject or request facts/access', async () => {
  for (const options of [{url: 'https://chatgpt.com/canvas'}, {url: gh + '#apply'}, {url: local, embeddedAccess: false}]) {
    const f = await fixture(options); await f.loaded;
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.requests.filter(x => x.url.endsWith('autofill-profile')).length, 0);
    assert.equal(f.state.permissionRequests, 0);
    assert.equal(f.get('ats-fill').disabled, true);
    if (options.embeddedAccess === false) assert.equal(f.get('inspect').hidden, false);
  }
});

test('one read failure offers Refresh; recovery retries once and remains free', async () => {
  const f = await fixture({start: false}); f.state.inspectError = 'Not ready'; await f.launch();
  assert.equal(f.get('ats-inspect').hidden, false);
  assert.equal(f.get('ats-actions').hidden, false, 'Recovery remains visible even when inspection produced no fields');
  assert.equal(f.get('review-actions').hidden, false, 'A visible recovery button must not have a hidden footer');
  assert.equal(f.state.calls.length, 1);
  f.state.inspectError = null; await f.get('ats-inspect').emit();
  assert.equal(f.get('ats-first_name').value, 'Avery');
  assert.equal(f.get('ats-inspect').hidden, true);
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'inspect').length, 2);
});

test('same URL new document during facts load discards preview and blocks Fill', async () => {
  const f = await fixture({start: false}); const gate = deferred(); f.state.factsGate = gate;
  const loading = f.launch(); await settle();
  assert.ok(f.state.requests.some(x => x.url.endsWith('autofill-profile')));
  f.state.documentId = 'new-document'; gate.resolve(); await loading;
  assert.equal(f.get('ats-fields').childElementCount, 0);
  assert.equal(f.get('ats-fill').disabled, true);
  assert.equal(f.get('ats-inspect').hidden, false);
});

test('changed saved profile after preview reveals free recovery and writes nothing', async () => {
  const f = await fixture(); await f.loaded;
  f.state.facts.fingerprint = 'changed-profile';
  await f.get('ats-fill').emit();
  assert.equal(f.get('ats-fields').childElementCount, 0);
  assert.equal(f.get('ats-inspect').hidden, false);
  assert.equal(f.get('ats-actions').hidden, false, 'Discarding stale answers must preserve the recovery action');
  assert.equal(f.get('review-actions').hidden, false);
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 0);
});

test('active-tab navigation during facts load never publishes a stale preview or retargets injection', async () => {
  const f = await fixture({start: false}); const gate = deferred(); f.state.factsGate = gate;
  const loading = f.launch(); await settle(); f.state.url = 'https://chatgpt.com/canvas'; gate.resolve(); await loading;
  assert.equal(f.get('ats-fields').childElementCount, 0);
  assert.equal(f.get('ats-fill').disabled, true);
  assert.ok(f.state.calls.every(x => x.target.tabId === 7));
  assert.equal(f.state.calls.filter(x => x.func.name === 'popupDocumentBinding').length, 0);
});

test('new account waits for old busy load, old facts cannot win, duplicate event does not lose new autoload', async () => {
  const f = await fixture({start: false}); const gate = deferred(); f.state.factsGate = gate;
  const loading = f.launch(); await settle();
  await f.connect('B'); await f.duplicate();
  f.state.factsGate = null; f.state.facts.values.given_name = 'Briar'; gate.resolve(); await loading; await settle();
  assert.equal(f.get('account').textContent, 'B@example.test');
  assert.equal(f.get('ats-first_name').value, 'Briar');
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'inspect').length, 2);
  assert.equal(f.state.requests.filter(x => x.url.endsWith('autofill-profile')).length, 2);
  assert.equal(f.get('ats-inspect').hidden, true);
});

const narrativeFields = () => [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false},
  {id: 'question_intro', key: 'id:intro', label: 'Introduce yourself', kind: 'text', evidenceKey: null, needsMapping: true, draftable: true, maxLength: 500, available: true, occupied: false}];
const prepared = (id = 'question_intro', rest = {}) => ({status: 'ready', profile_fingerprint: 'f'.repeat(64), answers: [{field_id: id, source: 'ai_draft', fact_key: null,
  value: 'I built a small Python service.', citations: [{source: 'profile', source_id: 'profile:experience', quote: 'Built a small Python service.'}]}], omitted: [], execution_mode: 'live', reused: true, ...rest});

test('saved facts render and Fill is enabled before AI completes; one cached draft joins the same editable preview', async () => {
  const f = await fixture({start: false}); const gate = deferred(); f.state.prepareGate = gate; f.state.atsFields = narrativeFields(); f.state.prepareResponse = prepared();
  await f.launch(); await settle();
  assert.equal(f.get('ats-first_name').value, 'Avery'); assert.equal(f.get('ats-fill').disabled, false);
  assert.equal(f.get('ats-question_intro').value, ''); assert.match(f.get('preparation-status').textContent, /AI preparing/);
  assert.equal(f.state.requests.filter(x => x.url.endsWith('prepare-answers')).length, 1);
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 0);
  gate.resolve(); await settle();
  assert.equal(f.get('ats-question_intro').value, 'I built a small Python service.');
  assert.match(f.get('source-ats-question_intro').textContent, /AI answer/);
  assert.equal(f.get('ats-fields').readyGroup.open, true);
  await f.get('ats-fill').emit();
  assert.deepEqual(f.state.calls.find(x => x.args?.[0]?.action === 'fill').args[0].approved.map(x => x.id), ['first_name', 'question_intro']);
});

test('preparation never replaces user edits, even when the user clears the answer again', async () => {
  const f = await fixture({start: false}); const gate = deferred(); f.state.prepareGate = gate; f.state.atsFields = narrativeFields(); f.state.prepareResponse = prepared();
  await f.launch(); await settle();
  f.get('ats-question_intro').value = 'My words'; await f.get('ats-question_intro').emit('input');
  f.get('ats-question_intro').value = ''; await f.get('ats-question_intro').emit('input');
  gate.resolve(); await settle();
  assert.equal(f.get('ats-question_intro').value, '');
});

test('early Fill waits for the already running batch and dispatches its grounded answer exactly once', async () => {
  const f = await fixture({start: false}); const gate = deferred(); f.state.prepareGate = gate; f.state.atsFields = narrativeFields(); f.state.prepareResponse = prepared();
  await f.launch(); await settle(); await f.get('ats-fill').emit();
  assert.equal(f.state.calls.filter(call => call.args?.[0]?.action === 'fill').length, 0);
  assert.equal(f.get('ats-question_intro').disabled, true);
  assert.equal(f.get('ats-fill').textContent, 'Preparing…');
  f.get('ats-first_name').value = 'Later programmatic edit'; await f.get('ats-first_name').emit('input');
  gate.resolve(); await settle();
  const fills = f.state.calls.filter(x => x.args?.[0]?.action === 'fill');
  assert.equal(fills.length, 1); assert.deepEqual(fills[0].args[0].approved.map(x => x.id), ['first_name', 'question_intro']);
  assert.equal(fills[0].args[0].approved[1].value, 'I built a small Python service.');
  assert.equal(fills[0].args[0].approved[0].value, 'Avery', 'The already-present answer stays bound to the original Fill click');
  assert.equal(f.get('ats-question_intro').value, 'I built a small Python service.');
  assert.equal(f.state.requests.filter(call => call.url.endsWith('/prepare-answers')).length, 1);
});

test('without a pending AI batch the Fill click still freezes answers before asynchronous session validation', async () => {
  const f = await fixture({start: false});
  f.state.atsFields = [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false}];
  await f.launch(); const gate = deferred(); f.state.authGate = gate;
  await f.get('ats-fill').emit();
  f.get('ats-first_name').value = 'Changed after approval'; await f.get('ats-first_name').emit('input');
  gate.resolve(); await settle();
  const calls = f.state.calls.filter(call => call.args?.[0]?.action === 'fill');
  assert.equal(calls.length, 1); assert.equal(calls[0].args[0].approved[0].value, 'Avery');
});

test('an early Fill uses clearly unfinished pending text after timeout, without retrying or claiming missing PDF evidence', async () => {
  const f = await fixture({start: false}); const gate = deferred();
  f.state.atsFields = narrativeFields(); f.state.prepareGate = gate; f.state.prepareError = 'Preparation timed out.';
  await f.launch(); await f.get('ats-fill').emit();
  assert.equal(f.state.calls.filter(call => call.args?.[0]?.action === 'fill').length, 0);
  gate.resolve(); await settle();
  const calls = f.state.calls.filter(call => call.args?.[0]?.action === 'fill');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0].approved.find(answer => answer.id === 'question_intro').value, 'Your brief introduction');
  assert.match(f.get('source-ats-question_intro').textContent, /AI did not finish/);
  assert.doesNotMatch(f.get('source-ats-question_intro').textContent, /AI found no supporting|AI answer ·/);
  assert.equal(f.state.requests.filter(call => call.url.endsWith('/prepare-answers')).length, 1);
});

test('completion of a generic warm-up cannot masquerade as analysis of the current question during early Fill', async () => {
  const f = await fixture({start: false}); const gate = deferred();
  f.state.atsFields = narrativeFields(); f.state.prepareGate = gate; f.state.prepareResponse = prepared('question_intro', {analyzed_field_ids: []});
  await f.launch(); await f.get('ats-fill').emit();
  gate.resolve(); await settle();
  const approved = f.state.calls.find(call => call.args?.[0]?.action === 'fill').args[0].approved;
  assert.equal(approved.find(answer => answer.id === 'question_intro').value, 'Your brief introduction');
  assert.match(f.get('source-ats-question_intro').textContent, /AI did not return a verified answer/);
  assert.doesNotMatch(f.get('source-ats-question_intro').textContent, /AI found no supporting|AI answer ·/);
  assert.equal(f.state.requests.filter(call => call.url.endsWith('/prepare-answers')).length, 1);
});

test('a profile change during an early Fill wait rejects the old answers before any website write', async () => {
  const f = await fixture({start: false}); const gate = deferred();
  f.state.atsFields = narrativeFields(); f.state.prepareGate = gate; f.state.prepareResponse = prepared();
  await f.launch(); await f.get('ats-fill').emit();
  f.state.facts.fingerprint = 'changed-during-wait'; gate.resolve(); await settle();
  assert.equal(f.state.calls.filter(call => call.args?.[0]?.action === 'fill').length, 0);
  assert.match(f.get('status').textContent, /saved answers changed/i);
  assert.equal(f.state.requests.filter(call => call.url.endsWith('/prepare-answers')).length, 1);
});

test('changed document or profile discards late drafts while saved preview remains available', async () => {
  for (const changed of ['document', 'profile']) {
    const f = await fixture({start: false}); const gate = deferred(); f.state.prepareGate = gate; f.state.atsFields = narrativeFields(); f.state.prepareResponse = prepared();
    await f.launch(); await settle();
    if (changed === 'document') f.state.documentId = 'new-document'; else f.state.facts.fingerprint = 'new-fingerprint';
    gate.resolve(); await settle();
    assert.equal(f.get('ats-question_intro').value, ''); assert.equal(f.get('ats-first_name').value, 'Avery');
    assert.equal(f.get('ats-inspect').hidden, false);
  }
});

test('direct and embedded InternSG share preparation for the empty rich introduction', async () => {
  for (const url of [intern, local]) {
    const f = await fixture({url, start: false}); const gate = deferred(); f.state.prepareGate = gate; f.state.richReady = true; f.state.prepareResponse = prepared('applicant_summary');
    await f.launch(); await settle();
    const call = f.state.requests.find(x => x.url.endsWith('prepare-answers'));
    assert.ok(call.body.fields.some(field => field.id === 'applicant_summary' && field.draftable));
    assert.equal(call.body.page_url, intern); assert.equal(f.get('edit-applicant_name').value, 'Avery Ng');
    gate.resolve(); await settle();
    assert.equal(f.get('edit-applicant_summary').value, 'I built a small Python service.');
    assert.match(f.get('reason-applicant_summary').textContent, /AI answer/);
    assert.equal(f.state.calls.filter(x => x.func.name === 'interactWithPage' && x.args[0] === 'fill').length, 0);
  }
});

test('a late preparation cannot expose the old account or publish after active-tab navigation', async () => {
  for (const changed of ['account', 'tab']) {
    const f = await fixture({start: false}); const gate = deferred(); f.state.prepareGate = gate; f.state.atsFields = narrativeFields(); f.state.prepareResponse = prepared();
    await f.launch(); await settle();
    if (changed === 'account') {
      f.state.prepareGate = null; f.state.prepareResponse = {status: 'partial', profile_fingerprint: 'f'.repeat(64), answers: [], omitted: [], execution_mode: 'not_needed'};
      f.state.facts.values.given_name = 'Briar'; await f.connect('B');
    } else f.state.url = 'https://chatgpt.com/canvas';
    gate.resolve(); await settle();
    assert.equal(f.get('ats-question_intro').value, changed === 'account' ? 'Your brief introduction' : '');
    assert.doesNotMatch(f.get('ats-question_intro').value, /I built a small Python service/);
    if (changed === 'account') { assert.equal(f.get('ats-first_name').value, 'Briar'); assert.equal(f.get('account').textContent, 'B@example.test'); }
    assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 0);
  }
});

test('an unavailable preparation preserves ready facts and offers no automatic model retry', async () => {
  const f = await fixture({start: false}); f.state.atsFields = narrativeFields();
  f.state.prepareResponse = {status: 'unavailable', profile_fingerprint: 'f'.repeat(64), answers: [], omitted: [], execution_mode: 'unavailable'};
  await f.launch(); await settle();
  assert.equal(f.get('ats-first_name').value, 'Avery'); assert.equal(f.get('ats-fill').disabled, false);
  assert.match(f.get('preparation-status').textContent, /AI did not finish.*not an AI answer/);
  assert.match(f.get('source-ats-question_intro').textContent, /AI did not finish/);
  assert.equal(f.state.requests.filter(x => x.url.endsWith('prepare-answers')).length, 1);
});

test('Lever Additional information reaches the same preparation batch and one explicit popup Fill', async () => {
  const f = await fixture({url: 'https://jobs.lever.co/acme/abc-123/apply', start: false});
  f.state.atsFields = [{id: 'full_name', key: 'name:name', label: 'Full name', kind: 'text', evidenceKey: 'full_name', available: true, occupied: false},
    {id: 'additional', key: 'name:comments', label: 'Additional information', kind: 'text', evidenceKey: null, needsMapping: true, draftable: true, available: true, occupied: false, maxLength: 3000}];
  f.state.prepareResponse = prepared('additional');
  await f.launch(); await settle();
  const request = f.state.requests.find(item => item.url.endsWith('prepare-answers'));
  assert.equal(request.body.fields[0].label, 'Additional information'); assert.equal(request.body.fields[0].draftable, true);
  assert.equal(f.get('ats-additional').value, 'I built a small Python service.');
  assert.match(f.get('source-ats-additional').textContent, /AI answer/);
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 0);
  await f.get('ats-fill').emit();
  assert.deepEqual(f.state.calls.find(x => x.args?.[0]?.action === 'fill').args[0].approved.map(item => item.id), ['full_name', 'additional']);
});

test('a verified preflight rejection clears progress and offers explicit refresh without another write', async () => {
  const f = await fixture(); await f.loaded;
  f.state.fillResponse = {fill_version: 1, ok: false, mutation_started: false, error: {code: 'invalid_review', stage: 'validate_answers'}};
  await f.get('ats-fill').emit();
  assert.equal(f.get('ats-result').textContent, '');
  assert.match(f.get('status').textContent, /Nothing was filled/);
  assert.match(f.get('preparation-status').textContent, /Nothing was filled/);
  assert.equal(f.get('ats-inspect').hidden, false);
  assert.equal(f.get('ats-fill').disabled, true);
  assert.equal(f.get('ats-fill').textContent, 'Refresh form to continue');
  await f.get('ats-fill').emit();
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 1);
  f.state.fillResponse = null;
  await f.get('ats-inspect').emit();
  assert.equal(f.get('ats-fill').disabled, false);
  assert.equal(f.get('ats-fill').textContent, 'Fill application form');
  assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 1);
});

test('lost or interrupted fill responses never leave a progress label or retry automatically', async () => {
  for (const failure of ['missing', 'transport']) {
    const f = await fixture(); await f.loaded;
    if (failure === 'missing') f.state.fillMissing = true; else f.state.fillError = 'A private page exception';
    await f.get('ats-fill').emit();
    assert.equal(f.get('ats-result').textContent, '');
    assert.match(f.get('status').textContent, /Check the original page.*Refresh form/);
    assert.doesNotMatch(f.get('status').textContent, /private page exception|Nothing was filled/);
    assert.equal(f.get('ats-inspect').hidden, false);
    assert.equal(f.get('ats-fill').disabled, true);
    assert.equal(f.state.calls.filter(x => x.args?.[0]?.action === 'fill').length, 1);
  }
});

test('a missing LinkedIn copies explicit template text instead of inventing an applicant URL', async () => {
  const f = await fixture({start: false});
  f.state.atsFields = [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false},
    {id: 'linkedin', key: 'id:linkedin', label: 'LinkedIn Profile URL', kind: 'text', evidenceKey: 'linkedin', available: true, occupied: false}];
  await f.launch();
  await settle();
  assert.equal(f.get('ats-linkedin').placeholder, 'Your LinkedIn URL');
  assert.equal(f.get('ats-linkedin').value, 'Your LinkedIn URL');
  assert.match(f.get('source-ats-linkedin').textContent, /AI did not return a verified answer/);
  assert.doesNotMatch(f.get('ats-linkedin').value, /^https?:/);
  f.state.fillResponse = {filled: ['first_name', 'linkedin'], skipped: [], reasons: {}, submitted: false, needsCorrection: ['linkedin']};
  await f.get('ats-fill').emit();
  const approved = f.state.calls.find(x => x.args?.[0]?.action === 'fill').args[0].approved;
  assert.deepEqual(approved.map(x => x.id), ['first_name', 'linkedin']);
  assert.equal(approved[1].value, 'Your LinkedIn URL');
  assert.equal(Object.hasOwn(approved[1], 'factKey'), false);
  assert.match(f.get('ats-result').textContent, /Filled 2; skipped 0.*1 copied answer needs editing on the website.*Nothing was submitted/);
});
