import {interactWithPage} from './page.js';
import {interactWithWidgets} from './widgets.js';
import {submissionPage, reserveAttempt} from './submission.js';
import {resolveApplicationTarget, assertApplicationContext} from './frames.js';
import {DEPLOYMENTS} from './connection.js';
import {interactWithATSPage} from './ats-page.js';

const $ = id => document.getElementById(id);
let session = null, snapshot = null, busy = false;
let supplements = {};
let submissionReview = null;
let atsReview = null;
const atsEditors = new Map();
let permissionVersion = 0;
const embeddedOrigins = current => ['https://www.internsg.com/*', 'https://internsg.com/*', current.site + '/*'];
async function refreshEmbeddedAccess() {
  const current = session, version = ++permissionVersion;
  $('enable-embedded').hidden = true; $('embedded-help').hidden = true;
  $('embedded-status').textContent = 'Checking InternSG access…'; $('embedded-status').classList.remove('ready');
  if (!current) return;
  let granted = false;
  try { granted = await chrome.permissions.contains({origins: embeddedOrigins(current)}); } catch { /* Remain unready when permissions cannot be checked. */ }
  if (session !== current || version !== permissionVersion) return;
  $('enable-embedded').hidden = granted; $('embedded-help').hidden = granted;
  $('embedded-status').textContent = granted ? 'Ready for InternSG applications.' : 'InternSG access is needed to fill embedded forms.';
  $('embedded-status').classList.toggle('ready', granted);
}
const attemptKey = url => `jobpilotAttempt:${JSON.stringify([session.api, session.userId, new URL(url).pathname.match(/[0-9]+/)[0]])}`;
function resetSubmission() {
  submissionReview = null; $('submit-consent').checked = false;
  $('submission-preview').hidden = true; $('submission-values').replaceChildren(); $('submission-target').textContent = '';
}
const localKey = () => `jobpilotProfile:${JSON.stringify([session.api, session.userId])}`;
async function loadLocal() {
  const current = session, key = localKey();
  const data = await chrome.storage.local.get(key);
  if (session !== current) throw new Error('Account connection changed. Read the page again.');
  supplements = data[key] || {};
  for (const key of ['phone', 'period', 'summary']) $('local-' + key).value = typeof supplements[key] === 'string' ? supplements[key] : '';
  $('account').textContent = session.email || session.userId;
  $('connection-info').textContent = `Platform: ${session.site} · API: ${session.api}`;
  $('import-countries').textContent = `Saved device country codes: nationality ${supplements.countries?.nationality || 'not saved'}; study country ${supplements.countries?.campus || 'not saved'}.`;
  $('import-consent').checked = false;
}
const editors = new Map();
function checkedFillResult(result, items) {
  const expected = new Set(items.map(item => item.id));
  if (!result || !Array.isArray(result.filled) || !Array.isArray(result.skipped) || result.submitted !== false) throw new Error('Invalid fill report.');
  const all = [...result.filled, ...result.skipped];
  if (all.length !== expected.size || new Set(all).size !== all.length || all.some(id => !expected.has(id))) throw new Error('Incomplete fill report.');
  const reasons = result.reasons || {};
  if (typeof reasons !== 'object' || Array.isArray(reasons) || Object.entries(reasons).some(([id, reason]) => !result.skipped.includes(id) || typeof reason !== 'string')) throw new Error('Invalid fill reasons.');
  return {filled: [...result.filled], skipped: [...result.skipped], reasons};
}
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
function refresh() {
  $('fill').disabled = busy || !snapshot || ![...editors.values()].some(e => !e.blocked && e.input.value.trim());
  for (const editor of editors.values()) {
    editor.input.disabled = busy || !!editor.blocked;
    if (editor.selects) for (const select of Object.values(editor.selects)) select.disabled = busy || !!editor.blocked;
  }
  $('inspect').disabled = busy;
  $('logout').disabled = busy;
  $('login').querySelector('button').disabled = busy;
  $('save-local').disabled = busy; $('clear-local').disabled = busy;
  $('import-local').disabled = busy || !$('import-consent').checked || !session?.userId;
  $('enable-embedded').disabled = busy;
  $('prepare-submit').disabled = busy || !session?.userId;
  $('check-result').disabled = busy || !session?.userId;
  $('send-application').disabled = busy || !submissionReview?.captchaReady || !$('submit-consent').checked;
  $('ats-inspect').disabled = busy;
  $('ats-fill').disabled = busy || !atsReview || ![...atsEditors.values()].some(editor => editor.confirm.checked && editor.input.value.trim());
}
async function run(task, validate = true) {
  if (busy) return;
  const current = session;
  const unchanged = () => { if (validate) assertSession(current); };
  busy = true; refresh();
  try {
    unchanged();
    if (validate) await validateSession();
    unchanged();
    await task(unchanged);
  } catch (error) {
    // An obsolete operation must not overwrite the next account's UI.
    if (!validate || session === current) status(error.message || 'Operation failed. Try again.', true);
  }
  finally { busy = false; refresh(); }
}
function assertSession(current) {
  if (!current || session !== current) throw new Error('Account connection changed. Read the page again.');
}
function clearDraft() {
  snapshot = null; editors.clear(); $('fields').replaceChildren(); resetSubmission();
  $('target').textContent = ''; $('submission-status').textContent = '';
}
function clearAtsReview() {
  atsReview = null; atsEditors.clear(); $('ats-fields').replaceChildren();
  $('ats-manual').replaceChildren(); $('ats-manual').hidden = true;
  $('ats-target').textContent = ''; $('ats-result').textContent = 'Nothing was submitted.';
  refresh();
}
async function api(path, body, method = 'POST') {
  const current = session;
  if (!current?.token?.startsWith('jpx_')) throw new Error('Connect through JobPilot first.');
  const response = await fetch(session.api + path, {
    method, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${current.token}`},
    body: JSON.stringify(body), signal: AbortSignal.timeout(40000),
  });
  assertSession(current);
  if (response.status === 401) {
    const message = 'Session expired or revoked. Connect through JobPilot again.';
    await signOut(message); throw new Error(message);
  }
  if (!response.ok) throw new Error(`API error ${response.status}. Check your account and backend configuration.`);
  const data = await response.json();
  assertSession(current);
  return data;
}
async function validateSession() {
  const current = session;
  const data = await api('/auth/extension/session', undefined, 'GET');
  assertSession(current);
  if (data.user_id !== current.userId) {
    const message = 'Account changed. Reconnect through JobPilot.';
    await signOut(message); throw new Error(message);
  }
}
function clearDeviceView() {
  supplements = {}; for (const key of ['phone', 'period', 'summary']) $('local-' + key).value = '';
  $('account').textContent = '';
  $('connection-info').textContent = ''; $('open-jobpilot').removeAttribute('href');
  $('import-countries').textContent = ''; $('import-consent').checked = false;
}
async function signOut(message = 'Signed out.') {
  permissionVersion++; session = null; clearDraft(); clearDeviceView();
  $('login').hidden = false; $('workspace').hidden = true; status(message);
  await chrome.storage.session.remove('jobpilotSession');
}
$('extension-id').textContent = 'Extension ID: ' + chrome.runtime.id;
$('login').addEventListener('submit', event => {
  event.preventDefault();
  if (busy) return;
  const site = $('platform').value;
  if (!Object.hasOwn(DEPLOYMENTS, site)) { status('Choose a supported JobPilot platform.', true); return; }
  const permission = chrome.permissions.request({origins: [site + '/*', DEPLOYMENTS[site] + '/*']});
  run(async () => {
    if (!await permission) throw new Error('API access was not granted.');
    const result = await chrome.runtime.sendMessage({kind: 'begin', site});
    if (!result?.ok) throw new Error(result?.error || 'Could not open JobPilot.');
    status('Continue in the JobPilot tab, then return here. No password is needed in the extension.');
  }, false);
});
$('logout').addEventListener('click', () => run(async () => {
  const current = session;
  const result = await chrome.runtime.sendMessage({kind: 'disconnect'});
  if (!result?.ok) throw new Error(result?.error || 'Disconnect failed. Retry when online.');
  if (session && session !== current) return;
  await signOut();
}, false));
$('enable-embedded').addEventListener('click', () => {
  // Request directly from the click gesture, before asynchronous discovery.
  if (busy || !session || DEPLOYMENTS[session.site] !== session.api) return;
  const request = chrome.permissions.request({origins: embeddedOrigins(session)});
  run(async unchanged => {
    const granted = await request;
    unchanged(); await refreshEmbeddedAccess(); unchanged();
    if (!granted) throw new Error('InternSG access was not granted. You can enable it here when ready.');
    unchanged();
    status('Access enabled. Continue your application in JobPilot.');
  });
});
const permissionsChanged = () => {
  clearDraft();
  refreshEmbeddedAccess().catch(() => {});
  refresh();
};
chrome.permissions.onAdded?.addListener(permissionsChanged);
chrome.permissions.onRemoved?.addListener(permissionsChanged);
$('save-local').addEventListener('click', () => run(async unchanged => {
  if (!session?.userId) throw new Error('Sign in again before saving.');
  const saved = {};
  for (const key of ['phone', 'period', 'summary']) saved[key] = $('local-' + key).value;
  const countries = editors.get('applicant_countries');
  if (countries?.input.value) saved.countries = JSON.parse(countries.input.value);
  else if (supplements.countries) saved.countries = supplements.countries;
  await chrome.storage.local.set({[localKey()]: saved}); unchanged(); supplements = saved;
  await loadLocal();
  unchanged();
  status('Device copy saved. Review and import it to JobPilot to reuse it. Platform details were not changed.');
}));
$('import-consent').addEventListener('change', refresh);
for (const key of ['phone', 'period', 'summary']) $('local-' + key).addEventListener('input', () => { $('import-consent').checked = false; refresh(); });
$('import-local').addEventListener('click', () => run(async unchanged => {
  if (!session?.userId || !$('import-consent').checked) throw new Error('Review the device details and confirm import first.');
  const payload = {confirmed: true};
  for (const [local, field] of [['phone', 'phone'], ['period', 'availability_period'], ['summary', 'resume_summary']]) {
    const value = $('local-' + local).value.trim();
    if (value) payload[field] = value;
  }
  if (supplements.countries?.nationality) payload.nationality = supplements.countries.nationality;
  if (supplements.countries?.campus) payload.study_country = supplements.countries.campus;
  if (Object.keys(payload).length === 1) throw new Error('No device details to import. Maintain your profile in JobPilot.');
  $('import-consent').checked = false;
  const result = await api('/profile/import-local', payload);
  unchanged();
  clearDraft();
  status(`Imported: ${result.imported?.join(', ') || 'none'}. Preserved existing platform values: ${result.skipped?.join(', ') || 'none'}. Read the page again to use your JobPilot profile. Device copy retained.`);
}));
$('clear-local').addEventListener('click', () => run(async unchanged => {
  await chrome.storage.local.remove(localKey()); unchanged(); await loadLocal(); unchanged(); clearDraft();
  status('Saved details and popup drafts deleted. Website values were not changed.');
}));
function render(fields, values) {
  $('fields').replaceChildren(); editors.clear();
  for (const field of fields) {
    const row = document.createElement('div'); row.className = 'field';
    const label = document.createElement('label'); label.textContent = field.label; label.htmlFor = `edit-${field.id}`;
    row.append(label);
    if (field.unavailable) {
      const note = document.createElement('p'); note.textContent = field.unavailable; row.append(note);
    } else if (field.occupied) {
      const note = document.createElement('p'); note.textContent = 'Already filled on the website — left unchanged.'; row.append(note);
    } else {
      const input = document.createElement(field.id === 'applicant_summary' ? 'textarea' : 'input');
      input.id = label.htmlFor; input.maxLength = field.maxLength;
      input.value = typeof values[field.id] === 'string' ? values[field.id] : '';
      const note = document.createElement('p'); note.className = 'field-reason'; note.id = `reason-${field.id}`;
      const updateReason = () => { note.textContent = input.value.trim() ? 'Ready to fill when you click Fill application form.' : 'No saved answer. Enter it here or update your JobPilot profile; otherwise this field is skipped.'; };
      input.setAttribute('aria-describedby', note.id); updateReason();
      input.addEventListener('input', () => { updateReason(); refresh(); });
      editors.set(field.id, {input, note, widget: field.widget}); row.append(input, note);
    }
    $('fields').append(row);
  }
}
function renderCountries(widgets, countries) {
  const row = document.createElement('div'); row.className = 'field';
  const note = document.createElement('p'); note.className = 'field-reason';
  row.append(note); $('fields').append(row);
  if (!widgets.countryState) { note.textContent = widgets.countryReason; return; }
  note.textContent = `Website currently shows ${widgets.countryState.nationalityText}; study country ${widgets.countryState.same ? widgets.countryState.nationalityText : widgets.countryState.campusText}. These may be defaults, not your details.`;
  const input = {value: ''}, selects = {};
  const update = () => {
    input.value = selects.nationality.value && selects.campus.value ? JSON.stringify({nationality: selects.nationality.value, campus: selects.campus.value}) : '';
    countryHelp.textContent = input.value ? 'Fill application form will replace both website country selections, including the study-country checkbox.' : 'Choose both countries to replace the website defaults. Incomplete country details are skipped.';
    refresh();
  };
  for (const [key, text] of [['nationality', 'Nationality'], ['campus', 'Country of study / graduation']]) {
    const label = document.createElement('label'); label.textContent = text; label.htmlFor = `country-${key}`;
    const select = document.createElement('select'); select.id = label.htmlFor;
    select.add(new Option('Select your actual country', ''));
    for (const country of widgets.countries) select.add(new Option(country.name, country.code));
    select.value = countries?.[key] || ''; select.addEventListener('change', update);
    if (countries?.[key] && !select.value) note.textContent += ' A saved country is not supported by this website; select it manually.';
    selects[key] = select; row.append(label, select);
  }
  const countryHelp = document.createElement('p'); countryHelp.className = 'field-reason'; row.append(countryHelp);
  editors.set('applicant_countries', {input, note, widget: true, selects}); update();
}
$('inspect').addEventListener('click', () => run(async unchanged => {
  clearDraft(); status('Reading the current page…');
  const context = await resolveApplicationTarget(chrome);
  unchanged();
  const [result] = await chrome.scripting.executeScript({target: {tabId: context.tabId, documentIds: [context.documentId]}, func: interactWithPage, args: ['inspect']});
  unchanged();
  if (!result?.result?.fields?.length || !result.documentId) throw new Error('No supported form found. Open /job-apply/ on InternSG.');
  const current = {...context, ...result.result, documentId: result.documentId};
  const [widgetResult] = await chrome.scripting.executeScript({target: {tabId: context.tabId, documentIds: [result.documentId]}, world: 'MAIN', func: interactWithWidgets, args: ['inspect', current.url]});
  unchanged();
  const widgets = widgetResult?.result;
  if (!widgets) throw new Error('Could not inspect page widgets. Reload the page and try again.');
  current.widgets = widgets;
  const data = await api('/browser-assistant/draft', {page_url: current.url, field_ids: ['applicant_name', 'applicant_email', 'applicant_contact', 'applicant_period', 'applicant_summary']});
  unchanged();
  if (data.profile_source !== 'jobpilot') throw new Error('Update the backend and run its profile migration before using platform profile reuse.');
  if (widgets.richReady) current.fields = current.fields.filter(f => f.id !== 'applicant_summary').concat({id: 'applicant_summary', label: 'Resume summary', maxLength: 3000, occupied: widgets.summaryOccupied, widget: true});
  else if (!current.fields.some(f => f.id === 'applicant_summary')) current.fields.push({id: 'applicant_summary', label: 'Resume summary', unavailable: widgets.summaryReason});
  for (const [id, label] of [['applicant_name', 'Full name'], ['applicant_email', 'Email address'], ['applicant_contact', 'Contact number'], ['applicant_period', 'Availability period']]) {
    if (!current.fields.some(f => f.id === id)) current.fields.push({id, label, unavailable: 'Field is missing, hidden, disabled or ambiguous. Complete it on the original page.'});
  }
  snapshot = current; $('target').textContent = `${snapshot.title} — ${snapshot.url}`;
  const values = {...data.values};
  render(snapshot.fields, values); renderCountries(widgets, data.countries); status('Loaded your JobPilot profile for this review. After changing your platform profile, choose Read page & load profile again. Review the shown answers, then click Fill application form.');
}));
$('ats-inspect').addEventListener('click', () => run(async unchanged => {
  clearAtsReview();
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab?.id) throw new Error('Open a Greenhouse or Lever application form first.');
  const [response] = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: interactWithATSPage, args: [{action: 'inspect'}]});
  unchanged();
  const review = response?.result;
  if (!review?.url || !response.documentId || !Array.isArray(review.fields)) throw new Error('No supported ATS form found. Open the original application page.');
  const data = await api('/browser-assistant/draft', {page_url: review.url,
    field_ids: ['applicant_name', 'applicant_email', 'applicant_contact']});
  unchanged();
  if (data.profile_source !== 'jobpilot') throw new Error('Could not read this JobPilot profile.');
  const evidenceKeys = [...new Set(review.fields.map(field => field.evidenceKey).filter(Boolean))];
  const evidence = evidenceKeys.length ? await api('/browser-assistant/ats-evidence', {
    page_url: review.url, evidence_keys: evidenceKeys,
  }) : {values: {}, source_labels: {}, profile_source: 'jobpilot'};
  unchanged();
  if (evidence.profile_source !== 'jobpilot') throw new Error('Could not verify saved evidence.');
  const name = (data.values?.applicant_name || '').trim().split(/\s+/);
  const values = {first_name: name.length > 1 ? name[0] : '', last_name: name.length > 1 ? name.slice(1).join(' ') : '',
    full_name: data.values?.applicant_name || '', email: data.values?.applicant_email || '', phone: data.values?.applicant_contact || ''};
  for (const field of review.fields) {
    const row = document.createElement('div'); row.className = 'field';
    const label = document.createElement('label'); label.textContent = field.label || ({first_name: 'First name', last_name: 'Last name', full_name: 'Full name', email: 'Email', phone: 'Phone'})[field.id] || field.id;
    row.append(label);
    if (!field.available || field.occupied) {
      const note = document.createElement('p'); note.textContent = field.occupied ? 'Already filled on the website; left unchanged.' : 'Unavailable or ambiguous on this page; fill manually.';
      row.append(note);
    } else {
      const input = document.createElement(field.evidenceKey && !['linkedin', 'github'].includes(field.evidenceKey) ? 'textarea' : 'input');
      input.id = 'ats-' + field.id; input.maxLength = field.maxLength;
      const suggestion = field.evidenceKey ? evidence.values?.[field.evidenceKey] || '' : values[field.id] || '';
      input.value = suggestion.length <= field.maxLength ? suggestion : '';
      if (input instanceof HTMLInputElement) input.type = field.id === 'email' ? 'email' : field.id === 'phone' ? 'tel' : field.evidenceKey ? 'url' : 'text';
      label.htmlFor = input.id;
      const source = document.createElement('p'); source.className = 'field-reason';
      source.textContent = suggestion.length > field.maxLength ? 'Saved evidence exceeds this field limit; write a shorter answer yourself.'
        : field.evidenceKey ? (evidence.source_labels?.[field.evidenceKey] || 'No saved evidence; enter manually after checking the original question.')
        : `JobPilot profile · ${field.id.replaceAll('_', ' ')}`;
      const checkLabel = document.createElement('label'); checkLabel.className = 'check';
      const confirm = document.createElement('input'); confirm.type = 'checkbox';
      checkLabel.append(confirm, document.createTextNode('I checked this answer against the original question.'));
      input.addEventListener('input', () => { confirm.checked = false; refresh(); });
      confirm.addEventListener('change', refresh);
      row.append(source, input, checkLabel); atsEditors.set(field.id, {input, confirm, field});
    }
    $('ats-fields').append(row);
  }
  if (review.manualQuestions?.length) {
    const title = document.createElement('p'); title.textContent = 'These original-site text questions need manual answers:';
    const list = document.createElement('ul');
    for (const question of review.manualQuestions) {
      const item = document.createElement('li'); item.textContent = question; list.append(item);
    }
    $('ats-manual').append(title, list); $('ats-manual').hidden = false;
  }
  atsReview = {...review, tabId: tab.id, documentId: response.documentId};
  $('ats-target').textContent = `${review.provider} — ${review.url}`;
  $('ats-result').textContent = 'Only individually checked, non-empty answers will be filled. Questions without saved evidence stay manual. Nothing has been sent.';
  refresh();
}));
$('ats-fill').addEventListener('click', () => {
  if (busy || !atsReview) return;
  const current = atsReview;
  const approved = [...atsEditors].filter(([, editor]) => editor.confirm.checked && editor.input.value.trim())
    .map(([id, editor]) => ({id, value: editor.input.value.trim(), confirmed: true,
      ...(editor.field.evidenceKey ? {key: editor.field.key, label: editor.field.label, evidenceKey: editor.field.evidenceKey} : {})}));
  run(async unchanged => {
    if (atsReview !== current || !approved.length) throw new Error('Read and review the form again.');
    // A single attempt only. If the page changes or reports an uncertain result,
    // re-inspect it manually before another fill rather than retrying.
    atsReview = null; refresh();
    const [response] = await chrome.scripting.executeScript({target: {tabId: current.tabId, documentIds: [current.documentId]},
      func: interactWithATSPage, args: [{action: 'fill', expectedUrl: current.url, approved}]});
    unchanged();
    if (response?.result?.submitted !== false || !Array.isArray(response.result.filled)
        || !Array.isArray(response.result.skipped)) throw new Error('Fill result is uncertain. Inspect the original page. Nothing was submitted by JobPilot.');
    $('ats-result').textContent = `Filled ${response.result.filled.length}; skipped ${response.result.skipped.length}. Check every answer on the original site. Nothing was submitted.`;
  });
});
$('fill').addEventListener('click', () => {
  if (busy || !snapshot) return;
  // The click approves only this visible draft, never later edits during session validation.
  const current = snapshot;
  const approved = [...editors].filter(([, e]) => !e.blocked && e.input.value.trim()).map(([id, e]) => ({id, value: e.input.value, confirmed: true, widget: !!e.widget}));
  run(async unchanged => {
  let dispatched = false;
  try {
  resetSubmission();
  if (snapshot !== current) throw new Error('The form review changed. Read the page again.');
  await assertApplicationContext(chrome, current);
  unchanged();
  if (snapshot !== current) throw new Error('The form review changed. Read the page again.');
  if (!approved.length) throw new Error('Enter at least one answer before filling.');
  const normal = approved.filter(item => !item.widget).map(({widget, ...item}) => item);
  const widgetItems = approved.filter(item => item.widget).map(({widget, ...item}) => item.id === 'applicant_countries' ? {...item, expectedState: current.widgets.countryState} : item);
  const target = {tabId: current.tabId, documentIds: [current.documentId]};
  for (const item of approved) {
    const editor = editors.get(item.id);
    if (editor) { editor.blocked = true; editor.note.textContent = 'Fill attempt started. If interrupted, inspect the original page before reading it again.'; }
  }
  const executeFill = async (request, items) => {
    dispatched = true;
    const [response] = await chrome.scripting.executeScript(request);
    unchanged();
    if (snapshot !== current) throw new Error('The form review changed.');
    return checkedFillResult(response?.result, items);
  };
  const result = {result: normal.length ? await executeFill({target, func: interactWithPage, args: ['fill', current.url, normal]}, normal) : {filled: [], skipped: [], reasons: {}}};
  unchanged();
  if (!result?.result) throw new Error('Page changed or closed. Read it again.');
  if (widgetItems.length) {
    if (snapshot !== current) throw new Error('The form review changed. Check the original page before reading it again.');
    await assertApplicationContext(chrome, current); unchanged();
    if (snapshot !== current) throw new Error('The form review changed. Check the original page before reading it again.');
    const widgetResult = {result: await executeFill({target, world: 'MAIN', func: interactWithWidgets, args: ['fill', current.url, widgetItems]}, widgetItems)};
    unchanged();
    if (!widgetResult?.result) throw new Error('Widget operation interrupted. Check the original page before retrying.');
    result.result.filled.push(...widgetResult.result.filled); result.result.skipped.push(...widgetResult.result.skipped);
    result.result.reasons = {...result.result.reasons, ...widgetResult.result.reasons};
  }
  if (!result?.result) throw new Error('Page changed or closed. Read it again.');
  for (const id of result.result.filled) {
    const editor = editors.get(id);
    if (editor) {
      editor.input.disabled = true;
      if (editor.selects) for (const select of Object.values(editor.selects)) select.disabled = true;
      editor.note.textContent = 'Filled. Verify the result on the original page.';
      editors.delete(id);
    }
  }
  for (const id of result.result.skipped) {
    const editor = editors.get(id);
    if (editor) { editor.blocked = true; editor.note.textContent = result.result.reasons?.[id] || 'Website field changed, already contains text, is unavailable or rejects this length. Check it and read the page again.'; }
  }
  const skipped = result.result.skipped.map(id => id === 'applicant_countries' ? 'Nationality / study country' : snapshot.fields.find(f => f.id === id)?.label || id).join(', ');
  status(`Filled ${result.result.filled.length}. ${skipped ? `Skipped ${skipped}: the page changed or already has an answer. Your draft is retained; check the original page.` : 'Remaining drafts are retained.'} Nothing was submitted. Complete CAPTCHA yourself, then review the website answers before sending.`);
  } catch (error) {
    if (dispatched) throw new Error('Some answers may already be filled. Check the original page before reading it again; this attempt will not retry automatically. Your draft is retained. Nothing was submitted.');
    throw error;
  }
  });
});
$('submit-consent').addEventListener('change', refresh);
$('prepare-submit').addEventListener('click', () => run(async unchanged => {
  resetSubmission();
  $('submission-status').textContent = 'Checking the website. Nothing is being sent.';
  const context = await resolveApplicationTarget(chrome);
  unchanged();
  const [result] = await chrome.scripting.executeScript({target: {tabId: context.tabId, documentIds: [context.documentId]}, world: 'MAIN', func: submissionPage, args: ['review', context.url]});
  unchanged();
  if (!result?.result?.fingerprint || !result.documentId) throw new Error('Cannot review this application page.');
  const review = {...context, ...result.result, documentId: result.documentId};
  const key = attemptKey(review.url);
  const previous = (await chrome.storage.local.get(key))[key];
  unchanged();
  if (previous) {
    $('submission-status').textContent = `A submission attempt was recorded at ${new Date(previous.at).toLocaleString()}. Result is unverified; retry is blocked. Check the original page before doing anything else.`;
    return;
  }
  submissionReview = review;
  $('submission-target').textContent = `${review.title} — ${review.url}`;
  for (const [label, value] of Object.entries(review.values)) {
    const term = document.createElement('dt'), answer = document.createElement('dd');
    term.textContent = label; answer.textContent = value; $('submission-values').append(term, answer);
  }
  $('submission-preview').hidden = false;
  $('submission-status').textContent = review.captchaReady
    ? 'Review every answer and the recipient. Confirmation expires in two minutes; changed answers require a new review.'
    : 'CAPTCHA is incomplete. Complete it yourself on InternSG, then click Review website answers again.';
}));
$('send-application').addEventListener('click', () => run(async unchanged => {
  if (!submissionReview?.captchaReady || !$('submit-consent').checked) throw new Error('Review the website answers and explicitly confirm first.');
  const review = submissionReview, key = attemptKey(review.url);
  resetSubmission();
  await assertApplicationContext(chrome, review);
  unchanged();
  await reserveAttempt(chrome.storage.local, navigator.locks, key, {at: Date.now(), state: 'attempt_reserved', url: review.url});
  try { unchanged(); }
  catch (error) {
    // No page command was dispatched, so this reservation is known not to be an attempt.
    await chrome.storage.local.remove(key);
    throw error;
  }
  $('submission-status').textContent = 'One attempt reserved. Sending may navigate the page. Do not click Submit again; no automatic retry will occur.';
  try {
    const [result] = await chrome.scripting.executeScript({target: {tabId: review.tabId, documentIds: [review.documentId]}, world: 'MAIN', func: submissionPage,
      args: ['submit', review.url, {confirmed: true, fingerprint: review.fingerprint, reviewedAt: review.reviewedAt}]});
    unchanged();
    if (result?.result?.state === 'not_clicked') {
      await chrome.storage.local.remove(key);
      unchanged();
      $('submission-status').textContent = `Nothing was clicked. ${result.result.reason}`;
    } else {
      $('submission-status').textContent = 'Submission was attempted; delivery is unverified. Check the original page result. Duplicate attempts are blocked.';
    }
  } catch {
    unchanged();
    $('submission-status').textContent = 'The page changed or the operation was interrupted. Submission outcome is unknown. Do not retry; check the original page. The attempt record is retained.';
  }
}));
$('check-result').addEventListener('click', () => run(async unchanged => {
  try {
    const context = await resolveApplicationTarget(chrome);
    unchanged();
    const [result] = await chrome.scripting.executeScript({target: {tabId: context.tabId, documentIds: [context.documentId]}, world: 'MAIN', func: submissionPage, args: ['result', context.url]});
    unchanged();
    const messages = result?.result?.messages || [];
    $('submission-status').textContent = messages.length
      ? `Website messages (not a verified delivery receipt): ${messages.join(' | ')}. Inspect the original page; do not resend automatically.`
      : 'No recognized result message. Delivery remains unverified. Inspect the original page; a changed URL or missing form does not prove success.';
  } catch { unchanged(); $('submission-status').textContent = 'Cannot read this result page. Inspect it directly in Chrome. Delivery remains unverified; do not resend automatically.'; }
}));
let restoreVersion = 0;
async function restoreConnection() {
  const version = ++restoreVersion;
  for (const id of ['settings', 'local-profile', 'original-tools', 'advanced-submission', 'ats-tools']) $(id).open = false;
  clearDraft();
  clearAtsReview();
  const saved = (await chrome.storage.session.get('jobpilotSession')).jobpilotSession;
  if (version !== restoreVersion) return;
  session = saved?.token?.startsWith('jpx_') && DEPLOYMENTS[saved.site] === saved.api ? saved : null;
  $('login').hidden = !!session; $('workspace').hidden = true;
  if (session) {
    try {
      await validateSession();
      if (version !== restoreVersion) return;
      await loadLocal();
      if (version !== restoreVersion) return;
      $('open-jobpilot').href = session.site + '/jobs';
      await refreshEmbeddedAccess();
      if (version !== restoreVersion) return;
      $('workspace').hidden = false; status('Filling never submits an application.');
    }
    catch (error) { if (version === restoreVersion) await signOut(error.message || 'Reconnect through JobPilot.'); }
  } else {
    await chrome.storage.session.remove('jobpilotSession');
    $('login').hidden = false;
  }
  refresh();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.jobpilotSession) {
    restoreVersion++;
    session = null; clearDraft(); clearDeviceView(); $('workspace').hidden = true; $('login').hidden = false;
    clearAtsReview();
    if (changes.jobpilotSession.newValue) restoreConnection();
    else refresh();
  }
});
try {
  await chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  await restoreConnection();
} catch { status('Session storage unavailable. Reopen the extension.', true); }
refresh();
