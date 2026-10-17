/**
 * helper 运行时实现（桥 + 状态机装配；**零 Electron 依赖**——headless 模式与契约测试直接跑，
 * Electron 胶水只消费 index.ts 暴露的事件面与命令面）。类形态：每个 handler 是小方法，
 * 复杂度/行数档位对齐域核心口径。
 */
import { Bridge } from "../bridge/bridge.ts";
import { HostPidWatchdog, type HostDeathReason } from "../bridge/heartbeat.ts";
import {
  CMD_OPS,
  type ActiveTask,
  type CmdMsg,
  type CmdOp,
  type DownstreamMsg,
  type FocusSettleMsg,
  type Lang,
  type PomodoroConfigMsg,
  type QuickTask,
  type SpritesMsg,
  type TaskStateMsg,
} from "../bridge/protocol.ts";
import { FocusAccumulator } from "../state/focusSettle.ts";
import {
  DEFAULT_POMO_CONFIG,
  startBreak,
  startFocus,
  startTrial,
  tickPhase,
  type PomoConfig,
  type PomoPhase,
} from "../state/pomodoro.ts";
import { PET_IDLE_STATE, reduce, type PetEvent, type PetState } from "../state/petState.ts";
import { SpriteResolver } from "../sprites.ts";
import type { BubbleTone, HelperRuntime, RuntimeOptions } from "./index.ts";
import LINES, { formatCatching, formatSettledElsewhere } from "./lines.ts";

/** 仍在进行中驻留（active/paused）的任务，否则 null */
function residencyTask(task: ActiveTask | null): ActiveTask | null {
  if (!task) return null;
  return task.status === "active" || task.status === "paused" ? task : null;
}

function defaultUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ls-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class RuntimeImpl implements HelperRuntime {
  readonly bridge: Bridge;
  readonly resolver: SpriteResolver;
  private readonly opts: RuntimeOptions;
  private readonly now: () => number;
  private readonly focus: FocusAccumulator;
  private readonly pidWatchdog: HostPidWatchdog | null;
  private readonly pomoTick: ReturnType<typeof setInterval>;

  private petStateValue: PetState = PET_IDLE_STATE;
  private langValue: Lang = "zh-Hans";
  private pomoConfigValue: PomoConfig = DEFAULT_POMO_CONFIG;
  private pomoPhaseValue: PomoPhase = null;
  private activeTaskValue: ActiveTask | null = null;
  private todayTasksValue: QuickTask[] = [];
  private reducedMotionValue = false;
  private quitIntended = false;

  constructor(opts: RuntimeOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.bridge = new Bridge({ heartbeatTimeoutMs: opts.heartbeatTimeoutMs, now: this.now });
    this.resolver = new SpriteResolver(undefined, undefined, opts.keyToId);
    this.focus = new FocusAccumulator({ now: this.now, uuid: opts.uuid ?? defaultUuid });
    this.pidWatchdog = opts.hostPid ? new HostPidWatchdog(opts.hostPid, (r) => this.onHostDead(r)) : null;
    this.pomoTick = setInterval(() => this.tickPomo(), 1_000);
    this.bridge.onMessage((m) => this.handleMessage(m));
    this.bridge.onHostDead((r) => this.onHostDead(r));
    this.pidWatchdog?.start();
    this.bridge.attach(opts.input, opts.output);
    this.bridge.start();
    this.bridge.send({ type: "hello", version: HELPER_VERSION, caps: [...HELPER_CAPS] });
  }

  // ---- 只读面 ----
  get petState(): PetState {
    return this.petStateValue;
  }
  get lang(): Lang {
    return this.langValue;
  }
  get pomoPhase(): PomoPhase {
    return this.pomoPhaseValue;
  }
  get activeTask(): ActiveTask | null {
    return this.activeTaskValue;
  }
  get todayTasks(): QuickTask[] {
    return this.todayTasksValue;
  }
  get reducedMotion(): boolean {
    return this.reducedMotionValue;
  }

  // ---- 上行命令面 ----
  sendCmd(op: CmdOp, fields: Omit<CmdMsg, "type" | "op"> = {}): boolean {
    if (!(CMD_OPS as readonly string[]).includes(op)) {
      this.bridge.diag.push("bad-cmd", op);
      return false;
    }
    return this.bridge.send({ type: "cmd", op, ...fields });
  }

  sendFocusSettleNow(): boolean {
    const settle = this.focus.settleNow();
    return settle ? this.sendFocusSettle(settle) : false;
  }

  interact(ev: PetEvent): void {
    this.setPetState(ev);
  }

  completeTask(): void {
    const task = this.activeTaskValue;
    if (task) {
      const { settle } = this.focus.onTaskState(task, null);
      if (settle) this.sendFocusSettle(settle);
      this.sendCmd("done", { taskId: task.id });
    }
    this.setPetState({ kind: "task-done" });
    this.bubble(LINES.caught(this.langValue), "event", true);
  }

  readonly pomo: HelperRuntime["pomo"] = {
    beginFocus: (durationMin?: number) => this.beginFocus(durationMin),
    beginTrial: () => {
      this.pomoPhaseValue = startTrial(this.now());
    },
    beginBreak: () => this.beginBreak(),
  };

  dispose(): void {
    clearInterval(this.pomoTick);
    this.pidWatchdog?.stop();
    this.bridge.stop();
  }

  // ---- 下行分发（薄 switch：每 case 一个小方法） ----
  private handleMessage(msg: DownstreamMsg): void {
    switch (msg.type) {
      case "task-state":
        this.onTaskState(msg);
        break;
      case "pomodoro-config":
        this.onPomodoroConfig(msg);
        break;
      case "lang":
        this.langValue = msg.lang;
        this.opts.onUiEvent?.({ kind: "lang", lang: msg.lang });
        break;
      case "sprites":
        this.onSprites(msg);
        break;
      case "heartbeat":
        break; // 管道守卫已在 bridge 层喂狗（任意数据都算活着）
    }
  }

  private onTaskState(msg: TaskStateMsg): void {
    const prev = this.activeTaskValue;
    const next = msg.activeTask;
    this.activeTaskValue = next;
    this.todayTasksValue = msg.todayTasks ?? [];
    const { settle } = this.focus.onTaskState(prev, next);
    if (settle) this.sendFocusSettle(settle);
    this.setPetState({ kind: "task-state", task: next });
    this.opts.onUiEvent?.({
      kind: "task",
      task: next,
      badge: msg.badge,
      todayTasks: this.todayTasksValue,
    });
    this.emitTaskBubbles(prev, next);
  }

  /** 台词时序（UIUX §3.4）：出发双气泡；外部收尾（跨形态打断 D16）一次性中性气泡 */
  private emitTaskBubbles(prev: ActiveTask | null, next: ActiveTask | null): void {
    const prevId = prev ? prev.id : null;
    const nextActive = residencyTask(next);
    if (nextActive && prevId !== nextActive.id) {
      const p = this.resolver.pokemonName(nextActive.categoryPokemon, this.langValue);
      const title = nextActive.title;
      this.bubble(LINES.chooseYou(this.langValue), "event");
      setTimeout(() => this.bubble(formatCatching(this.langValue, p, title), "info"), 900);
    } else if (prevId !== null && !nextActive && !this.quitIntended) {
      this.bubble(formatSettledElsewhere(this.langValue, prev?.title ?? ""), "info");
    }
  }

  private onPomodoroConfig(msg: PomodoroConfigMsg): void {
    this.pomoConfigValue = { durations: msg.durations, breakMin: msg.breakMin, enabled: msg.enabled };
    this.langValue = msg.lang;
    this.opts.onUiEvent?.({ kind: "pomo-config", config: this.pomoConfigValue });
  }

  private onSprites(msg: SpritesMsg): void {
    this.resolver.update(msg.builtin, msg.cdnBase);
    this.reducedMotionValue = msg.reducedMotion ?? false;
    this.opts.onUiEvent?.({
      kind: "sprites",
      builtin: msg.builtin,
      cdnBase: msg.cdnBase,
      reducedMotion: this.reducedMotionValue,
    });
  }

  // ---- 宿主存亡 → 退出意图（main.ts 消化：10s SLA 内退出） ----
  private onHostDead(reason: HostDeathReason): void {
    if (this.quitIntended) return;
    this.quitIntended = true;
    // best-effort 结账：stdin 已断则送达不了（无害）；--host-pid 单独触发时宿主还活着，补报
    const settle = this.focus.settleNow();
    if (settle && reason === "host-pid-dead") this.sendFocusSettle(settle);
    this.pidWatchdog?.stop();
    this.opts.onUiEvent?.({ kind: "quit", reason });
  }

  // ---- 番茄本地计时（1s tick；到期只出气泡与出口，绝不自动续轮） ----
  private tickPomo(): void {
    if (!this.pomoPhaseValue) return;
    const wasBreak = this.pomoPhaseValue.kind === "break";
    const result = tickPhase(this.pomoPhaseValue, this.now());
    if (result.ended) this.onPomoEnded(wasBreak);
  }

  private onPomoEnded(wasBreak: boolean): void {
    this.pomoPhaseValue = null;
    if (!wasBreak) {
      this.bubble(LINES.pomoDone(this.langValue), "event", true);
      return;
    }
    this.setPetState({ kind: "break-end" });
    this.bubble(LINES.breakOver(this.langValue), "event");
  }

  private beginFocus(durationMin?: number): void {
    this.pomoPhaseValue = startFocus(this.pomoConfigValue, this.now(), durationMin);
    this.setPetState({ kind: "break-end" });
  }

  private beginBreak(): void {
    this.pomoPhaseValue = startBreak(this.pomoConfigValue, this.now());
    this.setPetState({ kind: "break-start" });
    this.bubble(LINES.breakStart(this.langValue), "info");
  }

  // ---- 小工具 ----
  private setPetState(ev: PetEvent): void {
    this.petStateValue = reduce(this.petStateValue, ev);
    this.opts.onUiEvent?.({ kind: "pet-state", state: this.petStateValue });
  }

  private bubble(text: string, tone: BubbleTone = "info", blink = false): void {
    this.opts.onUiEvent?.({ kind: "bubble", text, tone, blink });
  }

  private sendFocusSettle(settle: Omit<FocusSettleMsg, "type">): boolean {
    const sent = this.bridge.send({ type: "focus-settle", ...settle });
    if (sent) this.bridge.diag.push("focus-settle", `${settle.taskId} +${settle.elapsedMin}min`);
    return sent;
  }
}

export const HELPER_VERSION = "0.1.0";
/** 能力位（hello 携带；宿主侧按位判断 helper 面；index.ts re-export 保持公共面） */
export const HELPER_CAPS = [
  "task-state",
  "pomodoro-local",
  "focus-settle",
  "quick-dex",
  "sprite-fallback",
  "reduced-motion",
] as const;
