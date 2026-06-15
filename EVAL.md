# Eval note — leading metrics on the provided replay

Computed by running the bundled replay (331 s, 1 Hz) through INGEST → DECIDE
(the same code path the app uses; script equivalent to the in-app session, cached-cue mode).
The replay is a ~5.5-minute synthetic trace that front-loads every scenario into the first
~4 minutes (warm-up, sustained focus, a brief recovering dip, a stream gap, an out-of-order
pair, a sharp drop, and a slow drift) so the full loop is demonstrable without a 12-minute wait.

| Metric (PRD §7) | Definition used | Result |
|---|---|---|
| Time-in-focus | % of seconds where flow score ≥ rolling 60 s baseline | **65.9 %** |
| Distraction triggers | sustained-drift rule (20 s below floor) | **2** — `sharp` @ t+156 s, `slow` @ t+245 s |
| Recovery time | seconds from trigger until flow ≥ rolling baseline | 18 s (sharp), 36 s (slow) → **median 36 s** |
| Intervention precision | % of triggers followed by recovery within 30 s | **1/2** (see caveat) |
| Silence ratio | % of seconds with no coach speech (~6 s per spoken cue) | **96.4 %** |

## Caveats — read before trusting the numbers

- **The replay cannot respond to cues.** It is a fixed synthetic trace, so "did the
  intervention work" is unanswerable on this fixture by construction: focus recovers on the
  file's own schedule no matter what the coach says. The precision number is a property of the
  fixture's recovery timing, not the coach's effectiveness.
- **Rolling-baseline recovery is partly an artifact.** During a low stretch the baseline
  itself descends toward the signal, so "focus ≥ baseline" fires earlier than a human would
  call "recovered." A production metric should use the *pre-trigger* baseline snapshot
  (logged in every trigger event); by that stricter definition recovery is ~26 s (sharp) and
  ~47 s (slow) — time to climb back above the Zone-3 floor.
- Time-in-focus (~66 %) and the Zone-3 ratio (~56 %) move together here; a rolling mean
  classifies a chunk of seconds as below-average by construction, so the zone-based
  definition (flow ≥ 70) is the more honest "in focus" signal.

## What I'd actually run (the harness this log design enables)

A/B on the same replay: adaptive coach vs fixed-script baseline (cue at fixed timestamps),
identical detection logging in both arms. Compare median recovery time, time-in-focus, and
silence ratio across arms. The session log already pairs every trigger with the focus signal
before (baseline snapshot, seconds drifting) and after (per-second readings), so the
comparison script is a pure log-processing job — no app changes needed. The missing
ingredient is a replay that *reacts* to cues; next step is a simple response model
(focus gets a +N pt/s nudge for ~20 s after a cue, with noise) so precision becomes measurable.
