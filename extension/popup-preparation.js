// A single bounded preparation request supplements a visible saved-facts preview.
// These helpers never write a website, store profile changes or infer missing facts.
import {autofillSuggestion, autofillTextTemplate} from './popup-review.js';

export const PREPARATION_TIMEOUT_MS = 8200;

const untouchedTemplate = editor => !editor.edited && editor.source === 'template'
  && typeof editor.templateValue === 'string' && editor.input.value.trim() === editor.templateValue;

function ordinaryPendingText(field, profile) {
  if (!field || field.kind !== 'text' || field.manualOnly || field.occupied || !field.available) return null;
  const label = [field.id, field.label, field.evidenceKey].filter(Boolean).join(' ').replaceAll('_', ' ');
  if (/\b(?:visa|sponsor(?:ship)?|citizen(?:ship)?|nationality|eligible|eligibility|permit|disability|disabled|veteran|gender|ethnicity|race|religion|passport|nric|consent|agree|agreement|terms|privacy|declaration|declare|certify|signature|captcha|criminal|conviction|work status|employment status|right to work|work authori[sz]ation)\b/i.test(label)
      || /^(?:are|is|was|were|do|does|did|have|has|can|could|will|would)\b/i.test(field.label?.trim() || '')) return null;
  const value = autofillTextTemplate(field, profile)?.value || 'To be confirmed';
  return value.length <= (field.maxLength || 3000) ? value : null;
}

function preparationCandidates(editors) {
  return [...editors].flatMap(([id, editor]) => {
    const field = editor.field;
    if (!field || editor.blocked || editor.edited || (editor.input.value.trim() && !untouchedTemplate(editor)) || field.manualOnly || field.occupied || !field.available) return [];
    return [{id, label: field.label, kind: field.kind || 'text', maxLength: Math.min(field.maxLength || 3000, 10000),
      manualOnly: false, draftable: !!field.draftable,
      searchable: field.searchable === true, optionsPending: field.optionsPending === true || (field.options?.length || 0) > 100,
      ...(field.options?.length ? {options: field.options.slice(0, 100).map(({value, label}) => ({value, label}))} : {})}];
  });
}

export const preparationFields = editors => preparationCandidates(editors).slice(0, 40);
export const preparationOverflowFields = editors => preparationCandidates(editors).slice(40);

export function preparationPatch(answer, editor, profile) {
  const field = editor?.field;
  if (!field || editor.blocked || editor.edited || (editor.input.value.trim() && !untouchedTemplate(editor)) || field.occupied || field.manualOnly || !field.available
      || !answer || answer.field_id !== field.id || typeof answer.value !== 'string' || !answer.value.trim()
      || answer.value.length > (field.maxLength || 3000)) return null;
  if (answer.source === 'saved') {
    if (typeof answer.fact_key !== 'string' || !Object.hasOwn(profile.values, answer.fact_key)) return null;
    const projected = autofillSuggestion(field, profile, [{field_id: field.id, fact_key: answer.fact_key}]);
    return projected.value === answer.value ? {value: answer.value, factKey: answer.fact_key, source: 'saved'} : null;
  }
  if (['select', 'combobox'].includes(field.kind)) {
    const options = Array.isArray(field.options) ? field.options : [];
    if (options.some(option => !option || typeof option.label !== 'string' || typeof option.value !== 'string')) return null;
    const protectedLabel = /\b(?:visa|sponsor(?:ship)?|citizen(?:ship)?|nationality|eligible|eligibility|permit|disability|veteran|gender|ethnicity|race|religion|passport|nric|consent|agree|terms|privacy|declaration|signature|captcha|work status|employment status|right to work|work authori[sz]ation)\b/i;
    const yesNo = options.length && options.every(option => /^(?:yes|no|select|please select|select\.\.\.)?$/i.test(option.label.trim()));
    if (answer.source !== 'ai_draft' || protectedLabel.test(field.label || '') || yesNo
        || /^(?:are|is|was|were|do|does|did|have|has|can|could|will|would)\b/i.test(field.label?.trim() || '')
        || !Array.isArray(answer.citations) || !answer.citations.length
        || answer.citations.some(item => !item || !['resume', 'profile'].includes(item.source)
          || typeof item.source_id !== 'string' || !item.source_id.trim() || typeof item.quote !== 'string' || !item.quote.trim())) return null;
    const matches = options.filter(option => field.kind === 'select' ? option.value === answer.value : option.label === answer.value);
    if (matches.length === 1) {
      const label = matches[0].label.normalize('NFKC').trim().toLowerCase();
      if (options.filter(option => option.label.normalize('NFKC').trim().toLowerCase() === label).length !== 1
          || options.filter(option => option.value === matches[0].value).length !== 1) return null;
      return {value: answer.value, factKey: null, source: 'ai_draft', citations: answer.citations};
    }
    if (field.kind === 'combobox' && !matches.length && field.searchable === true
        && answer.citations.some(item => item.quote.includes(answer.value))) {
      return {value: answer.value, factKey: null, source: 'ai_draft', citations: answer.citations};
    }
    return null;
  }
  if (!['text', 'number'].includes(field.kind) || !['ai_draft', 'pending_confirmation'].includes(answer.source)
      || (field.kind === 'number' && (answer.source !== 'ai_draft' || !/^-?\d+(?:\.\d+)?$/.test(answer.value)))
      || (answer.source === 'pending_confirmation' && answer.value !== 'To be confirmed')) return null;
  if (!Array.isArray(answer.citations) || (answer.source === 'ai_draft' && !answer.citations.length)
      || answer.citations.some(item => !item || !['resume', 'profile', 'job'].includes(item.source)
      || typeof item.source_id !== 'string' || !item.source_id.trim() || typeof item.quote !== 'string' || !item.quote.trim())) return null;
  if (answer.source === 'pending_confirmation') {
    const value = ordinaryPendingText(field, profile);
    return value ? {value, factKey: null, source: 'pending_confirmation', citations: []} : null;
  }
  return {value: answer.value, factKey: null, source: answer.source, citations: answer.citations};
}

