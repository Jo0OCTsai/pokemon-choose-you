/**
 * pet/sysEvents + pet/macAuth：桥事件 host 侧消费（fake host 形态——PassThrough 双工
 * 假 helper）：tray-action 四动作 → pageOpen/petShow/petHide 链；shortcut-fired capture
 * → pageOpen + focus 提示、togglePet → 显隐；input-activity 仅内存状态面（不落库——
 * NFR-13）；macAuthorizationStatus 查询经 mac-auth-query 往返 / helper 缺席降级。
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/host/pet/bridge";
import {
  InputActivityState,
  handleShortcutFired,
  handleTrayAction,
  makeSysEventHandlers,
  type SysEventDeps,
} from "../src/host/pet/sysEvents";
import { macAuthorizationStatus } from "../src/host/pet/macAuth";
import type { PageOpenPayload } from "../src/host/pet/cmdHandler";

interface DepRecorder {
  deps: SysEventDeps;
  opened: PageOpenPayload[];
}

function makeDeps(visible = true): DepRecorder {
  const opened: PageOpenPayload[] = [];
  const state = { visible };
  const deps: SysEventDeps = {
    openPage: (payload) => opened.push(payload),
    petShow: () => {
      state.visible = true;
    },
    petHide: () => {
      state.visible = false;
    },
    petVisible: () => state.visible,
  };
  return { deps, opened };
}

describe("tray-action 消费（FR-A1）", () => {
  it("open → pageOpen 链（默认面板）；settings → pageOpen(section)（A37 零契约变更）", () => {
    const rec = makeDeps();
    handleTrayAction(rec.deps, "open");
    handleTrayAction(rec.deps, "settings");
    expect(rec.opened).toEqual([{}, { section: "settings" }]);
  });

  it("pet-toggle：可见 → hide；不可见 → show", () => {
    const visible = makeDeps(true);
    handleTrayAction(visible.deps, "pet-toggle");
    expect(visible.deps.petVisible()).toBe(false);
    const hidden = makeDeps(false);
    handleTrayAction(hidden.deps, "pet-toggle");
    expect(hidden.deps.petVisible()).toBe(true);
  });

  it("quit → 停 helper（petHide——supervisor 生命周期复用；宿主不受影响）", () => {
    const rec = makeDeps();
    handleTrayAction(rec.deps, "quit");
    expect(rec.deps.petVisible()).toBe(false);
    expect(rec.opened).toEqual([]);
  });
});

describe("shortcut-fired 消费（FR-A2）", () => {
  it("capture → pageOpen(panel) + 聚焦快捕提示（客户端消费面归组 3）", () => {
    const rec = makeDeps();
    handleShortcutFired(rec.deps, "capture");
    expect(rec.opened).toEqual([{ section: "panel", focus: "capture" }]);
  });

  it("togglePet → 显隐切换", () => {
    const rec = makeDeps(true);
    handleShortcutFired(rec.deps, "togglePet");
    expect(rec.deps.petVisible()).toBe(false);
  });
});

describe("input-activity 状态面（NFR-13：仅内存，不落库不外发）", () => {
  it("record 记 lastCps/lastAt；非法值拒绝；handlers 组装透传", () => {
    const state = new InputActivityState();
    state.record(4.5, 111);
    state.record(-2, 222); // 非法：不覆盖
    expect(state.lastCps).toBe(4.5);
    expect(state.lastAt).toBe(111);
    const rec = makeDeps();
    const handlers = makeSysEventHandlers({ ...rec.deps, inputState: state });
    handlers.onInputActivity?.({ type: "input-activity", cps: 6 });
    expect(state.lastCps).toBe(6);
  });

  it("makeSysEventHandlers：mac-auth 主动变更 / notify-clicked / sys-unsupported 观测回调透传", () => {
    const rec = makeDeps();
    const seen: string[] = [];
    const handlers = makeSysEventHandlers({
      ...rec.deps,
      onMacAuthChange: (m) => seen.push(`auth:${m.granted}`),
      onNotifyClicked: (m) => seen.push(`click:${m.kind}`),
      onSysUnsupported: (m) => seen.push(`unsup:${m.unsupported}`),
    });
    handlers.onTrayAction?.({ type: "tray-action", action: "open" });
    handlers.onMacAuthChange?.({ type: "mac-auth-result", seq: 0, kind: "accessibility", granted: false });
    handlers.onNotifyClicked?.({ type: "notify-clicked", kind: "review" });
    handlers.onSysUnsupported?.({ type: "sys-unsupported", unsupported: "sys-tts" });
    expect(rec.opened).toEqual([{}]);
    expect(seen).toEqual(["auth:false", "click:review", "unsup:sys-tts"]);
  });
});

// ---- macAuthorizationStatus（AD §4.1 桌宠域命令 domain 面；命令装配归 2.9） ----

interface FakeHostRig {
  client: BridgeClient;
  sayHello(caps: string[]): void;
  onQuery(cb: (seq: number) => void): void;
  helperToHostWrite(msg: Record<string, unknown>): void;
}

/** fake host：读到 mac-auth-query 即回调（测试内回 ack/result） */
function fakeHostRig(): FakeHostRig {
  const helperToHost = new PassThrough();
  const hostToHelper = new PassThrough();
  const client = new BridgeClient({ handlers: { onCmd: () => undefined, onFocusSettle: () => undefined } });
  client.attach(helperToHost, hostToHelper);
  const listeners: Array<(seq: number) => void> = [];
  hostToHelper.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim() || !line.includes('"mac-auth-query"')) continue;
      const seq = (JSON.parse(line) as { seq: number }).seq;
      for (const cb of listeners) cb(seq);
    }
  });
  return {
    client,
    sayHello: (caps) => helperToHost.write(`${JSON.stringify({ type: "hello", version: "0.1", caps })}\n`),
    onQuery: (cb) => listeners.push(cb),
    helperToHostWrite: (msg) => helperToHost.write(`${JSON.stringify(msg)}\n`),
  };
}

