import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '..');

function loadWindowScript(file, key) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(resolve(ROOT, file), 'utf8'), context, { filename: file });
  assert.ok(context.window[key], `${file} did not define window.${key}`);
  return context.window[key];
}

const AA = loadWindowScript('page/data-aa.js', 'AA_DATA');
const HARNESS = loadWindowScript('page/data-harness.js', 'HARNESS_DATA');

test('AA snapshot has a complete, ordered model board', () => {
  assert.equal(AA.total, AA.models.length);
  assert.ok(AA.total >= 30, 'expected a non-trivial model board');
  assert.equal(new Set(AA.models.map((model) => model.slug)).size, AA.total);
  assert.equal(AA.models[0].rank, 1);
  AA.models.forEach((model, index) => {
    assert.equal(model.rank, index + 1);
    assert.ok(Number.isFinite(model.intelligence), `${model.name} has no intelligence score`);
    if (index > 0) {
      assert.ok(
        AA.models[index - 1].intelligence >= model.intelligence,
        'models must be sorted by intelligence',
      );
    }
    for (const field of ['coding', 'agent', 'terminal', 'priceIn', 'priceOut', 'speed']) {
      const value = model[field];
      assert.ok(value == null || Number.isFinite(value), `${model.name}.${field} is not a number`);
    }
  });
});

test('blended price follows the advertised 3:1 input:output ratio', () => {
  for (const model of AA.models) {
    if (model.priceIn == null || model.priceOut == null) continue;
    const expected = Math.round((model.priceIn * 0.75 + model.priceOut * 0.25) * 1000) / 1000;
    assert.equal(model.blended, expected, `${model.name} blended price mismatch`);
  }
});

test('open-source accounting matches the board', () => {
  assert.equal(AA.openCount, AA.models.filter((model) => model.open).length);
  assert.ok(AA.models.some((model) => model.open));
  assert.ok(AA.models.some((model) => !model.open));
});

test('harness snapshot is a complete model x harness matrix', () => {
  assert.ok(HARNESS.models.length >= 2);
  assert.ok(HARNESS.harnesses.length >= 5);
  assert.equal(HARNESS.rows.length, HARNESS.models.length * HARNESS.harnesses.length);
  for (const model of HARNESS.models) {
    const rows = HARNESS.rows.filter((row) => row.model === model.id);
    assert.equal(rows.length, HARNESS.harnesses.length);
    for (const row of rows) {
      assert.ok(Number.isFinite(row.overall), `${model.id}/${row.harness} has no overall score`);
      assert.ok(row.overall >= 0 && row.overall <= 100);
      assert.ok(row.overallRank >= 1);
      assert.ok(row.rate == null || (row.rate >= 0 && row.rate <= 100));
      assert.ok(row.costPerPass == null || row.costPerPass >= 0);
    }
    const best = rows.reduce((winner, row) => (row.overall > winner.overall ? row : winner));
    assert.equal(model.bestOverall, best.overall);
    assert.equal(model.bestHarness, best.harness);
  }
});

test('harness averages and model ordering are internally consistent', () => {
  for (const harness of HARNESS.harnesses) {
    const rows = HARNESS.rows.filter((row) => row.harness === harness.id);
    const averageOverall = rows.reduce((sum, row) => sum + row.overall, 0) / rows.length;
    const averageRate = rows.reduce((sum, row) => sum + row.rate, 0) / rows.length;
    assert.ok(Math.abs(harness.averageOverall - averageOverall) < 0.11);
    assert.ok(Math.abs(harness.averageRate - averageRate) < 0.11);
  }
  const bestScores = [...HARNESS.models].map((model) => model.bestRate);
  assert.deepEqual(
    bestScores,
    [...bestScores].sort((a, b) => b - a),
    'models should be ordered by their cross-model comparable pass rate',
  );
});

test('harness page keeps the source honesty note', () => {
  assert.ok(HARNESS.noise.rerunFlip != null);
  assert.ok(HARNESS.noise.harnessFlip != null);
  assert.match(HARNESS.sourceUrl, /harness-leaderboard/);
});
