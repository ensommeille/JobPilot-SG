import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;

test.skip(!base, 'Set FRONTEND_BASE_URL to test the matching UI.');
const missingReason = 'This skill is not explicitly listed. Missing information is not a proven gap.';
const report = {
  status: 'preliminary', reason: null,
  warnings: ['Extracted requirements have not been human-verified. All comparisons are preliminary.'],
  items: [
    {category: 'required_skills', requirement: 'Python', importance: 'required', outcome: 'supported',
      reason: 'The same skill is explicitly listed in your profile; proficiency is not verified.',
      job_evidence: 'Python required.', profile_evidence: 'Python', profile_field: 'skills'},
    {category: 'required_skills', requirement: 'Java', importance: 'required', outcome: 'gap',
      reason: 'Your profile explicitly states no experience/knowledge of this skill.',
      job_evidence: 'Java required.', profile_evidence: 'No experience with Java', profile_field: 'skills'},
    {category: 'preferred_skills', requirement: 'SQL', importance: 'preferred', outcome: 'unknown',
      reason: missingReason, job_evidence: 'SQL preferred.', profile_evidence: null, profile_field: null},
  ],
};
const partial = {
  category: 'required_skills', requirement: 'Basic knowledge of AutoCAD.', importance: 'required', outcome: 'unknown',
  reason: 'Shared skill mentions only. Proficiency remains unverified.',
  job_evidence: 'Basic knowledge of AutoCAD.', profile_evidence: 'AutoCAD drafting projects', profile_field: 'skills',
  skill_overlaps: [{skill_id: 'autocad', label: 'AutoCAD', kind: 'specific', profile_evidence: 'AutoCAD drafting projects'}],
};
const generalTraits = [
  {category: 'required_skills', requirement: 'Strong communication skills', importance: 'required', outcome: 'unknown',
    reason: 'Complex or unsupported skill wording requires manual review.',
    job_evidence: 'Strong communication skills.', profile_evidence: null, profile_field: null},
  {category: 'preferred_skills', requirement: 'Teamwork', importance: 'preferred', outcome: 'unknown',
    reason: missingReason, job_evidence: 'Teamwork.', profile_evidence: null, profile_field: null},
];
const group = (page, name) => page.locator(`.job-match-group[data-match-group="${name}"]`);
const analyzeButton = page => page.getByRole('button', {name: 'Check my match', exact: true});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function counts(page, values) {
  for (const [name, count] of Object.entries(values)) {
    await expect(page.locator(`.job-match-counts [data-match-count="${name}"] dd`)).toHaveText(String(count));
  }
}

async function setup(page, handler, loggedIn = true, job = {}) {
  await page.addInitScript(loggedIn => { if (loggedIn) localStorage.setItem('jobpilot_token', 'test-account-token'); }, loggedIn);
  await page.route('**/profile', route => route.fulfill({json: {full_name: 'Fictional Applicant'}}));
  await page.route('**/jobs/match-fixture', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: {
    id: 'match-fixture', title: 'Fictional developer — test fixture', company: 'Demo only',
    city: 'Singapore', job_type: 'internship', deadline: null, salary_min: null, salary_max: null,
    description: 'Python required. Java required. SQL preferred.', source: {name: 'Offline fixture'}, tags: [], source_url: null, ...job,
  }}));
  await page.route('**/jobs/match-fixture/match-analysis', handler);
  await page.goto(base + '/jobs/match-fixture');
}

