// Discovery only: no profile, token, or page contents cross this boundary.
export function discoverApplication() {
  const supported = value => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && ['internsg.com', 'www.internsg.com'].includes(u.hostname)
        && !u.port && !u.username && !u.password && !u.search && !u.hash && /^\/job-apply\/[0-9]+\/?$/.test(u.pathname);
    } catch { return false; }
  };
  if (supported(location.href)) return {mode: 'direct', url: location.href};
  const parent = new URL(location.href);
  if (!['localhost', '127.0.0.1'].includes(parent.hostname) || !['http:', 'https:'].includes(parent.protocol)
      || !/^\/jobs\/[^/]+\/apply-external\/?$/.test(parent.pathname)) {
    throw new Error('Open an InternSG application or the local JobPilot embedded application page.');
  }
  const frames = [...document.querySelectorAll('iframe[data-jobpilot-internsg]')];
  if (frames.length !== 1 || !supported(frames[0].src)) throw new Error('Load exactly one supported InternSG application in JobPilot first.');
  return {mode: 'embedded', url: frames[0].src, parentUrl: location.href};
}

export function matchApplicationFrame(expectedUrl) {
  return location.href === expectedUrl ? {url: location.href} : null;
}

export async function resolveApplicationTarget(chromeApi) {
  const [tab] = await chromeApi.tabs.query({active: true, currentWindow: true});
  if (!tab?.id) throw new Error('No active tab.');
  const [top] = await chromeApi.scripting.executeScript({target: {tabId: tab.id}, func: discoverApplication});
  const context = top?.result;
  if (!context?.url || !top.documentId) throw new Error('Could not identify the application.');
  if (context.mode === 'direct') return {...context, tabId: tab.id, documentId: top.documentId};
  const origin = new URL(context.url).origin;
  if (!await chromeApi.permissions.contains({origins: [`${origin}/*`]})) {
    throw new Error('Click Enable embedded InternSG access in this popup, then read the page again.');
  }
  const frames = await chromeApi.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, func: matchApplicationFrame, args: [context.url]});
  const matches = frames.filter(entry => entry.result?.url === context.url && entry.documentId);
  if (matches.length !== 1) throw new Error('Application frame is loading, blocked or duplicated. Check the embedded page or open the original site.');
  return {...context, tabId: tab.id, documentId: matches[0].documentId};
}

export async function assertApplicationContext(chromeApi, context) {
  if (context.mode !== 'embedded') return;
  const [top] = await chromeApi.scripting.executeScript({target: {tabId: context.tabId}, func: discoverApplication});
  if (top?.result?.mode !== 'embedded' || top.result.parentUrl !== context.parentUrl || top.result.url !== context.url) {
    throw new Error('JobPilot application changed. Read the page again before filling.');
  }
}
