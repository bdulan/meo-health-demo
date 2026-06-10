// DECIDE: pure detection state machine. No imports from RESPOND, no I/O, no timers.
// This is the only module with required unit tests — keep it deterministic.

import { DETECTION_CONFIG, DetectionConfig } from './config';
import { DecideOutput, DetectorStateName, Reading, TriggerEvent } from './types';

export interface DetectorState {
  name: DetectorStateName;
  /** Readings processed so far (== elapsed session seconds at 1 Hz). */
  elapsedSec: number;
  /** Rolling window of recent focus values for the baseline mean. */
  window: number[];
  baseline: number | null;
  /** Recent focus history for sharp/slow entry classification. */
  recent: number[];
  /** Consecutive drifting seconds (counts while DRIFTING). */
  driftSec: number;
  /** Focus drop measured over the entry window when drift began. */
  entryDropPts: number;
  /** Seconds of cooldown remaining (counts down while TRIGGERED). */
  cooldownRemaining: number;
  /** Consecutive non-drifting seconds — evidence for the silence story. */
  focusStreakSec: number;
}

export function initialState(): DetectorState {
  return {
    name: 'WARMUP',
    elapsedSec: 0,
    window: [],
    baseline: null,
    recent: [],
    driftSec: 0,
    entryDropPts: 0,
    cooldownRemaining: 0,
    focusStreakSec: 0,
  };
}

export function isDrifting(focus: number, baseline: number, config: DetectionConfig): boolean {
  return focus < baseline * config.driftFloor || focus < config.zoneFloor;
}

/**
 * Advance the detector by one reading. Returns the new state plus any
 * state-change / trigger events produced this second. Pure function:
 * same inputs always produce the same outputs.
 */
export function step(
  prev: DetectorState,
  reading: Reading,
  config: DetectionConfig = DETECTION_CONFIG
): { state: DetectorState; output: DecideOutput } {
  const s: DetectorState = {
    ...prev,
    window: [...prev.window, reading.focus],
    recent: [...prev.recent, reading.focus],
    elapsedSec: prev.elapsedSec + 1,
  };
  if (s.window.length > config.baselineWindowSec) s.window.shift();
  if (s.recent.length > config.sharpEntryWindowSec + 1) s.recent.shift();
  s.baseline = s.window.reduce((a, b) => a + b, 0) / s.window.length;

  const from = prev.name;
  let trigger: TriggerEvent | null = null;

  const drifting = isDrifting(reading.focus, s.baseline, config);
  s.focusStreakSec = drifting ? 0 : prev.focusStreakSec + 1;

  switch (prev.name) {
    case 'WARMUP':
      if (s.elapsedSec >= config.warmupSec) s.name = 'MONITORING';
      break;

    case 'MONITORING':
      if (drifting) {
        s.name = 'DRIFTING';
        s.driftSec = 1;
        // how far focus fell from its recent level — discriminates a cliff from a slide
        const recentPeak = Math.max(...s.recent.slice(0, -1));
        s.entryDropPts = recentPeak - reading.focus;
      }
      break;

    case 'DRIFTING':
      if (!drifting) {
        s.name = 'MONITORING';
        s.driftSec = 0;
      } else {
        s.driftSec = prev.driftSec + 1;
        if (s.driftSec >= config.sustainSec) {
          trigger = {
            tSec: reading.tSec,
            type: s.entryDropPts >= config.sharpEntryDropPts ? 'sharp' : 'slow',
            currentFocus: reading.focus,
            baseline: round1(s.baseline),
            secondsDrifting: s.driftSec,
          };
          s.name = 'TRIGGERED';
          s.cooldownRemaining = config.cooldownSec;
          s.driftSec = 0;
        }
      }
      break;

    case 'TRIGGERED':
      // One trigger per drift episode: cooldown rate-limits (PRD's one-per-20s),
      // but we only re-arm once the meditator actually recovers. Without this,
      // a long low stretch would re-fire every cooldown+sustain seconds.
      s.cooldownRemaining = Math.max(0, prev.cooldownRemaining - 1);
      if (s.cooldownRemaining <= 0 && !drifting) {
        s.name = 'MONITORING';
      }
      break;
  }

  const output: DecideOutput = {
    state: s.name,
    baseline: round1(s.baseline),
    focusStreakSec: s.focusStreakSec,
    stateChange: s.name !== from ? { tSec: reading.tSec, from, to: s.name } : null,
    trigger,
  };
  return { state: s, output };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Convenience wrapper holding state across steps (UI-side use). */
export function createDetector(config: DetectionConfig = DETECTION_CONFIG) {
  let state = initialState();
  return {
    step(reading: Reading): DecideOutput {
      const r = step(state, reading, config);
      state = r.state;
      return r.output;
    },
    reset() {
      state = initialState();
    },
    get state() {
      return state;
    },
  };
}
