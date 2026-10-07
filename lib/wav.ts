/** A mic recording (any browser format) → mono 16-bit WAV at `rate` Hz: base64 + a URL to play it back. */
export async function toWav(blob: Blob, rate = 24000): Promise<{ wav: string; url: string; seconds: number }> {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = (await off.startRendering()).getChannelData(0);
  const pcm = new DataView(new ArrayBuffer(44 + mono.length * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => pcm.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  pcm.setUint32(4, 36 + mono.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true);
  pcm.setUint16(22, 1, true);
  pcm.setUint32(24, rate, true);
  pcm.setUint32(28, rate * 2, true);
  pcm.setUint16(32, 2, true);
  pcm.setUint16(34, 16, true);
  str(36, "data");
  pcm.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) pcm.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 0x7fff, true);
  const bytes = new Uint8Array(pcm.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { wav: btoa(bin), url: URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })), seconds: decoded.duration };
}
