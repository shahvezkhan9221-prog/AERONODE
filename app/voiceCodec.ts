export const VOICE_CODEC = "cvsd-4k-v1";
export const VOICE_SAMPLE_RATE = 4000;

export function base64ToBytes(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function fnv1a32(bytes: Uint8Array) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function decodeCvsd(bytes: Uint8Array, sampleCount: number) {
  const pcm = new Int16Array(sampleCount);
  let predictor = 0;
  let step = 0.02;
  let lastBit = -1;
  let runLength = 0;

  for (let index = 0; index < sampleCount; index++) {
    const bit = (bytes[index >> 3] >> (7 - (index & 7))) & 1;
    predictor += bit ? step : -step;
    predictor = Math.max(-1, Math.min(1, predictor));
    if (bit === lastBit) runLength++; else runLength = 1;
    step = runLength >= 3 ? Math.min(0.25, step * 1.12) : Math.max(0.002, step * 0.97);
    lastBit = bit;
    pcm[index] = Math.round(predictor * 32767);
  }
  return pcm;
}

function pcmToWav(pcm: Int16Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let index = 0; index < pcm.length; index++) view.setInt16(44 + index * 2, pcm[index], true);
  return new Blob([buffer], { type: "audio/wav" });
}

export function createVoiceUrl(bytes: Uint8Array, sampleCount: number, codec: string) {
  if (codec !== VOICE_CODEC) throw new Error(`Unsupported voice codec: ${codec}`);
  if (sampleCount < 1 || sampleCount > VOICE_SAMPLE_RATE * 12) throw new Error("Invalid voice sample count");
  if (bytes.length * 8 < sampleCount) throw new Error("Voice payload is incomplete");
  return URL.createObjectURL(pcmToWav(decodeCvsd(bytes, sampleCount), VOICE_SAMPLE_RATE));
}
