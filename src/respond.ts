// RESPOND: two-layer output — the latency answer.
// Layer 1 (instant, on-device): a cached cue, localized, spoken immediately.
// Layer 2 (async, premium): Claude writes a personalized cue in the user's
//   language; the TTS layer renders it in the selected voice (ElevenLabs, with
//   on-device fallback). If Claude is slow/errors, it is skipped silently —
//   the cached cue already covered the moment. That IS the degraded mode.
//
// Voice selection (language × accent × gender) is a property of the session,
// passed in from the UI; RESPOND just hands it to the TTS layer.

import { RESPOND_CONFIG } from './config';
import { pickCachedCue } from './cues';
import { SessionLog } from './log';
import { TtsEngine, TtsEngineManager } from './tts';
import { TriggerEvent } from './types';
import { DEFAULT_PROFILE, getLanguage, profileLabel, VoiceProfile } from './voices';

const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

function systemPrompt(languageName: string): string {
  return (
    'You are a meditation coach for Meo. Voice: calm, clinical, real. Generate ONE short spoken cue ' +
    `(≤ 18 words) to gently guide a distracted meditator back. Write it in ${languageName}. ` +
    'It must differ in intent or modality from the recent cues provided. ' +
    'No preamble, no quotes — output only the cue text.'
  );
}

export interface CueSpokenInfo {
  text: string;
  layer: 'cached' | 'llm';
  engine: TtsEngine;
}

export class Responder {
  private recentCues: string[] = [];
  private speakingCached = false;
  private pendingLlmCue: string | null = null;
  private profile: VoiceProfile = DEFAULT_PROFILE;
  private tts = new TtsEngineManager();

  constructor(
    private log: SessionLog,
    private onCueSpoken?: (info: CueSpokenInfo) => void
  ) {}

  setProfile(profile: VoiceProfile): void {
    this.profile = profile;
  }

  /** Speak a sample cue in the current voice — drives the UI "Preview" button. */
  async preview(text: string): Promise<void> {
    this.log.append('speechStart', { layer: 'preview', text, profile: profileLabel(this.profile) });
    const r = await this.tts.speak(text, this.profile, { layer: 'preview' });
    this.log.append('llmResponse', { preview: true, engine: r.engine, note: r.note });
  }

  /** Handle a trigger: speak cached cue now, race Claude for a personalized follow-up. */
  handleTrigger(trigger: TriggerEvent): void {
    const cue = pickCachedCue(trigger.type, this.recentCues, this.profile.language);
    this.rememberCue(cue.text);
    void this.speakCached(cue.text, trigger.tSec);
    void this.requestLlmCue(trigger); // concurrent; never blocks the instant layer
  }

  private async speakCached(text: string, tSec: number): Promise<void> {
    this.speakingCached = true;
    this.log.append('speechStart', { layer: 'cached', text, profile: profileLabel(this.profile) }, tSec);
    const result = await this.tts.speak(text, this.profile, {
      layer: 'cached',
      onDone: () => this.flushPendingLlmCue(),
    });
    this.onCueSpoken?.({ text, layer: 'cached', engine: result.engine });
  }

  private flushPendingLlmCue(): void {
    this.speakingCached = false;
    if (this.pendingLlmCue) {
      const text = this.pendingLlmCue;
      this.pendingLlmCue = null;
      void this.speakLlm(text);
    }
  }

  private async speakLlm(text: string): Promise<void> {
    this.log.append('speechStart', { layer: 'llm', text, profile: profileLabel(this.profile) });
    const result = await this.tts.speak(text, this.profile, { layer: 'llm' });
    this.log.append('speechEngine', { layer: 'llm', engine: result.engine, note: result.note });
    this.onCueSpoken?.({ text, layer: 'llm', engine: result.engine });
  }

  private async requestLlmCue(trigger: TriggerEvent): Promise<void> {
    if (!ANTHROPIC_API_KEY) {
      this.log.append('speechSkip', { reason: 'no LLM key — cached layer only' }, trigger.tSec);
      return;
    }
    const lang = getLanguage(this.profile.language);
    const requestPayload = {
      triggerType: trigger.type,
      currentFocus: trigger.currentFocus,
      baseline: trigger.baseline,
      secondsDrifting: trigger.secondsDrifting,
      language: lang.llmName,
      recentCues: this.recentCues.slice(-RESPOND_CONFIG.noRepeatWindow),
    };
    this.log.append('llmRequest', { model: RESPOND_CONFIG.model, ...requestPayload }, trigger.tSec);
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RESPOND_CONFIG.llmBudgetMs);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: RESPOND_CONFIG.model,
          max_tokens: RESPOND_CONFIG.maxTokens,
          system: systemPrompt(lang.llmName),
          messages: [{ role: 'user', content: JSON.stringify(requestPayload) }],
        }),
      });
      clearTimeout(timeout);
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        this.log.append('speechSkip', { reason: `LLM HTTP ${res.status}`, latencyMs });
        return;
      }
      const data = await res.json();
      const text: string = (data?.content?.[0]?.text ?? '').trim();
      if (!text || latencyMs > RESPOND_CONFIG.llmBudgetMs) {
        this.log.append('speechSkip', { reason: text ? 'over latency budget' : 'empty response', latencyMs });
        return;
      }
      this.log.append('llmResponse', { text, latencyMs });
      this.rememberCue(text);
      if (this.speakingCached) {
        this.pendingLlmCue = text; // queue: speaks when the cached cue finishes
      } else {
        void this.speakLlm(text);
      }
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.log.append('speechSkip', {
        reason: aborted ? 'LLM over latency budget (aborted)' : `LLM error: ${String(err)}`,
        latencyMs: Date.now() - started,
      });
    }
  }

  private rememberCue(text: string): void {
    this.recentCues.push(text);
    if (this.recentCues.length > RESPOND_CONFIG.noRepeatWindow) this.recentCues.shift();
  }

  reset(): void {
    this.tts.stop();
    this.recentCues = [];
    this.speakingCached = false;
    this.pendingLlmCue = null;
  }
}
