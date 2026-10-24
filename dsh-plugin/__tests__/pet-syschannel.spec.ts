/**
 * pet/sysChannel：sys 发送面（hello 门控 + 能力位缺位不发 + sys-config 分节过滤 +
 * tts 文本预处理）与 seq 两段语义（ack 10s 超时降级 / result 完成级不设短超时 /
 * 5min 长超时兜底 / cancel 后迟到 result 丢弃 / dispose 收口）——PassThrough 双工 +
 * 手动时钟 + 旧协议 hello 样本回放（双版本兼容矩阵，NFR-14）。
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BridgeClient } from "../src/host/pet/bridge";
import { prepareTtsText, sysSystemClock, type SysClock } from "../src/host/pet/sysChannel";
import type { PkyError } from "../src/host/storage/errors";

/** 手动时钟：advance 按到期序触发（不真等待） */
class ManualClock implements SysClock {
  private now = 0;
  private nextId = 0;
  private timers = new Map<number, { fn: () => void; at: number }>();

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.nextId;
    this.timers.set(id, { fn, at: this.now + ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.now += ms;
    for (const [id, timer] of [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= this.now) {
        this.timers.delete(id);
        timer.fn();
      }
    }
  }
}

type DownLine = { type: string; seq?: number } & Record<string, unknown>;

interface Rig {
  client: BridgeClient;
  clock: ManualClock;
  written: DownLine[];
  sayHello(caps: string[]): void;
  /** 模拟 helper 上行（JSON 行写 helperToHost） */
  helperWrites(msg: Record<string, unknown>): void;
}

function makeRig(): Rig {
  const helperToHost = new PassThrough();
  const hostToHelper = new PassThrough();
  const written: DownLine[] = [];
  const clock = new ManualClock();
  const client = new BridgeClient({
    handlers: { onCmd: () => undefined, onFocusSettle: () => undefined },
    sysClock: clock,
  });
  client.attach(helperToHost, hostToHelper);
  hostToHelper.on("data", (chunk: Buffer) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim()) written.push(JSON.parse(line) as DownLine);
    }
  });
  return {
    client,
    clock,
    written,
    sayHello: (caps) => helperToHost.write(`${JSON.stringify({ type: "hello", version: "0.1", caps })}\n`),
    helperWrites: (msg) => helperToHost.write(`${JSON.stringify(msg)}\n`),
  };
}

async function expectCapabilityMissing(p: Promise<unknown>): Promise<void> {
  await p.then(
    () => {
      throw new Error("应 reject");
    },
    (e: unknown) => {
      expect((e as PkyError).code).toBe("HELPER_CAPABILITY_MISSING");
    },
  );
}

function seqOf(written: DownLine[], type: string): number {
  const msg = written.find((m) => m.type === type);
  if (msg === undefined) throw new Error(`未发出 ${type}`);
  return msg.seq as number;
}

describe("发送面 · hello 门控与能力位（旧协议样本回放）", () => {
  it("未收到 hello：sys 消息一律不发（计数 blocked；请求 reject 能力缺席）", async () => {
    const rig = makeRig();
    expect(rig.client.sys.sendSysNotify("reminder", "t", "b")).toBe(false);
    expect(rig.client.sys.sendTtsSpeak("hi")).toBe(false);
    expect(rig.written).toEqual([]);
    expect(rig.client.sys.stats.blocked).toBe(2);
    await expectCapabilityMissing(rig.client.sys.requestOpenFileDialog());
  });

  it("旧协议 hello（无 sys 能力位）：全部 sys 发送被门控", () => {
    const rig = makeRig();
    rig.sayHello(["task-state", "pomodoro-local", "focus-settle"]);
    expect(rig.client.sys.sendSysNotify("reminder", "t", "b")).toBe(false);
    expect(rig.client.sys.sendTtsSpeak("hi")).toBe(false);
    expect(rig.client.sys.sendOpenPath("/tmp")).toBe(false);
    expect(rig.written.filter((m) => m.type !== "hello")).toEqual([]);
  });

  it("能力位在位才发；chat-reply 仅 hello 门控（无独立能力位）", () => {
    const rig = makeRig();
    rig.sayHello(["sys-notify"]);
    expect(rig.client.sys.sendSysNotify("overdue", "t", "b")).toBe(true);
    expect(rig.client.sys.sendTtsSpeak("hi")).toBe(false); // sys-tts 缺位
    expect(rig.client.sys.sendChatReply("回答", true)).toBe(true);
    expect(rig.written.filter((m) => m.type === "sys-notify")).toHaveLength(1);
    expect(rig.written.filter((m) => m.type === "chat-reply")).toHaveLength(1);
  });

  it("sys-config 分节过滤：缺位分节剥离；全部缺位不发", () => {
    const rig = makeRig();
    rig.sayHello(["sys-tray", "sys-tts"]);
    expect(
      rig.client.sys.sendSysConfig({
        tray: { tooltip: "就决定是你了" },
        shortcuts: { capture: "CmdOrCtrl+Shift+K", togglePet: "CmdOrCtrl+Shift+D" },
        tts: { enabled: true },
      }),
    ).toBe(true);
    const sent = rig.written.find((m) => m.type === "sys-config") as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["tray", "tts", "type"]); // shortcuts 被 sys-shortcut 缺位剥离
    expect(rig.client.sys.sendSysConfig({ inputResponse: { enabled: true } })).toBe(false); // 全缺位
  });
});

