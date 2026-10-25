import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {JobAnalysisCoordinator} from '../../frontend/src/services/jobAnalysisCoordinator.ts';
import {applicationRecommendation, applicationVerdictLabels} from '../../frontend/src/services/jobFit.ts';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const digest = async value => createHash('sha256').update(value).digest('hex');
function fixture(start) {
  const markers = new Map(), calls = [];
  const dependencies = {digest, readMarker: key => markers.get(key) ?? null, writeMarker: key => markers.set(key, 'started'),
    start: async (token, jobId, signal) => { calls.push({token, jobId, signal}); return start ? start(signal) : {status: 'succeeded'}; }};
  return {markers, calls, dependencies, coordinator: new JobAnalysisCoordinator(dependencies)};
}

test('StrictMode, concurrent mounts and remounts share exactly one request for the same account/job/context', async () => {
  const gate = deferred(), f = fixture(() => gate.promise);
  const first = f.coordinator.ensure('private-token-a', 'job-a', 'context-a');
  const second = f.coordinator.ensure('private-token-a', 'job-a', 'context-a');
  assert.equal(first, second);
  await new Promise(setImmediate); assert.equal(f.calls.length, 1);
  gate.resolve({status: 'succeeded'}); assert.equal((await first).status, 'confirmed');
  await f.coordinator.ensure('private-token-a', 'job-a', 'context-a'); assert.equal(f.calls.length, 1);
  const reloaded = new JobAnalysisCoordinator(f.dependencies);
  assert.equal((await reloaded.ensure('private-token-a', 'job-a', 'context-a')).status, 'already_started');
  assert.equal(f.calls.length, 1);
  for (const [key, value] of f.markers) { assert.match(key, /^jobpilot:job-fit:[a-f0-9]{64}$/); assert.equal(value, 'started'); assert.doesNotMatch(key, /private-token|job-a|context-a/); }
});

test('an uncertain or failed request is never automatically retried, including after reload', async () => {
  for (const failure of ['uncertain', 'failed']) {
    const f = fixture(() => { if (failure === 'uncertain') throw new Error('Response lost after request'); return {status: 'failed'}; });
    assert.equal((await f.coordinator.ensure('a', 'job', 'context')).status, failure);
    await f.coordinator.ensure('a', 'job', 'context');
    await new JobAnalysisCoordinator(f.dependencies).ensure('a', 'job', 'context');
    assert.equal(f.calls.length, 1);
  }
});

test('a failed or unavailable saved state blocks a later same-context start without having made a new model request', async () => {
  const f = fixture();
  f.coordinator.rememberUnavailable('a', 'job', 'context');
  assert.equal((await f.coordinator.ensure('a', 'job', 'context')).status, 'failed');
  assert.equal((await new JobAnalysisCoordinator(f.dependencies).ensure('a', 'job', 'context')).status, 'already_started');
  assert.equal(f.calls.length, 0);
  await f.coordinator.ensure('a', 'job', 'changed-context'); assert.equal(f.calls.length, 1);
});

test('a changed profile/JD context or a different job gets its own single analysis', async () => {
  const f = fixture();
  await f.coordinator.ensure('a', 'job', 'old-profile-and-jd');
  await f.coordinator.ensure('a', 'job', 'new-profile-and-jd');
  await f.coordinator.ensure('a', 'different-job', 'new-profile-and-jd');
  assert.equal(f.calls.length, 3);
});

test('account replacement aborts the old request and keeps new-account analysis independent', async () => {
  const f = fixture(signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), {once: true})));
  const old = f.coordinator.ensure('old-token', 'job', 'context');
  await new Promise(setImmediate); f.coordinator.cancelOtherSessions('new-token');
  assert.equal((await old).status, 'cancelled'); assert.equal(f.calls[0].signal.aborted, true);
  const next = new JobAnalysisCoordinator({...f.dependencies, start: async () => ({status: 'succeeded'})});
  assert.equal((await next.ensure('new-token', 'job', 'context')).status, 'confirmed');
});

