import {test, expect} from '@playwright/test';
import {discoverApplication, matchApplicationFrame, resolveApplicationTarget, assertApplicationContext} from '../frames.js';
import {interactWithPage} from '../page.js';
const application = 'https://www.internsg.com/job-apply/123/';
const parent = 'http://localhost:5173/jobs/test-job/apply-external';
test('discovers the marked frame and fills inside it, not the parent page', async ({page}) => {
  await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: route.request().url() === parent
    ? `<input id="applicant_name" value="Parent must stay untouched"><iframe data-jobpilot-internsg src="${application}"></iframe>`
    : '<form method="post"><input id="applicant_name" name="applicant_name"></form>'}));
  await page.goto(parent);
  const context = await page.evaluate(discoverApplication);
  expect(context).toEqual({mode: 'embedded', url: application, parentUrl: parent});
  const frame = page.frames().find(f => f.url() === application);
  expect(await frame.evaluate(matchApplicationFrame, application)).toEqual({url: application});
  const result = await frame.evaluate(source => (0, eval)(`(${source})`)('fill', location.href, [{id:'applicant_name', value:'Fictional test', confirmed:true}]), interactWithPage.toString());
  expect(result.filled).toEqual(['applicant_name']);
  await expect(page.locator('#applicant_name')).toHaveValue('Parent must stay untouched');
  await expect(frame.locator('#applicant_name')).toHaveValue('Fictional test');
});
test('discovery rejects untrusted parents, deceptive URLs and duplicate marked frames', async ({page}) => {
  await page.route('**/*', route => route.fulfill({contentType:'text/html', body: `<iframe data-jobpilot-internsg src="${application}"></iframe>`}));
  await page.goto('https://evil.test/jobs/x/apply-external');
  await expect(page.evaluate(discoverApplication)).rejects.toThrow('local JobPilot');
  await page.goto(parent);
  await page.locator('iframe').evaluate(el => { el.src = 'https://www.internsg.com.evil.test/job-apply/123/'; });
  await expect(page.evaluate(discoverApplication)).rejects.toThrow('exactly one');
  await page.locator('iframe').evaluate((el, url) => { el.src = url; document.body.append(el.cloneNode()); }, application);
  await expect(page.evaluate(discoverApplication)).rejects.toThrow('exactly one');
});
function mockChrome({permission = true, duplicate = false, changed = false} = {}) {
  return {tabs:{query:async()=>[{id:7}]}, permissions:{contains:async()=>permission}, scripting:{executeScript:async request => {
    if (request.func === discoverApplication) return [{documentId:'parent-doc', result:{mode:'embedded', url:changed ? application+'1' : application, parentUrl:parent}}];
    return [{documentId:'parent-doc',result:null},{documentId:'child-doc',result:{url:application}}, ...(duplicate ? [{documentId:'other-doc',result:{url:application}}] : [])];
  }}};
}
test('resolver requires host permission and exactly one child document', async () => {
  await expect(resolveApplicationTarget(mockChrome({permission:false}))).rejects.toThrow('Enable embedded');
  await expect(resolveApplicationTarget(mockChrome({duplicate:true}))).rejects.toThrow('duplicated');
  const context=await resolveApplicationTarget(mockChrome());
  expect(context.documentId).toBe('child-doc');
  await expect(assertApplicationContext(mockChrome({changed:true}),context)).rejects.toThrow('changed');
});
