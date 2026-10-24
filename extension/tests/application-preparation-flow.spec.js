import {test, expect} from '@playwright/test';
const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL for isolated profile/PDF preparation and channel checks.');
const jobId = '44444444-5555-4666-8777-888888888888';
const pdfId = '55555555-6666-4777-8888-999999999999';
const token = 'fixture-preparation-account';
const profile = {full_name: 'Fictional Saved Applicant', contact_email: 'fixture@example.test', phone: '',
  education: 'Fixture degree', experience: 'Fixture project', skills: ['Python'], resume_summary: 'User-written introduction.',
  availability_period: 'January to June 2027', nationality: null, study_country: null};
const pdf = {id: pdfId, filename: 'fixture-resume.pdf', size_bytes: 12345, uploaded_at: '2026-10-24T04:00:00Z',
  has_file: true, content_type: 'application/pdf', sha256: 'a'.repeat(64), extraction_status: 'parsed', page_count: 1};

async function setup(page, {channel = 'external', files = [pdf], connection, userId = 'fixture-user', path = 'prepare'} = {}) {
  const calls = {writes: [], messages: [], users: 0};
  await page.addInitScript(({token, connection}) => {
    localStorage.setItem('jobpilot_token', token);
    if (connection) {
      localStorage.setItem('jobpilot_extension_id', 'a'.repeat(32));
      window.fixtureExtensionMessages = [];
      window.chrome = {runtime: {sendMessage: (_id, message, callback) => {
        window.fixtureExtensionMessages.push(message);
        callback({ok: true, version: 1, platform_origin: location.origin, api_origin: 'http://127.0.0.1:8001',
          expires_at: Date.now() / 1000 + 300, ...connection});
      }}};
    }
  }, {token, connection});
  await page.route('**/profile', route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: profile}));
  await page.route('**/users/me', route => { calls.users++; return route.fulfill({json: {id: userId, role: 'user'}}); });
  await page.route('**/profile/resumes', route => route.fulfill({json: files}));
  await page.route(`**/jobs/${jobId}`, route => route.request().resourceType() === 'document' ? route.continue() : route.fulfill({json: {
    id: jobId, title: 'Fictional actual-flow fixture', company: 'Fixture employer', status: 'active', city: 'Singapore',
    job_type: 'internship', deadline: null, salary_min: null, salary_max: null, source: {name: 'Fixture'}, tags: [],
    description: 'Readable fixture job description.', apply_url: 'https://employer.example.test/apply', source_url: null,
  }}));
  await page.route(`**/jobs/${jobId}/ai-assessment`, route => route.fulfill({json: {job_id: jobId, status: 'not_analyzed', assessment: null, advice: null}}));
  await page.route(`**/jobs/${jobId}/application-context`, route => route.fulfill({json: {
    job: {id: jobId, title: 'Fictional actual-flow fixture', company: 'Fixture employer', status: 'active', source_url: null},
    profile, channel, channel_label: 'Fixture channel', instructions: [], preparation_url: null,
    original_application_url: 'https://employer.example.test/apply', email_option: channel === 'email' ? {available: true, mode: 'test_smtp'} : null,
  }}));
  await page.route(`**/jobs/${jobId}/email-application-option`, route => route.fulfill({json: {available: true, mode: 'test_smtp', actual_recipient: 'fixture-inbox@example.test'}}));
  await page.route(`**/jobs/${jobId}/applications`, route => { calls.writes.push(route.request().postDataJSON()); return route.fulfill({status: 201, json: {id: 'fixture-draft'}}); });
  await page.goto(`${base}/jobs/${jobId}${path === 'prepare' ? '/prepare' : ''}`);
  return calls;
}

test('saved profile and the only saved PDF are reused without asking for a new upload', async ({page}) => {
  const calls = await setup(page);
  await expect(page.getByRole('heading', {name: 'Your saved details'})).toBeVisible();
  const details = page.getByRole('region', {name: 'Your saved details'});
  await expect(details).toContainText(profile.full_name);
  await details.getByText('Review saved profile', {exact: true}).click();
  await expect(details).toContainText(profile.availability_period);
  await expect(details).toContainText('Not saved: Phone.');
  await expect(page.getByLabel('Resume PDF for this application')).toHaveValue(pdfId);
  await expect(page.locator('.prepare-pdf-summary')).toContainText(`Saved PDF: ${pdf.filename}`);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole('region', {name: 'Continue with this application'})).toContainText('Upload your PDF and complete final submission on the original form.');
  expect(calls.writes).toEqual([]);
});

