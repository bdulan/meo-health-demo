// Pre-written cue cache: instant layer of the two-layer response.
// Pure data + selection logic (node-testable); speech happens in respond.ts.

export type CueIntent = 'breath' | 'body' | 'sound' | 'acknowledge';

export interface CachedCue {
  text: string;
  intent: CueIntent;
}

export const CACHED_CUES: CachedCue[] = [
  { text: 'Notice the breath moving on its own. Let it carry you back.', intent: 'breath' },
  { text: 'Follow one full breath, from the very start to the very end.', intent: 'breath' },
  { text: 'Feel the weight of your hands, exactly where they rest.', intent: 'body' },
  { text: 'Soften the shoulders. Let the body settle a little deeper.', intent: 'body' },
  { text: 'Let the farthest sound you can hear hold your attention.', intent: 'sound' },
  { text: 'Rest in the quiet between sounds for a moment.', intent: 'sound' },
  { text: 'Minds wander. Nothing is wrong. Begin again, gently.', intent: 'acknowledge' },
  { text: 'That was a thought. Notice it, and come back.', intent: 'acknowledge' },
];

/**
 * Pick a cached cue, never repeating any of the most recently used texts.
 * Sharp drops favor grounding intents (breath/body); slow drifts favor
 * re-engagement (sound/acknowledge). Falls back to any non-recent cue.
 */
export function pickCachedCue(
  triggerType: 'sharp' | 'slow',
  recentTexts: string[],
  cues: CachedCue[] = CACHED_CUES
): CachedCue {
  const preferred: CueIntent[] =
    triggerType === 'sharp' ? ['breath', 'body'] : ['sound', 'acknowledge'];
  const fresh = cues.filter((c) => !recentTexts.includes(c.text));
  const pool = fresh.length > 0 ? fresh : cues;
  const preferredPool = pool.filter((c) => preferred.includes(c.intent));
  const finalPool = preferredPool.length > 0 ? preferredPool : pool;
  // deterministic rotation: pick the first candidate (recency filter provides variety)
  return finalPool[0];
}
