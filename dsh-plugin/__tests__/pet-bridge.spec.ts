/**
 * pet/bridge：桥客户端单元（PassThrough 双工）——hello 握手、上行校验分发（cmd /
 * focus-settle / crash-diag）、坏行/未知类型计错不崩、下行全集发送、心跳 15s（timer 注入）。
 * 类型对齐方式 = 直接 import helper/src/bridge/protocol（单一来源，无复制）。
 */
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { BridgeClient, HEARTBEAT_INTERVAL_MS, type PetTimerApi } from "../src/host/pet/bridge";
import type { CmdMsg, FocusSettleMsg } from "../helper/src/bridge/protocol";

function makeBridge(): { client: BridgeClient; helperToHost: PassThrough; hostToHelper: PassThrough } {
  const helperToHost = new PassThrough();
  const hostToHelper = new PassThrough();
  const client = new BridgeClient({ handlers: { onCmd: () => undefined, onFocusSettle: () => undefined } });
  client.attach(helperToHost, hostToHelper);
  return { client, helperToHost, hostToHelper };
}

describe("上行解码与分发", () => {
  it("hello 握手：onHello + onReady 触发一次；hello 字段可读", () => {
    const { client, helperToHost } = makeBridge();
    const hellos: unknown[] = [];
    client.onReady((hello) => hellos.push(hello));
    helperToHost.write('{"type":"hello","version":"1.0","caps":["task-state"]}\n');
    expect(client.hello?.version).toBe("1.0");
    expect(hellos).toHaveLength(1);
    // 半行缓冲：分片写入拼成完整行
    helperToHost.write('{"type":"hello",');
    helperToHost.write('"version":"2.0","caps":[]}\n');
    expect(client.hello?.version).toBe("2.0");
    expect(hellos).toHaveLength(2); // 每条 hello 都触发 ready（supervisor 按代重发快照）
  });

  it("cmd 上行分发（start/done 带 taskId）；focus-settle 分发", () => {
    const cmds: CmdMsg[] = [];
    const settles: FocusSettleMsg[] = [];
    const helperToHost = new PassThrough();
    const client = new BridgeClient({
      handlers: { onCmd: (m) => cmds.push(m), onFocusSettle: (m) => settles.push(m) },
    });
    client.attach(helperToHost, new PassThrough());
    helperToHost.write('{"type":"cmd","op":"start","taskId":7}\n');
    helperToHost.write('{"type":"cmd","op":"done","taskId":"7"}\n');
    helperToHost.write('{"type":"focus-settle","taskId":1,"localSessionId":"s-1","elapsedMin":5}\n');
    expect(cmds.map((c) => c.op)).toEqual(["start", "done"]);
    expect(cmds[1]?.taskId).toBe("7");
    expect(settles).toHaveLength(1);
    expect(settles[0]?.localSessionId).toBe("s-1");
  });

  it("坏行 / 未知 type / 缺字段 → 计错不崩（丢弃立场与 helper 侧一致）", () => {
    const { client, helperToHost } = makeBridge();
    helperToHost.write('not json\n\n{"type":"unknown-x"}\n{"type":"cmd"}\n');
    expect(client.stats.badLines).toBe(1);
    expect(client.stats.invalidMessages).toBe(2); // 未知 type 与缺 op 各计一条
    expect(client.stats.messagesIn).toBe(0);
    expect(client.stats.linesIn).toBe(3); // 空行不计
  });
});

describe("下行发送（五种全集）", () => {
  it("task-state/pomodoro-config/lang/sprites/heartbeat 逐型发送", () => {
    const { client, hostToHelper } = makeBridge();
    const out: string[] = [];
    hostToHelper.on("data", (chunk: Buffer) =>
      out.push(
        ...String(chunk)
          .split("\n")
          .filter((l) => l !== ""),
      ),
    );
    client.sendTaskState(
      { id: 1, title: "t", categoryPokemon: "pikachu", status: "active" },
      { pendingSuggestions: 2, failures: 1 },
      123,
    );
    client.sendPomodoroConfig({ durations: [15, 25, 45, 60], breakMin: 5, lang: "zh-Hans" });
    client.sendLang("en");
    client.sendSprites({
      builtin: [{ key: "pikachu", id: 25, name: { hans: "皮卡丘", hant: "皮卡丘", en: "Pikachu" } }],
      cdnBase: "https://cdn.example",
    });
    client.sendHeartbeat(456);
    const msgs = out.map((l) => JSON.parse(l) as { type: string });
    expect(msgs.map((m) => m.type)).toEqual(["task-state", "pomodoro-config", "lang", "sprites", "heartbeat"]);
    expect(client.stats.messagesOut).toBe(5);
  });

  it("detach 后发送返回 false（helper 不在，静默丢弃）", () => {
    const { client } = makeBridge();
    client.detach();
    expect(client.sendHeartbeat()).toBe(false);
  });
});

describe("心跳（15 秒供给侧，timer 注入）", () => {
  it("间隔默认 15s；每 tick 发一条 heartbeat；stop 停发", () => {
    // 句柄活性模拟 setInterval 语义：cancel 后 tick 不再触发
    const active = new Set<number>();
    const fns = new Map<number, () => void>();
    let nextHandle = 0;
    const timer: PetTimerApi = {
      every: (ms, fn) => {
        expect(ms).toBe(HEARTBEAT_INTERVAL_MS);
        const handle = ++nextHandle;
        active.add(handle);
        fns.set(handle, fn);
        return handle;
      },
      cancel: (handle) => {
        active.delete(handle as number);
      },
    };
    const fire = (): void => {
      for (const [handle, fn] of fns) {
        if (active.has(handle)) fn();
      }
    };
    const hostToHelper = new PassThrough();
    const client = new BridgeClient({ handlers: { onCmd: () => undefined, onFocusSettle: () => undefined }, timer });
    client.attach(new PassThrough(), hostToHelper);
    client.startHeartbeat();
    const out: string[] = [];
    hostToHelper.on("data", (chunk: Buffer) =>
      out.push(
        ...String(chunk)
          .split("\n")
          .filter((l) => l !== ""),
      ),
    );
    fire();
    fire();
    expect(out).toHaveLength(2);
    expect((JSON.parse(out[0]!) as { type: string }).type).toBe("heartbeat");
    client.stopHeartbeat();
    fire();
    expect(out).toHaveLength(2); // stop 后不再发
  });
});
