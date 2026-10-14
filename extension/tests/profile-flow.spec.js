import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for the isolated profile-to-application journey.');
const tokenA = 'fixture-profile-flow-account-a';
const tokenB = 'fixture-profile-flow-account-b';
const emptyProfile = {
  full_name: 'Fictional Flow Applicant', contact_email: 'flow@example.test', phone: '',
  education: '', experience: '', skills: [], links: {}, resume_summary: '',
  availability_period: '', nationality: null, study_country: null,
};
const sourceQuote = 'Comfortable using Microsoft Excel or Google Sheets for reports.';
const naturalSkill = 'I used Microsoft Excel to prepare weekly sales reports.';
const job = {
  id: 'profile-flow-fixture', title: 'Fictional Finance Intern — test only',
  company: 'Fictional Journey Company', city: 'Singapore', job_type: 'internship',
  deadline: null, salary_min: null, salary_max: null, salary_currency: null,
  salary_period: null, description: sourceQuote, requirements: [], status: 'active',
  source_url: 'https://www.internsg.com/job/fictional-flow-only/',
  apply_url: 'https://www.internsg.com/job-apply/271036/',
  source: {name: 'InternSG fixture only'}, tags: [],
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function signIn(page) {
  await page.addInitScript(token => {
    if (!localStorage.getItem('jobpilot_token')) localStorage.setItem('jobpilot_token', token);
  }, tokenA);
}

async function switchAccount(page) {
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'jobpilot_token', oldValue, newValue,
    }));
  }, {oldValue: tokenA, newValue: tokenB});
}

async function setupProfile(page, initial = {}, onSave) {
  await signIn(page);
  let profile = {...emptyProfile, ...initial};
  await page.route('**/profile', async route => {
    if (route.request().resourceType() === 'document') return route.continue();
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON();
      if (onSave) return onSave(route, payload);
      profile = {...profile, ...payload};
    }
    return route.fulfill({json: profile});
  });
  await page.goto(`${base}/profile`);
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeEnabled();
  return () => profile;
}

