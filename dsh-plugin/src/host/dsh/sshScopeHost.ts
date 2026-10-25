/**
 * dsh-ssh 家族 scope 宿主（从 sshScope.ts 拆出——棘轮 max-lines，等量迁移；
 * sshScope.ts 为统一再出口，消费面不变）：per-deployment scope 注册表 + 装配
 * （connectScope 双 label isolate 装载链）+ scopeFor 路由（helper 落定状态判定）；
 * DshSshScope 实现在 sshScopeImpl.ts、直连兜底实现在 directScope.ts。
 */
import type { DeploymentEntity } from "../remote/deployments";
import type { SshScope } from "../remote/sshScope";
import type { CordisFiber, CordisHostContext, SshFamilyConfig } from "./sshScope";
import { createBrokerConnect, type BrokerHostOptions } from "./brokerConnect";
import { createDirectSshScope } from "./directScope";
import { tlsPskAvailable } from "./tlsStack";
import { DshSshScope } from "./sshScopeImpl";
import { loadConsumer, loadFamily } from "./sshScopeFamily";

/** 部署实体 → dsh-ssh Config（AD §4.7：host=alias/launch.node=nodePath/helper/workspace=workdir） */
function familyConfig(entity: DeploymentEntity): SshFamilyConfig {
  return {
    host: entity.alias,
    launch: { kind: "node-script", node: entity.nodePath },
    helper: entity.helperPath,
    helperHash: entity.helperHash ?? "",
    // workdir 空串 = 登录目录：以 "." 交给远端 helper 缺省（无绝对路径可展开——$HOME 在 provision 状态内不回填实体）
    workspace: entity.workdir !== "" ? entity.workdir : ".",
  };
}

/** 实体五元组缓存键（任一漂移 → 重建 scope） */
function configKeyOf(config: SshFamilyConfig): string {
  return JSON.stringify(config);
}

/**
 * helper 落定判定（scopeFor 路由单源）：helperPath 与 helperHash 均落定且不在
 * 重装中 → 家族链传输可用；任一未落定（provision 中 / 从未安装）或重装进行中
 * （provision 有记录且 upload 步未 ok——mismatch/restart 重置）→ 直连 ssh 兜底
 * （重装经直连执行，破「装 helper 需先有 helper」的家族链建连死锁）。
 */
export function familyProvisioned(entity: DeploymentEntity): boolean {
  const reinstalling = entity.provision !== null && entity.provision.steps.upload.status !== "ok";
  return entity.helperPath !== "" && entity.helperHash !== null && !reinstalling;
}

// ---- 宿主（per-deployment scope 注册表；装配层消费面） ----

/** 断开事件监听（recheck 触发/迟到回传挂接——装配归任务 2.8/2.9） */
export type ScopeDisconnectedListener = (deploymentId: string) => void;

/** dsh-ssh 家族 scope 宿主（hostEntry 装配面消费；createPlugin 依赖注入归任务 2.9） */
export interface SshScopeHost {
  /**
   * 按部署取/建 SshScope：helper 已落定 → dsh-ssh isolate scope（同配置存活连接
   * 复用；配置漂移或已断开 → 同 label 重建）；未落定（provision 中）或 helper 制品
   * 与当前闭包权威摘要不符（插件升级后的旧 helper）→ 直连 ssh scope（无长连，每次
   * 新建实例——sshScopeHost 兜底路由，acceptance §4 已知项 1）。
   */
  scopeFor(entity: DeploymentEntity): Promise<SshScope>;
  /** 关闭指定部署的连接（幂等；deploymentDelete 消费） */
  disconnect(deploymentId: string): Promise<void>;
  /** 关闭全部连接（插件卸载收口） */
  dispose(): Promise<void>;
  /** 断开事件注册（显式 disconnect / 建连失败后置位时通知） */
  onScopeDisconnected(listener: ScopeDisconnectedListener): void;
}

