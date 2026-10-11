/**
 * runtime 公共面：类型、能力位声明与工厂入口（实现拆在 impl.ts、台词在 lines.ts——
 * 复杂度档位对齐域核心口径：每文件 <300 行、每函数 <50 行、圈复杂度 ≤10）。
 */
import type { ActiveTask, Badge, CmdMsg, CmdOp, Lang, QuickTask, SpritesMsg } from "../bridge/protocol.ts";
import type { Bridge } from "../bridge/bridge.ts";
import type { HostDeathReason } from "../bridge/heartbeat.ts";
import type { PomoConfig, PomoPhase } from "../state/pomodoro.ts";
import type { PetEvent, PetState } from "../state/petState.ts";
import type { SpriteResolver } from "../sprites.ts";
import { RuntimeImpl } from "./impl.ts";

export { HELPER_VERSION, HELPER_CAPS } from "./impl.ts";

export interface RuntimeOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** --host-pid 双保险（缺省不启用） */
  hostPid?: number;
  heartbeatTimeoutMs?: number;
  now?: () => number;
  uuid?: () => string;
  /** key→id 映射（Electron 形态注入全量 catalog；headless 缺省只认内置） */
  keyToId?: (key: string) => number | undefined;
  /** 渲染事件出口（Electron 胶水转发到 BrowserWindow；headless 不传） */
  onUiEvent?: (ev: UiEvent) => void;
}

export type UiEvent =
  | { kind: "task"; task: ActiveTask | null; badge: Badge; todayTasks: QuickTask[] }
  | { kind: "lang"; lang: Lang }
  | { kind: "pomo-config"; config: PomoConfig }
  | { kind: "sprites"; builtin: SpritesMsg["builtin"]; cdnBase: string; reducedMotion: boolean }
  | { kind: "pet-state"; state: PetState }
  | { kind: "bubble"; text: string; tone: BubbleTone; blink: boolean }
  | { kind: "quit"; reason: HostDeathReason };

export type BubbleTone = "info" | "event" | "warn";

export interface HelperRuntime {
  readonly bridge: Bridge;
  readonly resolver: SpriteResolver;
  readonly petState: PetState;
  readonly lang: Lang;
  readonly pomoPhase: PomoPhase;
  readonly activeTask: ActiveTask | null;
  readonly todayTasks: QuickTask[];
  readonly reducedMotion: boolean;
  sendCmd(op: CmdOp, fields?: Omit<CmdMsg, "type" | "op">): boolean;
  sendFocusSettleNow(): boolean;
  /** 渲染层交互事件回流（拖动开始/结束、撸宠、点击……驱动状态机与唤醒） */
  interact(ev: PetEvent): void;
  /** 本端完成 → done cmd + focus-settle 结账 + celebrating */
  completeTask(): void;
  /** 番茄本地控制（开新一轮 / 🍦 先试 5 分钟 / 短休息） */
  pomo: {
    beginFocus(durationMin?: number): void;
    beginTrial(): void;
    beginBreak(): void;
  };
  dispose(): void;
}

export function createHelperRuntime(opts: RuntimeOptions): HelperRuntime {
  // 实现类在 impl.ts（每方法小函数口径）；类型面单一出口保持不变
  return new RuntimeImpl(opts);
}
