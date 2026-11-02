import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateValidationMetrics,
  clearValidationHistory,
  createValidationTestRecord,
  deleteValidationTest,
  emptyHumanAssessment,
  loadValidationHistory,
  predictValidationLabels,
  saveValidationTest,
} from '../src/lib/validation-lab.ts';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};

beforeEach(() => memory.clear());

function record(id, human, predicted, partition = 'ajuste') {
  const assessment = Object.fromEntries(
    Object.keys(emptyHumanAssessment()).map((key) => [key, human]),
  );
  const predictions = Object.fromEntries(
    Object.keys(emptyHumanAssessment()).map((key) => [key, predicted]),
  );
  return {
    id,
    fileName: `${id}.mp4`,
    category: 'adequado',
    partition,
    createdAt: new Date().toISOString(),
    assessment,
    observations: '',
    predictions,
    repetitions: 1,
    samples: 20,
    trackedSamples: 18,
    meanConfidence: 0.8,
    delegate: 'CPU',
    algorithmVersion: 'fitai-squat-v2',
  };
}

test('prediction leaves criteria unavailable when detector has no usable repetition', () => {
  const predictions = predictValidationLabels([]);
  assert.equal(predictions.completion, 'inadequado');
  assert.equal(predictions.depth, null);
  assert.equal(predictions.foot, null);
});

test('criterion prediction excludes non-assessable repetitions and resolves ties as unavailable', () => {
  const makeRep = (depth) => ({
    checklist: [
      { key: 'depth', status: depth },
      { key: 'trunk', status: 'OK' },
      { key: 'support', status: 'ATENÇÃO' },
      { key: 'descent', status: 'OK' },
      { key: 'rise', status: 'OK' },
    ],
  });
  assert.equal(predictValidationLabels([makeRep('OK'), makeRep('ATENÇÃO')]).depth, null);
  assert.equal(predictValidationLabels([makeRep('NÃO AVALIÁVEL'), makeRep('OK')]).depth, 'adequado');
});

test('does not display accuracy metrics before five comparable human labels', () => {
  const tests = Array.from({ length: 4 }, (_, index) => record(String(index), 'adequado', 'adequado'));
  const metric = calculateValidationMetrics(tests)[0];
  assert.equal(metric.observations, 4);
  assert.equal(metric.accuracy, null);
  assert.equal(metric.sensitivity, null);
});

test('computes exploratory confusion matrix metrics with inadequate as positive', () => {
  const tests = [
    record('tp-1', 'inadequado', 'inadequado'),
    record('fp', 'adequado', 'inadequado'),
    record('tn', 'adequado', 'adequado'),
    record('fn', 'inadequado', 'adequado'),
    record('tp-2', 'inadequado', 'inadequado'),
  ];
  const metric = calculateValidationMetrics(tests)[0];
  assert.equal(metric.observations, 5);
  assert.deepEqual(metric.confusion, { truePositive: 2, falsePositive: 1, trueNegative: 1, falseNegative: 1 });
  assert.equal(metric.accuracy, 0.6);
  assert.equal(metric.sensitivity, 2 / 3);
  assert.equal(metric.specificity, 0.5);
  assert.equal(metric.precision, 2 / 3);
  assert.equal(metric.f1, 2 / 3);
});

test('omits not-assessable labels and keeps adjustment and final sets separate', () => {
  const tests = [
    record('adjustment', 'adequado', 'adequado', 'ajuste'),
    record('final', 'inadequado', 'inadequado', 'avaliação-final'),
    record('not-evaluable', 'não avaliável', 'adequado', 'avaliação-final'),
  ];
  assert.equal(calculateValidationMetrics(tests, 'ajuste')[0].observations, 1);
  assert.equal(calculateValidationMetrics(tests, 'avaliação-final')[0].observations, 1);
});

test('persists only current-user metadata and supports deletion and clearing', () => {
  const one = record('one', 'adequado', 'adequado');
  const two = record('two', 'adequado', 'adequado');
  saveValidationTest(one, 'user-a');
  saveValidationTest(two, 'user-b');
  assert.equal(loadValidationHistory('user-a').length, 1);
  assert.equal(loadValidationHistory('user-b').length, 1);
  assert.equal(deleteValidationTest('one', 'user-a').length, 0);
  clearValidationHistory('user-b');
  assert.equal(loadValidationHistory('user-b').length, 0);
});

test('creates a local result with an algorithm version and no video bytes', () => {
  const result = createValidationTestRecord({
    fileName: 'squat.mp4',
    category: 'adequado',
    partition: 'ajuste',
    assessment: Object.fromEntries(Object.keys(emptyHumanAssessment()).map((key) => [key, 'adequado'])),
    observations: '',
    predictions: Object.fromEntries(Object.keys(emptyHumanAssessment()).map((key) => [key, null])),
    repetitions: 0,
    samples: 10,
    trackedSamples: 8,
    meanConfidence: null,
    delegate: 'CPU',
  });
  assert.match(result.algorithmVersion, /^fitai-squat-/);
  assert.equal('video' in result, false);
  assert.equal('bytes' in result, false);
});
