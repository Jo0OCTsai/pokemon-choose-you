/**
 * helper 运行时实现（桥 + 状态机 + sys/ 装配；**零静态 Electron 依赖**——headless 模式
 * 与契约测试直接跑，Electron 胶水只消费 index.ts 暴露的事件面与命令面）。类形态：每个
 * handler 是小方法，复杂度/行数档位对齐域核心口径。拆件（棘轮 max-lines，等量迁移）：
 * 番茄本地计时 = pomoTicker.ts、版本能力位/台词发射等支撑件 = implSupport.ts。
 */
import { Bridge } from "../bridge/bridge.ts";
import { HostPidWatchdog, type HostDeathReason } from "../bridge/heartbeat.ts";
import {
  CMD_OPS,
  type CmdMsg,
  type CmdOp,
  type DownstreamMsg,
  type FocusSettleMsg,
  type PomodoroConfigMsg,
  type SpritesMsg,
  type TaskStateMsg,
  type UpstreamMsg,
} from "../bridge/protocol.ts";
import { planCatchScene } from "../state/catchScene.ts";
import { FocusAccumulator } from "../state/focusSettle.ts";
import type { PomoPhase } from "../state/pomodoro.ts";
import { reduce, type PetEvent } from "../state/petState.ts";
import { SpriteResolver } from "../sprites.ts";
import { createHeadlessSys, type SysContext, type SysDownMsg, type SysRouter } from "../sys/index.ts";
import type { BubbleTone, HelperRuntime, RuntimeOptions } from "./index.ts";
import { RuntimeStateBase } from "./state.ts";
import LINES from "./lines.ts";
import { PomoTicker } from "./pomoTicker.ts";
import { defaultUuid, emitTaskBubbles, HELPER_CAPS, HELPER_VERSION } from "./implSupport.ts";

export { HELPER_VERSION, HELPER_CAPS } from "./implSupport.ts";

export class RuntimeImpl extends RuntimeStateBase implements HelperRuntime {
  readonly bridge: Bridge;
  readonly resolver: SpriteResolver;
  private readonly opts: RuntimeOptions;
  private readonly now: () => number;
  private readonly focus: FocusAccumulator;
  private readonly pidWatchdog: HostPidWatchdog | null;
  private readonly pomoTicker: PomoTicker;
  readonly sysContext: SysContext;
  readonly sys: SysRouter;

  private quitIntended = false;

  constructor(opts: RuntimeOptions) {
    super();
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.bridge = new Bridge({ heartbeatTimeoutMs: opts.heartbeatTimeoutMs, now: this.now });
    this.resolver = new SpriteResolver(undefined, undefined, opts.keyToId);
    this.focus = new FocusAccumulator({ now: this.now, uuid: opts.uuid ?? defaultUuid });
    this.pidWatchdog = opts.hostPid ? new HostPidWatchdog(opts.hostPid, (r) => this.onHostDead(r)) : null;
    this.pomoTicker = new PomoTicker(this.now, (wasBreak) => this.onPomoEnded(wasBreak));
    this.sysContext = {
      emit: (msg) => this.emitUpstream(msg),
      diag: (tag, detail) => {
        this.bridge.diag.push(tag, detail);
      },
      now: this.now,
    };
    this.sys = opts.sys ?? createHeadlessSys(this.sysContext, { axGranted: opts.axGranted });
    this.sys.onCapsChange(() => this.sendHello());
    this.bridge.onMessage((m) => this.handleMessage(m));
    this.bridge.onHostDead((r) => this.onHostDead(r));
    this.pidWatchdog?.start();
    this.bridge.attach(opts.input, opts.output);
    this.bridge.start();
    this.sendHello();
  }

  // ---- 只读面（petState/lang/activeTask/... 基类 getter；pomoPhase 走 ticker） ----
  get pomoPhase(): PomoPhase {
    return this.pomoTicker.phase;
  }

  // ---- 上行命令面 ----
  sendCmd(op: CmdOp, fields: Omit<CmdMsg, "type" | "op"> = {}): boolean {
    if (!(CMD_OPS as readonly string[]).includes(op)) {
      this.bridge.diag.push("bad-cmd", op);
      return false;
    }
    if (op === "hide") this.setPetVisibleLocal(false); // 渲染层隐藏 → 托盘 label 乐观翻转
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
    // 演出变体（FR-B3）：里程碑优先互不叠加——判定输入默认 plain，host 数据面接线后注入
    const input = this.opts.solemn?.() ?? { milestone: null, streakDays: null };
    const scene = planCatchScene(input);
    this.setPetState({ kind: "task-done" });
    this.opts.onUiEvent?.({ kind: "catch-scene", scene });
    const title = task?.title ?? "";
    this.bubble(LINES.caught(this.langValue, title), "event", true);
  }

