/**
 * client pageOpen 订阅（pageOpenStream.ts）：ctx.remote.$stream 监督开流（open = openRemoteStream
 * 端点 pky/pageOpenEvents + payload {args:{}}）、ready 帧 accept、pageOpen 帧投递（section 收窄）、
 * 非法帧忽略、dispose 停流、特征检测门控、终态失败静默。
 */
import { describe, expect, it, vi } from "vitest";
import {
  hasPageOpenStreamFace,
  PAGE_OPEN_STREAM_ENDPOINT,
  subscribePageOpen,
  type DshClientRemote,
  type RemoteStreamOpenOptions,
} from "../../src/client/dsh/pageOpenStream";

/** ctx.remote 替身：openRemoteStream 回放帧序列；$stream 直通 open 并给每项挂 accept 记录 */
function fakeRemote(frames: unknown[], opts: { fail?: Error } = {}) {
  const accepted: unknown[] = [];
  const openCalls: Array<{ endpoint: string; payload: unknown }> = [];
  let disposed = 0;
  let captured: RemoteStreamOpenOptions<unknown> | undefined;
  const remote: DshClientRemote = {
    openRemoteStream(endpoint, payload) {
      openCalls.push({ endpoint, payload });
      return (async function* () {
        for (const frame of frames) {
          yield frame;
        }
        if (opts.fail !== undefined) {
          throw opts.fail;
        }
      })();
    },
    $stream<Item>(options: RemoteStreamOpenOptions<Item>) {
      captured = options as RemoteStreamOpenOptions<unknown>;
      const source = options.open(new AbortController().signal);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const value of source) {
            yield {
              value,
              accept: () => {
                accepted.push(value);
              },
            };
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
    accepted,
    openCalls,
    get disposed() {
      return disposed;
    },
    get options() {
      return captured;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("subscribePageOpen · 开流与帧投递", () => {
  it("经 $stream 开 pky/pageOpenEvents（payload {args:{}}）；ready 帧 accept；pageOpen 帧投递 section 收窄", async () => {
    const fake = fakeRemote([
      { type: "ready" },
      { type: "pageOpen", section: "settings" },
      { type: "pageOpen", section: "bogus" },
      { type: "pageOpen" },
      "garbage",
      { type: "unknown" },
    ]);
    const onEvent = vi.fn();
    subscribePageOpen(fake.remote, onEvent);
    await flush();
    expect(fake.openCalls).toEqual([{ endpoint: PAGE_OPEN_STREAM_ENDPOINT, payload: { args: {} } }]);
    expect(fake.accepted).toEqual([{ type: "ready" }]);
    expect(onEvent.mock.calls.map((c) => c[0])).toEqual([{ section: "settings" }, {}, {}]);
    expect(fake.options?.name).toContain("pageOpen");
    expect(fake.options?.ended(false)).toBeInstanceOf(Error);
  });

  it("停止函数 dispose 流", async () => {
    const fake = fakeRemote([{ type: "ready" }]);
    const stop = subscribePageOpen(fake.remote, vi.fn());
    stop();
    await flush();
    expect(fake.disposed).toBe(1);
  });

  it("流终态失败不上抛（推送面静默降级）", async () => {
    const fake = fakeRemote([{ type: "ready" }], { fail: new Error("carrier lost") });
    const onEvent = vi.fn();
    expect(() => subscribePageOpen(fake.remote, onEvent)).not.toThrow();
    await flush();
    expect(fake.accepted).toHaveLength(1);
  });
});

describe("hasPageOpenStreamFace · 特征检测", () => {
  it("两原语同时为函数才通过；缺任一 / 非对象即拒", () => {
    expect(hasPageOpenStreamFace(fakeRemote([]).remote)).toBe(true);
    expect(hasPageOpenStreamFace({ $stream: () => undefined })).toBe(false);
    expect(hasPageOpenStreamFace({ openRemoteStream: () => undefined })).toBe(false);
    expect(hasPageOpenStreamFace(undefined)).toBe(false);
    expect(hasPageOpenStreamFace(null)).toBe(false);
    expect(hasPageOpenStreamFace("remote")).toBe(false);
  });
});
