/**
 * pageOpenEventStream（Remote 流方法 pky/pageOpenEvents 的业务体）：首帧 ready → openPage
 * 事件逐条下行（section/focus 透传、FIFO）→ signal abort / 消费者 return() 均退订结束。
 */
import { describe, expect, it, vi } from "vitest";
import { pageOpenEventStream, type PageOpenStreamItem } from "../src/host/dsh/pageOpenStream";
import type { PageOpenPayload } from "../src/host/pet/cmdHandler";

/** 订阅面替身：记录监听者 + 退订计数，emit 直推 */
function fakeSubscribe() {
  const listeners = new Set<(event: PageOpenPayload) => void>();
  const off = vi.fn();
  return {
    off,
    get size() {
      return listeners.size;
    },
    emit(event: PageOpenPayload) {
      for (const l of listeners) {
        l(event);
      }
    },
    subscribe: (listener: (event: PageOpenPayload) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        off();
      };
    },
  };
}

describe("pageOpenEventStream · 首帧与事件下行", () => {
  it("首帧 ready；订阅在首帧前建立；事件按序下行并透传 section/focus", async () => {
    const sub = fakeSubscribe();
    const stream = pageOpenEventStream(sub.subscribe, new AbortController().signal);
    expect((await stream.next()).value).toEqual({ type: "ready" });
    expect(sub.size).toBe(1);
    sub.emit({ section: "settings" });
    sub.emit({ section: "panel", focus: "capture" });
    expect((await stream.next()).value).toEqual({ type: "pageOpen", section: "settings" });
    expect((await stream.next()).value).toEqual({ type: "pageOpen", section: "panel", focus: "capture" });
  });

  it("空闲等待期事件到达即唤醒下行（不轮询）", async () => {
    const sub = fakeSubscribe();
    const stream = pageOpenEventStream(sub.subscribe, new AbortController().signal);
    await stream.next();
    const pending = stream.next();
    sub.emit({});
    expect((await pending).value).toEqual({ type: "pageOpen" });
  });
});

describe("pageOpenEventStream · 结束与退订", () => {
  it("signal abort：空闲等待被唤醒并结束，退订一次", async () => {
    const sub = fakeSubscribe();
    const controller = new AbortController();
    const stream = pageOpenEventStream(sub.subscribe, controller.signal);
    await stream.next();
    const pending = stream.next();
    controller.abort();
    expect((await pending).done).toBe(true);
    expect(sub.off).toHaveBeenCalledTimes(1);
    expect(sub.size).toBe(0);
  });

  it("消费者提前 return()（gateway 取消流）：finally 退订", async () => {
    const sub = fakeSubscribe();
    const stream = pageOpenEventStream(sub.subscribe, new AbortController().signal);
    await stream.next();
    await stream.return();
    expect(sub.off).toHaveBeenCalledTimes(1);
  });

  it("signal 已 abort 时开流：仍先出 ready 再结束（客户端 accept 语义不依赖存活期）", async () => {
    const sub = fakeSubscribe();
    const controller = new AbortController();
    controller.abort();
    const items: PageOpenStreamItem[] = [];
    for await (const item of pageOpenEventStream(sub.subscribe, controller.signal)) {
      items.push(item);
    }
    expect(items).toEqual([{ type: "ready" }]);
    expect(sub.off).toHaveBeenCalledTimes(1);
  });
});
