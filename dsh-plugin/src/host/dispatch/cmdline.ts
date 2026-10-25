/**
 * 派发命令行组装（纯函数）——行为基准 = src-tauri/src/ai/invocation.rs posix_quote +
 * commands/dispatch/cmdline.rs（interactive_args / agent_line / summarize_line）。
 * 交互注入的 prompt 含飞书消息原文（不可信输入），逐参 POSIX 引用不裸拼。
 */

/** POSIX 单词引用：安全字符集裸拼，其余单引号包裹（' → '\'' 转义） */
export function posixQuote(s: string): string {
  const safe = s !== "" && /^[\w\-./=@:%+]*$/.test(s);
  return safe ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * cd 段组装（远端注入行/无头脚本共用）：~ 前缀保持波浪号裸拼——引号会阻断
 * shell 的 tilde 展开（cd '~/x' 是字面目录名），余部整体 posixQuote；~ 由远端
 * shell 展开为远端 $HOME。失败收口（|| exit 1）由调用方拼接。
 */
export function cdSegment(dir: string): string {
  const t = dir.trim();
  if (t === "~") {
    return "cd ~";
  }
  if (t.startsWith("~/")) {
    return `cd ~${posixQuote(t.slice(1))}`;
  }
  return `cd ${posixQuote(t)}`;
}

/**
 * 交互启动参数：历史参数去掉会话恢复类开关——派发开新会话，不是回放历史
 * （cmdline.rs interactive_args 逐字对齐：--resume-id/--session/--session-id 的值一并剔除）。
 */
export function interactiveArgs(historyArgs: string): string[] {
  const out: string[] = [];
  let skipValue = false;
  for (const tok of historyArgs.split(/\s+/).filter((t) => t !== "")) {
    if (skipValue) {
      skipValue = false;
      continue;
    }
    if (tok === "--resume-id" || tok === "--session" || tok === "--session-id") {
      skipValue = true;
      continue;
    }
    if (tok === "--resume" || tok === "resume" || tok === "--resume-picker" || tok === "-r") {
      continue;
    }
    out.push(tok);
  }
  return out;
}

/** agent 命令行（终端注入用）：命令 + 交互参数 + prompt 作为首条输入（整体引用） */
export function agentLine(command: string, args: string[], prompt: string): string {
  return [command, ...args].map(posixQuote).join(" ") + " " + posixQuote(prompt);
}

/**
 * 远端载荷行（ssh 包装内层）：工作目录非空时 cd 段前缀（~ 由远端 shell 展开——cdSegment
 * 口径；本机外部终端的 cd 织入不适用于远端目录）。
 */
export function remotePayloadLine(line: string, workdir: string | null | undefined): string {
  const dir = workdir?.trim() ?? "";
  return dir === "" ? line : `${cdSegment(dir)} && ${line}`;
}

/**
 * ssh 别名包装行（desktop direct_ssh_argv / history_invocation 远端分支同构——本机 GUI
 * 终端弹窗执行）：`ssh -tt -o ConnectTimeout=10 [-i key] [-p port] -- <target> exec "$SHELL"
 * -l -c '<payload>'`——不设 BatchMode（密钥未就绪时可在终端输密码）。载荷必须**自携单引号**
 * 到达远端：ssh 重组命令只做空格拼接（不保留引号），而本行先过本机 shell（剥一层引号）
 * ——故对已含引号的载荷再做一层 posixQuote，远端外层 shell 再剥一层，内层 -c 拿到完整
 * 命令串（desktop 直连 spawn 无此层，引号天然保留）。
 */
export function sshAliasLine(target: string, payload: string, opts: { keyPath?: string; port?: number } = {}): string {
  const argv = ["ssh", "-tt", "-o", "ConnectTimeout=10"];
  const key = opts.keyPath?.trim() ?? "";
  if (key !== "") {
    argv.push("-i", key);
  }
  if (opts.port !== undefined && opts.port !== 0 && opts.port !== 22) {
    argv.push("-p", String(opts.port));
  }
  argv.push("--", target, "exec", `"$SHELL"`, "-l", "-c");
  return [...argv.map(posixQuote), posixQuote(`'${payload}'`)].join(" ");
}

/** 落库/提示用 prompt 截断版（按字符截，中文安全；48 字符 + 省略号） */
export function promptSummary(prompt: string): string {
  const chars = Array.from(prompt);
  return chars.slice(0, 48).join("") + (chars.length > 48 ? "…" : "");
}

/** 落库/提示用命令行摘要：prompt 替换为截断版 */
export function summarizeLine(command: string, args: string[], prompt: string): string {
  return agentLine(command, args, promptSummary(prompt));
}

/**
 * 无头派发参数适配（headless.rs dispatch_args 同构）：剔除应用分类预设塞的
 * `--allowedTools Bash(pk:*)`（派发要读写仓库，白名单只约束分类）；用户自定义的
 * 其他 --allowedTools 值保留。
 */
export function dispatchArgs(args: string): string {
  const preset = "Bash(pk:*)";
  const toks = args.split(/\s+/).filter((t) => t !== "");
  return toks
    .filter((t, i) => {
      if (t === preset) {
        return false;
      }
      // 只带预设值的旗标一并剔除（值是别的工具时旗标保留）
      return !(t === "--allowedTools" && toks[i + 1] === preset);
    })
    .join(" ");
}
