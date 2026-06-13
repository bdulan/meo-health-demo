import {
  ACCENTS,
  bcp47,
  defaultElevenVoiceId,
  GENDERS,
  LANGUAGES,
  profileLabel,
  TOTAL_PROFILES,
  VoiceProfile,
} from '../src/voices';
import { cuesForLanguage, pickCachedCue } from '../src/cues';

describe('voice matrix', () => {
  test('the selectable matrix is exactly 10 × 4 × 2 = 80 profiles', () => {
    expect(LANGUAGES).toHaveLength(10);
    expect(ACCENTS).toHaveLength(4);
    expect(GENDERS).toHaveLength(2);
    expect(TOTAL_PROFILES).toBe(80);
  });

  test('every one of the 80 profiles resolves to a label, locale, and a voice id', () => {
    let count = 0;
    for (const l of LANGUAGES) {
      for (const a of ACCENTS) {
        for (const g of GENDERS) {
          const p: VoiceProfile = { language: l.code, accent: a.id, gender: g };
          expect(profileLabel(p)).toContain(l.label);
          expect(bcp47(p)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
          expect(defaultElevenVoiceId(p)).toBeTruthy();
          count++;
        }
      }
    }
    expect(count).toBe(80);
  });

  test('English carries true regional accents in the locale', () => {
    expect(bcp47({ language: 'en', accent: 'british', gender: 'male' })).toBe('en-GB');
    expect(bcp47({ language: 'en', accent: 'australian', gender: 'female' })).toBe('en-AU');
  });
});

describe('localized cached cues', () => {
  test('all 10 languages have cues covering all four intents', () => {
    const intents = ['breath', 'body', 'sound', 'acknowledge'];
    for (const l of LANGUAGES) {
      const cues = cuesForLanguage(l.code);
      expect(cues.length).toBeGreaterThanOrEqual(4);
      for (const intent of intents) {
        expect(cues.some((c) => c.intent === intent)).toBe(true);
      }
    }
  });

  test('cue selection returns text in the requested language', () => {
    const es = pickCachedCue('sharp', [], 'es');
    expect(cuesForLanguage('es').map((c) => c.text)).toContain(es.text);
    const ja = pickCachedCue('slow', [], 'ja');
    expect(cuesForLanguage('ja').map((c) => c.text)).toContain(ja.text);
  });

  test('unknown language falls back to English without throwing', () => {
    expect(() => pickCachedCue('sharp', [], 'xx')).not.toThrow();
    expect(cuesForLanguage('xx')).toBe(cuesForLanguage('en'));
  });
});
