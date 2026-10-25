import test from 'node:test';
import assert from 'node:assert/strict';
import {preparationFields, preparationPatch, unfinishedPreparationPatch, checkedPreparation, requestPreparation} from '../popup-preparation.js';

const field = (id = 'intro', rest = {}) => ({id, label: 'Introduce yourself', kind: 'text', maxLength: 500, available: true, occupied: false, draftable: true, ...rest});
const editor = (rest = {}) => ({field: field(), input: {value: ''}, edited: false, ...rest});
const citation = {source: 'profile', source_id: 'profile:experience', quote: 'Built a small Python service.'};
const answer = (rest = {}) => ({field_id: 'intro', source: 'ai_draft', fact_key: null, value: 'I built a small Python service.', citations: [citation], ...rest});
const profile = {values: {given_name: 'Avery', school: 'NUS'}, fingerprint: 'fp'};

test('one bounded request carries only empty ordinary questions, never saved answers or private source text', () => {
  const items = new Map([['intro', editor()], ['filled', editor({field: field('filled'), input: {value: 'User answer'}})],
    ['consent', editor({field: field('consent', {manualOnly: true})})], ['occupied', editor({field: field('occupied', {occupied: true})})]]);
  assert.deepEqual(preparationFields(items), [{id: 'intro', label: 'Introduce yourself', kind: 'text', maxLength: 500, manualOnly: false, draftable: true,
    searchable: false, optionsPending: false}]);
});

test('cited AI answers support current ordinary text without a narrative whitelist; formats and manual fields stay guarded', () => {
  assert.equal(preparationPatch(answer(), editor(), profile).source, 'ai_draft');
  assert.equal(preparationPatch(answer(), editor({field: field('intro', {draftable: false})}), profile).source, 'ai_draft');
  for (const descriptor of [field('intro', {manualOnly: true}), field('intro', {kind: 'number'}), field('intro', {kind: 'date'}), field('intro', {kind: 'select'})]) assert.equal(preparationPatch(answer(), editor({field: descriptor}), profile), null);
  assert.equal(preparationPatch(answer({value: '3.8', citations: [{...citation, quote: 'GPA: 3.8'}]}), editor({field: field('intro', {kind: 'number'})}), profile).value, '3.8');
  assert.equal(preparationPatch(answer({citations: []}), editor(), profile), null);
  assert.equal(preparationPatch(answer({value: 'x'.repeat(501)}), editor(), profile), null);
});

test('user edits, cleared edits, existing values, occupied website fields and dispatched Fill are never overwritten', () => {
  for (const e of [editor({edited: true}), editor({input: {value: 'My edit'}}), editor({blocked: true}), editor({field: field('intro', {occupied: true})})]) assert.equal(preparationPatch(answer(), e, profile), null);
});

test('cited native choices use one exact observed option value, never a label or invented option', () => {
  const descriptor = field('school', {label: 'School', kind: 'select', options: [{value: 'opaque-17', label: 'Northern Institute'}]});
  const target = editor({field: descriptor});
  const candidate = answer({field_id: 'school', value: 'opaque-17', citations: [{...citation, quote: 'Northern Institute — M.Tech.'}]});
  assert.equal(preparationPatch(candidate, target, profile).value, 'opaque-17');
  for (const value of ['Northern Institute', 'invented', 'To be confirmed']) assert.equal(preparationPatch({...candidate, value}, target, profile), null);
  assert.equal(preparationPatch({...candidate, citations: []}, target, profile), null);
  assert.equal(preparationPatch({...candidate, citations: [{...citation, source: 'job'}]}, target, profile), null);
  assert.equal(preparationPatch({...candidate, source: 'pending_confirmation', value: 'To be confirmed'}, target, profile), null);
  for (const options of [[...descriptor.options, {value: 'other', label: 'Northern Institute'}],
    [...descriptor.options, {value: 'opaque-17', label: 'Other institution'}]]) {
    assert.equal(preparationPatch(candidate, editor({field: {...descriptor, options}}), profile), null);
  }
});

