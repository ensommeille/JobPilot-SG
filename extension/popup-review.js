// Popup-only projections. No name splitting or inferred application facts.
import {matchATSSelectOption} from './ats-page.js';
export function activeApplicationTool(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
  if (['www.internsg.com', 'internsg.com'].includes(url.hostname) && /^\/job-apply\/\d+\/?$/.test(url.pathname) && !url.search) return 'original-tools';
  const greenhousePath = url.pathname.match(/^\/[A-Za-z0-9_-]+\/jobs\/([0-9]+)\/?$/);
  if (['job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io', 'boards.greenhouse.io'].includes(url.hostname)
      && greenhousePath && (!url.search || url.search === `?gh_jid=${greenhousePath[1]}`)) return 'ats-tools';
  if (['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname)
      && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\/apply\/?$/.test(url.pathname) && !url.search) return 'ats-tools';
  if (url.hostname === 'jobs.ashbyhq.com'
      && /^\/[A-Za-z0-9_-]+\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/application\/?$/i.test(url.pathname)
      && !url.search) return 'ats-tools';
  return null;
}

const factAliases = { first_name: 'given_name', last_name: 'family_name', email: 'contact_email',
  nationality_country: 'nationality', study_country: 'study_country', availability: 'availability_period', summary: 'resume_summary' };
export function autofillPlaceholder(field, factKey) {
  const placeholders = {linkedin: 'Your LinkedIn URL', github: 'Your GitHub URL', portfolio: 'Your website or portfolio URL',
    given_name: 'Your first name', family_name: 'Your last name', email: 'Your email address', contact_email: 'Your email address',
    phone: 'Your phone number', phone_country_code: 'Your phone country code', current_city: 'Your current city',
    availability: 'Your availability period', availability_period: 'Your availability period'};
  if (placeholders[factKey]) return placeholders[factKey];
  const label = (field.label || 'answer').replace(/[\s:*✱]+$/g, '').trim();
  if (/^current (?:company|employer)$/i.test(label)) return 'Your current company';
  if (/^current location$/i.test(label)) return 'Your current location';
  if (/^github\s*\/\s*portfolio(?:\s+url)?$/i.test(label)) return 'Your GitHub or portfolio URL';
  if (/\blinked\s?in\b/i.test(label)) return placeholders.linkedin;
  if (/^preferred (?:first )?name$/i.test(label)) return 'Your preferred first name (optional)';
  if (field.draftable) {
    if (/cover letter/i.test(label)) return 'Your cover letter';
    if (/motivation|why/i.test(label)) return 'Your reason for applying';
    if (/experience|project/i.test(label)) return 'Your relevant experience';
    return 'Your brief introduction';
  }
  return 'Your ' + label.charAt(0).toLowerCase() + label.slice(1);
}
export function autofillFactKey(field, mappings = []) {
  if (field.manualOnly) return null;
  const mapped = mappings.find(item => item.field_id === field.id)?.fact_key;
  return mapped || factAliases[field.evidenceKey] || field.evidenceKey || factAliases[field.id] || field.id;
}
// Explicit one-off template text, never a saved fact or a made-up genuine URL.
export function professionalUrlTemplate(field, profile, mappings = []) {
  const key = autofillFactKey(field, mappings);
  if (!field.available || field.occupied || field.manualOnly || field.kind !== 'text'
      || !['linkedin', 'github', 'portfolio'].includes(key)
      || (typeof profile.values?.[key] === 'string' && profile.values[key].trim())) return null;
  const value = autofillPlaceholder(field, key);
  return value.length <= (field.maxLength || 10000) ? {key, value, source: 'template'} : null;
}
// Ordinary text may carry visibly unfinished editable text, never invented facts.
// Sensitive declarations and formats that require a real value remain unanswered.
export function autofillTextTemplate(field, profile, mappings = []) {
  if (!field.available || field.occupied || field.manualOnly || field.kind !== 'text') return null;
  const key = autofillFactKey(field, mappings);
  const protectedText = [field.id, field.label, field.evidenceKey, key].filter(Boolean).join(' ').replaceAll('_', ' ');
  if (/\b(?:e-?mail|phone|telephone|mobile|applicant contact|contact number|date|month|year|age|birth|salary|stipend|gpa|score|number|amount|currency|notice period|visa|sponsor(?:ship)?|citizen(?:ship)?|nationality|eligible|eligibility|permit|disability|disabled|veteran|gender|ethnicity|race|religion|passport|nric|consent|agree|agreement|terms|privacy|declaration|declare|certify|signature|captcha|criminal|conviction|work status|employment status|right to work|work authori[sz]ation)\b/i.test(protectedText)
      || /^(?:are|is|was|were|do|does|did|have|has|can|could|will|would)\b/i.test(field.label?.trim() || '')) return null;
  if (autofillSuggestion(field, profile, mappings).value
      || (typeof profile.values?.[key] === 'string' && profile.values[key].trim())) return null;
  const value = autofillPlaceholder(field, key);
  return value.length <= (field.maxLength || 10000) ? {key, value, source: 'template'} : null;
}
export function formPlanFields(fields) {
  return fields.filter(field => field.available && !field.occupied && !field.manualOnly && field.needsMapping)
    .slice(0, 40).map(field => ({ id: field.id, label: field.label, kind: field.kind,
      manualOnly: false, ...(field.options?.length ? { options: field.options.slice(0, 100).map(({value, label}) => ({value, label})) } : {}) }));
}

export function approvedAutofillAnswers(editors) {
  return Object.freeze([...editors].flatMap(([id, {input, field, factKey}]) => {
    const value = input.value.trim();
    if (!value || !field.available || field.occupied || field.manualOnly) return [];
    const item = { id, key: field.key, label: field.label, kind: field.kind || 'text', evidenceKey: field.evidenceKey ?? null,
      value, confirmed: true, ...(factKey ? {factKey} : {}) };
    if (['select', 'combobox'].includes(field.kind)) {
      const option = field.options?.find(choice => choice.value === value);
      if (field.kind === 'select' && !option) return [];
      item.optionLabel = option?.label || value;
    }
    return [Object.freeze(item)];
  }));
}

export function autofillSuggestion(field, profile, mappings = []) {
  let key = autofillFactKey(field, mappings);
  if (!field.manualOnly && field.kind === 'text' && /^github\s*\/\s*portfolio(?:\s+url)?[\s:*✱]*$/i.test(field.label || '')) {
    const links = ['github', 'portfolio'].flatMap(factKey => {
      const value = profile.values?.[factKey];
      if (typeof value !== 'string' || !value.trim()) return [];
      try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? [{key: factKey, value}] : []; }
      catch { return []; }
    });
    if (new Set(links.map(link => link.value)).size === 1) key = links[0].key;
  }
  const value = key && typeof profile.values?.[key] === 'string' ? profile.values[key] : '';
  if (!value) return {key, value: ''};
  if (field.kind === 'select' || field.kind === 'combobox') {
    const choice = matchATSSelectOption({...field, evidenceKey: key === 'nationality' ? 'nationality_country' : key}, value);
    if (choice || field.kind === 'select') return {key, value: choice};
    // A school/city list may be only its first async page. Preserve a saved text
    // fact as a search candidate; the adapter must still find one exact option.
    const needsExplicitChoice = ['degree', 'phone_country_code', 'nationality', 'study_country', 'current_country'].includes(key)
      || /^education_(?:start|end)_month$/.test(key || '');
    return {key, value: field.searchable !== false && !needsExplicitChoice && value.length <= (field.maxLength || 10000) ? value : '', candidate: true};
  }
  if (field.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return {key, value: ''};
  if (field.kind === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value)) return {key, value: ''};
  return {key, value: value.length <= (field.maxLength || 10000) ? value : ''};
}
