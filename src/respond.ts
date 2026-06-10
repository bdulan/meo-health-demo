// RESPOND: two-layer output — the latency answer.
// Layer 1 (0 ms): cached cue spoken instantly via on-device TTS.
// Layer 2 (async): Claude generates a personalized cue; if it arrives within
// budget it speaks after the cached cue, otherwise it is skipped silently.
// Skipping IS the degraded mode — the cached cue already covered the moment.

import * as Speech from 'expo-speech';
import { RESPOND_CONFIG } from './config';
import { pickCachedCue } from './cues';
import { SessionLog } from './log';
import { TriggerEvent } from './types';

const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

const SYSTEM_PROMPT =
  'You are a meditation coach for Meo. Voice: calm, clinical, real. Generate ONE short spoken cue ' +
  '(≤ 18 words) to gently guide a distracted meditator back. It must differ in intent or modality ' +
  'from the recent cues provided. No preamble, no quotes — output only the cue text.';

export class Responder {
  private recentCues: string[] = [];
  private speakingCached = false;
  private pendingLlmCue: string | null = null;
  private onCueSpoken?: (text: string, layer: 'cached' | 'llm') => void;

  constructor(private log: SessionLog, onCueSpoken?: (text: string, layer: 'cached' | 'llm') => void) {
    this.onCueSpoken = onCueSpoken;
  }

  /** Handle a trigger: speak cached cue now, race Claude for a personalized follow-up. */
  handleTrigger(trigger: TriggerEvent): void {
    const cue = pickCachedCue(trigger.type, this.recentCues);
    this.rememberCue(cue.text);
    this.speakCached(cue.text, trigger.tSec);
    void this.requestLlmCue(trigger); // concurrent; never blocks the instant layer
  }

  private speakCached(text: string, tSec: number): void {
    this.speakingCached = true;
    this.log.append('speechStart', { layer: 'cached', text }, tSec);
    this.onCueSpoken?.(text, 'cached');
    Speech.speak(text, {
      rate: 0.92,
      onDone: () => this.flushPendingLlmCue(),
      onError: () => this.flushPendingLlmCue(),
    });
  }

  private flushPendingLlmCue(): void {
    this.speakingCached = false;
    if (this.pendingLlmCue) {
      const text = this.pendingLlmCue;
      this.pendingLlmCue = null;
      this.log.append('speechStart', { layer: 'llm', text });
      this.onCueSpoken?.(text, 'llm');
      Speech.speak(text, { rate: 0.92 });
    }
  }

  private async requestLlmCue(trigger: TriggerEvent): Promise<void> {
    if (!ANTHROPIC_API_KEY) {
      this.log.append('speechSkip', { reason: 'no API key configured — cached layer only' }, trigger.tSec);
      return;
    }
    const requestPayload = {
      triggerType: trigger.type,
      currentFocus: trigger.currentFocus,
      baseline: trigger.baseline,
      secondsDrifting: trigger.secondsDrifting,
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
          system: SYSTEM_PROMPT,
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
        this.log.append('speechStart', { layer: 'llm', text });
        this.onCueSpoken?.(text, 'llm');
        Speech.speak(text, { rate: 0.92 });
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
    Speech.stop();
    this.recentCues = [];
    this.speakingCached = false;
    this.pendingLlmCue = null;
  }
}
