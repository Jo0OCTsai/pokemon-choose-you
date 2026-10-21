/**
 * 外部终端唤起（debt ③ a 的本机载体解 + 终端偏好遵循）：插件宿主跑在用户这台 Mac 上
 * （dsh 桌面 app 的 Electron 主进程 / dsh web 的 Node 宿主 / dsh-tui 等），可在用户面前唤起
 * 本机 GUI 终端真窗口执行派发/回放命令行。载体判据 = darwin（不再要求 Electron 在场——
 * 浏览器与宿主同机为既定口径；浏览器在他机时窗口开在宿主屏幕，登记见 docs/debt.md）；
 * 探测不到已安装的终端 app → null（调用方回落 handoff 复制）。
 *
 * 终端选择（双层）：共享设置 terminal_preference（default/iterm2/ghostty/kitty/
 * windows-terminal；kitty 为 dsh 侧增设——主应用 TerminalPref 暂不识别该值、回落内置，
 * 值域对齐待办见 docs/debt.md ③a）命中且已安装 → 偏好优先（iterm2/ghostty/kitty 有
 * 映射；default/未知值/平台不适值无映射）；否则探测链（kitty → Ghostty → Alacritty →
 * WezTerm → iTerm2 → Terminal.app 兜底——kitty 首位因 tab 复用能力）。open -na 家族
 * 免系统授权排前，AppleScript 家族（iTerm2/Terminal——首次触发自动化授权弹窗）排后。
 * 偏好终端未安装 → 链回落（outcome.terminal=external-<label> 呈现实际唤起者，kitty
 * tab 复用时为 external-kitty@tab，可观察非静默）。其余平台未实装（仓库载体 macos）→
 * null。
 *
 * 命令行统一织入 `cd … && 命令行`（主应用 cd 前缀同构——目录经 quoteCdTarget：前导 ~
 * 裸写给 shell 展开，其余引用；引号内的 ~ 是字面量，整体引用会让 cd 必失败）；open 家族
 * 与 kitty 经用户 shell `$SHELL -i -l -c` 单串执行（登录+交互 = 手开终端等价环境——GUI
 * 精简 PATH 下裸名 agent 才可解析；主应用 bash -lc 的意图在 zsh-only-rc 机器上不带
 * nvm——登录非交互 shell 不读 .zshrc，须 -i），spawn 显式 argv 数组，零 shell 二次解析；
 * AppleScript 家族逐行 -e（iTerm2 与主应用 iterm2_script_lines 同构：activate +
 * create window + write text——会话本身即用户登录 shell，无需包装）。
 *
 * kitty 双形态（tab 优先）：remote control socket（约定 unix:/tmp/kitty.sock）在场 →
 * kitten @ launch --type=tab 在最近活跃 kitty 窗口开 tab（复用窗口零新增实例）；缺席
 * 或 tab 失败 → open -na 自举带 socket 的新实例（后续派发经 socket 全走 tab）。listen
 * socket 只能由启动旗标创建——kitty.conf 的 listen_on 解析但不生效（0.49.2 实证：旗标
 * --listen-on + 文件 allow_remote_control 均生效、文件 listen_on 不建 socket），故自举
 * 经 --args 传 --listen-on/--override 旗标，不依赖用户 kitty.conf。
 *
 * TerminalAdapter / terminalLine 注入件经 externalTerminalAdapter.ts 拆出（棘轮
 * max-lines；消费面经该模块 import）。
 */
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { posixQuote } from "../dispatch/cmdline";

/** 唤起形态（kitty tab 复用 = tab；其余含 kitty 自举 = window——outcome 呈现区分） */
export type ExternalSpawnForm = "tab" | "window";

/** 外部终端句柄（探测产物——label 供诊断/note 呈现） */
export interface ExternalTerminal {
  label: string;
  /** 唤起执行命令行（workdir 非空时织入 cd）；失败抛 Error */
  spawn(line: string, workdir: string | null): Promise<ExternalSpawnForm>;
}

/** 探测环境（测试可注入；缺省真实环境） */
export interface ExternalTerminalEnv {
  platform?: NodeJS.Platform;
  /** app 存在性探测（缺省 /Applications 与 ~/Applications 的 <name>.app） */
  appExists?: (name: string) => boolean;
  /** 子进程执行面（缺省 node:child_process spawn） */
  spawn?: (argv: string[]) => Promise<void>;
  /** kitty socket 在场探测（缺省约定路径 existsSync） */
  socketExists?: (path: string) => boolean;
  /** kitty 陈旧 socket 清理（缺省 fs unlink；tab 失败时残档不清自举 bind 必失败） */
  unlinkSocket?: (path: string) => void;
  /** kitten 二进制路径（缺省从已装 kitty.app 解析，未装时用 /Applications 缺省位） */
  kittenPath?: string;
  /** 用户登录 shell（缺省 $SHELL，再缺 /bin/zsh——darwin 默认；测试钉死 argv 用） */
  shell?: string;
}

