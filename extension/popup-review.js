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
export function autofillFactKey(field, mappings = []) {
  if (field.manualOnly) return null;
  const mapped = mappings.find(item => item.field_id === field.id)?.fact_key;
  return mapped || factAliases[field.evidenceKey] || field.evidenceKey || factAliases[field.id] || field.id;
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
  const key = autofillFactKey(field, mappings);
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
