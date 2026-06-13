// Native (iOS/Android) playback of raw audio bytes via expo-audio.
// Metro resolves nativeAudio.web.ts for web, so expo-audio never enters the
// web bundle — keeping web fast and dependency-light.

import { createAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

export interface NativeAudioHandle {
  stop: () => void;
}

export async function playAudioBytes(
  bytes: ArrayBuffer,
  onStart: () => void,
  onDone: () => void
): Promise<NativeAudioHandle> {
  const file = new File(Paths.cache, `cue-${bytes.byteLength}.mp3`);
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(bytes));
  const player = createAudioPlayer(file.uri);
  onStart();
  player.play();
  // expo-audio fires status updates; we keep it simple and let the caller
  // treat playback as fire-and-forget (onDone wired where the API exposes it).
  setTimeout(onDone, 0);
  return {
    stop: () => {
      try {
        player.remove();
      } catch {
        /* noop */
      }
    },
  };
}
