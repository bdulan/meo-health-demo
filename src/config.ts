// All tunables live here. No magic numbers inline anywhere else.

/** Replay speed multiplier: 1 for the Loom demo, 8 for development iteration. */
export const SPEED = 1;

export const DETECTION_CONFIG = {
  baselineWindowSec: 60,
  driftFloor: 0.7, // reading < baseline * 0.7 counts as drifting (PRD's 30%)
  zoneFloor: 70, // OR below zone-3 absolute floor
  sustainSec: 20, // must persist this long to trigger (founder's verbal rule)
  cooldownSec: 20, // max one trigger per 20s (PRD)
  warmupSec: 30, // no triggers in first 30s (PRD)
  silenceGraceSec: 60, // sustained high focus ⇒ coach silent ≥60s (PRD)
  // sharp-vs-slow classification: drop of ≥ sharpEntryDropPts within the
  // sharpEntryWindowSec preceding drift entry ⇒ "sharp"; otherwise "slow".
  sharpEntryWindowSec: 5,
  sharpEntryDropPts: 15,
};

export type DetectionConfig = typeof DETECTION_CONFIG;

export const INGEST_CONFIG = {
  /** Out-of-order tolerance: reorder within this many events of lookahead. */
  lookaheadEvents: 3,
};

export const RESPOND_CONFIG = {
  /** If Claude's cue arrives within this budget, queue it after the cached cue. Otherwise skip silently. */
  llmBudgetMs: 2500,
  model: 'claude-haiku-4-5',
  maxTokens: 64,
  /** Never repeat any of the last N cues spoken. */
  noRepeatWindow: 3,
};

export const ZONES: { min: number; label: string }[] = [
  { min: 85, label: 'Zone 4 · Deep' },
  { min: 70, label: 'Zone 3 · Flow' },
  { min: 55, label: 'Zone 2 · Settling' },
  { min: 0, label: 'Zone 1 · Distracted' },
];

export function zoneLabel(focus: number): string {
  for (const z of ZONES) if (focus >= z.min) return z.label;
  return ZONES[ZONES.length - 1].label;
}
