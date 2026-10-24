/**
 * 内存 fake SshScope（AD §7.3）：spawn/shell 记录（组装命令断言面）、可编程结果、
 * 断开事件模拟、模拟远端文件系统（writeFile 落盘 + sha256sum 复核自洽 + npm 闭包
 * 安装把 helper 入口落进安装目录）。remote/ 全模块（deployments/provision/recheck）
 * 单测的共用替身。
 */
import type { SshSpawnResult, SshTerminalOptions } from "../../src/host/remote/sshScope";
import type { ProvisionDeps } from "../../src/host/remote/provision";
import type { DeploymentEntity } from "../../src/host/remote/deployments";
import { REMOTE_PATH_BOOTSTRAP, type SshTerminalScope } from "../../src/host/remote/sshExecutor";
import {
  fixedOutcome,
  headCOutcome,
  posixUnquote,
  rmRfOutcome,
  sha256Of,
  sha256Outcome,
  type ShellOutcome,
} from "./fakeRemoteFs";

// 原语与模拟远端文件系统应答族已拆 fakeRemoteFs.ts（棘轮 max-lines）——再出口保消费面
export { posixUnquote, sha256Of } from "./fakeRemoteFs";

export interface ProgrammedResult {
  code: number;
  stdout?: string;
  stderr?: string;
}

/** fake npm 闭包安装记录（步③ 命令形状断言面） */
export interface FakeNpmInstall {
  npmPath: string;
  installDir: string;
  pkgSpec: string;
  command: string;
}

