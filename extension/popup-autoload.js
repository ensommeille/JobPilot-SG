// Read-only startup targeting. No permission requests, profile/file/model requests,
// timers, polling, answer writes or submission authority live in this module.
import {activeApplicationTool} from './popup-review.js';
import {DEPLOYMENTS} from './connection.js';
import {discoverApplication, matchApplicationFrame} from './frames.js';

export class StalePopupPreview extends Error {
  constructor() { super('The active application changed. Refresh the form before filling.'); this.stalePreview = true; }
}

export function popupConnectionKey(current) {
  return current?.token?.startsWith('jpx_') && DEPLOYMENTS[current.site] === current.api
    ? JSON.stringify([current.site, current.api, current.userId, current.token]) : '';
}

export function capturePopupTarget(tab, current) {
  if (!Number.isSafeInteger(tab?.id) || tab.id < 1 || typeof tab.url !== 'string') return null;
  const tool = activeApplicationTool(tab.url);
  if (tool) return Object.freeze({tabId: tab.id, url: tab.url, tool, mode: tool === 'ats-tools' ? 'ats' : 'direct'});
  if (!popupConnectionKey(current)) return null;
  let url;
  try { url = new URL(tab.url); } catch { return null; }
  if (url.origin !== current.site || url.username || url.password || url.search || url.hash
      || !/^\/jobs\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/apply-external\/?$/i.test(url.pathname)) return null;
  return Object.freeze({tabId: tab.id, url: tab.url, tool: 'original-tools', mode: 'embedded'});
}

export async function assertCapturedPopupTarget(chromeApi, target, unchanged) {
  unchanged();
  const [active] = await chromeApi.tabs.query({active: true, currentWindow: true});
  unchanged();
  if (!active || active.id !== target.tabId || active.url !== target.url) throw new StalePopupPreview();
}

export function popupDocumentBinding(expectedUrl) {
  return location.href === expectedUrl ? {url: location.href} : null;
}

export async function assertPopupDocumentBinding(chromeApi, target, context, unchanged) {
  await assertCapturedPopupTarget(chromeApi, target, unchanged);
  const bindings = context.mode === 'embedded'
    ? [[context.parentDocumentId, context.parentUrl], [context.documentId, context.url]] : [[context.documentId, context.url]];
  for (const [documentId, url] of bindings) {
    if (!documentId) throw new StalePopupPreview();
    const responses = await chromeApi.scripting.executeScript({target: {tabId: target.tabId, documentIds: [documentId]},
      func: popupDocumentBinding, args: [url]});
    unchanged();
    if (responses.length !== 1 || responses[0]?.documentId !== documentId || responses[0]?.result?.url !== url) throw new StalePopupPreview();
  }
  await assertCapturedPopupTarget(chromeApi, target, unchanged);
}

export async function resolveCapturedInternSG(chromeApi, target, current, unchanged) {
  if (!['direct', 'embedded'].includes(target.mode)) throw new StalePopupPreview();
  await assertCapturedPopupTarget(chromeApi, target, unchanged);
  if (target.mode === 'embedded') {
    const granted = await chromeApi.permissions.contains({origins: [current.site + '/*', 'https://www.internsg.com/*', 'https://internsg.com/*']});
    unchanged();
    if (!granted) throw new Error('InternSG access is needed. Enable it in connection settings, then refresh the form.');
  }
  const responses = await chromeApi.scripting.executeScript({target: {tabId: target.tabId}, func: discoverApplication});
  unchanged();
  const top = responses[0], context = top?.result;
  if (responses.length !== 1 || !top?.documentId || !context || activeApplicationTool(context.url) !== 'original-tools') throw new Error('The InternSG application is not ready. Load the original form, then refresh.');
  if (target.mode === 'direct') {
    if (context.mode !== 'direct' || context.url !== target.url) throw new StalePopupPreview();
    return {...context, tabId: target.tabId, documentId: top.documentId};
  }
  if (context.mode !== 'embedded' || context.parentUrl !== target.url) throw new StalePopupPreview();
  await assertCapturedPopupTarget(chromeApi, target, unchanged);
  const frames = await chromeApi.scripting.executeScript({target: {tabId: target.tabId, allFrames: true}, func: matchApplicationFrame, args: [context.url]});
  unchanged();
  const matches = frames.filter(frame => frame.result?.url === context.url && frame.documentId);
  if (matches.length !== 1) throw new Error('The InternSG form is loading, blocked or duplicated. Open the original form or refresh once it is ready.');
  return {...context, tabId: target.tabId, parentDocumentId: top.documentId, documentId: matches[0].documentId};
}
