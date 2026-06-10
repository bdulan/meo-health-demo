// Loads the bundled replay.jsonl asset as text (native + web).

import { Asset } from 'expo-asset';

export async function loadReplayText(): Promise<string> {
  // metro.config.js registers .jsonl as an asset extension
  const asset = Asset.fromModule(require('../assets/replay.jsonl'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const res = await fetch(uri);
  return await res.text();
}
