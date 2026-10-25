import {interactWithPage} from './page.js';
import {interactWithWidgets} from './widgets.js';
import {submissionPage, reserveAttempt} from './submission.js';
import {resolveApplicationTarget, assertApplicationContext} from './frames.js';
import {DEPLOYMENTS} from './connection.js';
import {interactWithATSPage, parseATSInspectionResult, parseATSFillResult} from './ats-page.js';
import {autofillSuggestion, approvedAutofillAnswers, autofillPlaceholder} from './popup-review.js';
import {popupConnectionKey, capturePopupTarget, assertCapturedPopupTarget, assertPopupDocumentBinding, resolveCapturedInternSG} from './popup-autoload.js';
import {preparationFields, preparationOverflowFields, preparationPatch, unfinishedPreparationPatch, checkedPreparation, requestPreparation, boundedPreparation} from './popup-preparation.js';

const $ = id => document.getElementById(id);
const popupVersion = chrome.runtime.getManifest?.()?.version;
if (popupVersion) $('runtime-version').textContent = 'Review & fill · ' + popupVersion;
// This popup is a fill-only companion. Legacy submission code stays disabled.
const SUBMISSION_ENABLED = false;
let session = null, snapshot = null, busy = false;
let supplements = {};
let submissionReview = null;
let atsReview = null, atsAttachmentReview = null, atsScanCounts = null;
let atsFillState = 'idle';
const atsEditors = new Map();
let permissionVersion = 0;
let connectionKey = '', connectionGeneration = 0, restoreVersion = 0;
let initialization = Promise.resolve(), operationCompletion = Promise.resolve();
let recoveryTool = null, activeTool = null;
let preparation = null;
const showRecovery = tool => { recoveryTool = tool; $('inspect').hidden = tool !== 'original-tools'; $('ats-inspect').hidden = tool !== 'ats-tools'; };
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
function cancelPreparation() {
  if (preparation) preparation.cancelled = true;
  preparation = null;
  const node = $('preparation-status');
  if (node) { node.hidden = true; node.textContent = ''; }
}
function updatePreparationStatus() {
  const node = $('preparation-status');
  if (!node) return;
  const group = activeTool === 'ats-tools' ? atsEditors : editors;
  const ready = [...group.values()].filter(editor => !editor.blocked && editor.input.value.trim() && !['pending_confirmation', 'template', 'unfinished'].includes(editor.source)).length;
  const templates = [...group.values()].filter(editor => !editor.blocked && editor.input.value.trim() && ['template', 'pending_confirmation', 'unfinished'].includes(editor.source)).length;
  const unresolved = [...group.values()].filter(editor => !editor.blocked && !editor.input.value.trim()).length;
  node.hidden = !group.size;
  if (activeTool === 'ats-tools' && !atsReview && atsFillState !== 'idle') {
    node.textContent = atsFillState === 'filling' ? 'Copying your answers to the application…'
      : atsFillState === 'complete' ? 'Fill finished. Check the original form.'
        : atsFillState === 'rejected' ? 'Nothing was filled. Refresh the form before trying again.'
          : 'Check the website, then refresh this preview before trying again.';
    return;
  }
  node.textContent = preparation?.status === 'preparing'
    ? `${ready} ready · AI preparing answers to ${preparation.fields.length} current questions… ${preparation.overflowFields.length ? 'Only the first 40 questions are sent for analysis. ' : ''}Fill will wait for this batch.`
    : `${ready} answers loaded${templates ? ` · ${templates} templates to replace` : ''} · ${unresolved} unanswered${preparation?.message ? '. ' + preparation.message : ''}`;
}
function groupReadyAnswers(container, group) {
  const rows = [...group.values()].filter(editor => editor.row);
  const ready = rows.filter(editor => editor.source === 'saved' && !editor.edited && editor.input.value.trim());
  if (!ready.length) return;
  let details = container.readyGroup;
  if (!details || !details.isConnected) {
    details = document.createElement('details'); details.className = 'prepared-fields'; details.open = true;
    const summary = document.createElement('summary');
    const body = document.createElement('div'); body.className = 'prepared-fields-body';
    details.append(summary, body); details.readyBody = body;
    container.insertBefore(details, container.children[0] || null); container.readyGroup = details;
  }
  details.children[0].textContent = `Saved answers ready (${ready.length})`;
  for (const editor of ready) details.readyBody.append(editor.row);
}
function startPreparation(context, profile, group) {
  const fields = preparationFields(group);
  const overflowFields = preparationOverflowFields(group);
  if (!fields.length) { updatePreparationStatus(); return; }
  const owner = session;
  const job = {context, owner, group, fields, overflowFields, status: 'preparing', cancelled: false, awaitedForFill: false};
  preparation = job; refresh();
  const valid = () => !job.cancelled && job.status === 'preparing' && preparation === job && session === owner
    && (context === atsReview || context === snapshot);
  const unchanged = () => { assertSession(owner); if (!valid()) throw new Error('This application preview changed.'); };
  const body = {confirmed: true, page_url: context.url, profile_fingerprint: profile.fingerprint, fields};
  const apply = (editor, patch, message) => {
    editor.input.value = patch.value; editor.factKey = patch.factKey; editor.source = patch.source;
    editor.templateValue = ['pending_confirmation', 'unfinished'].includes(patch.source) ? patch.value : null;
    editor.note.hidden = false; editor.note.textContent = message;
    if (editor.field.requiresWebsiteChoice) editor.note.append(' Choose the suggested location on the website.');
    editor.row?.classList.toggle('ai-draft', patch.source === 'ai_draft');
    editor.input.setAttribute('aria-describedby', editor.note.id);
  };
  const unfinished = (message, excluded = new Set(), targets = fields) => {
    let count = 0;
    for (const {id} of targets) {
      if (excluded.has(id)) continue;
      const editor = group.get(id), patch = unfinishedPreparationPatch(editor, profile);
      if (patch) { apply(editor, patch, message); count++; }
    }
    return count;
  };
  const markOverflow = () => {
    if (!overflowFields.length) return;
    unfinished('Not analyzed: this question is beyond the first 40. Replace this pending text before submitting.', new Set(), overflowFields);
    job.message += ' Only the first 40 questions were sent for analysis; the remaining questions were not analyzed.';
  };
  // One total deadline covers the existing batch, result binding and free checks.
  // Fill can await this same promise; it never starts a second model request.
  job.promise = boundedPreparation(async signal => {
  const result = await requestPreparation(async cacheOnly => {
    unchanged();
    if (cacheOnly) await assertPopupDocumentBinding(chrome, context.popupTarget, context, unchanged);
    unchanged();
    return api('/browser-assistant/prepare-answers', {...body, ...(cacheOnly ? {cache_only: true} : {})}, 'POST', 8200, signal);
  });
    unchanged(); checkedPreparation(result, profile.fingerprint, fields);
    const answers = result.status === 'preparing' || result.status === 'unavailable' || result.error_code ? [] : result.answers;
    if (answers.length) {
      const latest = await loadAutofillProfile(unchanged, signal);
      if (latest.fingerprint !== profile.fingerprint) throw new Error('Saved details changed. Refresh the form to use them.');
    }
    await assertPopupDocumentBinding(chrome, context.popupTarget, context, unchanged);
    unchanged();
    if (busy && !job.awaitedForFill) { job.status = 'partial'; job.message = 'Another action has started; late answers were not added.'; refresh(); return; }
    for (const answer of answers) {
      if (answer.source !== 'saved' && result.analyzed_field_ids && !result.analyzed_field_ids.includes(answer.field_id)) continue;
      const editor = group.get(answer.field_id), patch = preparationPatch(answer, editor, profile);
      if (!patch) continue;
      apply(editor, patch, patch.source === 'ai_draft'
        ? `${result.execution_mode === 'mock' ? 'Mock AI answer' : 'AI answer'} · based on saved evidence. Review before filling.`
        : patch.source === 'pending_confirmation' ? 'AI found no supporting information for this question. Replace this pending text before submitting.'
          : result.execution_mode === 'live' ? 'AI matched this question to a saved answer.' : 'Saved answer ready.');
    }
    if (result.status === 'unavailable' || result.error_code || result.status === 'preparing') {
      unfinished('AI did not finish answering this question. Replace this pending text before submitting.');
      job.message = 'AI did not finish. Pending text is not an AI answer; replace it before submitting.';
    } else {
      const excluded = new Set(result.omitted.filter(item => item.reason === 'personal_or_qualification_question').map(item => item.field_id));
      const unfinishedCount = unfinished('AI did not return a verified answer for this question. Replace this pending text before submitting.', excluded);
      job.message = result.execution_mode === 'live' ? `${result.analyzed_field_ids ? `AI checked ${result.analyzed_field_ids.length} current questions` : 'AI preparation completed'} against your saved evidence. Review its answers before submitting.`
        : result.execution_mode === 'mock' ? 'Mock preparation result; not a live AI analysis.' : 'Saved evidence checked. No live AI analysis was completed.';
      if (unfinishedCount) job.message += ` ${unfinishedCount} questions have no verified answer; replace their pending text.`;
    }
    job.status = result.status === 'preparing' ? 'unavailable' : result.status;
    markOverflow();
    groupReadyAnswers(context === atsReview ? $('ats-fields') : $('fields'), group); refresh();
  }).catch(error => {
    if (!valid()) return;
    if (error.stalePreview || /saved details changed/i.test(error.message || '')) {
      job.status = 'unavailable'; job.message = error.message; showRecovery(context.popupTarget.tool); refresh(); return;
    }
    unfinished('AI did not finish answering this question. Replace this pending text before submitting.');
    job.status = 'unavailable';
    job.message = /timed out|abort/i.test(error.message || '') ? 'AI timed out. Pending text is not an AI answer; replace it before submitting.'
      : 'AI preparation unavailable. Pending text is not an AI answer; replace it before submitting.';
    markOverflow();
    refresh();
  });
}
function checkedFillResult(result, items) {
  const expected = new Set(items.map(item => item.id));
  if (!result || !Array.isArray(result.filled) || !Array.isArray(result.skipped) || result.submitted !== false) throw new Error('Invalid fill report.');
  const all = [...result.filled, ...result.skipped];
  if (all.length !== expected.size || new Set(all).size !== all.length || all.some(id => !expected.has(id))) throw new Error('Incomplete fill report.');
  const reasons = result.reasons || {};
  if (typeof reasons !== 'object' || Array.isArray(reasons) || Object.entries(reasons).some(([id, reason]) => !result.skipped.includes(id) || typeof reason !== 'string')) throw new Error('Invalid fill reasons.');
  const needsWebsiteChoice = result.needsWebsiteChoice === undefined ? [] : result.needsWebsiteChoice;
  if (!Array.isArray(needsWebsiteChoice) || new Set(needsWebsiteChoice).size !== needsWebsiteChoice.length
      || needsWebsiteChoice.some(id => !result.filled.includes(id))) throw new Error('Invalid website-choice report.');
  const needsCorrection = result.needsCorrection === undefined ? [] : result.needsCorrection;
  if (!Array.isArray(needsCorrection) || new Set(needsCorrection).size !== needsCorrection.length
      || needsCorrection.some(id => !result.filled.includes(id))) throw new Error('Invalid answer-correction report.');
  return {filled: [...result.filled], skipped: [...result.skipped], reasons, needsWebsiteChoice: [...needsWebsiteChoice], needsCorrection: [...needsCorrection]};
}
function mergePreparedApproval(initial, pending, group, prepared) {
  if (!pending) return initial;
  const approved = new Map(initial.map(item => [item.id, item]));
  const expected = new Set([...pending.fields, ...pending.overflowFields].map(field => field.id));
  for (const item of prepared) {
    const editor = group.get(item.id);
    if (expected.has(item.id) && editor && !editor.edited
        && ['saved', 'ai_draft', 'pending_confirmation', 'unfinished'].includes(editor.source)) approved.set(item.id, item);
  }
  return [...group.keys()].flatMap(id => approved.has(id) ? [approved.get(id)] : []);
}
const status = (message, error = false) => {
  $('status').textContent = message; $('status').classList.toggle('error', error);
  $('status').hidden = !error && !!$('ats-fields').childElementCount;
};
function refresh() {
  $('fill').disabled = busy || !snapshot || !([...editors.values()].some(e => !e.blocked && e.input.value.trim()) || (preparation?.context === snapshot && preparation.status === 'preparing'));
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
  $('prepare-submit').disabled = !SUBMISSION_ENABLED || busy || !session?.userId;
  $('check-result').disabled = !SUBMISSION_ENABLED || busy || !session?.userId;
  $('send-application').disabled = !SUBMISSION_ENABLED || busy || !submissionReview?.captchaReady || !$('submit-consent').checked;
  $('ats-inspect').disabled = busy;
  $('ats-attach').disabled = busy || !atsAttachmentReview;
  for (const editor of atsEditors.values()) editor.input.disabled = busy || !atsReview;
  $('ats-fill').disabled = busy || !atsReview || !([...atsEditors.values()].some(editor => editor.input.value.trim()) || (preparation?.context === atsReview && preparation.status === 'preparing'));
  $('ats-fill').hidden = !$('ats-fields').childElementCount;
  $('ats-intro').hidden = !!$('ats-fields').childElementCount;
  $('ats-profile-note').hidden = !$('ats-fields').childElementCount;
  $('ats-actions').hidden = !$('ats-fields').childElementCount && recoveryTool !== 'ats-tools';
  $('original-actions').hidden = !$('fields').childElementCount;
  $('review-actions').hidden = $('ats-actions').hidden && $('original-actions').hidden;
  $('status').hidden = !$('status').classList.contains('error') && !!$('ats-fields').childElementCount;
  $('ats-fill').textContent = busy ? atsFillState === 'waiting' ? 'Preparing…' : atsReview ? 'Checking…' : 'Filling…'
    : !atsReview && ['rejected', 'uncertain'].includes(atsFillState) ? 'Refresh form to continue'
      : !atsReview && atsFillState === 'complete' ? 'Fill finished' : 'Fill application form';
  $('ats-counts').hidden = !atsScanCounts;
  if (atsScanCounts) {
    const missing = [...atsEditors.values()].filter(editor => !editor.input.value.trim()).length;
    const templates = [...atsEditors.values()].filter(editor => editor.input.value.trim() && ['template', 'pending_confirmation', 'unfinished'].includes(editor.source)).length;
    const ready = atsReview ? atsEditors.size - missing - templates : 0;
    $('ats-counts').textContent = `${ready} ready${templates ? ` · ${templates} templates to replace` : ''} · ${preparation?.status === 'preparing' ? `${preparation.fields.length} preparing` : `${missing} unresolved`} · ${atsScanCounts.occupied} already filled · ${atsScanCounts.unsupported} unsupported · ${atsScanCounts.personal} answer yourself`;
  }
  updatePreparationStatus();
}
async function run(task, validate = true) {
  if (busy) return;
  const current = session;
  const unchanged = () => { if (validate) assertSession(current); };
  let complete;
  operationCompletion = new Promise(resolve => { complete = resolve; });
  busy = true; refresh();
  try {
    unchanged();
    if (validate) await validateSession();
    unchanged();
    await task(unchanged);
  } catch (error) {
    // An obsolete operation must not overwrite the next account's UI.
    if (!validate || session === current) {
      showRecovery(recoveryTool || activeTool);
      status(error.message || 'Operation failed. Try again.', true);
    }
  }
  finally { busy = false; refresh(); complete(); }
}
function assertSession(current) {
  if (!current || session !== current) throw new Error('Account connection changed. Read the page again.');
}
function clearDraft() {
  cancelPreparation();
  snapshot = null; editors.clear(); $('fields').replaceChildren(); resetSubmission();
  $('target').textContent = ''; $('submission-status').textContent = '';
}
function clearAtsReview() {
  cancelPreparation();
  atsFillState = 'idle';
  atsReview = null; atsAttachmentReview = null; atsScanCounts = null; atsEditors.clear(); $('ats-fields').replaceChildren();
  $('ats-attachment').hidden = true; $('ats-resume').replaceChildren(); $('ats-attach-result').textContent = '';
  $('ats-manual').replaceChildren(); $('ats-manual').hidden = true; $('ats-manual').open = false;
  $('ats-target').textContent = ''; $('ats-target').removeAttribute('title'); $('ats-result').textContent = '';
  refresh();
}
async function api(path, body, method = 'POST', timeout = 40000, signal) {
  const current = session;
  if (!current?.token?.startsWith('jpx_')) throw new Error('Connect through JobPilot first.');
  const response = await fetch(session.api + path, {
    method, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${current.token}`},
    body: JSON.stringify(body), signal: signal || AbortSignal.timeout(timeout),
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
  permissionVersion++; connectionGeneration++; connectionKey = ''; session = null; showRecovery(null); clearDraft(); clearAtsReview(); clearDeviceView();
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
  const tool = atsReview?.popupTarget?.tool || snapshot?.popupTarget?.tool || recoveryTool;
  clearDraft(); clearAtsReview();
  showRecovery(tool);
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
      const editor = {input, note, row, field: {...field, kind: 'text', available: true, draftable: field.id === 'applicant_summary'},
        source: input.value.trim() ? 'saved' : null, edited: false, widget: field.widget};
      input.addEventListener('input', () => { editor.edited = true; editor.source = 'user'; updateReason(); refresh(); });
      editors.set(field.id, editor); row.append(input, note);
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
  editors.set('applicant_countries', {input, note, row, source: countries?.nationality && countries?.campus ? 'saved' : null, widget: true, selects}); update();
}
async function loadInternSGPreview(target, currentSession, unchanged) {
  clearDraft(); clearAtsReview(); status('Loading saved answers…');
  const context = await resolveCapturedInternSG(chrome, target, currentSession, unchanged);
  unchanged();
  const [result] = await chrome.scripting.executeScript({target: {tabId: context.tabId, documentIds: [context.documentId]}, func: interactWithPage, args: ['inspect']});
  unchanged();
  if (!result?.result?.fields?.length || result.documentId !== context.documentId || result.result.url !== context.url) throw new Error('No supported form found. Open /job-apply/ on InternSG.');
  const current = {...context, ...result.result, documentId: result.documentId};
  const [widgetResult] = await chrome.scripting.executeScript({target: {tabId: context.tabId, documentIds: [result.documentId]}, world: 'MAIN', func: interactWithWidgets, args: ['inspect', current.url]});
  unchanged();
  const widgets = widgetResult?.result;
  if (!widgets) throw new Error('Could not inspect page widgets. Reload the page and try again.');
  current.widgets = widgets;
  const profile = await loadAutofillProfile(unchanged);
  current.profileFingerprint = profile.fingerprint;
  current.popupTarget = target;
  await assertPopupDocumentBinding(chrome, target, current, unchanged);
  const data = {values: {applicant_name: profile.values.full_name || '', applicant_email: profile.values.contact_email || '',
    applicant_contact: profile.values.phone || '', applicant_period: profile.values.availability_period || '', applicant_summary: profile.values.resume_summary || ''},
    countries: {nationality: profile.values.nationality || '', campus: profile.values.study_country || ''}};
  if (widgets.richReady) current.fields = current.fields.filter(f => f.id !== 'applicant_summary').concat({id: 'applicant_summary', label: 'Resume summary', maxLength: 3000, occupied: widgets.summaryOccupied, widget: true});
  else if (!current.fields.some(f => f.id === 'applicant_summary')) current.fields.push({id: 'applicant_summary', label: 'Resume summary', unavailable: widgets.summaryReason});
  for (const [id, label] of [['applicant_name', 'Full name'], ['applicant_email', 'Email address'], ['applicant_contact', 'Contact number'], ['applicant_period', 'Availability period']]) {
    if (!current.fields.some(f => f.id === id)) current.fields.push({id, label, unavailable: 'Field is missing, hidden, disabled or ambiguous. Complete it on the original page.'});
  }
  snapshot = current; $('target').textContent = `${snapshot.title} — ${snapshot.url}`;
  const values = {...data.values};
  render(snapshot.fields, values); renderCountries(widgets, data.countries);
  groupReadyAnswers($('fields'), editors);
  showRecovery(null); status('Saved answers loaded. Click Fill application form when ready. Nothing is submitted.');
  refresh();
  startPreparation(current, profile, editors);
}
async function loadAutofillProfile(unchanged, signal) {
  const data = await api('/browser-assistant/autofill-profile', undefined, 'GET', 8200, signal);
  unchanged();
  if (!data || typeof data.values !== 'object' || !data.fingerprint || !Array.isArray(data.resumes)) throw new Error('Update JobPilot before using saved PDF answers.');
  return data;
}
function atsSourceLink(text = 'Open Profile') {
  const link = document.createElement('a'); link.textContent = text;
  link.href = session.site + '/profile'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
async function loadATSPreview(target, currentSession, unchanged) {
  clearDraft(); clearAtsReview(); status('Loading saved answers…');
  await assertCapturedPopupTarget(chrome, target, unchanged);
  const results = await chrome.scripting.executeScript({target: {tabId: target.tabId}, func: interactWithATSPage, args: [{action: 'inspect'}]});
  unchanged();
  const response = parseATSInspectionResult(results, target.url);
  const review = response?.result;
  const profile = await loadAutofillProfile(unchanged);
  const mappings = []; // Known saved facts are immediate; current unanswered questions are prepared once below.
  const context = {...review, tabId: target.tabId, documentId: response.documentId, profileFingerprint: profile.fingerprint, popupTarget: target};
  await assertPopupDocumentBinding(chrome, target, context, unchanged);
  const manualQuestions = new Map((review.manualQuestions || []).map(question => [question, question]));
  atsScanCounts = {occupied: 0, unsupported: 0, personal: 0};
  for (const field of review.fields) {
    if (field.manualOnly) {
      const personal = /sensitive|declaration|completion|employer-specific|self-assessment/i.test(field.manualReason || '');
      atsScanCounts[personal ? 'personal' : 'unsupported']++;
      manualQuestions.set(field.label, `${field.label}: ${field.manualReason || 'complete this on the original website.'}`);
      continue;
    }
    if (!field.available || field.occupied) {
      atsScanCounts[field.occupied ? 'occupied' : 'unsupported']++;
      manualQuestions.set(field.label || field.id, `${field.label || field.id}: ${field.occupied ? 'already answered; left unchanged' : 'not supported; check on the website'}.`);
      continue;
    }
    const row = document.createElement('div'); row.className = 'field';
    if (['first_name', 'last_name'].includes(field.id)) row.classList.add('field-name');
    const label = document.createElement('label');
    label.textContent = field.label || field.id.replaceAll('_', ' ');
    const {key: factKey, value: factValue, candidate} = autofillSuggestion(field, profile, mappings);
    const isSelect = field.kind === 'select';
    const input = document.createElement(isSelect ? 'select' : field.kind === 'text' && (field.draftable || ['education', 'experience', 'skills', 'resume_summary', 'availability_period'].includes(factKey)) ? 'textarea' : 'input');
    input.id = 'ats-' + field.id; label.htmlFor = input.id;
    if (isSelect) {
      input.add(new Option('Choose an answer', ''));
      for (const option of field.options || []) input.add(new Option(option.label, option.value));
      input.value = factValue;
    } else {
      input.maxLength = field.maxLength || 10000;
      if (input instanceof HTMLInputElement) input.type = field.kind === 'date' ? 'date' : field.kind === 'number' ? 'number'
        : field.id === 'email' ? 'email' : field.id === 'phone' ? 'tel' : ['linkedin', 'github', 'portfolio'].includes(factKey) ? 'url' : 'text';
      input.value = factValue;
      input.placeholder = autofillPlaceholder(field, factKey);
    }
    if (field.kind === 'combobox' && field.options?.length) {
      const choices = document.createElement('datalist'); choices.id = 'choices-' + input.id;
      for (const option of field.options) choices.append(new Option(option.label, option.value));
      input.setAttribute('list', choices.id); row.append(choices);
    }
    const note = document.createElement('p'); note.className = 'field-reason'; note.id = 'source-' + input.id;
    if (!input.value) {
      const savedValue = profile.values[factKey];
      if (savedValue?.length > (field.maxLength || 10000)) note.textContent = 'Saved answer is too long. Write a shorter answer here.';
      else if (savedValue) note.textContent = 'Your saved answer needs a different choice or format here. Review this field or complete it on the website.';
      else note.textContent = 'AI is checking your saved PDF and profile for this question. You can edit here.';
      input.setAttribute('aria-describedby', note.id);
    } else {
      const source = profile.sources?.[factKey];
      if (candidate) note.textContent = 'Will search the original form; only an exact option will be selected.';
      else if (source?.source === 'resume' && field.needsMapping) note.textContent = `Saved PDF · ${factKey.replaceAll('_', ' ')}`;
      else note.hidden = true;
      input.setAttribute('aria-describedby', note.hidden ? 'ats-profile-note' : note.id);
    }
    if (field.requiresWebsiteChoice) {
      note.hidden = false; note.append(' Choose the suggested location on the website.');
      input.setAttribute('aria-describedby', note.id);
    }
    const editor = {input, field, factKey, note, row, templateValue: null, source: input.value.trim() ? 'saved' : null, edited: false};
    const edited = () => {
      const pending = ['pending_confirmation', 'unfinished'].includes(editor.source) && input.value.trim() === editor.templateValue;
      editor.edited = true; editor.source = pending ? editor.source : 'user';
      note.hidden = false;
      note.textContent = pending ? 'Pending text, not a completed answer. Replace before submitting.' : 'Your entry for this application only.';
      if (field.requiresWebsiteChoice) note.append(' Choose the suggested location on the website.');
      refresh();
    };
    input.addEventListener('input', edited);
    input.addEventListener('change', edited);
    row.append(label, input, note); $('ats-fields').append(row);
    atsEditors.set(field.id, editor);
  }
  if (manualQuestions.size) {
    const title = document.createElement('summary'); title.textContent = `Other fields to check (${manualQuestions.size})`;
    const limit = document.createElement('p'); limit.textContent = 'This scan is partial. Review the complete form, including personal declarations and consent.';
    const list = document.createElement('ul');
    for (const question of manualQuestions.values()) { const item = document.createElement('li'); item.textContent = question; list.append(item); }
    $('ats-manual').append(title, limit, list); $('ats-manual').hidden = false;
  }
  atsReview = context;
  const resumeTarget = review.resumeTarget;
  if (resumeTarget && !resumeTarget.multiple && !resumeTarget.occupied && profile.resume?.sha256) {
    atsAttachmentReview = {...context, resume: profile.resume, resumeTarget};
    $('ats-resume').textContent = profile.resume.filename;
    $('ats-attachment').hidden = false;
  } else if (resumeTarget) {
    $('ats-resume').replaceChildren(document.createTextNode(resumeTarget.occupied ? 'A file is already attached; it will not be replaced.' : 'Choose and read your PDF in Profile first. '), atsSourceLink());
    $('ats-attachment').hidden = false;
  }
  $('ats-target').textContent = new URL(review.url).hostname; $('ats-target').title = review.url;
  $('ats-result').textContent = 'Nothing is submitted.';
  groupReadyAnswers($('ats-fields'), atsEditors);
  showRecovery(null); status('Saved answers loaded. Missing answers can be added here or on the website.'); refresh();
  const scroller = $('workspace-content');
  scroller.scrollTop += $('ats-fields').getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  startPreparation(context, profile, atsEditors);
}
$('ats-fill').addEventListener('click', () => {
  if (busy || !atsReview) return;
  const current = atsReview;
  const pending = preparation?.context === current && preparation.status === 'preparing' ? preparation : null;
  const initialApproved = approvedAutofillAnswers(atsEditors);
  if (pending) { pending.awaitedForFill = true; atsFillState = 'waiting'; }
  run(async unchanged => {
    if (pending) { await pending.promise; unchanged(); }
    const approved = mergePreparedApproval(initialApproved, pending, atsEditors, approvedAutofillAnswers(atsEditors));
    cancelPreparation();
    if (atsReview !== current || !approved.length) throw new Error('Read and review the form again.');
    const latest = await loadAutofillProfile(unchanged);
    if (atsReview !== current) throw new Error('The form review changed. Read the form again.');
    if (latest.fingerprint !== current.profileFingerprint) { clearAtsReview(); throw new Error('Your saved answers changed. Read the form again. Nothing was filled.'); }
    await assertPopupDocumentBinding(chrome, current.popupTarget, current, unchanged);
    if (atsReview !== current) throw new Error('The form review changed. Refresh the form before filling.');
    atsReview = null; atsFillState = 'filling'; refresh(); $('ats-result').textContent = 'Copying answers to the application…';
    let response;
    try { [response] = await chrome.scripting.executeScript({target: {tabId: current.tabId, documentIds: [current.documentId]},
      func: interactWithATSPage, args: [{action: 'fill', expectedUrl: current.url, approved}]}); }
    catch { unchanged(); atsFillState = 'uncertain'; $('ats-result').textContent = ''; throw new Error('Fill was interrupted. Check the original page, then choose Refresh form. Nothing was submitted.'); }
    unchanged();
    let report;
    try { report = checkedFillResult(parseATSFillResult([response], current.documentId), approved); }
    catch (error) {
      atsFillState = error.fillRejected ? 'rejected' : 'uncertain';
      $('ats-result').textContent = '';
      throw error.fillRejected ? error : new Error('Could not verify filling. Check the original page, then choose Refresh form. Nothing was submitted.');
    }
    atsFillState = 'complete';
    if (atsScanCounts) atsScanCounts.occupied += report.filled.length;
    for (const id of report.filled) atsEditors.delete(id);
    showRecovery('ats-tools');
    $('ats-result').textContent = `Filled ${report.filled.length}; skipped ${report.skipped.length}. ${report.needsWebsiteChoice.length ? `${report.needsWebsiteChoice.length} website choice${report.needsWebsiteChoice.length === 1 ? '' : 's'} still needed. ` : ''}${report.needsCorrection.length ? `${report.needsCorrection.length} copied answer${report.needsCorrection.length === 1 ? '' : 's'} need${report.needsCorrection.length === 1 ? 's' : ''} editing on the website. ` : ''}Nothing was submitted.`;
  });
});
$('ats-attach').addEventListener('click', () => {
  if (busy || !atsAttachmentReview) return;
  const current = atsAttachmentReview;
  run(async unchanged => {
    const latest = await loadAutofillProfile(unchanged);
    if (atsAttachmentReview !== current || latest.fingerprint !== current.profileFingerprint) throw new Error('Saved answers or PDF selection changed. Read the form again before attaching.');
    await assertPopupDocumentBinding(chrome, current.popupTarget, current, unchanged);
    const resume = current.resume;
    const file = await api('/browser-assistant/resume-content', {page_url: current.url, resume_id: resume.id, sha256: resume.sha256, confirmed: true});
    unchanged();
    if (file.resume_id !== resume.id || file.page_url !== current.url || file.sha256 !== resume.sha256 || typeof file.base64 !== 'string'
        || !file.filename?.toLowerCase().endsWith('.pdf') || !Number.isSafeInteger(file.size_bytes) || file.size_bytes < 1 || file.size_bytes > 2 * 1024 * 1024) throw new Error('Could not verify this saved PDF. Nothing was attached.');
    await assertPopupDocumentBinding(chrome, current.popupTarget, current, unchanged);
    if (atsAttachmentReview !== current) throw new Error('The form review changed. Refresh before attaching.');
    atsAttachmentReview = null; refresh(); $('ats-attach-result').textContent = 'Uploading your selected PDF…';
    const [response] = await chrome.scripting.executeScript({target: {tabId: current.tabId, documentIds: [current.documentId]}, func: interactWithATSPage,
      args: [{action: 'attach', expectedUrl: current.url, targetKey: current.resumeTarget.key, targetLabel: current.resumeTarget.label, confirmed: true,
        file: {name: file.filename, base64: file.base64, sha256: file.sha256, size_bytes: file.size_bytes}}]});
    unchanged();
    const result = response?.result;
    if (result?.submitted !== false || typeof result.selected !== 'boolean' || !['selected_on_form', 'check_original_website'].includes(result.upload_status)) throw new Error('Attachment result is uncertain. Check the original form before trying again.');
    $('ats-attach-result').textContent = result.selected
      ? 'PDF selected on the form. Check the website for upload status. No application was submitted.'
      : 'Check the original website to confirm the PDF upload before trying again. No application was submitted.';
  });
});
$('fill').addEventListener('click', () => {
  if (busy || !snapshot) return;
  const current = snapshot;
  const pending = preparation?.context === current && preparation.status === 'preparing' ? preparation : null;
  const project = () => [...editors].filter(([, e]) => !e.blocked && e.input.value.trim()).map(([id, e]) => ({id, value: e.input.value, confirmed: true, widget: !!e.widget}));
  const initialApproved = project();
  if (pending) pending.awaitedForFill = true;
  run(async unchanged => {
  let dispatched = false;
  try {
   if (pending) { await pending.promise; unchanged(); }
   const approved = mergePreparedApproval(initialApproved, pending, editors, project());
   cancelPreparation();
  resetSubmission();
  if (snapshot !== current) throw new Error('The form review changed. Read the page again.');
  const latest = await loadAutofillProfile(unchanged);
  if (latest.fingerprint !== current.profileFingerprint) {
    clearDraft(); throw new Error('Your saved answers changed. Read the page again. Nothing was filled.');
  }
  await assertPopupDocumentBinding(chrome, current.popupTarget, current, unchanged);
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
    await assertPopupDocumentBinding(chrome, current.popupTarget, current, unchanged);
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
$('prepare-submit').addEventListener('click', () => SUBMISSION_ENABLED && run(async unchanged => {
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
$('send-application').addEventListener('click', () => SUBMISSION_ENABLED && run(async unchanged => {
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
$('check-result').addEventListener('click', () => SUBMISSION_ENABLED && run(async unchanged => {
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
function showCurrentTools(target) {
  activeTool = target?.tool || null;
  for (const id of ['original-tools', 'ats-tools']) $(id).open = false;
  $('active-tool').textContent = target ? target.tool === 'ats-tools' ? 'Current application · ATS' : 'Current application · InternSG' : 'Open a supported application form';
  if (!target) return;
  $(target.tool).open = true;
  const other = $(target.tool === 'ats-tools' ? 'original-tools' : 'ats-tools');
  $('workspace-content').insertBefore($(target.tool), other);
}
async function loadCapturedPreview(target, current, unchanged) {
  try {
    await assertCapturedPopupTarget(chrome, target, unchanged);
    if (target.mode === 'ats') await loadATSPreview(target, current, unchanged);
    else await loadInternSGPreview(target, current, unchanged);
  } catch (error) {
    unchanged();
    clearDraft(); clearAtsReview(); showRecovery(target.tool);
    throw error;
  }
}
async function refreshCurrentForm() {
  if (busy || !session) return;
  const current = session;
  return run(async unchanged => {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    unchanged();
    const target = capturePopupTarget(tab, current);
    if (!target) { clearDraft(); clearAtsReview(); showCurrentTools(null); showRecovery(null); throw new Error('Open the original supported application form, then reopen the extension.'); }
    showCurrentTools(target);
    await loadCapturedPreview(target, current, unchanged);
  });
}
$('inspect').addEventListener('click', refreshCurrentForm);
$('ats-inspect').addEventListener('click', refreshCurrentForm);
async function restoreConnection(savedOverride, hasOverride = false) {
  const version = ++restoreVersion;
  const saved = hasOverride ? savedOverride : (await chrome.storage.session.get('jobpilotSession')).jobpilotSession;
  if (version !== restoreVersion) return;
  const nextKey = popupConnectionKey(saved);
  // Storage may emit the same grant repeatedly. Keep its in-flight/loaded preview.
  if (nextKey && nextKey === connectionKey && session) return initialization;
  if (!nextKey && !session && !connectionKey) { $('login').hidden = false; $('workspace').hidden = true; return; }
  const generation = ++connectionGeneration;
  connectionKey = nextKey; session = nextKey ? saved : null;
  const current = session;
  const unchanged = () => { assertSession(current); if (generation !== connectionGeneration) throw new Error('Account connection changed. Reopen the extension.'); };
  for (const id of ['settings', 'local-profile', 'original-tools', 'advanced-submission', 'ats-tools']) $(id).open = false;
  clearDraft(); clearAtsReview(); clearDeviceView(); showRecovery(null);
  $('login').hidden = !!current; $('workspace').hidden = !current;
  if (!current) { refresh(); return; }
  status('Loading saved answers…');
  // Capture once before auth/profile awaits. Later checks may abort but never retarget.
  const targetPromise = chrome.tabs.query({active: true, currentWindow: true}).then(([tab]) => capturePopupTarget(tab, current));
  const previousOperation = operationCompletion;
  initialization = (async () => {
    let target;
    try {
      target = await targetPromise;
      await previousOperation;
      unchanged();
      return await run(async operationUnchanged => {
        unchanged(); operationUnchanged();
        await loadLocal(); unchanged();
        $('open-jobpilot').href = current.site + '/jobs';
        await refreshEmbeddedAccess(); unchanged();
        showCurrentTools(target); $('workspace').hidden = false;
        if (!target) { status('Open the original InternSG, Greenhouse, Lever or Ashby application form, then reopen this extension.'); return; }
        await loadCapturedPreview(target, current, () => { unchanged(); operationUnchanged(); });
      });
    } catch (error) {
      if (session === current && generation === connectionGeneration) {
        showRecovery(target?.tool || null); status(error.message || 'Could not load the form. Refresh once it is ready.', true);
      }
    }
  })();
  return initialization;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.jobpilotSession) restoreConnection(changes.jobpilotSession.newValue, true).catch(() => {});
});
try {
  await chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  await chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
  await restoreConnection();
} catch { status('Session storage unavailable. Reopen the extension.', true); }
refresh();