describe("tts 文本预处理（桌面 voice.rs 同构）", () => {
  it("剥 emoji/符号、保留 ↑↓ 与文本、截 120 码点、空串不发送", () => {
    expect(prepareTtsText("🐾 捕捉成功！记入图鉴 ✔")).toBe("捕捉成功！记入图鉴");
    expect(prepareTtsText("连胜 5 天 ↑加油↓")).toBe("连胜 5 天 ↑加油↓");
    expect(prepareTtsText("a".repeat(200))).toBe("a".repeat(120));
    expect(prepareTtsText("🐾✔")).toBeNull();
  });
});

describe("seq 两段语义 · 回执级（ack 判能力在位）", () => {
  it("ack 10s 超时 → HELPER_CAPABILITY_MISSING（回执级判能力）；迟到 ack 计 lateDropped", async () => {
    const rig = makeRig();
    rig.sayHello(["sys-dialog"]);
    const outcome = rig.client.sys.requestOpenFileDialog();
    const seq = seqOf(rig.written, "dialog-request");
    rig.clock.advance(10_000);
    await expectCapabilityMissing(outcome);
    rig.helperWrites({ type: "dialog-ack", seq }); // 迟到 ack：丢弃
    expect(rig.client.sys.stats.lateDropped).toBe(1);
  });

  it("ack 到位后不设短超时：4 分钟仍在等待（用户交互时长不触发降级）", async () => {
    const rig = makeRig();
    rig.sayHello(["sys-dialog"]);
    const outcome = rig.client.sys.requestOpenFileDialog();
    let settled = false;
    outcome.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    rig.helperWrites({ type: "dialog-ack", seq: seqOf(rig.written, "dialog-request") });
    rig.clock.advance(4 * 60_000);
    await new Promise((r) => setTimeout(r, 0)); // 微任务冲刷后再查——确认 promise 未被结清
    expect(settled).toBe(false); // 4min < 5min 兜底：不降级不结清
    expect(rig.client.sys.pendingCount).toBe(1);
  });
});

describe("seq 两段语义 · 完成级（result / cancel / 长超时兜底）", () => {
  it("result 到达即结清（含 paths）；pending 归零", async () => {
    const rig = makeRig();
    rig.sayHello(["sys-dialog"]);
    const outcome = rig.client.sys.requestOpenFileDialog();
    rig.helperWrites({ type: "dialog-ack", seq: seqOf(rig.written, "dialog-request") });
    rig.helperWrites({
      type: "dialog-result",
      seq: seqOf(rig.written, "dialog-request"),
      canceled: false,
      paths: ["/a.db"],
    });
    await expect(outcome).resolves.toEqual({ canceled: false, paths: ["/a.db"] });
    expect(rig.client.sys.pendingCount).toBe(0);
  });

  it("result ≥5min 长超时兜底（完成级）→ 拒绝", async () => {
    const rig = makeRig();
    rig.sayHello(["sys-dialog"]);
    const outcome = rig.client.sys.requestOpenFileDialog();
    rig.helperWrites({ type: "dialog-ack", seq: seqOf(rig.written, "dialog-request") });
    rig.clock.advance(300_000);
    await expect(outcome).rejects.toThrow(/长超时/);
  });

  it("cancel：下发 dialog-cancel 并以 canceled 收口；迟到 result 丢弃不改写", async () => {
    const rig = makeRig();
    rig.sayHello(["sys-dialog"]);
    const outcome = rig.client.sys.requestOpenFileDialog();
    const seq = seqOf(rig.written, "dialog-request");
    rig.helperWrites({ type: "dialog-ack", seq });
    expect(rig.client.sys.cancelDialog(seq)).toBe(true);
    await expect(outcome).resolves.toEqual({ canceled: true, paths: [] });
    expect(rig.written.some((m) => m.type === "dialog-cancel" && m.seq === seq)).toBe(true);
    rig.helperWrites({ type: "dialog-result", seq, canceled: false, paths: ["/late.db"] });
    expect(rig.client.sys.stats.lateDropped).toBe(1); // 迟到结果丢弃
    expect(rig.client.sys.cancelDialog(seq)).toBe(false); // 已结清
  });
});

describe("seq 两段语义 · mac-auth 与主动上报", () => {
  it("queryMacAuth 往返：ack → result(granted:false) 结清", async () => {
    const rig = makeRig();
    rig.sayHello(["mac-auth"]);
    const query = rig.client.sys.queryMacAuth();
    const seq = seqOf(rig.written, "mac-auth-query");
    rig.helperWrites({ type: "mac-auth-ack", seq });
    rig.helperWrites({ type: "mac-auth-result", seq, kind: "accessibility", granted: false });
    await expect(query).resolves.toEqual({ granted: false });
  });

  it("seq 0 主动上报（授权撤销）→ onMacAuthChange；未知 seq result 计迟到丢弃", () => {
    const helperToHost = new PassThrough();
    const changes: boolean[] = [];
    const client = new BridgeClient({
      handlers: {
        onCmd: () => undefined,
        onFocusSettle: () => undefined,
        onMacAuthChange: (m) => changes.push(m.granted),
      },
      sysClock: sysSystemClock,
    });
    client.attach(helperToHost, new PassThrough());
    helperToHost.write('{"type":"mac-auth-result","seq":0,"kind":"accessibility","granted":false}\n');
    helperToHost.write('{"type":"mac-auth-result","seq":99,"kind":"accessibility","granted":true}\n');
    expect(changes).toEqual([false]);
    expect(client.sys.stats.lateDropped).toBe(1);
  });
});

describe("dispose（helper 断开/换代）", () => {
  it("pending 全部按能力缺席收口（HELPER_CAPABILITY_MISSING）", async () => {
    const rig = makeRig();
    rig.sayHello(["sys-dialog"]);
    const outcome = rig.client.sys.requestOpenFileDialog();
    rig.client.detach();
    await expectCapabilityMissing(outcome);
    expect(rig.client.sys.pendingCount).toBe(0);
  });
});
