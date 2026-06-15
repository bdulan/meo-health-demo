# Meo · Adaptive AI Meditation Coach (prototype)

Detect sustained distraction from a 1 Hz flow-score stream → speak **adaptive, personalized audio guidance** instantly → stay silent when focus is high → log everything. The guidance scales across **10 languages × 4 accents × 2 genders = 80 voice profiles**, rendered in real time. See [DESIGN.md](DESIGN.md) for the architecture and rationale (§5 covers the audio scaling), and [EVAL.md](EVAL.md) for the leading-metric numbers on the bundled replay.

**Data contract:** each replay line is `{ ts: ISO-8601, flow_score: 0–100, hrv: ms, source }`. The signal is `flow_score` (legacy `focus` is accepted as an alias); `hrv` is carried for PRD-shape compliance but ignored by all logic.

## The adaptive audio (the core loop)

On a distraction trigger the coach produces **spoken guidance**, two layers deep:
1. **Instant** — a localized cached cue, spoken on-device the same second the trigger fires (zero latency).
2. **Personalized** — Claude writes a fresh cue *in the selected language*, rendered by **ElevenLabs** in the chosen voice (premium, real-time, multilingual). Falls back to on-device speech if ElevenLabs is slow / errors / has no key.

Pick any of the **80 voice profiles** with the language / accent / gender chips and hit **🔊 Preview** to hear it on demand — or run the replay and hear the real triggered interventions. The voice differs per profile and the text differs per cue, so no two tracks sound the same.

## Run

```bash
npm install
npx expo start        # then press i for iOS simulator, or w for web
```

The 12-minute replay (`assets/replay.jsonl`) is bundled — press **Start**. No backend needed.

- **Speed:** `SPEED` in [src/config.ts](src/config.ts) — `1` for the demo, `8` for fast iteration (full ~5.5-min session in ~40 s).
- **Session intent (P1):** type a one-line intention ("I'm anxious about the demo tomorrow") before Start — it's carried into the Claude prompt for every cue that session.
- **API keys (`cp .env.example .env`):**
  - `EXPO_PUBLIC_ANTHROPIC_API_KEY` — enables the personalized Claude cue (text). Without it: instant cached cues only.
  - `EXPO_PUBLIC_ELEVENLABS_API_KEY` — enables premium multilingual voices. Without it: on-device system voices (still multi-language; quality/accents limited to what the OS ships).
  - Both keys are optional and degrade gracefully — the loop never breaks, it just loses a layer of polish.

## Test

```bash
npm test
```

Tests cover: the DECIDE state machine (warmup suppression, brief-dip no-fire, sharp-drop fire timing, cooldown/episode rule, slow-drift fire, rolling baseline); a full-replay integration test asserting the scenario map (exactly 2 triggers — sharp @ ~t350, slow @ ~t601 — plus survival of the planted gap and out-of-order pair, and ≥60 s silence streaks); and the voice matrix (all 80 profiles resolve to a label/locale/voice-id, every language carries cues for all four intents, cue selection returns text in the requested language).

## What to watch in the replay

The replay is ~5.5 min and **front-loads every scenario into the first ~4 minutes** so the whole loop is visible quickly:

| t | What happens |
|---|---|
| 0:00–0:30 | Warm-up — flow climbs Zone 1→2→3, triggers suppressed (orb white→light→dark purple) |
| 0:30–1:35 | Sustained Zone 3 — coach silent, focus-streak passes 60 s |
| ~1:36 | Brief ~12 s dip to Zone 2 — goes `DRIFTING`, recovers, **no trigger** (the sustain rule) |
| ~2:00 | 3 s stream gap — carried forward, logged, no crash |
| ~2:25 | Out-of-order pair — reordered, no crash |
| 2:36 | **Sharp trigger** — instant localized cue, then the Claude cue rendered in the selected voice |
| 4:05 | **Slow trigger** — different cue intent, classified `slow` |
| 5:30 | Session end — Export Log for the full reconstructable JSON |

Tip: before a trigger, set a **session intent** and click through the language / accent / gender chips, then hit **🔊 Preview** to demo the 80-voice scaling on command.

## Layout

```
src/ingest.ts    JSONL → ordered, gap-tolerant 1 Hz readings
src/decide.ts    pure detection state machine (unit-tested, no LLM knowledge)
src/respond.ts   two-layer output: instant cached cue + async Claude cue
src/tts.ts       TTS layer: ElevenLabs premium + on-device fallback
src/voices.ts    voice matrix (10 × 4 × 2 = 80) + profile resolution
src/cues.ts      localized cue cache (10 languages) + selection (no-repeat)
src/log.ts       in-memory event log → JSON export
src/config.ts    every threshold, in one place
App.tsx          single-screen UI: stats, orb, voice picker + preview, trail
```
