/**
 * 轻提示音：Web Audio 合成短促双音，无音频环境（无 AudioContext）静默退化。
 * 用于长番茄钟中点与剩 5 分钟的时间感知提示（音量克制，不打断）。
 */
export function chime(times = 1): void {
  try {
    const Ctx =
      (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    for (let i = 0; i < Math.min(3, times); i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 660;
      const at = ctx.currentTime + i * 0.3;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.22);
    }
    window.setTimeout(() => void ctx.close().catch(() => {}), 1600);
  } catch {
    /* 无音频环境静默 */
  }
}
