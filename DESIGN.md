# Meo Adaptive AI Meditation Coach — Design Doc

## 1. The loop & the latency answer

The loop: the wearable streams a flow score at 1 Hz → a deterministic on-device state machine detects *sustained* distraction → the coach speaks an adaptive cue → stays silent while focus is high → every event is logged.

Latency is the #1 criterion, so the response is **two-layered**:

1. **Instant layer (~0 ms).** The moment a trigger fires, a pre-written cue — localized to the meditator's language — is spoken from an on-device cache. No network, no model, no wait. The meditator hears guidance within the same second the detector fires.
2. **Personalized layer (async).** Concurrently, Claude (`claude-haiku-4-5`) writes one short cue tailored to the trigger snapshot (sharp vs slow, current focus, baseline, seconds drifting, recent cues) **in the meditator's language**, and the TTS layer renders it in the selected voice (ElevenLabs premium, on-device fallback). If it arrives within 2.5 s it speaks right after the cached cue finishes. If it's slow or errors, it is skipped silently.

Detection is deterministic and on-device on purpose: it's free (no tokens for the 99% of seconds where nothing happens), it's instant (no round trip on the critical path), it's private (the raw stream never leaves the device), and it's testable (pure functions, unit-tested timing).

**Latency budget** (PRD allows < 3 s from event to first audible token):

| Step | Budget | Measured |
|---|---|---|
| Trigger → cached cue speaking | ~0 ms (same tick) | < 1 s incl. TTS startup |
| Trigger → Claude cue ready | 2.5 s hard gate, else skip | 0.7–2.1 s observed |

**Model + provider:** Anthropic `claude-haiku-4-5`. The cue is one ≤18-word sentence, so the constraint is time-to-completion and cost, not reasoning depth — Haiku is the fastest, cheapest tier that holds the brand voice, and observed full-response latency (0.7–2.1 s) fits inside the 2.5 s gate that the bigger models would regularly miss. ~300 tokens per session total. The provider is swappable behind the RESPOND seam; nothing upstream knows Claude exists.

## 2. Architecture — three seams

```
[replay.jsonl] → INGEST → readings → DECIDE → trigger events → RESPOND → audio out
                                   ↘ every event → LOG (wraps all three)
```

- **INGEST** (`src/ingest.ts`) normalizes a messy stream into a contiguous 1 Hz timeline: orders by `ts` within a 3-event lookahead buffer, carries the last value forward across gaps (marked `gap:true`), and skips malformed lines without ever throwing.
- **DECIDE** (`src/decide.ts`) is a pure state machine: `WARMUP → MONITORING → DRIFTING → TRIGGERED(cooldown) → MONITORING`. It has **no knowledge an LLM exists** — it emits trigger events with a snapshot payload. That seam is why detection is fully unit-testable and why the model behind RESPOND can be swapped (or removed) without touching detection.
- **RESPOND** (`src/respond.ts`) owns the two-layer output, the localized cue cache (`src/cues.ts`), and the TTS layer (`src/tts.ts`) / voice matrix (`src/voices.ts`). RESPOND decides *what* to say; the TTS layer decides *how* it sounds. Neither the detector nor RESPOND knows which TTS engine actually rendered the audio.
- **LOG** (`src/log.ts`) appends `{ts, tSec, type, payload}` for every reading, baseline update, state change, trigger, LLM request/response, speech start/engine/skip. Export = JSON dump; a session is fully reconstructable from it.

All thresholds live in one config object (`src/config.ts`) — no magic numbers inline.

## 3. Detection rule & why (the push-back on the brief)

The PRD's raw rule — "trigger on a 30% drop" — is jumpy. Real attention data dips and recovers constantly; an instantaneous percent-drop rule would interrupt meditators at exactly the moments they're recovering on their own (the replay's planted 9-second dip at ~3:00 proves this — it must not fire, and doesn't).