test('explicit analysis presents four compact English groups with collapsed evidence on desktop and mobile', async ({page}) => {
  let calls = 0;
  await setup(page, route => {
    calls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({include_experience: true});
    return route.fulfill({json: {...report, items: [...report.items, partial, ...generalTraits]}});
  }, true, {description: 'Python required. Java required. SQL preferred. Basic knowledge of AutoCAD. Strong communication skills. Teamwork.'});
  const section = page.locator('section.job-match');
  await expect(section).toHaveAttribute('lang', 'en');
  await expect(analyzeButton(page)).toBeVisible();
  expect(calls).toBe(0);
  await analyzeButton(page).click();
  await expect(page.getByRole('button', {name: 'Check again', exact: true})).toBeVisible();
  await expect(section.getByText('4 requirements in focus. Check again after editing your profile.', {exact: true})).toBeVisible();
  await counts(page, {matched: 1, gap: 1, missing: 1, review: 1});
  for (const [name, title, requirement] of [
    ['matched', 'Matched skills', 'Python'], ['gap', 'Explicit gaps', 'Java'],
    ['missing', 'Missing from profile', 'SQL'], ['review', 'Needs review', 'Basic knowledge of AutoCAD.'],
  ]) {
    await expect(group(page, name).getByRole('heading', {name: new RegExp(title)})).toBeVisible();
    await expect(group(page, name).locator('.job-match-item')).toHaveCount(1);
    await expect(group(page, name)).toContainText(requirement);
  }
  await expect(section.locator('.job-match-item')).toHaveCount(4);
  await expect(section.getByText('General traits (2)', {exact: true})).toBeVisible();
  await expect(section.locator('.job-match-general-item')).toHaveCount(2);
  await expect(section.locator('.job-match-general-item').first()).not.toBeVisible();
  await expect(section.getByText(report.warnings[0], {exact: true})).not.toBeVisible();
  await expect(group(page, 'matched').getByText(report.items[0].reason, {exact: true})).not.toBeVisible();
  await expect(group(page, 'review')).toContainText('Shared skills: AutoCAD');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: `../output/match-simplified-${name}.png`, fullPage: true});
  }
  await group(page, 'matched').getByText('View evidence', {exact: true}).click();
  await expect(group(page, 'matched').locator('dd').nth(0)).toHaveText('Python required.');
  await expect(group(page, 'matched').locator('dd').nth(1)).toHaveText('Python');
  await expect(group(page, 'matched').getByText(report.items[0].reason, {exact: true})).toBeVisible();
  await section.getByText('About this analysis', {exact: true}).click();
  await expect(section.getByText(report.warnings[0], {exact: true})).toBeVisible();
  expect(calls).toBe(1);
});

test('pure legacy general traits are reference-only with no skill counts or missing-profile prompt', async ({page}) => {
  const combined = {...generalTraits[0],
    requirement: 'Strong organisational skills, with a keen attention to detail.',
    job_evidence: 'Strong organisational skills, with a keen attention to detail.'};
  const items = [...generalTraits, combined];
  await setup(page, route => route.fulfill({json: {...report, items}}), true,
    {description: items.map(item => item.job_evidence).join('\n')});
  await analyzeButton(page).click();
  const section = page.locator('.job-match');
  const reference = section.locator('details.job-match-general');
  await expect(section.getByText('No specific skills were identified for comparison. Check the job description.', {exact: true})).toBeVisible();
  await expect(section.locator('.job-match-counts')).toHaveCount(0);
  await expect(section.locator('.job-match-group')).toHaveCount(0);
  await expect(section.locator('.job-match-item')).toHaveCount(0);
  await expect(section.getByRole('link', {name: 'Add my skills', exact: true})).toHaveCount(0);
  await expect(reference.getByText('General traits (3)', {exact: true})).toBeVisible();
  await expect(reference.locator('.job-match-general-item').first()).not.toBeVisible();
  await reference.getByText('General traits (3)', {exact: true}).click();
  await expect(reference.getByText('Kept for reference, not counted as skill matches or profile gaps.', {exact: true})).toBeVisible();
  await expect(reference.locator('.job-match-general-item')).toHaveCount(3);
  await expect(reference.getByRole('link')).toHaveCount(0);
  await expect(reference).not.toContainText('Missing from profile');
  const first = reference.locator('.job-match-general-item').first();
  await expect(first.getByText(generalTraits[0].job_evidence, {exact: true})).not.toBeVisible();
  await first.getByText('View source', {exact: true}).click();
  await expect(first.getByText(generalTraits[0].job_evidence, {exact: true})).toBeVisible();
  await expect(first).toContainText('Required — model-labelled, unverified');
});

