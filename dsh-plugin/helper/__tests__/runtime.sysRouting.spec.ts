import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { createHelperRuntime, type UiEvent } from "../src/runtime/index.ts";
import type { HeadlessSys } from "../src/sys/index.ts";
import { SYS_CAPS } from "../src/bridge/sys-protocol.ts";

/**
 * runtime sys 路由集成（进程内 PassThrough 双工 + headless 记录器）：
 * sys 下行七消息全路由消费（无 sys-unsupported）、chat-reply 直达渲染层、
 * 可见性乐观翻转、catch-scene 变体、DeferredSys 排队重放。
 */
function makeHarness(opts: { axGranted?: boolean; platform?: NodeJS.Platform } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const events: UiEvent[] = [];
  const outLines: string[] = [];
  let buf = "";
  output.setEncoding("utf8");
  output.on("data", (c: string) => {
    buf += c;
    for (;;) {
      const i = buf.indexOf("\n");
      if (i < 0) break;
      const l = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (l.trim()) outLines.push(l);
    }
  });
  const runtime = createHelperRuntime({
    input,
    output,
    axGranted: opts.axGranted,
    platform: opts.platform,
    onUiEvent: (ev) => events.push(ev),
  });
  return {
    runtime,
    sys: runtime.sys as HeadlessSys,
    events,
    outLines,
    input,
    write: (obj: object) => input.write(`${JSON.stringify(obj)}\n`),
    parsed: () => outLines.map((l) => JSON.parse(l) as Record<string, unknown>),
    upstream: (type: string) =>
      outLines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((m) => m.type === type),
  };
}

/** 流回合冲刷（PassThrough 消费与上行 data 事件经事件循环调度——CI 慢机非同步落地） */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("sys 路由（hello 能力位 + 七下行全消费）", () => {
  it("hello 含 8 系统能力位（headless 全量声明）", () => {
    const h = makeHarness();
    const hello = h.parsed().find((m) => m.type === "hello");
    for (const cap of SYS_CAPS) expect(hello!.caps).toContain(cap);
    expect(hello!.caps).toContain("task-state");
    h.runtime.dispose();
  });

  it("sys-notify / tts-speak / open-path / sys-config 全消费——零 sys-unsupported", () => {
    const h = makeHarness();
    h.write({ type: "sys-notify", kind: "reminder", title: "t", body: "b" });
    h.write({ type: "tts-speak", text: "hi" });
    h.write({ type: "open-path", path: "/tmp" });
    h.write({ type: "sys-config", tts: { enabled: true }, tray: { tooltip: "值班中" } });
    expect(h.sys.notify.records).toHaveLength(1);
    expect(h.sys.tts.records.enabled).toBe(true);
    expect(h.sys.openPath.records).toEqual(["/tmp"]);
    expect(h.sys.tray.records.tooltip).toBe("值班中");
    // tts-speak 默认静音——enabled 后补一条才记录
    h.write({ type: "tts-speak", text: "郑重时刻" });
    expect(h.sys.tts.records.spoken).toEqual(["郑重时刻"]);
    expect(h.upstream("sys-unsupported")).toHaveLength(0);
    h.runtime.dispose();
  });
});

describe("sys 路由：两段语义与授权联动", () => {
  it("dialog-request → 秒级 ack + 完成级 result；可编程结果", () => {
    const h = makeHarness();
    h.sys.dialogs.nextResult = { canceled: false, paths: ["/data/a.db"] };
    h.write({ type: "dialog-request", mode: "open-file", seq: 3 });
    expect(h.upstream("dialog-ack")).toEqual([{ type: "dialog-ack", seq: 3 }]);
    expect(h.upstream("dialog-result")).toEqual([
      { type: "dialog-result", seq: 3, canceled: false, paths: ["/data/a.db"] },
    ]);
    h.runtime.dispose();
  });

  it("mac-auth-query → ack + result（granted 随 axGranted 初值）", () => {
    const h = makeHarness({ axGranted: true, platform: "darwin" }); // D32 darwin 门——Linux CI 上注入覆盖
    h.write({ type: "mac-auth-query", kind: "accessibility", seq: 5 });
    expect(h.upstream("mac-auth-ack")).toEqual([{ type: "mac-auth-ack", seq: 5 }]);
    expect(h.upstream("mac-auth-result")).toEqual([
      { type: "mac-auth-result", seq: 5, kind: "accessibility", granted: true },
    ]);
    h.runtime.dispose();
  });

  it("授权撤销 → seq 0 主动上报 + inputCount 即停", async () => {
    const h = makeHarness({ axGranted: true, platform: "darwin" }); // D32 darwin 门——Linux CI 上注入覆盖
    h.write({ type: "sys-config", inputResponse: { enabled: true } });
    await flush();
    expect(h.sys.inputCount.running).toBe(true);
    h.sys.macAuth.revoke();
    expect(h.sys.inputCount.running).toBe(false);
    await flush();
    expect(h.upstream("mac-auth-result")).toEqual([
      { type: "mac-auth-result", seq: 0, kind: "accessibility", granted: false },
    ]);
    h.runtime.dispose();
  });
});

