// Self-contained: Chrome serializes this function into an isolated content world.
export function interactWithPage(command, expectedUrl = null, approved = [], deadline = null) {
  const url = new URL(location.href);
  if (url.protocol !== 'https:' || !['www.internsg.com', 'internsg.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash
      || !/^\/job-apply\/[0-9]+\/?$/.test(url.pathname)) {
    throw new Error('Open an InternSG application page (/job-apply/…) first.');
  }
  if (expectedUrl && location.href !== expectedUrl) throw new Error('Page changed. Read fields again.');
  const definitions = [
    ['applicant_name', 'Full name', 'input', 200],
    ['applicant_email', 'Email address', 'input', 320],
    ['applicant_contact', 'Contact number', 'input', 40],
    ['applicant_period', 'Availability period', 'input', 500],
    ['applicant_summary', 'Resume summary', 'textarea', 3000],
  ];
  const getNode = ([id, , tag]) => {
    const matches = document.querySelectorAll(`[id="${id}"]`);
    if (matches.length !== 1) return null;
    const node = matches[0];
    if (node.tagName.toLowerCase() !== tag || node.name !== id || node.disabled || node.readOnly
        || !node.form || node.form.method.toLowerCase() !== 'post'
        || new URL(node.form.action, location.href).origin !== location.origin
        || (tag === 'input' && !['text', 'email', 'tel'].includes(node.type))
        || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible') return null;
    return node;
  };
  if (command === 'inspect') {
    const fields = definitions.flatMap(def => {
      const node = getNode(def);
      return node ? [{id: def[0], label: def[1], maxLength: Math.min(def[3], node.maxLength > 0 ? node.maxLength : def[3]), occupied: node.value !== ''}] : [];
    });
    return {url: location.href, title: document.title.slice(0, 200), fields};
  }
  if (command !== 'fill' || !Array.isArray(approved) || approved.length > 5) throw new Error('Invalid operation.');
  const seen = new Set();
  const plan = approved.map(item => {
    const def = definitions.find(entry => entry[0] === item.id);
    if (!def || seen.has(item.id) || item.confirmed !== true || typeof item.value !== 'string'
        || !item.value.trim() || item.value.length > def[3]) throw new Error('Invalid confirmed field.');
    seen.add(item.id);
    return {item, def};
  });
  const filled = [], skipped = [], reasons = {};
  for (const {item, def} of plan) {
    if (deadline !== null && (!Number.isFinite(deadline) || Date.now() >= deadline)) throw new Error('Fill deadline expired. Inspect again before any retry.');
    const node = getNode(def);
    if (!node || node.value !== '' || (node.maxLength > 0 && item.value.length > node.maxLength)) {
      skipped.push(item.id);
      reasons[item.id] = !node ? 'Field is missing, hidden, disabled, duplicated or no longer safe to fill.' : node.value !== '' ? 'The website already has an answer; it was not overwritten.' : `Answer exceeds the website limit of ${node.maxLength} characters.`;
      continue;
    }
    const prototype = def[2] === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, item.value);
    node.dispatchEvent(new Event('input', {bubbles: true}));
    node.dispatchEvent(new Event('change', {bubbles: true}));
    if (node.value === item.value) filled.push(item.id); else { skipped.push(item.id); reasons[item.id] = 'The website did not retain this value. Complete it manually.'; }
  }
  return {filled, skipped, reasons, submitted: false};
}
