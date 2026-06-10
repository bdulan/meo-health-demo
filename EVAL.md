# Eval note — leading metrics on the provided replay

Computed by running the bundled 12-minute replay (720 s, 1 Hz) through INGEST → DECIDE
(the same code path the app uses; script equivalent to the in-app session, cached-cue mode).

| Metric (PRD §7) | Definition used | Result |
|---|---|---|
| Time-in-focus | % of seconds where flow score ≥ rolling 60 s baseline | **55.8 %** |
| Distraction triggers | sustained-drift rule (20 s below floor) | **2** — `sharp` @ t+350 s, `slow` @ t+601 s |
| Recovery time | seconds from trigger until flow ≥ rolling baseline | 40 s (sharp), 65 s (slow) → **median 65 s** |
| Intervention precision | % of triggers followed by recovery within 30 s | **0/2** (see caveat) |
| Silence ratio | % of seconds with no coach speech (~6 s per spoken cue) | **98.3 %** |

## Caveats — read before trusting the numbers

- **The replay cannot respond to cues.** It is a fixed synthetic trace, so "did the
  intervention work" is unanswerable on this fixture by construction: focus recovers on the
  file's own schedule (≈90 s after the sharp drop, ≈110 s after the slow drift) no matter
  what the coach says. The 0/2 precision is a property of the fixture, not the coach.
- **Rolling-baseline recovery is partly an artifact.** During a long low stretch the baseline
  itself descends toward the signal, so "focus ≥ baseline" fires earlier than a human would
  call "recovered." A production metric should use the *pre-trigger* baseline snapshot
  (logged in every trigger event) — by that stricter definition recovery is 89 s (sharp) and
  >118 s (slow).
- Time-in-focus of ~56 % reads low for a session that is mostly settled; same artifact —
  a rolling mean classifies ~half of all seconds as below-average by construction. A
  zone-based definition (flow ≥ 70) gives 66 % and tracks the scenario map better.

## What I'd actually run (the harness this log design enables)

A/B on the same replay: adaptive coach vs fixed-script baseline (cue at fixed timestamps),
identical detection logging in both arms. Compare median recovery time, time-in-focus, and
silence ratio across arms. The session log already pairs every trigger with the focus signal
before (baseline snapshot, seconds drifting) and after (per-second readings), so the
comparison script is a pure log-processing job — no app changes needed. The missing
ingredient is a replay that *reacts* to cues; next step is a simple response model
(focus gets a +N pt/s nudge for ~20 s after a cue, with noise) so precision becomes measurable.
