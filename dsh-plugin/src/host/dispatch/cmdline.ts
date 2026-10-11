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

/** 落库/提示用命令行摘要：prompt 替换为截断版（按字符截，中文安全；48 字符 + 省略号） */
export function summarizeLine(command: string, args: string[], prompt: string): string {
  const chars = Array.from(prompt);
  const head = chars.slice(0, 48).join("");
  return agentLine(command, args, head + (chars.length > 48 ? "…" : ""));
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