test('v2 trait groups and general-only overlaps remain reference-only without a missing-skills action', async ({page}) => {
  const item = {...generalTraits[0], category: 'requirement_groups',
    requirement: 'Excellent communication skills and teamwork',
    job_evidence: 'Excellent communication skills and teamwork.', group_operator: 'all_of',
    conditions: [
      {kind: 'trait', requirement: 'Communication skills', qualifier: 'excellent', qualifier_evidence: 'Excellent communication skills',
        outcome: 'unknown', reason: 'This condition requires manual comparison; it does not establish suitability.',
        job_evidence: 'Excellent communication skills', profile_evidence: null},
      {kind: 'skill', requirement: 'Teamwork', qualifier: null, outcome: 'unknown',
        reason: 'This condition requires manual comparison; it does not establish suitability.',
        job_evidence: 'teamwork', profile_evidence: null},
    ],
    skill_overlaps: [{skill_id: 'teamwork', label: 'Teamwork', kind: 'general', profile_evidence: 'Teamwork'}],
  };
  await setup(page, route => route.fulfill({json: {...report, items: [item]}}), true,
    {description: item.job_evidence});
  await analyzeButton(page).click();
  await expect(page.locator('.job-match-counts')).toHaveCount(0);
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await expect(page.locator('.job-match').getByRole('link', {name: 'Add my skills', exact: true})).toHaveCount(0);
  await page.getByText('General traits (1)', {exact: true}).click();
  const reference = page.locator('.job-match-general-item');
  await expect(reference).toHaveCount(1);
  await expect(reference).toContainText(item.requirement);
  await reference.getByText('View source', {exact: true}).click();
  await expect(reference.getByText(item.job_evidence, {exact: true})).toBeVisible();
});

test('mixed, technical, qualified, non-skill, contradictory, and unfamiliar wording stays in the main comparison', async ({page}) => {
  const unknownReason = 'This condition requires manual comparison; it does not establish suitability.';
  const item = (requirement, job_evidence = requirement, extra = {}) => ({
    ...generalTraits[0], requirement, job_evidence, reason: unknownReason, ...extra,
  });
  const condition = (requirement, extra = {}) => ({kind: 'trait', requirement, job_evidence: requirement,
    qualifier: null, outcome: 'unknown', reason: unknownReason, profile_evidence: null, ...extra});
  const items = [
    item('Python and communication skills'),
    item('Network communication protocols'),
    item('English communication skills', 'English communication skills', {category: 'languages'}),
    item('A degree in engineering and leadership'),
    item('PMP certification and teamwork'),
    item('Three years of leadership experience'),
    item('3 years of leadership experience'),
    item('No communication skills required'),
    item('Communication architecture'),
    item('Communication skills', 'SQL required.'),
    item('Communication skills', 'Communication skills', {category: 'education'}),
    item('Teamwork', 'Teamwork', {category: 'required_qualifications'}),
    item('Communication skills', 'Communication skills', {category: 'requirement_groups',
      conditions: [condition('Python')]}),
    item('Communication skills', 'Communication skills', {category: 'requirement_groups',
      conditions: [condition('Communication skills', {kind: 'language'})]}),
    item('Communication skills', 'Communication skills', {category: 'requirement_groups',
      conditions: [condition('Communication skills', {skill_overlaps: [{kind: 'specific', skill_id: 'python', label: 'Python', profile_evidence: 'Python'}]})]}),
    item('Leadership', 'Leadership', {category: 'requirement_groups',
      conditions: [condition('Leadership', {qualifier: '3 years', qualifier_evidence: '3 years'})]}),
    item('Leadership', 'Leadership', {category: 'requirement_groups',
      conditions: [condition('Leadership', {qualifier: 'strong', qualifier_evidence: '3 years of leadership'})]}),
    item('Communication skills', 'Communication skills', {
      skill_overlaps: [{skill_id: 'python', label: 'Python', kind: 'specific', profile_evidence: 'Python'}]}),
  ];
  await setup(page, route => route.fulfill({json: {...report, items}}), true,
    {description: items.map(value => value.job_evidence).join('\n')});
  await analyzeButton(page).click();
  await counts(page, {matched: 0, gap: 0, missing: 0, review: items.length});
  await expect(group(page, 'review').locator('.job-match-item')).toHaveCount(items.length);
  await expect(page.locator('.job-match-general')).toHaveCount(0);
  await expect(group(page, 'missing')).toHaveCount(0);
  for (const value of items) await expect(group(page, 'review')).toContainText(value.requirement);
});

