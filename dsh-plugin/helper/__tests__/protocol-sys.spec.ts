/**
 * 协议扩展校验矩阵（full-parity AD §4.3）：下行 8 条 sys 消息 + 上行 9 条 + cmd pet-chat
 * op + hello.caps 8 能力位常量——每消息一组合法样本与拒绝面（未知/缺字段/类型不符）。
 * 丢弃计错不崩立场由返回 null 表达（调用方计错），本 spec 锁形状判定单源。
 */
import { describe, expect, it } from "vitest";
import { validateDownstream, validateUpstream } from "../src/bridge/protocol.ts";
import { SYS_CAPS } from "../src/bridge/sys-protocol.ts";

describe("SYS_CAPS 能力位常量", () => {
  it("8 位全集（AD §4.3 表逐字）", () => {
    expect([...SYS_CAPS]).toEqual([
      "sys-tray",
      "sys-shortcut",
      "sys-notify",
      "sys-tts",
      "sys-dialog",
      "sys-open",
      "input-count",
      "mac-auth",
    ]);
  });
});

describe("下行 sys 扩展 · 合法面", () => {
  it("sys-config 全分节 + 空分节均通过", () => {
    expect(
      validateDownstream({
        type: "sys-config",
        tray: { tooltip: "就决定是你了" },
        shortcuts: { capture: "CmdOrCtrl+Shift+K", togglePet: "CmdOrCtrl+Shift+D" },
        inputResponse: { enabled: true, focusHopCoupleMax: 1.1 },
        tts: { enabled: false },
      }),
    ).not.toBeNull();
    expect(validateDownstream({ type: "sys-config" })).not.toBeNull();
  });

  it("sys-notify 五种 kind 全通过", () => {
    for (const kind of ["reminder", "pomo-done", "pomo-chime", "overdue", "review"]) {
      expect(validateDownstream({ type: "sys-notify", kind, title: "t", body: "b" })).not.toBeNull();
    }
  });

  it("tts-speak / open-path / chat-reply / dialog-cancel 合法样本通过", () => {
    expect(validateDownstream({ type: "tts-speak", text: "捕捉成功" })).not.toBeNull();
    expect(validateDownstream({ type: "open-path", path: "/tmp/exports" })).not.toBeNull();
    expect(validateDownstream({ type: "chat-reply", text: "ans", ok: false })).not.toBeNull();
    expect(validateDownstream({ type: "dialog-cancel", seq: 7 })).not.toBeNull();
  });

  it("dialog-request 带/不带 filters、mac-auth-query 通过", () => {
    expect(
      validateDownstream({
        type: "dialog-request",
        mode: "open-file",
        seq: 1,
        filters: [{ name: "备份", extensions: ["db", "json"] }],
      }),
    ).not.toBeNull();
    expect(validateDownstream({ type: "dialog-request", mode: "open-file", seq: 2 })).not.toBeNull();
    expect(validateDownstream({ type: "mac-auth-query", kind: "accessibility", seq: 3 })).not.toBeNull();
  });
});

describe("下行 sys 扩展 · 拒绝面", () => {
  it("kind/mode/kind 枚举与嵌套类型不符 → 拒绝", () => {
    expect(validateDownstream({ type: "sys-notify", kind: "bogus", title: "t", body: "b" })).toBeNull();
    expect(validateDownstream({ type: "dialog-request", mode: "save-file", seq: 1 })).toBeNull();
    expect(validateDownstream({ type: "mac-auth-query", kind: "screen", seq: 1 })).toBeNull();
    expect(validateDownstream({ type: "sys-config", tts: { enabled: "yes" } })).toBeNull();
  });

  it("缺必填字段 / seq 非非负整数 → 拒绝", () => {
    expect(validateDownstream({ type: "dialog-request", mode: "open-file" })).toBeNull();
    expect(validateDownstream({ type: "dialog-cancel", seq: -1 })).toBeNull();
    expect(validateDownstream({ type: "dialog-cancel", seq: 1.5 })).toBeNull();
    expect(validateDownstream({ type: "open-path" })).toBeNull();
    expect(validateDownstream({ type: "tts-speak", text: 42 })).toBeNull();
    expect(validateDownstream({ type: "chat-reply", text: "a", ok: 1 })).toBeNull();
    expect(
      validateDownstream({ type: "dialog-request", mode: "open-file", seq: 1, filters: [{ name: "x" }] }),
    ).toBeNull();
  });

  it("未知 sys type → 拒绝（丢弃计错面）", () => {
    expect(validateDownstream({ type: "sys-bogus" })).toBeNull();
  });
});

