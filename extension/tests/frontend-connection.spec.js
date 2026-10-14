import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for platform connection checks.');
const id = 'a'.repeat(32), state = 's'.repeat(43);

async function setup(page, {loggedIn = true, wrongApi = false} = {}) {
  await page.addInitScript(({loggedIn, wrongApi, id}) => {
    if (loggedIn) localStorage.setItem('jobpilot_token', 'platform-private-token');
    window.messages = [];
    window.chrome = {runtime: {sendMessage: (client, message, callback) => {
      window.messages.push({client, message});
      callback(message.kind === 'connection-details'
        ? {ok: true, client_id: id, challenge: 'c'.repeat(43), api: wrongApi ? 'https://evil.test' : 'http://127.0.0.1:8001'}
        : {ok: true});
    }}};
  }, {loggedIn, wrongApi, id});
  await page.route('**/users/me', route => route.fulfill({json: {email: 'fictional@example.test'}}));
  await page.route('**/auth/extension/authorize', route => route.fulfill({json: {code: 'x'.repeat(43), expires_in: 90}}));
  await page.goto(base + '/connect-extension#extension_id=' + id + '&state=' + state);
}

test('platform explicitly connects without exposing its token or asking for another password', async ({page}) => {
  await setup(page);
  const confirm = page.getByRole('button', {name: 'Confirm and connect extension'});
  await expect(confirm).toBeEnabled();
  expect((await page.evaluate(() => window.messages)).every(x => x.message.kind === 'connection-details')).toBe(true);
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.setViewportSize({width: 1280, height: 800});
  await page.screenshot({path: '../output/extension-connect-desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: '../output/extension-connect-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await confirm.click();
  await expect(page.getByRole('status')).toContainText('Connected');
  const messages = await page.evaluate(() => window.messages);
  expect(JSON.stringify(messages)).not.toContain('platform-private-token');
  expect(messages.at(-1).message).toEqual({kind: 'complete', state, code: 'x'.repeat(43)});
  expect(await page.evaluate(() => location.hash)).toBe('');
});

test('logged-out connection retains a safe return path to platform login', async ({page}) => {
  await setup(page, {loggedIn: false});
  await expect(page.getByRole('link', {name: 'Sign in on JobPilot'})).toHaveAttribute('href', '/?next=' + encodeURIComponent('/connect-extension#extension_id=' + id + '&state=' + state));
  expect(await page.evaluate(() => window.messages)).toEqual([]);
});

test('mismatched API configuration fails closed', async ({page}) => {
  await setup(page, {wrongApi: true});
  await expect(page.getByRole('alert')).toContainText('does not match');
  await expect(page.getByRole('button', {name: 'Confirm and connect extension'})).toBeDisabled();
});

test('failed server logout keeps login; successful retry revokes and clears it', async ({page}) => {
  await setup(page);
  await page.route('**/profile', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: {full_name: 'Fictional user', skills: [], links: {}}}));
  let failed = true;
  await page.route('**/auth/logout', route => route.fulfill({status: failed ? 503 : 204, body: ''}));
  await page.goto(base + '/profile');
  await page.getByRole('button', {name: 'Logout', exact: true}).click();
  await expect(page.getByRole('alert').filter({hasText: 'Could not revoke'})).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe('platform-private-token');
  failed = false;
  await page.getByRole('button', {name: 'Logout', exact: true}).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBeNull();
});
