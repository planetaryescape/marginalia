// The voices a reader can hear, in the same shape as MODEL_CATALOG
// (providers.ts). Rung 1 ships Kokoro alone. Prices were read on 2026-10-22;
// see docs/listen/blueprint/03-voices-and-providers.md before changing them.

export interface SpeechVoice {
  id: string;
  model: string;
  voice: string;
  name: string;
  character: string;
  centsPerHour: number;
  instructions: boolean;
  maxChars: number;
}

export const SPEECH_VOICES: readonly SpeechVoice[] = [
  {
    id: "openrouter:hexgrad/kokoro-82m#af_heart",
    model: "hexgrad/kokoro-82m",
    voice: "af_heart",
    name: "Kokoro · Heart",
    character: "calm, clear",
    centsPerHour: 3,
    instructions: false,
    maxChars: 2000,
  },
];

export const DEFAULT_SPEECH_VOICE = "openrouter:hexgrad/kokoro-82m#af_heart";

// A Map, not an object: a lookup by "constructor" or "__proto__" must miss
const VOICES_BY_ID = new Map(SPEECH_VOICES.map((voice) => [voice.id, voice]));

export function findSpeechVoice(id: string): SpeechVoice | undefined {
  return VOICES_BY_ID.get(id);
}
