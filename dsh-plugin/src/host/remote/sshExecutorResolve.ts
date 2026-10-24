/**
 * 远端可执行解析族（从 sshExecutorScope.ts 拆出——棘轮 max-lines，等量迁移；
 * sshExecutor.ts 为统一再出口，消费面不变）：PATH 兜底段 / 登录 shell 解析 / 裸名
 * 登录视角 command -v（函数/别名 → shell 名形态）/ 头部分类 / 绝对路径校验。
 *
 * 执行面（agent CLI 脚本 + 交互 PTY）经用户登录 shell（ssh 会话同环境）；机器面探针
 * （recheck/provision/writeFile 经 scope.shell）保持 /bin/sh 定常环境——printf/
 * sha256sum 输出精确解析，不容登录横幅污染。
 */
import { posixQuote } from "../dispatch/cmdline";
import type { SshScope } from "./sshScope";

/** CLI 解释形态：node 前缀（node 脚本型 CLI）/ 直执行（原生二进制与其他解释器） */
export type RemoteCliInterpreter = "node" | "direct";

/**
 * helper spawn 链非登录 shell 的 PATH 兜底段（单源）：pk shim 与 npm --prefix ~/.local
 * 的全局 agent CLI（claude 等）都落 ~/.local/bin，helper 子 shell 的缺省 PATH 可能看不到
 * ——agent Bash 工具里 pk 127 与可执行解析 command -v 探针落空同坑。派发脚本与
 * probeCommandPath 共用；远端 run_setup 的 PATH 步同源；登录 shell 环境下幂等无害。
 */
export const REMOTE_PATH_BOOTSTRAP = 'export PATH="$HOME/.local/bin:${PATH:-/usr/local/bin:/usr/bin:/bin}"';

/**
 * 远端登录 shell 探测命令（/bin/sh 定常面执行）：getent 权威（/etc/passwd 注册 shell，
 * 与进程环境无关）→ $SHELL 兜底。
 */
export function loginShellProbeCommand(): string {
  return 's="$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f7)"; printf %s "${s:-$SHELL}"';
}

/**
 * 登录 shell 会话旗标（单源）：`-l` 会话同环境（.zshenv/.profile 生效）；/bin/sh 不收
 * ——dash 拒绝 `-l`（Illegal option 秒退），退化形态无旗标裸跑（执行面 shellArgvFor 与
 * PTY 承载 spawnTerminal 共用）。
 */
export function loginShellFlags(loginShell: string): string[] {
  return loginShell === "/bin/sh" ? [] : ["-l"];
}

/** 登录 shell 解析（按缓存单次探测；非绝对路径/通道故障一律回落 /bin/sh 退化形态） */
export async function loginShellOf(scope: SshScope, cache: Map<string, string>): Promise<string> {
  const cached = cache.get("");
  if (cached !== undefined) {
    return cached;
  }
  let shell = "/bin/sh";
  try {
    const probe = await scope.shell(loginShellProbeCommand());
    const first = probe.code === 0 ? (probe.stdout.trim().split(/\s+/)[0] ?? "") : "";
    if (first.startsWith("/")) {
      shell = first;
    }
  } catch {
    // 通道故障 → /bin/sh 退化（登录环境缺席，PATH 兜底段仍在派发脚本里保底）
  }
  cache.set("", shell);
  return shell;
}

/**
 * CLI 头部（前 64 字节）→ 解释形态：ELF 原生二进制与其他解释器 shebang 直执行，
 * node shebang 与无 shebang 的 JS 入口走 node 前缀（缺省口径）。回归背景：claude-code
 * ≥2.x npm 发行把 bin 符号链接指向平台原生二进制（bin/claude.exe，ELF），node 直载
 * 在 type:module 包上按扩展名抛 ERR_UNKNOWN_FILE_EXTENSION——远端判定/派发全线退出码 1。
 */
export function classifyRemoteCliHead(head: string): RemoteCliInterpreter {
  if (head.startsWith("\u007fELF")) {
    return "direct";
  }
  if (!head.startsWith("#!")) {
    return "node";
  }
  const firstLine = head.split("\n", 1)[0] ?? "";
  return firstLine.split(/\s+/).some((t) => (t.split("/").pop() ?? "").startsWith("node")) ? "node" : "direct";
}

/**
 * 解析后的远端 CLI：exec 定位（绝对路径 + 解释形态）或登录 shell 名（.zshenv/.profile
 * 里的函数/别名封装——用户 ssh 会话同款解析优先）。
 */
