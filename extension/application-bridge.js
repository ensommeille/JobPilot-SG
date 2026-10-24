import {DEPLOYMENTS} from './connection.js';
import {interactWithPage} from './page.js';
import {interactWithWidgets} from './widgets.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const DEFINITIONS = [
  ['applicant_name', 'Full name', 200],
  ['applicant_email', 'Email address', 320],
  ['applicant_contact', 'Contact number', 40],
  ['applicant_period', 'Availability period', 500],
  ['applicant_summary', 'Resume summary', 3000],
];
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validApplication = value => {
  if (typeof value !== 'string' || value.length > 200) return false;
  try {
    const url = new URL(value);
    return url.href === value && url.protocol === 'https:' && ['internsg.com', 'www.internsg.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/job-apply\/[0-9]+\/?$/.test(url.pathname);
  } catch { return false; }
};
const validParent = (value, origin, jobId) => {
  try {
    const url = new URL(value);
    return url.href === value && url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      && new RegExp(`^/jobs/${jobId}/apply-external/?$`).test(url.pathname);
  } catch { return false; }
};
const sameApplication = (actual, expected) => validApplication(actual) && validApplication(expected)
  && new URL(actual).origin === new URL(expected).origin
  && new URL(actual).pathname.replace(/\/$/, '') === new URL(expected).pathname.replace(/\/$/, '');

// Serialized into the trusted platform's ISOLATED world. The platform JWT never
// leaves this function except as Authorization to its fixed, paired API origin.
export async function verifyPlatformApplication(expectedOrigin, expectedPageUrl, jobId, deadline = Date.now() + 15000) {
  const deployments = {'http://127.0.0.1:5173': 'http://127.0.0.1:8001', 'http://localhost:5173': 'http://localhost:8000',
    'http://127.0.0.1:15523': 'http://127.0.0.1:18523'};
  const api = deployments[location.origin];
  // Sender URL metadata can retain the initial document URL after SPA navigation.
  // Read the current route only inside the sender's exact isolated document.
  const parentUrl = location.href;
  const checkPage = () => {
    const frames = [...document.querySelectorAll('iframe[data-jobpilot-internsg]')];
    const current = new URL(location.href);
    if (Date.now() >= deadline || !api || window !== window.top || location.href !== parentUrl
        || current.origin !== expectedOrigin || current.username || current.password || current.search || current.hash
        || !new RegExp(`^/jobs/${jobId}/apply-external/?$`).test(location.pathname)
        || frames.length !== 1 || frames[0].src !== expectedPageUrl) throw new Error('Application page changed. Load the original form and inspect again.');
  };
  checkPage();
  const token = localStorage.getItem('jobpilot_token');
  if (!token || token.startsWith('jpx_')) throw new Error('Sign in to JobPilot first.');
  const request = async (path, body) => {
    const response = await fetch(api + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))),
    });
    if (!response.ok) throw new Error('Could not verify the signed-in platform account, job or saved details.');
    return response.json();
  };
  const ids = ['applicant_name', 'applicant_email', 'applicant_contact', 'applicant_period', 'applicant_summary'];
  const [user, job, draft] = await Promise.all([
    request('/users/me'), request('/jobs/' + jobId), request('/browser-assistant/draft', {page_url: expectedPageUrl, field_ids: ids}),
  ]);
  if (typeof user?.id !== 'string' || job?.id !== jobId || job.status !== 'active' || job.apply_url !== expectedPageUrl
      || !draft?.values || !draft?.countries) throw new Error('Account or active job does not match this application.');
  const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
  const profile = {values: Object.fromEntries(ids.map(id => [id, draft.values[id] || ''])),
    countries: {nationality: draft.countries.nationality || '', campus: draft.countries.campus || ''}};
  const [sessionHash, profileHash] = await Promise.all([sha(token), sha(JSON.stringify(profile))]);
  checkPage();
  if (localStorage.getItem('jobpilot_token') !== token) throw new Error('Platform account changed. Reload saved details.');
  return {userId: user.id, sessionHash, profileHash, parentUrl};
}

