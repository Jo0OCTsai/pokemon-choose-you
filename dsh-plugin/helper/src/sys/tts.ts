/**
 * 语音 TTS（FR-A7/D26）：speechSynthesis 播报——文本已由 host 按桌面口径剥符号截 120
 * （pet/ttsText.ts 同构 voice.rs）；默认静音由 sys-config.tts.enabled 控制；失败静默
 * （语音是锦上添花，D26）。headless = no-op 记录器。
 *
 * Electron 主进程 speechSynthesis 面探测：electron 模块导出面 → globalThis 回落 →
 * 均缺位时静默 no-op（旧运行时降级，能力位语义不回撤——host 侧 tts-speak 照发、
 * helper 静默丢弃，符合「失败静默」口径）。
 */
import type { SysContext } from "./context.ts";

/** speechSynthesis 最小结构面（主进程可用子集；utterance 只喂 text） */
interface SynthLike {
  speak(utterance: { text: string }): void;
  cancel(): void;
}

export interface TtsModule {
  /** sys-config.tts.enabled（默认 false——共享键 pet_voice 与 helper 门槛双闸） */
  setEnabled(on: boolean): void;
  speak(text: string): void;
  dispose(): void;
}

/** headless 记录器 */
export class HeadlessTts implements TtsModule {
  readonly records: { enabled: boolean; spoken: string[] } = { enabled: false, spoken: [] };

  private readonly ctx: SysContext;

  constructor(ctx: SysContext) {
    this.ctx = ctx;
  }

  setEnabled(on: boolean): void {
    this.records.enabled = on;
  }

  speak(text: string): void {
    if (!this.records.enabled) return; // 默认静音
    this.records.spoken.push(text);
    this.ctx.diag("sys-tts", `speak ${text.slice(0, 40)}`);
  }

  dispose(): void {
    /* no-op */
  }
}

/** Electron 实现（动态 import；引擎缺失/异常全部静默——D26） */
export async function createElectronTts(): Promise<TtsModule> {
  const synth = await probeSynth();
  const state = { enabled: false };

  return {
    setEnabled(on: boolean): void {
      state.enabled = on;
    },
    speak(text: string): void {
      if (!state.enabled || !synth || !text.trim()) return;
      try {
        synth.cancel();
        synth.speak({ text });
      } catch {
        /* 失败静默（D26） */
      }
    },
    dispose(): void {
      try {
        synth?.cancel();
      } catch {
        /* 同上 */
      }
    },
  };
}

async function probeSynth(): Promise<SynthLike | null> {
  try {
    const electron = (await import("electron")) as unknown as { speechSynthesis?: SynthLike };
    if (electron.speechSynthesis) return electron.speechSynthesis;
  } catch {
    /* electron 面不可用（headless 误入等）→ 回落 globalThis */
  }
  const globalSynth = (globalThis as { speechSynthesis?: SynthLike }).speechSynthesis;
  return globalSynth ?? null;
}
