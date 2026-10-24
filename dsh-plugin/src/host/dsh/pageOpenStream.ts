/**
 * pageOpen host→客户端推送流的业务体（Remote 流方法 `pky/pageOpenEvents` 的生成器，
 * 零 dsh import——remoteService 只做装饰器挂接）：
 * - 首帧 `ready`：客户端 `$stream` 监督面对它 accept() 重置重连计数（平台自身 $events
 *   流同款首帧模式——空闲事件流若无可 accept 的帧，连续两次断连即被判终态不再重开）；
 * - 其后每条 openPage（桌宠双击 / 托盘 / 快捷键）原样下行；
 * - 订阅先于首帧建立（开流与 ready 之间的事件不丢）；signal 取消（客户端 dispose /
 *   断连 / 宿主收口）即退订结束——gateway 调 return() 走同一 finally。
 */
import type { PageOpenPayload } from "../pet/cmdHandler";

/** 流帧：ready 首帧 + pageOpen 事件帧（section/focus 随 PageOpenPayload 透传） */
export type PageOpenStreamItem = { type: "ready" } | ({ type: "pageOpen" } & PageOpenPayload);

/** 订阅面（= Plugin.onPageOpen 形态） */
export type PageOpenSubscribe = (listener: (event: PageOpenPayload) => void) => () => void;

/** openPage 广播器（section/focus 事件 → 已注册监听器集合逐一转发；host 装配侧持有集合） */
export function pageOpener(
  listeners: Set<(event: PageOpenPayload) => void>,
): (section?: "panel" | "settings", focus?: "capture") => void {
  return (section, focus) => {
    listeners.forEach((l) => l({ section, ...(focus !== undefined ? { focus } : {}) }));
  };
}

export async function* pageOpenEventStream(
  subscribe: PageOpenSubscribe,
  signal: AbortSignal,
): AsyncGenerator<PageOpenStreamItem, void, undefined> {
  const queue: PageOpenPayload[] = [];
  let wake: (() => void) | undefined;
  const notify = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  const off = subscribe((event) => {
    queue.push(event);
    notify();
  });
  signal.addEventListener("abort", notify, { once: true });
  try {
    yield { type: "ready" };
    while (!signal.aborted) {
      const next = queue.shift();
      if (next !== undefined) {
        yield { type: "pageOpen", ...next };
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    off();
    signal.removeEventListener("abort", notify);
  }
}
