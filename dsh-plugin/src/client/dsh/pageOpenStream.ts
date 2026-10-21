/**
 * pageOpen 推送订阅（host→client 真实接面，2026-10-21——原 transport 本地监听面的上游源）：
 * host `PkyRemoteService` 的 SRC 流方法 `pky/pageOpenEvents`（@Remote mode=stream，首帧
 * ready + 逐条 pageOpen）经 `ctx.remote.$stream` 监督开流——`open` 调 ClientRemoteService
 * 的 `openRemoteStream` 按端点开 Gateway 逻辑流（浏览器载体 = /api/remote.mux WebSocket
 * mux；payload `{args:{}}` = 零业务参数的 SRC wire 形态，与 unary `pky/call` 的 `{args}`
 * 同款）。ready 帧 accept() 重置监督的重连计数（平台 $events 流同款首帧模式——否则空闲
 * 事件流遇连续两次断连即判终态不再重开）；pageOpen 帧投递回调。重连节拍由 $stream 按
 * connection 代际驱动，客户端仍无周期性定时器（NFR-6）。
 *
 * `openRemoteStream` 不在 dsh-api-gateway 公开 .d.ts（$mount 装配出的生成流方法内部也经它
 * 开流——rc.2 实证），本层结构化收窄 + 装配期特征检测：缺席即不订阅（推送面降级，侧边栏
 * 手动导航与面板内功能不受影响）。
 */
import type { PageOpenEvent } from "../rpc";

/** $stream 产出项（value + 代际 accept） */
export interface RemoteStreamItemFace<Item> {
  readonly value: Item;
  accept(): void;
}

/** $stream 返回的监督流（单消费者；dispose 永久停止） */
export interface RemoteStreamFace<Item> extends AsyncIterable<RemoteStreamItemFace<Item>> {
  dispose(): Promise<void>;
}

/** $stream 选项（dsh-api-gateway RemoteStreamOptions 的消费子集） */
export interface RemoteStreamOpenOptions<Item> {
  readonly name: string;
  readonly open: (signal: AbortSignal) => AsyncIterable<Item>;
  readonly ended: (accepted: boolean) => Error;
}

/** ctx.remote 面（结构化收窄：域流监督 + 按端点开流原语） */
export interface DshClientRemote {
  $stream<Item>(options: RemoteStreamOpenOptions<Item>): RemoteStreamFace<Item>;
  openRemoteStream(endpoint: string, payload: unknown, signal: AbortSignal): AsyncIterable<unknown>;
}

/** 流端点（单源 = host remoteService.ts `@Remote({ name: "pageOpenEvents" })` + 命名空间 pky） */
export const PAGE_OPEN_STREAM_ENDPOINT = "pky/pageOpenEvents";

/** 装配期特征检测：两原语同时在场才订阅 */
export function hasPageOpenStreamFace(remote: unknown): remote is DshClientRemote {
  return (
    remote !== null &&
    typeof remote === "object" &&
    typeof (remote as { $stream?: unknown }).$stream === "function" &&
    typeof (remote as { openRemoteStream?: unknown }).openRemoteStream === "function"
  );
}

function pageOpenEventOf(frame: Record<string, unknown>): PageOpenEvent {
  const section = frame.section;
  return section === "panel" || section === "settings" ? { section } : {};
}

async function pump(stream: RemoteStreamFace<unknown>, onEvent: (event: PageOpenEvent) => void): Promise<void> {
  try {
    for await (const item of stream) {
      const frame = item.value;
      if (frame === null || typeof frame !== "object") {
        continue;
      }
      const type = (frame as { type?: unknown }).type;
      if (type === "ready") {
        item.accept();
      } else if (type === "pageOpen") {
        onEvent(pageOpenEventOf(frame as Record<string, unknown>));
      }
    }
  } catch {
    // 终态 = 宿主流正常结束（host 插件卸载/重载）或监督重试耗尽：推送面随之停止，面板仍可经
    // 侧边栏手动打开；客户端无日志面，不上抛——避免宿主全局错误呈现把插件卸载当故障
  }
}

/** 订阅 pageOpen 推送：返回停止函数（fiber 卸载时 dispose 流） */
export function subscribePageOpen(remote: DshClientRemote, onEvent: (event: PageOpenEvent) => void): () => void {
  const stream = remote.$stream<unknown>({
    name: "pokemon-choose-you/pageOpen",
    open: (signal) => remote.openRemoteStream(PAGE_OPEN_STREAM_ENDPOINT, { args: {} }, signal),
    ended: () => new Error("pokemon-choose-you: pageOpen 事件流被宿主结束"),
  });
  void pump(stream, onEvent);
  return () => {
    void stream.dispose();
  };
}