test('searchable choices accept a cited literal query and still do not claim the website selected it', () => {
  const descriptor = field('school', {label: 'School', kind: 'combobox', searchable: true, optionsPending: true, options: []});
  const candidate = answer({field_id: 'school', value: 'Northern Institute', citations: [{...citation, quote: 'Northern Institute — M.Tech.'}]});
  assert.deepEqual(preparationPatch(candidate, editor({field: descriptor}), profile), {value: candidate.value, factKey: null, source: 'ai_draft', citations: candidate.citations});
  assert.equal(preparationPatch({...candidate, value: 'Unstated Institute'}, editor({field: descriptor}), profile), null);
  for (const changes of [{searchable: false}, {kind: 'select'}, {manualOnly: true}, {occupied: true}]) {
    assert.equal(preparationPatch(candidate, editor({field: {...descriptor, ...changes}}), profile), null);
  }
  const observed = {...descriptor, options: [{value: 'opaque-17', label: 'Northern Institute'}]};
  assert.equal(preparationPatch(candidate, editor({field: observed}), profile).value, 'Northern Institute');
  assert.equal(preparationPatch({...candidate, value: 'opaque-17'}, editor({field: observed}), profile), null);
  for (const changes of [{edited: true}, {edited: true, input: {value: ''}}, {input: {value: 'My choice'}}, {blocked: true}]) {
    assert.equal(preparationPatch(candidate, editor({field: descriptor, ...changes}), profile), null);
  }
});

test('choice metadata reaches one bounded question batch and truncation is explicitly pending', () => {
  const options = Array.from({length: 101}, (_, index) => ({value: String(index), label: `School ${index}`}));
  const descriptor = field('school', {label: 'School', kind: 'combobox', searchable: true, optionsPending: false, options});
  const [request] = preparationFields(new Map([['school', editor({field: descriptor})]]));
  assert.equal(request.searchable, true); assert.equal(request.optionsPending, true);
  assert.equal(request.options.length, 100); assert.equal(request.options[0].label, 'School 0');
  assert.equal(Object.hasOwn(request, 'profile'), false);
});

test('AI choices never answer qualification or consent questions or overwrite saved exact facts', () => {
  for (const label of ['Visa status', 'Privacy consent', 'Work authorization', 'Can you work in Singapore?']) {
    const descriptor = field('choice', {label, kind: 'select', options: [{value: 'option', label: 'Qualified'}]});
    assert.equal(preparationPatch(answer({field_id: 'choice', value: 'option'}), editor({field: descriptor}), profile), null);
  }
  const yesNo = field('choice', {label: 'An eligibility choice', kind: 'select', options: [{value: 'y', label: 'Yes'}, {value: 'n', label: 'No'}]});
  assert.equal(preparationPatch(answer({field_id: 'choice', value: 'y'}), editor({field: yesNo}), profile), null);
  const degree = field('degree', {label: 'Degree', kind: 'select', evidenceKey: 'degree', options: [{value: 'master', label: "Master's Degree"}]});
  const saved = {values: {degree: 'M.Tech.'}};
  assert.equal(preparationPatch(answer({field_id: 'degree', value: 'master', source: 'saved', fact_key: 'degree'}), editor({field: degree}), saved).source, 'saved');
  assert.equal(preparationPatch(answer({field_id: 'degree', value: 'master'}), editor({field: degree, input: {value: 'My existing choice'}}), saved), null);
});

test('untouched text templates still reach mapping and drafting and can be replaced only by grounded answers', () => {
  const e = editor({source: 'template', templateValue: 'Your brief introduction', input: {value: 'Your brief introduction'}});
  assert.equal(preparationFields(new Map([['intro', e]])).length, 1);
  assert.equal(preparationPatch(answer(), e, profile).source, 'ai_draft');
  assert.equal(preparationPatch(answer({source: 'pending_confirmation', value: 'To be confirmed', citations: []}), e, profile).source, 'pending_confirmation');
  for (const changed of [{edited: true}, {input: {value: 'My own answer'}}, {edited: true, input: {value: ''}}, {source: 'saved'}, {source: 'ai_draft'}]) {
    assert.equal(preparationPatch(answer(), {...e, ...changed}, profile), null);
    assert.equal(preparationFields(new Map([['intro', {...e, ...changed}]])).length, 0);
  }
  const school = editor({field: field('school_question', {label: 'Institution attended', draftable: false, evidenceKey: null, needsMapping: true}), source: 'template',
    templateValue: 'Your institution attended', input: {value: 'Your institution attended'}});
  assert.equal(preparationFields(new Map([['school_question', school]])).length, 1);
  assert.equal(preparationPatch(answer({field_id: 'school_question', source: 'saved', fact_key: 'school', value: 'NUS'}), school, profile).value, 'NUS');
  const known = {...school, field: {...school.field, evidenceKey: 'current_company', needsMapping: false}};
  assert.equal(preparationFields(new Map([['company', known]])).length, 1, 'Known-key missing values still need the current question checked against the PDF');
});

