# Meo Adaptive AI Meditation Coach — Build Spec
> Hand this file to Claude Code as the single source of truth. Target: working prototype in one focused session. Stack and scope decisions are FINAL — do not expand scope.

## 0. Context (read once)
Meo's wearable streams a **flow score** (0–100) at 1 Hz during a meditation session. Build the loop: **detect sustained distraction → speak an adaptive cue → stay silent when focus is high → log everything**. This prototype proves the loop works; it is not a shippable product.

**Clarifications from the founder that override the written PRD:**
- The signal is the **flow score** (the `focus` field). `hrv` exists in the event shape for PRD compliance but is **ignored by all logic**.
- Detection = **sustained drift** (low for ~20s), NOT instantaneous % drop. Momentary dips that recover must NOT trigger.
- The session log is supporting context, not the centerpiece. Keep it simple (in-memory array → JSON dump).
- No visual "breathing ball" — that exists in their product already. Audio guidance is the deliverable.
- Front end: **React Native (Expo)** preferred. Latency of guidance is the #1 evaluated criterion.

## 1. Stack (final)
| Layer | Choice | Why |
|---|---|---|
| App | Expo (React Native, TypeScript), iOS simulator | Founder's stated RN preference; zero native config |
| Stream | Local replay of `replay.jsonl` (bundled asset), emitted 1/sec via timer | No backend needed; deterministic demo |
| Detection | Pure TS state machine, on-device | Deterministic, testable, zero latency, zero cost |
| LLM | Claude `claude-haiku-4-5` via Anthropic API | Fast first token, cheap; cues are one sentence |
| TTS | `expo-speech` (on-device) | Zero cost/latency; production swaps to ElevenLabs (note in doc) |
| Log | In-memory event array → shareable JSON on session end | Replayability story without infra |

Demo speed control: support a `SPEED` constant (1x for the Loom; 8x for development iteration).

## 2. Architecture — three modules, hard seams
```
[replay.jsonl] → INGEST → readings → DECIDE → trigger events → RESPOND → audio out
                                   ↘ every event → LOG (wraps all three)
```
**INGEST** (`ingest.ts`): reads JSONL asset, emits one reading/sec (× SPEED). Orders by `ts`, not arrival. Tolerates the planted 2-second gap (carry forward last value, mark `gap:true`) and the planted out-of-order pair (reorder within a 3-event lookahead buffer). Never throws on malformed lines — skip and log.

**DECIDE** (`decide.ts`): pure functions + state machine. No imports from RESPOND. This is the ONLY module with unit tests (required).
- Maintains rolling baseline: mean of last `baselineWindowSec` readings.
- States: `WARMUP → MONITORING → DRIFTING → TRIGGERED(cooldown) → MONITORING`
- Config (export as object, no magic numbers inline):
```ts
export const DETECTION_CONFIG = {
  baselineWindowSec: 60,
  driftFloor: 0.7,          // reading < baseline * 0.7 counts as drifting (PRD's 30%)
  zoneFloor: 70,            // OR below zone-3 absolute floor
  sustainSec: 20,           // must persist this long to trigger (founder's verbal rule)
  cooldownSec: 20,          // max one trigger per 20s (PRD)
  warmupSec: 30,            // no triggers in first 30s (PRD)
  silenceGraceSec: 60,      // sustained high focus ⇒ coach silent ≥60s (PRD)
};
```
- A reading is "drifting" if `focus < baseline * driftFloor` **OR** `focus < zoneFloor`. Trigger fires when drifting persists `sustainSec` consecutive seconds. Classify trigger as `sharp` (entered drift in ≤5s) vs `slow` (gradual) — passed to RESPOND for cue selection.

**RESPOND** (`respond.ts`): two-layer output, the latency answer.
1. **Instant layer (0ms):** on trigger, immediately speak a cached cue via expo-speech. Maintain ~8 pre-written cues across intents (breath anchor, body scan, sound anchor, gentle acknowledgment); never repeat the last 3 used.
2. **Personalized layer (async):** concurrently call Claude. If first token < 2.5s, queue the generated cue to speak after the cached one finishes. If slow/error: **skip silently** — the cached cue already covered the moment. This IS the degraded mode; say so in the design doc.
- Sustained high focus: speak nothing for ≥ `silenceGraceSec`. Silence is the default state; intervention is the exception.

