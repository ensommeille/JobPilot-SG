import {createConnectionHandler} from './connection.js';
import {createApplicationHandler} from './application-bridge.js';
const handle = createConnectionHandler(chrome);
const application = createApplicationHandler(chrome);
const ready = chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
function listener(external) {
  return (message, sender, respond) => {
    const applicationDeadline = Date.now() + 18000;
    const task = () => external && ['application-inspect', 'application-fill'].includes(message?.kind)
      ? application(message, sender, applicationDeadline) : handle(message, sender, external);
    ready.then(() => navigator.locks.request('jobpilot-connection', task))
      .then(respond, error => respond({ok: false, error: error.message || 'Connection failed'}));
    return true;
  };
}
chrome.runtime.onMessage.addListener(listener(false));
chrome.runtime.onMessageExternal.addListener(listener(true));
