/**
 * clientEntry 的 host→client pageOpen 推送面：remote 在场时订阅 pky/pageOpenEvents 流，
 * pageOpen 帧 → layout.selectPanel(PANEL_ID) 客户端闭环导航；订阅挂 effect 回收；
 * remote 缺席/形态不符不订阅不抛。装配替身见 client-entry-harness.ts。
 */
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DshClientRemote } from "../../src/client/dsh/pageOpenStream";
import { PANEL_ID } from "../../src/client/dsh/sidebarPanel";
import { mockHost } from "../../src/client/rpc";
import { applyWith } from "./client-entry-harness";

/** ctx.remote 替身：$stream 直通 open；openRemoteStream 回放帧序列（形态同 host pky/pageOpenEvents） */
function fakeRemote(frames: unknown[]) {
  let disposed = 0;
  const remote: DshClientRemote = {
    openRemoteStream: () =>
      (async function* () {
        for (const frame of frames) {
          yield frame;
        }
      })(),
    $stream(options) {
      const source = options.open(new AbortController().signal);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const value of source) {
            yield { value, accept: () => undefined };
          }
        },
        dispose: async () => {
          disposed += 1;
        },
      };
    },
  };
  return {
    remote,
    get disposed() {
      return disposed;
    },
  };
}

describe("clientEntry · host:pageOpen 推送 → 导航直达本面板", () => {
  it("remote 在场：订阅 pky/pageOpenEvents 流，pageOpen 帧 → layout.selectPanel(PANEL_ID)；订阅挂 effect 回收", async () => {
    const selectPanel = vi.fn();
    const fake = fakeRemote([{ type: "ready" }, { type: "pageOpen", section: "settings" }, { type: "pageOpen" }]);
    const { effectDisposers } = applyWith(mockHost(), { layout: { selectPanel }, remote: fake.remote });
    await waitFor(() => expect(selectPanel).toHaveBeenCalledTimes(2));
    expect(selectPanel).toHaveBeenCalledWith(PANEL_ID);
    expect(effectDisposers).toHaveLength(1);
    effectDisposers[0]?.();
    await waitFor(() => expect(fake.disposed).toBe(1));
  });

  it("remote 缺席 / 形态不符（无 openRemoteStream）：不订阅、不注册 effect、apply 不抛", () => {
    expect(applyWith(mockHost(), { remote: undefined }).effectDisposers).toEqual([]);
    expect(applyWith(mockHost(), { remote: { $stream: () => undefined } }).effectDisposers).toEqual([]);
  });

  it("layout 缺席时推送仍被消费（opener noop 不抛）", async () => {
    const fake = fakeRemote([{ type: "ready" }, { type: "pageOpen", section: "panel" }]);
    expect(() => applyWith(mockHost(), { remote: fake.remote })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
