/**
 * runtime 公共面：类型、能力位声明与工厂入口（实现拆在 impl.ts、台词在 lines.ts——
 * 复杂度档位对齐域核心口径：每文件 <300 行、每函数 <50 行、圈复杂度 ≤10）。
 */
import type { ActiveTask, Badge, CmdMsg, CmdOp, Lang, QuickTask, SpritesMsg } from "../bridge/protocol.ts";
import type { Bridge } from "../bridge/bridge.ts";
import type { HostDeathReason } from "../bridge/heartbeat.ts";
import type { PomoConfig, PomoPhase } from "../state/pomodoro.ts";
import type { PetEvent, PetState } from "../state/petState.ts";
import type { SceneKind } from "../state/catchScene.ts";
import type { SpriteResolver } from "../sprites.ts";
import type { SysContext, SysRouter } from "../sys/index.ts";
import { RuntimeImpl } from "./impl.ts";

export { HELPER_VERSION, HELPER_CAPS } from "./impl.ts";
export type { SysContext, SysRouter } from "../sys/index.ts";

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
  /**
   * sys/ 路由注入（full-parity 2.4）：缺省 = headless 记录器全家；electron 形态注入
   * DeferredSys（electron-app whenReady 后 attach 真模块）。
   */
  sys?: SysRouter;
  /** headless AX 授权初值（HELPER_HEADLESS_AX=1——子进程集成测试可编程） */
  axGranted?: boolean;
  /** headless 平台注入（input-count 的 D32 darwin 门在 Linux CI 上测 darwin 行为用；缺省 = 真实平台） */
  platform?: NodeJS.Platform;
}

export type UiEvent =
  | { kind: "task"; task: ActiveTask | null; badge: Badge; todayTasks: QuickTask[] }
  | { kind: "lang"; lang: Lang }
  | { kind: "pomo-config"; config: PomoConfig }
  | { kind: "sprites"; builtin: SpritesMsg["builtin"]; cdnBase: string; reducedMotion: boolean }
  | { kind: "pet-state"; state: PetState }
  | { kind: "bubble"; text: string; tone: BubbleTone; blink: boolean }
  | { kind: "quit"; reason: HostDeathReason }
  /** 捕捉演出变体（plain/streak/milestone——庆祝态入口，渲染层据 variant 编排；allDone 送客陪跑） */
  | { kind: "catch-scene"; scene: SceneKind; allDone?: boolean }
  /** AI 聊聊回答（chat-reply 下行直达；ok=false 走失败回退气泡） */
  | { kind: "chat-reply"; text: string; ok: boolean }
  /** 全局输入活动强度（sys inputCount 上行镜像——渲染层微抖/回头/哈欠分档消费） */
  | { kind: "input-activity"; cps: number }
  /** 坐栖判定翻转（拖拽落定/拎起——渲染层姿态幅度减半与落座台词） */
  | { kind: "perch"; perched: boolean }
  /** 桌宠基础面投影（sys-config.pet：陪跑闸门 + ChatBox 菜单条件项） */
  | { kind: "pet-config"; mate: boolean; agentConfigured: boolean }
  /** 长番茄打点（≥45min 中点 1 声 / 剩 5 分钟 2 声——渲染层 Web Audio 合成） */
  | { kind: "pomo-chime"; count: 1 | 2 };

export type BubbleTone = "info" | "event" | "warn";

/** 渲染层快照的输入响应配置面（sys-config.inputResponse 的投影） */
export interface InputResponseView {
  enabled: boolean;
  /** hop 节奏耦合上限（0–0.1；0 = 关） */
  hopCoupleMax: number;
}

export interface HelperRuntime {
  readonly bridge: Bridge;
  readonly resolver: SpriteResolver;
  readonly petState: PetState;
  readonly lang: Lang;
  readonly pomoPhase: PomoPhase;
  readonly activeTask: ActiveTask | null;
  readonly todayTasks: QuickTask[];
  readonly reducedMotion: boolean;
  /** sys/ 模块族装配上下文（electron 胶水建真模块时复用 emit/diag 出口） */
  readonly sysContext: SysContext;
  /** sys/ 路由（测试断言记录器状态；electron 形态为 DeferredSys） */
  readonly sys: SysRouter;
  /** 桌宠可见性（托盘「显示/隐藏」label 的乐观跟踪源） */
  readonly petVisible: boolean;
  /** 输入响应配置投影（渲染层 hop 耦合消费） */
  readonly inputResponse: InputResponseView;
  /** 桌宠基础面（sys-config.pet 投影：陪跑闸门 + ChatBox 菜单条件项） */
  readonly petConfig: { mate: boolean; agentConfigured: boolean };
  /** 坐栖态（拖拽落定判定；渲染层姿态幅度减半） */
  readonly perched: boolean;
  sendCmd(op: CmdOp, fields?: Omit<CmdMsg, "type" | "op">): boolean;
  sendFocusSettleNow(): boolean;
  /** 渲染层交互事件回流（拖动开始/结束、撸宠、点击……驱动状态机与唤醒） */
  interact(ev: PetEvent): void;
  /** 本端完成（done cmd + focus-settle 结账；演出与收尾台词等 host task-state.caught 推回后统一编排） */
  completeTask(): void;
  /** 番茄本地控制（开新一轮 / 🍦 先试 5 分钟 / 短休息） */
  pomo: {
    beginFocus(durationMin?: number): void;
    beginTrial(): void;
    beginBreak(): void;
  };
  /** 坐栖判定（electron 胶水拖拽落定/启动时调用——纯逻辑在 state/perch.ts） */
  reportPerch(perched: boolean): void;
  dispose(): void;
}

export function createHelperRuntime(opts: RuntimeOptions): HelperRuntime {
  // 实现类在 impl.ts（每方法小函数口径）；类型面单一出口保持不变
  return new RuntimeImpl(opts);
}
