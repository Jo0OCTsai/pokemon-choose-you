/**
 * broker 子进程入口（build.mjs 第三入口 → dist/broker.mjs，跑在系统 Node）：
 * BoringSSL 宿主（dsh 桌面）的家族传输外包（compatibility.md A3 过渡通道）——
 * 裸 cordis 双 label isolate 装配 dsh-ssh 家族（spike 修正 A/B 模式），scope 面 =
 * 与进程内同一 DshSshScope（语义零分叉），经 brokerServe 对 stdio JSON 行服务。
 *
 * 解析锚定：@deepseek-ai/* 构建保持 external——从本包闭包解析（dist/broker.mjs
 * 同目录锚定到 <插件包>/node_modules，等价宿主 bundle 口径；端到端已验：裸系统
 * Node 连真容器 252ms 建连 + 远端执行，闭包三件自给自足不依赖宿主 anchor）。
 * 输出面纪律：stdout 只走协议（console.* 一律 stderr）；stdin EOF = 宿主消亡
 * → 尽力 dispose 后退出。
 */
import { Context } from "@deepseek-ai/cordis";
import { serveBroker, type BrokerScopeFace } from "../dsh/brokerServe";
import type { BrokerConnectConfig } from "../dsh/brokerProtocol";
import type { CordisFiber, CordisHostContext } from "../dsh/sshScope";
import { DshSshScope } from "../dsh/sshScopeImpl";
import { loadConsumer, loadFamily } from "../dsh/sshScopeFamily";
import type { ScopeDisconnectedListener } from "../dsh/sshScopeHost";

/** broker 允许的最低系统 Node 大版本（家族闭包运行基线） */
const NODE_MAJOR_MIN = 20;

function assertNodeRuntime(): void {
  const major = Number(process.versions.node.split(".")[0] ?? "0");
  if (!Number.isFinite(major) || major < NODE_MAJOR_MIN) {
    console.error(`broker: 系统 Node >= ${NODE_MAJOR_MIN} 必需（当前 ${process.versions.node}）`);
    process.exit(1);
  }
}

/**
 * 装配链 = sshScopeHost.connectScope 同款（双 label isolate + fiber await +
 * consumer；断开通知为进程内收口——broker 侧无宿主监听器，no-op）。
 * 失败路径与进程内一致：任一 fiber 失败 → 卸载已装后上抛（host 侧按连接失败映射）。
 */
async function connectScope(
  config: BrokerConnectConfig,
  deploymentId: string,
  workdir: string,
): Promise<BrokerScopeFace> {
  const { sshPlugin, subprocessPlugin } = await loadFamily();
  const ctx: CordisHostContext = new Context(); // 最小结构类型面（RC 期 API 漂移隔离在 sshScope.ts 口径内）
  const sshScope = ctx.isolate("ssh", Symbol(`pky-broker-${deploymentId}-ssh`));
  const subScope = sshScope.isolate("subprocess", Symbol(`pky-broker-${deploymentId}-sub`));
  const noOpListener: ScopeDisconnectedListener = () => undefined;
  const loadOrder: CordisFiber[] = [];
  try {
    const sshFiber = sshScope.plugin(sshPlugin, config);
    loadOrder.push(sshFiber);
    await sshFiber;
    const subFiber = subScope.plugin(subprocessPlugin, {});
    loadOrder.push(subFiber);
    await subFiber;
    const consumer = await loadConsumer(subScope, `broker-${deploymentId.slice(0, 8)}`);
    loadOrder.push(consumer.fiber);
    return new DshSshScope({
      deploymentId,
      workdir,
      services: consumer.services,
      fibers: loadOrder,
      onDisconnected: noOpListener,
    });
  } catch (error) {
    await Promise.allSettled(loadOrder.map((fiber) => fiber.dispose()));
    throw error;
  }
}

assertNodeRuntime();
const handle = serveBroker((req) => connectScope(req.config, req.deploymentId, req.workdir), {
  readable: process.stdin,
  writable: process.stdout,
});
// stopped 落定（disconnect 应答完毕 / 读侧 EOF 收线）→ 进程退出（不留常驻）
void handle.stopped.then(() => process.exit(0));