test('saved natural skills lead to evidence and the correct explicit InternSG entry', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  const currentProfile = await setupProfile(page);
  let recommendationCalls = 0, externalPosts = 0;
  await page.route(/\/jobs(\?.*)?$/, route => route.request().resourceType() === 'document'
    ? route.continue() : route.fulfill({json: {items: [], total: 0}}));
  await page.route('**/jobs/recommendations', route => {
    recommendationCalls++;
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    expect(currentProfile().skills).toEqual([naturalSkill]);
    const item = {
      category: 'required_skills', requirement: sourceQuote, importance: 'required',
      outcome: 'unknown', reason: 'Shared skill only; the complete conditions remain unverified.',
      job_evidence: sourceQuote, profile_evidence: naturalSkill,
      skill_overlaps: [{skill_id: 'excel', label: 'Microsoft Excel', kind: 'specific', profile_evidence: naturalSkill}],
    };
    return route.fulfill({json: {
      version: 'evidence-discovery-v2', status: 'ready', scanned: 1, evaluated: 1,
      matched: 1, truncated: false, excluded: {}, items: [{
        job_id: job.id, title: job.title, company: job.company, city: job.city,
        job_type: job.job_type, supported: [], gaps: [], overlaps: [item], unknown: [item],
      }],
    }});
  });
  await page.route(`**/jobs/${job.id}`, route => route.request().resourceType() === 'document'
    ? route.continue() : route.fulfill({json: job}));
  await page.route('**/assistant/bootstrap', route => route.fulfill({json: {forms: [], manual_fallback: true}}));
  await page.route('https://www.internsg.com/**', route => {
    if (route.request().method() !== 'GET') externalPosts++;
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Isolated form fixture</title><p>Fixture only — no employer delivery</p><label>Name<input id="applicant_name"></label>'});
  });

  await page.getByLabel('Full Name', {exact: true}).fill('Fictional Maintained Applicant');
  await page.getByLabel('Contact Email', {exact: true}).fill('maintained@example.test');
  await page.getByLabel('Phone', {exact: true}).fill('+65 8000 0000');
  await page.getByLabel('Personal introduction (written by you)').fill('My own reusable introduction.');
  await page.getByLabel('Availability period', {exact: true}).fill('January to March 2027');
  await page.getByLabel('Nationality', {exact: true}).selectOption('cn');
  await page.getByLabel('Country of study / graduation').selectOption('sg');
  await page.getByPlaceholder('Add custom skill (Enter)').fill(naturalSkill);
  await page.getByRole('button', {name: 'Add', exact: true}).click();
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  expect(currentProfile()).toMatchObject({
    full_name: 'Fictional Maintained Applicant', contact_email: 'maintained@example.test',
    phone: '+65 8000 0000', resume_summary: 'My own reusable introduction.',
    availability_period: 'January to March 2027', nationality: 'cn', study_country: 'sg',
    skills: [naturalSkill],
  });

  await page.getByRole('button', {name: /Jobs$/}).click();
  await expect(page).toHaveURL(`${base}/jobs`);
  expect(recommendationCalls).toBe(0);
  await page.getByRole('button', {name: 'Find jobs for me'}).click();
  await expect(page.locator('.recommendation-list')).toContainText('Microsoft Excel named in both the JD and your saved skills.');
  await page.getByText('Review reasons and evidence', {exact: true}).click();
  await expect(page.locator('.recommendation-evidence')).toContainText(naturalSkill);
  await expect(page.locator('.recommendation-evidence')).toContainText('conditions unverified');
  await page.getByRole('link', {name: 'View job and full analysis'}).click();
  await expect(page.getByRole('heading', {name: job.title})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.screenshot({path: `../output/profile-flow-job-${name}.png`, fullPage: true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('link', {name: 'Apply on InternSG within JobPilot'}).click();
  await expect(page).toHaveURL(`${base}/jobs/${job.id}/apply-external`);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('link', {name: 'Open original application'})).toHaveAttribute('href', job.apply_url);
  await page.getByRole('button', {name: 'Load InternSG application here'}).click();
  await expect(page.frameLocator('iframe').locator('#applicant_name')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('does not mean an application was sent');
  expect(externalPosts).toBe(0);
  expect(recommendationCalls).toBe(1);
});

test('an old account delayed profile load cannot populate the new account screen', async ({page}) => {
  await signIn(page);
  const started = deferred(), release = deferred();
  await page.route('**/profile', async route => {
    if (route.request().resourceType() === 'document') return route.continue();
    if (route.request().headers().authorization === `Bearer ${tokenB}`) {
      return route.fulfill({json: {...emptyProfile, full_name: 'Current account B', resume_summary: ''}});
    }
    started.resolve();
    await release.promise;
    await route.fulfill({json: {...emptyProfile, full_name: 'Private account A name', resume_summary: 'Private account A summary'}});
  });
  await page.goto(`${base}/profile`);
  await started.promise;
  await switchAccount(page);
  release.resolve();
  await expect(page.getByRole('alert').filter({hasText: 'Account changed'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeDisabled();
  await expect(page.getByLabel('Full Name', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Personal introduction (written by you)')).toHaveValue('');
  await expect(page.locator('body')).not.toContainText('Private account A name');
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe(tokenB);
});

test('an in-flight save cannot report success or retain private drafts after account change', async ({page}) => {
  const started = deferred(), release = deferred();
  await setupProfile(page, {}, async (route, payload) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    started.resolve();
    await release.promise;
    await route.fulfill({json: payload});
  });
  await page.getByLabel('Personal introduction (written by you)').fill('Only account A may see this draft.');
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await started.promise;
  await expect(page.getByLabel('Full Name', {exact: true})).toBeDisabled();
  await switchAccount(page);
  release.resolve();
  await expect(page.getByRole('alert').filter({hasText: 'Account changed'}).first()).toBeVisible();
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeDisabled();
  await expect(page.getByLabel('Personal introduction (written by you)')).toHaveValue('');
  await expect(page.getByRole('status').filter({hasText: 'Profile saved'})).toHaveCount(0);
});

test('preset skill selection invalidates the saved notice until saved again', async ({page}) => {
  const profile = await setupProfile(page);
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.getByLabel('Search skills', {exact: true}).fill('Python');
  await page.getByText('+ Python', {exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Profile saved'})).toHaveCount(0);
  expect(profile().skills).toEqual([]);
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  expect(profile().skills).toEqual(['Python']);
});

test('link removal invalidates the saved notice and persists only on save', async ({page}) => {
  const profile = await setupProfile(page, {links: {Portfolio: 'https://example.test/portfolio'}});
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  await page.getByPlaceholder('https://...').locator('..').getByRole('button').click();
  await expect(page.getByRole('status').filter({hasText: 'Profile saved'})).toHaveCount(0);
  expect(profile().links).toEqual({Portfolio: 'https://example.test/portfolio'});
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('status')).toContainText('Profile saved');
  expect(profile().links).toEqual({});
});

test('backend validation errors retain edits and identify the field without echoing private input', async ({page}) => {
  await setupProfile(page, {}, route => route.fulfill({status: 422, json: {detail: [{
    type: 'value_error', loc: ['body', 'skills'], msg: 'Value error, each skill must contain at most 100 characters',
    input: 'SERVER_PRIVATE_INPUT_MUST_NOT_BE_ECHOED',
  }]}}));
  await page.getByLabel('Personal introduction (written by you)').fill('Keep my unsaved introduction.');
  await page.getByRole('button', {name: 'Save Profile'}).click();
  await expect(page.getByRole('alert')).toContainText(/skills/i);
  await expect(page.getByRole('alert')).not.toContainText('SERVER_PRIVATE_INPUT_MUST_NOT_BE_ECHOED');
  await expect(page.getByLabel('Personal introduction (written by you)')).toHaveValue('Keep my unsaved introduction.');
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeEnabled();
  await expect(page.getByRole('status').filter({hasText: 'Profile saved'})).toHaveCount(0);
});

test('a late 401 for account A cannot clear the newer account B token or navigate away', async ({page}) => {
  await setupProfile(page);
  const started = deferred(), release = deferred(), answered = deferred();
  await page.route('**/private-flow-fixture', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    started.resolve();
    await release.promise;
    await route.fulfill({status: 401, json: {detail: 'Fixture expired account A'}});
    answered.resolve();
  });
  await page.evaluate(async () => {
    const {default: api} = await import('/src/services/api.ts');
    window.profileFlowRequestDone = false;
    api.get('/private-flow-fixture').catch(() => {}).finally(() => { window.profileFlowRequestDone = true; });
  });
  await started.promise;
  await switchAccount(page);
  release.resolve();
  await answered.promise;
  await expect.poll(() => page.evaluate(() => window.profileFlowRequestDone)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe(tokenB);
  await expect(page).toHaveURL(`${base}/profile`);
});

async function applicationOptions(page, changes, forms = [], onBootstrap) {
  await signIn(page);
  await page.route('**/profile', route => route.fulfill({json: emptyProfile}));
  await page.route(`**/jobs/${job.id}`, route => route.request().resourceType() === 'document'
    ? route.continue() : route.fulfill({json: {...job, ...changes}}));
  await page.route('**/assistant/bootstrap', route => onBootstrap
    ? onBootstrap(route) : route.fulfill({json: {forms, manual_fallback: true}}));
  await page.goto(`${base}/jobs/${job.id}`);
  await expect(page.getByRole('heading', {name: job.title})).toBeVisible();
  return page.getByRole('region', {name: 'Application options'});
}

test('a job without a configured platform form never offers a fake AI application', async ({page}) => {
  const options = await applicationOptions(page, {apply_url: 'https://employer.example.test/apply'});
  await expect(options).toContainText('No in-platform application form is configured');
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /Open original application/})).toHaveAttribute('href', 'https://employer.example.test/apply');
});

test('a configured sandbox form offers the platform flow without claiming employer delivery', async ({page}) => {
  const options = await applicationOptions(page, {apply_url: null}, [{id: 'fixture-form', job_id: job.id, is_fixture: true}]);
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveAttribute('href', `/jobs/${job.id}/apply`);
  await expect(options).toContainText('does not send it to an external employer');
  await expect(options.getByRole('link', {name: 'Apply on InternSG within JobPilot'})).toHaveCount(0);
});

test('authoritative form availability true offers the platform record without a bootstrap lookup', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {
    apply_url: 'https://employer.example.test/apply', assistant_form_available: true,
  }, [], route => { lookups++; return route.fulfill({json: {forms: []}}); });
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveAttribute('href', `/jobs/${job.id}/apply`);
  await expect(options).toContainText('does not send it to an external employer');
  await expect(options.getByRole('link', {name: /Open original application/})).toHaveAttribute('href', 'https://employer.example.test/apply');
  expect(lookups).toBe(0);
});

test('authoritative form availability false cannot be overridden by a bootstrap form', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {
    apply_url: 'https://employer.example.test/apply', assistant_form_available: false,
  }, [], route => {
    lookups++;
    return route.fulfill({json: {forms: [{id: 'stale-fixture-form', job_id: job.id}]}});
  });
  await expect(options).toContainText('No in-platform application form is configured');
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /Open original application/})).toHaveAttribute('href', 'https://employer.example.test/apply');
  expect(lookups).toBe(0);
});