/** handoff 原因码（客户端 web 提示与诊断呈现） */
export type HandoffReason = "web-carrier" | "no-terminal" | "spawn-failed";

/** macOS 终端候选：app 名（存在性探测）+ 完整 argv 组装（script 已织入 cd；shell = 用户登录 shell） */
interface MacTerminalSpec {
  name: string;
  argv(script: string, shell: string): string[];
}

/** iTerm2 的 AppleScript 程序（逐行，对应 osascript 的多个 -e；主应用 iterm2_script_lines 同构） */
function iterm2ScriptLines(script: string): string[] {
  return [
    'tell application "iTerm2"',
    "activate",
    "create window with default profile",
    "tell current session of current window",
    `write text "${osaEscape(script)}"`,
    "end tell",
    "end tell",
  ];
}

/** AppleScript 字符串转义（反斜杠与双引号） */
function osaEscape(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * 探测链候选（顺序即优先序）：kitty 首位（唯一 tab 复用能力，形态见 kittyExternal）
 * → open -na 免授权家族 → AppleScript 家族（iTerm2 在 Terminal.app 前——第三方终端
 * 体验优先，兜底末位恒为系统自带）。
 */
const MAC_TERMINALS: readonly MacTerminalSpec[] = [
  { name: "kitty", argv: (s, sh) => ["open", "-na", "kitty", "--args", ...loginShellArgv(sh, s)] },
  { name: "Ghostty", argv: (s, sh) => ["open", "-na", "Ghostty", "--args", "-e", ...loginShellArgv(sh, s)] },
  { name: "Alacritty", argv: (s, sh) => ["open", "-na", "Alacritty", "--args", "-e", ...loginShellArgv(sh, s)] },
  { name: "WezTerm", argv: (s, sh) => ["open", "-na", "WezTerm", "--args", "start", "--", ...loginShellArgv(sh, s)] },
  { name: "iTerm2", argv: (s) => ["osascript", ...iterm2ScriptLines(s).flatMap((line) => ["-e", line])] },
  { name: "Terminal", argv: (s) => ["osascript", "-e", `tell application "Terminal" to do script "${osaEscape(s)}"`] },
];

/**
 * 终端偏好值 → 探测链候选名（主应用 TerminalPref::from_setting 值域 + dsh 侧增设 kitty）。
 * default（内置）/未知值无映射 → 探测链；windows-terminal 仅 Windows 实装（darwin 无映射）。
 */
const PREFERRED_TERMINALS: Record<string, string> = {
  iterm2: "iTerm2",
  ghostty: "Ghostty",
  kitty: "kitty",
};

/** kitty remote control socket 约定（tab 复用与自举共用同一路径） */
const KITTY_SOCKET_ADDR = "unix:/tmp/kitty.sock";
const KITTY_SOCKET_PATH = "/tmp/kitty.sock";

/** app 安装路径（/Applications 与 ~/Applications 两处；未装 → null） */
function macAppDir(name: string): string | null {
  for (const dir of ["/Applications", `${homedir()}/Applications`]) {
    if (existsSync(`${dir}/${name}.app`)) {
      return `${dir}/${name}.app`;
    }
  }
  return null;
}

/** app 存在性（/Applications 与 ~/Applications 两处） */
function macAppExists(name: string): boolean {
  return macAppDir(name) !== null;
}

/** 子进程执行（argv 显式数组——零 shell 解析；非零退出/启动失败 → reject） */
function spawnArgv(argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${argv[0]} 退出码 ${code}`))));
  });
}

/** 用户登录 shell（$SHELL 缺席回落 darwin 默认 /bin/zsh） */
function shellOf(env: ExternalTerminalEnv): string {
  return env.shell ?? process.env["SHELL"] ?? "/bin/zsh";
}

/** 登录+交互 shell 执行 argv（等价手开终端的 rc 加载——裸名 agent 在 GUI 精简 PATH 下可解析） */
function loginShellArgv(shell: string, script: string): string[] {
  return [shell, "-i", "-l", "-c", script];
}

/** cd 目标的 shell 引用（quote_cd_target 同构）：前导 ~ 裸写给 shell 展开，其余整体引用 */
function quoteCdTarget(dir: string): string {
  if (dir === "~") {
    return "~";
  }
  return dir.startsWith("~/") ? `~/${posixQuote(dir.slice(2))}` : posixQuote(dir);
}

/** 命令行 → 首行命令（workdir 非空织入 cd 前缀——主应用「cd 目录 && 命令」整行同构） */
function shellScript(line: string, workdir: string | null): string {
  const dir = workdir?.trim() ?? "";
  return dir === "" ? line : `cd ${quoteCdTarget(dir)} && ${line}`;
}

/** 候选 → ExternalTerminal（kitty 走双形态特例；其余单窗口形态，spawn 织入 cd） */
function toExternal(spec: MacTerminalSpec, env: ExternalTerminalEnv): ExternalTerminal {
  if (spec.name === "kitty") {
    return kittyExternal(env);
  }
  const run = env.spawn ?? spawnArgv;
  const shell = shellOf(env);
  return {
    label: spec.name,
    spawn: async (line, workdir) => {
      await run(spec.argv(shellScript(line, workdir), shell));
      return "window";
    },
  };
}

/**
 * kitty 双形态（探测链首位）：socket 在场 → kitten @ launch --type=tab 在最近活跃
 * kitty 窗口开 tab；缺席或 tab 失败 → open -na 自举（新实例带 --listen-on +
 * --override 旗标——listen socket 只认启动旗标，用户 kitty.conf 的 listen_on 不生效，
 * 自举后后续派发全走 tab）。tab 失败时尽力清陈旧 socket 再自举（残档不清 bind 必失败）。
 */
function kittyExternal(env: ExternalTerminalEnv): ExternalTerminal {
  const run = env.spawn ?? spawnArgv;
  const socketExists = env.socketExists ?? ((path: string) => existsSync(path));
  const unlinkSocket = env.unlinkSocket ?? unlinkSync;
  const kitten = env.kittenPath ?? `${macAppDir("kitty") ?? "/Applications/kitty.app"}/Contents/MacOS/kitten`;
  const shell = shellOf(env);
  return {
    label: "kitty",
    async spawn(line, workdir) {
      const script = shellScript(line, workdir);
      if (socketExists(KITTY_SOCKET_PATH)) {
        try {
          await run([kitten, "@", "--to", KITTY_SOCKET_ADDR, "launch", "--type=tab", ...loginShellArgv(shell, script)]);
          return "tab";
        } catch {
          try {
            unlinkSocket(KITTY_SOCKET_PATH);
          } catch {
            // 尽力清理，失败继续自举
          }
        }
      }
      await run([
        "open",
        "-na",
        "kitty",
        "--args",
        `--listen-on=${KITTY_SOCKET_ADDR}`,
        "--override=allow_remote_control=socket-only",
        ...loginShellArgv(shell, script),
      ]);
      return "window";
    },
  };
}

/** 探测外部终端（darwin 且装有候选终端 app 才有产物；探测结果进程内记忆化） */
let memoized: ExternalTerminal | null | undefined;
export function detectExternalTerminal(env: ExternalTerminalEnv = {}): ExternalTerminal | null {
  // 全字段缺省 = 真实环境调用（进程内记忆化）；任一字段注入 = 测试探测（每次重探）
  if (Object.values(env).every((v) => v === undefined)) {
    memoized ??= detectOnce({});
    return memoized;
  }
  return detectOnce(env);
}

/** darwin 宿主闸门（探测链与偏好解析共用；其余平台未实装） */
function isMacHost(env: ExternalTerminalEnv): boolean {
  return (env.platform ?? process.platform) === "darwin";
}

function detectOnce(env: ExternalTerminalEnv): ExternalTerminal | null {
  if (!isMacHost(env)) {
    return null;
  }
  const appExists = env.appExists ?? macAppExists;
  const spec = MAC_TERMINALS.find((candidate) => appExists(candidate.name));
  return spec === undefined ? null : toExternal(spec, env);
}

/** 偏好命中的终端（已安装才返回；未设/未知值/未安装 → null 走探测链） */
function preferredMacTerminal(
  preference: string | null | undefined,
  env: ExternalTerminalEnv,
): ExternalTerminal | null {
  const preferredName = PREFERRED_TERMINALS[preference ?? ""];
  if (preferredName === undefined) {
    return null;
  }
  const spec = MAC_TERMINALS.find((candidate) => candidate.name === preferredName);
  if (spec === undefined || !(env.appExists ?? macAppExists)(spec.name)) {
    return null;
  }
  return toExternal(spec, env);
}

/**
 * 偏好感知解析：terminal_preference 命中且已安装 → 偏好终端；default/未设/未知值/
 * 偏好终端未安装 → 探测链；非 darwin → null（与探测链同闸门）。
 * 每次调用重新探测偏好终端的在场（existsSync 两次，廉价——设置可运行期改动）。
 */
export function resolveExternalTerminal(
  preference: string | null | undefined,
  env: ExternalTerminalEnv = {},
): ExternalTerminal | null {
  if (!isMacHost(env)) {
    return null;
  }
  return preferredMacTerminal(preference, env) ?? detectExternalTerminal(env);
}