/** 编程应答 → shell 结果信封 */
function programmedOutcome(hit: ProgrammedResult): ShellOutcome {
  return { code: hit.code, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
}

/** npm 探测命令形态（npmProbeCommand 产物——sibling 优先分支 + command -v 回落） */
const NPM_PROBE_RE = /^if \[ -x (.+) \]; then printf %s (.+); else command -v npm; fi$/;

/** 登录 shell 视角 command -v 探测脚本提取（[shell, -l, -c] 与 /bin/sh 退化 [sh, -c] 两形态）；非探测形态 = null */
function loginProbeScriptOf(cmd: string[]): string | null {
  const script = cmd[1] === "-l" ? (cmd[2] === "-c" ? cmd[3] : undefined) : cmd[1] === "-c" ? cmd[2] : undefined;
  return typeof script === "string" && script.startsWith("command -v ") ? script : null;
}

/** command -v 应答（PATH 兜底前插形态剥壳；非 command -v 形态 = null 交还 shell 路由；
 * ~/.local/bin 家族只在兜底段生效时可见——helper 非登录 shell 缺省 PATH 外） */
function commandVOutcome(remoteBins: Map<string, string>, cmd: string): ShellOutcome | null {
  const prefix = `${REMOTE_PATH_BOOTSTRAP}; `;
  const bootstrapped = cmd.startsWith(prefix);
  const probe = bootstrapped ? cmd.slice(prefix.length) : cmd;
  if (!probe.startsWith("command -v ")) {
    return null;
  }
  const name = posixUnquote(probe.slice("command -v ".length));
  const bin = remoteBins.get(name);
  const visible = bin !== undefined && (bootstrapped || !bin.includes("/.local/bin/"));
  return visible ? { code: 0, stdout: bin, stderr: "" } : { code: 1, stdout: "", stderr: `command not found: ${name}` };
}

/** 默认 helper 制品内容 */
export const DEFAULT_HELPER_CONTENT = "// pky-helper artifact (fake)\nconsole.log('helper');\n";

export class FakeSshScope implements SshTerminalScope {
  connected = true;
  /** shell 命令执行记录（引号全量引用静态断言面） */
  commands: string[] = [];
  /** spawn argv 记录 */
  spawns: string[][] = [];
  /** writeFile 记录 */
  writes: Array<{ path: string; content: string; sha256: string }> = [];
  /** 模拟远端文件系统 */
  files = new Map<string, string>();
  /** 可编程结果（正则匹配命令 → 定值；先于内建行为） */
  programmed: Array<{ match: RegExp; result: ProgrammedResult }> = [];
  disconnectCalls = 0;
  spawnTerminalCalls: SshTerminalOptions[] = [];
  /** 远端 $HOME（homeProbeCommand 的应答） */
  homeDir = "/home/dev";
  /** 远端 npm 路径（npm 探测回落分支 command -v 的应答；对抗样例可改） */
  npmPath = "/usr/bin/npm";
  /** node 同目录 sibling npm 是否在场（在场 = npm 探测优先应答 sibling 路径） */
  siblingNpmInstalled = false;
  /** npm 闭包安装记录 */
  npmInstalls: FakeNpmInstall[] = [];
  /** npm 安装落到模拟远端的 helper 入口内容（模拟「安装了与本地闭包匹配的版本」） */
  installedHelperContent = DEFAULT_HELPER_CONTENT;
  /** 可编程 spawn 队列（"hold" = 挂起直到 releaseHeldSpawn；空 = 缺省 code 0 空输出） */
  spawnQueue: Array<Partial<SshSpawnResult> | "hold"> = [];
  /** 置位时 spawn 一律抛错（模拟通道级故障——如部署工作目录不存在时 node spawn ENOENT） */
  spawnError: Error | null = null;
  /** 远端可执行登记（command -v 应答面——dispatch 远端链） */
  remoteBins = new Map<string, string>([["claude", "/usr/local/bin/claude"]]);
  /** 登录 shell 路径（getent 探测应答；对抗样例可改——非绝对路径触发 /bin/sh 回落） */
  loginShellPath = "/usr/bin/zsh";
  /** 登录 shell 函数/别名封装名（登录视角 command -v 应答裸名——非绝对输出走 shell 名形态） */
  loginFunctions = new Set<string>();
  /** 登录视角探测不可见名（登录 shell command -v 落空 → 回落 /bin/sh + PATH 兜底探测链） */
  loginProbeMisses = new Set<string>();
  /** 终端写入记录（writeTerminal 断言面） */
  terminalWrites: Array<{ sessionId: string; data: string }> = [];
  /** 视为已关闭的终端会话（writeTerminal 返回 false 驱动兜底新开） */
  closedTerminals = new Set<string>();
  /** 终端关闭调用记录 */
  terminatedTerminals: string[] = [];
  private liveTerminals = new Set<string>();
  private heldResolvers: Array<(result: SshSpawnResult) => void> = [];

  program(match: RegExp, result: ProgrammedResult): this {
    this.programmed.push({ match, result });
    return this;
  }

  /** 排队一次 spawn 结果（或 "hold" 挂起） */
  enqueueSpawn(result: Partial<SshSpawnResult> | "hold"): this {
    this.spawnQueue.push(result);
    return this;
  }

  /** 释放全部挂起 spawn（断连/超时收口测试的放行阀） */
  releaseHeldSpawn(result: SshSpawnResult): void {
    const resolvers = this.heldResolvers;
    this.heldResolvers = [];
    for (const resolve of resolvers) {
      resolve(result);
    }
  }

  simulateDisconnect(): void {
    this.connected = false;
  }

  reconnect(): void {
    this.connected = true;
  }

  private lookup(cmd: string): ProgrammedResult | null {
    for (const entry of this.programmed) {
      if (entry.match.test(cmd)) {
        return entry.result;
      }
    }
    return null;
  }

  async spawn(cmd: string[]): Promise<SshSpawnResult> {
    this.spawns.push(cmd);
    if (this.spawnError !== null) {
      throw this.spawnError;
    }
    // 登录 shell 视角 command -v 探测（两 argv 形态见 loginProbeScriptOf）：函数/别名应答
    // 裸名（非绝对输出 → 执行走 shell 名形态）；登记可见一律绝对路径；loginProbeMisses
    // 模拟登录环境不可见（驱动回落链）——探测 spawn 不吃执行结果队列
    const probe = loginProbeScriptOf(cmd);
    if (probe !== null) {
      const name = posixUnquote(probe.slice("command -v ".length));
      if (this.loginProbeMisses.has(name)) {
        return { code: 1, stdout: "", stderr: `command not found: ${name}`, durationMs: 1 };
      }
      if (this.loginFunctions.has(name)) {
        return { code: 0, stdout: name, stderr: "", durationMs: 1 };
      }
      const bin = this.remoteBins.get(name);
      return bin === undefined
        ? { code: 1, stdout: "", stderr: `command not found: ${name}`, durationMs: 1 }
        : { code: 0, stdout: bin, stderr: "", durationMs: 1 };
    }
    const next = this.spawnQueue.shift();
    if (next === "hold") {
      return await new Promise<SshSpawnResult>((resolve) => {
        this.heldResolvers.push(resolve);
      });
    }
    return { code: 0, stdout: "", stderr: "", durationMs: 1, ...(next ?? {}) };
  }

  async spawnTerminal(opts: SshTerminalOptions): Promise<{ sessionId: string }> {
    this.spawnTerminalCalls.push(opts);
    const sessionId = `pty-${this.spawnTerminalCalls.length}`;
    this.liveTerminals.add(sessionId);
    return { sessionId };
  }

  async writeTerminal(sessionId: string, data: string): Promise<boolean> {
    if (!this.liveTerminals.has(sessionId) || this.closedTerminals.has(sessionId)) {
      return false;
    }
    this.terminalWrites.push({ sessionId, data });
    return true;
  }

  async terminateTerminal(sessionId: string): Promise<boolean> {
    this.terminatedTerminals.push(sessionId);
    return this.liveTerminals.delete(sessionId);
  }

  async shell(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    this.commands.push(cmd);
    const hit = this.lookup(cmd);
    if (hit !== null) {
      return programmedOutcome(hit);
    }
    const fixed = fixedOutcome(cmd, this.homeDir, this.loginShellPath);
    if (fixed !== null) {
      return fixed;
    }
    const npmProbe = NPM_PROBE_RE.exec(cmd);
    if (npmProbe !== null) {
      // sibling 分支在场 → 应答 sibling 路径（posixUnquote 只覆盖无后缀拼接的简单形态——
      // sibling 优选用例用安全字符集路径；对抗路径用例走回落分支不解析 sibling）
      return this.siblingNpmInstalled
        ? { code: 0, stdout: posixUnquote(npmProbe[2]), stderr: "" }
        : { code: 0, stdout: this.npmPath, stderr: "" };
    }
    const commandV = commandVOutcome(this.remoteBins, cmd);
    if (commandV !== null) {
      return commandV;
    }
    const head = headCOutcome(this.files, cmd);
    if (head !== null) {
      return head;
    }
    if (cmd.includes(" install --prefix ")) {
      return this.npmInstallOutcome(cmd);
    }
    if (cmd.startsWith("sha256sum ")) {
      return sha256Outcome(this.files, cmd);
    }
    if (cmd.startsWith("rm -rf -- ")) {
      return rmRfOutcome(this.files, cmd);
    }
    return { code: 0, stdout: "", stderr: "" };
  }

  /** npm 闭包安装应答：helper 入口落进安装目录（内容可编程——版本漂移场景改写） */
  private npmInstallOutcome(cmd: string): ShellOutcome {
    const sep = " install --prefix ";
    const rest = cmd.slice(cmd.indexOf(sep) + sep.length);
    const dirTok = rest.slice(0, rest.lastIndexOf(" "));
    const specTok = rest.slice(rest.lastIndexOf(" ") + 1);
    const installDir = posixUnquote(dirTok);
    // npm 令牌前可能带 PATH=<node bin>:$PATH 前缀（真机 shebang 修复面）——剥前缀取 npm
    const head = cmd.slice(0, cmd.indexOf(sep));
    const at = head.lastIndexOf("$PATH ");
    const npmTok = at === -1 ? head : head.slice(at + "$PATH ".length);
    this.npmInstalls.push({
      npmPath: posixUnquote(npmTok),
      installDir,
      pkgSpec: posixUnquote(specTok),
      command: cmd,
    });
    this.files.set(`${installDir}/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js`, this.installedHelperContent);
    return { code: 0, stdout: "", stderr: "" };
  }

  async writeFile(path: string, content: Buffer | string): Promise<{ sha256: string }> {
    const text = typeof content === "string" ? content : content.toString("utf8");
    const sha256 = sha256Of(text);
    this.files.set(path, text);
    this.writes.push({ path, content: text, sha256 });
    return { sha256 };
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.connected = false;
  }
}

/** 组装 ProvisionDeps（制品信息可换——模拟版本漂移/篡改） */
export function fakeProvisionDeps(
  scopeFor: (entity: DeploymentEntity) => Promise<FakeSshScope | null>,
  opts: { pluginVersion?: string; helperContent?: string; familyVersion?: string } = {},
): ProvisionDeps {
  const content = opts.helperContent ?? DEFAULT_HELPER_CONTENT;
  return {
    scopeFor,
    readHelperArtifact: () => ({
      version: opts.familyVersion ?? "0.1.6-alpha.1",
      sha256: sha256Of(content),
    }),
    pluginVersion: opts.pluginVersion ?? "0.1.0",
  };
}
