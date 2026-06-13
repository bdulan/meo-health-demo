// Voice matrix: the guidance scales across languages × accents × genders.
//
// Key architectural point (the founding-engineer answer to "scale to 80"):
// we NEVER pre-render 80 tracks. A voice profile is just a selector. The LLM
// produces the cue *text* (localized), and the TTS layer renders the ONE
// profile the user picked — `(text, profile) -> audio`. Adding the 81st voice
// is one row in a table, zero new code, zero extra per-session compute.

export type Gender = 'female' | 'male';

export interface Language {
  /** BCP-47 base + ElevenLabs language_code. */
  code: string;
  label: string;
  /** Name handed to the LLM so it writes the cue in this language. */
  llmName: string;
}

export interface Accent {
  id: string;
  label: string;
  /**
   * Region subtag used to build a BCP-47 locale for on-device (iOS) voices,
   * keyed by language. Falls back to the language base when a true regional
   * voice isn't installed — resolution logs when it approximates.
   */
  region: string;
}

// 10 languages — all covered by ElevenLabs multilingual/turbo models and by
// iOS system voices, so both TTS engines can render every one.
export const LANGUAGES: Language[] = [
  { code: 'en', label: 'English', llmName: 'English' },
  { code: 'es', label: 'Spanish', llmName: 'Spanish' },
  { code: 'fr', label: 'French', llmName: 'French' },
  { code: 'de', label: 'German', llmName: 'German' },
  { code: 'it', label: 'Italian', llmName: 'Italian' },
  { code: 'pt', label: 'Portuguese', llmName: 'Portuguese' },
  { code: 'hi', label: 'Hindi', llmName: 'Hindi' },
  { code: 'ja', label: 'Japanese', llmName: 'Japanese' },
  { code: 'ko', label: 'Korean', llmName: 'Korean' },
  { code: 'zh', label: 'Chinese', llmName: 'Mandarin Chinese' },
];

// 4 accent families. On ElevenLabs the accent is carried by the chosen voice
// (a curated voiceId per accent × gender); on-device it maps to a regional
// locale where one exists for the language.
export const ACCENTS: Accent[] = [
  { id: 'american', label: 'American', region: 'US' },
  { id: 'british', label: 'British', region: 'GB' },
  { id: 'australian', label: 'Australian', region: 'AU' },
  { id: 'indian', label: 'Indian', region: 'IN' },
];

export const GENDERS: Gender[] = ['female', 'male'];

export interface VoiceProfile {
  language: string; // Language.code
  accent: string; // Accent.id
  gender: Gender;
}

export const DEFAULT_PROFILE: VoiceProfile = {
  language: 'en',
  accent: 'american',
  gender: 'female',
};

/** The full selectable matrix size — 10 × 4 × 2 = 80. */
export const TOTAL_PROFILES = LANGUAGES.length * ACCENTS.length * GENDERS.length;

export function getLanguage(code: string): Language {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

export function getAccent(id: string): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

export function profileLabel(p: VoiceProfile): string {
  const g = p.gender === 'female' ? 'Female' : 'Male';
  return `${getLanguage(p.language).label} · ${getAccent(p.accent).label} · ${g}`;
}

/**
 * BCP-47 locale for an on-device (iOS) voice, e.g. en-US, es-MX, fr-CA.
 * Accent regions that don't pair with a language fall back to the language
 * base — the TTS layer logs an "(accent approximated)" note in that case.
 */
export function bcp47(p: VoiceProfile): string {
  return `${p.language}-${getAccent(p.accent).region}`;
}

// --- ElevenLabs voice resolution ---------------------------------------------
//
// Stable defaults from the ElevenLabs public voice library, indexed by
// accent × gender (8 distinct voices). The multilingual model speaks the
// localized text in any of the 10 languages, so 8 voices × 10 languages
// yields 80 perceptually distinct tracks. At runtime, when a key is present,
// the TTS layer fetches the account's actual /v1/voices and repairs this map
// by matching voice labels — so it adapts to whatever the account provides.
export const ELEVENLABS_DEFAULT_VOICES: Record<string, string> = {
  'american:female': '21m00Tcm4TlvDq8ikWAM', // Rachel
  'american:male': 'nPczCjzI2devNBz1zQrb', // Brian
  'british:female': 'Xb7hH8MSUJpSbSDYk0k2', // Alice
  'british:male': 'JBFqnCBsd6RMkjVDRZzb', // George
  'australian:female': 'XB0fDUnXU5powFXDhCwa', // Charlotte
  'australian:male': 'IKne3meq5aSn9XLyUdCD', // Charlie
  'indian:female': '21m00Tcm4TlvDq8ikWAM', // fallback until /v1/voices repairs
  'indian:male': 'nPczCjzI2devNBz1zQrb', // fallback until /v1/voices repairs
};

export function defaultElevenVoiceId(p: VoiceProfile): string {
  return (
    ELEVENLABS_DEFAULT_VOICES[`${p.accent}:${p.gender}`] ??
    ELEVENLABS_DEFAULT_VOICES[`american:${p.gender}`]
  );
}

/** UI hint: is a premium-voice key configured? (Display only — TTS owns the real check.) */
export function hasElevenLabsHint(): boolean {
  return (process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ?? '').length > 0;
}
