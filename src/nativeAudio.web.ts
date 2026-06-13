// Web playback of raw audio bytes via the HTML5 Audio API.
// Metro picks this file on web, so the native expo-audio dependency is never
// bundled for the browser.

export interface NativeAudioHandle {
  stop: () => void;
}

export async function playAudioBytes(
  bytes: ArrayBuffer,
  onStart: () => void,
  onDone: () => void
): Promise<NativeAudioHandle> {
  const blob = new Blob([bytes], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    onDone();
  };
  onStart();
  await audio.play();
  return {
    stop: () => {
      audio.pause();
      URL.revokeObjectURL(url);
    },
  };
}