/** 存活家族连接登记（configKey 漂移检测 + scope 交互只经 SshScope 基面） */
export interface LiveScopeEntry {
  configKey: string;
  scope: SshScope;
}

/** 宿主可调项（测试注入 fake 工厂锁路由判定；生产缺省全走真实装配） */
export interface SshScopeHostOptions {
  /** 直连 scope 工厂（缺省 createDirectSshScope；测试 spy 断言未落定路由） */
  directScopeFor?(alias: string): SshScope;
  /** 家族链装配（缺省 connectScope 真实装载链；测试 fake 断言落定路由） */
  connect?(
    ctx: CordisHostContext,
    labels: { sshLabel: symbol; subLabel: symbol },
    deploymentId: string,
    config: SshFamilyConfig,
    workdir: string,
    onDisconnected: ScopeDisconnectedListener,
  ): Promise<LiveScopeEntry>;
  /** 传输面（缺省 auto = TLS 栈功能性探测：BoringSSL 宿主走 broker，OpenSSL 走进程内） */
  transport?: ScopeTransportKind;
  /** broker 传输可调项（transport 命中 broker 时生效；nodeBin/brokerJsPath/spawnChild 注入） */
  broker?: BrokerHostOptions;
  /**
   * 闭包 helper 制品权威摘要（remoteAssembly 注入 readClosureHelperArtifact；缺省不校验）。
   * 实体 helperHash 落于开通时的闭包——插件升级换了 helper 制品后远端仍是旧 helper，家族链
   * 建连在 hello（协议号/摘要）即被拒，recheck 走不到摘要比对分支、部署卡 disconnected；
   * 权威摘要在场且与实体不符 → scopeFor 先行直连，recheck 经直连 sha256 比对命中
   * mismatch → 既有 markHelperMismatch 重装链。
   */
  helperHashAuthority?(): string;
}

/**
 * 传输面选择：auto（缺省——TLS 栈功能性探测，compatibility.md A3）/ inprocess
 * （锁进程内家族链）/ broker（锁系统 Node 子进程传输——测试与诊断用）。
 */
export type ScopeTransportKind = "auto" | "inprocess" | "broker";

/**
 * 建 per-deployment isolate 作用域并装载家族（spike 修正 A：双 label）。
 * 失败路径：任一 fiber 装载失败（连接不可达/摘要不符/consumer 超时）→ 卸载已装
 * fiber 后向上抛（调用方按「连接建立失败」映射）。
 */
async function connectScope(
  ctx: CordisHostContext,
  labels: { sshLabel: symbol; subLabel: symbol },
  deploymentId: string,
  config: SshFamilyConfig,
  workdir: string,
  onDisconnected: ScopeDisconnectedListener,
): Promise<LiveScopeEntry> {
  const { sshPlugin, subprocessPlugin } = await loadFamily();
  const sshScope = ctx.isolate("ssh", labels.sshLabel);
  const subScope = sshScope.isolate("subprocess", labels.subLabel);
  const loadOrder: CordisFiber[] = [];
  try {
    // fiber 必须 await（spike 修正 B）：装载期错误在此抛出；SshConnection 的
    // Service.init 门控保证 fiber 完成即远端 helper 摘要已验证（ready 已落定）
    const sshFiber = sshScope.plugin(sshPlugin, config);
    loadOrder.push(sshFiber);
    await sshFiber;
    const subFiber = subScope.plugin(subprocessPlugin, {});
    loadOrder.push(subFiber);
    await subFiber;
    const consumer = await loadConsumer(subScope, deploymentId.slice(0, 8));
    loadOrder.push(consumer.fiber);
    const scope = new DshSshScope({
      deploymentId,
      workdir,
      services: consumer.services,
      fibers: loadOrder,
      onDisconnected,
    });
    return { configKey: configKeyOf(config), scope };
  } catch (error) {
    await Promise.allSettled(loadOrder.map((fiber) => fiber.dispose()));
    throw error;
  }
}

