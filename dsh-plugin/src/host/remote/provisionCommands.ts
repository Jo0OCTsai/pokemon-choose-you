/**
 * 开通向导远端命令组装 + 状态基元（从 provision.ts 拆出——棘轮 max-lines，等量迁移；
 * provision.ts 为统一再出口，消费面不变）。全部远端命令组装走引号全量引用
 * （posixQuote 单点，NFR-11④ 静态断言面）；实体路径永不含 `~`（deploymentUpsert
 * 拒收前置不变式）——posixQuote 永不与 `~` 展开叠加。
 */
import { posixQuote } from "../dispatch/cmdline";
import type { ProvisionState, ProvisionStepResult } from "./provision";

/** 步① 远端 $HOME 探测命令（固定串，零插值） */
export function homeProbeCommand(): string {
  return 'printf %s "$HOME"';
}

/** 步② 远端 node 探测命令（nodePath 逐参引用） */
export function probeNodeCommand(nodePath: string): string {
  return `${posixQuote(nodePath)} --version`;
}

/**
 * 步② 远端 Node 版本门槛：dsh-ssh 0.2.1-rc.3 helper 引入 `node:sea`（Node 20.12 / 21.7 起
 * 提供），更低版本 helper 启动即崩、表象只是握手超时——探测期按 `--version` 输出提前判死。
 * 输出不可解析同样判不支持（无法证明可用）。
 */
export function remoteNodeSupported(versionOutput: string): boolean {
  const m = /^v?(\d+)\.(\d+)\.\d+/.exec(versionOutput.trim());
  if (m === null) {
    return false;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major >= 22 || (major === 21 && minor >= 7) || (major === 20 && minor >= 12);
}

/** 步① 附加：部署登记工作目录存在性探测（workdir 非空时消费——空 = 登录目录缺省不探测） */
export function workdirProbeCommand(workdir: string): string {
  return `test -d ${posixQuote(workdir)}`;
}

/** 路径 dirname（host 侧展开；根内路径退化 "/"——与远端 dirname(1) 语义一致） */
export function parentDirOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

/**
 * 步③ 远端 npm 探测命令：优先 `<dirname(nodePath)>/npm`（POSIX node 发行版布局 npm
 * 与 node 同目录——远端非交互 shell 无 nvm PATH，spike 实测），回落 `command -v npm`；
 * 输出 npm 绝对路径（dirname host 侧展开 + 逐参引用；两分支均 printf/ command -v 单行输出）。
 */
export function npmProbeCommand(nodePath: string): string {
  const dir = parentDirOf(nodePath);
  const sibling = dir === "/" ? "/npm" : `${posixQuote(dir)}/npm`;
  return `if [ -x ${sibling} ]; then printf %s ${sibling}; else command -v npm; fi`;
}

/** npm 安装 spec（@ 名字@版本——版本源 = 本机闭包，与权威 hash 同闭包） */
export function sshFamilySpec(version: string): string {
  return `@deepseek-ai/dsh-ssh@${version}`;
}

/**
 * 步③ npm 闭包安装命令（npmPath / installDir / pkgSpec 逐参引用——NFR-11④）。
 * PATH 前缀注入 node bin 目录：npm 入口 shebang `#!/usr/bin/env node`，远端非交互
 * shell 无 nvm PATH 时裸调 npm 会 `env: node: No such file or directory`（真机实测）。
 */
export function npmInstallCommand(npmPath: string, installDir: string, pkgSpec: string, nodePath: string): string {
  return `PATH=${posixQuote(parentDirOf(nodePath))}:$PATH ${posixQuote(npmPath)} install --prefix ${posixQuote(installDir)} ${posixQuote(pkgSpec)}`;
}

/** helper 入口在 npm 安装闭包内的固定后缀（布局单源：spike 修正 C） */
export const HELPER_ENTRY_SUFFIX = "/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js";

/** 安装目录（<$HOME 展开后>/.dsh-helper/pky-<插件版本>——目录级版本段隔离，顶替不互踩） */
export function helperInstallDir(homeDir: string, pluginVersion: string): string {
  return `${homeDir.replace(/\/+$/, "")}/.dsh-helper/pky-${pluginVersion}`;
}

/** 缺省 helperPath（<安装目录>/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js） */
export function defaultHelperPath(homeDir: string, pluginVersion: string): string {
  return `${helperInstallDir(homeDir, pluginVersion)}${HELPER_ENTRY_SUFFIX}`;
}

/** helperPath 反推安装目录（npm --prefix 目标；非闭包布局回落 dirname——异常兜底，主路径恒为闭包布局） */
export function installDirFromHelperPath(helperPath: string): string {
  if (helperPath.endsWith(HELPER_ENTRY_SUFFIX)) {
    return helperPath.slice(0, helperPath.length - HELPER_ENTRY_SUFFIX.length);
  }
  const cut = helperPath.lastIndexOf("/");
  return cut <= 0 ? "/" : helperPath.slice(0, cut);
}

/** 步④ 摘要复核命令（helperPath 逐参引用；recheck 复用） */
export function sha256Command(helperPath: string): string {
  return `sha256sum ${posixQuote(helperPath)}`;
}

// ---- 状态基元 ----

function pendingStep(): ProvisionStepResult {
  return { status: "pending", at: "" };
}

/** 初始向导状态（四步全 pending） */
export function initialProvisionState(): ProvisionState {
  return {
    steps: {
      "probe-ssh": pendingStep(),
      "probe-node": pendingStep(),
      upload: pendingStep(),
      verify: pendingStep(),
    },
    homeDir: null,
  };
}