test('unfinished preparation is visibly distinct from model-confirmed missing evidence and never invents a typed value', () => {
  const e = editor({field: field('current_company', {label: 'Current company', draftable: false})});
  assert.deepEqual(unfinishedPreparationPatch(e, profile), {value: 'Your current company', factKey: null, source: 'unfinished'});
  for (const descriptor of [field('date', {kind: 'date'}), field('number', {kind: 'number'}), field('legal', {manualOnly: true})]) {
    assert.equal(unfinishedPreparationPatch(editor({field: descriptor}), profile), null);
  }
  for (const changes of [{edited: true}, {edited: true, input: {value: ''}}, {input: {value: 'My own answer'}}, {blocked: true}]) assert.equal(unfinishedPreparationPatch({...e, ...changes}, profile), null);
});

test('missing GPA and year in ordinary text boxes get explicit pending text without inventing values or filling typed controls', () => {
  for (const label of ['GPA', 'Year of study', 'Graduation year', 'Start date']) {
    const target = editor({field: field('question', {label, kind: 'text', draftable: false})});
    const missing = answer({field_id: 'question', source: 'pending_confirmation', value: 'To be confirmed', citations: []});
    assert.deepEqual(preparationPatch(missing, target, profile), {value: 'To be confirmed', factKey: null, source: 'pending_confirmation', citations: []});
    assert.deepEqual(unfinishedPreparationPatch(target, profile), {value: 'To be confirmed', factKey: null, source: 'unfinished'});
    for (const kind of ['number', 'date', 'select', 'combobox']) {
      const typed = {...target, field: {...target.field, kind}};
      assert.equal(preparationPatch(missing, typed, profile), null);
      assert.equal(unfinishedPreparationPatch(typed, profile), null);
    }
  }
  for (const label of ['Work authorization', 'Privacy consent', 'Employment status', 'Do you need sponsorship?']) {
    const target = editor({field: field('question', {label, kind: 'text', draftable: false})});
    assert.equal(preparationPatch(answer({field_id: 'question', source: 'pending_confirmation', value: 'To be confirmed', citations: []}), target, profile), null);
    assert.equal(unfinishedPreparationPatch(target, profile), null);
  }
});

test('saved facts must reproduce the current exact projection and pending text cannot invent an answer', () => {
  const e = editor({field: field('first', {evidenceKey: 'given_name', draftable: false})});
  assert.equal(preparationPatch(answer({field_id: 'first', source: 'saved', fact_key: 'given_name', value: 'Avery'}), e, profile).value, 'Avery');
  assert.equal(preparationPatch(answer({field_id: 'first', source: 'saved', fact_key: 'given_name', value: 'Invented'}), e, profile), null);
  assert.equal(preparationPatch(answer({source: 'pending_confirmation', value: 'To be confirmed', citations: []}), editor(), profile).source, 'pending_confirmation');
  assert.equal(preparationPatch(answer({source: 'pending_confirmation', value: 'Yes', citations: []}), editor(), profile), null);
});

test('cached results remain bound to the fingerprint and exact unique request IDs', () => {
  const response = {profile_fingerprint: 'fp', status: 'ready', execution_mode: 'live', reused: true, answers: [answer()], omitted: []};
  assert.equal(checkedPreparation(response, 'fp', [field()]).reused, true);
  assert.throws(() => checkedPreparation(response, 'different', [field()]));
  assert.throws(() => checkedPreparation({...response, answers: [answer({field_id: 'other'})]}, 'fp', [field()]));
  assert.throws(() => checkedPreparation({...response, answers: [answer(), answer()]}, 'fp', [field(), field('two')]));
  assert.equal(checkedPreparation({...response, analyzed_field_ids: ['intro']}, 'fp', [field()]).analyzed_field_ids.length, 1);
  for (const analyzed_field_ids of [['other'], ['intro', 'intro'], null]) assert.throws(() => checkedPreparation({...response, analyzed_field_ids}, 'fp', [field()]));
});

test('a concurrent preparation uses only bounded cache-only reads after its first request', async () => {
  const calls = [];
  const result = await requestPreparation(async cacheOnly => { calls.push(cacheOnly); return {status: calls.length === 1 ? 'preparing' : 'ready', reused: true}; }, 1500);
  assert.equal(result.status, 'ready'); assert.deepEqual(calls, [false, true]);
});

test('timeout is bounded, aborts work and never retries the model-starting request', async () => {
  let calls = 0, signal;
  await assert.rejects(requestPreparation(async (cacheOnly, requestSignal) => { calls++; assert.equal(cacheOnly, false); signal = requestSignal; return new Promise(() => {}); }, 15), /timed out/);
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