The shipped rule is **sustained drift**: a reading counts as drifting if `focus < baseline × 0.7` (the PRD's 30%, applied against a rolling 60 s baseline) **or** `focus < 70` (absolute zone-3 floor). A trigger fires only after **20 consecutive drifting seconds**. Warmup (30 s) suppresses everything; cooldown rate-limits to one trigger per 20 s; and a trigger re-arms only after the meditator actually recovers — one cue per drift episode, not a nag every 40 seconds of a long low stretch.

Triggers are classified **sharp** (focus fell ≥15 pts within the 5 s before drift entry — a cliff) vs **slow** (a gradual slide), and the classification is passed to RESPOND so cue intent can differ (grounding cues for cliffs, re-engagement cues for slides).

Everything is config-driven for tuning. Next iteration: slope/derivative detection (EWMA of the first difference) to catch slides earlier than the absolute floor does, plus per-user adaptive floors learned from session history.

## 4. Cache ↔ generate strategy

Cached cues cover the universal moments — a distracted mind needs a breath/body/sound anchor or a gentle acknowledgment, and those sentences don't need a model. The LLM adds variety and personalization on top, constrained to differ in intent/modality from the last three cues spoken (enforced in the prompt and by the no-repeat window in the cache).

**Promotion path:** generated cues that perform well (focus recovers within N seconds of the cue, no user override) graduate into the cache, gated by an eval. Over time the cache becomes a personalized, validated cue library and the model is called less.

**Economics:** most user-seconds never touch a backend. In the 12-minute demo session there are exactly 2 LLM calls (~50 output tokens each). Detection costs zero; silence costs zero.

## 5. Adaptive audio — scaling guidance to 80 voices

The guidance must scale across **10 languages × 4 accents × 2 genders = 80 voice profiles**, render in real-time, and sound different across them. The trap is thinking that means generating 80 tracks. It doesn't.

**You never pre-render 80. A voice profile is a selector, not a track.** The pipeline separates *what to say* from *how it sounds*:

```
drift state ─▶ cue TEXT (cached or Claude, localized to the language)
                          │
voiceProfile {lang,accent,gender} ─▶ TTS layer ─▶ audio  (renders the ONE profile selected)
```

- The **text** is produced once — cached (pre-localized in all 10 languages) for the instant layer, or Claude for the personalized layer (prompted to write in the target language).
- The **TTS layer** (`src/tts.ts`) is a pure function `(text, profile) → audio`. Adding the 81st voice is one row in a config map — zero new code, zero extra per-session compute.
- **Two engines behind one seam**, the same degraded-mode pattern as the LLM: **ElevenLabs** (`eleven_turbo_v2_5`, multilingual, streaming, real-time) is primary; **expo-speech** (on-device system voices) is the automatic fallback on slow/error/no-key. The instant cached layer always uses on-device speech so it stays truly zero-latency; the personalized layer and the voice preview prefer ElevenLabs.
- **Accent** is carried by the chosen ElevenLabs voice (a curated voiceId per accent × gender; at runtime we fetch the account's `/v1/voices` and match by label, so it adapts to whatever the account provides). On the on-device fallback, accent maps to a regional locale (en-US/en-GB/en-AU/en-IN) where one exists, and the layer logs when it approximates.

**"Every track sounds different" is satisfied on two axes:** the **text** varies (Claude + the no-repeat cache) and the **voice** varies per profile (different ElevenLabs voice / system locale). Within a session the voice stays consistent (you don't switch voices on someone mid-meditation); across the 80 profiles every combination is a distinct rendering.

**Economics of 80:** the cost is *per rendered second of the selected voice*, not ×80. A user only ever hears their one profile. The matrix scales by configuration, not compute — which is exactly why it's cheap to go from 80 to 800.

## 6. Failure modes

- **LLM slow (>2.5 s), unreachable, or no API key:** the cached cue already played — the moment was covered. The generated cue is skipped *silently* and logged (`speechSkip`). This is the degraded mode, and it is indistinguishable from normal operation to the meditator.
- **Premium TTS slow / errors / no key:** the TTS layer falls back to on-device speech in the same language, logged as `speechEngine … via device`. Audio still plays; only the timbre degrades.
- **Stream gap:** last value carried forward, marked `gap:true`, no crash.
- **Out-of-order events:** reordered within a 3-event lookahead.
- **Malformed lines:** skipped and logged, never thrown.
- **Silence is always valid.** The coach saying nothing is the default state, so no failure path ever needs to invent speech.

## 7. Where the P2 hooks live

**On-device inference / privacy boundary:** the model boundary already sits where the PRD wants it — INGEST and DECIDE are pure on-device code with no network calls; the "focus detector" is on-device today. Only trigger snapshots (five numbers and three recent cue strings) reach the model, ~2 times per session. In production the exported log would hold aggregates (trigger times, cue ids, recovery latencies), not the raw stream.

**Personalization across sessions (design only):** no retraining needed — personalization is data the existing seams already produce. A per-user profile (which cue intents preceded the fastest recoveries, typical baseline, drift patterns) is computed from session logs and injected in two places: DECIDE reads tuned thresholds from `DETECTION_CONFIG` (already config-driven), and RESPOND feeds the profile into the prompt and biases cached-cue selection. The cue-promotion pipeline (§4) is the same mechanism: the user's own best-performing generated cues become their personal cache.

## 8. What I cut and why

- **Log infra:** in-memory array → JSON export. The replayability story doesn't need a database.
- **Multi-level user-defined difficulty (P1):** not in the loop's critical path.
- **Pre-generated / cached audio:** every cue is rendered on demand, not stored. Caching the *audio* of frequent cue×voice pairs is an obvious production optimization (and a cost lever), deliberately skipped here — the prototype's point is to prove real-time generation scales, not to optimize it.
- **Professional localization & accent coverage:** cached cues are translated for the prototype, and on-device accent coverage is partial (full regional accents for English, base locale elsewhere). ElevenLabs carries true accent variety; the on-device fallback degrades gracefully and logs when it approximates.
- **Eval harness:** described, not built — the design is an A/B of adaptive coach vs fixed-script sessions, scored on time-to-recovery after trigger, triggers-per-session, and post-session self-report. The intervention-precision metric is already measurable from the log (focus recovery slope after each cue).

## 9. What I'd build next

1. The eval harness above — it gates everything else.
2. The cue-promotion pipeline (validated generated cues → cache), extended to cache rendered **audio** per cue×voice for cost/latency.
3. Session-intent context (P1): pass the user's stated intention ("calm before a meeting") into the cue prompt.
4. Slope-based early detection to catch slow drifts before they cross the absolute floor.
5. Streaming TTS playback (first audio chunk while the rest renders) to shave the premium layer's time-to-first-sound further.
