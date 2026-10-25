/**
 * PkyRemoteService 的 SRC 标记契约（gateway resolveSrcDescriptor 的输入面）：真实 cordis Context
 * 上构造服务，经 typert `remoteMethods` 读装饰器标记——`call` unary（端点 pky/call）+
 * `pageOpenEvents` stream（端点 pky/pageOpenEvents，末参 signal = 取消注入位）；流方法委托
 * 订阅面并透传 signal。标记形态变动即红（客户端 transport / pageOpenStream 端点字面量的单源锚）。
 */
import { Context } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { describe, expect, it, vi } from "vitest";
import { PkyRemoteService } from "../src/host/dsh/remoteService";
import type { PageOpenPayload } from "../src/host/pet/cmdHandler";

function build() {
  const ctx = new Context();
  const dispatch = vi.fn(async (command: string, payload?: unknown) => ({
    ok: true as const,
    data: { command, payload },
  }));
  let listener: ((event: PageOpenPayload) => void) | undefined;
  const off = vi.fn();
  const subscribe = vi.fn((l: (event: PageOpenPayload) => void) => {
    listener = l;
    return off;
  });
  const service = new PkyRemoteService(ctx, dispatch, subscribe);
  return { ctx, service, dispatch, subscribe, off, emit: (e: PageOpenPayload) => listener?.(e) };
}

describe("PkyRemoteService · SRC 标记", () => {
  it("call = unary（端点 pky/call）；pageOpenEvents = stream（端点 pky/pageOpenEvents）——端点名 = exportName ?? method", () => {
    const { service } = build();
    const markers = remoteMethods(service).map((m) => ({ endpoint: m.exportName ?? m.method, mode: m.mode }));
    expect(markers).toEqual([
      { endpoint: "call", mode: undefined },
      { endpoint: "pageOpenEvents", mode: "stream" },
    ]);
  });

  it("服务注册在 ctx 的 pky 键下并携带 typertRemote 绑定（gateway resolveSrcDescriptor 的发现面）", () => {
    const { ctx } = build();
    const registered = ctx.get("pky") as { typertRemote?: { namespace: string; serviceKey: string } } | undefined;
    expect(registered?.typertRemote).toMatchObject({ namespace: "pky", serviceKey: "pky" });
  });

  it("SRC 参数名可解析：call(command, payload) / pageOpenEvents(signal)（本包不 minify 的前提在源码层成立）", () => {
    const names = (fn: unknown) =>
      String(fn)
        .replace(/^[^(]*\(/, "")
        .replace(/\)[\s\S]*$/, "")
        .split(",")
        .map((s) => s.trim().replace(/=.*$/, "").trim())
        .filter(Boolean);
    expect(names(PkyRemoteService.prototype.call)).toEqual(["command", "payload"]);
    expect(names(PkyRemoteService.prototype.pageOpenEvents)).toEqual(["signal"]);
  });
});

describe("PkyRemoteService · 方法委托", () => {
  it("call 直转 dispatch 并原样返回业务信封", async () => {
    const { service, dispatch } = build();
    await expect(service.call("petShow", { x: 1 })).resolves.toEqual({
      ok: true,
      data: { command: "petShow", payload: { x: 1 } },
    });
    expect(dispatch).toHaveBeenCalledWith("petShow", { x: 1 });
  });

  it("pageOpenEvents 委托订阅面：ready 首帧 → 事件透传 → abort 退订", async () => {
    const { service, subscribe, off, emit } = build();
    const controller = new AbortController();
    const iterator = service.pageOpenEvents(controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual({ type: "ready" });
    expect(subscribe).toHaveBeenCalledTimes(1);
    emit({ section: "panel" });
    expect((await iterator.next()).value).toEqual({ type: "pageOpen", section: "panel" });
    const pending = iterator.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(off).toHaveBeenCalledTimes(1);
  });
});