test('missing form availability retains the compatibility bootstrap lookup', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {apply_url: null}, [], route => {
    lookups++;
    return route.fulfill({json: {forms: [{id: 'legacy-fixture-form', job_id: job.id}]}});
  });
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveAttribute('href', `/jobs/${job.id}/apply`);
  expect(lookups).toBeGreaterThan(0);
});

test('InternSG remains available through its original embedded flow when no platform form exists', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {assistant_form_available: false}, [], route => {
    lookups++;
    return route.fulfill({json: {forms: []}});
  });
  await expect(options.getByRole('link', {name: 'Apply on InternSG within JobPilot'})).toHaveAttribute('href', `/jobs/${job.id}/apply-external`);
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View Original Posting/})).toHaveAttribute('href', job.source_url);
  await expect(options).toContainText('Filling does not submit an application');
  expect(lookups).toBe(0);
});

test('inactive jobs suppress all application entries even when a platform form is available', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {
    status: 'closed', apply_url: 'https://employer.example.test/apply', assistant_form_available: true,
  }, [], route => { lookups++; return route.fulfill({json: {forms: []}}); });
  await expect(options).toContainText('This job is not active');
  await expect(options.getByRole('link', {name: /Apply on InternSG|Apply with AI|Open original application/})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View Original Posting/})).toHaveAttribute('href', job.source_url);
  expect(lookups).toBe(0);
});

