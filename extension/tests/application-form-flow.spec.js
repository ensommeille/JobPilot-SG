import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for isolated application form checks.');
const fields = [
  {field_id: 'name', label: 'Full name', type: 'text', required: true},
  {field_id: 'email', label: 'Contact email', type: 'email', required: true},
];
const draft = name => ({
  mapping: [
    {field_id: 'name', label: 'Full name', value: name, confidence: 0.95, needs_review: false},
    {field_id: 'email', label: 'Contact email', value: 'fictional@example.test', confidence: 0.95, needs_review: false},
  ], unmapped_fields: [], missing_profile_fields: [],
});
const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};

async function setup(page, {mapping, save, signedIn = true, formFields = fields} = {}) {
  await page.addInitScript(signedIn => {
    if (signedIn) localStorage.setItem('jobpilot_token', 'account-a');
  }, signedIn);
  await page.route('**/users/me', route => route.fulfill({json: {email: 'fictional@example.test'}}));
  await page.route('**/assistant/bootstrap', route => route.fulfill({json: {
    forms: [{id: 'form-a', job_id: 'job-a', is_fixture: true}, {id: 'form-b', job_id: 'job-b', is_fixture: true}],
  }}));
  await page.route('**/assistant/forms/*', route => route.fulfill({json: {fields_json: formFields}}));
  await page.route('**/assistant/map-fields', mapping ?? (route => route.fulfill({json: draft('Account A applicant')})));
  const saved = [];
  await page.route('**/assistant/applications', async route => {
    saved.push({body: route.request().postDataJSON(), authorization: route.request().headers().authorization});
    if (save) return save(route);
    return route.fulfill({status: 201, json: {}});
  });
  await page.goto(`${base}/jobs/job-a/apply`);
  return saved;
}

async function changeAccount(page) {
  await page.evaluate(() => {
    localStorage.setItem('jobpilot_token', 'account-b');
    window.dispatchEvent(new Event('jobpilot-auth-changed'));
  });
}

async function editAnswers(page, name = 'Manual fictional applicant') {
  await page.getByLabel('Full name', {exact: false}).fill(name);
  await page.getByLabel('Contact email', {exact: false}).fill('manual@example.test');
}

