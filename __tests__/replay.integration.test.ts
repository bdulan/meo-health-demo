// Validates the full bundled replay against the scenario map in MEO_BUILD_SPEC.md §3.

import * as fs from 'fs';
import * as path from 'path';
import { createDetector } from '../src/decide';
import { parseReplay } from '../src/ingest';
import { TriggerEvent } from '../src/types';

const text = fs.readFileSync(path.join(__dirname, '..', 'assets', 'replay.jsonl'), 'utf8');

describe('full replay.jsonl scenario map', () => {
  const parsed = parseReplay(text);

  test('ingest survives the planted gap (carry-forward) and out-of-order pair (reorder)', () => {
    expect(parsed.gapFillCount).toBe(3); // seconds 120–122 carried forward
    expect(parsed.reorderedCount).toBe(1); // one out-of-order pair (145/146)
    // contiguous 1 Hz timeline: tSec strictly increments by 1
    parsed.readings.forEach((r, i) => expect(r.tSec).toBe(i));
    expect(parsed.readings.length).toBe(720); // full 12 min; all cases in the first ~4
  });

  const det = createDetector();
  const triggers: TriggerEvent[] = [];
  let longestSilentStretch = 0;
  for (const r of parsed.readings) {
    const out = det.step(r);
    if (out.trigger) triggers.push(out.trigger);
    longestSilentStretch = Math.max(longestSilentStretch, out.focusStreakSec);
  }

  test('exactly two triggers, both inside the first ~4 minutes', () => {
    expect(triggers).toHaveLength(2);
    for (const t of triggers) expect(t.tSec).toBeLessThanOrEqual(250);
  });

  test('no trigger during warmup or the brief dip at ~100s', () => {
    for (const t of triggers) {
      expect(t.tSec).toBeGreaterThanOrEqual(30);
      // brief dip lives ~96–109s and must not fire
      expect(t.tSec < 96 || t.tSec > 120).toBe(true);
    }
  });

  test('sharp drop triggers ~20s after drift onset, classified sharp', () => {
    const sharp = triggers[0];
    expect(sharp.type).toBe('sharp');
    expect(sharp.tSec).toBeGreaterThanOrEqual(150);
    expect(sharp.tSec).toBeLessThanOrEqual(165);
    expect(sharp.secondsDrifting).toBe(20);
  });

  test('slow drift triggers once sustained below the floor, classified slow', () => {
    const slow = triggers[1];
    expect(slow.type).toBe('slow');
    expect(slow.tSec).toBeGreaterThanOrEqual(235);
    expect(slow.tSec).toBeLessThanOrEqual(255);
  });

  test('sustained-focus periods produce ≥60s of continuous silence', () => {
    expect(longestSilentStretch).toBeGreaterThanOrEqual(60);
  });

  test('malformed lines never throw', () => {
    const dirty = 'not json\n{"ts": "2026-06-09T09:00:00Z"}\n{"ts":"bad","flow_score":1}\n' + text;
    expect(() => parseReplay(dirty)).not.toThrow();
    const res = parseReplay(dirty);
    expect(res.skippedLines.length).toBeGreaterThanOrEqual(3);
  });

  test('payload contract: flow_score is the signal; legacy focus alias still accepted', () => {
    const mixed =
      '{"ts":"2026-06-09T09:00:00Z","flow_score":80,"hrv":60,"source":"meo-band-sim"}\n' +
      '{"ts":"2026-06-09T09:00:01Z","focus":75,"hrv":60,"source":"meo-band-sim"}\n';
    const res = parseReplay(mixed);
    expect(res.readings.map((r) => r.focus)).toEqual([80, 75]);
    expect(res.skippedLines).toHaveLength(0);
  });
});
