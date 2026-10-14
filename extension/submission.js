// Self-contained MAIN-world adapter. Never solves CAPTCHA or calls form.submit().
export async function submissionPage(command, expectedUrl = null, approval = null) {
  const url = new URL(location.href);
  if (url.protocol !== 'https:' || !['internsg.com', 'www.internsg.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || !/^\/job-apply\/[0-9]+\/?$/.test(url.pathname)
      || (expectedUrl && expectedUrl !== location.href)) throw new Error('Application page changed. Review the original page.');
  const visible = el => !!el?.getClientRects().length && getComputedStyle(el).visibility === 'visible';
  if (command === 'result') {
    const messages = [...document.querySelectorAll('.isg-validate-error, .alert-danger, .alert-success')]
      .filter(visible).map(el => el.textContent.trim().slice(0, 600)).filter(Boolean).slice(0, 6);
    // Success markup has not been verified against a real submission receipt.
    return {state: 'unverified', messages, url: location.href, title: document.title.slice(0, 200)};
  }
  if (!['review', 'submit'].includes(command)) throw new Error('Invalid submission operation.');
  const unique = id => {
    const nodes = document.querySelectorAll(`[id="${id}"]`);
    if (nodes.length !== 1) throw new Error(`Missing or ambiguous ${id}. Complete this application manually.`);
    return nodes[0];
  };
  const button = unique('btnSubmit');
  const form = button.form;
  if (!form || !['INPUT', 'BUTTON'].includes(button.tagName) || button.type !== 'submit' || button.disabled || !visible(button)
      || form.method.toLowerCase() !== 'post' || new URL(form.action).href !== location.href
      || (button.hasAttribute('formaction') && new URL(button.formAction).href !== location.href)
      || button.hasAttribute('formmethod') || button.hasAttribute('formtarget') || form.target) {
    throw new Error('Unsupported submission form. Use the original website manually.');
  }
  const capture = () => {
    if (unique('btnSubmit') !== button || button.form !== form || button.disabled || !visible(button)
        || form.method.toLowerCase() !== 'post' || new URL(form.action).href !== location.href
        || (button.hasAttribute('formaction') && new URL(button.formAction).href !== location.href)
        || button.hasAttribute('formmethod') || button.hasAttribute('formtarget') || form.target) {
      throw new Error('Submission controls changed. Review the original website again.');
    }
    const destination = form.querySelector('.alert-info .text-center')?.textContent.trim();
    if (!destination || destination.length > 1500) throw new Error('Cannot identify the application recipient. Submit manually on the website.');
    const values = {};
    values['Application recipient'] = destination;
    for (const [id, label] of [['applicant_name', 'Full name'], ['applicant_email', 'Email'],
      ['applicant_contact', 'Contact number'], ['applicant_period', 'Availability']]) {
      const el = unique(id);
      if (el.form !== form || el.name !== id || el.tagName !== 'INPUT' || !['text', 'email', 'tel'].includes(el.type)
          || el.disabled || !visible(el) || !el.value.trim() || !el.checkValidity()) throw new Error(`Check ${label} on the website.`);
      values[label] = el.value;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.Email)) throw new Error('Check the email address on the website.');
    const summary = unique('applicant_summary');
    if (summary.form !== form || summary.tagName !== 'TEXTAREA' || summary.disabled) throw new Error('Summary control changed.');
    const editor = window.FroalaEditor?.INSTANCES?.find(e => e.el === summary || e.$oel?.[0] === summary);
    let summaryHtml = summary.value;
    if (editor) {
      if (!visible(editor.el) || editor.core.isEmpty()) throw new Error('Complete the resume summary on the website.');
      summaryHtml = editor.html.get();
    } else if (!visible(summary)) throw new Error('Summary editor is not ready.');
    const parsed = new DOMParser().parseFromString(summaryHtml, 'text/html');
    values['Resume summary'] = parsed.body.textContent.trim();
    if (!values['Resume summary']) throw new Error('Complete the resume summary on the website.');
    const jq = window.jQuery;
    for (const [id, label] of [['applicant_nationality', 'Nationality'], ['applicant_campus', 'Study country']]) {
      const el = unique(id), code = unique(id + '_code');
      if (el.form !== form || code.form !== form || el.disabled || code.disabled || !jq?.fn?.countrySelect
          || !jq(el).data('plugin_countrySelect')) throw new Error('Country widgets are not ready.');
      const selected = jq(el).countrySelect('getSelectedCountryData');
      if (!selected || !/^[a-z]{2}$/.test(code.value) || selected.iso2 !== code.value || selected.name !== el.value) {
        throw new Error('Country text and selection differ. Select countries on the website again.');
      }
      values[label] = el.value;
    }
    const same = unique('campus_same_nationality');
    if (same.form !== form || same.type !== 'checkbox' || same.disabled) throw new Error('Study-country checkbox changed.');
    if (same.checked) values['Study country'] = values.Nationality;
    if (!form.checkValidity()) throw new Error('The website has incomplete or invalid required fields. Review them there.');
    // Include hidden fields in the fingerprint, not in the preview or stored record.
    const controls = [...form.elements].filter(el => el.name !== 'g-recaptcha-response')
      .map(el => [el.tagName, el.name, el.type, el.value, el.checked, el.disabled]);
    return {values, serialized: JSON.stringify([location.href, form.action, destination, controls, summaryHtml])};
  };
  const captchaReady = () => {
    try { return typeof window.grecaptcha?.getResponse === 'function' && !!window.grecaptcha.getResponse(); }
    catch { return false; }
  };
  const before = capture();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(before.serialized));
  const fingerprint = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (command === 'review') return {values: before.values, fingerprint, captchaReady: captchaReady(), url: location.href,
    title: document.title.slice(0, 200), reviewedAt: Date.now()};
  if (approval?.confirmed !== true || approval.fingerprint !== fingerprint
      || !Number.isFinite(approval.reviewedAt) || Date.now() - approval.reviewedAt > 120000
      || approval.reviewedAt > Date.now() || capture().serialized !== before.serialized) {
    return {state: 'not_clicked', reason: 'Answers changed or confirmation expired. Review the application again.'};
  }
  if (!captchaReady()) return {state: 'not_clicked', reason: 'Complete CAPTCHA yourself on the original page, then review again.'};
  // Only invoke the site's real button, preserving its validation and submit handlers.
  button.click();
  return {state: 'click_attempted', reason: 'Submission button activated. Delivery is not yet verified.'};
}

// Cross-popup lock plus durable reservation. An interrupted attempt stays blocked.
export async function reserveAttempt(storage, locks, key, record) {
  if (!locks?.request) throw new Error('Duplicate protection unavailable. Submit manually on the website.');
  return locks.request(key, async () => {
    if ((await storage.get(key))[key]) throw new Error('An earlier attempt exists for this job. Check the original result; automatic retry is blocked.');
    await storage.set({[key]: record});
  });
}
