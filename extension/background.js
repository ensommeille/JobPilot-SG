import {createConnectionHandler} from './connection.js';
const handle = createConnectionHandler(chrome);
const ready = chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
function listener(external) {
  return (message, sender, respond) => {
    ready.then(() => navigator.locks.request('jobpilot-connection', () => handle(message, sender, external)))
      .then(respond, error => respond({ok: false, error: error.message || 'Connection failed'}));
    return true;
  };
}
chrome.runtime.onMessage.addListener(listener(false));
chrome.runtime.onMessageExternal.addListener(listener(true));