export function unfinishedPreparationPatch(editor, profile) {
  if (!editor?.field || editor.blocked || editor.edited || editor.input.value.trim()) return null;
  const value = ordinaryPendingText(editor.field, profile);
  return value ? {value, factKey: null, source: 'unfinished'} : null;
}

export function checkedPreparation(result, fingerprint, fields) {
  if (!result || result.profile_fingerprint !== fingerprint || !['ready', 'partial', 'preparing', 'unavailable'].includes(result.status)
      || !Array.isArray(result.answers) || !Array.isArray(result.omitted) || result.answers.length > fields.length
      || !['not_needed', 'live', 'mock', 'unavailable'].includes(result.execution_mode)) throw new Error('Prepared answers no longer match this saved profile.');
  const ids = new Set(fields.map(field => field.id)), seen = new Set();
  if (result.analyzed_field_ids !== undefined && (!Array.isArray(result.analyzed_field_ids)
      || new Set(result.analyzed_field_ids).size !== result.analyzed_field_ids.length
      || result.analyzed_field_ids.some(id => !ids.has(id)))) throw new Error('Prepared analysis does not match the current questions.');
  for (const answer of result.answers) {
    if (!ids.has(answer?.field_id) || seen.has(answer.field_id)) throw new Error('Prepared answers contain an unknown or repeated question.');
    seen.add(answer.field_id);
  }
  return result;
}

export async function boundedPreparation(request, timeout = PREPARATION_TIMEOUT_MS) {
  let timer;
  const controller = new AbortController();
  try {
    return await Promise.race([request(controller.signal), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Preparation timed out. Your saved answers are still ready to fill.')); }, timeout);
    })]);
  } finally { clearTimeout(timer); }
}

export async function requestPreparation(send, timeout = PREPARATION_TIMEOUT_MS) {
  return boundedPreparation(async signal => {
    let result = await send(false, signal);
    // The first POST is the only one allowed to start work. A concurrent platform
    // warm-up may still be running; bounded cache-only reads cannot call a model.
    for (let attempt = 0; attempt < 10 && result?.status === 'preparing'; attempt++) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 700);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Preparation timed out.')); }, {once: true});
      });
      if (signal.aborted) throw new Error('Preparation timed out.');
      result = await send(true, signal);
    }
    return result;
  }, timeout);
}
