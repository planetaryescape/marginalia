// The voices a reader can hear, in the same shape as MODEL_CATALOG
// (providers.ts). Rung 1b offers the eight Kokoro voices sampled in S1. Prices
// were read on 2026-10-22; see docs/listen/blueprint/03-voices-and-providers.md
// before changing them.

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

// Kokoro's voice IDs start with the accent (a American, b British) and the
// speaker (f, m), which is all `character` says until someone describes each
// by ear. Every Kokoro voice costs the same.
const kokoro = (voice: string, name: string, character: string) => ({
  id: `openrouter:hexgrad/kokoro-82m#${voice}`,
  model: "hexgrad/kokoro-82m",
  voice,
  name: `Kokoro · ${name}`,
  character,
  centsPerHour: 3,
  instructions: false,
  maxChars: 2000,
});

export const SPEECH_VOICES: readonly SpeechVoice[] = [
  kokoro("af_heart", "Heart", "American woman"),
  kokoro("af_bella", "Bella", "American woman"),
  kokoro("am_michael", "Michael", "American man"),
  kokoro("am_fenrir", "Fenrir", "American man"),
  kokoro("bf_emma", "Emma", "British woman"),
  kokoro("bf_isabella", "Isabella", "British woman"),
  kokoro("bm_george", "George", "British man"),
  kokoro("bm_fable", "Fable", "British man"),
];

export const DEFAULT_SPEECH_VOICE = "openrouter:hexgrad/kokoro-82m#af_heart";

// A Map, not an object: a lookup by "constructor" or "__proto__" must miss
const VOICES_BY_ID = new Map(SPEECH_VOICES.map((voice) => [voice.id, voice]));

export function findSpeechVoice(id: string): SpeechVoice | undefined {
  return VOICES_BY_ID.get(id);
}

/** A saved choice, or the default when there is none or it left the catalog. */
export function resolveSpeechVoice(id: string | undefined): SpeechVoice {
  return (
    (id === undefined ? undefined : findSpeechVoice(id)) ??
    (findSpeechVoice(DEFAULT_SPEECH_VOICE) as SpeechVoice)
  );
}
