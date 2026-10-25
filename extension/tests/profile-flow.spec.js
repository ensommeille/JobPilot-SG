import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for the isolated profile-to-application journey.');
const tokenA = 'fixture-profile-flow-account-a';
const tokenB = 'fixture-profile-flow-account-b';
const emptyProfile = {
  full_name: 'Fictional Flow Applicant', contact_email: 'flow@example.test', phone: '',
  given_name: null, family_name: null,
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
  await page.route('**/users/me', route => route.fulfill({json: {id: 'fixture-profile-flow', role: 'user'}}));
  await page.route('**/jobs/*/ai-assessment', route => route.fulfill({json: {
    job_id: 'profile-flow-fixture', status: 'not_analyzed', assessment: null, advice: null,
    source_run_id: null, execution_mode: null, model: null, finished_at: null, reason: null,
  }}));
  await page.route('**/browser-assistant/draft', route => route.fulfill({json: {
    values: {}, countries: {nationality: null, campus: null}, profile_source: 'jobpilot',
    summary_status: 'manual_only', requires_review: true, submission_supported: false,
  }}));
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
  await page.route('**/browser-assistant/autofill-profile', route => route.fulfill({json: {values: {}, sources: {}, missing_fields: [], resume: null, resumes: [], requires_resume_selection: false, extraction_status: 'no_resume', fingerprint: 'fixture-empty'}}));
  await page.route('**/profile/resumes', route => route.fulfill({json: []}));
  await page.goto(`${base}/profile`);
  await page.locator('#saved-profile-details > summary').click();
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeEnabled();
  return () => profile;
}

test('saved natural skills lead to evidence and the correct explicit InternSG entry', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900});
  const currentProfile = await setupProfile(page);
  await page.route('**/browser-assistant/draft', route => {
    const profile = currentProfile();
    return route.fulfill({json: {
      values: {applicant_name: profile.full_name, applicant_email: profile.contact_email, applicant_contact: profile.phone,
        applicant_period: profile.availability_period, applicant_summary: profile.resume_summary},
      countries: {nationality: profile.nationality, campus: profile.study_country}, profile_source: 'jobpilot',
      summary_status: 'manual_only', requires_review: true, submission_supported: false,
    }});
  });
  let recommendationCalls = 0, externalPosts = 0;
  await page.route(/\/jobs(\?.*)?$/, route => route.request().resourceType() === 'document'
    ? route.continue() : route.fulfill({json: {items: [job], total: 1, pages: 1}}));
  const recommendationRunId = '22222222-3333-4444-8555-666666666666';
  const recommendationRun = () => ({
    id: recommendationRunId, status: 'succeeded', reused: false, input_hash: 'profile-flow-fixture',
    provider: 'fixture-only', model: 'fixture-only', prompt_version: 'fixture-only', execution_mode: 'live',
    profile_skill_count: currentProfile().skills.length,
    candidates: [{id: job.id, title: job.title, company: job.company, city: job.city, job_type: job.job_type}],
    display_order: [job.id], advice: {[job.id]: {
      version: 'action-advice-v5', status: 'check_first', headline: 'Check the full spreadsheet requirements before applying.',
      reasons: ['The complete conditions remain unverified.'], blockers: [], strengths: [], counts: {supported: 0, gap: 0, unknown: 1},
      application_recommendation: {verdict: 'consider', summary: 'Your spreadsheet skills are relevant; confirm the other role requirements.',
        strengths: [naturalSkill], considerations: ['Confirm the complete spreadsheet requirements before applying.']},
    }},
    result: {requires_review: true, items: [{
      job_id: job.id, rank: 1, summary: 'Microsoft Excel appears in the saved skills and the job; other conditions remain unverified.',
      warnings: [], requirements: [{requirement: sourceQuote, category: 'skill', outcome: 'unknown',
        reason: 'Shared skill only; the complete conditions remain unverified.', jd_quote: sourceQuote,
        profile_field: 'skills', profile_quote: naturalSkill}],
    }]},
    error_code: null, usage: {input_tokens: 50, output_tokens: 40},
    started_at: '2026-10-24T04:00:00Z', expires_at: '2026-10-24T04:03:00Z', finished_at: '2026-10-24T04:00:05Z',
  });
  await page.route('**/jobs/ai-recommendations', route => {
    recommendationCalls++;
    expect(route.request().headers().authorization).toBe(`Bearer ${tokenA}`);
    expect(route.request().postDataJSON()).toEqual({confirmed: true});
    expect(currentProfile().skills).toEqual([naturalSkill]);
    return route.fulfill({status: 201, json: recommendationRun()});
  });
  await page.route(`**/ai-recommendations/${recommendationRunId}`, route => route.fulfill({json: {...recommendationRun(), reused: true}}));
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

  await page.getByRole('link', {name: 'View jobs', exact: true}).click();
  await expect(page).toHaveURL(`${base}/jobs`);
  expect(recommendationCalls).toBe(0);
  await page.getByRole('button', {name: 'Recommend to me', exact: true}).click();
  await expect(page.locator('.job-advice-summary')).toHaveText('Your spreadsheet skills are relevant; confirm the other role requirements.');
  await expect(page.locator('.job-advice-strengths')).toContainText(naturalSkill);
  await expect(page.locator('.job-advice-considerations')).toContainText('Confirm the complete spreadsheet requirements');
  await expect(page.locator('.job-advice-evidence, .job-advice-quotes')).toHaveCount(0);
  await page.getByRole('link', {name: 'View job and original posting'}).click();
  await expect(page.getByRole('heading', {name: job.title})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.screenshot({path: `../output/profile-flow-job-${name}.png`, fullPage: true});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('link', {name: 'Prepare application'}).click();
  await expect(page).toHaveURL(`${base}/jobs/${job.id}/prepare`);
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
  await expect(page.locator('#saved-profile-details')).not.toHaveAttribute('open');
  await page.locator('#saved-profile-details > summary').click();
  await expect(page.getByRole('button', {name: 'Save Profile'})).toBeDisabled();
  await expect(page.getByLabel('Full Name', {exact: true})).toBeDisabled();
  await expect(page.getByLabel('Full Name', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('First / given name', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Last / family name', {exact: true})).toHaveValue('');
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
  await expect(page.getByRole('alert').filter({hasText: /skills/i})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText: /skills/i})).not.toContainText('SERVER_PRIVATE_INPUT_MUST_NOT_BE_ECHOED');
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
  await expect(options).toContainText("Review your saved details and resume, then continue through this employer's application channel.");
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View original posting/})).toHaveAttribute('href', job.source_url);
});