test('backend-supported and explicit-gap outcomes are never demoted, while partial technical overlaps stay unknown', async ({page}) => {
  const supported = {...generalTraits[0], outcome: 'supported', profile_evidence: 'Communication skills',
    reason: 'The same skill is explicitly listed in your profile; proficiency is not verified.'};
  const gap = {...generalTraits[1], outcome: 'gap', profile_evidence: 'No teamwork experience',
    reason: 'Your profile explicitly states no experience/knowledge of this skill.'};
  await setup(page, route => route.fulfill({json: {...report, items: [supported, gap, partial, generalTraits[0]]}}));
  await analyzeButton(page).click();
  await counts(page, {matched: 1, gap: 1, missing: 0, review: 1});
  await expect(group(page, 'matched')).toContainText(supported.requirement);
  await expect(group(page, 'gap')).toContainText(gap.requirement);
  await expect(group(page, 'review')).toContainText('Shared skills: AutoCAD');
  await expect(page.locator('.job-match-item')).toHaveCount(3);
  await expect(page.getByText('General traits (1)', {exact: true})).toBeVisible();
  await expect(page.locator('.job-match-general-item')).toHaveCount(1);
  await expect(group(page, 'matched')).not.toContainText('AutoCAD');
});

test('only the explicit missing-skill reason is classified as missing profile information', async ({page}) => {
  const reviewCases = [
    ['Strong organisational skills, with a keen attention to detail.', 'Complex or unsupported skill wording requires manual review.', 'required_skills'],
    ['Degree in computing', 'Requires manual comparison; saved skill mentions do not establish education or experience.', 'education'],
    ['Relevant professional experience', 'Requires manual comparison; this offline version does not infer qualifications.', 'experience'],
    ['Conflicting Python entries', 'Your skill entries conflict; update your profile.', 'required_skills'],
    ['Missing source quote', 'Extraction evidence is not present in the current job description.', 'required_skills'],
    ['Unverified qualifier', 'The extracted qualifier is not supported by a current source quote.', 'requirement_groups'],
    ['V2 narrow skill without comparable evidence', 'This condition requires manual comparison; it does not establish suitability.', 'requirement_groups'],
    ['Future unknown reason', 'A new reason which is not an explicit profile-missing signal.', 'required_skills'],
  ].map(([requirement, reason, category]) => ({...report.items[2], requirement, reason, category}));
  reviewCases.push(
    {...report.items[2], requirement: 'Non-skill category with missing-skill wording', category: 'education'},
    {...report.items[2], requirement: 'Compound requirement with missing-skill wording', group_operator: 'all_of',
      conditions: [{kind: 'skill', requirement: 'SQL', outcome: 'unknown', reason: missingReason,
        qualifier: null, job_evidence: 'SQL preferred.', profile_evidence: null}]},
    {...report.items[2], requirement: 'Existing profile evidence with missing-skill wording', profile_evidence: 'SQL queries'},
    {...partial, requirement: 'Partial overlap with missing-skill wording', reason: missingReason},
  );
  await setup(page, route => route.fulfill({json: {...report, items: [report.items[2], ...reviewCases]}}));
  await analyzeButton(page).click();
  await counts(page, {matched: 0, gap: 0, missing: 1, review: reviewCases.length});
  await expect(group(page, 'matched')).toHaveCount(0);
  await expect(group(page, 'gap')).toHaveCount(0);
  await expect(group(page, 'missing').locator('.job-match-item')).toHaveCount(1);
  await expect(group(page, 'missing')).toContainText('SQL');
  for (const item of reviewCases) {
    await expect(group(page, 'review')).toContainText(item.requirement);
    await expect(group(page, 'missing')).not.toContainText(item.requirement);
  }
});

test('partial shared skills remain in review rather than complete support, gap, or missing data', async ({page}) => {
  await setup(page, route => route.fulfill({json: {...report, items: [partial]}}), true,
    {title: 'Fictional AutoCAD intern — test fixture', description: 'Basic knowledge of AutoCAD.'});
  await analyzeButton(page).click();
  await counts(page, {matched: 0, gap: 0, missing: 0, review: 1});
  await expect(page.locator('.job-match-group')).toHaveCount(1);
  await expect(group(page, 'review')).toContainText('Shared skills: AutoCAD');
  await expect(page.locator('.job-match-item')).toHaveCount(1);
  await group(page, 'review').getByText('View evidence', {exact: true}).click();
  await expect(group(page, 'review').locator('dd').nth(0)).toHaveText('Basic knowledge of AutoCAD.');
  await expect(group(page, 'review').locator('dd').nth(1)).toHaveText('AutoCAD drafting projects');
  await expect(group(page, 'review').getByText(partial.reason, {exact: true})).toBeVisible();
});