export type ResolvedRemoteCli =
  { mode: "exec"; path: string; interpreter: RemoteCliInterpreter } | { mode: "shell"; name: string };

/**
 * 远端可执行解析（dsh-subprocess-ssh 语义 + 登录 shell 视角）：显式路径必须是绝对路径
 * （头部探测定解释形态）；裸名先经登录 shell `command -v`（与执行同环境——PATH、
 * .zshenv 函数/别名封装与 ssh 会话一致），命中绝对路径 → exec 定位，命中函数/别名
 * （非绝对输出）→ 登录 shell 名形态（用户封装原样生效）；未命中回落 /bin/sh + PATH
 * 兜底段探测保底。返回 error 文案 = 启动失败。
 */
export async function resolveRemoteExecutable(
  scope: SshScope,
  command: string,
  cache: Map<string, ResolvedRemoteCli | null>,
  loginShell: string,
): Promise<ResolvedRemoteCli | { error: string }> {
  const cmd = command.trim();
  if (cmd === "") {
    return { error: "agent 命令为空" };
  }
  if (cmd.includes("/") && !cmd.startsWith("/")) {
    return { error: `agent 命令含路径分隔符但非绝对路径：${cmd}（远端执行世界需绝对路径）` };
  }
  if (!cache.has(cmd)) {
    const resolved = cmd.includes("/")
      ? ({ mode: "exec", path: cmd, interpreter: await probeCliInterpreter(scope, cmd) } as const)
      : await resolveBareCli(scope, cmd, loginShell);
    cache.set(cmd, resolved);
  }
  const hit = cache.get(cmd) ?? null;
  return hit === null
    ? {
        error:
          `远端找不到命令 ${cmd}（登录 shell 与 PATH 兜底探测均无结果）` +
          "——确认 agent CLI 已安装在部署上，或在 agent 配置改填绝对路径",
      }
    : hit;
}

/** 裸名解析：登录 shell 视角优先，未命中回落 /bin/sh + PATH 兜底段探测 */
async function resolveBareCli(scope: SshScope, cmd: string, loginShell: string): Promise<ResolvedRemoteCli | null> {
  const viaLogin = await loginShellCommandV(scope, loginShell, cmd);
  if (viaLogin !== null) {
    return viaLogin;
  }
  const path = await probeCommandPath(scope, cmd);
  return path === null ? null : { mode: "exec", path, interpreter: await probeCliInterpreter(scope, path) };
}

/** 登录 shell 视角 command -v（与执行同环境）：绝对路径 → exec 定位（头部分类）；
 * 非绝对输出（zsh 函数/别名/内建，zsh 对函数回显函数名）→ 登录 shell 名形态；
 * 未命中/通道故障 → null（回落链承载） */
async function loginShellCommandV(scope: SshScope, loginShell: string, cmd: string): Promise<ResolvedRemoteCli | null> {
  try {
    const probe = await scope.spawn([
      loginShell,
      ...loginShellFlags(loginShell),
      "-c",
      `command -v ${posixQuote(cmd)}`,
    ]);
    if (probe.code !== 0) {
      return null;
    }
    const first = probe.stdout.trim().split(/\s+/)[0] ?? "";
    if (first === "") {
      return null;
    }
    return first.startsWith("/")
      ? { mode: "exec", path: first, interpreter: await probeCliInterpreter(scope, first) }
      : { mode: "shell", name: cmd };
  } catch {
    return null;
  }
}

/** 远端 `command -v` 单次探测（REMOTE_PATH_BOOTSTRAP 前插——~/.local/bin 家族 CLI 在
 * helper 缺省 PATH 外仍可解析；通道故障与找不到同归 null——launch 失败文案给指引） */
async function probeCommandPath(scope: SshScope, cmd: string): Promise<string | null> {
  try {
    const probe = await scope.shell(`${REMOTE_PATH_BOOTSTRAP}; command -v ${posixQuote(cmd)}`);
    const hit = probe.code === 0 ? (probe.stdout.trim().split(/\s+/)[0] ?? "") : "";
    return hit.startsWith("/") ? hit : null;
  } catch {
    return null;
  }
}

/** CLI 头部单次读取分类（head 缺席/不可读/通道故障 → node 前缀缺省——既有口径不回退成新失败） */
async function probeCliInterpreter(scope: SshScope, path: string): Promise<RemoteCliInterpreter> {
  try {
    const probe = await scope.shell(`head -c 64 ${posixQuote(path)}`);
    return probe.code === 0 ? classifyRemoteCliHead(probe.stdout) : "node";
  } catch {
    return "node";
  }
}
