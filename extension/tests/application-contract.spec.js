import {test, expect} from '@playwright/test';

const base = process.env.FRONTEND_BASE_URL;
test.skip(!base, 'Set FRONTEND_BASE_URL to exercise the frontend contract validators.');

test('draft parsing rejects incompatible, oversized and malformed saved details', async ({page}) => {
  await page.goto(base);
  const results = await page.evaluate(async () => {
    const {parseSavedDraft} = await import('/src/services/applicationPreparation.ts');
    const valid = {values: {}, countries: {}, profile_source: 'jobpilot', summary_status: 'manual_only',
      requires_review: true, submission_supported: false};
    const invalid = [null, {}, {...valid, requires_review: false}, {...valid, submission_supported: true},
      {...valid, summary_status: 'generated'}, {...valid, values: {applicant_name: 123}},
      {...valid, values: {applicant_summary: 'x'.repeat(3001)}}, {...valid, countries: {nationality: 'javascript:'}}];
    return {empty: parseSavedDraft(valid), rejected: invalid.map(value => {
      try { parseSavedDraft(value); return false; } catch { return true; }
    })};
  });
  expect(results.rejected.every(Boolean)).toBe(true);
  expect(Object.values(results.empty.values).every(value => value === '')).toBe(true);
  expect(results.empty.countries).toEqual({nationality: '', campus: ''});
});

test('review parsing rejects expired, duplicate, unknown and oversized metadata', async ({page}) => {
  await page.goto(base);
  const results = await page.evaluate(async () => {
    const {parseApplicationReview} = await import('/src/services/applicationPreparation.ts');
    const field = {id: 'applicant_name', maxLength: 200, occupied: false};
    const valid = {version: 1, review_id: '12345678-1234-1234-1234-123456789012',
      expires_at: Date.now() + 300000, fields: [field], countries: [{code: 'sg', name: 'Singapore'}], countries_available: true};
    const invalid = [{...valid, version: 0}, {...valid, expires_at: Date.now() - 1}, {...valid, expires_at: Date.now() + 3600000},
      {...valid, fields: [field, field]}, {...valid, fields: [{...field, id: 'submit'}]},
      {...valid, fields: [{...field, maxLength: 10000}]}, {...valid, fields: [{...field, occupied: 'false'}]},
      {...valid, countries: [valid.countries[0], valid.countries[0]]}];
    return {valid: parseApplicationReview(valid), rejected: invalid.map(value => {
      try { parseApplicationReview(value); return false; } catch { return true; }
    })};
  });
  expect(results.rejected.every(Boolean)).toBe(true);
  expect(results.valid.fields).toEqual([{id: 'applicant_name', maxLength: 200, occupied: false, unavailable: false}]);
});

test('fill reports must account for exactly the confirmed fields and never claim submission', async ({page}) => {
  await page.goto(base);
  const results = await page.evaluate(async () => {
    const {parseFillReport} = await import('/src/services/applicationPreparation.ts');
    const valid = {filled: ['applicant_name'], skipped: [], reasons: {}, submitted: false};
    const invalid = [{...valid, submitted: true}, {...valid, submitted: undefined},
      {...valid, filled: []}, {...valid, filled: ['applicant_email']},
      {...valid, skipped: ['applicant_name']}, {...valid, filled: ['submit']}];
    return {valid: parseFillReport(valid, ['applicant_name']), rejected: invalid.map(value => {
      try { parseFillReport(value, ['applicant_name']); return false; } catch { return true; }
    })};
  });
  expect(results.rejected.every(Boolean)).toBe(true);
  expect(results.valid).toEqual({filled: ['applicant_name'], skipped: [], reasons: {}});
});

test('SPA navigation does not alter the saved-profile fingerprint or let response metadata choose a target', async ({page}) => {
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const {parseSavedDraft, draftFingerprint, parseApplicationReview} = await import('/src/services/applicationPreparation.ts');
    const draft = parseSavedDraft({values: {applicant_name: 'Fictional Applicant'}, countries: {nationality: 'cn', campus: 'sg'},
      profile_source: 'jobpilot', summary_status: 'manual_only', requires_review: true, submission_supported: false});
    history.pushState({}, '', '/jobs');
    const before = await draftFingerprint(draft);
    history.pushState({}, '', '/jobs/12345678-1234-1234-1234-123456789012/apply-external');
    const after = await draftFingerprint(draft);
    const review = parseApplicationReview({version: 1, review_id: '12345678-1234-1234-1234-123456789012', expires_at: Date.now() + 300000,
      fields: [{id: 'applicant_name', maxLength: 200, occupied: false}], countries: [], countries_available: false,
      parentUrl: 'https://untrusted.example/jobs/other/apply-external', tabId: 999, documentId: 'untrusted-document'});
    return {before, after, review};
  });
  expect(result.before).toMatch(/^[a-f0-9]{64}$/);
  expect(result.after).toBe(result.before);
  expect(result.review).not.toHaveProperty('parentUrl');
  expect(result.review).not.toHaveProperty('tabId');
  expect(result.review).not.toHaveProperty('documentId');
});