describe("macAuthorizationStatus（FR-A9 授权引导卡数据面）", () => {
  it("helper 缺席 / 未握手 → HELPER_CAPABILITY_MISSING（本地先行 tag）", async () => {
    const result = await macAuthorizationStatus({ bridge: () => null, helperPath: () => "/x/main.js" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HELPER_CAPABILITY_MISSING");
    }
    const rig = fakeHostRig(); // 桥在但 hello 未到
    const unready = await macAuthorizationStatus({ bridge: () => rig.client, helperPath: () => "/x/main.js" });
    expect(unready.ok).toBe(false);
    if (!unready.ok) {
      expect(unready.error.code).toBe("HELPER_CAPABILITY_MISSING");
    }
  });

  it("经 mac-auth-query 往返 → granted + helperPath；能力位缺位同样降级", async () => {
    const rig = fakeHostRig();
    rig.sayHello(["mac-auth"]);
    rig.onQuery((seq) => {
      rig.helperToHostWrite({ type: "mac-auth-ack", seq });
      rig.helperToHostWrite({ type: "mac-auth-result", seq, kind: "accessibility", granted: true });
    });
    const result = await macAuthorizationStatus({
      bridge: () => rig.client,
      helperPath: () => "/pkg/helper/dist/main.js",
    });
    expect(result).toEqual({ ok: true, data: { granted: true, helperPath: "/pkg/helper/dist/main.js" } });
  });

  it("能力位缺位（hello 无 mac-auth）→ HELPER_CAPABILITY_MISSING", async () => {
    const rig = fakeHostRig();
    rig.sayHello(["sys-tray"]);
    const result = await macAuthorizationStatus({ bridge: () => rig.client, helperPath: () => "/x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("HELPER_CAPABILITY_MISSING");
    }
  });
});