test('changing jobs clears a previous configured form while the new compatibility lookup is pending', async ({page}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  let phase = 'first';
  await applicationOptions(page, {apply_url: null}, [], async route => {
    if (phase === 'first') return route.fulfill({json: {forms: [{id: 'first-fixture-form', job_id: job.id}]}});
    started.resolve();
    await release.promise;
    await route.fulfill({json: {forms: []}});
    answered.resolve();
  });
  await expect(page.getByRole('link', {name: 'Apply with AI Assistant'})).toBeVisible();
  phase = 'second';
  const nextJob = {...job, id: 'next-options-fixture', title: 'Next fictional job', apply_url: null};
  await page.route(`**/jobs/${nextJob.id}`, route => route.request().resourceType() === 'document'
    ? route.continue() : route.fulfill({json: nextJob}));
  await page.evaluate(id => {
    history.pushState({}, '', `/jobs/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, nextJob.id);
  await started.promise;
  await expect(page.getByRole('heading', {name: nextJob.title})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Application options'})).toContainText('Checking available application options');
  release.resolve();
  await answered.promise;
  await expect(page.getByRole('region', {name: 'Application options'})).toContainText('No in-platform application form is configured');
});

test('closed jobs do not offer an application entry', async ({page}) => {
  const options = await applicationOptions(page, {status: 'closed'}, [{id: 'fixture-form', job_id: job.id}]);
  await expect(options).toContainText('This job is not active');
  await expect(options.getByRole('link', {name: /Apply on InternSG|Apply with AI|Open original application/})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View Original Posting/})).toHaveAttribute('href', job.source_url);
});

test('unsafe original URLs are not rendered as clickable application actions', async ({page}) => {
  const options = await applicationOptions(page, {
    source_url: 'javascript:alert("fixture")',
    apply_url: 'https://account:password@employer.example.test/apply',
  });
  await expect(options).toContainText('No in-platform application form is configured');
  await expect(options.getByRole('link')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('delayed login replacement cannot overwrite an account selected during logout', async ({page}) => {
  await setupProfile(page);
  const started = deferred(), release = deferred();
  let logoutCalls = 0;
  await page.route('**/auth/logout', async route => {
    logoutCalls++;
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    started.resolve();
    await release.promise;
    await route.fulfill({status: 204, body: ''});
  });
  await page.evaluate(async replacement => {
    const {saveToken} = await import('/src/services/auth.ts');
    window.profileFlowReplacement = {status: 'pending'};
    saveToken(replacement)
      .then(() => { window.profileFlowReplacement = {status: 'resolved'}; })
      .catch(error => { window.profileFlowReplacement = {status: 'rejected', message: error.message}; });
  }, tokenB);
  await started.promise;
  const tokenC = 'fixture-profile-flow-account-c';
  await page.evaluate(({oldValue, newValue}) => {
    localStorage.setItem('jobpilot_token', newValue);
    window.dispatchEvent(new StorageEvent('storage', {key: 'jobpilot_token', oldValue, newValue}));
  }, {oldValue: tokenA, newValue: tokenC});
  release.resolve();
  await expect.poll(() => page.evaluate(() => window.profileFlowReplacement.status)).toBe('rejected');
  expect(await page.evaluate(() => window.profileFlowReplacement.message)).toContain('Account changed');
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe(tokenC);
  expect(logoutCalls).toBe(1);
  await expect(page).toHaveURL(`${base}/profile`);
});

test('changing accounts closes an embedded form and requires a fresh explicit load', async ({page}) => {
  await applicationOptions(page, {});
  let loads = 0, externalPosts = 0;
  await page.route('https://www.internsg.com/**', route => {
    if (route.request().method() === 'GET') loads++;
    else externalPosts++;
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Account isolation fixture</title><form><label>Name<input id="applicant_name"></label><p>Fixture only. No submission.</p></form>'});
  });
  await page.getByRole('link', {name: 'Apply on InternSG within JobPilot'}).click();
  await page.getByRole('button', {name: 'Load InternSG application here'}).click();
  const applicant = page.frameLocator('iframe').locator('#applicant_name');
  await expect(applicant).toBeVisible();
  await applicant.fill('Private account A unsent draft');
  expect(loads).toBe(1);
  await switchAccount(page);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('The embedded form has been closed');
  await expect(page.getByRole('button', {name: 'Load InternSG application here'})).toBeVisible();
  expect(loads).toBe(1);
  expect(externalPosts).toBe(0);
  await page.getByRole('button', {name: 'Load InternSG application here'}).click();
  await expect(page.frameLocator('iframe').locator('#applicant_name')).toHaveValue('');
  expect(loads).toBe(2);
  expect(externalPosts).toBe(0);
});
