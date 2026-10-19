// Runs in the active original-site tab. It never clicks a button or submits a form.
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
  const find = id => {
    const nodes = [...new Set(selectors[id].flatMap(selector => [...document.querySelectorAll(selector)]))]
      .filter(node => node instanceof HTMLInputElement && ['text', 'email', 'tel'].includes(node.type)
        && !node.disabled && !node.readOnly && node.getClientRects().length > 0);
    return nodes.length === 1 ? nodes[0] : null;
  };
  if (action === 'inspect') {
    return {provider: greenhouse ? 'Greenhouse' : 'Lever', url: location.href,
      fields: Object.keys(selectors).map(id => {
        const node = find(id);
        return {id, available: !!node, occupied: !!node?.value.trim(),
          maxLength: node?.maxLength > 0 ? node.maxLength : 2000};
      })};
  }
  if (action !== 'fill' || !Array.isArray(approved) || approved.length > 4
      || new Set(approved.map(item => item.id)).size !== approved.length
      || approved.some(item => !Object.hasOwn(selectors, item.id)
        || typeof item.value !== 'string' || !item.value.trim() || item.value.length > 2000
        || item.confirmed !== true)) throw new Error('Invalid reviewed answers.');
  const filled = [], skipped = [];
  for (const item of approved) {
    const node = find(item.id);
    if (!node || node.value.trim() || (node.maxLength > 0 && item.value.length > node.maxLength)) {
      skipped.push(item.id); continue;
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) { skipped.push(item.id); continue; }
    setter.call(node, item.value);
    node.dispatchEvent(new Event('input', {bubbles: true}));
    node.dispatchEvent(new Event('change', {bubbles: true}));
    if (node.value === item.value) filled.push(item.id);
    else skipped.push(item.id);
  }
  return {filled, skipped, submitted: false};
}
