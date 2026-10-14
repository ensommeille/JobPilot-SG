import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL to a local running Vite instance for frontend integration checks.');
async function setup(page, applyUrl = 'https://www.internsg.com/job-apply/123/', status = 'active') {
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Fictional tester'}}));
  await page.route('**/jobs/test-job', route => route.fulfill({json: {id:'test-job',title:'Fictional Intern',company:'Fixture Company',apply_url:applyUrl,status}}));
  await page.route('https://www.internsg.com/**', route => route.fulfill({contentType:'text/html',body:'<form method="post"><label>Name<input id="applicant_name" name="applicant_name"></label><p>Fixture only — no delivery</p></form>'}));
  await page.goto(`${base}/jobs/test-job/apply-external`);
}
test('explicit load embeds the allowlisted original and offers an independent fallback', async ({page}) => {
  await page.setViewportSize({width:1280,height:900});
  await setup(page);
  await expect(page.getByRole('heading', {name:'Fictional Intern'})).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('link', {name:'Open original application'})).toHaveAttribute('href','https://www.internsg.com/job-apply/123/');
  await page.getByRole('button', {name:'Load InternSG application here'}).click();
  await expect(page.frameLocator('iframe').locator('#applicant_name')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('does not mean an application was sent');
  await expect(page.locator('iframe')).toHaveAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups');
  await page.screenshot({path:'../output/jobpilot-embedded-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'../output/jobpilot-embedded-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('unsupported application URLs never create an iframe', async ({page}) => {
  await setup(page,'https://www.internsg.com.evil.test/job-apply/123/');
  await expect(page.getByRole('alert')).toContainText('does not provide a supported');
  await expect(page.locator('iframe')).toHaveCount(0);
});
test('inactive jobs cannot open the embedded application', async ({page}) => {
  await setup(page,undefined,'closed');
  await expect(page.getByRole('alert')).toContainText('not active');
  await expect(page.locator('iframe')).toHaveCount(0);
});
