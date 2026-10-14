import {createApplicationHandler} from './application-bridge.js';

// This extension exists only inside a fresh automated-test browser profile.
const ready = chrome.storage.session.set({jobpilotSession: {
  site: 'http://127.0.0.1:5173', api: 'http://127.0.0.1:8001',
  userId: 'fictional-sender-account', token: 'jpx_fictional_sender_fixture',
  expiresAt: Date.now() / 1000 + 3600,
}});
const handler = createApplicationHandler(chrome, async (url, options) => {
  if (url !== 'http://127.0.0.1:8001/auth/extension/session'
      || options.method !== 'GET'
      || options.headers.Authorization !== 'Bearer jpx_fictional_sender_fixture') {
    throw new Error('Unexpected fixture session request. No network request was sent.');
  }
  return new Response(JSON.stringify({user_id: 'fictional-sender-account', expires_at: Date.now() / 1000 + 3600}), {status: 200});
});

chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  void (async () => {
    await ready;
    const injected = await chrome.scripting.executeScript({
      target: {tabId: sender.tab.id, documentIds: [sender.documentId]}, world: 'ISOLATED',
      func: () => location.href,
    });
    const observed = {
      senderUrl: sender.url, origin: sender.origin, documentId: sender.documentId,
      frameId: sender.frameId, tabUrl: sender.tab.url, currentUrl: injected[0].result,
    };
    if (message.kind === 'fixture-observe') return respond({observed});
    try { respond({observed, result: await handler(message, sender)}); }
    catch (error) { respond({observed, result: {ok: false, error: error.message}}); }
  })().catch(error => respond({fixtureError: error.message}));
  return true;
});
