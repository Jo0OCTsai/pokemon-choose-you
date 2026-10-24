/**
 * dsh/brokerProtocol：broker 桥协议编解码（host ↔ 系统 Node broker 子进程，
 * stdio JSON 行）——消息编码 / 行分帧解码（跨 chunk 半行、一行多义）往返一致。
 * 协议面纯请求-响应（无流事件）：终端输出不回流（交互面 = spawn/write/terminate
 * 三原语，sshExecutorTerminal 消费面）。
 */
import { describe, expect, it } from "vitest";
import {
  createLineDecoder,
  encodeBrokerReply,
  encodeHostRequest,
  type HostRequest,
  type BrokerReply,
} from "../src/host/dsh/brokerProtocol";

describe("broker 协议编解码", () => {
  it("host 请求编码 = 单行 JSON + 换行；六类 op 形状稳定", () => {
    const cases: HostRequest[] = [
      {
        id: 1,
        op: "connect",
        config: { host: "a", node: "/n", helper: "/h", helperHash: "x", workspace: "/w" },
        deploymentId: "d1",
        workdir: "/w",
      },
      { id: 2, op: "spawn", argv: ["/bin/sh", "-c", "echo hi"], cwd: "/w", timeoutMs: 1000, stdin: "text" },
      { id: 3, op: "spawnTerminal", argv: ["/bin/sh"], cwd: "/w" },
      { id: 4, op: "writeTerminal", sessionId: "pky-term-1-1", data: "ls\n" },
      { id: 5, op: "terminateTerminal", sessionId: "pky-term-1-1" },
      { id: 6, op: "disconnect" },
    ];
    for (const msg of cases) {
      const line = encodeHostRequest(msg);
      expect(line.endsWith("\n")).toBe(true);
      expect(line.indexOf("\n")).toBe(line.length - 1); // 单行
      expect(JSON.parse(line)).toEqual(msg); // 往返一致
    }
  });

  it("broker 应答编码：ok / error 两态", () => {
    const ok: BrokerReply = { id: 1, ok: true, result: { code: 0, stdout: "hi", stderr: "", durationMs: 5 } };
    const err: BrokerReply = { id: 2, ok: false, error: "连接建立失败" };
    expect(JSON.parse(encodeBrokerReply(ok))).toEqual(ok);
    expect(JSON.parse(encodeBrokerReply(err))).toEqual(err);
  });

  it("行解码：跨 chunk 半行拼接、一行多消息、空行跳过、坏行上抛", () => {
    const got: BrokerReply[] = [];
    const decoder = createLineDecoder<BrokerReply>((m) => got.push(m));
    decoder.feed(Buffer.from('{"id":1,"ok":tr'));
    expect(got).toHaveLength(0); // 半行不派发
    decoder.feed(Buffer.from('ue,"result":{}}\n\n{"id":2,"ok":false,"error":"e"}\n{"id":3'));
    expect(got.map((m) => m.id)).toEqual([1, 2]); // 空行跳过、多行依次派发、尾半行留驻
    decoder.feed(Buffer.from(',"ok":true,"result":null}\n'));
    expect(got.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(() => decoder.feed(Buffer.from("{bad json}\n"))).toThrow();
  });
});
