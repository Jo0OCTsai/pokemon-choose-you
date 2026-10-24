/**
 * broker 连接装配（从 brokerScope.ts 拆出——复杂度棘轮 max-lines，等量迁移）：
 * sshScopeHost options.connect 同形的工厂——派生 BrokerSshScope、完成 connect
 * 握手、回填 LiveScopeEntry（configKey 口径与进程内 connectScope 一致）。缺省
 * 子进程工厂与 broker 脚本定位在此落位（测试经 spawnChild/brokerJsPath 注入）。
 */
import { spawn as childSpawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { BrokerConnectConfig } from "./brokerProtocol";
import { brokerNodeCandidates } from "./brokerNode";
import { BrokerSshScope } from "./brokerScope";
import type { BrokerChildFactory, BrokerChildLike } from "./brokerWire";
import type { LiveScopeEntry, ScopeDisconnectedListener } from "./sshScopeHost";

/** broker 传输可调项（sshScopeHost options.broker 透传；测试/自定义安装位） */
export interface BrokerHostOptions {
  /** 系统 Node 二进制（缺省 $PKY_BROKER_NODE → "node"——PATH 解析） */
  nodeBin?: string;
  /** broker 脚本绝对路径（缺省 $PKY_BROKER_JS → 本插件 dist/broker.mjs） */
  brokerJsPath?: string;
  /** 子进程工厂（测试注入内存替身） */
  spawnChild?: BrokerChildFactory;
  /** Node 候选链（测试注入；缺省 = PKY_BROKER_NODE → PATH → Homebrew → nvm 最新） */
  nodeCandidates?: string[];
}

/** 缺省子进程工厂（系统 spawn；stdio 三管道） */
const defaultSpawnChild: BrokerChildFactory = (nodeBin, args) =>
  childSpawn(nodeBin, args, { stdio: ["pipe", "pipe", "pipe"] }) as unknown as BrokerChildLike;

/** broker 脚本缺省路径 = 本插件 dist/broker.mjs（宿主 bundle 同目录锚定） */
export function defaultBrokerJsPath(): string {
  return process.env.PKY_BROKER_JS ?? fileURLToPath(new URL("./broker.mjs", import.meta.url));
}

/**
 * broker 传输装配（sshScopeHost options.connect 同形）：派生 BrokerSshScope 并
 * 完成 connect 握手，回填 LiveScopeEntry。
 */
export function createBrokerConnect(options: BrokerHostOptions = {}) {
  return async (
    _ctx: unknown,
    _labels: { sshLabel: symbol; subLabel: symbol },
    deploymentId: string,
    config: BrokerConnectConfig,
    workdir: string,
    onDisconnected: ScopeDisconnectedListener,
  ): Promise<LiveScopeEntry> => {
    const scope = new BrokerSshScope({
      nodeCandidates: options.nodeCandidates ?? brokerNodeCandidates(options.nodeBin),
      brokerJsPath: options.brokerJsPath ?? defaultBrokerJsPath(),
      deploymentId,
      config,
      workdir,
      onDisconnected,
      spawnChild: options.spawnChild ?? defaultSpawnChild,
    });
    await scope.start();
    return { configKey: JSON.stringify(config), scope };
  };
}
