/**
 * helper 运行时实现（桥 + 状态机 + sys/ 装配；零静态 Electron 依赖——headless 直跑）。
 * 拆件：pomoTicker / implCeremony（仪式·番茄出口·分发·pomo 域）/ implSupport。
 */
import { Bridge } from "../bridge/bridge.ts";
import { HostPidWatchdog, type HostDeathReason } from "../bridge/heartbeat.ts";
import {
  CMD_OPS,
  type CmdMsg,
  type CmdOp,
  type DownstreamMsg,
  type FocusSettleMsg,
  type Lang,
  type PomodoroConfigMsg,
  type SpritesMsg,
  type TaskStateMsg,
  type UpstreamMsg,
} from "../bridge/protocol.ts";
import { FocusAccumulator } from "../state/focusSettle.ts";
import type { PomoPhase } from "../state/pomodoro.ts";
import { reduce, type PetEvent } from "../state/petState.ts";
import { SpriteResolver } from "../sprites.ts";
import { createHeadlessSys, type SysContext, type SysDownMsg, type SysRouter } from "../sys/index.ts";
import type { BubbleTone, HelperRuntime, RuntimeOptions, UiEvent } from "./index.ts";
import { RuntimeStateBase } from "./state.ts";
import { PomoTicker } from "./pomoTicker.ts";
import { defaultUuid, emitTaskBubbles, helloMsg, residencyTask } from "./implSupport.ts";
import {
  dispatchDownstream,
  emitPomoEnded,
  emitPomoStateOf,
  makePomoControls,
  type PomoCtlHost,
  finishCeremony,
  inputResponseOf,
  petConfigChanged,
  petConfigOf,
  petEventUiEventOf,
  pomoConfigOf,
  speakViaSys,
  spritesEventOf,
} from "./implCeremony.ts";

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
  readonly pomo: HelperRuntime["pomo"];

  private quitIntended = false;
  /** 本端 done 的任务 id（onTaskState 完成迁移时区分本地/外部，消费即清） */
  private localDoneTaskId: number | string | null = null;

  constructor(opts: RuntimeOptions) {
    super();
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.bridge = new Bridge({ heartbeatTimeoutMs: opts.heartbeatTimeoutMs, now: this.now });
    this.resolver = new SpriteResolver(undefined, undefined, opts.keyToId);
    this.focus = new FocusAccumulator({ now: this.now, uuid: opts.uuid ?? defaultUuid });
    this.pidWatchdog = opts.hostPid ? new HostPidWatchdog(opts.hostPid, (r) => this.onHostDead(r)) : null;
    this.pomoTicker = new PomoTicker(
      this.now,
      (kind) => this.onPomoEnded(kind),
      (count) => this.opts.onUiEvent?.({ kind: "pomo-chime", count }),
    );
    this.sysContext = {
      emit: (msg) => this.emitUpstream(msg),
      diag: (tag, detail) => this.bridge.diag.push(tag, detail),
      now: this.now,
    };
    this.sys = opts.sys ?? createHeadlessSys(this.sysContext, { axGranted: opts.axGranted, platform: opts.platform });
    this.pomo = makePomoControls(this.pomoHost()); // ticker 构造后装配
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
  get pomoBreakMin(): number {
    return this.pomoTicker.config.breakMin;
  }
  get pomoNotifyOn(): boolean {
    return this.pomoTicker.config.notify;
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
      this.localDoneTaskId = task.id;
      this.sendCmd("done", { taskId: task.id });
    }
    this.setPetState({ kind: "task-done" });
    // 演出与收尾台词不在本地编排：host done 收官单推（caught 变体随行）→ onTaskState 完成迁移统一接管
  }

  reportPerch(perched: boolean): void {
    if (this.perchedValue === perched) return;
    this.perchedValue = perched;
    this.opts.onUiEvent?.({ kind: "perch", perched });
  }

  get perched(): boolean {
    return this.perchedValue;
  }
  dispose(): void {
    this.pomoTicker.dispose();
    this.pidWatchdog?.stop();
    this.sys.dispose();
    this.bridge.stop();
  }

  handleMessage(msg: DownstreamMsg): void {
    dispatchDownstream(this, msg); // switch 表在 implCeremony.dispatchDownstream
  }

  setLangValue(lang: Lang): void {
    this.langValue = lang;
  }
  setQuotes(map: Record<string, string[]>): void {
    this.quotesValue = map;
  }

  speak(text: string): void {
    speakViaSys(this.sys, text); // 本地 TTS（生日/对话回答/allDone——implCeremony 组装）
  }

  /** sys/ 模块族路由：消息认识但实现在位面缺失 → sys-unsupported 兜底上报（NFR-14；host 侧 hello 门控） */
  routeSysMsg(msg: SysDownMsg): void {
    if (msg.type === "sys-config") this.observeSysConfig(msg);
    if (!this.sys.handle(msg)) this.bridge.reportSysUnsupported(msg.type);
  }

  /** sys-config 的渲染层投影（inputResponse + pet 基础面）——sys 路由之外的旁路观察 */
  private observeSysConfig(msg: Extract<DownstreamMsg, { type: "sys-config" }>): void {
    if (msg.inputResponse) this.inputResponseValue = inputResponseOf(msg.inputResponse);
    if (!msg.pet) return;
    const petConfig = petConfigOf(msg.pet, this.petConfigValue);
    if (petConfigChanged(petConfig, this.petConfigValue)) {
      this.petConfigValue = petConfig;
      this.uiEvent({ kind: "pet-config", ...petConfig });
    }
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
    this.bridge.send(helloMsg(this.sys.caps));
    emitPomoStateOf(this.pomoHost()); // hello 后补发相位快照（宿主重连收敛真值）
  }

  onTaskState(msg: TaskStateMsg): void {
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
    const local = prev !== null && prev.id === this.localDoneTaskId;
    this.localDoneTaskId = null;
    const finished = prev !== null && residencyTask(next) === null && !this.quitIntended;
    if (finished) {
      finishCeremony(this, prev, msg.caught, local);
      return;
    }
    emitTaskBubbles({
      resolver: this.resolver,
      lang: this.langValue,
      quitIntended: this.quitIntended,
      bubble: (text, tone) => this.bubble(text, tone),
      prev,
      next,
    });
  }

  onPomodoroConfig(msg: PomodoroConfigMsg): void {
    const config = pomoConfigOf(msg);
    this.pomoTicker.config = config;
    this.langValue = msg.lang;
    this.sys.setLang(msg.lang);
    this.opts.onUiEvent?.({ kind: "pomo-config", config });
  }

  onSprites(msg: SpritesMsg): void {
    this.resolver.update(msg.builtin, msg.cdnBase);
    this.reducedMotionValue = msg.reducedMotion ?? false;
    this.uiEvent(spritesEventOf(msg, this.reducedMotionValue));
  }

  /** pet-event 下行（P1 D3/D6）：reminder → urgent 底态；渲染层事件组装在 implCeremony */
  onPetEvent(msg: Extract<DownstreamMsg, { type: "pet-event" }>): void {
    if (msg.kind === "reminder") this.setPetState({ kind: "urgent", on: msg.urgent === true });
    const ev = petEventUiEventOf(msg);
    if (ev !== null) this.uiEvent(ev);
  }

  // ---- 宿主存亡 → 退出意图（main.ts 消化：10s SLA 内退出） ----
  private onHostDead(reason: HostDeathReason): void {
    if (this.quitIntended) return;
    this.quitIntended = true;
    // best-effort 结账：stdin 已断则送达不了（无害）；--host-pid 单独触发时宿主还活着，补报
    const settle = this.focus.settleNow();
    if (settle && reason === "host-pid-dead") this.sendFocusSettle(settle);
    this.pidWatchdog?.stop();
    this.uiEvent({ kind: "quit", reason });
  }

  private onPomoEnded(kind: "focus" | "trial" | "break"): void {
    emitPomoEnded(this, kind); // 组装在 implCeremony
    emitPomoStateOf(this.pomoHost()); // 相位快照（chip 倒计时数据源）
  }

  private pomoHost(): PomoCtlHost {
    // implCeremony.makePomoControls 消费面
    return {
      ticker: this.pomoTicker,
      lang: () => this.langValue,
      activeTaskId: () => this.activeTaskValue?.id ?? null,
      now: this.now,
      send: (msg) => this.bridge.send(msg),
      setPetState: (ev) => this.setPetState(ev),
      bubble: (text, tone) => this.bubble(text, tone),
    };
  }

  setPetState(ev: PetEvent): void {
    // 小工具区（其余三个单行体见下）
    this.petStateValue = reduce(this.petStateValue, ev);
    this.uiEvent({ kind: "pet-state", state: this.petStateValue });
  }

  bubble(text: string, tone: BubbleTone = "info", blink = false): void {
    this.uiEvent({ kind: "bubble", text, tone, blink });
  }

  uiEvent(ev: UiEvent): void {
    // 渲染事件出口（implCeremony 宿主面；headless no-op）
    this.opts.onUiEvent?.(ev);
  }

  private sendFocusSettle(settle: Omit<FocusSettleMsg, "type">): boolean {
    const sent = this.bridge.send({ type: "focus-settle", ...settle });
    if (sent) this.bridge.diag.push("focus-settle", `${settle.taskId} +${settle.elapsedMin}min`);
    return sent;
  }
}