test('all manual unknowns produce review items without claiming missing skills or an explicit gap', async ({page}) => {
  const unknown = {...report.items[2], requirement: 'Organisational ability',
    reason: 'Complex or unsupported skill wording requires manual review.'};
  await setup(page, route => route.fulfill({json: {...report, items: [unknown]}}));
  await analyzeButton(page).click();
  await counts(page, {matched: 0, gap: 0, missing: 0, review: 1});
  await expect(page.locator('.job-match-group')).toHaveCount(1);
  await expect(group(page, 'review')).toContainText('Organisational ability');
  await expect(page.locator('.job-match')).not.toContainText('100%');
});

test('missing or stale extraction is explained without fabricated matches', async ({page}) => {
  await setup(page, route => route.fulfill({json: {...report, status: 'unavailable', reason: 'stale_extraction', items: []}}));
  await analyzeButton(page).click();
  await expect(page.locator('.job-match')).toContainText('This job has changed. Requirements need updating; check the latest job description.');
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await expect(page.locator('.job-match-counts')).toHaveCount(0);
});

test('network failure allows retry and a new analysis replaces previous results', async ({page}) => {
  let next = 'failure';
  await setup(page, route => next === 'failure'
    ? route.fulfill({status: 503, json: {}})
    : route.fulfill({json: next === 'complete' ? report : {...report, items: [partial]}}));
  await analyzeButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Could not check your match. Check your connection and try again.');
  next = 'complete';
  await analyzeButton(page).click();
  await counts(page, {matched: 1, gap: 1, missing: 1, review: 0});
  await expect(page.locator('.job-match-group')).toHaveCount(3);
  next = 'partial';
  await page.getByRole('button', {name: 'Check again', exact: true}).click();
  await counts(page, {matched: 0, gap: 0, missing: 0, review: 1});
  await expect(page.locator('.job-match-item')).toHaveCount(1);
  await expect(group(page, 'review')).toContainText('AutoCAD');
  await expect(group(page, 'gap')).toHaveCount(0);
});

test('logged-out users are asked to sign in without sending profile analysis', async ({page}) => {
  let calls = 0;
  await setup(page, route => { calls++; return route.fulfill({json: report}); }, false);
  await analyzeButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot to check your match.');
  expect(calls).toBe(0);
});

test('account change while a request is pending cannot expose previous account results', async ({page, context}) => {
  const started = deferred(), release = deferred(), answered = deferred();
  const credentials = [];
  const privateA = 'Private account A evidence must never appear for B';
  const evidenceB = 'Current account B evidence from a fresh explicit analysis';
  await setup(page, async route => {
    const authorization = route.request().headers().authorization;
    credentials.push(authorization);
    if (authorization === 'Bearer test-account-token') {
      started.resolve();
      await release.promise;
      await route.fulfill({json: {...report, items: [{...report.items[0], profile_evidence: privateA}]}});
      answered.resolve();
    } else {
      expect(authorization).toBe('Bearer another-account');
      await route.fulfill({json: {...report, items: [{...report.items[0], profile_evidence: evidenceB}]}});
    }
  });
  await analyzeButton(page).click();
  await started.promise;
  await expect(page.getByRole('button', {name: 'Checking…', exact: true})).toBeDisabled();
  const other = await context.newPage();
  await other.goto(base + '/');
  await other.evaluate(() => localStorage.setItem('jobpilot_token', 'another-account'));
  await expect(analyzeButton(page)).toBeEnabled();
  release.resolve();
  await answered.promise;
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privateA);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBe('another-account');
  expect(credentials).toEqual(['Bearer test-account-token']);
  await analyzeButton(page).click();
  await counts(page, {matched: 1, gap: 0, missing: 0, review: 0});
  await expect(page.locator('.job-match-group')).toHaveCount(1);
  await group(page, 'matched').getByText('View evidence', {exact: true}).click();
  await expect(group(page, 'matched').locator('dd').nth(1)).toHaveText(evidenceB);
  await expect(page.locator('body')).not.toContainText(privateA);
  expect(credentials).toEqual(['Bearer test-account-token', 'Bearer another-account']);
});