/** 按部署 id 取/建 label 对（双 label——spike 修正 A；重连复用同 label） */
function labelsFor(
  labelsById: Map<string, { sshLabel: symbol; subLabel: symbol }>,
  id: string,
): { sshLabel: symbol; subLabel: symbol } {
  let pair = labelsById.get(id);
  if (pair === undefined) {
    pair = { sshLabel: Symbol(`pky-dep-${id}-ssh`), subLabel: Symbol(`pky-dep-${id}-sub`) };
    labelsById.set(id, pair);
  }
  return pair;
}

/** 断开通知收口（live 注销 + 逐监听器转发） */
function notifyDisconnected(
  live: Map<string, LiveScopeEntry>,
  listeners: ScopeDisconnectedListener[],
  id: string,
): void {
  live.delete(id);
  for (const listener of listeners) {
    listener(id);
  }
}

/** 实体 helper 落后于当前闭包（权威摘要注入在场且不符——插件升级后的旧 helper；见 SshScopeHostOptions.helperHashAuthority） */
function helperStale(entity: DeploymentEntity, authority: (() => string) | undefined): boolean {
  return authority !== undefined && entity.helperHash !== authority();
}

/**
 * 创建 dsh-ssh 家族 scope 宿主：scopeFor 按 helper 落定状态路由——已落定走家族链
 * （按部署 id 缓存 label 对与存活 scope，重连复用同 label——cordis 同 label join
 * 语义）；未落定（provision 前置步）返回直连 ssh scope（directScope.ts 兜底传输，
 * 无长连无缓存）。verify 步通过后 helperPath/Hash 落库 → 下次 scopeFor 自然切
 * 家族链（recheck/派发用真连接）。
 */
export function createSshScopeHost(ctx: CordisHostContext, options: SshScopeHostOptions = {}): SshScopeHost {
  // 传输面解析（compatibility.md A3）：显式 connect 注入优先（测试面）；auto =
  // TLS 功能性探测——BoringSSL 宿主（dsh 桌面）家族连接外包给系统 Node broker
  const transport = options.transport ?? "auto";
  const useBroker = transport === "broker" || (transport === "auto" && !tlsPskAvailable());
  const connect = options.connect ?? (useBroker ? createBrokerConnect(options.broker) : connectScope);
  const directScopeFor = options.directScopeFor ?? createDirectSshScope;
  const labelsById = new Map<string, { sshLabel: symbol; subLabel: symbol }>();
  const live = new Map<string, LiveScopeEntry>();
  const listeners: ScopeDisconnectedListener[] = [];

  const host: SshScopeHost = {
    onScopeDisconnected(listener) {
      listeners.push(listener);
    },

    async scopeFor(entity) {
      if (!familyProvisioned(entity) || helperStale(entity, options.helperHashAuthority)) {
        return directScopeFor(entity.alias); // 直连兜底：每次新实例（无长连可复用）
      }
      const config = familyConfig(entity);
      const configKey = configKeyOf(config);
      const existing = live.get(entity.id);
      if (existing !== undefined && existing.configKey === configKey && existing.scope.connected) {
        return existing.scope; // 存活连接复用（NFR-15：部署级连接复用）
      }
      if (existing !== undefined) {
        await existing.scope.disconnect(); // 配置漂移/已断开：先卸载（同 label 重建）
      }
      const entry = await connect(ctx, labelsFor(labelsById, entity.id), entity.id, config, entity.workdir, (id) =>
        notifyDisconnected(live, listeners, id),
      );
      live.set(entity.id, entry);
      return entry.scope;
    },

    async disconnect(deploymentId) {
      const entry = live.get(deploymentId);
      if (entry !== undefined) {
        await entry.scope.disconnect();
      }
    },

    async dispose() {
      await Promise.allSettled([...live.values()].map((entry) => entry.scope.disconnect()));
    },
  };
  return host;
}
