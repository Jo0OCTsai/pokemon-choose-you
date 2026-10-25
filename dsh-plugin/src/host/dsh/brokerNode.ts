/**
 * broker 传输的 Node 候选发现与共享常量（从 brokerScope.ts 拆出——复杂度棘轮
 * max-lines，等量迁移；brokerScope.ts 为统一消费面）：GUI 启动的宿主进程 PATH
 * 常缺 nvm node（macOS Dock 环境 PATH 最小化）——PATH 失败后回落 Homebrew /
 * nvm 最新版。首个「能完成协议回合」的候选胜出（进程起不来/版本过旧退出 = 试
 * 下一个；连不上远端 = node 本身没问题，不再换候选——判定在 brokerScope）。
 */
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";

// ---- 超时口径（connect 握手 / 长 spawn / 终端原语） ----

/** connect 握手上限（家族建连 + helper 拉起 + 摘要校验；远端含 RTT 余量） */
export const CONNECT_TIMEOUT_MS = 120_000;
/** spawn 上限（npm 闭包安装类长步——对齐 directScope 单操作 300s + 桥余量） */
export const SPAWN_TIMEOUT_MS = 330_000;
/** 终端原语上限（开/写/关——即时原语） */
export const TERMINAL_TIMEOUT_MS = 30_000;
/** stderr 诊断尾部上限 */
export const STDERR_TAIL_CHARS = 2000;

/** 候选级失败（子进程零协议回合消亡——ENOENT/版本过旧）：可换下一候选重试 */
export class CandidateDeadError extends Error {}

/** 错误消息单点（Error → message；其余 String 化） */
export function errText(error: unknown): string {
  return String(error instanceof Error ? error.message : error);
}

/** nvm 最新版本 node 绝对路径（无 nvm/无版本 → undefined） */
function nvmLatestNode(): string | undefined {
  try {
    const versionsRoot = `${homedir()}/.nvm/versions/node`;
    const versions = readdirSync(versionsRoot).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    const latest = versions.at(-1);
    if (latest === undefined) {
      return undefined;
    }
    const bin = `${versionsRoot}/${latest}/bin/node`;
    return statSync(bin).isFile() ? bin : undefined;
  } catch {
    return undefined;
  }
}

/** 系统 Node 候选链：$PKY_BROKER_NODE/显式覆盖 → PATH → Homebrew → nvm 最新 */
export function brokerNodeCandidates(override?: string): string[] {
  const out = [override ?? process.env.PKY_BROKER_NODE ?? "node"];
  for (const abs of ["/opt/homebrew/bin/node", "/usr/local/bin/node", nvmLatestNode()]) {
    if (abs !== undefined && !out.includes(abs)) {
      try {
        statSync(abs);
        out.push(abs);
      } catch {
        // 不在场的候选跳过
      }
    }
  }
  return out;
}
