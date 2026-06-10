// INGEST: turns raw JSONL text into an ordered, contiguous 1 Hz stream of readings.
// Pure parsing logic lives here (node-testable); asset loading lives in replayAsset.ts.

import { INGEST_CONFIG } from './config';
import { RawReading, Reading } from './types';

export interface ParseResult {
  readings: Reading[];
  /** Lines that failed to parse or were missing required fields. */
  skippedLines: { line: number; reason: string }[];
  /** Number of events that arrived out of ts-order and were reordered. */
  reorderedCount: number;
  /** Number of synthetic carry-forward readings inserted across gaps. */
  gapFillCount: number;
}

/** The flow score for a raw event: `flow_score` per the data contract, `focus` as legacy alias. */
function flowOf(raw: RawReading): number {
  return (raw.flow_score ?? raw.focus)!;
}

function parseLine(line: string, lineNo: number): RawReading | { error: string } {
  try {
    const obj = JSON.parse(line);
    const flow = obj?.flow_score ?? obj?.focus;
    if (typeof obj?.ts !== 'string' || typeof flow !== 'number' || !isFinite(flow)) {
      return { error: 'missing/invalid ts or flow_score' };
    }
    const ms = Date.parse(obj.ts);
    if (isNaN(ms)) return { error: 'unparseable ts' };
    return obj as RawReading;
  } catch {
    return { error: 'malformed JSON' };
  }
}

/**
 * Streaming-style parse with a small lookahead buffer:
 * events are ordered by `ts`, not arrival. An event is only released once
 * `lookaheadEvents` newer events have arrived, which absorbs the planted
 * out-of-order pair without needing the whole file in memory.
 * Never throws on malformed lines — they are skipped and reported.
 */
export function parseReplay(text: string): ParseResult {
  const skippedLines: ParseResult['skippedLines'] = [];
  const ordered: RawReading[] = [];
  let reorderedCount = 0;

  const buffer: RawReading[] = [];
  const release = () => {
    let minIdx = 0;
    for (let i = 1; i < buffer.length; i++) {
      if (Date.parse(buffer[i].ts) < Date.parse(buffer[minIdx].ts)) minIdx = i;
    }
    if (minIdx !== 0) reorderedCount++;
    ordered.push(buffer.splice(minIdx, 1)[0]);
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parsed = parseLine(line, i + 1);
    if ('error' in parsed) {
      skippedLines.push({ line: i + 1, reason: parsed.error });
      continue;
    }
    buffer.push(parsed);
    if (buffer.length > INGEST_CONFIG.lookaheadEvents) release();
  }
  while (buffer.length > 0) release();

  // Normalize onto a contiguous 1 Hz timeline; carry forward across gaps.
  const readings: Reading[] = [];
  let gapFillCount = 0;
  if (ordered.length === 0) return { readings, skippedLines, reorderedCount, gapFillCount };

  const t0ms = Date.parse(ordered[0].ts);
  let lastSec = -1;
  let lastFocus = flowOf(ordered[0]);
  for (const raw of ordered) {
    const sec = Math.round((Date.parse(raw.ts) - t0ms) / 1000);
    if (sec <= lastSec) {
      // duplicate or still-out-of-order beyond lookahead: drop, never crash
      skippedLines.push({ line: -1, reason: `dropped non-monotonic event at ts=${raw.ts}` });
      continue;
    }
    // fill any gap with carry-forward values marked gap:true
    for (let s = lastSec + 1; s < sec; s++) {
      readings.push({
        ts: new Date(t0ms + s * 1000).toISOString(),
        tSec: s,
        focus: lastFocus,
        gap: true,
      });
      gapFillCount++;
    }
    readings.push({ ts: raw.ts, tSec: sec, focus: flowOf(raw), gap: false });
    lastSec = sec;
    lastFocus = flowOf(raw);
  }

  return { readings, skippedLines, reorderedCount, gapFillCount };
}

export interface Player {
  stop: () => void;
}

/**
 * Emits one reading per second (× SPEED) via a timer.
 * Calls onDone after the final reading.
 */
export function play(
  readings: Reading[],
  speed: number,
  onReading: (r: Reading) => void,
  onDone: () => void
): Player {
  let i = 0;
  const interval = setInterval(() => {
    if (i >= readings.length) {
      clearInterval(interval);
      onDone();
      return;
    }
    onReading(readings[i++]);
  }, 1000 / speed);
  return { stop: () => clearInterval(interval) };
}