  reportPerch(perched: boolean): void {
    if (this.perchedValue === perched) return;
    this.perchedValue = perched;
    this.opts.onUiEvent?.({ kind: "perch", perched });
  }

  get perched(): boolean {
    return this.perchedValue;
  }

  readonly pomo: HelperRuntime["pomo"] = {
    beginFocus: (durationMin?: number) => {
      this.pomoTicker.beginFocus(durationMin);
      this.setPetState({ kind: "break-end" });
    },
    beginTrial: () => this.pomoTicker.beginTrial(),
    beginBreak: () => {
      this.pomoTicker.beginBreak();
      this.setPetState({ kind: "break-start" });
      this.bubble(LINES.breakStart(this.langValue), "info");
    },
  };

  dispose(): void {
    this.pomoTicker.dispose();
    this.pidWatchdog?.stop();
    this.sys.dispose();
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
        this.sys.setLang(msg.lang);
        this.opts.onUiEvent?.({ kind: "lang", lang: msg.lang });
        break;
      case "sprites":
        this.onSprites(msg);
        break;
      case "heartbeat":
        break; // 管道守卫已在 bridge 层喂狗（任意数据都算活着）
      case "chat-reply":
        // AI 聊聊回答直达渲染层（ChatBox 消费；失败 ok=false 气泡回退）
        this.opts.onUiEvent?.({ kind: "chat-reply", text: msg.text, ok: msg.ok });
        break;
      default:
        this.routeSysMsg(msg);
        break;
    }
  }

  /**
   * sys/ 模块族路由（full-parity 2.4）：消息认识但实现在位面缺失 → sys-unsupported
   * 兜底上报（每类型节流一次 + 计错进诊断，NFR-14——host 侧 hello 门控 + 能力位
   * 缺位不发，此分支只兜「能力位与实现错位」）
   */
  private routeSysMsg(msg: SysDownMsg): void {
    if (msg.type === "sys-config") this.observeSysConfig(msg);
    if (!this.sys.handle(msg)) this.bridge.reportSysUnsupported(msg.type);
  }

  /** sys-config 的渲染层投影（inputResponse 启停 + hop 耦合上限）——sys 路由之外的旁路观察 */
  private observeSysConfig(msg: Extract<DownstreamMsg, { type: "sys-config" }>): void {
    if (!msg.inputResponse) return;
    const max = msg.inputResponse.focusHopCoupleMax;
    this.inputResponseValue = {
      enabled: msg.inputResponse.enabled,
      hopCoupleMax: typeof max === "number" && max > 0 ? Math.min(max, 0.1) : 0,
    };
  }

  /** sys 模块上行观察：可见性乐观翻转 + input-activity 渲染层镜像 */
  private emitUpstream(msg: UpstreamMsg): boolean {
    if (msg.type === "tray-action" && msg.action === "pet-toggle") this.setPetVisibleLocal(!this.petVisibleValue);
    if (msg.type === "shortcut-fired" && msg.id === "togglePet") this.setPetVisibleLocal(!this.petVisibleValue);
    if (msg.type === "input-activity") this.opts.onUiEvent?.({ kind: "input-activity", cps: msg.cps });
    return this.bridge.send(msg);
  }

  private setPetVisibleLocal(visible: boolean): void {
    if (this.petVisibleValue === visible) return;
    this.petVisibleValue = visible;
    this.sys.setPetVisible(visible);
  }

  private sendHello(): void {
    this.bridge.send({
      type: "hello",
      version: HELPER_VERSION,
      caps: [...HELPER_CAPS, ...this.sys.caps],
    });
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
    emitTaskBubbles({
      resolver: this.resolver,
      lang: this.langValue,
      quitIntended: this.quitIntended,
      bubble: (text, tone) => this.bubble(text, tone),
      prev,
      next,
    });
  }

  private onPomodoroConfig(msg: PomodoroConfigMsg): void {
    const config = { durations: msg.durations, breakMin: msg.breakMin, enabled: msg.enabled };
    this.pomoTicker.config = config;
    this.langValue = msg.lang;
    this.sys.setLang(msg.lang);
    this.opts.onUiEvent?.({ kind: "pomo-config", config });
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

  // ---- 番茄到期出口（气泡/宠物状态；绝不自动续轮） ----
  private onPomoEnded(wasBreak: boolean): void {
    if (!wasBreak) {
      this.bubble(LINES.pomoDone(this.langValue), "event", true);
      return;
    }
    this.setPetState({ kind: "break-end" });
    this.bubble(LINES.breakOver(this.langValue), "event");
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
