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
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.handlers = new Map(); this.hidden = false; this.disabled = false; this.checked = false; this.open = false; this._value = ''; this._text = ''; this.scrollTop = 0; this.attributes = {}; this.classes = new Set(); this.classList = {add: (...x) => x.forEach(v => this.classes.add(v)), remove: (...x) => x.forEach(v => this.classes.delete(v)), contains: x => this.classes.has(x), toggle: (x, on) => on ?? !this.classes.has(x) ? this.classes.add(x) : this.classes.delete(x)}; nodes.push(this); }
    set id(id) { this._id = id; byId.set(id, this); } get id() { return this._id || ''; }
    set value(value) { this._value = String(value); } get value() { return this._value; }
    set className(value) { this.classes = new Set(value.split(/\s+/)); } get className() { return [...this.classes].join(' '); }
    set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map(x => typeof x === 'string' ? x : x.textContent).join(''); }
    get childElementCount() { return this.children.filter(x => typeof x !== 'string').length; }
    append(...items) { for (const item of items) { this.children.push(item); if (typeof item !== 'string') item.parentElement = this; } }
    add(item) { this.append(item); }
    replaceChildren(...items) { this.children = []; this._text = ''; this.append(...items); }
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
  const state = {url, documentId: 'document-1', saved: connected ? grant('A') : null, calls: [], requests: [], permissionRequests: 0, factsGate: null, inspectError: null, onQuery: null, onInspect: null, facts: {fingerprint: 'f'.repeat(64), values: {given_name: 'Avery', family_name: 'Ng', full_name: 'Avery Ng', contact_email: 'avery@example.test', school: 'National University of Singapore'}, sources: {}, resumes: [], resume: null}};
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
      if (name === 'interactWithWidgets') return [{documentId: doc, result: {richReady: false, countries: [], countryState: null, countryReason: 'Complete countries manually.'}}];
      if (name !== 'interactWithATSPage') throw new Error('Unexpected injected function: ' + name);
      const action = request.args[0].action;
      if (action === 'inspect') {
        if (state.inspectError) throw new Error(state.inspectError);
        const result = [{documentId: doc, result: {url: state.url, provider: 'Greenhouse', fields: [{id: 'first_name', key: 'id:first', label: 'First name', kind: 'text', evidenceKey: 'given_name', available: true, occupied: false}, {id: 'custom:unknown', key: 'id:question', label: 'Ordinary unknown', kind: 'text', evidenceKey: null, needsMapping: true, available: true, occupied: false}], manualQuestions: ['Consent'], resumeTarget: null}}];
        state.onInspect?.(); return result;
      }
      if (action === 'fill') return [{documentId: doc, result: {filled: request.args[0].approved.map(x => x.id), skipped: [], submitted: false}}];
      throw new Error('Unexpected write: ' + action);
    }},
  };
  globalThis.fetch = async (url, options) => {
    state.requests.push({url, method: options.method, authorization: options.headers.Authorization});
    assert.equal(options.method, 'GET', 'Opening and Refresh may not POST or upload');
    const owner = options.headers.Authorization.split('jpx_fixture_')[1];
    if (url.endsWith('/auth/extension/session')) return {ok: true, status: 200, json: async () => ({user_id: owner})};
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

test('real popup startup loads ATS saved answers once, unknown stays empty, Fill writes only after click', async () => {
  const f = await fixture(); await f.loaded;
  assert.equal(f.get('ats-first_name').value, 'Avery');
  assert.equal(f.get('ats-custom:unknown').value, '');
  assert.match(f.get('source-ats-custom:unknown').textContent, /Could not match this question/);
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
