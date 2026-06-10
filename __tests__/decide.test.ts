import { DETECTION_CONFIG } from '../src/config';
import { createDetector } from '../src/decide';
import { Reading, TriggerEvent } from '../src/types';

const C = DETECTION_CONFIG;

function reading(tSec: number, focus: number): Reading {
  return { ts: new Date(Date.UTC(2026, 0, 1, 9, 0, tSec)).toISOString(), tSec, focus, gap: false };
}

/** Feed a focus series (one value per second, starting at tSec 0) and collect triggers. */
function run(series: number[]): { triggers: TriggerEvent[]; states: string[] } {
  const det = createDetector();
  const triggers: TriggerEvent[] = [];
  const states: string[] = [];
  series.forEach((focus, t) => {
    const out = det.step(reading(t, focus));
    states.push(out.state);
    if (out.trigger) triggers.push(out.trigger);
  });
  return { triggers, states };
}

const fill = (n: number, v: number) => Array(n).fill(v);

describe('DECIDE state machine', () => {
  test('warmup suppression: no trigger in the first warmupSec even with terrible focus', () => {
    // 30s of focus=20 — drifting from second one, but warmup suppresses everything
    const { triggers, states } = run(fill(C.warmupSec, 20));
    expect(triggers).toHaveLength(0);
    expect(states.slice(0, C.warmupSec - 1).every((s) => s === 'WARMUP')).toBe(true);
  });

  test('brief dip does NOT fire: 9s below floor then recovery', () => {
    const series = [...fill(60, 80), ...fill(9, 55), ...fill(60, 80)];
    const { triggers } = run(series);
    expect(triggers).toHaveLength(0);
  });

  test('dip one second short of sustainSec does NOT fire; exactly sustainSec does', () => {
    const justShort = [...fill(60, 80), ...fill(C.sustainSec - 1, 40), ...fill(40, 80)];
    expect(run(justShort).triggers).toHaveLength(0);

    const justEnough = [...fill(60, 80), ...fill(C.sustainSec, 40), ...fill(40, 80)];
    expect(run(justEnough).triggers).toHaveLength(1);
  });

  test('sharp drop fires at exactly sustainSec consecutive drifting seconds, classified sharp', () => {
    const driftStart = 60;
    const series = [...fill(driftStart, 80), ...fill(60, 35)];
    const { triggers } = run(series);
    expect(triggers).toHaveLength(1);
    const trig = triggers[0];
    // drift begins at tSec=60 (count 1), so the 20th drifting second is tSec=79
    expect(trig.tSec).toBe(driftStart + C.sustainSec - 1);
    expect(trig.type).toBe('sharp');
    expect(trig.secondsDrifting).toBe(C.sustainSec);
  });

  test('cooldown + episode rule: no re-fire while drift persists; re-fire needs recovery + fresh sustain', () => {
    // 120s of continuous drift after a stable baseline: exactly one trigger
    const longDrift = [...fill(60, 80), ...fill(120, 35)];
    expect(run(longDrift).triggers).toHaveLength(1);

    // recover, then drift again: second trigger fires after a fresh sustain window
    const twoEpisodes = [
      ...fill(60, 80),
      ...fill(C.sustainSec + 5, 35), // episode 1 → trigger
      ...fill(C.cooldownSec + 10, 80), // recovery (exceeds cooldown)
      ...fill(C.sustainSec + 5, 35), // episode 2 → second trigger
    ];
    const { triggers } = run(twoEpisodes);
    expect(triggers).toHaveLength(2);
    expect(triggers[1].tSec - triggers[0].tSec).toBeGreaterThanOrEqual(C.cooldownSec);
  });

  test('slow drift fires once sustained below the zone floor, classified slow', () => {
    // glide 80 → 40 over 100s (0.4 pts/sec), then hold
    const glide = Array.from({ length: 100 }, (_, i) => 80 - i * 0.4);
    const series = [...fill(60, 80), ...glide, ...fill(40, 40)];
    const { triggers } = run(series);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].type).toBe('slow');
  });

  test('rolling baseline is the mean of the last baselineWindowSec readings', () => {
    const det = createDetector();
    let lastBaseline = 0;
    // 60s at 80, then 30s at 90 → baseline = (30*80 + 30*90)/60 = 85
    [...fill(C.baselineWindowSec, 80), ...fill(30, 90)].forEach((focus, t) => {
      lastBaseline = det.step(reading(t, focus)).baseline!;
    });
    expect(lastBaseline).toBeCloseTo(85, 1);
  });
});
