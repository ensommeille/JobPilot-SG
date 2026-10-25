import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for the isolated PDF-first Profile UI fixture.');
const resume = {id: '11111111-2222-4333-8444-555555555555', filename: 'Fictional resume.pdf', sha256: 'a'.repeat(64), has_file: true,
  uploaded_at: '2026-10-24T12:00:00Z', size_bytes: 1234, content_type: 'application/pdf', extraction_status: 'parsed', page_count: 1};
const uploaded = {...resume, id: '33333333-4444-4555-8666-777777777777', filename: 'New fictional resume.pdf'};
const savedProfile = {full_name: 'Saved Profile Name', given_name: null, family_name: null, contact_email: '', phone: '', education: '', experience: '',
  skills: [], links: {}, resume_summary: '', availability_period: '', nationality: null, study_country: null};
async function setup(page, {multiple = false, empty = false, cached = false, fail = false, hold = false} = {}) {
  await page.addInitScript(() => localStorage.setItem('jobpilot_token', 'pdf-autofill-fixture'));
  const ready = new Set(cached ? [resume.id] : []), failed = new Set();
  let profile = {values: {full_name: 'Saved Profile Name'}, sources: {full_name: {source: 'profile', quote: null, resume_id: null}},
    missing_fields: ['school', 'given_name', 'current_city'], resume: multiple || empty ? null : resume,
    resumes: empty ? [] : multiple ? [resume, {...resume, id: '22222222-3333-4444-8555-666666666666'}] : [resume], requires_resume_selection: multiple,
    extraction_status: empty ? 'no_resume' : multiple ? 'selection_required' : cached ? 'ready' : 'not_extracted', fingerprint: 'before'};
  const reads = [], patches = [], uploads = [], warms = []; let release = () => {};
  await page.route('**/users/me', route => route.fulfill({json: {id: 'pdf-fixture-user', role: 'user'}}));
  await page.route('**/profile', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: savedProfile}));
  await page.route('**/profile/resumes', route => route.fulfill({json: profile.resumes}));
  await page.route('**/browser-assistant/autofill-profile', route => route.fulfill({json: profile}));
  await page.route('**/browser-assistant/prepare-answers/warm', route => {
    warms.push(route.request().postDataJSON());
    return route.fulfill({status: 500, json: {detail: 'A Profile visit has no application to prepare'}});
  });
  await page.route('**/profile/resumes/upload', route => { uploads.push(route.request().method()); profile = {...profile, resumes: [...profile.resumes, uploaded]}; return route.fulfill({json: uploaded}); });
  await page.route('**/profile/autofill-details', route => {
    const body = route.request().postDataJSON(); patches.push(body);
    if ('resume_id' in body) profile = {...profile, resume: profile.resumes.find(item => item.id === body.resume_id) || null,
      requires_resume_selection: false, extraction_status: ready.has(body.resume_id) ? 'ready' : failed.has(body.resume_id) ? 'failed' : 'not_extracted', fingerprint: 'selected'};
    if (body.values) profile = {...profile, values: {...profile.values, ...body.values},
      sources: {...profile.sources, ...Object.fromEntries(Object.keys(body.values).map(key => [key, {source: 'manual', quote: null, resume_id: null}]))}, fingerprint: 'manual'};
    return route.fulfill({json: profile});
  });
  await page.route('**/profile/resumes/*/autofill', async route => {
    const id = route.request().url().match(/\/resumes\/([^/]+)\/autofill$/)[1], selected = profile.resumes.find(item => item.id === id);
    reads.push({id, body: route.request().postDataJSON()}); if (hold) await new Promise(done => { release = done; });
    if (fail) { failed.add(id); profile = {...profile, resume: selected, extraction_status: 'failed', fingerprint: 'failed'}; }
    else { ready.add(id); profile = {...profile, resume: selected, values: {...profile.values, school: 'National University of Singapore', given_name: 'Fictional'},
      sources: {...profile.sources, school: {source: 'resume', quote: 'National University of Singapore', resume_id: id},
        given_name: {source: 'resume', quote: 'Fictional Applicant', resume_id: id}}, extraction_status: 'ready', missing_fields: ['current_city'], fingerprint: 'after'}; }
    return route.fulfill({json: {resume_id: id, sha256: resume.sha256, prompt_version: 'fixture-only', status: fail ? 'failed' : 'ready', reused: false, facts: {}, error_code: fail ? 'fixture_failed' : null}});
  });
  await page.goto(base + '/profile'); return {reads, patches, uploads, warms, release: () => release()};
}