test('mapping failure still permits reviewed manual record without claiming employer delivery', async ({page}) => {
  const saved = await setup(page, {mapping: route => route.fulfill({status: 503, json: {}})});
  await expect(page.getByRole('status')).toContainText('Enter and review the fields manually');
  await editAnswers(page);
  await page.setViewportSize({width: 1440, height: 1000});
  await page.screenshot({path: '../output/application-record-desktop.png', fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: '../output/application-record-mobile.png', fullPage: true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Application record saved'})).toBeVisible();
  await expect(page.getByText('This does not send an application', {exact: false})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(saved).toHaveLength(1);
  expect(saved[0].body.confirmed_field_ids).toEqual(['name', 'email']);
  expect(saved[0].body.mapping_draft.mapping).toEqual([]);
  expect(saved[0].body.edited_values.name).toBe('Manual fictional applicant');
  expect(saved[0].body.provider).toBe('manual-fallback');
  expect(saved[0].authorization).toBe('Bearer account-a');
});

test('editing every suggested field still sends nonempty reviewed field IDs', async ({page}) => {
  const saved = await setup(page);
  await editAnswers(page);
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Application record saved'})).toBeVisible();
  expect(saved[0].body.confirmed_field_ids).toEqual(['name', 'email']);
  expect(saved[0].body.mapping_draft.mapping).toHaveLength(2);
});

test('invalid email blocks recording and preserves answers until corrected', async ({page}) => {
  const saved = await setup(page);
  await editAnswers(page);
  await page.getByLabel('Contact email', {exact: false}).fill('not-an-email');
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('requested format');
  await expect(page.getByLabel('Full name', {exact: false})).toHaveValue('Manual fictional applicant');
  await expect(page.getByLabel('Contact email', {exact: false})).toHaveValue('not-an-email');
  expect(saved).toEqual([]);
  await page.getByLabel('Contact email', {exact: false}).fill('corrected@example.test');
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Application record saved'})).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0].body.edited_values.email).toBe('corrected@example.test');
});

test('a late mapping response from another account cannot refill private answers', async ({page}) => {
  const pending = gate(), release = gate();
  await setup(page, {mapping: async route => {
    if (route.request().headers().authorization === 'Bearer account-a') {
      pending.resolve();
      await release.promise;
      return route.fulfill({json: draft('STALE ACCOUNT A SECRET')}).catch(() => {});
    }
    return route.fulfill({json: draft('Account B applicant')});
  }});
  await pending.promise;
  await changeAccount(page);
  await expect(page.getByLabel('Full name', {exact: false})).toHaveValue('Account B applicant');
  release.resolve();
  await expect(page.getByLabel('Full name', {exact: false})).toHaveValue('Account B applicant');
  await expect(page.getByText('STALE ACCOUNT A SECRET')).toHaveCount(0);
});

test('a late record response after account switch cannot show another account success', async ({page}) => {
  const pending = gate(), release = gate();
  await setup(page, {save: async route => {
    pending.resolve();
    await release.promise;
    return route.fulfill({status: 201, json: {}}).catch(() => {});
  }, mapping: route => route.fulfill({json: draft(route.request().headers().authorization === 'Bearer account-b' ? 'Account B applicant' : 'Account A applicant')})});
  await editAnswers(page);
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await pending.promise;
  await changeAccount(page);
  await expect(page.getByLabel('Full name', {exact: false})).toHaveValue('Account B applicant');
  release.resolve();
  await expect(page.getByRole('heading', {name: 'Application record saved'})).toHaveCount(0);
});

test('route change discards a previous job mapping and saves only the new form identity', async ({page}) => {
  const pending = gate(), release = gate();
  const saved = await setup(page, {mapping: async route => {
    if (route.request().postDataJSON().form_id === 'form-a') {
      pending.resolve();
      await release.promise;
      return route.fulfill({json: draft('STALE JOB A ANSWER')}).catch(() => {});
    }
    return route.fulfill({json: draft('Job B answer')});
  }});
  await pending.promise;
  await page.evaluate(() => {
    history.pushState({}, '', '/jobs/job-b/apply');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByLabel('Full name', {exact: false})).toHaveValue('Job B answer');
  release.resolve();
  await editAnswers(page, 'Reviewed job B answer');
  await page.getByRole('button', {name: 'Save application record', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Application record saved'})).toBeVisible();
  expect(saved[0].body.job_id).toBe('job-b');
  expect(saved[0].body.form_id).toBe('form-b');
  expect(saved[0].body.edited_values.name).toBe('Reviewed job B answer');
});

test('signed-out users cannot request private mapping or save a record', async ({page}) => {
  let calls = 0;
  const saved = await setup(page, {signedIn: false, mapping: route => {
    calls++;
    return route.fulfill({json: draft('Should never load')});
  }});
  await expect(page.getByText('Sign in on JobPilot, then reopen this application form.')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Save application record', exact: true})).toHaveCount(0);
  expect(calls).toBe(0);
  expect(saved).toEqual([]);
});

for (const type of ['select', 'file', 'checkbox']) {
  test(`unsupported ${type} fields fail closed before mapping or recording`, async ({page}) => {
    let mappings = 0;
    const saved = await setup(page, {
      formFields: [...fields, {field_id: 'unsupported', label: 'Unsupported control', type, required: true}],
      mapping: route => { mappings++; return route.fulfill({json: draft('Should not be mapped')}); },
    });
    await expect(page.getByRole('alert')).toContainText('fields this page cannot safely edit');
    await expect(page.getByRole('alert')).toContainText('No application record has been saved');
    await expect(page.getByRole('button', {name: 'Back to Job', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Save application record', exact: true})).toHaveCount(0);
    expect(mappings).toBe(0);
    expect(saved).toEqual([]);
  });
}
