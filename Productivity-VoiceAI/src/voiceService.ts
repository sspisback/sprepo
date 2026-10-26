export type VoiceServiceStatus = { sttAvailable: boolean; ttsAvailable: boolean };

export async function getVoiceServiceStatus(): Promise<VoiceServiceStatus> {
  const response = await fetch("/api/voice/status", { cache: "no-store" });
  if (!response.ok) throw new Error("The local voice service could not be reached.");
  return response.json() as Promise<VoiceServiceStatus>;
}

export async function transcribeLocalAudio(audio: Blob): Promise<string> {
  const wav = await toMono16kWav(audio);
  const response = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  const payload = await response.json() as { text?: string; error?: string };
  if (!response.ok || !payload.text) throw new Error(payload.error || "Local transcription failed.");
  return payload.text;
}

export async function synthesizeLocalSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch("/api/voice/speak", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || "Local speech synthesis failed.");
  }
  return response.blob();
}

async function toMono16kWav(recording: Blob): Promise<Blob> {
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser does not support audio conversion required for local transcription.");
  const context = new AudioContextClass();
  try {
    const sourceBuffer = await context.decodeAudioData(await recording.arrayBuffer());
    const frameCount = Math.ceil(sourceBuffer.duration * 16_000);
    if (!frameCount || frameCount > 16_000 * 300) throw new Error("Recordings must be shorter than five minutes.");
    const offline = new OfflineAudioContext(1, frameCount, 16_000);
    const source = offline.createBufferSource();
    source.buffer = sourceBuffer;
    source.connect(offline.destination);
    source.start();
    const mono = await offline.startRendering();
    return encodePcm16Wav(mono.getChannelData(0), mono.sampleRate);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
