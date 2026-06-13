// TTS layer: turns cue text + a voice profile into audio.
//
// Two engines behind one seam — the same degraded-mode pattern as the LLM:
//   • ElevenLabs (premium): multilingual, real-time, 80 distinct voices.
//   • expo-speech (on-device): zero-latency, offline, localized system voices.
//
// Strategy by layer:
//   • 'cached'  → on-device only (the instant layer must never wait on a network).
//   • 'llm'     → ElevenLabs within budget, else fall back to on-device.
//   • 'preview' → ElevenLabs if a key exists, else on-device — for the voice picker.
//
// RESPOND and the UI just call speak(); they never know which engine ran.

import * as Speech from 'expo-speech';
import { TTS_CONFIG } from './config';
import { NativeAudioHandle, playAudioBytes } from './nativeAudio';
import {
  Accent,
  bcp47,
  defaultElevenVoiceId,
  getAccent,
  getLanguage,
  VoiceProfile,
} from './voices';

const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '';

export type TtsLayer = 'cached' | 'llm' | 'preview';
export type TtsEngine = 'elevenlabs' | 'device';

export interface SpeakResult {
  engine: TtsEngine;
  latencyMs: number;
  note?: string;
}

export interface SpeakOptions {
  layer: TtsLayer;
  onStart?: (engine: TtsEngine) => void;
  onDone?: () => void;
  budgetMs?: number;
}

export function hasElevenLabs(): boolean {
  return ELEVENLABS_API_KEY.length > 0;
}

interface ElevenVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

export class TtsEngineManager {
  private voicesCache: ElevenVoice[] | null = null;
  private resolved = new Map<string, string>(); // "accent:gender" -> voiceId
  private audioHandle: NativeAudioHandle | null = null;

  /** Speak `text` in the given profile. Resolves once audio has *started*. */
  async speak(text: string, profile: VoiceProfile, opts: SpeakOptions): Promise<SpeakResult> {
    const started = Date.now();
    const preferPremium = opts.layer !== 'cached' && hasElevenLabs();

    if (preferPremium) {
      try {
        const note = await this.speakElevenLabs(text, profile, opts);
        return { engine: 'elevenlabs', latencyMs: Date.now() - started, note };
      } catch (err) {
        // fall through to on-device — the moment is still covered
        this.speakDevice(text, profile, opts);
        return {
          engine: 'device',
          latencyMs: Date.now() - started,
          note: `ElevenLabs fell back: ${String((err as Error)?.message ?? err)}`,
        };
      }
    }

    const { note } = this.speakDevice(text, profile, opts);
    return { engine: 'device', latencyMs: Date.now() - started, note };
  }

  // --- on-device (expo-speech) ------------------------------------------------
  private speakDevice(text: string, profile: VoiceProfile, opts: SpeakOptions): { note?: string } {
    const accent = getAccent(profile.accent);
    const locale = this.deviceLocale(profile, accent);
    opts.onStart?.('device');
    Speech.speak(text, {
      language: locale,
      rate: TTS_CONFIG.deviceRate,
      onDone: () => opts.onDone?.(),
      onError: () => opts.onDone?.(),
    });
    const approximated = locale === profile.language; // no regional variant available
    return approximated ? { note: `accent approximated on device (${profile.language})` } : {};
  }

  /** A regional locale if the accent pairs with the language, else the base. */
  private deviceLocale(profile: VoiceProfile, accent: Accent): string {
    // English carries true regional accents; other languages fall back to base
    // unless their region genuinely exists. Keep it honest and simple.
    const regionalLanguages = new Set(['en']);
    if (regionalLanguages.has(profile.language)) return bcp47(profile);
    return profile.language;
  }

  // --- ElevenLabs (premium) ---------------------------------------------------
  private async speakElevenLabs(
    text: string,
    profile: VoiceProfile,
    opts: SpeakOptions
  ): Promise<string | undefined> {
    const voiceId = await this.resolveVoiceId(profile);
    const budgetMs = opts.budgetMs ?? TTS_CONFIG.premiumBudgetMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${TTS_CONFIG.elevenLabsFormat}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'xi-api-key': ELEVENLABS_API_KEY,
          },
          body: JSON.stringify({
            text,
            model_id: TTS_CONFIG.elevenLabsModel,
            language_code: getLanguage(profile.language).code,
          }),
        }
      );
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      await this.play(bytes, opts);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Resolve accent×gender → a real voiceId from the account, repairing defaults. */
  private async resolveVoiceId(profile: VoiceProfile): Promise<string> {
    const key = `${profile.accent}:${profile.gender}`;
    const cached = this.resolved.get(key);
    if (cached) return cached;

    if (!this.voicesCache) {
      try {
        const res = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': ELEVENLABS_API_KEY },
        });
        if (res.ok) this.voicesCache = (await res.json())?.voices ?? [];
        else this.voicesCache = [];
      } catch {
        this.voicesCache = [];
      }
    }

    const accent = getAccent(profile.accent).label.toLowerCase();
    const match = this.voicesCache!.find((v) => {
      const a = (v.labels?.accent ?? '').toLowerCase();
      const g = (v.labels?.gender ?? '').toLowerCase();
      return a.includes(accent) && g === profile.gender;
    });
    const byGender = this.voicesCache!.find(
      (v) => (v.labels?.gender ?? '').toLowerCase() === profile.gender
    );
    const voiceId = match?.voice_id ?? byGender?.voice_id ?? defaultElevenVoiceId(profile);
    this.resolved.set(key, voiceId);
    return voiceId;
  }

  // --- playback ---------------------------------------------------------------
  // Platform-split: nativeAudio.web.ts uses HTML5 Audio; nativeAudio.ts uses
  // expo-audio. Metro resolves the right one, so expo-audio never hits web.
  private async play(bytes: ArrayBuffer, opts: SpeakOptions): Promise<void> {
    this.audioHandle = await playAudioBytes(
      bytes,
      () => opts.onStart?.('elevenlabs'),
      () => opts.onDone?.()
    );
  }

  stop(): void {
    Speech.stop();
    if (this.audioHandle) {
      this.audioHandle.stop();
      this.audioHandle = null;
    }
  }
}