// Discovery reveals only a matching URL, not any field values or page content.
export function matchEmbeddedApplication(expectedUrl) {
  if (window === window.top || window.parent !== window.top) return null;
  try {
    const actual = new URL(location.href), expected = new URL(expectedUrl);
    const safe = url => url.protocol === 'https:' && ['internsg.com', 'www.internsg.com'].includes(url.hostname)
      && !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/job-apply\/[0-9]+\/?$/.test(url.pathname);
    // Permit only the same site's trailing-slash canonicalization, not a new target.
    return safe(actual) && safe(expected) && actual.origin === expected.origin
      && actual.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '') ? {url: actual.href} : null;
  } catch { return null; }
}

export function createApplicationHandler(chromeApi, fetcher = fetch, now = () => Date.now()) {
  // Deliberately not persisted. A worker restart invalidates all reviews safely.
  const reviews = new Map();
  chromeApi.storage.onChanged?.addListener((changes, area) => {
    if (area === 'session' && changes.jobpilotSession) reviews.clear();
  });
  const changed = () => { throw new Error('Application, account or saved details changed. Reload saved details and inspect again.'); };
  const timely = deadline => { if (Date.now() >= deadline) throw new Error('Application check timed out. Inspect again; no automatic retry is allowed.'); };
  const readSession = async site => {
    const {jobpilotSession: session} = await chromeApi.storage.session.get('jobpilotSession');
    if (!session || session.site !== site || session.api !== DEPLOYMENTS[site] || !session.token?.startsWith('jpx_')
        || typeof session.userId !== 'string' || !Number.isFinite(session.expiresAt) || session.expiresAt * 1000 <= now()) {
      throw new Error('Connect this account through the JobPilot extension first.');
    }
    return session;
  };
  const sessionKey = session => digest(JSON.stringify([session.site, session.api, session.userId, session.token, session.expiresAt]));
  const execute = async (request, errorMessage) => {
    try { return await chromeApi.scripting.executeScript(request); }
    catch { throw new Error(errorMessage); }
  };
  const oneResult = (results, documentId) => {
    if (results?.length !== 1 || results[0].documentId !== documentId || !results[0].result) changed();
    return results[0].result;
  };
  async function authorize(message, sender, expected, deadline) {
    timely(deadline);
    const site = new URL(sender.url).origin;
    const session = await readSession(site);
    const sessionFingerprint = await sessionKey(session);
    if (!await chromeApi.permissions.contains({origins: [`${site}/*`, `${session.api}/*`, `${new URL(message.page_url).origin}/*`]})) {
      throw new Error('Grant platform and embedded InternSG access in the extension, then inspect again.');
    }
    let response;
    try {
      response = await fetcher(session.api + '/auth/extension/session', {
        method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: {Authorization: `Bearer ${session.token}`}, signal: AbortSignal.timeout(Math.max(1, Math.min(15000, deadline - Date.now()))),
      });
    } catch { throw new Error('Could not verify the extension account. No filling was started.'); }
    if (!response.ok) throw new Error('Extension session expired or revoked. Reconnect through JobPilot.');
    const extensionUser = await response.json();
    if (extensionUser.user_id !== session.userId || !Number.isFinite(extensionUser.expires_at) || extensionUser.expires_at * 1000 <= now()) changed();
    const platform = oneResult(await execute({target: {tabId: sender.tab.id, documentIds: [sender.documentId]}, world: 'ISOLATED',
      func: verifyPlatformApplication, args: [site, message.page_url, message.job_id, deadline]},
    'Could not verify this platform account, active job or saved details. Reload saved details and inspect again.'), sender.documentId);
    if (platform.userId !== session.userId || !HASH.test(platform.sessionHash) || !HASH.test(platform.profileHash)
        || !validParent(platform.parentUrl, site, message.job_id)) changed();
    if (message.kind === 'application-inspect' && platform.profileHash !== message.profile_fingerprint) {
      throw new Error('Saved details changed. Reload saved details before inspecting the form.');
    }
    const frames = await execute({target: {tabId: sender.tab.id, allFrames: true}, world: 'ISOLATED',
      func: matchEmbeddedApplication, args: [message.page_url]}, 'Could not identify the embedded InternSG form. Load it and inspect again.');
    const matching = frames.filter(frame => sameApplication(frame.result?.url, message.page_url) && frame.documentId && frame.frameId !== 0);
    if (matching.length !== 1) throw new Error('Load exactly one ready InternSG form before inspecting.');
    const context = {tabId: sender.tab.id, parentDocument: sender.documentId, parentUrl: platform.parentUrl,
      documentId: matching[0].documentId, pageUrl: message.page_url, frameUrl: matching[0].result.url, jobId: message.job_id,
      sessionFingerprint, userId: platform.userId, sessionHash: platform.sessionHash, profileHash: platform.profileHash};
    if (sessionFingerprint !== await sessionKey(await readSession(site))) changed();
    if (expected && Object.keys(context).some(key => context[key] !== expected[key])) changed();
    timely(deadline);
    return context;
  }
  async function inspect(message, sender, deadline) {
    const context = await authorize(message, sender, null, deadline);
    const target = {tabId: context.tabId, documentIds: [context.documentId]};
    const page = oneResult(await execute({target, world: 'ISOLATED', func: interactWithPage, args: ['inspect', context.frameUrl]},
      'The original form could not be inspected. No answers were changed.'), context.documentId);
    const widgets = oneResult(await execute({target, world: 'MAIN', func: interactWithWidgets, args: ['inspect', context.frameUrl]},
      'The original form widgets could not be inspected. No answers were changed.'), context.documentId);
    if (page.url !== context.frameUrl || !Array.isArray(page.fields)) changed();
    const fields = DEFINITIONS.map(([id, label, maxLength]) => {
      const field = page.fields.find(value => value.id === id);
      if (id === 'applicant_summary' && widgets.richReady === true) return {id, label, maxLength, occupied: widgets.summaryOccupied === true, widget: true};
      if (!field || typeof field.occupied !== 'boolean' || !Number.isInteger(field.maxLength) || field.maxLength <= 0) {
        return {id, label, maxLength, occupied: false, unavailable: true};
      }
      return {id, label, maxLength: Math.min(maxLength, field.maxLength), occupied: field.occupied};
    });
    // Generate labels in the trusted worker, never relay arbitrary source text.
    const countryNames = new Intl.DisplayNames(['en'], {type: 'region'});
    const countries = Array.isArray(widgets.countries) && widgets.countries.length <= 300 ? widgets.countries.filter(country =>
      /^[a-z]{2}$/.test(country?.code)).map(({code}) => ({code, name: countryNames.of(code.toUpperCase())})) : [];
    const state = widgets.countryState;
    const countryState = state && /^[a-z]{2}$/.test(state.nationality) && /^[a-z]{2}$/.test(state.campus)
      && typeof state.same === 'boolean' && typeof state.nationalityText === 'string' && state.nationalityText.length <= 120
      && typeof state.campusText === 'string' && state.campusText.length <= 120
      ? {nationality: state.nationality, campus: state.campus, same: state.same, nationalityText: state.nationalityText, campusText: state.campusText} : null;
    const countriesAvailable = !!countryState && countries.length > 0 && new Set(countries.map(country => country.code)).size === countries.length;
    await authorize(message, sender, context, deadline);
    for (const [key, review] of reviews) {
      if (review.expiresAt <= now() || review.context.tabId === context.tabId) reviews.delete(key);
    }
    while (reviews.size >= 32) reviews.delete(reviews.keys().next().value);
    const reviewId = crypto.randomUUID(), expiresAt = now() + 5 * 60000;
    reviews.set(reviewId, {context, fields, countries: countriesAvailable ? countries : [], countryState: countriesAvailable ? countryState : null, expiresAt});
    return {ok: true, version: 1, review_id: reviewId, expires_at: expiresAt, fields,
      countries: countriesAvailable ? countries : [], countries_available: countriesAvailable,
      ...(countriesAvailable ? {} : {country_reason: 'Country widgets are unavailable or changed. Select both countries on the original form.'})};
  }
  async function fill(message, sender, deadline) {
    const review = reviews.get(message.review_id);
    // Consume before any await or write: failures and uncertain results cannot retry.
    reviews.delete(message.review_id);
    if (!review || review.expiresAt <= now()) throw new Error('Review expired or was already used. Inspect the form again before filling.');
    if (!Array.isArray(message.approved) || !message.approved.length || message.approved.length > 6) throw new Error('Confirm at least one supported answer.');
    const seen = new Set();
    const ordinary = [], widgets = [];
    for (const item of message.approved) {
      if (!exactKeys(item, ['id', 'value', 'confirmed']) || item.confirmed !== true || typeof item.value !== 'string'
          || !item.value.trim() || seen.has(item.id)) throw new Error('Only individually confirmed answers are accepted.');
      seen.add(item.id);
      if (item.id === 'applicant_countries') {
        if (!review.countryState || item.value.length > 1000) throw new Error('Country replacement is not available.');
        let choice;
        try { choice = JSON.parse(item.value); } catch { throw new Error('Select valid nationality and study countries.'); }
        if (!exactKeys(choice, ['nationality', 'campus']) || !review.countries.some(country => country.code === choice.nationality)
            || !review.countries.some(country => country.code === choice.campus)) throw new Error('Select valid nationality and study countries.');
        widgets.push({...item, expectedState: review.countryState});
      } else {
        const field = review.fields.find(value => value.id === item.id);
        if (!field || field.unavailable || field.occupied || item.value.length > field.maxLength) throw new Error('An answer is unavailable, already filled or exceeds its limit. Inspect again.');
        (field.widget ? widgets : ordinary).push({...item});
      }
    }
    const result = {ok: true, filled: [], skipped: [], reasons: {}, submitted: false};
    let wrote = false;
    const apply = async (func, world, items) => {
      if (!items.length) return;
      await authorize(message, sender, review.context, deadline);
      if (review.expiresAt <= now()) throw new Error('Review expired. Inspect again.');
      // A dispatch is treated as potentially mutating even when its reply is lost.
      wrote = true;
      const raw = oneResult(await execute({target: {tabId: sender.tab.id, documentIds: [review.context.documentId]}, world,
        func, args: ['fill', review.context.frameUrl, items, deadline]}, 'Fill outcome is uncertain. Check the original form; this review cannot be retried.'), review.context.documentId);
      if (raw.submitted !== false || !Array.isArray(raw.filled) || !Array.isArray(raw.skipped)) throw new Error('Fill outcome is uncertain. Check the original form; this review cannot be retried.');
      for (const item of items) {
        if (raw.filled.includes(item.id) && !raw.skipped.includes(item.id)) result.filled.push(item.id);
        else {
          result.skipped.push(item.id);
          // Never relay arbitrary source-page strings or entered values to the platform.
          result.reasons[item.id] = item.id === 'applicant_countries'
            ? 'Country controls changed or could not be synchronized. Review them on the original form.'
            : 'The original field is occupied, unavailable, changed or did not retain the answer. Review it on the original form.';
        }
      }
    };
    try {
      await apply(interactWithPage, 'ISOLATED', ordinary);
      await apply(interactWithWidgets, 'MAIN', widgets);
      await authorize(message, sender, review.context, deadline);
      return result;
    } catch (error) {
      if (wrote) throw new Error('Filling stopped or its outcome is uncertain. Some confirmed answers may already be filled. Check the original form; do not retry automatically.');
      throw error;
    }
  }
  return async (message, sender, receivedDeadline = Date.now() + 18000) => {
    const deadline = Math.min(receivedDeadline, Date.now() + 18000);
    if (!Number.isFinite(deadline)) throw new Error('Invalid operation deadline.');
    let url;
    try { url = new URL(sender.url); } catch { throw new Error('Untrusted application caller.'); }
    if (sender.id || sender.frameId !== 0 || sender.origin !== url.origin || !Object.hasOwn(DEPLOYMENTS, url.origin)
        || !Number.isInteger(sender.tab?.id) || sender.tab.id < 0 || typeof sender.documentId !== 'string' || !sender.documentId
        || url.username || url.password) throw new Error('Untrusted application caller.');
    const inspectRequest = message?.kind === 'application-inspect';
    const keys = inspectRequest ? ['kind', 'version', 'job_id', 'page_url', 'profile_fingerprint']
      : ['kind', 'version', 'job_id', 'page_url', 'review_id', 'approved'];
    if (!exactKeys(message, keys) || (!inspectRequest && message.kind !== 'application-fill') || message.version !== 1
        || !UUID.test(message.job_id) || !validApplication(message.page_url)
        || (inspectRequest ? !HASH.test(message.profile_fingerprint) : !UUID.test(message.review_id))) throw new Error('Invalid application request.');
    return inspectRequest ? inspect(message, sender, deadline) : fill(message, sender, deadline);
  };
}
