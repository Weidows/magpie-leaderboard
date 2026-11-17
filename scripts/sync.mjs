import { syncAa } from './sync-aa.mjs';
import { syncHarness } from './sync-harness.mjs';

console.log('Refreshing leaderboard snapshots...');
const [aa, harness] = await Promise.all([syncAa(), syncHarness()]);
console.log(
  `Done: ${aa.total} models, ${harness.models.length * harness.harnesses.length} agent cells.`,
);
