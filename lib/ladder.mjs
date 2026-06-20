// Modules-per-level ladder, scaled by chunk size so each level is a comparable
// amount of real learning. The LAST module in each band is the "checkpoint"
// that actually raises the level (level = max(level, targetLevel)); the earlier
// ones sit at the current level so they don't bump it.

/** How many lessons it takes to climb one level, given the chunk size. */
export function modulesPerLevel(chunkMinutes) {
  const m = Number(chunkMinutes);
  if (m >= 30) return 2;
  if (m >= 10) return 3;
  return 4; // 5-minute lessons cover less, so more per level
}

/**
 * Build the outline's targetLevel sequence climbing startLevel → 10.
 * For each level L, (per-1) modules target L (no bump) then one targets L+1
 * (the checkpoint). Length = (10 - startLevel) * per.
 * If already at 10, returns a single capstone module at 10.
 */
export function buildLadder(startLevel, chunkMinutes) {
  const per = modulesPerLevel(chunkMinutes);
  const start = Math.min(10, Math.max(1, Math.round(startLevel)));
  const out = [];
  for (let L = start; L < 10; L++) {
    for (let i = 0; i < per - 1; i++) out.push(L);
    out.push(L + 1);
  }
  if (out.length === 0) out.push(10); // already expert — one capstone
  return out;
}