test('v2 retains AND and OR conditions, qualifiers, conditional duties, and unknown work feasibility behind details', async ({page}) => {
  const compound = {...report.items[0], requirement: 'Python and framework experience', outcome: 'unknown',
    reason: 'Only Python overlaps; the complete requirement remains unverified.',
    group_operator: 'all_of', skill_overlaps: [{skill_id: 'python', label: 'Python', kind: 'specific', profile_evidence: 'Python'}],
    conditions: [
      {kind: 'skill', requirement: 'Python', qualifier: null, outcome: 'supported', reason: 'Skill entry shared; proficiency unverified.', job_evidence: 'Python', profile_evidence: 'Python'},
      {kind: 'skill', requirement: 'PyTorch or TensorFlow', qualifier: 'experience', qualifier_evidence: 'experience with PyTorch or TensorFlow', outcome: 'unknown', reason: 'Framework experience is not established.', job_evidence: 'experience with PyTorch or TensorFlow', profile_evidence: null},
    ]};
  const alternative = {...compound, requirement: 'Python or Java proficiency', group_operator: 'any_of',
    conditions: [{...compound.conditions[0], qualifier: 'proficiency', outcome: 'unknown'}]};
  const work = ['schedule', 'hours', 'minimum_duration', 'work_modes', 'locations'].map(category => ({
    category: 'work_constraints.' + category, requirement: category + ': not stated', outcome: 'unknown',
    reason: 'Compatibility unknown; no comparable availability evidence.', job_evidence: '',
  }));
  await setup(page, route => route.fulfill({json: {...report, items: [compound, alternative], work_constraints: work,
    summary: {value: 'Core pipeline work; integrations depend on team needs.', evidence: 'Core pipeline work.'},
    responsibilities: [{value: 'Build integrations', evidence: 'Build integrations as needed', priority: 'conditional', condition: {value: 'as needed', evidence: 'as needed'}}],
  }}));
  await analyzeButton(page).click();
  await counts(page, {matched: 0, gap: 0, missing: 0, review: 2});
  const items = group(page, 'review').locator('.job-match-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByLabel('Individual requirement conditions')).not.toBeVisible();
  await items.nth(0).getByText('View evidence', {exact: true}).click();
  await expect(items.nth(0)).toContainText('All listed conditions are required together.');
  await expect(items.nth(0).getByLabel('Individual requirement conditions')).toContainText('PyTorch or TensorFlow');
  await expect(items.nth(0).getByLabel('Individual requirement conditions')).toContainText('Source condition: experience');
  await expect(items.nth(0).getByLabel('Individual requirement conditions')).toContainText('Unknown');
  await items.nth(1).getByText('View evidence', {exact: true}).click();
  await expect(items.nth(1)).toContainText('The source allows an alternative among these conditions.');
  await expect(page.locator('.job-work-constraints')).not.toBeVisible();
  await page.getByText('Work conditions to review', {exact: true}).click();
  await expect(page.locator('.job-work-constraints')).toBeVisible();
  await expect(page.locator('.job-work-constraints li')).toHaveCount(5);
  await expect(page.locator('.job-work-constraints')).toContainText('compatibility unknown');
  await page.getByText('Role & responsibilities', {exact: true}).click();
  await expect(page.locator('.job-match').getByText('Conditional responsibility: Build integrations', {exact: true})).toBeVisible();
  await expect(page.locator('.job-match').getByText('Applies when: as needed', {exact: true})).toBeVisible();
});

test('mock extraction remains visibly identified when general warnings are collapsed', async ({page}) => {
  const warning = 'Requirements come from a mock extraction; treat this as a demonstration.';
  await setup(page, route => route.fulfill({json: {...report, warnings: [...report.warnings, warning]}}));
  await analyzeButton(page).click();
  await expect(page.getByText('Demo data: these results use mock requirements, not a real job assessment.', {exact: true})).toBeVisible();
  await expect(page.getByText(report.warnings[0], {exact: true})).not.toBeVisible();
  await page.getByText('About this analysis', {exact: true}).click();
  await expect(page.getByText(warning, {exact: true})).toBeVisible();
});

test('source and profile evidence are rendered as text rather than executable markup', async ({page}) => {
  const markup = '<img src=x onerror="window.__matchXssExecuted=true">';
  await page.addInitScript(() => { window.__matchXssExecuted = false; });
  await setup(page, route => route.fulfill({json: {...report, items: [{
    ...report.items[0], requirement: 'Literal ' + markup, job_evidence: markup, profile_evidence: markup,
  }]}}));
  await analyzeButton(page).click();
  const matched = group(page, 'matched');
  await expect(matched).toContainText('Literal ' + markup);
  await matched.getByText('View evidence', {exact: true}).click();
  await expect(matched.locator('dd').nth(0)).toHaveText(markup);
  await expect(matched.locator('dd').nth(1)).toHaveText(markup);
  await expect(matched.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__matchXssExecuted)).toBe(false);
});

