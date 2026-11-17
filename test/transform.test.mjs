import assert from 'node:assert/strict';
import test from 'node:test';
import { transformAa } from '../scripts/sync-aa.mjs';
import { transformHarness } from '../scripts/sync-harness.mjs';
import { decodeNextFlight, extractJsonAfter } from '../scripts/lib.mjs';

test('decodeNextFlight joins streamed server payloads', () => {
  const html = [
    '<script>self.__next_f.push([1,"{\\"a\\":1}"])</script>',
    '<script>self.__next_f.push([1,",\\"b\\":2}"])</script>',
  ].join('');
  assert.equal(decodeNextFlight(html), '{"a":1},"b":2}');
});

test('extractJsonAfter handles nested brackets and strings', () => {
  const source = 'x:"models":[{"name":"a[b]","nested":{"x":1},"arr":[1,2]}] trailing';
  assert.equal(extractJsonAfter(source, 'models'), '[{"name":"a[b]","nested":{"x":1},"arr":[1,2]}]');
  assert.throws(() => extractJsonAfter(source, 'missing'));
});

test('transformAa deduplicates efforts and computes the 3:1 blended price', () => {
  const raw = [
    {
      id: 'a-low',
      release: { slug: 'alpha', name: 'Alpha' },
      name: 'Alpha (Low)',
      intelligenceIndex: 20,
      modelCreatorName: 'Lab',
      price1mInputTokens: 2,
      price1mOutputTokens: 10,
      isOpenWeights: true,
    },
    {
      id: 'a-high',
      release: { slug: 'alpha', name: 'Alpha' },
      name: 'Alpha (High)',
      intelligenceIndex: 30,
      modelCreatorName: 'Lab',
      price1mInputTokens: 2,
      price1mOutputTokens: 10,
      isOpenWeights: true,
    },
    {
      id: 'b',
      release: { slug: 'beta', name: 'Beta' },
      name: 'Beta (Max)',
      intelligenceIndex: 40,
      modelCreatorName: 'Other',
      price1mInputTokens: null,
      price1mOutputTokens: null,
    },
    {
      id: 'c',
      release: { slug: 'gamma', name: 'Gamma' },
      name: 'Gamma',
      intelligenceIndex: null,
    },
  ];
  const data = transformAa(raw);
  assert.equal(data.total, 2);
  assert.equal(data.models[0].name, 'Beta');
  assert.equal(data.models[0].rank, 1);
  assert.equal(data.models[1].name, 'Alpha');
  assert.equal(data.models[1].variant, 'High');
  assert.equal(data.models[1].blended, 4);
  assert.equal(data.openCount, 1);
});

test('transformHarness produces a stable matrix and averages', () => {
  const row = (overall, rate, cost) => ({
    overall,
    overall_rank: 1,
    overall_group: 1,
    rank: 1,
    group: 1,
    macro: rate,
    ci: [rate - 0.05, rate + 0.05],
    n_trials: 10,
    n_scored: 9,
    n_pass: 5,
    n_infra: 1,
    cost_per_pass: cost,
    cost_per_trial: cost / 2,
    tokens_per_trial: 1000,
    agent_s_per_trial: 60,
    model_s_per_trial: 40,
    versions: ['1.0'],
    benchmarks: {
      'terminal-bench-2.1': {
        rate,
        ci: [rate - 0.05, rate + 0.05],
        n_tasks: 10,
        cost_per_trial: cost / 2,
        agent_s_per_trial: 60,
      },
      'deep-swe': {
        rate,
        ci: [rate - 0.05, rate + 0.05],
        n_tasks: 12,
        cost_per_trial: cost / 2,
        agent_s_per_trial: 60,
      },
    },
  });

  const index = {
    generated_at: '2026-11-17T00:00:00Z',
    version: 'test',
    config: {
      ranked_harnesses: ['one', 'two'],
      harnesses: {
        one: { display: 'One', vendor: 'A', color: '#111111' },
        two: { display: 'Two', vendor: 'B', color: '#222222' },
      },
    },
    leaderboard: {
      'lab/model-a': {
        stages: {
          full: {
            efforts: {
              _all: {
                harnesses: { one: row(80, 0.8, 0.2), two: row(60, 0.6, 0.3) },
                noise: { rerun_flip: 0.24, harness_flip: 0.28, effort_flip: 0.3 },
              },
            },
          },
        },
      },
      'lab/model-b': {
        stages: {
          full: {
            efforts: {
              _all: {
                harnesses: { one: row(70, 0.7, 0.4), two: row(90, 0.9, 0.1) },
                noise: { rerun_flip: 0.2, harness_flip: 0.3, effort_flip: 0.25 },
              },
            },
          },
        },
      },
    },
  };

  const data = transformHarness(index);
  assert.equal(data.models.length, 2);
  assert.equal(data.harnesses.length, 2);
  assert.equal(data.rows.length, 4);
  assert.equal(data.models[0].name, 'model b');
  assert.equal(data.models[0].bestHarness, 'two');
  assert.equal(data.models[0].bestOverall, 90);
  assert.equal(data.models[0].bestRate, 90);
  assert.equal(data.models[0].bestRateHarness, 'two');
  assert.equal(data.harnesses[0].id, 'one');
  assert.equal(data.harnesses[0].averageRate, 75);
  assert.equal(data.noise.rerunFlip, 24);
});
