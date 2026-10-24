/**
 * 轻提示音（桌面 src/chime.ts 同构移植）：Web Audio 合成 660Hz 短促音，音量包络克制
 * （峰值 0.06）；无音频环境（无 AudioContext）静默退化。用于长番茄中点与剩 5 分钟的
 * 时间感知提示（pomodoro_chime 共享键门控在 runtime 侧，这里只管发声）。
 */
export function chime(times: 1 | 2 = 1): void {
  try {
    const Ctx =
      (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
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
