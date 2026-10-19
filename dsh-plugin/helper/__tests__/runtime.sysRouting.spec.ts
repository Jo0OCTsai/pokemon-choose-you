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

  it("completeTask → catch-scene 事件（默认 plain；solemn 注入 milestone 优先）", () => {
    const h = makeHarness();
    h.write({
      type: "task-state",
      activeTask: { id: 1, title: "写周报", categoryPokemon: "pikachu", status: "active" },
      badge: { pendingSuggestions: 0, failures: 0 },
      ts: 0,
    });
    h.runtime.completeTask();
    expect(h.events.find((e) => e.kind === "catch-scene")).toEqual({ kind: "catch-scene", scene: "plain" });
    h.runtime.dispose();

    const events2: UiEvent[] = [];
    const h2 = createHelperRuntime({
      input: new PassThrough(),
      output: new PassThrough(),
      solemn: () => ({ milestone: 100, streakDays: 5 }),
      onUiEvent: (ev) => events2.push(ev),
    });
    h2.completeTask();
    expect(events2.find((e) => e.kind === "catch-scene")).toEqual({ kind: "catch-scene", scene: "milestone" });
    h2.dispose();
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
