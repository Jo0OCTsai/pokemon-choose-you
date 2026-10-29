/**
 * remote 子命令（对齐 bin/pk/remote.rs）：生成远程主机上的 pk 透传 shim。
 * 场景：agent CLI 跑在远程机器、待办库在本机——远程放一个同名 `pk` 包装脚本，
 * 命令经 ssh 转发回本机执行。setup / __ssh_entry 的 ssh 编排见阶段四。
 */
import { chmodSync, writeFileSync } from "node:fs";
import { CliError, fail, flag, parseArgs, usageErr } from "./cli";

/** POSIX 单引号引用（sh 脚本内嵌用户值：host / 密钥路径；sh_quote 同构） */
function shQuote(s: string): string {
  const safe = s !== "" && /^[A-Za-z0-9\-_./=@:%+]+$/.test(s);
  return safe ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

export function runRemote(rest: readonly string[]): unknown {
  const sub = rest[0];
  if (sub === undefined) {
    throw usageErr("缺少 remote 子命令（目前支持 shim / setup）");
  }
  if (sub === "setup") {
    // 阶段四落地 ssh 编排（九步幂等开通）；此前显式失败（fail fast，不给半实现）
    throw usageErr("remote setup 尚未在 TS 实现落地（见 openspec ts-pk-and-agent-plugins 阶段四）");
  }
  if (sub !== "shim") {
    throw usageErr("remote 子命令目前只支持 shim / setup");
  }
  const p = parseArgs(rest.slice(1));
  const host = flag(p, "host");
  if (host === undefined || host === "") {
    throw usageErr(
      "remote shim 需要 --host <本机地址>（远程机器可达的地址，如 user@192.168.1.10 或 Tailscale 主机名）",
    );
  }
  const portRaw = flag(p, "port");
  let port: number | undefined;
  if (portRaw !== undefined && portRaw !== "") {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) throw usageErr("--port 必须是端口号数字");
    port = n;
  }
  const key = flag(p, "key");
  const keyClean = key !== undefined && key !== "" ? key : undefined;
  // host/key 引用后再进脚本：脚本经 /bin/sh 执行，含空格/特殊字符的值不引用会被拆词
  let fwd = "ssh -o BatchMode=yes -o ConnectTimeout=10";
  // 连接复用：首调建 ControlMaster，后续调用毫秒级。socket 落 /tmp（带 uid 防碰撞）：
  // 远程 agent 的 bash 沙箱（如 dsh workspace-write）对家目录只读，落 ~/.ssh 会在
  // bind 一步被拒（unix_listener: Permission denied）
  fwd += ' -o ControlMaster=auto -o ControlPath="/tmp/pk-ctl-$(id -u)-%C" -o ControlPersist=10m';
  if (keyClean !== undefined) {
    fwd += ` -i ${shQuote(keyClean)}`;
  }
  if (port !== undefined) {
    fwd += ` -p ${port}`;
  }
  fwd += ` ${shQuote(host)}`;
  // unix 本机加 PK_* 透传段（cmd.exe 没有 env 命令，Windows 本机保持直呼）；
  // 值在远程侧求值并内联进回连命令，本机侧 pk 照常拿到
  const isUnix = process.platform !== "win32";
  const envFwd = isUnix
    ? 'fwd=env\n[ -n "$PK_LOG_FILE" ] && fwd="$fwd PK_LOG_FILE=\\"$PK_LOG_FILE\\""\n[ -n "$PK_DISPATCH_TASK" ] && fwd="$fwd PK_DISPATCH_TASK=$PK_DISPATCH_TASK"\n'
    : "";
  const cmd = isUnix ? '"$fwd pk" "$@"' : 'pk "$@"';
  const script = `#!/bin/sh\n# pk 远程透传 shim（pokemon-choose-you）：把 pk 命令经 ssh 转发回本机执行，数据始终留在本机。\n# 部署：放到远程主机的 PATH 里并 chmod +x，如 ~/bin/pk；本机需开 sshd 并配好免密登录。\n${envFwd}exec ${fwd} ${cmd}\n`;
  const writePath = flag(p, "write");
  if (writePath !== undefined && writePath !== "") {
    try {
      writeFileSync(writePath, script);
    } catch (e) {
      throw new CliError(`写入 shim 失败: ${e instanceof Error ? e.message : String(e)}`, 1);
    }
    if (isUnix) {
      try {
        chmodSync(writePath, 0o755);
      } catch {
        // 权限位失败不阻断（目标文件系统可能不支持）
      }
    }
    return { written: writePath, host, executable: isUnix };
  }
  process.stdout.write(script);
  process.exit(0);
}

/** __ssh_entry 占位（阶段四落地 forced-command 校验链） */
export function sshEntry(): never {
  fail("__ssh_entry 尚未在 TS 实现落地", 78);
}
