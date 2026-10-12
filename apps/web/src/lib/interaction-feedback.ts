export interface FeedbackSettings {
  haptics: boolean;
  sound: boolean;
}
export const FEEDBACK_KEY = "marginalia-feedback";
export function readFeedback(): FeedbackSettings {
  try {
    const value = JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? "{}");
    return { haptics: value?.haptics !== false, sound: value?.sound === true };
  } catch {
    return { haptics: true, sound: false };
  }
}
export function writeFeedback(settings: FeedbackSettings) {
  try {
    localStorage.setItem(FEEDBACK_KEY, JSON.stringify(settings));
  } catch {
    /* Keep the active session setting. */
  }
  window.dispatchEvent(
    new CustomEvent("reader-feedback", { detail: settings }),
  );
}
let audio: AudioContext | undefined;
let hapticSwitch: HTMLLabelElement | undefined;

function safariSwitchFeedback() {
  if (!hapticSwitch) {
    const input = document.createElement("input");
    if (!("switch" in input)) return;
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    input.style.appearance = "auto";
    hapticSwitch = document.createElement("label");
    hapticSwitch.setAttribute("aria-hidden", "true");
    hapticSwitch.style.display = "none";
    hapticSwitch.append(input);
    document.body.append(hapticSwitch);
  }
  // Safari's native switch can produce a tap during a user gesture. This is
  // best-effort, not a standard vibration API; keep it synchronous and brief.
  hapticSwitch.click();
}

export function disposeTouchFeedback() {
  hapticSwitch?.remove();
  hapticSwitch = undefined;
}

export function touchFeedback(settings: FeedbackSettings) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (settings.haptics && window.matchMedia("(pointer: coarse)").matches) {
    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate(8);
      else safariSwitchFeedback();
    } catch {
      /* Feedback must never interrupt an action. */
    }
  }
  if (!settings.sound || !window.AudioContext) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 680;
    gain.gain.setValueAtTime(0.012, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.045);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.05);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  } catch {
    /* Feedback must never interrupt an action. */
  }
}