test('clearing storage in another tab removes displayed private analysis', async ({page, context}) => {
  let calls = 0;
  const privateEvidence = 'Private signed-in profile evidence that must be cleared';
  await setup(page, route => {
    calls++;
    return route.fulfill({json: {...report, items: [{...report.items[0], profile_evidence: privateEvidence}]}});
  });
  await analyzeButton(page).click();
  await expect(page.locator('.job-match-group')).toHaveCount(1);
  await group(page, 'matched').getByText('View evidence', {exact: true}).click();
  await expect(group(page, 'matched').locator('dd').nth(1)).toHaveText(privateEvidence);
  const other = await context.newPage();
  await other.goto(base + '/');
  await other.evaluate(() => localStorage.clear());
  await expect(analyzeButton(page)).toBeEnabled();
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await expect(page.locator('.job-match-counts')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privateEvidence);
  expect(await page.evaluate(() => localStorage.getItem('jobpilot_token'))).toBeNull();
  expect(calls).toBe(1);
  await analyzeButton(page).click();
  await expect(page.getByRole('alert')).toContainText('Sign in to JobPilot to check your match.');
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  expect(calls).toBe(1);
});

const projectEvidence = {
  responsibility: 'Develop and test internal software tools.',
  job_evidence: 'Develop and test internal software tools.',
  priority: 'unspecified', condition: null, outcome: 'related_evidence', reason: 'related_activity',
  activities: ['software_features', 'software_testing'],
  profile_evidence: ['Implemented access control for an internal application.', 'Wrote automated tests for the application.'],
};

test('project evidence is separate from requirements, exact, responsive, and not invented for other duties', async ({page}) => {
  const unknown = {...projectEvidence, responsibility: 'Conduct market research.', job_evidence: 'Conduct market research.',
    outcome: 'unknown', reason: 'unsupported_activity', activities: [], profile_evidence: []};
  await setup(page, route => {
    expect(route.request().postDataJSON()).toEqual({include_experience: true});
    return route.fulfill({json: {...report, items: [], responsibility_matches: [projectEvidence, unknown]}});
  });
  await analyzeButton(page).click();
  const projects = page.locator('.responsibility-matches');
  await expect(projects.getByRole('heading', {name: 'Related project experience', exact: true})).toBeVisible();
  await expect(projects.locator('.responsibility-match')).toHaveCount(1);
  for (const text of [projectEvidence.job_evidence, ...projectEvidence.profile_evidence]) await expect(projects).toContainText(text);
  await expect(page.locator('.job-match-counts')).toHaveCount(0);
  await expect(page.locator('.job-match-group')).toHaveCount(0);
  await projects.getByText('Other responsibilities to review (1)', {exact: true}).click();
  await expect(projects.locator('.responsibility-unknown')).toContainText('Conduct market research.');
  await expect(projects.locator('.responsibility-unknown')).not.toContainText(projectEvidence.profile_evidence[0]);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({width, height});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: `../output/project-evidence-${name}.png`, fullPage: true});
  }
});

test('project excerpts render safely and are cleared on account change', async ({page}) => {
  const markup = '<img src=x onerror="window.__projectXss=true">';
  await page.addInitScript(() => { window.__projectXss = false; });
  await setup(page, route => route.fulfill({json: {...report, items: [], responsibility_matches: [
    {...projectEvidence, profile_evidence: [markup]},
  ]}}));
  await analyzeButton(page).click();
  await expect(page.locator('.responsibility-match')).toContainText(markup);
  await expect(page.locator('.responsibility-match img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__projectXss)).toBe(false);
  await page.evaluate(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', {key: null}));
  });
  await expect(page.locator('.responsibility-matches')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(markup);
});
