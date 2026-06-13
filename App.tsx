import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ORB_TRANSITION_MS, SPEED, ZONE_COLORS, zoneIndex, zoneLabel } from './src/config';
import { cuesForLanguage } from './src/cues';
import { createDetector } from './src/decide';
import { parseReplay, play, Player } from './src/ingest';
import { SessionLog } from './src/log';
import { loadReplayText } from './src/replayAsset';
import { CueSpokenInfo, Responder } from './src/respond';
import { DetectorStateName, LogEvent } from './src/types';
import {
  ACCENTS,
  DEFAULT_PROFILE,
  Gender,
  GENDERS,
  hasElevenLabsHint,
  LANGUAGES,
  profileLabel,
  TOTAL_PROFILES,
  VoiceProfile,
} from './src/voices';

const TRAIL_HIDDEN_TYPES = new Set(['reading', 'baselineUpdate']);
const TRAIL_MAX = 80;

const STATE_COLORS: Record<DetectorStateName, string> = {
  WARMUP: '#8e8e93',
  MONITORING: '#34c759',
  DRIFTING: '#ff9f0a',
  TRIGGERED: '#ff453a',
};

/** The meo orb: glides between zone colors as the meditator moves zones. */
function ZoneOrb({ focus }: { focus: number | null }) {
  const anim = useRef(new Animated.Value(0)).current;
  const idx = focus === null ? 0 : zoneIndex(focus);
  useEffect(() => {
    Animated.timing(anim, {
      toValue: idx,
      duration: ORB_TRANSITION_MS,
      useNativeDriver: false, // color interpolation requires the JS driver
    }).start();
  }, [idx, anim]);
  const backgroundColor = anim.interpolate({
    inputRange: ZONE_COLORS.map((_, i) => i),
    outputRange: ZONE_COLORS,
  });
  return (
    <Animated.View style={[styles.orb, { backgroundColor }]}>
      <View style={styles.orbHighlight} />
    </Animated.View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [tSec, setTSec] = useState(0);
  const [focus, setFocus] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [detState, setDetState] = useState<DetectorStateName>('WARMUP');
  const [focusStreak, setFocusStreak] = useState(0);
  const [lastCue, setLastCue] = useState<CueSpokenInfo | null>(null);
  const [trail, setTrail] = useState<LogEvent[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [profile, setProfile] = useState<VoiceProfile>(DEFAULT_PROFILE);

  const logRef = useRef(new SessionLog());
  const playerRef = useRef<Player | null>(null);
  const responderRef = useRef<Responder | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // One responder for the whole session — created lazily so Preview works
  // before Start. Always reflects the latest selected voice profile.
  const ensureResponder = useCallback((): Responder => {
    if (!responderRef.current) {
      responderRef.current = new Responder(logRef.current, (info) => setLastCue(info));
    }
    return responderRef.current;
  }, []);

  useEffect(() => {
    ensureResponder().setProfile(profile);
  }, [profile, ensureResponder]);

  const previewVoice = useCallback(() => {
    const sample = cuesForLanguage(profile.language)[0].text;
    const r = ensureResponder();
    r.setProfile(profile);
    void r.preview(sample);
  }, [profile, ensureResponder]);

  const start = useCallback(async () => {
    if (running) return;
    const log = logRef.current;
    log.clear();
    setTrail([]);
    setFinished(false);
    setLastCue(null);
    setExportNote(null);

    unsubRef.current?.();
    unsubRef.current = log.onEvent((e) => {
      setEventCount(log.count());
      if (!TRAIL_HIDDEN_TYPES.has(e.type)) {
        setTrail((prev) => [e, ...prev].slice(0, TRAIL_MAX));
      }
    });

    const responder = ensureResponder();
    responder.setProfile(profile);
    const detector = createDetector();

    let text: string;
    try {
      text = await loadReplayText();
    } catch (err) {
      log.append('ingestWarning', { reason: `failed to load replay asset: ${String(err)}` });
      return;
    }
    const parsed = parseReplay(text);
    log.append('sessionStart', {
      speed: SPEED,
      voice: profileLabel(profile),
      readings: parsed.readings.length,
      skippedLines: parsed.skippedLines.length,
      reordered: parsed.reorderedCount,
      gapFills: parsed.gapFillCount,
    });
    for (const s of parsed.skippedLines) log.append('ingestWarning', s);
    if (parsed.reorderedCount > 0)
      log.append('ingestWarning', { reason: `reordered ${parsed.reorderedCount} out-of-order event(s)` });
    if (parsed.gapFillCount > 0)
      log.append('ingestWarning', { reason: `carried forward across ${parsed.gapFillCount} missing second(s)` });

    setRunning(true);
    playerRef.current = play(
      parsed.readings,
      SPEED,
      (reading) => {
        log.append('reading', { focus: reading.focus, gap: reading.gap }, reading.tSec);
        const out = detector.step(reading);
        log.append('baselineUpdate', { baseline: out.baseline }, reading.tSec);
        if (out.stateChange) log.append('stateChange', { ...out.stateChange }, reading.tSec);
        if (out.trigger) {
          log.append('trigger', { ...out.trigger }, reading.tSec);
          responder.handleTrigger(out.trigger);
        }
        setTSec(reading.tSec);
        setFocus(reading.focus);
        setBaseline(out.baseline);
        setDetState(out.state);
        setFocusStreak(out.focusStreakSec);
      },
      () => {
        log.append('sessionEnd', {
          totalEvents: log.count(),
          triggers: log.all().filter((e) => e.type === 'trigger').length,
        });
        setRunning(false);
        setFinished(true);
      }
    );
  }, [running, profile, ensureResponder]);

  const reset = useCallback(() => {
    playerRef.current?.stop();
    responderRef.current?.reset();
    logRef.current.clear();
    setRunning(false);
    setFinished(false);
    setTSec(0);
    setFocus(null);
    setBaseline(null);
    setDetState('WARMUP');
    setFocusStreak(0);
    setLastCue(null);
    setTrail([]);
    setEventCount(0);
    setExportNote(null);
  }, []);

  const exportLog = useCallback(async () => {
    const json = logRef.current.toJSON();
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'meo-session-log.json';
        a.click();
        URL.revokeObjectURL(url);
        setExportNote('Log downloaded as meo-session-log.json');
      } else {
        const { File, Paths } = await import('expo-file-system');
        const Sharing = await import('expo-sharing');
        const file = new File(Paths.cache, 'meo-session-log.json');
        if (file.exists) file.delete();
        file.create();
        file.write(json);
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
        setExportNote('Log shared');
      }
    } catch (err) {
      setExportNote(`Export failed: ${String(err)}`);
    }
  }, []);

  const mins = Math.floor(tSec / 60);
  const secs = tSec % 60;
  const lastCueHeader = lastCue
    ? `LAST CUE · ${lastCue.layer === 'cached' ? 'INSTANT' : 'PERSONALIZED (CLAUDE)'} · ${
        lastCue.engine === 'elevenlabs' ? 'ELEVENLABS' : 'ON-DEVICE'
      }`
    : 'LAST CUE';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>Meo · Adaptive Coach</Text>
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          replay {mins}:{String(secs).padStart(2, '0')} · {SPEED}x · {eventCount} events ·{' '}
        </Text>
        <Text style={[styles.stateInline, { color: STATE_COLORS[detState] }]}>{detState}</Text>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>FLOW</Text>
          <Text style={styles.focusNumber}>{focus !== null ? Math.round(focus) : '—'}</Text>
          <Text style={styles.zone}>
            {focusStreak >= 60 ? `silent ${focusStreak}s ✓` : `focus streak ${focusStreak}s`}
          </Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>BASELINE</Text>
          <Text style={styles.baselineNumber}>{baseline !== null ? baseline.toFixed(1) : '—'}</Text>
          <Text style={styles.zone}>rolling 60s mean</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>MEDITATIVE ZONE</Text>
          <ZoneOrb focus={focus} />
          <Text style={styles.zone}>{focus !== null ? zoneLabel(focus) : 'waiting'}</Text>
        </View>
      </View>

      {/* Voice selector — language × accent × gender = the 80-voice matrix */}
      <View style={styles.voiceBox}>
        <View style={styles.voiceHeaderRow}>
          <Text style={styles.statLabel}>VOICE · {TOTAL_PROFILES} profiles</Text>
          <Pressable style={styles.previewBtn} onPress={previewVoice}>
            <Text style={styles.previewBtnText}>🔊 Preview</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {LANGUAGES.map((l) => (
            <Chip
              key={l.code}
              label={l.label}
              active={profile.language === l.code}
              onPress={() => setProfile((p) => ({ ...p, language: l.code }))}
            />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {ACCENTS.map((a) => (
            <Chip
              key={a.id}
              label={a.label}
              active={profile.accent === a.id}
              onPress={() => setProfile((p) => ({ ...p, accent: a.id }))}
            />
          ))}
          {GENDERS.map((g: Gender) => (
            <Chip
              key={g}
              label={g === 'female' ? 'Female' : 'Male'}
              active={profile.gender === g}
              onPress={() => setProfile((p) => ({ ...p, gender: g }))}
            />
          ))}
        </ScrollView>
        <Text style={styles.voiceCaption}>
          {profileLabel(profile)} · {hasElevenLabsHint() ? 'ElevenLabs premium' : 'on-device (no TTS key)'}
        </Text>
      </View>

      <View style={styles.cueBox}>
        <Text style={styles.statLabel}>{lastCueHeader}</Text>
        <Text style={styles.cueText}>
          {lastCue ? `“${lastCue.text}”` : 'Silence is the default state.'}
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={running || finished ? reset : start}>
          <Text style={styles.buttonText}>{running || finished ? 'Reset' : 'Start'}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonSecondary, eventCount === 0 && styles.buttonDisabled]}
          onPress={exportLog}
          disabled={eventCount === 0}
        >
          <Text style={styles.buttonText}>Export Log</Text>
        </Pressable>
      </View>
      {exportNote ? <Text style={styles.exportNote}>{exportNote}</Text> : null}

      <Text style={styles.trailHeader}>EVENT TRAIL</Text>
      <FlatList
        style={styles.trail}
        data={trail}
        keyExtractor={(item, i) => `${item.ts}-${i}`}
        renderItem={({ item }) => (
          <Text style={styles.trailItem}>
            <Text style={styles.trailTime}>
              {item.tSec !== undefined ? `t+${String(item.tSec).padStart(3, ' ')}s ` : '       '}
            </Text>
            <Text style={[styles.trailType, { color: trailColor(item.type) }]}>{item.type}</Text>
            <Text> {summarize(item)}</Text>
          </Text>
        )}
      />
    </View>
  );
}

