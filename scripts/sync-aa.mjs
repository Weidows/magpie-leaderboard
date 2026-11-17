import { fileURLToPath } from 'node:url';
import {
  ROOT,
  decodeNextFlight,
  extractJsonAfter,
  fetchText,
  pct,
  round,
  today,
  writeModule,
} from './lib.mjs';

const SOURCE_URL = 'https://artificialanalysis.ai/leaderboards/models';

function variantOf(name, base) {
  if (!name || !base) return null;
  if (!name.startsWith(base)) return null;
  const rest = name.slice(base.length).trim();
  const match = rest.match(/^\(([^)]+)\)$/);
  if (!match) return null;
  return match[1].replace(/,\s*default fallback/i, '').trim() || null;
}

function score(scores, ...keys) {
  for (const key of keys) {
    const value = scores?.[key];
    if (value != null && Number.isFinite(Number(value))) return pct(value);
  }
  return null;
}

function price(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const number = Number(value);
  return number === 0 ? 0 : round(number, number < 0.1 ? 4 : 2);
}

export function transformAa(rawModels) {
  const best = new Map();
  for (const model of rawModels) {
    if (model?.intelligenceIndex == null || !Number.isFinite(Number(model.intelligenceIndex))) {
      continue;
    }
    const slug = model.release?.slug || model.id || model.name;
    const current = best.get(slug);
    if (!current || Number(model.intelligenceIndex) > Number(current.intelligenceIndex)) {
      best.set(slug, model);
    }
  }

  const models = [...best.values()]
    .map((model) => {
      const base = model.release?.name || model.name;
      const scores = model.scores || {};
      const priceIn = price(model.price1mInputTokens);
      const priceOut = price(model.price1mOutputTokens);
      const blended =
        priceIn != null && priceOut != null
          ? round(priceIn * 0.75 + priceOut * 0.25, 3)
          : null;
      const intelligence = round(model.intelligenceIndex, 1);
      return {
        slug: model.release?.slug || model.id,
        name: base,
        variant: variantOf(model.name, base),
        creator: model.modelCreatorName || 'Unknown',
        color: model.modelCreatorColor || '#8a8a8a',
        open: Boolean(model.isOpenWeights),
        reasoning: Boolean(model.isReasoning),
        deprecated: Boolean(model.deprecated),
        intelligence,
        omniscience: round(model.omniscience, 1),
        coding: score(scores, 'frontiercode-2-0', 'frontiercode'),
        agent: score(scores, 'automationbench-aa'),
        terminal: score(scores, 'terminalbench-4-0', 'terminalbench-hard'),
        gpqa: score(scores, 'gpqa-diamond'),
        hle: score(scores, 'hle-diamond', 'humanitys-last-exam'),
        scicode: score(scores, 'scicode'),
        mmmu: score(scores, 'mmmu-pro'),
        priceIn,
        priceOut,
        blended,
        cacheHit: price(model.cacheHitPrice),
        cacheWrite: price(model.cacheWritePrice),
        context: Number.isFinite(Number(model.contextWindowTokens))
          ? Number(model.contextWindowTokens)
          : null,
        speed: round(model.outputSpeed, 1),
        ttft: round(model.timeToFirstToken, 1),
        costPerTask: round(model.intelligenceIndexCostPerTask, 3),
        value: blended && blended > 0 && intelligence != null
          ? round(intelligence / blended, 2)
          : null,
      };
    })
    .filter((model) => model.intelligence != null)
    .sort((a, b) => b.intelligence - a.intelligence)
    .map((model, index) => ({ ...model, rank: index + 1 }));

  const open = models.filter((model) => model.open);
  return {
    source: 'artificialanalysis.ai',
    sourceUrl: SOURCE_URL,
    fetchedAt: today(),
    total: models.length,
    openCount: open.length,
    creators: new Set(models.map((model) => model.creator)).size,
    models,
  };
}

export async function syncAa({ quiet = false } = {}) {
  if (!quiet) console.log(`[aa] fetching ${SOURCE_URL}`);
  const html = await fetchText(SOURCE_URL);
  const flight = decodeNextFlight(html);
  const raw = JSON.parse(extractJsonAfter(flight, 'initialModels'));
  const data = transformAa(raw);
  const target = await writeModule('page/data-aa.js', 'AA_DATA', data);
  if (!quiet) {
    console.log(`[aa] ${data.total} models (${data.openCount} open, ${data.creators} creators) -> ${target}`);
  }
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await syncAa();
}
