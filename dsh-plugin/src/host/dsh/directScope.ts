/**
 * 直连 ssh 传输 scope（provision 前置步兜底——acceptance §4 已知项 1 修复）：
 * 开通向导步①–④发生在远端 helper 安装/校验**之前**，而 dsh-ssh 家族以远端 helper
 * 为传输基底（spike-dsh-ssh §5）——helperPath/helperHash 未落定的部署由本模块经
 * 本机 ssh 二进制直连执行（BatchMode 免密 + ConnectTimeout，选项组装复用
 * sshCheck.sshConnectArgs；端口解析同款 [user@]host[:port]）。
 *
 * 无长连：每次操作独立 execFile（无资源可收，disconnect no-op）；connected =
 * 最近一次操作成功（初值乐观 true——无断开事实，操作后按结果置位）。适配缝内
 * 允许 node:child_process（dsh/ 目录例外边界，AGENTS.md 铁律）；remote/ 消费面仍
 * 只见 SshScope 接口。spawnTerminal / writeFile 不支持（前置步不需要——步③ 上传
 * 语义已改 npm 闭包安装，spike 修正 C）；stdin 管道保留（接口契约完备）。
 */
import { execFile } from "node:child_process";
import { posixQuote } from "../dispatch/cmdline";
import { SSH_CONNECT_TIMEOUT_SECS, sshConnectArgs } from "../dispatch/sshCheck";
import type { SshScope, SshSpawnOptions, SshSpawnResult, SshTerminalOptions, SshWriteResult } from "../remote/sshScope";

/** 直连单操作整体超时（最长步 = npm 闭包安装——网络安装余量；ConnectTimeout 只管建连） */
const DIRECT_OP_TIMEOUT_MS = 300_000;
/** 操作被超时杀死（拿不到退出码）时 shell 信封的替代退出码（对齐 ssh 惯例值） */
const SHELL_SIGNAL_EXIT_CODE = 255;

/** execFile 回调错误形态（exit code / killed） */
type ExecFileError = (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;

/** 直连可调项（测试注入 fake ssh 二进制 / 缩短超时；生产缺省全走系统口径） */
export interface DirectSshScopeOptions {
  /** ssh 二进制（缺省系统 ssh；测试 fake 脚本） */
  sshBin?: string;
  /** 建连超时秒（缺省 SSH_CONNECT_TIMEOUT_SECS——与免密预检同值） */
  connectTimeoutSecs?: number;
  /** 单操作整体超时 ms（缺省 DIRECT_OP_TIMEOUT_MS；测试缩短等待用） */
  defaultTimeoutMs?: number;
}

function stdinText(input: Buffer | string): string {
  return typeof input === "string" ? input : input.toString("utf8");
}

export class DirectSshScope implements SshScope {
  private connectedState = true;

  constructor(
    private readonly alias: string,
    private readonly options: DirectSshScopeOptions = {},
  ) {}

  get connected(): boolean {
    return this.connectedState;
  }

  async spawn(cmd: string[], opts?: SshSpawnOptions): Promise<SshSpawnResult> {
    // argv → 远端命令串：逐参 posixQuote 保 argv 语义（远端登录 shell 解释执行）
    return this.exec(cmd.map(posixQuote).join(" "), opts);
  }

  async shell(cmd: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const result = await this.exec(cmd);
    return { code: result.code ?? SHELL_SIGNAL_EXIT_CODE, stdout: result.stdout, stderr: result.stderr };
  }

  async spawnTerminal(opts: SshTerminalOptions): Promise<{ sessionId: string }> {
    throw new Error(
      `直连 ssh 传输不支持终端会话（${opts.command}——provision 前置步专用；helper 落定后由 dsh-ssh 连接承载）`,
    );
  }

  async writeFile(path: string, content: Buffer | string): Promise<SshWriteResult> {
    throw new Error(
      `直连 ssh 传输不支持文件写入（${path}，${content.length} 字节——步③ 上传已改 npm 闭包安装，spike 修正 C）`,
    );
  }

  async disconnect(): Promise<void> {
    // no-op：无长连（每次操作独立 execFile，无资源可收口）
  }

  /** 单次 ssh 执行（连接选项与 sshCheck 同款：BatchMode + ConnectTimeout + 端口解析） */
  private exec(remoteCommand: string, opts?: SshSpawnOptions): Promise<SshSpawnResult> {
    const target = this.alias.trim();
    const portMatch = /:(\d+)$/.exec(target);
    const hostPart = portMatch !== null ? target.slice(0, portMatch.index) : target;
    const argv = [
      ...sshConnectArgs(target, this.options.connectTimeoutSecs ?? SSH_CONNECT_TIMEOUT_SECS),
      "--",
      hostPart,
      remoteCommand,
    ];
    const timeoutMs = opts?.timeoutMs ?? this.options.defaultTimeoutMs ?? DIRECT_OP_TIMEOUT_MS;
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const child = execFile(
        this.options.sshBin ?? "ssh",
        argv,
        { timeout: timeoutMs, killSignal: "SIGKILL" },
        (error, stdout, stderr) => {
          const err = error as ExecFileError;
          this.connectedState = err === null; // connected = 最近一次操作成功
          resolve({
            code: err === null ? 0 : typeof err.code === "number" ? err.code : null,
            stdout: String(stdout),
            stderr: String(stderr !== "" && stderr !== undefined ? stderr : (err?.message ?? "")),
            durationMs: Date.now() - startedAt,
          });
        },
      );
      if (opts?.stdin !== undefined) {
        child.stdin?.on("error", () => undefined); // 子进程不读 stdin（EPIPE）不视为失败
        child.stdin?.end(stdinText(opts.stdin));
      }
    });
  }
}

/** 直连 scope 工厂（sshScopeHost 未落定路由消费——provision 前置步传输面） */
export function createDirectSshScope(alias: string, options?: DirectSshScopeOptions): DirectSshScope {
  return new DirectSshScope(alias, options);
}
