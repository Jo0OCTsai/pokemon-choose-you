/**
 * DshRpcTransport 信封还原（Phase B 适配层，Typert Remote 迁移后形态）：命令 → /api
 * 通道 Remote 端点 pky/call（args 按源码参数名键控）→ 传输层 ConnectionRpcResult 的
 * value = 业务信封原样透传（双信封剥层）；传输失败信封还原（details.hint→hint /
 * 未知码折叠）、diagnosticsSnapshot 视图模型归一（status→level）、pageOpen 本地监听面。
 */
import { describe, expect, it, vi } from "vitest";
import { createDshRpcTransport, type DshConnectionResult } from "../../src/client/dsh/transport";
import type { PkyResult } from "../../src/client/rpc";

/** rpc.call 替身：按脚本逐条回放（并记录上行参数） */
function fakeRpc(script: DshConnectionResult[]) {
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
  let i = 0;
  return {
    calls,
    async call(channel: string, endpoint: string, payload?: unknown): Promise<DshConnectionResult> {
      calls.push({ channel, endpoint, payload });
      return script[i++] ?? { ok: true, value: null };
    },
  };
}

describe("DshRpcTransport · 信封还原", () => {
  it("成功：业务信封透传 → {ok,data}；通道 = /api、端点 = pky/call、args 按参数名键控", async () => {
    const rpc = fakeRpc([{ ok: true, value: { ok: true, data: { keyValues: { language: "en" } } } }]);
    const transport = createDshRpcTransport(rpc);
    const result: PkyResult<{ keyValues: Record<string, string> }> = await transport.send("configRead");
    expect(result).toEqual({ ok: true, data: { keyValues: { language: "en" } } });
    expect(rpc.calls).toEqual([
      { channel: "/api", endpoint: "pky/call", payload: { args: { command: "configRead" } } },
    ]);
  });

  it("payload 原样上行（args.payload）", async () => {
    const rpc = fakeRpc([{ ok: true, value: { ok: true, data: 1 } }]);
    const transport = createDshRpcTransport(rpc);
    await transport.send("taskPause", { taskId: 3 });
    expect(rpc.calls[0]?.payload).toEqual({ args: { command: "taskPause", payload: { taskId: 3 } } });
  });

  it("业务信封失败：error 原样还原（不经传输层折叠）", async () => {
    const rpc = fakeRpc([
      { ok: true, value: { ok: false, error: { code: "DISPATCH_TIMEOUT", message: "派发超时", hint: "重试" } } },
    ]);
    const result = await createDshRpcTransport(rpc).send("dispatchRun", { taskId: 1 });
    expect(result).toEqual({ ok: false, error: { code: "DISPATCH_TIMEOUT", message: "派发超时", hint: "重试" } });
  });

  it("传输成功但 value 非业务信封形态 → INVALID_ARGUMENT 防御", async () => {
    const rpc = fakeRpc([{ ok: true, value: 42 }]);
    const result = await createDshRpcTransport(rpc).send("pollNow");
    expect(result).toEqual({ ok: false, error: { code: "INVALID_ARGUMENT", message: "Remote 返回值不是业务信封" } });
  });

  it("失败：code/message 透传，hint 从 details.hint 还原", async () => {
    const rpc = fakeRpc([
      {
        ok: false,
        error: {
          code: "SUGGESTION_ALREADY_RESOLVED",
          message: "该建议已在另一处处置",
          details: { hint: "刷新后重试" },
        },
      },
    ]);
    const transport = createDshRpcTransport(rpc);
    const result = await transport.send("reviewAccept", { messageId: "m1" });
    expect(result).toEqual({
      ok: false,
      error: { code: "SUGGESTION_ALREADY_RESOLVED", message: "该建议已在另一处处置", hint: "刷新后重试" },
    });
  });

  it("失败：无 hint 时 error 不含 hint 键（对齐 PkyErrorShape）", async () => {
    const rpc = fakeRpc([{ ok: false, error: { code: "NOT_FOUND", message: "任务不存在", details: {} } }]);
    const result = await createDshRpcTransport(rpc).send("taskStart", { taskId: 99 });
    expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "任务不存在" } });
  });

  it("失败：未知码（dsh internal/transport 层）折叠为 INVALID_ARGUMENT，原码并入 message", async () => {
    const rpc = fakeRpc([{ ok: false, error: { code: "internal", message: "boom", details: {} } }]);
    const result = await createDshRpcTransport(rpc).send("pollNow");
    expect(result).toEqual({ ok: false, error: { code: "INVALID_ARGUMENT", message: "[internal] boom" } });
  });
});

describe("DshRpcTransport · diagnosticsSnapshot 归一", () => {
  it("host 字段 status → 客户端契约 level（level 已在则不动）", async () => {
    const rpc = fakeRpc([
      {
        ok: true,
        value: {
          ok: true,
          data: {
            links: [
              { provider: "feishu", status: "degraded" },
              { provider: "ai", level: "ok" },
            ],
          },
        },
      },
    ]);
    const result = await createDshRpcTransport(rpc).send("diagnosticsSnapshot");
    expect(result).toEqual({
      ok: true,
      data: {
        links: [
          { provider: "feishu", level: "degraded" },
          { provider: "ai", level: "ok" },
        ],
      },
    });
  });

  it("非 diagnostics 命令与其他形态载荷原样透传", async () => {
    const rpc = fakeRpc([
      { ok: true, value: { ok: true, data: { ok: true } } },
      { ok: true, value: { ok: true, data: { links: null } } },
    ]);
    const transport = createDshRpcTransport(rpc);
    expect(await transport.send("petShow")).toEqual({ ok: true, data: { ok: true } });
    expect(await transport.send("diagnosticsSnapshot")).toEqual({ ok: true, data: { links: null } });
  });
});

describe("DshRpcTransport · pageOpen 监听面", () => {
  it("on 注册 / emit 分发 / 退订停发（host 推送接面未落型——本地通道为接线位）", () => {
    const transport = createDshRpcTransport(fakeRpc([]));
    const listener = vi.fn();
    const off = transport.on("pageOpen", listener);
    transport.emitPageOpen({ section: "settings" });
    expect(listener).toHaveBeenCalledWith({ section: "settings" });
    off();
    transport.emitPageOpen({ section: "panel" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
