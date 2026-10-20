// Runs in the active hosted ATS tab. No file upload, consent, CAPTCHA, or submission.
export function interactWithATSPage({action, expectedUrl = '', approved = []}) {
  const url = new URL(location.href);
  const greenhousePath = url.pathname.match(/^\/[A-Za-z0-9_-]+\/jobs\/([0-9]+)\/?$/);
  const greenhouse = ['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(url.hostname)
    && !!greenhousePath && (!url.search || url.search === `?gh_jid=${greenhousePath[1]}`);
  const lever = ['jobs.lever.co', 'jobs.eu.lever.co'].includes(url.hostname)
    && /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\/apply\/?$/.test(url.pathname) && !url.search;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !(greenhouse || lever)) {
    throw new Error('Open a supported Greenhouse or Lever hosted application form.');
  }
  if (action === 'fill' && location.href !== expectedUrl) throw new Error('Application URL changed. Read the form again.');
  const selectors = greenhouse ? {
    first_name: ['input[name="first_name"]', 'input[name="job_application[first_name]"]', '#first_name'],
    last_name: ['input[name="last_name"]', 'input[name="job_application[last_name]"]', '#last_name'],
    email: ['input[name="email"]', 'input[name="job_application[email]"]', '#email'],
    phone: ['input[name="phone"]', 'input[name="job_application[phone]"]', '#phone'],
  } : {
    full_name: ['input[name="name"]', '#name'],
    email: ['input[name="email"]', '#email'],
    phone: ['input[name="phone"]', '#phone'],
  };
  const visible = node => !node.disabled && !node.readOnly && node.getClientRects().length > 0;
  const basicNode = id => {
    const nodes = [...new Set(selectors[id].flatMap(selector => [...document.querySelectorAll(selector)]))]
      .filter(node => node instanceof HTMLInputElement && ['text', 'email', 'tel'].includes(node.type) && visible(node));
    return nodes.length === 1 ? nodes[0] : null;
  };
  const basic = Object.keys(selectors).map(id => ({id, node: basicNode(id)}));
  const excluded = new Set(basic.map(field => field.node).filter(Boolean));
  const forms = [...new Set(basic.map(field => field.node?.form).filter(Boolean))];
  const form = forms.length === 1 ? forms[0] : null;
  const labelOf = node => {
    const explicit = [...(node.labels || [])].map(label => label.textContent?.trim()).filter(Boolean);
    const aria = node.getAttribute('aria-label')?.trim();
    const labelledBy = node.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean) || [];
    return (explicit[0] || aria || labelledBy.join(' ')).replace(/\s+/g, ' ').slice(0, 240);
  };
  // Sensitive, legal, demographic and employer-specific assertions are never suggested.
  const classify = label => {
    const text = label.toLowerCase();
    if (/visa|sponsor|authori[sz]|eligible|citizen|residen|permit|disab|veteran|gender|ethnic|race|religion|age|birth|salary|compensation|consent|agree|terms|privacy|declaration|signature|referral|how did you hear|why (?:us|this|do you)|motivation|cover letter|\b(?:do you|have you|how many|years?|not|don't|wish|want to learn)\b/.test(text)) return null;
    if (/linkedin/.test(text)) return 'linkedin';
    if (/github/.test(text)) return 'github';
    if (/availability (?:period|dates?|window)|when (?:can|could) you start|available start date/.test(text) && !/date of|specific date/.test(text)) return 'availability';
    if (/educational background|describe your education|education summary/.test(text)) return 'education';
    if (/describe your (?:relevant |work |professional )?experience|experience summary|work experience/.test(text)) return 'experience';
    if (/relevant skills|technical skills|programming languages|skills summary/.test(text)) return 'skills';
    if (/tell us about yourself|brief introduction|professional summary|about yourself/.test(text)) return 'summary';
    return null;
  };
  const custom = [];
  const manualQuestions = [];
  if (form) {
    const candidates = [...form.querySelectorAll('input, textarea')].filter(node =>
      !excluded.has(node) && visible(node) && (node instanceof HTMLTextAreaElement
        || (node instanceof HTMLInputElement && ['text', 'url'].includes(node.type))));
    for (const node of candidates.slice(0, 40)) {
      const label = labelOf(node);
      const key = node.name ? `name:${node.name}` : node.id ? `id:${node.id}` : '';
      if (!label) continue;
      if (!key || key.length > 220 || !classify(label)) {
        if (manualQuestions.length < 20) manualQuestions.push(label);
        continue;
      }
      const matches = candidates.filter(other => (node.name ? other.name === node.name : other.id === node.id));
      if (matches.length !== 1) {
        if (manualQuestions.length < 20) manualQuestions.push(label);
        continue;
      }
      custom.push({id: `custom:${custom.length}`, node, label, key, evidenceKey: classify(label)});
      if (custom.length === 12) break;
    }
  }
  const fields = [
    ...basic.map(({id, node}) => ({id, label: id.replaceAll('_', ' '), available: !!node,
      occupied: !!node?.value.trim(), maxLength: node?.maxLength > 0 ? node.maxLength : 2000})),
    ...custom.map(({id, node, label, key, evidenceKey}) => ({id, label, key, evidenceKey,
      available: true, occupied: !!node.value.trim(), maxLength: node.maxLength > 0 ? node.maxLength : 3000})),
  ];
  if (action === 'inspect') return {provider: greenhouse ? 'Greenhouse' : 'Lever', url: location.href, fields, manualQuestions};
  if (action !== 'fill' || !Array.isArray(approved) || approved.length > 16
      || new Set(approved.map(item => item.id)).size !== approved.length
      || approved.some(item => typeof item.id !== 'string' || typeof item.value !== 'string'
        || !item.value.trim() || item.value.length > 3000 || item.confirmed !== true)) {
    throw new Error('Invalid reviewed answers.');
  }
  const filled = [], skipped = [];
  for (const item of approved) {
    const descriptor = fields.find(field => field.id === item.id);
    const customField = custom.find(field => field.id === item.id);
    if (!descriptor || (customField && (item.key !== customField.key || item.label !== customField.label
      || item.evidenceKey !== customField.evidenceKey)) || (!customField && item.key)) {
      throw new Error('Invalid reviewed answers. Read the form again.');
    }
    const node = customField?.node || basic.find(field => field.id === item.id)?.node;
    if (!node || node.value.trim() || item.value.length > descriptor.maxLength) {
      skipped.push(item.id); continue;
    }
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (!setter) { skipped.push(item.id); continue; }
    setter.call(node, item.value);
    node.dispatchEvent(new Event('input', {bubbles: true}));
    node.dispatchEvent(new Event('change', {bubbles: true}));
    if (node.value === item.value) filled.push(item.id);
    else skipped.push(item.id);
  }
  return {filled, skipped, submitted: false};
}
