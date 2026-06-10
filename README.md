# Meo · Adaptive AI Meditation Coach (prototype)

Detect sustained distraction from a 1 Hz flow-score stream → speak an adaptive cue instantly → stay silent when focus is high → log everything. See [DESIGN.md](DESIGN.md) for the full rationale, [EVAL.md](EVAL.md) for the leading-metric numbers on the bundled replay, and [MEO_BUILD_SPEC.md](MEO_BUILD_SPEC.md) for the brief.

**Data contract:** each replay line is `{ ts: ISO-8601, flow_score: 0–100, hrv: ms, source }`. The signal is `flow_score` (legacy `focus` is accepted as an alias); `hrv` is carried for PRD-shape compliance but ignored by all logic.

## Run

```bash
npm install
npx expo start        # then press i for iOS simulator, or w for web
```

The 12-minute replay (`assets/replay.jsonl`) is bundled — press **Start**. No backend needed.

- **Speed:** `SPEED` in [src/config.ts](src/config.ts) — `1` for the demo, `8` for fast iteration (full session in ~90 s).
- **Claude cues (optional):** `cp .env.example .env` and add your Anthropic API key, then restart expo. Without a key the app runs in its designed degraded mode — instant cached cues only, skips logged.

## Test

```bash
npm test
```

14 tests: the DECIDE state machine (warmup suppression, brief-dip no-fire, sharp-drop fire timing, cooldown/episode rule, slow-drift fire, rolling baseline) plus an integration test that runs the entire bundled replay through INGEST + DECIDE and asserts the scenario map: exactly 2 triggers (sharp @ ~t350, slow @ ~t601), survival of the planted 2 s gap and out-of-order pair, and ≥60 s silence streaks during sustained focus.

## What to watch in the replay

| t | What happens |
|---|---|
| 0:00–0:30 | Warm-up — triggers suppressed |
| 0:30–3:00 | Sustained focus — coach silent (streak counter top-right) |
| ~3:00 | Brief 12 s dip — goes `DRIFTING`, recovers, **no trigger** (the sustain rule) |
| ~4:10 | 2 s stream gap — carried forward, logged, no crash |
| 5:50 | **Sharp trigger** — cached cue speaks instantly; Claude cue follows if a key is set |
| ~7:50 | Out-of-order pair — reordered, no crash |
| 10:01 | **Slow trigger** — different cue intent, classified `slow` |
| 12:00 | Session end — Export Log for the full reconstructable JSON |

## Layout

```
src/ingest.ts    JSONL → ordered, gap-tolerant 1 Hz readings
src/decide.ts    pure detection state machine (unit-tested, no LLM knowledge)
src/respond.ts   two-layer output: instant cached cue + async Claude cue
src/cues.ts      pre-written cue cache + selection (no-repeat window)
src/log.ts       in-memory event log → JSON export
src/config.ts    every threshold, in one place
App.tsx          single-screen UI: stats, state badge, last cue, event trail
```