test('same-name and same-size saved PDFs are distinguishable and still require an explicit choice', async ({page}) => {
  const secondId = '66666666-7777-4888-8999-000000000000';
  await setup(page, {files: [pdf, {...pdf, id: secondId, uploaded_at: '2026-10-24T04:02:00Z'}]});
  await expect(page.getByLabel('Resume PDF for this application')).toHaveValue('');
  const firstLabel = await page.locator(`#application-resume option[value="${pdfId}"]`).textContent();
  const secondLabel = await page.locator(`#application-resume option[value="${secondId}"]`).textContent();
  expect(firstLabel).toContain('55555555');
  expect(secondLabel).toContain('66666666');
  expect(firstLabel).not.toBe(secondLabel);
  expect(firstLabel).toContain('2026');
  expect(secondLabel).toContain('2026');
  await page.getByLabel('Resume PDF for this application').selectOption(pdfId);
  await expect(page.locator('.prepare-pdf-summary')).toContainText(pdf.filename);
});

test('opening an employer page is only preparation, never a submitted status', async ({page}) => {
  const calls = await setup(page);
  await page.route('https://employer.example.test/apply', route => route.fulfill({contentType: 'text/html', body: '<h1>Fixture employer form</h1>'}));
  await expect(page.getByRole('button', {name: 'Continue on employer site', exact: true})).toBeDisabled();
  await page.getByRole('checkbox', {name: 'I have reviewed my saved details and PDF selection.'}).check();
  await page.getByRole('button', {name: 'Continue on employer site', exact: true}).click();
  await expect(page).toHaveURL('https://employer.example.test/apply');
  await expect(page.getByRole('heading', {name: 'Fixture employer form'})).toBeVisible();
  expect(calls.writes).toEqual([{status: 'draft'}]);
});

test('a failed preparation save keeps the selected PDF and allows a deliberate retry', async ({page}) => {
  await setup(page);
  let attempts = 0;
  await page.route(`**/jobs/${jobId}/applications`, route => {
    attempts++;
    return route.fulfill({status: 503, json: {detail: 'Fixture unavailable'}});
  });
  await page.getByRole('checkbox', {name: 'I have reviewed my saved details and PDF selection.'}).check();
  await page.getByRole('button', {name: 'Continue on employer site', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Could not save a preparation record.');
  await expect(page.getByLabel('Resume PDF for this application')).toHaveValue(pdfId);
  await expect(page).toHaveURL(`${base}/jobs/${jobId}/prepare`);
  expect(attempts).toBe(1);
  await expect(page.getByRole('button', {name: 'Continue on employer site', exact: true})).toBeEnabled();
});

test('detail exposes the manual application channel before the job description', async ({page}) => {
  await setup(page, {path: 'detail'});
  await expect(page.getByRole('region', {name: 'Application channel'})).toContainText('Employer site · manual application');
  expect(await page.locator('.application-channel-info').evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('.job-description')) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

for (const [connection, text] of [
  [{connected: false}, 'Extension not connected.'],
  [{connected: true, user_id: 'another-account'}, 'connected to a different account'],
  [{connected: true, user_id: 'fixture-user', api_origin: 'https://different-api.example.test'}, 'another JobPilot address'],
  [{connected: true, user_id: 'fixture-user', expires_at: 1}, 'Extension not connected.'],
]) test(`a remembered extension ID cannot claim ready: ${text}`, async ({page}) => {
  await setup(page, {channel: 'ats', connection});
  await expect(page.locator('.application-extension-status')).toContainText(text);
  const messages = await page.evaluate(() => window.fixtureExtensionMessages);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.every(message => message.kind === 'connection-status' && message.version === 1)).toBe(true);
});

test('a verified connection is metadata only and does not inspect or fill a form', async ({page}) => {
  await setup(page, {channel: 'ats', connection: {connected: true, user_id: 'fixture-user'}});
  await expect(page.locator('.application-extension-status')).toContainText('Extension connected to this account.');
  await expect(page.locator('.application-extension-status')).toContainText('Each form still needs a separate field review.');
  const messages = await page.evaluate(() => window.fixtureExtensionMessages);
  expect(messages.every(message => message.kind === 'connection-status')).toBe(true);
  expect(JSON.stringify(messages)).not.toContain(token);
  expect(JSON.stringify(messages)).not.toContain(profile.full_name);
});

test('email application capability is labelled test-only before any send action', async ({page}) => {
  const calls = await setup(page, {channel: 'email'});
  await expect(page.getByRole('region', {name: 'Application channel'})).toContainText('Email test pilot · test mailbox only');
  await expect(page.getByRole('region', {name: 'Application channel'})).toContainText('does not deliver an application to the employer');
  expect(calls.writes).toEqual([]);
});