describe("上行 sys 扩展 · 合法面", () => {
  it("tray-action 四动作 / shortcut-fired 两 id 通过", () => {
    for (const action of ["open", "pet-toggle", "settings", "quit"]) {
      expect(validateUpstream({ type: "tray-action", action })).not.toBeNull();
    }
    for (const id of ["capture", "togglePet"]) {
      expect(validateUpstream({ type: "shortcut-fired", id })).not.toBeNull();
    }
  });

  it("dialog-ack/result（含 canceled 与 paths 变体）/ mac-auth-ack/result（seq 0 主动上报）通过", () => {
    expect(validateUpstream({ type: "dialog-ack", seq: 1 })).not.toBeNull();
    expect(validateUpstream({ type: "dialog-result", seq: 1, canceled: true })).not.toBeNull();
    expect(
      validateUpstream({ type: "dialog-result", seq: 1, canceled: false, paths: ["/a.db", "/b.db"] }),
    ).not.toBeNull();
    expect(validateUpstream({ type: "mac-auth-ack", seq: 2 })).not.toBeNull();
    expect(validateUpstream({ type: "mac-auth-result", seq: 0, kind: "accessibility", granted: false })).not.toBeNull();
  });

  it("input-activity / notify-clicked / sys-unsupported 通过", () => {
    expect(validateUpstream({ type: "input-activity", cps: 4.5 })).not.toBeNull();
    expect(validateUpstream({ type: "input-activity", cps: 0 })).not.toBeNull();
    expect(validateUpstream({ type: "notify-clicked", kind: "pomo-done" })).not.toBeNull();
    expect(validateUpstream({ type: "sys-unsupported", unsupported: "sys-notify" })).not.toBeNull();
  });

  it("cmd 扩展 op：pet-chat 通过（text 载荷）", () => {
    const msg = validateUpstream({ type: "cmd", op: "pet-chat", text: "今天心情如何？" });
    expect(msg?.type).toBe("cmd");
    expect((msg as { text?: string }).text).toBe("今天心情如何？");
  });
});

describe("上行 sys 扩展 · 拒绝面", () => {
  it("动作/id 枚举外的值 → 拒绝", () => {
    expect(validateUpstream({ type: "tray-action", action: "reload" })).toBeNull();
    expect(validateUpstream({ type: "shortcut-fired", id: "other" })).toBeNull();
    expect(validateUpstream({ type: "notify-clicked", kind: "bogus" })).toBeNull();
  });

  it("granted/canceled 布尔与 cps 非负约束 → 拒绝", () => {
    expect(validateUpstream({ type: "dialog-result", seq: 1, canceled: "no" })).toBeNull();
    expect(validateUpstream({ type: "mac-auth-result", seq: 1, kind: "accessibility", granted: 0 })).toBeNull();
    expect(validateUpstream({ type: "input-activity", cps: -1 })).toBeNull();
    expect(validateUpstream({ type: "input-activity", cps: "fast" })).toBeNull();
  });

  it("sys-unsupported 载荷字段名 unsupported（与信封 type 撞名已就地改名）→ 缺失拒绝", () => {
    expect(validateUpstream({ type: "sys-unsupported" })).toBeNull();
    expect(validateUpstream({ type: "sys-unsupported", unsupported: "" })).not.toBeNull();
  });
});