**Claude prompt (system):** "You are a meditation coach for Meo. Voice: calm, clinical, real. Generate ONE short spoken cue (≤ 18 words) to gently guide a distracted meditator back. It must differ in intent or modality from the recent cues provided. No preamble, no quotes — output only the cue text."
**Per-call user content:** `{ triggerType: sharp|slow, currentFocus, baseline, secondsDrifting, recentCues: [last 3] }`

**LOG** (`log.ts`): append `{ts, type, payload}` for: reading, baselineUpdate, stateChange, trigger, llmRequest, llmResponse, speechStart, speechSkip. Button to export JSON.

**UI** (single screen, no styling effort): current focus number, zone label, baseline, state badge, last cue text, scrolling event trail, Start/Reset, Export Log.

## 3. Replay file scenario map (replay.jsonl — bundled, 718 events, 12 min)
| t (sec) | Episode | Expected behavior |
|---|---|---|
| 0–30 | Warm-up climb 55→75 | No trigger possible (warmup) |
| 30–180 | Sustained focus 75–85 | Silent ≥60s — show this in Loom |
| 180–195 | **Brief dip** to ~60 for ~9s, recovers | **Must NOT trigger** (sustain rule) — show in Loom |
| ~250 | 2-second gap | Ingest carries forward, no crash |
| 330–395 | **Sharp drop** to 35–45, sustained | **Triggers** ~20s in; cached cue instant, LLM cue follows |
| 395–450 | Recovery to ~76 | Evidence for intervention-precision metric |
| ~470 | Out-of-order pair | Ingest reorders, no crash |
| 450–555 | Sustained focus | Silent again |
| 555–650 | **Slow drift** 80→42 over ~95s | **Triggers** once sustained below floor (classified `slow`) |
| 650–720 | Recovery to close | Session summary in log |

## 4. P0 acceptance criteria (check every box before recording)
- [ ] Ingests JSONL at 1 Hz; survives gap + out-of-order without crashing
- [ ] Rolling baseline maintained; window length config-driven
- [ ] Trigger: sustained-drift rule, config-driven (threshold/window/cooldown/sustain)
- [ ] No trigger in first 30s; max one per 20s; brief dip does NOT fire
- [ ] On trigger: audible cue < 3s (cached layer makes this ~0s)
- [ ] LLM cue meaningfully different from prior cues (intent/modality, not paraphrase)
- [ ] Sustained high focus ⇒ ≥60s silence
- [ ] All events logged with timestamps; log exportable; run reconstructable from log
- [ ] One command to run (`npx expo start`, replay bundled)
- [ ] Unit tests on DECIDE: warmup suppression, brief-dip no-fire, sharp-drop fire timing, cooldown, slow-drift fire

## 5. Design doc skeleton (write ≤3 pages, this order)
1. **The loop & the latency answer** — two-layer response: instant cached + async personalized; why detection is deterministic and on-device (cost, latency, privacy).
2. **Architecture diagram** — the three seams; decision logic has no knowledge an LLM exists (testability, model swap).
3. **Detection rule & why** — sustained drift over instantaneous %-drop; smoothing; config-driven for tuning; next iteration = slope/derivative detection. (This is the "push back on the brief" point — the PRD's raw 30% rule is jumpy; defend the sustain requirement.)
4. **Cache↔generate strategy** — cached cues for universal moments, LLM for personalized; promotion path: validated generated cues graduate into the cache (eval-gated). Scaling/economics: most user-seconds never touch the backend.
5. **Failure modes** — LLM slow/unreachable ⇒ cached cue already played; silence remains valid.
6. **Privacy boundary (P2 hook)** — raw stream stays on device; only trigger snapshots reach the model; log holds aggregates in production.
7. **What I cut and why** — TTS quality (expo-speech vs ElevenLabs), log infra, multi-level user-defined difficulty (P1), eval harness (describe the A/B vs fixed-script design instead of building).
8. **What I'd build next** — eval harness, cue-promotion pipeline, multi-voice/language via TTS layer swap, session-intent context (P1).

## 6. Loom script (5–8 min)
1. (30s) The loop in one breath + the two-layer latency design.
2. (1m) Start replay at 1x. Show sustained-focus silence — "silence is the default."
3. (45s) Brief dip at ~3:00 — point out it does NOT fire. That's the sustain rule.
4. (1.5m) Sharp drop at ~5:30 — instant cached cue, then the LLM's personalized follow-up. Show both in the event trail with timestamps.
5. (1m) Slow drift at ~9:30 — second trigger, different cue intent, classified slow.
6. (1m) Export the log; show the run is reconstructable; flash the DECIDE tests passing.
7. (30s) Close: what was cut and why, what comes next.