test('InternSG remains available through its original embedded flow when no platform form exists', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {assistant_form_available: false}, [], route => {
    lookups++;
    return route.fulfill({json: {forms: []}});
  });
  await expect(options.getByRole('link', {name: 'Prepare application'})).toHaveAttribute('href', `/jobs/${job.id}/prepare`);
  await expect(options.getByRole('link', {name: 'Apply with AI Assistant'})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View original posting/})).toHaveAttribute('href', job.source_url);
  expect(lookups).toBe(0);
});

test('inactive jobs suppress all application entries even when a platform form is available', async ({page}) => {
  let lookups = 0;
  const options = await applicationOptions(page, {
    status: 'closed', apply_url: 'https://employer.example.test/apply', assistant_form_available: true,
  }, [], route => { lookups++; return route.fulfill({json: {forms: []}}); });
  await expect(options).toContainText('This job is not active');
  await expect(options.getByRole('link', {name: /Prepare application|Apply with AI Assistant/})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View original posting/})).toHaveAttribute('href', job.source_url);
  expect(lookups).toBe(0);
});


test('closed jobs do not offer an application entry', async ({page}) => {
  const options = await applicationOptions(page, {status: 'closed'}, [{id: 'fixture-form', job_id: job.id}]);
  await expect(options).toContainText('This job is not active');
  await expect(options.getByRole('link', {name: /Prepare application|Apply with AI Assistant/})).toHaveCount(0);
  await expect(options.getByRole('link', {name: /View original posting/})).toHaveAttribute('href', job.source_url);
});

test('unsafe original URLs are not rendered as clickable application actions', async ({page}) => {
  const options = await applicationOptions(page, {
    source_url: 'javascript:alert("fixture")',
    apply_url: 'https://account:password@employer.example.test/apply',
  });
  await expect(options).toContainText("Review your saved details and resume, then continue through this employer's application channel.");
  await expect(options.getByRole('link', {name: /View original posting/})).toHaveCount(0);
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

test('job page offers the preparation entry without an inline embedded form', async ({page}) => {
  const options = await applicationOptions(page, {});
  await expect(options.getByRole('link', {name: 'Prepare application'})).toHaveAttribute('href', `/jobs/${job.id}/prepare`);
  await expect(page.locator('iframe')).toHaveCount(0);
});
