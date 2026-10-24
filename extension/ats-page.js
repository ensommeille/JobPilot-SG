// Popup-only exact matching of explicit saved facts. No residence/telephone inference.
export function matchATSSelectOption(field, savedValue) {
  if (!['select', 'combobox'].includes(field?.kind) || typeof savedValue !== 'string'
      || !savedValue.trim() || !Array.isArray(field.options)) return '';
  const norm = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const facts = new Set([norm(savedValue)]);
  const callingCode = field.evidenceKey === 'phone_country_code' && /^\+\d{1,3}$/.test(savedValue.trim()) ? savedValue.trim() : null;
  if (['nationality_country', 'study_country', 'current_country'].includes(field.evidenceKey)
      && /^[A-Za-z]{2}$/.test(savedValue.trim())) {
    try { facts.add(norm(new Intl.DisplayNames(['en'], {type: 'region'}).of(savedValue.trim().toUpperCase()))); }
    catch { /* Missing display-name support never justifies a guess. */ }
  }
  if (/^education_(?:start|end)_month$/.test(field.evidenceKey || '') && /^(?:0?[1-9]|1[0-2])$/.test(savedValue)) {
    facts.add(norm(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(savedValue) - 1]));
  }
  const matches = field.options.filter(option => typeof option.value === 'string' && option.value.trim()
    && typeof option.label === 'string' && (facts.has(norm(option.value)) || facts.has(norm(option.label))
      || (callingCode && norm(option.label).endsWith(' ' + callingCode))));
  if (matches.length) return matches.length === 1 ? matches[0].value : '';
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
    const candidates = expected ? field.options.filter(option => typeof option.value === 'string'
      && option.value.trim() && typeof option.label === 'string' && family(option.label) === expected) : [];
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
    const allowed = new Set(['unsupported_page', 'page_changed', 'dropdown_changed', 'ambiguous_fields', 'reader_failed']);
    const code = allowed.has(review.error?.code) ? review.error.code : 'reader_failed';
    const messages = {unsupported_page: 'This page URL is not a supported hosted application. Open the canonical application from JobPilot.',
      page_changed: 'The application page changed while reading. Read the original form again.',
      dropdown_changed: 'A dropdown selection changed while reading. Check the original form before reading again.',
      ambiguous_fields: 'Some application fields have ambiguous identifiers. Complete those questions on the original website.',
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

// Serialized into the active original-site document. Keep all injected helpers inside.
// Each call is one attempt. It never clicks submit, consent or CAPTCHA controls.
export async function interactWithATSPage({action, expectedUrl = '', approved = [], targetKey = '', targetLabel = '', file = null, confirmed = false}) {
  let diagnosticStage = 'validate_page';
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
  const byId = id => {
    if (!id) return null;
    const matches = [...document.querySelectorAll('[id]')].filter(node => node.id === id);
    return matches.length === 1 ? matches[0] : null;
  };
  diagnosticStage = 'read_form_scope';
  const allDocumentControls = [...document.querySelectorAll('input, textarea, select')];
  const basicSelectors = greenhouse ? {
    first_name: ['first_name', 'job_application[first_name]'], last_name: ['last_name', 'job_application[last_name]'],
    email: ['email', 'job_application[email]'], phone: ['phone', 'job_application[phone]'],
  } : ashby ? {full_name: ['_systemfield_name'], email: ['_systemfield_email']}
    : {full_name: ['name'], email: ['email'], phone: ['phone']};
  const basicIds = new Map();
  for (const [id, names] of Object.entries(basicSelectors)) {
    const nodes = allDocumentControls.filter(node => node instanceof HTMLInputElement
      && ['text', 'email', 'tel'].includes(node.type) && visible(node)
      && (names.includes(node.name) || (greenhouse && node.id === id) || (!greenhouse && !ashby && node.id === id.replace('full_', ''))));
    if (nodes.length === 1) basicIds.set(nodes[0], id);
  }
  let scope = null;
  if (ashby) {
    const containers = [...document.querySelectorAll('.ashby-application-form-container')]
      .filter(node => node.getClientRects().length > 0);
    if (containers.length === 1 && [...basicIds.keys()].every(node => containers[0].contains(node))) scope = containers[0];
  } else {
    const forms = [...new Set([...basicIds.keys()].map(node => node.form).filter(Boolean))];
    if (forms.length === 1) scope = forms[0];
  }
  const inScope = node => !!scope && scope.contains(node) && (ashby
    ? node.closest('.ashby-application-form-container') === scope : node.form === scope);
  const controls = scope ? [...scope.querySelectorAll('input, textarea, select')].filter(inScope) : [];
  const labelOf = node => {
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
    if (!label && lever) {
      const row = node.closest('li');
      const labels = row ? [...row.querySelectorAll('.application-label')].filter(candidate => candidate.closest('li') === row) : [];
      const answerControls = row ? [...row.querySelectorAll('input, textarea, select')]
        .filter(candidate => candidate.closest('li') === row && inScope(candidate) && visible(candidate)
          && !['hidden', 'button', 'submit', 'reset'].includes(candidate.type)) : [];
      if (labels.length === 1 && answerControls.length === 1 && answerControls[0] === node) label = norm(labels[0].textContent);
    }
    return label.slice(0, 240);
  };
  const cleanLabel = label => norm(label).toLowerCase().replace(/[\s:*✱]+$/g, '').trim();
  const currentLabel = node => labelOf(node) || (basicIds.has(node) ? basicIds.get(node).replaceAll('_', ' ') : '');
  const manualReason = label => {
    const text = cleanLabel(label);
    if (/\bhighest\b.*\b(?:degree|education|qualification)\b|\b(?:completed|graduated|obtained|awarded|conferred|attained)\b.*\b(?:degree|education|qualification)\b|\bdegree\b.*\b(?:completed|obtained|awarded|conferred)\b/.test(text)) return 'Degree completion is not implied by an ongoing education entry. Answer this on the original website.';
    if (/\b(?:visa|sponsor(?:ship)?|citizen(?:ship)?|eligible|eligibility|permit|disability|disabled|veteran|gender|ethnicity|race|religion|age|birth|captcha|signature|declaration|consent|privacy|terms)\b|authori[sz].*work|work.*authori[sz]|right to work|residency status|government.*(?:id|identifier)|passport|\bnric\b|social security|\b(?:agree|acknowledge|certify|attest)\b/.test(text)) return 'This declaration or sensitive question must be answered on the original website.';
    if (/why (?:us|this|do you)|motivation|cover letter|how did you hear|\breferr(?:al|ed)\b/.test(text)) return 'This employer-specific answer needs your own response on the original website.';
    if (/\b(?:do not|don't|not have|lack|lacking|weakness(?:es)?|wish|want to learn)\b/.test(text)) return 'This self-assessment needs your own answer on the original website.';
    return '';
  };
  const classify = (label, node) => {
    const text = cleanLabel(label);
    if (manualReason(label)) return null;
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
        || /^when is your availability(?:\s*\([^)]*\))?[\s:?!*✱]*$/.test(text)) && !/specific date/.test(text)) return 'availability';
    if (/educational background|describe your education|education summary/.test(text)) return 'education';
    if (/describe your (?:relevant |work |professional )?experience|experience summary|work experience/.test(text)) return 'experience';
    if (/relevant skills|technical skills|programming languages|skills summary/.test(text)) return 'skills';
    if (/tell us about yourself|brief introduction|professional summary|about yourself/.test(text)) return 'summary';
    return null;
  };
  const keyOf = node => {
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
  const comboContainer = node => greenhouse && node.getAttribute('role') === 'combobox' ? node.closest('.select') : null;
  const comboSelection = node => {
    const container = comboContainer(node);
    const selected = container ? [...container.querySelectorAll('.select__single-value')].filter(visible) : [];
    return selected.length === 1 ? norm(selected[0].textContent) : '';
  };
  const records = [];
  const manualQuestions = [];
  diagnosticStage = 'read_fields';
  for (const node of controls.slice(0, 100)) {
    if (node.type === 'file' || !visible(node) || ['hidden', 'button', 'submit', 'reset'].includes(node.type)) continue;
    const basicId = basicIds.get(node);
    const label = currentLabel(node);
    if (!label) continue;
    const key = keyOf(node);
    // Auxiliary inputs may have a repeated accessibility label but no stable
    // answer identifier. Never invent a positional identifier for writing them.
    if (!key || key.length > 220) { manualQuestions.push(label); continue; }
    const keyMatches = controls.filter(other => keyOf(other) === key);
    const kind = node instanceof HTMLSelectElement ? 'select' : comboContainer(node) ? 'combobox'
      : node.type === 'date' || (ashby && node.classList.contains('ashby-application-form-input-date')) ? 'date' : 'text';
    let reason = manualReason(label);
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
    const occupied = kind === 'combobox' ? !!comboSelection(node) || !!node.value.trim()
      : kind === 'select' ? !!selected && !isPlaceholder(selected) : !!node.value.trim();
    const evidenceKey = reason ? null : classify(label, node);
    const descriptor = {id: basicId || stableId(key || label), key, label, kind, evidenceKey, available: !reason,
      occupied, required: !!node.required || node.getAttribute('aria-required') === 'true',
      maxLength: node.maxLength > 0 ? node.maxLength : kind === 'date' ? 10 : 3000,
      needsMapping: !reason && !evidenceKey, manualOnly: !!reason, ...(reason ? {manualReason: reason} : {}),
      ...(options ? {options} : {}), ...(kind === 'combobox' ? {options: [], searchable: !node.readOnly} : {})};
    if (reason) manualQuestions.push(label);
    records.push({node, descriptor});
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
    return [...list.querySelectorAll('[role="option"]')]
      .filter(option => visible(option) && option.getAttribute('aria-disabled') !== 'true')
      .map(option => ({node: option, value: norm(option.textContent), label: norm(option.textContent)}))
      .filter(option => !!option.value && option.value.length <= 240).slice(0, 400);
  };
  const openOptions = async (node, query = null, desiredLabel = null) => {
    samePage();
    if (!node.isConnected || !inScope(node) || !visible(node) || !comboContainer(node)) return [];
    node.focus(); node.click();
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
      if (options.length && (!desiredLabel || options.some(option => option.label === desiredLabel))) return options;
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
  if (action !== 'fill' || !Array.isArray(approved) || approved.length > 60
      || new Set(approved.map(item => item?.id)).size !== approved.length
      || approved.some(item => !item || typeof item.id !== 'string' || typeof item.value !== 'string'
        || !item.value.trim() || item.value.length > 10000 || item.confirmed !== true)) throw new Error('Invalid reviewed answers.');
  const reviewed = approved.map(item => {
    const record = records.find(record => record.descriptor.id === item.id);
    const field = record?.descriptor;
    if (!field || field.manualOnly || !field.available || item.key !== field.key || item.label !== field.label
        || item.kind !== field.kind || item.evidenceKey !== field.evidenceKey || item.value.length > field.maxLength) {
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
  const filled = [], skipped = [], reasons = {};
  for (const {item, node, descriptor} of reviewed) {
    try {
      samePage();
      const occupied = descriptor.kind === 'combobox' ? !!comboSelection(node) || !!node.value.trim()
        : descriptor.kind === 'select' ? node.selectedIndex >= 0 && !isPlaceholder(node.options[node.selectedIndex]) : !!node.value.trim();
      if (!node.isConnected || !inScope(node) || !visible(node) || occupied || keyOf(node) !== item.key || currentLabel(node) !== item.label) {
        throw new Error(occupied ? 'Already answered; left unchanged.' : 'The control changed. Read the form again.');
      }
      if (descriptor.kind === 'combobox') {
        let options = await openOptions(node);
        let matches = options.filter(option => option.label === item.optionLabel);
        if (matches.length === 0 && descriptor.searchable) {
          options = await openOptions(node, item.value, item.optionLabel);
          matches = options.filter(option => option.label === item.optionLabel);
        }
        if (matches.length !== 1) {
          closeOptions(node);
          throw new Error('No unique exact dropdown choice. Select on the original website.');
        }
        matches[0].node.click(); node.blur();
        await wait(200); samePage();
        if (!node.isConnected || comboSelection(node) !== item.optionLabel) throw new Error('The selected dropdown value did not persist. Check it on the website.');
        await wait(150); samePage();
        if (comboSelection(node) !== item.optionLabel) throw new Error('The selected dropdown value disappeared. Check it on the website.');
      } else {
        const ashbyDate = descriptor.kind === 'date' && ashby && node.classList.contains('ashby-application-form-input-date');
        const value = ashbyDate ? `${item.value.slice(5, 7)}/${item.value.slice(8, 10)}/${item.value.slice(0, 4)}` : item.value;
        const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        node.focus();
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
        node.dispatchEvent(new Event('input', {bubbles: true})); node.dispatchEvent(new Event('change', {bubbles: true}));
        node.blur(); await wait(150); samePage();
        if (!node.isConnected || node.value !== value || (node.validity && !node.validity.valid)) throw new Error('This answer did not persist after leaving the field. Check it on the website.');
        await wait(150); samePage();
        if (!node.isConnected || node.value !== value) throw new Error('This answer disappeared after leaving the field. Check it on the website.');
      }
      filled.push(item.id);
    } catch (error) {
      skipped.push(item.id); reasons[item.id] = error.message || 'Complete this answer on the original website.';
    }
  }
  return {filled, skipped, reasons, submitted: false};
  } catch (error) {
    if (action !== 'inspect') throw error;
    const codes = {'Open a supported Greenhouse, Lever or Ashby hosted application form.': 'unsupported_page',
      'Application page changed. Read it again.': 'page_changed',
      'Dropdown changed while reading. Check the original form.': 'dropdown_changed',
      'Ambiguous application fields. Complete this form manually.': 'ambiguous_fields'};
    // Do not expose raw DOM exception messages, page content, contact details or
    // stack traces. The popup receives a stable code even when Chrome swallows errors.
    return {inspection_version: 1, ok: false, error: {code: codes[error?.message] || 'reader_failed', stage: diagnosticStage}};
  }
}
