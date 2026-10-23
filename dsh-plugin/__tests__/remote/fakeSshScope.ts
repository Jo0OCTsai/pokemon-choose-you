/**
 * 内存 fake SshScope（AD §7.3）：spawn/shell 记录（组装命令断言面）、可编程结果、
 * 断开事件模拟、模拟远端文件系统（writeFile 落盘 + sha256sum 复核自洽 + npm 闭包
 * 安装把 helper 入口落进安装目录）。remote/ 全模块（deployments/provision/recheck）
 * 单测的共用替身。
 */
import { createHash } from "node:crypto";
import type { SshSpawnResult, SshTerminalOptions } from "../../src/host/remote/sshScope";
import type { ProvisionDeps } from "../../src/host/remote/provision";
import type { DeploymentEntity } from "../../src/host/remote/deployments";
import type { SshTerminalScope } from "../../src/host/remote/sshExecutor";

export function sha256Of(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** posixQuote 逆操作（fake 远端解析 shell 命令取回路径用；只覆盖 posixQuote 的产物形态） */
export function posixUnquote(token: string): string {
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replaceAll(`'\\''`, `'`);
  }
  return token;
}

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

/** shell 应答信封形态 */
type ShellOutcome = { code: number; stdout: string; stderr: string };

/** 编程应答 → shell 结果信封 */
function programmedOutcome(hit: ProgrammedResult): ShellOutcome {
  return { code: hit.code, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" };
}

/** 固定应答命令（printf 探针 / --version 三固定形态；不匹配 = null——npm 探测走实例态） */
function fixedOutcome(cmd: string, homeDir: string): ShellOutcome | null {
  if (cmd === 'printf %s "$HOME"') {
    return { code: 0, stdout: homeDir, stderr: "" };
  }
  if (cmd === "printf pky-ok") {
    return { code: 0, stdout: "pky-ok", stderr: "" };
  }
  if (cmd.endsWith(" --version")) {
    return { code: 0, stdout: "v22.11.0\n", stderr: "" };
  }
  return null;
}

/** npm 探测命令形态（npmProbeCommand 产物——sibling 优先分支 + command -v 回落） */
const NPM_PROBE_RE = /^if \[ -x (.+) \]; then printf %s (.+); else command -v npm; fi$/;

/** command -v <name> 应答（remoteBins 未登记 = command not found） */
function commandVOutcome(remoteBins: Map<string, string>, cmd: string): ShellOutcome {
  const name = posixUnquote(cmd.slice("command -v ".length));
  const bin = remoteBins.get(name);
  return bin === undefined
    ? { code: 1, stdout: "", stderr: `command not found: ${name}` }
    : { code: 0, stdout: bin, stderr: "" };
}

/** head -c <n> <path> 应答（CLI 头部分类探测——模拟远端文件系统；未登记 = 不存在） */
function headCOutcome(files: Map<string, string>, cmd: string): ShellOutcome | null {
  const m = /^head -c (\d+) (.+)$/.exec(cmd);
  if (m === null) return null;
  const path = posixUnquote(m[2]);
  const content = files.get(path);
  return content === undefined
    ? { code: 1, stdout: "", stderr: `head: ${path}: No such file or directory` }
    : { code: 0, stdout: content.slice(0, Number(m[1])), stderr: "" };
}

/** sha256sum 应答（模拟远端文件系统内容自洽） */
function sha256Outcome(files: Map<string, string>, cmd: string): ShellOutcome {
  const path = posixUnquote(cmd.slice("sha256sum ".length));
  const content = files.get(path);
  if (content === undefined) {
    return { code: 1, stdout: "", stderr: `sha256sum: ${path}: No such file or directory` };
  }
  return { code: 0, stdout: `${sha256Of(content)}  ${path}\n`, stderr: "" };
}

/** rm -rf -- <dir> 应答（目录级删除模拟远端文件系统条目） */
function rmRfOutcome(files: Map<string, string>, cmd: string): ShellOutcome {
  const dir = posixUnquote(cmd.slice("rm -rf -- ".length));
  for (const key of [...files.keys()]) {
    if (key === dir || key.startsWith(`${dir}/`)) {
      files.delete(key);
    }
  }
  return { code: 0, stdout: "", stderr: "" };
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
  /** 远端可执行登记（command -v 应答面——dispatch 远端链） */
  remoteBins = new Map<string, string>([["claude", "/usr/local/bin/claude"]]);
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
    const fixed = fixedOutcome(cmd, this.homeDir);
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
    if (cmd.startsWith("command -v ")) {
      return commandVOutcome(this.remoteBins, cmd);
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
