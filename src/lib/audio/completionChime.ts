/**
 * A subtle "run finished" chime, synthesized with the Web Audio API so
 * there's no audio asset to ship or decode. Two soft sine notes rising a
 * perfect fifth (E5 → B5) with a quick exponential decay — present enough
 * to notice, quiet enough not to startle.
 *
 * Best-effort by design: if the browser has no AudioContext, or autoplay
 * policy blocks an un-gestured sound, it stays silent rather than throwing
 * into the run-finished path.
 */

let sharedContext: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  return sharedContext;
}

function playNote(ctx: AudioContext, frequency: number, startAt: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  // Quick soft attack, exponential decay; low peak keeps it gentle.
  const peak = 0.06;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export async function playCompletionChime(): Promise<void> {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    const now = ctx.currentTime;
    playNote(ctx, 659.25, now, 0.16); // E5
    playNote(ctx, 987.77, now + 0.11, 0.22); // B5
  } catch {
    // Autoplay restriction or a closed context — silence is acceptable.
  }
}