function trailColor(type: string): string {
  switch (type) {
    case 'trigger':
      return '#ff453a';
    case 'stateChange':
      return '#ff9f0a';
    case 'speechStart':
    case 'speechEngine':
      return '#0a84ff';
    case 'llmRequest':
    case 'llmResponse':
      return '#bf5af2';
    case 'speechSkip':
    case 'ingestWarning':
      return '#8e8e93';
    default:
      return '#e5e5ea';
  }
}

function summarize(e: LogEvent): string {
  const p = e.payload as Record<string, any>;
  switch (e.type) {
    case 'stateChange':
      return `${p.from} → ${p.to}`;
    case 'trigger':
      return `${p.type} · focus ${p.currentFocus} vs baseline ${p.baseline} · drifting ${p.secondsDrifting}s`;
    case 'speechStart':
      return `[${p.layer}] "${p.text}"`;
    case 'speechEngine':
      return `[${p.layer}] via ${p.engine}${p.note ? ` — ${p.note}` : ''}`;
    case 'llmRequest':
      return `${p.model} · ${p.triggerType} · ${p.language}`;
    case 'llmResponse':
      return p.preview ? `preview via ${p.engine}` : `${p.latencyMs}ms · "${p.text}"`;
    case 'speechSkip':
      return String(p.reason ?? '');
    case 'ingestWarning':
      return String(p.reason ?? JSON.stringify(p));
    case 'sessionStart':
      return `${p.readings} readings · ${p.voice} · ${p.reordered} reordered · ${p.gapFills} gap-filled`;
    case 'sessionEnd':
      return `${p.triggers} trigger(s) · ${p.totalEvents} events`;
    default:
      return JSON.stringify(p);
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1c1c1e',
    paddingTop: 64,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, marginBottom: 16 },
  subtitle: { color: '#8e8e93', fontSize: 13 },
  stateInline: { fontSize: 13, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statLabel: { color: '#8e8e93', fontSize: 11, fontWeight: '600', letterSpacing: 1 },
  focusNumber: { color: '#fff', fontSize: 36, fontWeight: '800' },
  baselineNumber: { color: '#fff', fontSize: 36, fontWeight: '300' },
  zone: { color: '#8e8e93', fontSize: 11, marginTop: 2 },
  orb: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginVertical: 6,
    overflow: 'hidden',
  },
  orbHighlight: {
    position: 'absolute',
    top: 5,
    left: 8,
    width: 18,
    height: 14,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  voiceBox: {
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  voiceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  previewBtn: {
    backgroundColor: '#0a84ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  previewBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  chipRow: { flexDirection: 'row', marginBottom: 6 },
  chip: {
    backgroundColor: '#3a3a3c',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
  },
  chipActive: { backgroundColor: '#5246c4' },
  chipText: { color: '#c7c7cc', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  voiceCaption: { color: '#8e8e93', fontSize: 11, marginTop: 4 },
  cueBox: {
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  cueText: { color: '#fff', fontSize: 16, marginTop: 6, fontStyle: 'italic' },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: {
    flex: 1,
    backgroundColor: '#0a84ff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: '#3a3a3c' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  exportNote: { color: '#8e8e93', fontSize: 12, marginTop: 6 },
  trailHeader: {
    color: '#8e8e93',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 6,
  },
  trail: { flex: 1 },
  trailItem: {
    color: '#e5e5ea',
    fontSize: 12,
    marginBottom: 4,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  trailTime: { color: '#8e8e93' },
  trailType: { fontWeight: '700' },
});