describe("chat-reply 与渲染层事件", () => {
  it("chat-reply 下行 → UiEvent 直达（ok=false 失败面）", () => {
    const h = makeHarness();
    h.write({ type: "chat-reply", text: "连胜 5 天了！", ok: true });
    h.write({ type: "chat-reply", text: "", ok: false });
    const replies = h.events.filter((e) => e.kind === "chat-reply");
    expect(replies[0]).toEqual({ kind: "chat-reply", text: "连胜 5 天了！", ok: true });
    expect(replies[1]).toEqual({ kind: "chat-reply", text: "", ok: false });
    h.runtime.dispose();
  });
});

/** 喂一只进行中任务（完成迁移用例的公共夹具） */
function seedActive(h: ReturnType<typeof makeHarness>, task: Record<string, unknown>): void {
  h.write({ type: "task-state", activeTask: task, badge: { pendingSuggestions: 0, failures: 0 }, ts: 0 });
}

function pushFinished(h: ReturnType<typeof makeHarness>, caught?: Record<string, unknown>): void {
  h.write({
    type: "task-state",
    activeTask: null,
    badge: { pendingSuggestions: 0, failures: 0 },
    ts: 1,
    ...(caught ? { caught } : {}),
  });
}

describe("完成仪式：plain 与外部收尾（task-state.caught 驱动）", () => {
  it("本地 done 不再本地编排演出——host 收官单推 plain → 捕捉成功台词 + plain 演出", () => {
    const h = makeHarness();
    seedActive(h, { id: 1, title: "写周报", categoryPokemon: "pikachu", status: "active" });
    h.runtime.completeTask();
    expect(h.events.find((e) => e.kind === "catch-scene")).toBeUndefined();
    expect(h.upstream("cmd").some((m) => m.op === "done")).toBe(true);
    pushFinished(h);
    expect(h.events.find((e) => e.kind === "catch-scene")).toEqual({
      kind: "catch-scene",
      scene: "plain",
      allDone: false,
    });
    expect(h.events.filter((e) => e.kind === "bubble").at(-1)?.text).toContain("捕捉成功");
    h.runtime.dispose();
  });

  it("外部完成（无本地 done）→ 别处收工台词 + plain 演出（桌面 pk 完成同演捕捉戏口径）", () => {
    const h = makeHarness();
    seedActive(h, { id: 3, title: "远端任务", categoryPokemon: "psyduck", status: "active" });
    pushFinished(h);
    expect(h.events.find((e) => e.kind === "catch-scene")).toEqual({
      kind: "catch-scene",
      scene: "plain",
      allDone: false,
    });
    expect(h.events.filter((e) => e.kind === "bubble").at(-1)?.text).toContain("别处收工");
    h.runtime.dispose();
  });
});

