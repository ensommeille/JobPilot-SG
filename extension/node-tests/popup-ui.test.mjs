import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const html = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../popup.css', import.meta.url), 'utf8');

test('manual form reads are initially hidden recovery actions, leaving Fill as the normal action', () => {
  for (const id of ['ats-inspect', 'inspect']) {
    const button = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>[^<]*<\\/button>`))?.[0];
    assert.ok(button, `${id} remains available for runtime recovery`);
    assert.match(button, /\bhidden\b/);
    assert.match(button, /class="[^"]*secondary[^"]*recovery-action/);
    assert.match(button, />Refresh form<\/button>/);
  }
  assert.doesNotMatch(html, />\s*(?:Read (?:page|form)|Load (?:page|form))/i);
  assert.match(html, /answers load automatically/i);
  assert.match(html, /Missing narrative answers prepare in the background/);
  assert.match(html, /id="preparation-status"[^>]*aria-live="polite"/);
});

test('attachment stays separate and describes immediate upload without claiming submission', () => {
  assert.match(html, /id="ats-fill"[^>]*>Fill application form<\/button>/);
  assert.match(html, /id="ats-attach"[^>]*>Attach saved PDF<\/button>/);
  assert.match(html, /may upload the PDF to the employer immediately/);
  assert.match(html, /It does not submit your application/);
  assert.match(html, /Check AI drafts and unresolved answers/);
});

test('the popup keeps a definite Chrome width and one scrolling preview above its action footer', () => {
  assert.match(css, /--popup-width:\s*440px/);
  for (const selector of ['html', 'body']) {
    const rule = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(rule, `${selector} sizing rule exists`);
    assert.match(rule, /width:\s*var\(--popup-width\)/);
    assert.match(rule, /min-width:\s*var\(--popup-width\)/);
    assert.match(rule, /max-height:\s*580px/);
    assert.doesNotMatch(rule, /max-width:\s*100vw/);
  }
  assert.match(css, /#workspace-content\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(html, /<\/div>\s*<footer id="review-actions"/);
  assert.ok(html.indexOf('id="ats-inspect"') > html.indexOf('id="review-actions"'), 'Refresh recovery remains visible in the action footer');
});
