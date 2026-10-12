/**
 * rpcDispatch 分发单测（平台胶水层纯逻辑件，mock commands 表）：
 * ① 端点归属/解析（pky/ 前缀、空命令不归属）；
 * ② ok/fail 信封 → 线上结果转换（data → value；error.code/message 直传、hint → details.hint）；
 * ③ 未知命令走 createHostCommands 的 INVALID_ARGUMENT 信封（不抛错）；
 * ④ 命令实现的非 PkyError 异常原样上抛（编程缺陷不静默）。
 */
import { describe, expect, it } from "vitest";
import { PkyError } from "../src/host/storage/errors";
import type { HostCommandCaller } from "../src/host/commands";
import { createPkyRpcDispatcher, isPkyEndpoint, pkyCommandOf } from "../src/host/dsh/rpcDispatch";

describe("端点归属与解析", () => {
  it("pky/<命令> 归属且解析出命令名", () => {
    expect(isPkyEndpoint("pky/taskStart")).toBe(true);
    expect(pkyCommandOf("pky/taskStart")).toBe("taskStart");
  });

  it("非 pky/ 前缀与空命令不归属", () => {
    expect(isPkyEndpoint("taskStart")).toBe(false);
    expect(isPkyEndpoint("pky/")).toBe(false);
    expect(isPkyEndpoint("other/pky/x")).toBe(false);
    expect(pkyCommandOf("pky/")).toBeUndefined();
  });
});

/** 未知命令缺省信封（与 createHostCommands 的 INVALID_ARGUMENT 口径一致） */
const unknownCommand: HostCommandCaller = async (command) => ({
  ok: false,
  error: { code: "INVALID_ARGUMENT", message: `未知 host 命令 ${command}` },
});

describe("createPkyRpcDispatcher：成功/失败信封转换", () => {
  it("成功信封 → {ok:true, value:data}（透传命令与参数）", async () => {
    const commands: HostCommandCaller = async (command, params) => {
      expect(command).toBe("taskStart");
      expect(params).toEqual({ id: 7 });
      return { ok: true, data: { task: { id: 7 } } };
    };
    await expect(createPkyRpcDispatcher(commands)("pky/taskStart", { id: 7 })).resolves.toEqual({
      ok: true,
      value: { task: { id: 7 } },
    });
  });

  it("失败信封 → {ok:false, error:{code,message,details.hint}}", async () => {
    const commands: HostCommandCaller = async () => ({
      ok: false,
      error: { code: "LARK_UNAUTHORIZED", message: "未授权", hint: "先跑 lark-cli login" },
    });
    await expect(createPkyRpcDispatcher(commands)("pky/pollNow")).resolves.toEqual({
      ok: false,
      error: { code: "LARK_UNAUTHORIZED", message: "未授权", details: { hint: "先跑 lark-cli login" } },
    });
  });

  it("失败信封无 hint → details 空对象（ConnectionRpcFailure.details 必填）", async () => {
    const commands: HostCommandCaller = async () => ({
      ok: false,
      error: { code: "NOT_FOUND", message: "任务不存在" },
    });
    await expect(createPkyRpcDispatcher(commands)("pky/taskStart", { id: 404 })).resolves.toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "任务不存在", details: {} },
    });
  });

  it("PkyError 已由 createHostCommands 收敛为信封——分发层只认信封（透传一致性）", async () => {
    const commands: HostCommandCaller = async () => {
      const error = new PkyError("SETTING_MODIFIED_ELSEWHERE", "别处已改");
      return { ok: false, error: error.toShape() };
    };
    await expect(createPkyRpcDispatcher(commands)("pky/configWrite")).resolves.toEqual({
      ok: false,
      error: { code: "SETTING_MODIFIED_ELSEWHERE", message: "别处已改", details: {} },
    });
  });
});

describe("createPkyRpcDispatcher：边界与异常口径", () => {
  it("未知命令 → INVALID_ARGUMENT（createHostCommands 信封，不抛错）", async () => {
    await expect(createPkyRpcDispatcher(unknownCommand)("pky/noSuchCommand")).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "未知 host 命令 noSuchCommand", details: {} },
    });
  });

  it("非 pky/ 端点不触达命令表", async () => {
    const commands: HostCommandCaller = async () => ({ ok: true, data: null });
    await expect(createPkyRpcDispatcher(commands)("sessions/list", {})).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_ARGUMENT", message: "非 pky/ 端点：sessions/list", details: {} },
    });
  });

  it("命令实现抛非 PkyError → 原样上抛（编程缺陷不静默）", async () => {
    const commands: HostCommandCaller = async () => {
      throw new Error("boom");
    };
    await expect(createPkyRpcDispatcher(commands)("pky/taskStart")).rejects.toThrow("boom");
  });
});