describe("完成仪式：caught 变体与 pet 基础面投影", () => {
  it("caught.milestone → milestone 演出 + 里程碑台词", () => {
    const h = makeHarness();
    seedActive(h, { id: 1, title: "写周报", categoryPokemon: "pikachu", status: "active" });
    h.runtime.completeTask();
    pushFinished(h, { milestone: 100 });
    expect(h.events.find((e) => e.kind === "catch-scene")).toEqual({
      kind: "catch-scene",
      scene: "milestone",
      allDone: false,
    });
    expect(h.events.filter((e) => e.kind === "bubble").at(-1)?.text).toContain("100");
    h.runtime.dispose();
  });

  it("台词优先级 allDone > streak（allDone+streakDays → streak 双球演出 + 收工台词）", () => {
    const h = makeHarness();
    seedActive(h, { id: 2, title: "复盘", categoryPokemon: "eevee", status: "active" });
    pushFinished(h, { allDone: true, streakDays: 4 });
    expect(h.events.find((e) => e.kind === "catch-scene")).toMatchObject({ scene: "streak", allDone: true });
    expect(h.events.filter((e) => e.kind === "bubble").at(-1)?.text).toContain("图鉴圆满");
    h.runtime.dispose();
  });

  it("sys-config.pet 分节 → pet-config 投影（mate/聊聊 + 精灵与窗口配置继承缺省）", () => {
    const h = makeHarness();
    h.write({
      type: "sys-config",
      pet: { mate: true, agentConfigured: false, mainPokemon: "eevee", scale: 1.5, opacity: 80 },
    });
    expect(h.runtime.petConfig).toEqual({
      mate: true,
      agentConfigured: false,
      mainPokemon: "eevee",
      alwaysOnTop: true,
      scale: 1.5,
      opacity: 80,
    });
    expect(h.events.find((e) => e.kind === "pet-config")).toMatchObject({ kind: "pet-config", mate: true, scale: 1.5 });
    h.runtime.dispose();
  });
});

describe("quotes / pet-event 下行（P1 新增面）", () => {
  it("惰性台词集 + 提醒 urgent 底态 + 位置复位", () => {
    const h = makeHarness();
    h.write({ type: "quotes", map: { psyduck: ["呆呆地看着你"] } });
    expect(h.runtime.quotes).toEqual({ psyduck: ["呆呆地看着你"] });
    expect(h.events.find((e) => e.kind === "quotes")).toMatchObject({ kind: "quotes" });
    h.write({ type: "pet-event", kind: "reminder", taskId: 7, title: "周报", urgent: true, pokemon: "psyduck" });
    expect(h.runtime.petState.base).toBe("urgent");
    expect(h.events.find((e) => e.kind === "reminder")).toMatchObject({ kind: "reminder", taskId: 7, urgent: true });
    h.write({ type: "pet-event", kind: "reset-pos" });
    expect(h.events.find((e) => e.kind === "reset-pos")).toEqual({ kind: "reset-pos" });
    h.runtime.dispose();
  });

  it("非 urgent 提醒不进 urgent 底态；urgent 撤离回 idle", () => {
    const h = makeHarness();
    h.write({ type: "pet-event", kind: "reminder", taskId: 8, title: "普通", urgent: false });
    expect(h.runtime.petState.base).not.toBe("urgent");
    h.write({ type: "pet-event", kind: "reminder", taskId: 9, title: "急件", urgent: true });
    expect(h.runtime.petState.base).toBe("urgent");
    h.runtime.dispose();
  });
});

describe("可见性乐观翻转（托盘「显示/隐藏」label 数据源）", () => {
  it("cmd hide → 不可见；tray pet-toggle → 翻转回可见", () => {
    const h = makeHarness();
    expect(h.runtime.petVisible).toBe(true);
    h.runtime.sendCmd("hide");
    expect(h.runtime.petVisible).toBe(false);
    expect(h.sys.tray.records.visible).toBe(false);
    h.sys.tray.click("pet-toggle"); // 经 ctx.emit 观察 → runtime 翻转
    expect(h.runtime.petVisible).toBe(true);
    expect(h.sys.tray.records.visible).toBe(true);
    h.runtime.dispose();
  });

  it("shortcut togglePet 触发同样翻转", () => {
    const h = makeHarness();
    h.sys.shortcuts.configure({ capture: "A", togglePet: "B" });
    h.sys.shortcuts.fire("togglePet");
    expect(h.runtime.petVisible).toBe(false);
    h.runtime.dispose();
  });
});

describe("inputResponse 配置投影（渲染层快照面）", () => {
  it("sys-config.inputResponse → runtime.inputResponse（hop 上限钳 0.1）", () => {
    const h = makeHarness();
    h.write({ type: "sys-config", inputResponse: { enabled: true, focusHopCoupleMax: 0.5 } });
    expect(h.runtime.inputResponse).toEqual({ enabled: true, hopCoupleMax: 0.1 });
    h.write({ type: "sys-config", inputResponse: { enabled: false } });
    expect(h.runtime.inputResponse.enabled).toBe(false);
    h.runtime.dispose();
  });
});
