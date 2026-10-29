/**
 * shim 脚本与远端命令文本族（从 setup.ts 拆件控文件规模；对齐 remote_pk.rs 的
 * shim_script / to_known_hosts_lines / verify_remote_line / posix_quote）。
 */
/** POSIX 单引号引用（shim 行内路径交给本机登录 shell 重解析；posix_quote 同构） */

const isWindows = process.platform === "win32";

export function posixQuote(s: string): string {
  const safe = s !== "" && /^[A-Za-z0-9\-_./=@:%+]+$/.test(s);
  return safe ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

/** shim 脚本内容（shim_script 同构）：经反向隧道回本机执行，pk 绝对路径内嵌 */
export function shimScript(pkPath: string, tunnelPort: number, localUser: string): string {
  const quotedPk = isWindows
    ? // 本机 sshd 默认 shell 是 cmd：含空格的路径用双引号
      pkPath.includes(" ")
      ? `"${pkPath}"`
      : pkPath
    : posixQuote(pkPath);
  // unix 本机：PK_* 已设置时以 env 前缀带回（值含空格安全：远端求值时已加引号）
  const [envFwd, tail] = isWindows
    ? ["", `${quotedPk} "$@"`]
    : [
        'fwd=env\n[ -n "$PK_LOG_FILE" ] && fwd="$fwd PK_LOG_FILE=\\"$PK_LOG_FILE\\""\n[ -n "$PK_DISPATCH_TASK" ] && fwd="$fwd PK_DISPATCH_TASK=$PK_DISPATCH_TASK"\n',
        `"$fwd ${quotedPk}" "$@"`,
      ];
  return (
    `#!/bin/sh\n` +
    `# pk 远程透传 shim（就决定是你了一键配置生成）：经应用建立的反向隧道回本机执行，数据始终留在本机。\n` +
    `# 连接复用：首调建 ControlMaster，后续调用毫秒级；环境透传见下方 fwd 段。\n` +
    `${envFwd}` +
    `exec ssh -o BatchMode=yes -o ConnectTimeout=10 \\\n` +
    `-o ControlMaster=auto -o ControlPath="/tmp/pk-shim-$(id -u)-%C" -o ControlPersist=10m \\\n` +
    `-i "$HOME/.ssh/pk_shim" -p ${tunnelPort} ${posixQuote(`${localUser}@127.0.0.1`)} ${tail}\n`
  );
}

/** ssh-keyscan 输出 → known_hosts 条目：主机名改写为 [127.0.0.1]:隧道端口 */
export function toKnownHostsLines(keyscan: string, tunnelPort: number): string {
  let out = "";
  for (const raw of keyscan.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    out += sp >= 0 ? `[127.0.0.1]:${tunnelPort} ${line.slice(sp + 1)}\n` : `${line}\n`;
  }
  return out;
}

/** 端到端验证的远端命令行（verify_remote_line 同构）：跑 pk --version 后立刻关闭
 * shim 的 ControlPersist master——master 攥着临时 -R 隧道不放手则 setup 永久挂起 */
export function verifyRemoteLine(): string {
  return (
    `"$SHELL" -lc 'pk --version'; rc=$?; ` +
    `for s in $(find "$HOME/.ssh" /tmp -maxdepth 1 -name 'pk-shim-*' 2>/dev/null); do ` +
    `[ -S "$s" ] && ssh -o BatchMode=yes -o ConnectTimeout=3 -o "ControlPath=$s" ` +
    `-O exit 127.0.0.1 2>/dev/null; done; ` +
    `pkill -f 'pk-shim-.* \\[mux\\]' 2>/dev/null; ` +
    `exit $rc`
  );
}
