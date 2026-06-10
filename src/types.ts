/**
 * Raw line shape in replay.jsonl. The signal is the flow score (`flow_score`,
 * 0–100); `focus` is accepted as a legacy alias. `hrv` exists for PRD
 * compliance but is ignored by all logic.
 */
export interface RawReading {
  ts: string;
  flow_score?: number;
  /** Legacy field name from the original PRD shape. */
  focus?: number;
  hrv?: number;
  source?: string;
}

/** Normalized 1 Hz reading on the session timeline. */
export interface Reading {
  /** Original ISO timestamp (synthesized for gap fills). */
  ts: string;
  /** Seconds since session start (0-based, contiguous). */
  tSec: number;
  focus: number;
  /** True when this value was carried forward across a stream gap. */
  gap: boolean;
}

export type DetectorStateName = 'WARMUP' | 'MONITORING' | 'DRIFTING' | 'TRIGGERED';

export type TriggerType = 'sharp' | 'slow';

export interface TriggerEvent {
  tSec: number;
  type: TriggerType;
  currentFocus: number;
  baseline: number;
  secondsDrifting: number;
}

export interface StateChangeEvent {
  tSec: number;
  from: DetectorStateName;
  to: DetectorStateName;
}

export interface DecideOutput {
  state: DetectorStateName;
  baseline: number | null;
  /** Consecutive seconds of non-drifting readings (silence-streak evidence). */
  focusStreakSec: number;
  stateChange: StateChangeEvent | null;
  trigger: TriggerEvent | null;
}

export type LogEventType =
  | 'reading'
  | 'baselineUpdate'
  | 'stateChange'
  | 'trigger'
  | 'llmRequest'
  | 'llmResponse'
  | 'speechStart'
  | 'speechSkip'
  | 'ingestWarning'
  | 'sessionStart'
  | 'sessionEnd';

export interface LogEvent {
  /** Wall-clock ISO timestamp when the event was logged. */
  ts: string;
  /** Session-relative second, when applicable. */
  tSec?: number;
  type: LogEventType;
  payload: Record<string, unknown>;
}