test('a start marker must be written before a model request; storage failure starts nothing', async () => {
  const f = fixture();
  const coordinator = new JobAnalysisCoordinator({...f.dependencies, writeMarker: () => { throw new Error('Storage unavailable'); }});
  assert.equal((await coordinator.ensure('a', 'job', 'context')).status, 'uncertain');
  assert.equal(f.calls.length, 0);
});

test('only the supplied product recommendation determines the verdict, summary and useful points', () => {
  const application_recommendation = {verdict: 'consider', summary: 'Your Python projects are relevant; confirm C++ and the dates.',
    strengths: ['Python project experience'], considerations: ['C++ experience and the internship dates need confirmation.']};
  const advice = {status: 'not_priority', headline: 'Legacy headline must not be displayed', reasons: ['Legacy reason'],
    counts: {supported: 0, gap: 0, unknown: 8}, application_recommendation};
  assert.deepEqual(applicationRecommendation(advice), application_recommendation);
  assert.equal(Object.hasOwn(applicationRecommendation(advice), 'counts'), false);
  assert.doesNotMatch(JSON.stringify(applicationRecommendation(advice)), /Legacy|Insufficient evidence|0 supported|0%/);
});

test('all four server verdicts remain distinct without client count or legacy-state mapping', () => {
  for (const verdict of ['priority_apply', 'consider', 'not_priority', 'insufficient_information']) {
    const advice = {status: 'check_first', counts: {supported: 0, gap: 0, unknown: 99},
      application_recommendation: {verdict, summary: 'Server conclusion.', strengths: [], considerations: []}};
    assert.equal(applicationRecommendation(advice).verdict, verdict);
    assert.ok(applicationVerdictLabels[verdict]);
  }
  for (const [verdict, label] of Object.entries(applicationVerdictLabels)) {
    const product = {verdict, summary: `${label.toUpperCase()}! Role focus: software development.`, strengths: [], considerations: []};
    const result = applicationRecommendation({application_recommendation: product});
    assert.equal(result.summary, 'Role focus: software development.');
    assert.equal(product.summary, `${label.toUpperCase()}! Role focus: software development.`);
    assert.equal(result.verdict, verdict);
  }
  const product = {verdict: 'consider', summary: 'Worth considering. Role focus: software development.', strengths: [], considerations: []};
  assert.equal(applicationRecommendation({application_recommendation: product}).summary, 'Role focus: software development.');
  for (const summary of ['Worth considering for its project work.', 'Not a priority. Role focus: HR.', 'This role is worth considering.']) {
    assert.equal(applicationRecommendation({application_recommendation: {...product, summary}}).summary, summary);
  }
});

test('groups retain at most three unique nonempty server points; zero strengths is a valid result', () => {
  const result = applicationRecommendation({application_recommendation: {verdict: 'not_priority', summary: '  Another role may suit you better.  ',
    strengths: [], considerations: [' Degree focus ', '', 'Degree focus', 'Relevant experience', 'Work schedule', 'Fourth point']}});
  assert.equal(result.summary, 'Another role may suit you better.');
  assert.deepEqual(result.strengths, []);
  assert.deepEqual(result.considerations, ['Degree focus', 'Relevant experience', 'Work schedule']);
});

test('a legacy, null or incomplete product recommendation has no invented fallback verdict', () => {
  for (const advice of [null, {status: 'priority_apply', headline: 'Legacy title', counts: {supported: 8, gap: 0, unknown: 0}},
    {application_recommendation: null}, {application_recommendation: {verdict: 'consider', summary: '  ', strengths: [], considerations: []}},
    {application_recommendation: {verdict: 'check_first', summary: 'Legacy status', strengths: [], considerations: []}}]) {
    assert.equal(applicationRecommendation(advice), null);
  }
});
