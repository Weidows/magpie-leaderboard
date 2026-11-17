import { fileURLToPath } from 'node:url';
import { fetchText, pct, round, today, writeModule } from './lib.mjs';

const SOURCE_URL = 'https://joelniklaus-harness-leaderboard.hf.space/api/index';
const BENCHMARKS = ['terminal-bench-2.1', 'deep-swe'];

function displayModel(id) {
  const known = {
    'zai-org/GLM-5.3-Flash': 'GLM-5.3-Flash',
    'deepseek-ai/DeepSeek-V4.1-Flash': 'DeepSeek V4.1 Flash',
    'RecursiveSI/flint': 'Flint',
    'ricursiveAI/Ripple-65B-Preview': 'Ripple 65B Preview',
  };
  if (known[id]) return known[id];
  return id.split('/').pop().replace(/[-_]+/g, ' ');
}

function benchmarkSummary(benchmark) {
  if (!benchmark) return null;
  return {
    rate: pct(benchmark.rate),
    ci: Array.isArray(benchmark.ci) ? benchmark.ci.map((value) => pct(value)) : null,
    tasks: benchmark.n_tasks ?? null,
    costPerTrial: round(benchmark.cost_per_trial, 4),
    agentSec: round(benchmark.agent_s_per_trial, 0),
  };
}

function harnessRow(modelId, harnessId, harness) {
  const benchmarks = {};
  for (const name of BENCHMARKS) {
    const summary = benchmarkSummary(harness.benchmarks?.[name]);
    if (summary) benchmarks[name] = summary;
  }
  return {
    model: modelId,
    harness: harnessId,
    overall: round(harness.overall, 1),
    overallRank: harness.overall_rank ?? null,
    overallGroup: harness.overall_group ?? null,
    rank: harness.rank ?? null,
    group: harness.group ?? null,
    rate: pct(harness.macro),
    ci: Array.isArray(harness.ci) ? harness.ci.map((value) => pct(value)) : null,
    trials: harness.n_trials ?? null,
    scored: harness.n_scored ?? null,
    pass: harness.n_pass ?? null,
    infra: harness.n_infra ?? null,
    costPerPass: round(harness.cost_per_pass, 4),
    costPerTrial: round(harness.cost_per_trial, 4),
    tokensPerTrial: round(harness.tokens_per_trial, 0),
    agentSec: round(harness.agent_s_per_trial, 0),
    modelSec: round(harness.model_s_per_trial, 0),
    versions: harness.versions ?? [],
    benchmarks,
  };
}

export function transformHarness(index) {
  const config = index.config || {};
  const leaderboard = index.leaderboard || {};
  const modelIds = Object.keys(leaderboard).filter((id) => id !== '_all');
  const harnessConfig = config.harnesses || {};
  const harnessOrder = config.ranked_harnesses || [];

  const rows = [];
  const models = modelIds.map((modelId) => {
    const effort = leaderboard[modelId]?.stages?.full?.efforts?._all;
    const harnesses = effort?.harnesses || {};
    const modelRows = harnessOrder
      .filter((harnessId) => harnesses[harnessId])
      .map((harnessId) => harnessRow(modelId, harnessId, harnesses[harnessId]));
    rows.push(...modelRows);
    const best = modelRows.reduce(
      (winner, row) =>
        row.overall != null && (winner == null || row.overall > winner.overall) ? row : winner,
      null,
    );
    const bestRateRow = modelRows.reduce(
      (winner, row) =>
        row.rate != null && (winner == null || row.rate > winner.rate) ? row : winner,
      null,
    );
    const cheapest = modelRows
      .filter((row) => row.costPerPass != null && row.costPerPass > 0)
      .sort((a, b) => a.costPerPass - b.costPerPass)[0];
    return {
      id: modelId,
      name: displayModel(modelId),
      bestHarness: best?.harness ?? null,
      bestOverall: best?.overall ?? null,
      bestRate: bestRateRow?.rate ?? null,
      bestRateHarness: bestRateRow?.harness ?? null,
      cheapestHarness: cheapest?.harness ?? null,
      cheapestCostPerPass: cheapest?.costPerPass ?? null,
      benchmarks: effort?.benchmarks
        ? Object.fromEntries(
            Object.entries(effort.benchmarks).map(([name, value]) => [name, pct(value)]),
          )
        : {},
      noise: round(effort?.noise?.rerun_flip != null ? effort.noise.rerun_flip * 100 : null, 1),
    };
  });

  models.sort((a, b) => (b.bestRate ?? 0) - (a.bestRate ?? 0));

  const harnesses = harnessOrder.map((id) => {
    const info = harnessConfig[id] || {};
    const ownRows = rows.filter((row) => row.harness === id);
    const overalls = ownRows.map((row) => row.overall).filter((value) => value != null);
    const rates = ownRows.map((row) => row.rate).filter((value) => value != null);
    const costs = ownRows.map((row) => row.costPerPass).filter((value) => value != null);
    return {
      id,
      name: info.display || id,
      vendor: info.vendor || '',
      color: info.color || '#8a8a8a',
      averageOverall: overalls.length
        ? round(overalls.reduce((sum, value) => sum + value, 0) / overalls.length, 1)
        : null,
      averageRate: rates.length
        ? round(rates.reduce((sum, value) => sum + value, 0) / rates.length, 1)
        : null,
      averageCostPerPass: costs.length
        ? round(costs.reduce((sum, value) => sum + value, 0) / costs.length, 4)
        : null,
      wins: ownRows.filter((row) => row.overallRank === 1).length,
    };
  });

  harnesses.sort(
    (a, b) => (b.averageRate ?? 0) - (a.averageRate ?? 0) || a.id.localeCompare(b.id),
  );

  const effort =
    leaderboard._all?.stages?.full?.efforts?._all ??
    Object.values(leaderboard).find((entry) => entry?.stages?.full?.efforts?._all)?.stages.full
      .efforts._all;
  const noise = effort?.noise || {};
  return {
    source: 'harness-leaderboard',
    sourceUrl: 'https://huggingface.co/spaces/joelniklaus/harness-leaderboard',
    fetchedAt: today(),
    generatedAt: index.generated_at || null,
    version: index.version || null,
    effort: 'all',
    models,
    harnesses,
    rows,
    noise: {
      rerunFlip: round(noise.rerun_flip != null ? noise.rerun_flip * 100 : null, 1),
      harnessFlip: round(noise.harness_flip != null ? noise.harness_flip * 100 : null, 1),
      effortFlip: round(noise.effort_flip != null ? noise.effort_flip * 100 : null, 1),
      byBenchmark: noise.by_benchmark
        ? Object.fromEntries(
            Object.entries(noise.by_benchmark).map(([name, value]) => [
              name,
              {
                rerunFlip: round(value.rerun_flip != null ? value.rerun_flip * 100 : null, 1),
                harnessFlip: round(value.harness_flip != null ? value.harness_flip * 100 : null, 1),
              },
            ]),
          )
        : {},
    },
  };
}

export async function syncHarness({ quiet = false } = {}) {
  if (!quiet) console.log(`[harness] fetching ${SOURCE_URL}`);
  const text = await fetchText(SOURCE_URL);
  const index = JSON.parse(text);
  const data = transformHarness(index);
  const target = await writeModule('page/data-harness.js', 'HARNESS_DATA', data);
  if (!quiet) {
    console.log(
      `[harness] ${data.models.length} models x ${data.harnesses.length} harnesses, ${data.rows.length} rows -> ${target}`,
    );
  }
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await syncHarness();
}
