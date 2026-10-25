// Popup-only exact matching of explicit saved facts. No residence/telephone inference.
export function matchATSSelectOption(field, savedValue) {
  if (!['select', 'combobox'].includes(field?.kind) || typeof savedValue !== 'string'
      || !savedValue.trim() || !Array.isArray(field.options)) return '';
  const norm = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const facts = new Set([norm(savedValue)]);
  const callingCode = field.evidenceKey === 'phone_country_code' && /^\+\d{1,3}$/.test(savedValue.trim()) ? savedValue.trim() : null;
  const countryCode = ['nationality_country', 'study_country', 'current_country'].includes(field.evidenceKey)
      && /^[A-Za-z]{2}$/.test(savedValue.trim());
  if (countryCode) {
    try { facts.add(norm(new Intl.DisplayNames(['en'], {type: 'region'}).of(savedValue.trim().toUpperCase()))); }
    catch { /* Missing display-name support never justifies a guess. */ }
  }
  if (/^education_(?:start|end)_month$/.test(field.evidenceKey || '') && /^(?:0?[1-9]|1[0-2])$/.test(savedValue)) {
    facts.add(norm(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(savedValue) - 1]));
  }
  const matches = field.options.filter(option => typeof option.value === 'string' && option.value.trim()
    && typeof option.label === 'string' && (facts.has(norm(option.value)) || facts.has(norm(option.label))
      || (callingCode && norm(option.label).endsWith(' ' + callingCode)))
    && (!countryCode || norm(option.value) !== norm(savedValue) || facts.has(norm(option.label))));
  if (matches.length && field.evidenceKey !== 'school') return matches.length === 1 ? matches[0].value : '';
  if (field.evidenceKey === 'degree') {
    // Only a separately verified degree fact enters this explicit taxonomy. It
    // never scans education prose or converts an ongoing course into graduation.
    const family = value => {
      const compact = norm(value).replace(/[.'’\s-]/g, '');
      if (/^(?:master(?:sdegree|degree)?|masterof(?:technology|science|engineering|arts|computing)|m(?:tech|sc|eng|comp))$/.test(compact)) return 'master';
      if (/^(?:bachelor(?:sdegree|degree)?|bachelorof(?:technology|science|engineering|arts|computing)|b(?:tech|sc|eng|comp))$/.test(compact)) return 'bachelor';
      if (/^(?:phd|doctorofphilosophy(?:\(phd\))?|doctoraldegree|doctorate)$/.test(compact)) return 'doctorate';
      return null;
    };
    const expected = family(savedValue);
    const compact = value => norm(value).replace(/[.'’\s-]/g, '');
    const generic = {master: new Set(['master', 'masterdegree', 'mastersdegree']),
      bachelor: new Set(['bachelor', 'bachelordegree', 'bachelorsdegree']), doctorate: new Set(['doctorate', 'doctoraldegree'])};
    const specifics = [['mtech', 'masteroftechnology'], ['msc', 'masterofscience'], ['meng', 'masterofengineering'],
      ['mcomp', 'masterofcomputing'], ['masterofarts'], ['btech', 'bacheloroftechnology'], ['bsc', 'bachelorofscience'],
      ['beng', 'bachelorofengineering'], ['bcomp', 'bachelorofcomputing'], ['bachelorofarts'],
      ['phd', 'doctorofphilosophy', 'doctorofphilosophy(phd)']];
    const candidates = expected ? field.options.filter(option => typeof option.value === 'string'
      && option.value.trim() && typeof option.label === 'string' && family(option.label) === expected
      && (generic[expected].has(compact(option.label))
        || specifics.some(values => values.includes(compact(savedValue)) && values.includes(compact(option.label))))) : [];
    return candidates.length === 1 ? candidates[0].value : '';
  }
  if (field.evidenceKey === 'school') {
    const canonical = value => {
      const match = value.trim().match(/^(.+?)\s+\(([A-Z]{2,10})\)$/);
      if (!match) return value.trim();
      const words = match[1].match(/[A-Za-z]+/g) || [];
      const initials = words.filter(word => !['of', 'the', 'and', 'for', 'in', 'at'].includes(word.toLowerCase()))
        .map(word => word[0].toUpperCase()).join('');
      return initials === match[2] ? match[1].trim() : value.trim();
    };
    const expected = canonical(savedValue);
    const candidates = field.options.filter(option => typeof option.value === 'string' && option.value.trim()
      && typeof option.label === 'string' && norm(canonical(option.label)) === norm(expected));
    return candidates.length === 1 ? candidates[0].value : '';
  }
  return '';
}

// Chrome can resolve InjectionResult[] without result after a page-script error.
// Keep execution/inspection failure distinct from unsupported or missing form data.
export function parseATSInspectionResult(results, expectedUrl = '') {
  if (!Array.isArray(results) || results.length !== 1 || !results[0]
      || (results[0].frameId !== undefined && results[0].frameId !== 0)) {
    throw new Error('Chrome did not return one bound application document. Reopen the extension on the original form.');
  }
  const response = results[0], review = response.result;
  if (review?.inspection_version === 1 && review.ok === false) {
    const allowed = new Set(['unsupported_page', 'page_changed', 'dropdown_changed', 'ambiguous_fields', 'form_not_ready', 'reader_failed']);
    const code = allowed.has(review.error?.code) ? review.error.code : 'reader_failed';
    const messages = {unsupported_page: 'This page URL is not a supported hosted application. Open the canonical application from JobPilot.',
      page_changed: 'The application page changed while reading. Read the original form again.',
      dropdown_changed: 'A dropdown selection changed while reading. Check the original form before reading again.',
      ambiguous_fields: 'Some application fields have ambiguous identifiers. Complete those questions on the original website.',
      form_not_ready: 'The application form is still loading. Wait for it to appear, then choose Refresh form.',
      reader_failed: 'The ATS reader could not finish checking this form. Reopen the extension and read it again.'};
    const stage = /^[a-z_]{1,40}$/.test(review.error?.stage || '') ? review.error.stage : 'inspect';
    throw new Error(`${messages[code]} [${code}:${stage}]`);
  }
  if (typeof response.documentId !== 'string' || !response.documentId) {
    throw new Error('Chrome could not bind this application document. Reload the extension and original form before trying again.');
  }
  if (!review || typeof review.url !== 'string' || !Array.isArray(review.fields)
      || !['Greenhouse', 'Lever', 'Ashby'].includes(review.provider)) {
    throw new Error('Chrome returned no usable ATS inspection result. Reopen the extension and read the original form again. [missing_inspection_result]');
  }
  if (expectedUrl && review.url !== expectedUrl) throw new Error('The application URL changed while reading. Read the original form again.');
  return response;
}

// A rejected preflight is different from a lost response after a write. Never
// claim that a missing Chrome result proves nothing happened on the website.
export function parseATSFillResult(results, expectedDocumentId = '') {
  const fail = (message, rejected = false, code = 'missing_fill_result', stage = 'transport', detail = null) => {
    const error = new Error(message); error.fillRejected = rejected; error.fillUncertain = !rejected;
    error.fillCode = code; error.fillStage = stage;
    if (detail) {
      if (detail.field_id) error.fillFieldId = detail.field_id;
      error.fillMismatch = detail.mismatch;
      if (detail.expected_evidence_type) {
        error.fillExpectedEvidenceType = detail.expected_evidence_type;
        error.fillReceivedEvidenceType = detail.received_evidence_type;
      }
    }
    throw error;
  };
  if (!Array.isArray(results) || results.length !== 1 || !results[0]
      || (results[0].frameId !== undefined && results[0].frameId !== 0)
      || typeof results[0].documentId !== 'string' || !results[0].documentId
      || (expectedDocumentId && results[0].documentId !== expectedDocumentId)) {
    fail('Chrome could not verify the fill response. Check the original page before refreshing. Nothing was submitted.');
  }
  const result = results[0].result;
  if (result?.fill_version === 1 && result.ok === false) {
    const messages = {
      unsupported_page: 'The application URL is no longer supported.', url_changed: 'The application URL changed.',
      page_changed: 'The application page changed.', ambiguous_fields: 'The application controls became ambiguous.',
      invalid_review: 'Invalid reviewed answers. The form questions changed since this preview.',
      option_changed: 'The reviewed field or option changed.', invalid_choice: 'Select one exact reviewed dropdown label.',
      invalid_date: 'Use a real ISO date for the reviewed answer.', fill_failed: 'The form reader could not verify the fill.'};
    const code = Object.hasOwn(messages, result.error?.code) ? result.error.code : 'fill_failed';
    const stage = /^[a-z_]{1,40}$/.test(result.error?.stage || '') ? result.error.stage : 'fill';
    const mismatchKinds = new Set(['missing_field', 'manual_only', 'unavailable', 'key', 'label', 'kind', 'evidence_key', 'max_length',
      'action', 'answers_type', 'answers_count', 'duplicate_id', 'item_shape', 'id_type', 'value_type', 'empty_value', 'value_limit', 'confirmation', 'incompatible_answers']);
    const fieldId = /^(?:field:[a-z0-9]{1,10}|first_name|last_name|full_name|email|phone)$/.test(result.error?.field_id || '') ? result.error.field_id : null;
    const detail = code === 'invalid_review' && mismatchKinds.has(result.error?.mismatch)
      ? {mismatch: result.error.mismatch, ...(fieldId ? {field_id: fieldId} : {})} : null;
    const evidenceTypes = new Set(['missing', 'null', 'string', 'boolean', 'number', 'object', 'array', 'other']);
    if (detail?.mismatch === 'evidence_key' && evidenceTypes.has(result.error?.expected_evidence_type)
        && evidenceTypes.has(result.error?.received_evidence_type)) {
      detail.expected_evidence_type = result.error.expected_evidence_type;
      detail.received_evidence_type = result.error.received_evidence_type;
    }
    const rejected = result.mutation_started === false;
    fail(messages[code] + (rejected ? ' Nothing was filled. Refresh the form before trying again.'
      : ' Some answers may have changed. Check the original page before refreshing.')
      + ` [${code}:${stage}${detail ? ':' + (detail.field_id || 'approved') + '/' + detail.mismatch
        + (detail.expected_evidence_type ? '(' + detail.expected_evidence_type + '/' + detail.received_evidence_type + ')' : '') : ''}]`, rejected, code, stage, detail);
  }
  if (!result || result.submitted !== false || !Array.isArray(result.filled) || !Array.isArray(result.skipped)) {
    fail('Fill result is uncertain. Check the original page before refreshing. Nothing was submitted.');
  }
  return result;
}

// Serialized into the active original-site document. Keep all injected helpers inside.
// Each call is one attempt. It never clicks submit, consent or CAPTCHA controls.
export async function interactWithATSPage({action, expectedUrl = '', approved = [], targetKey = '', targetLabel = '', file = null, confirmed = false}) {
  let diagnosticStage = 'validate_page';
  let mutationStarted = false;
  let reviewMismatch = null;
  try {
  const url = new URL(location.href);
  const greenhousePath = url.pathname.match(/^\/[A-Za-z0-9_-]+\/jobs\/([0-9]+)\/?$/);
  const greenhouse = ['job-boards.greenhouse.io', 'boards.greenhouse.io', 'job-boards.eu.greenhouse.io'].includes(url.hostname)
    && !!greenhousePath && (!url.search || url.search === `?gh_jid=${greenhousePath[1]}`);
  const lever = ['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname)
    && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\/apply\/?$/.test(url.pathname) && !url.search;
  const ashby = url.hostname === 'jobs.ashbyhq.com'
    && /^\/[A-Za-z0-9_-]+\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/application\/?$/i.test(url.pathname) && !url.search;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !(greenhouse || lever || ashby)) {
    throw new Error('Open a supported Greenhouse, Lever or Ashby hosted application form.');
  }
  if (action !== 'inspect' && location.href !== expectedUrl) throw new Error('Application URL changed. Read the form again.');
  const initialUrl = location.href;
  const norm = value => (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const visible = node => !!node && !node.disabled && !node.readOnly && node.getClientRects().length > 0
    && node.getAttribute('aria-hidden') !== 'true' && getComputedStyle(node).visibility !== 'hidden';
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const samePage = () => {
    if (location.href !== initialUrl || document.defaultView?.closed) throw new Error('Application page changed. Read it again.');
  };
  const canonicalSchoolName = value => {
    const match = value.trim().match(/^(.+?)\s+\(([A-Z]{2,10})\)$/);
    if (!match) return value.trim();
    const words = match[1].match(/[A-Za-z]+/g) || [];
    const initials = words.filter(word => !['of', 'the', 'and', 'for', 'in', 'at'].includes(word.toLowerCase()))
      .map(word => word[0].toUpperCase()).join('');
    return initials === match[2] ? match[1].trim() : value.trim();
  };
  const byId = id => {
    if (!id) return null;
    const matches = [...document.querySelectorAll('[id]')].filter(node => node.id === id);
    return matches.length === 1 ? matches[0] : null;
  };
  diagnosticStage = 'read_form_scope';
  const basicSelectors = greenhouse ? {
    first_name: ['first_name', 'job_application[first_name]'], last_name: ['last_name', 'job_application[last_name]'],
    email: ['email', 'job_application[email]'], phone: ['phone', 'job_application[phone]'],
  } : ashby ? {full_name: ['_systemfield_name'], email: ['_systemfield_email']}
    : {full_name: ['name'], email: ['email'], phone: ['phone']};
  const readIdentity = () => {
    const allDocumentControls = [...document.querySelectorAll('input, textarea, select')];
    const ids = new Map(); let ambiguous = false;
    for (const [id, names] of Object.entries(basicSelectors)) {
      const nodes = allDocumentControls.filter(node => node instanceof HTMLInputElement
        && ['text', 'email', 'tel'].includes(node.type) && visible(node)
        && (names.includes(node.name) || (greenhouse && node.id === id) || (!greenhouse && !ashby && node.id === id.replace('full_', ''))));
      if (nodes.length === 1) ids.set(nodes[0], id);
      if (nodes.length > 1) ambiguous = true;
    }
    return {ids, ambiguous};
  };
  let identity = readIdentity();
  if (ashby && action === 'inspect' && identity.ids.size < 2 && !identity.ambiguous) {
    diagnosticStage = 'wait_form';
    // Ashby hydrates the real form after its separate résumé parser. This is a
    // bounded DOM-only wait, never a page/network/model retry or a field write.
    for (let attempt = 0; attempt < 20 && identity.ids.size < 2 && !identity.ambiguous; attempt++) {
      await wait(100); samePage(); identity = readIdentity();
    }
  }
  const basicIds = identity.ids;
  let scope = null;
  if (ashby) {
    const anchors = [...new Set([...basicIds.keys()].map(node => node.closest('.ashby-application-form-container')))];
    if (identity.ambiguous || anchors.length > 1) throw new Error('Ambiguous application fields. Complete this form manually.');
    if (basicIds.size === 2 && anchors.length === 1 && anchors[0]?.getClientRects().length > 0) scope = anchors[0];
    if (action === 'inspect' && !scope) throw new Error('Application form is still loading. Wait for it to appear, then refresh the form.');
  } else {
    const forms = [...new Set([...basicIds.keys()].map(node => node.form).filter(Boolean))];
    if (forms.length === 1) scope = forms[0];
  }
  const inScope = node => !!scope && scope.contains(node) && (ashby
    ? node.closest('.ashby-application-form-container') === scope : node.form === scope);
  const controls = scope ? [...scope.querySelectorAll('input, textarea, select')].filter(inScope) : [];
  const ashbyEducationPart = node => {
    if (!ashby || !inScope(node)) return null;
    const row = node.closest('.ashby-application-form-field-entry');
    if (!row || row.getAttribute('data-field-path') !== '_systemfield_education_history') return null;
    const rows = [...scope.querySelectorAll('.ashby-application-form-field-entry')]
      .filter(candidate => candidate.getAttribute('data-field-path') === '_systemfield_education_history');
    if (rows.length !== 1 || rows[0] !== row) return null;
    const captions = target => [...row.querySelectorAll('label')].filter(label => label.getAttribute('for') === target
      && label.closest('.ashby-application-form-field-entry') === row);
    const schoolLabels = captions('_systemfield_education_history-school');
    if (schoolLabels.length === 1 && norm(schoolLabels[0].textContent).toLowerCase() === 'school') {
      const wrapper = schoolLabels[0].parentElement;
      const inputs = wrapper ? [...wrapper.querySelectorAll('input')].filter(candidate => inScope(candidate) && visible(candidate)) : [];
      if (inputs.length === 1 && inputs[0] === node && node.getAttribute('role') === 'combobox'
          && node.classList.contains('ashby-application-form-input-autocomplete')) {
        return {key: 'ashby:_systemfield_education_history-school', label: 'School', evidenceKey: 'school', wrapper};
      }
    }
    if (!(node instanceof HTMLSelectElement)) return null;
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const selectPart = select => {
      const options = [...select.options].filter(option => option.value.trim());
      if (options.length === 12 && new Set(options.map(option => option.value)).size === 12
          && options.every(option => /^(?:[1-9]|1[0-2])$/.test(option.value)
            && norm(option.textContent) === monthNames[Number(option.value) - 1])) return 'month';
      if (options.length > 1 && options.length <= 200 && options.every(option => /^(?:19|20)\d{2}$/.test(option.value)
          && norm(option.textContent) === option.value) && new Set(options.map(option => option.value)).size === options.length) return 'year';
      return null;
    };
    for (const edge of ['start', 'end']) {
      const id = `_systemfield_education_history-${edge}Date`, container = byId(id), labels = captions(id);
      if (!container || !row.contains(container) || container.closest('.ashby-application-form-field-entry') !== row
          || labels.length !== 1 || norm(labels[0].textContent).toLowerCase() !== `${edge} date`) continue;
      const selects = [...container.querySelectorAll('select')].filter(candidate => inScope(candidate) && visible(candidate));
      if (selects.length !== 2 || !selects.includes(node)) continue;
      const parts = selects.map(selectPart);
      if (parts.filter(part => part === 'month').length !== 1 || parts.filter(part => part === 'year').length !== 1) continue;
      const part = selectPart(node);
      return {key: `ashby:${id}-${part}`, label: `Education ${edge} ${part}`,
        evidenceKey: `education_${edge}_${part}`};
    }
    return null;
  };
  const ashbyAutocomplete = node => {
    if (!ashby || !inScope(node) || node.getAttribute('role') !== 'combobox'
        || !node.classList.contains('ashby-application-form-input-autocomplete')
        || node.getAttribute('aria-autocomplete') !== 'list' || node.getAttribute('aria-haspopup') !== 'listbox') return null;
    const education = ashbyEducationPart(node);
    if (education?.evidenceKey === 'school') return {...education, wrapper: node.parentElement, purpose: 'school'};
    const row = node.closest('.ashby-application-form-field-entry');
    if (!row || row.getAttribute('data-field-path') !== '_systemfield_location') return null;
    const rows = [...scope.querySelectorAll('.ashby-application-form-field-entry')]
      .filter(candidate => candidate.getAttribute('data-field-path') === '_systemfield_location');
    const labels = [...row.querySelectorAll('label')].filter(label => label.getAttribute('for') === '_systemfield_location'
      && label.closest('.ashby-application-form-field-entry') === row);
    const inputs = [...row.querySelectorAll('input, textarea, select')].filter(candidate => visible(candidate)
      && !['hidden', 'file', 'button', 'submit', 'reset'].includes(candidate.type));
    if (rows.length !== 1 || rows[0] !== row || labels.length !== 1
        || norm(labels[0].textContent) !== 'Where are you currently based?' || inputs.length !== 1 || inputs[0] !== node) return null;
    return {key: 'ashby:_systemfield_location', label: norm(labels[0].textContent), evidenceKey: 'current_city',
      wrapper: node.parentElement, purpose: 'city'};
  };
  const coverLetterState = () => {
    if (!greenhouse || !scope) return null;
    const caption = byId('upload-label-cover_letter'), file = byId('cover_letter');
    const group = caption?.closest('.file-upload');
    const buttons = group ? [...group.querySelectorAll('button')].filter(button => button.getAttribute('data-testid') === 'cover_letter-text') : [];
    const files = group ? [...group.querySelectorAll('input')].filter(input => input.type === 'file') : [];
    const textarea = byId('cover_letter_text');
    if (!group || !scope.contains(group) || group.getAttribute('role') !== 'group'
        || group.getAttribute('aria-labelledby') !== 'upload-label-cover_letter' || !visible(caption)
        || norm(caption.textContent).toLowerCase() !== 'cover letter' || files.length !== 1 || files[0] !== file
        || !file || !inScope(file) || file.disabled || buttons.length !== 1 || buttons[0].getAttribute('type') !== 'button'
        || (textarea && (!(textarea instanceof HTMLTextAreaElement) || !inScope(textarea) || !group.contains(textarea)))) return null;
    return {group, file, button: buttons[0], textarea};
  };
  const leverAnswerRow = node => {
    if (!lever) return null;
    const row = node.closest('li');
    const labels = row ? [...row.querySelectorAll('.application-label')].filter(candidate => candidate.closest('li') === row) : [];
    const answerControls = row ? [...row.querySelectorAll('input, textarea, select')]
      .filter(candidate => candidate.closest('li') === row && inScope(candidate) && visible(candidate)
        && !['hidden', 'button', 'submit', 'reset'].includes(candidate.type)) : [];
    return labels.length === 1 && answerControls.length === 1 && answerControls[0] === node
      ? {row, label: norm(labels[0].textContent)} : null;
  };
  const labelOf = node => {
    if (greenhouse && node.id === 'cover_letter_text' && coverLetterState()?.textarea === node) return 'Cover letter';
    const autocomplete = ashbyAutocomplete(node);
    if (autocomplete) return autocomplete.label;
    const educationPart = ashbyEducationPart(node);
    if (educationPart) return educationPart.label;
    // Lever's outer HTML label may contain live geocoder messages. Only its
    // unique question caption in this one-control row is stable question text.
    const leverRow = leverAnswerRow(node);
    if (leverRow?.label) return leverRow.label.slice(0, 240);
    const explicit = [...new Set([...(node.labels || [])].map(label => norm(label.textContent)).filter(Boolean))];
    if (explicit.length > 1) return '';
    const aria = norm(node.getAttribute('aria-label'));
    const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => norm(byId(id)?.textContent)).filter(Boolean).join(' ');
    let label = explicit[0] || aria || labelledBy;
    if (!label && ashby) {
      const row = node.closest('.ashby-application-form-field-entry');
      const labels = row ? [...row.querySelectorAll('.ashby-application-form-question-title')]
        .filter(candidate => candidate.closest('.ashby-application-form-field-entry') === row) : [];
      const answerControls = row ? [...row.querySelectorAll('input, textarea, select')]
        .filter(candidate => inScope(candidate) && (candidate.type === 'file' || visible(candidate))
          && !['hidden', 'button', 'submit', 'reset'].includes(candidate.type)) : [];
      if (labels.length === 1 && answerControls.length === 1 && answerControls[0] === node) label = norm(labels[0].textContent);
    }
    return label.slice(0, 240);
  };
  const cleanLabel = label => norm(label).toLowerCase().replace(/[\s:*✱]+$/g, '').trim();
  const currentLabel = node => labelOf(node) || (basicIds.has(node) ? basicIds.get(node).replaceAll('_', ' ') : '');
  const narrativeLabel = label => (lever && /^additional information$/.test(cleanLabel(label)))
    || /\b(?:cover letter|motivation|why (?:us|this company|this role|do you want|are you interested)|tell us about yourself|introduce yourself|brief introduction|professional summary|about yourself|relevant projects?|describe (?:a |your |any )?(?:relevant |technical |software )?projects?)\b/i.test(cleanLabel(label));
  const ordinaryChoiceKey = (label, node = null) => {
    const text = cleanLabel(label).replace(/[?\s]+$/g, '');
    if (/^(?:varsity|institution type|school type|type of institution)$/.test(text)) return 'institution_type';
    if (/^(?:still student|current student|are you currently (?:a )?student)$/.test(text)) return 'current_student';
    if (/^when would you be available to start a full-time role$/.test(text)) return 'fulltime_start_year';
    if (/^how did you hear about\b/.test(text)) return 'job_discovery_source';
    if (/^how long is your commitment period for a full-time internship(?:\?\s*\(mondays to fridays, entire workday\))?$/.test(text)) return 'internship_commitment';
    if (lever && /^is your internship\s*-?$/.test(text) && node instanceof HTMLSelectElement) {
      const labels = [...node.options].filter(option => option.value.trim()).map(option => norm(option.textContent));
      if (labels.length === 4 && ['Credit Bearing', 'Leave of Absence', 'Outside of School', 'Others'].every(value => labels.includes(value))) return 'internship_type';
    }
    return null;
  };
  const manualReason = (label, node = null) => {
    const text = cleanLabel(label);
    const ordinary = ordinaryChoiceKey(label, node) || (ashby && /^are you available for (?:this|the|thie) internship starting\b/.test(text));
    if (/\bhighest\b.*\b(?:degree|education|qualification)\b|\b(?:completed|graduated|obtained|awarded|conferred|attained)\b.*\b(?:degree|education|qualification)\b|\bdegree\b.*\b(?:completed|obtained|awarded|conferred)\b/.test(text)) return 'Degree completion is not implied by an ongoing education entry. Answer this on the original website.';
    if (/\bwork status\b|\bimmigration\b|\bif others?\b.*\b(?:indicate|specify|elaborate)\b|\bif you selected\b.*\bother\b.*\b(?:last|previous|above) question\b/.test(text)) return 'This status or context-dependent follow-up needs your own answer on the original website.';
    if (/\b(?:visa|sponsor(?:ship)?|citizen(?:ship)?|eligible|eligibility|permit|disability|disabled|veteran|gender|ethnicity|race|religion|age|birth|captcha|signature|declaration|consent|privacy|terms)\b|authori[sz].*work|work.*authori[sz]|right to work|residency status|government.*(?:id|identifier)|passport|\bnric\b|social security|\b(?:agree|acknowledge|certify|attest)\b/.test(text)) return 'This declaration or sensitive question must be answered on the original website.';
    if ((!ordinary && /how did you hear|\breferr(?:al|ed)\b/.test(text))
        || (/why (?:us|this|do you)|motivation|cover letter/.test(text) && !narrativeLabel(label))) return 'This employer-specific answer needs your own response on the original website.';
    if (/^(?:are|is|was|were|do|does|did|have|has|can|could|will|would)\b/.test(text) && !ordinary && !narrativeLabel(label)) return 'This qualification or yes/no question needs your own answer on the original website.';
    if (/\b(?:do not|don't|not have|lack|lacking|weakness(?:es)?|wish|want to learn)\b/.test(text)) return 'This self-assessment needs your own answer on the original website.';
    return '';
  };
  const classify = (label, node) => {
    const text = cleanLabel(label);
    if (manualReason(label, node)) return null;
    const choiceKey = ordinaryChoiceKey(label, node);
    if (choiceKey) return choiceKey;
    const autocomplete = ashbyAutocomplete(node);
    if (autocomplete) return autocomplete.evidenceKey;
    const educationPart = ashbyEducationPart(node);
    if (educationPart) return educationPart.evidenceKey;
    if (lever && text === 'current location') return 'current_city';
    if (lever && text === 'current company') return 'current_company';
    const phoneField = greenhouse && node.id === 'country' ? node.closest('fieldset.phone-input') : null;
    if (phoneField && inScope(node) && phoneField.querySelectorAll('#country').length === 1
        && phoneField.querySelectorAll('#phone').length === 1) return 'phone_country_code';
    const educationId = greenhouse && node.id.match(/^(school|degree|discipline|start-month|start-year|end-month|end-year)--\d+$/);
    if (educationId) return ({school: 'school', degree: 'degree', discipline: 'discipline', 'start-month': 'education_start_month',
      'start-year': 'education_start_year', 'end-month': 'education_end_month', 'end-year': 'education_end_year'})[educationId[1]];
    if (greenhouse && node.id === 'candidate-location') return 'current_city';
    const exact = {
      'full name': 'full_name', name: 'full_name', 'first name': 'given_name', 'given name': 'given_name',
      'last name': 'family_name', 'family name': 'family_name', surname: 'family_name', email: 'email', 'email address': 'email',
      phone: 'phone', 'phone number': 'phone', 'contact number': 'phone', 'mobile number': 'phone',
      'current city': 'current_city', city: 'current_city', 'location (city)': 'current_city', 'city of residence': 'current_city',
      'current country': 'current_country', 'country of residence': 'current_country', 'phone country code': 'phone_country_code',
      nationality: 'nationality_country', 'country of nationality': 'nationality_country', 'nationality country': 'nationality_country',
      'country of study': 'study_country', 'study country': 'study_country', 'country where you study': 'study_country',
      school: 'school', university: 'school', 'school name': 'school', 'university name': 'school', 'school / university': 'school',
      degree: 'degree', 'degree type': 'degree', 'highest degree': 'degree', discipline: 'discipline', major: 'discipline', 'field of study': 'discipline',
      'start date of internship': 'internship_start_date', 'internship start date': 'internship_start_date',
      'end date of internship': 'internship_end_date', 'internship end date': 'internship_end_date',
      'notice period': 'notice_period', 'expected stipend': 'salary_expectation', 'expected salary': 'salary_expectation',
      'salary expectation': 'salary_expectation', 'salary expectations': 'salary_expectation',
      'please state part-time, full-time or any other work arrangements': 'work_arrangement', 'work arrangement': 'work_arrangement',
    };
    if (exact[text]) return exact[text];
    if (/^(?:your )?linkedin(?: profile)?(?: url| link)?$/.test(text)) return 'linkedin';
    if (/^(?:link to (?:your )?)?github(?: profile)?(?: url| link)?$/.test(text)) return 'github';
    if (/^(?:personal )?(?:portfolio|website)(?: url| link)?$/.test(text)) return 'portfolio';
    if ((/availability (?:period|dates?|window)|when (?:can|could) you start|available start date/.test(text)
        || /^please indicate internship period$/.test(text)
        || /^when is your availability(?:\s*\([^)]*\))?[\s:?!*✱]*$/.test(text)) && !/specific date/.test(text)) return 'availability';
    if (/educational background|describe your education|education summary/.test(text)) return 'education';
    if (/describe your (?:relevant |work |professional )?experience|experience summary|work experience/.test(text)) return 'experience';
    if (/relevant skills|technical skills|programming languages|skills summary/.test(text)) return 'skills';
    if (/tell us about yourself|brief introduction|professional summary|about yourself/.test(text)) return 'summary';
    return null;
  };
  const keyOf = node => {
    if (greenhouse && node.id === 'cover_letter_text' && coverLetterState()?.textarea === node) return 'gh:cover_letter_text';
    const autocomplete = ashbyAutocomplete(node);
    if (autocomplete) return autocomplete.key;
    const educationPart = ashbyEducationPart(node);
    if (educationPart) return educationPart.key;
    if (node.name) return `name:${node.name}`;
    if (node.id) return `id:${node.id}`;
    const row = ashby ? node.closest('.ashby-application-form-field-entry') : null;
    const path = row?.getAttribute('data-field-path');
    return path ? `ashby:${path}` : '';
  };
  const stableId = key => {
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return 'field:' + hash.toString(36);
  };
  const isPlaceholder = option => !option.value.trim()
    || /^(?:please\s+)?(?:select|choose)(?:\s+(?:one|an?\s+option|your\s+country|a\s+country|country))?[.\s…*-]*$/i.test(norm(option.textContent));
  const comboContainer = node => greenhouse && node.getAttribute('role') === 'combobox' ? node.closest('.select')
    : ashbyAutocomplete(node)?.wrapper || null;
  const comboSelection = node => {
    if (ashbyAutocomplete(node)) return node.getAttribute('aria-expanded') === 'false' && !node.getAttribute('aria-controls') ? norm(node.value) : '';
    const container = comboContainer(node);
    const selected = container ? [...container.querySelectorAll('.select__single-value')].filter(visible) : [];
    return selected.length === 1 ? norm(selected[0].textContent) : '';
  };
  const records = [];
  const manualQuestions = [];
  const ashbyRadioGroup = node => {
    if (!ashby || !(node instanceof HTMLInputElement) || node.type !== 'radio' || !node.name) return null;
    const group = node.closest('fieldset');
    if (!group || !group.classList.contains('ashby-application-form-input-radio-group') || !inScope(group) || !visible(group)) return null;
    const members = controls.filter(other => other instanceof HTMLInputElement && other.type === 'radio' && other.name === node.name);
    const groupInputs = [...group.querySelectorAll('input')].filter(other => other.type === 'radio');
    const titles = [...group.querySelectorAll('label, legend')].filter(label => label.classList.contains('ashby-application-form-question-title') || label.tagName === 'LEGEND');
    if (members.length < 2 || members.length > 40 || members.length !== groupInputs.length
        || members.some(other => !group.contains(other) || !visible(other) || other.closest('fieldset') !== group)
        || titles.length !== 1 || (titles[0].tagName !== 'LEGEND' && (!titles[0].getAttribute('for') || !node.name.endsWith('_' + titles[0].getAttribute('for'))))) return null;
    const options = [];
    for (const member of members) {
      const labels = [...(member.labels || [])];
      if (!member.id || byId(member.id) !== member || labels.length !== 1 || !group.contains(labels[0])) return null;
      const label = norm(labels[0].textContent);
      if (!label || label.length > 240) return null;
      options.push({node: member, value: member.id, label});
    }
    if (new Set(options.map(option => option.value)).size !== options.length || new Set(options.map(option => option.label)).size !== options.length) return null;
    return {node: group, members, options, key: 'ashby:radio:' + node.name, label: norm(titles[0].textContent)};
  };
  const ashbyStudentCheckbox = node => {
    if (!ashby || !(node instanceof HTMLInputElement) || node.type !== 'checkbox' || node.id !== '_systemfield_education_history-isCurrent'
        || byId(node.id) !== node || !inScope(node) || !visible(node)) return null;
    const row = node.closest('.ashby-application-form-field-entry');
    const rows = [...scope.querySelectorAll('.ashby-application-form-field-entry')].filter(candidate => candidate.getAttribute('data-field-path') === '_systemfield_education_history');
    const labels = [...(node.labels || [])];
    if (!row || rows.length !== 1 || rows[0] !== row || labels.length !== 1 || !row.contains(labels[0])
        || cleanLabel(labels[0].textContent).replace(/\?$/, '').trim() !== 'still student') return null;
    return {node, row, key: 'id:' + node.id, label: norm(labels[0].textContent),
      options: [{value: 'yes', label: 'Yes'}, {value: 'no', label: 'No'}]};
  };
  const seenRadioGroups = new Set();
  diagnosticStage = 'read_fields';
  for (const node of controls.slice(0, 100)) {
    if (node.type === 'file' || !visible(node) || ['hidden', 'button', 'submit', 'reset'].includes(node.type)) continue;
    const radio = ashbyRadioGroup(node), student = ashbyStudentCheckbox(node);
    if (radio || student) {
      const choice = radio || student;
      if (radio && seenRadioGroups.has(radio.key)) continue;
      if (radio) seenRadioGroups.add(radio.key);
      const reason = manualReason(choice.label, choice.node), evidenceKey = reason ? null : ordinaryChoiceKey(choice.label, choice.node);
      const descriptor = {id: stableId(choice.key), key: choice.key, label: choice.label, kind: 'select', evidenceKey,
        available: !reason, occupied: radio ? radio.members.some(member => member.checked) : !!node.checked,
        required: radio ? radio.members.some(member => member.required) : !!node.required, maxLength: 240,
        options: choice.options.map(({value, label}) => ({value, label})), needsMapping: !reason && !evidenceKey,
        manualOnly: !!reason, ...(reason ? {manualReason: reason} : {}), draftable: false};
      records.push({node: choice.node, descriptor, ...(radio ? {radioGroup: radio} : {studentCheckbox: student})});
      if (reason) manualQuestions.push(choice.label);
      continue;
    }
    const basicId = basicIds.get(node);
    const label = currentLabel(node);
    if (!label) continue;
    const key = keyOf(node);
    // Auxiliary inputs may have a repeated accessibility label but no stable
    // answer identifier. Never invent a positional identifier for writing them.
    if (!key || key.length > 220) { manualQuestions.push(label); continue; }
    const keyMatches = controls.filter(other => keyOf(other) === key);
    if (ashby && node instanceof HTMLInputElement && node.name && ['radio', 'checkbox'].includes(node.type)
        && keyMatches.length > 1 && keyMatches.every(other => other instanceof HTMLInputElement
          && other.type === node.type && other.name === node.name)) {
      // Shared names are normal for these inherently manual option groups.
      // They are not writable answer records; never mint positional keys or
      // let their duplicate manual IDs reject unrelated unique text fields.
      manualQuestions.push(label);
      continue;
    }
    const kind = node instanceof HTMLSelectElement ? 'select' : comboContainer(node) ? 'combobox'
      : node.type === 'date' || (ashby && node.classList.contains('ashby-application-form-input-date')) ? 'date'
      : node.type === 'number' ? 'number' : 'text';
    let reason = manualReason(label, node);
    if (!key || key.length > 220 || keyMatches.length !== 1) reason ||= 'This control has no unique stable identifier. Answer it on the original website.';
    if ((node instanceof HTMLSelectElement && node.multiple)
        || (node instanceof HTMLInputElement && !['text', 'email', 'tel', 'url', 'number', 'date'].includes(node.type))) {
      reason ||= 'This control type needs a choice on the original website.';
    }
    if (node.getAttribute('role') === 'combobox' && !comboContainer(node)) reason ||= 'This custom dropdown is not supported yet.';
    let options;
    if (kind === 'select') {
      options = [...node.options].filter(option => !isPlaceholder(option) && !option.disabled && !option.hidden
        && !(option.parentElement?.tagName === 'OPTGROUP' && option.parentElement.disabled))
        .map(option => ({value: option.value, label: norm(option.textContent)}));
      if (!options.length || options.length > 400 || new Set(options.map(option => option.value)).size !== options.length
          || new Set(options.map(option => option.label)).size !== options.length
          || options.some(option => !option.label || option.label.length > 240 || option.value.length > 240)) {
        reason ||= 'This dropdown has unavailable or ambiguous choices. Select on the original website.';
      }
    }
    const selected = kind === 'select' && node.selectedIndex >= 0 ? node.options[node.selectedIndex] : null;
    const occupied = (node.id === 'cover_letter_text' && !!coverLetterState()?.file.files?.length) || (kind === 'combobox' ? !!comboSelection(node) || !!node.value.trim()
      : kind === 'select' ? !!selected && !isPlaceholder(selected) : !!node.value.trim());
    const evidenceKey = reason ? null : classify(label, node);
    const leverRow = leverAnswerRow(node), selectedLocation = lever && node.id === 'location-input' ? byId('selected-location') : null;
    const requiresWebsiteChoice = !!(leverRow && node.name === 'location' && node.type === 'text' && selectedLocation
      && selectedLocation.type === 'hidden' && selectedLocation.name === 'selectedLocation' && inScope(selectedLocation)
      && selectedLocation.closest('li') === leverRow.row);
    const descriptor = {id: basicId || stableId(key || label), key, label, kind, evidenceKey, available: !reason,
      occupied, required: !!node.required || node.getAttribute('aria-required') === 'true',
      maxLength: node.maxLength > 0 ? node.maxLength : kind === 'date' ? 10 : 3000,
      needsMapping: !reason && !evidenceKey, manualOnly: !!reason, ...(reason ? {manualReason: reason} : {}),
      draftable: !reason && kind === 'text' && narrativeLabel(label),
      ...(requiresWebsiteChoice ? {requiresWebsiteChoice: true} : {}),
      ...(options ? {options} : {}), ...(kind === 'combobox' ? {options: [], searchable: !node.readOnly} : {})};
    if (reason) manualQuestions.push(label);
    records.push({node, descriptor});
  }
  const cover = coverLetterState();
  if (cover && !cover.textarea && visible(cover.button) && !cover.button.disabled) {
    const key = 'gh:cover_letter_text';
    records.push({node: cover.button, virtualCover: true, descriptor: {id: stableId(key), key, label: 'Cover letter', kind: 'text',
      evidenceKey: null, available: true, occupied: !!cover.file.files?.length, required: false, maxLength: 3000,
      needsMapping: true, manualOnly: false, draftable: true}});
  }
  if (new Set(records.map(record => record.descriptor.id)).size !== records.length) throw new Error('Ambiguous application fields. Complete this form manually.');
  diagnosticStage = 'read_resume_target';
  const resumeLabelOf = node => {
    // Current GH labels the actual hidden file input "Attach". Only the exact
    // résumé input and caption in its own single-file wrapper identify the CV.
    if (greenhouse && node.id === 'resume' && byId('resume') === node) {
      const wrapper = node.closest('.file-upload'), caption = byId('upload-label-resume');
      const fileInputs = wrapper ? [...wrapper.querySelectorAll('input')].filter(input => input.type === 'file') : [];
      if (wrapper && caption && wrapper.contains(caption) && caption.closest('.file-upload') === wrapper
          && scope.contains(caption) && visible(caption) && fileInputs.length === 1 && fileInputs[0] === node
          && /^resume(?:\s*\/\s*cv)?[\s:*✱]*$/i.test(norm(caption.textContent))) return norm(caption.textContent);
    }
    return labelOf(node);
  };
  const resumeRecords = controls.filter(node => node instanceof HTMLInputElement && node.type === 'file' && !node.disabled)
    .map(node => ({node, label: resumeLabelOf(node), key: keyOf(node)}))
    .filter(({label, key, node}) => !!key && /\b(?:resume|résumé|cv)\b/i.test(label) && !/cover|transcript|additional/i.test(label)
      && !node.multiple && controls.filter(other => keyOf(other) === key).length === 1);
  const resumeRecord = resumeRecords.length === 1 ? resumeRecords[0] : null;
  const resumeTarget = resumeRecord ? {key: resumeRecord.key, label: resumeRecord.label,
    accept: resumeRecord.node.accept || '', multiple: false, occupied: !!resumeRecord.node.files?.length} : null;
  const listOptions = node => {
    const listId = node.getAttribute('aria-controls');
    const list = byId(listId);
    if (!list || list.getAttribute('role') !== 'listbox' || !visible(list)) return [];
    const autocomplete = ashbyAutocomplete(node);
    return [...list.querySelectorAll('[role="option"]')]
      .filter(option => visible(option) && option.getAttribute('aria-disabled') !== 'true')
      .map(option => {
        let label = norm(option.textContent);
        if (autocomplete?.purpose === 'school') {
          const names = [...option.querySelectorAll('span')].filter(span => visible(span)
            && String(span.getAttribute('class') || span.className || '').split(/\s+/).some(name => name.startsWith('_canonicalSchoolResultName_')));
          label = names.length === 1 ? norm(names[0].textContent) : '';
        }
        return {node: option, value: label, label};
      })
      .filter(option => !!option.value && option.value.length <= 240).slice(0, 400);
  };
  const openOptions = async (node, query = null, desiredLabel = null) => {
    samePage();
    if (!node.isConnected || !inScope(node) || !visible(node) || !comboContainer(node)) return [];
    const autocomplete = ashbyAutocomplete(node);
    if (autocomplete && query === null) return listOptions(node);
    node.focus();
    if (!autocomplete && node.getAttribute('aria-expanded') !== 'true') {
      const controls = [...comboContainer(node).querySelectorAll('.select__control')].filter(visible);
      if (controls.length > 1) return [];
      const control = controls[0] || node;
      // React-select opens on control mousedown; input.click() alone can leave
      // the real menu closed while simplistic fixtures incorrectly open it.
      const event = {bubbles: true, cancelable: true, button: 0, buttons: 1};
      if (typeof PointerEvent === 'function') control.dispatchEvent(new PointerEvent('pointerdown', event));
      control.dispatchEvent(new MouseEvent('mousedown', event));
      if (typeof PointerEvent === 'function') control.dispatchEvent(new PointerEvent('pointerup', {...event, buttons: 0}));
      control.dispatchEvent(new MouseEvent('mouseup', {...event, buttons: 0}));
      control.dispatchEvent(new MouseEvent('click', {...event, buttons: 0}));
    }
    if (query !== null) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, query);
      node.dispatchEvent(new Event('input', {bubbles: true}));
      node.dispatchEvent(new Event('change', {bubbles: true}));
      await wait(200);
    }
    let options = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      samePage();
      options = listOptions(node);
      if (options.length && (!desiredLabel || options.some(option => autocomplete?.purpose === 'school'
        ? canonicalSchoolName(option.label) === canonicalSchoolName(desiredLabel) : option.label === desiredLabel))) return options;
      await wait(100);
    }
    return options;
  };
  const closeOptions = node => {
    node.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true}));
    node.blur();
  };
  if (action === 'inspect') {
    diagnosticStage = 'read_dropdown_options';
    for (const {node, descriptor} of records) {
      if (descriptor.kind !== 'combobox' || descriptor.manualOnly || descriptor.occupied) continue;
      // These observed async search controls have no useful initial option page.
      // The explicit Fill still searches and requires one exact persisted choice.
      if (descriptor.searchable && ['school', 'current_city'].includes(descriptor.evidenceKey)) {
        descriptor.optionsPending = true;
        continue;
      }
      const before = comboSelection(node), inputBefore = node.value;
      try {
        const options = await openOptions(node);
        descriptor.options = options.map(({value, label}) => ({value, label}));
        descriptor.optionsPending = options.length === 0;
        closeOptions(node);
        await wait(50);
        if (comboSelection(node) !== before || node.value !== inputBefore) throw new Error('Dropdown changed while reading. Check the original form.');
      } catch (error) {
        samePage();
        if (comboSelection(node) !== before || node.value !== inputBefore
            || error?.message === 'Dropdown changed while reading. Check the original form.') {
          throw new Error('Dropdown changed while reading. Check the original form.');
        }
        descriptor.available = false; descriptor.manualOnly = true; descriptor.needsMapping = false;
        descriptor.manualReason = 'This dropdown could not be read safely. Select it on the original website.';
        descriptor.options = [];
        manualQuestions.push(descriptor.label);
      }
    }
    return {inspection_version: 1, ok: true, provider: greenhouse ? 'Greenhouse' : lever ? 'Lever' : 'Ashby', url: initialUrl,
      fields: records.map(({descriptor}) => descriptor), manualQuestions, resumeTarget};
  }
  if (action === 'attach') {
    if (confirmed !== true || !resumeRecord || !resumeTarget || targetKey !== resumeTarget.key
        || targetLabel !== resumeTarget.label || resumeTarget.occupied) throw new Error('Read and review the empty résumé upload target again.');
    if (!file || typeof file.name !== 'string' || file.name.length > 200 || !/^[^\\/\x00-\x1f\x7f-\x9f]{1,196}\.pdf$/i.test(file.name)
        || typeof file.base64 !== 'string' || file.base64.length > 2800000 || !/^[a-f0-9]{64}$/i.test(file.sha256 || '')) throw new Error('Invalid reviewed PDF attachment.');
    if (resumeTarget.accept && !resumeTarget.accept.toLowerCase().split(',').some(value => ['.pdf', 'application/pdf', '*/*'].includes(value.trim()))) {
      throw new Error('This upload target does not accept PDF files.');
    }
    let bytes;
    try { bytes = Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)); }
    catch { throw new Error('Invalid PDF attachment bytes.'); }
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || (file.size_bytes !== undefined && file.size_bytes !== bytes.length)
        || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF attachment bytes.');
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hash !== file.sha256.toLowerCase()) throw new Error('Attachment hash changed. Select the résumé again.');
    samePage();
    const node = resumeRecord.node;
    if (!node.isConnected || !inScope(node) || node.disabled || node.files?.length || resumeLabelOf(node) !== targetLabel || keyOf(node) !== targetKey) throw new Error('Upload target changed. Read the form again.');
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, {type: 'application/pdf'}));
    node.files = transfer.files;
    node.dispatchEvent(new Event('input', {bubbles: true}));
    node.dispatchEvent(new Event('change', {bubbles: true}));
    await wait(200); samePage();
    const selected = node.files?.length === 1 && node.files[0].name === file.name && node.files[0].size === bytes.length;
    return {submitted: false, selected, upload_status: selected ? 'selected_on_form' : 'check_original_website',
      filename: file.name, sha256: hash};
  }
  diagnosticStage = 'fill_preflight';
  const rejectShape = (mismatch, item = null) => {
    const id = /^(?:field:[a-z0-9]{1,10}|first_name|last_name|full_name|email|phone)$/.test(item?.id || '') ? item.id : null;
    reviewMismatch = {mismatch, ...(id ? {field_id: id} : {})};
    throw new Error('Invalid reviewed answers.');
  };
  if (action !== 'fill') rejectShape('action');
  if (!Array.isArray(approved)) rejectShape('answers_type');
  if (approved.length > 60) rejectShape('answers_count');
  const approvedIds = new Set();
  for (const item of approved) {
    if (approvedIds.has(item?.id)) rejectShape('duplicate_id', item);
    approvedIds.add(item?.id);
    if (!item) rejectShape('item_shape');
    if (typeof item.id !== 'string') rejectShape('id_type');
    if (typeof item.value !== 'string') rejectShape('value_type', item);
    if (!item.value.trim()) rejectShape('empty_value', item);
    if (item.value.length > 10000) rejectShape('value_limit', item);
    if (item.confirmed !== true) rejectShape('confirmation', item);
  }
  const reviewed = approved.map(item => {
    const record = records.find(record => record.descriptor.id === item.id);
    const field = record?.descriptor;
    const mismatch = !field ? 'missing_field' : field.manualOnly ? 'manual_only' : !field.available ? 'unavailable'
      : item.key !== field.key ? 'key' : item.label !== field.label ? 'label' : item.kind !== field.kind ? 'kind'
      // Missing and null both mean no fact classification. Keep every actual
      // classification (including a forged empty/non-string key) exact.
      : (item.evidenceKey ?? null) !== (field.evidenceKey ?? null) ? 'evidence_key' : item.value.length > field.maxLength ? 'max_length' : null;
    if (mismatch) {
      // Public stable identifiers and fixed categories only: never return the
      // answer, raw question text, DOM exception or actual/expected values.
      if (/^(?:field:[a-z0-9]{1,10}|first_name|last_name|full_name|email|phone)$/.test(item.id)) {
        reviewMismatch = {field_id: item.id, mismatch};
        if (mismatch === 'evidence_key') {
          const evidenceType = value => value === undefined ? 'missing' : value === null ? 'null' : Array.isArray(value) ? 'array'
            : ['string', 'boolean', 'number', 'object'].includes(typeof value) ? typeof value : 'other';
          reviewMismatch.expected_evidence_type = evidenceType(field.evidenceKey);
          reviewMismatch.received_evidence_type = evidenceType(item.evidenceKey);
        }
      }
      throw new Error('Invalid reviewed answers. Read the form again.');
    }
    if (field.kind === 'select' && !field.options.some(option => option.value === item.value && option.label === item.optionLabel)) {
      throw new Error('The reviewed field or option changed. Read the form again.');
    }
    if (field.kind === 'combobox' && item.optionLabel !== item.value) throw new Error('Select one exact reviewed dropdown label.');
    if (field.kind === 'date') {
      const parts = item.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const date = parts ? new Date(item.value + 'T00:00:00.000Z') : null;
      if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== item.value) throw new Error('Use a real ISO date for the reviewed answer.');
    }
    return {item, ...record};
  });
  const ongoingStudent = reviewed.find(record => record.studentCheckbox && record.item.value === 'yes');
  if (ongoingStudent && reviewed.some(record => /^education_end_(?:month|year)$/.test(record.descriptor.evidenceKey || ''))) {
    reviewMismatch = {field_id: ongoingStudent.item.id, mismatch: 'incompatible_answers'};
    throw new Error('Invalid reviewed answers. Read the form again.');
  }
  if (ongoingStudent) reviewed.sort((left, right) => Number(!!right.studentCheckbox) - Number(!!left.studentCheckbox));
  const filled = [], skipped = [], reasons = {}, needsWebsiteChoice = [], needsCorrection = [];
  diagnosticStage = 'fill_fields';
  for (const reviewedItem of reviewed) {
    let {item, node, descriptor} = reviewedItem;
    let correctionNeeded = false;
    try {
      samePage();
      mutationStarted = true;
      if (reviewedItem.radioGroup || reviewedItem.studentCheckbox) {
        const radio = reviewedItem.radioGroup ? ashbyRadioGroup(reviewedItem.radioGroup.members[0]) : null;
        const student = reviewedItem.studentCheckbox ? ashbyStudentCheckbox(node) : null;
        const choice = radio || student;
        if (!choice || choice.node !== node || choice.key !== item.key || choice.label !== item.label) throw new Error('The choice question changed. Read the form again.');
        if (radio && radio.members.some(member => member.checked)) throw new Error('Already answered; left unchanged.');
        if (student && node.checked) throw new Error('Already answered; left unchanged.');
        const option = choice.options.filter(option => option.value === item.value && option.label === item.optionLabel);
        if (option.length !== 1) throw new Error('The reviewed choice changed. Read the form again.');
        if (student && item.value === 'yes') {
          const end = byId('_systemfield_education_history-endDate');
          if (end && [...end.querySelectorAll('select')].some(select => select.selectedIndex >= 0 && !isPlaceholder(select.options[select.selectedIndex]))) throw new Error('An end date is already answered. Review it before changing student status.');
        }
        if (radio) option[0].node.click();
        else if (item.value === 'yes') node.click();
        for (const pause of [150, 150]) {
          await wait(pause); samePage();
          const current = radio ? ashbyRadioGroup(radio.members[0]) : ashbyStudentCheckbox(node);
          if (!current || current.node !== node || current.key !== item.key || current.label !== item.label
              || (radio ? current.members.filter(member => member.checked).length !== 1 || !option[0].node.checked : node.checked !== (item.value === 'yes'))) throw new Error('The selected answer did not persist. Check it on the website.');
        }
        filled.push(item.id);
        continue;
      }
      if (reviewedItem.virtualCover) {
        const before = coverLetterState();
        if (!before || before.button !== node || before.file.files?.length || before.textarea || !visible(node) || node.disabled) throw new Error('Cover letter already answered or changed; left unchanged.');
        node.click(); await wait(100); samePage();
        const opened = coverLetterState();
        if (!opened || opened.group !== before.group || opened.file !== before.file || opened.file.files?.length
            || !opened.textarea || !visible(opened.textarea) || opened.textarea.value.trim()) throw new Error('Cover letter text editor could not be opened safely. Complete it on the website.');
        node = opened.textarea;
      }
      const occupied = (node.id === 'cover_letter_text' && !!coverLetterState()?.file.files?.length) || (descriptor.kind === 'combobox' ? !!comboSelection(node) || !!node.value.trim()
        : descriptor.kind === 'select' ? node.selectedIndex >= 0 && !isPlaceholder(node.options[node.selectedIndex]) : !!node.value.trim());
      if (!node.isConnected || !inScope(node) || !visible(node) || occupied || keyOf(node) !== item.key || currentLabel(node) !== item.label) {
        throw new Error(occupied ? 'Already answered; left unchanged.' : 'The control changed. Read the form again.');
      }
      if (descriptor.kind === 'combobox') {
        const school = ashbyAutocomplete(node)?.purpose === 'school';
        const desired = school ? canonicalSchoolName(item.optionLabel) : item.optionLabel;
        const sameLabel = option => school ? canonicalSchoolName(option.label) === desired : option.label === desired;
        let options = await openOptions(node);
        let matches = options.filter(sameLabel);
        if (matches.length === 0 && descriptor.searchable) {
          options = await openOptions(node, school ? canonicalSchoolName(item.value) : item.value, desired);
          matches = options.filter(sameLabel);
        }
        if (matches.length !== 1) {
          closeOptions(node);
          throw new Error('No unique exact dropdown choice. Select on the original website.');
        }
        const selectedLabel = matches[0].label;
        const currentOptions = listOptions(node).filter(sameLabel);
        if (!node.isConnected || keyOf(node) !== item.key || currentLabel(node) !== item.label
            || currentOptions.length !== 1 || currentOptions[0].node !== matches[0].node) throw new Error('The reviewed dropdown changed. Check the original website.');
        matches[0].node.click();
        if (ashbyAutocomplete(node)) {
          // Ashby's active aria-selected option is only a highlight. A real
          // exact option click must close the list before our explicit blur.
          for (let attempt = 0; attempt < 10 && (node.getAttribute('aria-expanded') !== 'false' || node.getAttribute('aria-controls')); attempt++) {
            await wait(25); samePage();
          }
          if (comboSelection(node) !== selectedLabel) throw new Error('The dropdown choice was not accepted. Query text alone is not a selection.');
        }
        node.blur();
        await wait(200); samePage();
        if (!node.isConnected || comboSelection(node) !== selectedLabel) throw new Error('The selected dropdown value did not persist. Check it on the website.');
        await wait(150); samePage();
        if (comboSelection(node) !== selectedLabel) throw new Error('The selected dropdown value disappeared. Check it on the website.');
      } else {
        const ashbyDate = descriptor.kind === 'date' && ashby && node.classList.contains('ashby-application-form-input-date');
        const value = ashbyDate ? `${item.value.slice(5, 7)}/${item.value.slice(8, 10)}/${item.value.slice(0, 4)}` : item.value;
        const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        node.focus();
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
        node.dispatchEvent(new Event('input', {bubbles: true})); node.dispatchEvent(new Event('change', {bubbles: true}));
        node.blur(); await wait(150); samePage();
        if (!node.isConnected || node.value !== value) throw new Error('This answer did not persist after leaving the field. Check it on the website.');
        if (descriptor.kind !== 'text' && node.validity && !node.validity.valid) throw new Error('This answer does not meet the original field format. Check it on the website.');
        await wait(150); samePage();
        if (!node.isConnected || node.value !== value) throw new Error('This answer disappeared after leaving the field. Check it on the website.');
        correctionNeeded = descriptor.kind === 'text' && !!node.validity && !node.validity.valid;
      }
      filled.push(item.id);
      if (descriptor.requiresWebsiteChoice) needsWebsiteChoice.push(item.id);
      if (correctionNeeded) needsCorrection.push(item.id);
    } catch (error) {
      skipped.push(item.id); reasons[item.id] = error.message || 'Complete this answer on the original website.';
    }
  }
  return {filled, skipped, reasons, submitted: false,
    ...(needsWebsiteChoice.length ? {needsWebsiteChoice} : {}), ...(needsCorrection.length ? {needsCorrection} : {})};
  } catch (error) {
    if (action === 'fill' || diagnosticStage === 'fill_preflight') {
      const codes = {'Open a supported Greenhouse, Lever or Ashby hosted application form.': 'unsupported_page',
        'Application URL changed. Read the form again.': 'url_changed', 'Application page changed. Read it again.': 'page_changed',
        'Ambiguous application fields. Complete this form manually.': 'ambiguous_fields',
        'Invalid reviewed answers.': 'invalid_review', 'Invalid reviewed answers. Read the form again.': 'invalid_review',
        'The reviewed field or option changed. Read the form again.': 'option_changed',
        'Select one exact reviewed dropdown label.': 'invalid_choice', 'Use a real ISO date for the reviewed answer.': 'invalid_date'};
      return {fill_version: 1, ok: false, mutation_started: mutationStarted,
        error: {code: codes[error?.message] || 'fill_failed', stage: diagnosticStage, ...(reviewMismatch || {})}};
    }
    if (action !== 'inspect') throw error;
    const codes = {'Open a supported Greenhouse, Lever or Ashby hosted application form.': 'unsupported_page',
      'Application page changed. Read it again.': 'page_changed',
      'Dropdown changed while reading. Check the original form.': 'dropdown_changed',
      'Application form is still loading. Wait for it to appear, then refresh the form.': 'form_not_ready',
      'Ambiguous application fields. Complete this form manually.': 'ambiguous_fields'};
    // Do not expose raw DOM exception messages, page content, contact details or
    // stack traces. The popup receives a stable code even when Chrome swallows errors.
    return {inspection_version: 1, ok: false, error: {code: codes[error?.message] || 'reader_failed', stage: diagnosticStage}};
  }
}
