/**
 * /pky RPC 通道注册（平台胶水层，rc.2 时序适配 + 已知降级）。
 *
 * 平台事实（pky-test 实测，2026-10-13，待迁移 Typert Remote——见 debt）：
 * ① connection/webServer 均晚供（webserver 组合起动后才 provide），且 loader 装载的
 *   插件子 fiber 收不到 provide 事件的 notify——先行 ctx.inject 挂起等不到，须轮询
 *   reflect._getImpl 探测就绪后再创建 inject 子 fiber（此刻依赖即满足、回调立即执行）；
 * ② 就绪后 connection.rpc.handle 仍抛 "cannot get property webServer without
 *   inject"——其实现经「服务访问的影子 ctx」读 owner.webServer（影子 ctx 上属性
 *   不可达；connCtx 本体可访问），traceable 与裸实例两路径同错（栈钉在
 *   dsh-client-connection lib/index.js:656）——rc.2 的自定义通道面第三方实际不可用。
 *   官方宿主→客户端数据面全部走 Typert Remote（@Remote 服务方法 + api-gateway /api
 *   通道——schedule/plugin-manager 同款），迁移后本模块整体替换。
 *
 * 当前行为：通道注册失败打降级日志、不抛错（fiber 保持 active，工具面不受影响）；
 * 面板经 /pky 的读命令全部失败 → 客户端空态。headless 组合无 connection：轮询
 * 10 分钟上限后静默放弃。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Plugin } from "../index";
import { PKY_RPC_CHANNEL, createPkyRpcDispatcher } from "./rpcDispatch";

/** reflect 内部面（裸探测，绕开属性访问严格制） */
type ReflectProbe = { _getImpl(name: string): unknown } | undefined;

/** connection 消费面（收窄：本层只用 rpc.handle） */
type ConnectionFace = {
  rpc: { handle(channel: string, handler: (endpoint: string, payload?: unknown) => Promise<unknown>): () => void };
};

/** 双服务就绪探测（_getImpl 裸探；异常视同未就绪——晚供窗口内可能抛） */
function servicesReady(reflect: ReflectProbe): boolean {
  try {
    return reflect?._getImpl?.("connection") !== undefined && reflect?._getImpl?.("webServer") !== undefined;
  } catch {
    return false;
  }
}

/** 就绪后注册：inject 子 fiber（双依赖此刻 active，创建期即满足）内挂通道 */
function registerWhenReady(ctx: Context, plugin: Plugin): void {
  ctx.inject(["connection", "webServer"], (connCtx: Context) => {
    try {
      const dispatch = createPkyRpcDispatcher(plugin.commands);
      const connection = (connCtx as unknown as { connection: ConnectionFace }).connection;
      const dispose = connection.rpc.handle(PKY_RPC_CHANNEL, (endpoint, payload) => dispatch(endpoint, payload));
      connCtx.effect(() => dispose, "pky: /pky RPC 通道");
      process.stderr.write("[pokemon-choose-you] /pky RPC 通道已注册\n");
    } catch (error) {
      process.stderr.write(
        `[pokemon-choose-you] /pky 通道注册失败（rc.2 自定义通道面不可用，待迁 Typert Remote）：${String(error)}\n`,
      );
    }
  });
}

/** 通道注册编排：即时探测 → 1s 轮询（上限 10 分钟）→ 就绪 arm（幂等） */
export function registerRpcChannel(ctx: Context, plugin: Plugin): void {
  const reflect = (ctx as { reflect?: unknown }).reflect as ReflectProbe;
  if (servicesReady(reflect)) {
    registerWhenReady(ctx, plugin);
    return;
  }
  let armed = false;
  const poll = setInterval(() => {
    if (!servicesReady(reflect) || armed) {
      return;
    }
    armed = true;
    clearInterval(poll);
    registerWhenReady(ctx, plugin);
  }, 500);
  const giveUp = setTimeout(() => clearInterval(poll), 10 * 60 * 1000);
  ctx.effect(
    () => () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    },
    "pky: connection 就绪轮询",
  );
}
