/**
 * broker 闭包完备性守卫（2026-11-02 Release tarball 真机根因）：dist/broker.mjs 由**系统 Node**
 * 子进程运行，没有 dsh 宿主的 peer 锚定解析，`@deepseek-ai/*` 只能从插件自己的安装闭包解析。
 * 仓库 workspace 里 cordis 是 devDep、dsh-ssh 家族的 peer 经 pnpm store 可达，所以 file: 安装
 * 一直能用；装成 tarball 后 profile（autoInstallPeers: false）里没有这些包，broker 启动即
 * ERR_MODULE_NOT_FOUND → 部署 disconnected、远程派发全败。且 dsh 包大量惰性 import，
 * 空跑 broker 入口不能证明闭包完整——必须按 peerDependencies 传递闭包声明。
 *
 * 规则：dependencies 内每个 @deepseek-ai 包的**必需** peer（含传递）都必须也在 dependencies；
 * cordis 同时保留 peerDependencies 声明——dsh-app-boot 对声明为 peer 的名字一律拦截到安装
 * 作用域，host 进程仍用 dsh 自己的 cordis 单实例，本地副本只服务 broker。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const PLUGIN_ROOT = join(import.meta.dirname, "..");

interface Manifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
}

function requiredDeepseekPeers(manifest: Manifest): string[] {
  const meta = manifest.peerDependenciesMeta ?? {};
  return Object.keys(manifest.peerDependencies ?? {}).filter(
    (name) => name.startsWith("@deepseek-ai/") && meta[name]?.optional !== true,
  );
}

it("dependencies 覆盖 @deepseek-ai 依赖的必需 peer 传递闭包（broker 系统 Node 侧可解析）", () => {
  const plugin = readManifest(PLUGIN_ROOT);
  const declared = new Set(Object.keys(plugin.dependencies ?? {}));
  const queue = [...declared].filter((name) => name.startsWith("@deepseek-ai/"));
  const visited = new Set<string>();
  const missing = new Map<string, string>();
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name)) continue;
    visited.add(name);
    let manifest: Manifest;
    try {
      manifest = readManifest(join(PLUGIN_ROOT, "node_modules", name));
    } catch {
      continue; // 未声明的包不在闭包里，已记入 missing
    }
    for (const peer of requiredDeepseekPeers(manifest)) {
      if (!declared.has(peer)) missing.set(peer, name);
      queue.push(peer);
    }
  }
  expect(
    [...missing].map(([peer, from]) => `${peer}（${from} 的必需 peer）`),
    "缺失的 broker 闭包依赖——加进 dsh-plugin/package.json dependencies",
  ).toEqual([]);
});

it("cordis 同时声明为 dependency 与 peerDependency（host 导锚单实例 + broker 本地副本）", () => {
  const plugin = readManifest(PLUGIN_ROOT);
  expect(plugin.dependencies?.["@deepseek-ai/cordis"]).toBeDefined();
  expect(plugin.peerDependencies?.["@deepseek-ai/cordis"]).toBe(plugin.dependencies?.["@deepseek-ai/cordis"]);
});
