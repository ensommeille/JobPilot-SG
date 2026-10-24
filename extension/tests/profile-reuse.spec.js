import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for profile UI checks.');

async function profilePage(page, {failLoad = false, failSave = false} = {}) {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'profile-fixture-token'));
  let profile = {full_name: 'Fictional Applicant', contact_email: 'fictional@example.test', phone: '123', education: '', experience: '', skills: [], links: {}, resume_summary: '', availability_period: '', nationality: null, study_country: null};
  await page.route('**/profile', async route => {
    if (route.request().resourceType() === 'document') return route.continue();
    if (failLoad) return route.fulfill({status: 503, json: {}});
    if (route.request().method() === 'PUT') {
      if (failSave) return route.fulfill({status: 503, json: {}});
      profile = {...profile, ...route.request().postDataJSON()};
    }
    return route.fulfill({json: profile});
  });
  await page.goto(`${base}/profile`);
}

test('maintain application details once, reload, and explicitly clear', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  await profilePage(page);
  await page.getByLabel('Personal introduction (written by you)').fill('My own introduction. 我学习计算机。');
  await page.getByLabel('Availability period', {exact: true}).fill('January to March 2027');
  await page.getByLabel('Nationality', {exact: true}).selectOption('cn');
  await page.getByLabel('Country of study / graduation').selectOption('sg');
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.reload();
  await expect(page.getByLabel('Personal introduction (written by you)')).toHaveValue('My own introduction. 我学习计算机。');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('cn');
  await page.screenshot({path: '../output/profile-reuse-desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: '../output/profile-reuse-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Personal introduction (written by you)').fill('');
  await page.getByLabel('Nationality', {exact: true}).selectOption('');
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Personal introduction (written by you)')).toHaveValue('');
  await expect(page.getByLabel('Nationality', {exact: true})).toHaveValue('');
});

test('failed load prevents overwriting an existing profile', async ({page}) => {
  await profilePage(page, {failLoad: true});
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeDisabled();
  await expect(page.getByLabel('Personal introduction (written by you)')).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Reload profile'})).toBeVisible();
});

test('failed save preserves entered introduction', async ({page}) => {
  await profilePage(page, {failSave: true});
  await page.getByLabel('Personal introduction (written by you)').fill('Keep my unsaved introduction');
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('alert').filter({hasText: 'Failed to save'})).toBeVisible();
  await expect(page.getByLabel('Personal introduction (written by you)')).toHaveValue('Keep my unsaved introduction');
});
