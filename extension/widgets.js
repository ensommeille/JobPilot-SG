// Runs in MAIN world only to access the site's own widget APIs. No credentials enter here.
export function interactWithWidgets(command, expectedUrl = null, approved = [], deadline = null) {
  const url = new URL(location.href);
  if (url.protocol !== 'https:' || !['internsg.com', 'www.internsg.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || !/^\/job-apply\/[0-9]+\/?$/.test(url.pathname) || (expectedUrl && expectedUrl !== location.href)) {
    throw new Error('Page changed or unsupported. Read the InternSG application again.');
  }
  const node = (id, tag, hidden = false) => {
    const nodes = document.querySelectorAll(`[id="${id}"]`);
    const el = nodes[0];
    return nodes.length === 1 && el.tagName === tag && el.name === id && !el.disabled && !el.readOnly
      && el.form?.method.toLowerCase() === 'post' && new URL(el.form.action).origin === location.origin
      && (hidden || (el.getClientRects().length && getComputedStyle(el).visibility === 'visible')) ? el : null;
  };
  const summary = node('applicant_summary', 'TEXTAREA', true);
  const instances = window.FroalaEditor?.INSTANCES;
  const editor = Array.isArray(instances) ? instances.find(e => e.el === summary || e.$oel?.[0] === summary) : null;
  const froalaReady = !!(summary && editor?.html?.set && editor?.html?.get && editor?.core?.isEmpty
    && editor.el?.getClientRects().length);
  // InternSG now mounts Quill after the hidden textarea. Resolve only that exact widget,
  // through Quill's public instance lookup, so an unrelated editable area is never filled.
  const quillBox = summary?.nextElementSibling?.classList.contains('isg-quill-box')
    ? summary.nextElementSibling : null;
  const quillRoot = quillBox?.querySelector('.ql-container > .ql-editor');
  const quillContainer = quillRoot?.parentElement;
  const quill = quillRoot && window.Quill?.find
    ? (window.Quill.find(quillContainer) || window.Quill.find(quillRoot)) : null;
  const quillReady = !!(summary && !froalaReady && quillBox
    && quillBox.querySelectorAll('.ql-editor').length === 1 && quill?.root === quillRoot
    && quillRoot.isContentEditable && quillRoot.getClientRects().length
    && typeof quill.getText === 'function' && typeof quill.setText === 'function');
  const richReady = froalaReady || quillReady;
  const editorEmpty = () => froalaReady ? editor.core.isEmpty() : !quill.getText().trim();
  const backingHasContent = () => {
    // Froala can serialize its own attribution into an otherwise empty editor.
    if (froalaReady && editor.core.isEmpty() && summary.value === editor.html.get()) return false;
    const parsed = new DOMParser().parseFromString(summary?.value || '', 'text/html');
    return !!parsed.body.textContent.trim() || !!parsed.body.querySelector('img,video,audio,iframe,table,hr');
  };
  const jq = window.jQuery;
  const nationality = node('applicant_nationality', 'INPUT');
  const campus = node('applicant_campus', 'INPUT', true);
  const same = node('campus_same_nationality', 'INPUT');
  const countryData = el => jq(el).countrySelect('getSelectedCountryData');
  let countries = [], countryState = null;
  try {
    if (nationality?.type === 'text' && campus?.type === 'text' && same?.type === 'checkbox'
        && nationality.form === campus.form && campus.form === same.form
        && jq?.fn?.countrySelect && jq(nationality).data('plugin_countrySelect') && jq(campus).data('plugin_countrySelect')) {
      countries = jq.fn.countrySelect.getCountryData().map(c => ({code: c.iso2, name: c.name}));
      countryState = {nationality: countryData(nationality).iso2, campus: countryData(campus).iso2,
        same: same.checked, nationalityText: nationality.value, campusText: campus.value};
    }
  } catch { countries = []; countryState = null; }
  if (command === 'inspect') return {
    richReady, summaryOccupied: richReady ? !editorEmpty() || backingHasContent() : false,
    summaryReason: richReady ? '' : 'Rich-text editor is not ready or has changed. Fill the summary on the website.',
    countries, countryState,
    countryReason: countryState ? '' : 'Country widgets are unavailable or have changed. Select both countries on the website.',
  };
  if (command !== 'fill' || !Array.isArray(approved) || approved.length > 2) throw new Error('Invalid widget operation.');
  const seen = new Set();
  for (const item of approved) {
    if (!['applicant_summary', 'applicant_countries'].includes(item.id) || seen.has(item.id) || item.confirmed !== true
        || typeof item.value !== 'string' || !item.value.trim()
        || item.value.length > (item.id === 'applicant_summary' ? 3000 : 1000)) throw new Error('Invalid confirmed widget.');
    if (item.id === 'applicant_countries') {
      const choice = JSON.parse(item.value);
      if (!countries.some(c => c.code === choice.nationality) || !countries.some(c => c.code === choice.campus)
          || !item.expectedState) throw new Error('Select valid nationality and study countries, then confirm.');
    }
    seen.add(item.id);
  }
  const filled = [], skipped = [], reasons = {};
  for (const item of approved) {
    if (deadline !== null && (!Number.isFinite(deadline) || Date.now() >= deadline)) throw new Error('Fill deadline expired. Inspect again before any retry.');
    try {
      if (item.id === 'applicant_summary') {
        if (!richReady) throw new Error('Rich-text editor is not ready. Reload the page and read fields again.');
        if (!editorEmpty() || backingHasContent()) throw new Error('The website already contains a summary; it was not overwritten.');
        if (quillReady) {
          const normalized = item.value.replace(/\r\n/g, '\n');
          quill.setText(normalized, 'api');
          // InternSG's onChange handler mirrors Quill into the form's textarea.
          // Never claim success if that site-level synchronization did not happen.
          if (quill.getText().replace(/\n$/, '') !== normalized || !backingHasContent()) {
            throw new Error('Editor synchronization failed. Check the summary on the website.');
          }
        } else {
          const container = document.createElement('div');
          for (const line of item.value.split(/\r?\n/)) {
            const paragraph = document.createElement('p'); paragraph.textContent = line;
            if (!line) paragraph.append(document.createElement('br'));
            container.append(paragraph);
          }
          editor.html.set(container.innerHTML);
          const html = editor.html.get();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(summary, html);
          editor.events?.trigger('contentChanged');
          summary.dispatchEvent(new Event('input', {bubbles: true}));
          summary.dispatchEvent(new Event('change', {bubbles: true}));
          if (editor.core.isEmpty() || summary.value !== editor.html.get()) throw new Error('Editor synchronization failed. Check the summary on the website.');
        }
      } else {
        // Extension serialization may reorder keys. Compare values, not JSON text.
        const stateKeys = ['nationality', 'campus', 'same', 'nationalityText', 'campusText'];
        if (!countryState || stateKeys.some(key => !Object.prototype.hasOwnProperty.call(item.expectedState, key)
            || countryState[key] !== item.expectedState[key])) {
          throw new Error('Country selections changed since reading. Read the page again before replacing them.');
        }
        const choice = JSON.parse(item.value);
        // Nationality change resets campus on InternSG. Always set campus afterwards.
        jq(nationality).countrySelect('selectCountry', choice.nationality);
        jq(nationality).trigger('change');
        same.checked = choice.nationality === choice.campus;
        jq(same).trigger('change');
        jq(campus).countrySelect('selectCountry', choice.campus);
        jq(campus).trigger('change');
        if (countryData(nationality).iso2 !== choice.nationality || countryData(campus).iso2 !== choice.campus
            || document.getElementById('applicant_nationality_code')?.value !== choice.nationality
            || document.getElementById('applicant_campus_code')?.value !== choice.campus
            || same.checked !== (choice.nationality === choice.campus)) {
          throw new Error('Country synchronization failed. Review nationality and study country on the website.');
        }
      }
      filled.push(item.id);
    } catch (error) { skipped.push(item.id); reasons[item.id] = error.message || 'Widget failed. Complete it on the website.'; }
  }
  return {filled, skipped, reasons, submitted: false};
}
