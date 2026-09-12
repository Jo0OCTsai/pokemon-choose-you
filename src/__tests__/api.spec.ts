import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../api";

/** 动态 import("@tauri-apps/api/core") 在 vitest 里命中同一个 mock */
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

beforeEach(() => {
  invoke.mockReset();
});

describe("api 错误分层（Rust AppError → ApiError）", () => {
  it("后端 AppError 对象归一化：保留 kind/message/retryable", async () => {
    invoke.mockRejectedValue({ kind: "invalid", message: "输入无效: 标题不能为空", retryable: false });
    const err = await api.createTask({ title: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("invalid");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("标题不能为空");
  });

  it("网络类错误标记可重试", async () => {
    invoke.mockRejectedValue({ kind: "network", message: "网络错误: 连接超时", retryable: true });
    const err = await api.syncTodoist().catch((e) => e);
    expect(err.retryable).toBe(true);
  });

  it("旧式纯字符串错误归为 external 且不可重试", async () => {
    invoke.mockRejectedValue("任意历史错误文本");
    const err = await api.listTasks("open").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("external");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("任意历史错误文本");
  });

  it("IPC 传输层 JS 异常归为可重试网络错误", async () => {
    invoke.mockRejectedValue(new Error("webview closed"));
    const err = await api.listCategories().catch((e) => e);
    expect(err.kind).toBe("network");
    expect(err.retryable).toBe(true);
  });

  it("成功路径透传返回值", async () => {
    invoke.mockResolvedValue([]);
    await expect(api.listCategories()).resolves.toEqual([]);
  });
});
