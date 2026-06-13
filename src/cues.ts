// Pre-written cue cache: the instant layer of the two-layer response.
// Pure data + selection logic (node-testable); speech happens in tts.ts.
//
// The cache is localized per language so the instant layer is BOTH instant and
// in the meditator's language — no translation round-trip on the hot path.
// English carries two cues per intent; the other languages carry one per intent
// (enough for the no-repeat rotation). Production would expand these with
// professionally localized copy; the structure is the point.

export type CueIntent = 'breath' | 'body' | 'sound' | 'acknowledge';

export interface CachedCue {
  text: string;
  intent: CueIntent;
}

const EN: CachedCue[] = [
  { text: 'Notice the breath moving on its own. Let it carry you back.', intent: 'breath' },
  { text: 'Follow one full breath, from the very start to the very end.', intent: 'breath' },
  { text: 'Feel the weight of your hands, exactly where they rest.', intent: 'body' },
  { text: 'Soften the shoulders. Let the body settle a little deeper.', intent: 'body' },
  { text: 'Let the farthest sound you can hear hold your attention.', intent: 'sound' },
  { text: 'Rest in the quiet between sounds for a moment.', intent: 'sound' },
  { text: 'Minds wander. Nothing is wrong. Begin again, gently.', intent: 'acknowledge' },
  { text: 'That was a thought. Notice it, and come back.', intent: 'acknowledge' },
];

const ES: CachedCue[] = [
  { text: 'Observa la respiración que fluye por sí sola. Deja que te traiga de vuelta.', intent: 'breath' },
  { text: 'Siente el peso de tus manos, justo donde descansan.', intent: 'body' },
  { text: 'Deja que el sonido más lejano que oigas sostenga tu atención.', intent: 'sound' },
  { text: 'La mente divaga. No pasa nada. Vuelve a empezar, con suavidad.', intent: 'acknowledge' },
];

const FR: CachedCue[] = [
  { text: 'Observe le souffle qui va de lui-même. Laisse-le te ramener.', intent: 'breath' },
  { text: 'Sens le poids de tes mains, là où elles reposent.', intent: 'body' },
  { text: 'Laisse le son le plus lointain retenir ton attention.', intent: 'sound' },
  { text: "L'esprit vagabonde. Tout va bien. Recommence, doucement.", intent: 'acknowledge' },
];

const DE: CachedCue[] = [
  { text: 'Beobachte den Atem, wie er von selbst fließt. Lass ihn dich zurückführen.', intent: 'breath' },
  { text: 'Spüre das Gewicht deiner Hände, genau dort, wo sie ruhen.', intent: 'body' },
  { text: 'Lass den fernsten Klang, den du hörst, deine Aufmerksamkeit halten.', intent: 'sound' },
  { text: 'Der Geist wandert. Es ist nichts falsch. Beginne sanft von Neuem.', intent: 'acknowledge' },
];

const IT: CachedCue[] = [
  { text: 'Osserva il respiro che scorre da solo. Lascia che ti riporti indietro.', intent: 'breath' },
  { text: 'Senti il peso delle tue mani, proprio dove riposano.', intent: 'body' },
  { text: 'Lascia che il suono più lontano che senti tenga la tua attenzione.', intent: 'sound' },
  { text: 'La mente vaga. Va tutto bene. Ricomincia, con dolcezza.', intent: 'acknowledge' },
];

const PT: CachedCue[] = [
  { text: 'Observe a respiração que flui sozinha. Deixe que ela te traga de volta.', intent: 'breath' },
  { text: 'Sinta o peso das suas mãos, exatamente onde repousam.', intent: 'body' },
  { text: 'Deixe o som mais distante que você ouve segurar a sua atenção.', intent: 'sound' },
  { text: 'A mente divaga. Não há nada de errado. Recomece, com suavidade.', intent: 'acknowledge' },
];

const HI: CachedCue[] = [
  { text: 'साँस को अपने आप चलते हुए देखें। उसे आपको वापस लाने दें।', intent: 'breath' },
  { text: 'अपने हाथों का भार महसूस करें, ठीक वहीं जहाँ वे टिके हैं।', intent: 'body' },
  { text: 'जो सबसे दूर की आवाज़ सुनाई दे, उसे अपना ध्यान थामने दें।', intent: 'sound' },
  { text: 'मन भटकता है। कुछ ग़लत नहीं है। धीरे से फिर शुरू करें।', intent: 'acknowledge' },
];

const JA: CachedCue[] = [
  { text: '呼吸が自然に流れるのを感じてください。それに身をゆだねて戻りましょう。', intent: 'breath' },
  { text: '手の重みを、置かれているそのままに感じてください。', intent: 'body' },
  { text: '聞こえる中で最も遠い音に、そっと意識を預けましょう。', intent: 'sound' },
  { text: '心はさまようもの。問題はありません。もう一度、そっと始めましょう。', intent: 'acknowledge' },
];

const KO: CachedCue[] = [
  { text: '숨이 저절로 흐르는 것을 느껴 보세요. 그 숨이 당신을 돌아오게 두세요.', intent: 'breath' },
  { text: '두 손의 무게를, 놓인 그대로 느껴 보세요.', intent: 'body' },
  { text: '들리는 소리 중 가장 먼 소리에 주의를 머물게 하세요.', intent: 'sound' },
  { text: '마음은 떠돌기 마련입니다. 잘못된 건 없어요. 다시, 부드럽게 시작하세요.', intent: 'acknowledge' },
];

const ZH: CachedCue[] = [
  { text: '觉察呼吸自然地流动，让它带你回来。', intent: 'breath' },
  { text: '感受双手的重量，就在它们安放的地方。', intent: 'body' },
  { text: '让你能听到的最远的声音，留住你的注意力。', intent: 'sound' },
  { text: '心会游走，这并没有错。温柔地，重新开始。', intent: 'acknowledge' },
];

export const CACHED_CUES_BY_LANG: Record<string, CachedCue[]> = {
  en: EN,
  es: ES,
  fr: FR,
  de: DE,
  it: IT,
  pt: PT,
  hi: HI,
  ja: JA,
  ko: KO,
  zh: ZH,
};

/** English set, kept exported for back-compat and as the universal fallback. */
export const CACHED_CUES = EN;

export function cuesForLanguage(language: string): CachedCue[] {
  return CACHED_CUES_BY_LANG[language] ?? EN;
}

/**
 * Pick a cached cue in the given language, never repeating a recently-used text.
 * Sharp drops favor grounding intents (breath/body); slow drifts favor
 * re-engagement (sound/acknowledge). Falls back to any non-recent cue.
 */
export function pickCachedCue(
  triggerType: 'sharp' | 'slow',
  recentTexts: string[],
  language: string = 'en'
): CachedCue {
  const cues = cuesForLanguage(language);
  const preferred: CueIntent[] =
    triggerType === 'sharp' ? ['breath', 'body'] : ['sound', 'acknowledge'];
  const fresh = cues.filter((c) => !recentTexts.includes(c.text));
  const pool = fresh.length > 0 ? fresh : cues;
  const preferredPool = pool.filter((c) => preferred.includes(c.intent));
  const finalPool = preferredPool.length > 0 ? preferredPool : pool;
  // deterministic rotation: pick the first candidate (recency filter provides variety)
  return finalPool[0];
}