test('one upload prepares the PDF once and blocks a second selection while pending', async ({page}) => {
  const f = await setup(page, {empty: true, hold: true});
  const input = page.getByLabel('Upload and analyze PDF with AI (up to 2 MiB)', {exact: true});
  await expect(input).toBeEnabled(); expect(f.reads).toHaveLength(0);
  await input.setInputFiles({name: uploaded.filename, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfictional UI fixture')});
  await expect.poll(() => f.reads.length).toBe(1); await expect(input).toBeDisabled(); expect(f.uploads).toEqual(['POST']);
  expect(f.reads[0]).toEqual({id: uploaded.id, body: {confirmed: true}}); f.release();
  await expect(page.getByRole('status').filter({hasText: 'PDF ready for applications'})).toBeVisible();
  await expect(page.locator('.autofill-facts-ready')).toContainText('PDF ready');
  await expect(page.getByRole('button', {name: 'Use this PDF', exact: true})).toHaveCount(0); expect(f.patches).toHaveLength(0); expect(f.reads).toHaveLength(1);
  await page.getByRole('button', {name: 'Refresh saved answers', exact: true}).click();
  await page.reload(); await expect(page.locator('.autofill-facts-ready')).toContainText('PDF ready'); expect(f.reads).toHaveLength(1);
  expect(f.warms).toEqual([]);
});

test('legacy unread PDF has one intentional use action and no paid page-mount call', async ({page}) => {
  const f = await setup(page);
  await expect(page.getByRole('button', {name: 'Use this PDF', exact: true})).toBeEnabled(); expect(f.reads).toHaveLength(0);
  await expect(page.locator('#saved-profile-details')).not.toHaveAttribute('open');
  await expect(page.locator('.resume-library input[type=checkbox], .autofill-facts input[type=checkbox]')).toHaveCount(0);
  await page.getByRole('button', {name: 'Use this PDF', exact: true}).click();
  await expect(page.locator('.autofill-facts-ready')).toContainText('PDF ready'); expect(f.reads).toHaveLength(1);
  await page.getByText('See saved answers and PDF evidence', {exact: true}).click();
  await expect(page.locator('.autofill-facts-list')).toContainText('Saved Profile Name');
  await expect(page.locator('.autofill-facts-list blockquote').first()).toBeVisible();
});

test('intentional unread selection prepares once and manual supplementation patches only its field', async ({page}) => {
  const f = await setup(page, {multiple: true});
  expect(f.reads).toHaveLength(0); await expect(page.getByRole('button', {name: 'Use this PDF', exact: true})).toHaveCount(0);
  await page.getByLabel('Resume for autofill', {exact: true}).selectOption(resume.id);
  await expect(page.locator('.autofill-facts-ready')).toContainText('PDF ready'); expect(f.patches).toEqual([{resume_id: resume.id}]); expect(f.reads).toHaveLength(1);
  await page.getByText('Add a missing detail or correct an answer', {exact: true}).click();
  await page.getByLabel('Detail', {exact: true}).selectOption('current_city'); await page.getByLabel('Current city', {exact: true}).fill('Singapore');
  await page.getByRole('button', {name: 'Save this detail', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: 'Detail saved'})).toBeVisible(); expect(f.patches[1]).toEqual({values: {current_city: 'Singapore'}}); expect(f.reads).toHaveLength(1);
});

test('choosing an already-ready PDF reuses its facts without another analysis POST', async ({page}) => {
  const f = await setup(page, {multiple: true, cached: true});
  await page.getByLabel('Resume for autofill', {exact: true}).selectOption(resume.id);
  await expect(page.locator('.autofill-facts-ready')).toContainText('PDF ready'); await expect(page.getByRole('button', {name: 'Use this PDF', exact: true})).toHaveCount(0); expect(f.reads).toHaveLength(0);
  await page.reload(); await expect(page.locator('.autofill-facts-ready')).toContainText('PDF ready'); expect(f.reads).toHaveLength(0);
  expect(f.warms).toEqual([]);
});

test('failed preparation retains the PDF and offers manual details without automatic retry', async ({page}) => {
  const f = await setup(page, {multiple: true, fail: true});
  await page.getByLabel('Resume for autofill', {exact: true}).selectOption(resume.id);
  await expect(page.getByRole('alert').filter({hasText: 'Your PDF is saved'})).toBeVisible(); expect(f.reads).toHaveLength(1);
  await expect(page.getByRole('button', {name: 'Use this PDF', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: 'Refresh saved answers', exact: true}).click();
  await page.reload(); await expect(page.getByRole('alert').filter({hasText: 'Your PDF is saved'})).toBeVisible(); expect(f.reads).toHaveLength(1);
});
