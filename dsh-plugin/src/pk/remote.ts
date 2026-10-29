/**
 * remote 子命令 + __ssh_entry（对齐 bin/pk/remote.rs）：透传 shim 生成、九步幂等
 * 开通（ADR-0006 双实现）、forced command 严格解析。shim/setup 不碰库（main 抢在
 * open_db 之前分发）；__ssh_entry 把可执行面收敛到 pk 自身——私钥失陷也开不了 shell。
 */
import { chmodSync, writeFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CliError, flag, parseArgs, usageErr } from "./cli";
import { DEFAULT_TUNNEL_PORT, defaultCtx, runSetup } from "./setup";
import { appHome, DATA_SUBDIR } from "../host/storage/paths";

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
    return runRemoteSetup(rest.slice(1));
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

/** pk remote setup：开通 pk 通道——参数化执行九步序列，JSON 报告输出 */
function runRemoteSetup(rest: readonly string[]): unknown {
  const p = parseArgs(rest);
  const host = flag(p, "host");
  if (host === undefined || host === "") {
    throw usageErr("remote setup 需要 --host <OpenSSH 别名>（凭据与端口由 ~/.ssh/config 承载）");
  }
  let tunnelPort = DEFAULT_TUNNEL_PORT;
  const tpRaw = flag(p, "tunnel-port");
  if (tpRaw !== undefined && tpRaw !== "") {
    const n = Number(tpRaw);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) throw usageErr("--tunnel-port 必须是端口号数字");
    tunnelPort = n;
  }
  // pk-path 缺省 = 本 pk 自身（bundle/落位脚本的绝对路径）
  const pkPath = flag(p, "pk-path") || resolve(process.argv[1] ?? "pk");
  const home = appHome();
  const keyDir = flag(p, "key-dir") || (home ? `${home}/${DATA_SUBDIR}` : process.cwd());
  const timeoutRaw = flag(p, "timeout-secs");
  let timeoutSecs = 60;
  if (timeoutRaw !== undefined && timeoutRaw !== "") {
    const n = Number(timeoutRaw);
    if (!Number.isInteger(n) || n <= 0) throw usageErr("--timeout-secs 必须是正整数");
    timeoutSecs = n;
  }
  const localUser = flag(p, "local-user") || undefined;
  return runSetup(defaultCtx({ host, tunnelPort, pkPath, keyDir, localUser, timeoutSecs }));
}

// ---- __ssh_entry：forced command 严格解析（bin/pk/remote.rs ssh_entry 同构） ----

/** forced command 允许透传的环境变量白名单（与 shim 透传集合一致） */
const SSH_ENTRY_ENV_ALLOWLIST = ["PK_LOG_FILE", "PK_DISPATCH_TASK"];

export function sshEntry(): never {
  const orig = process.env.SSH_ORIGINAL_COMMAND ?? "";
  // node 脚本形态的「自身路径」：解释器 + 脚本（spawn 直启不经 shell）
  const selfScript = resolve(process.argv[1] ?? "pk");
  let parsed: { envs: Array<[string, string]>; args: string[] };
  try {
    parsed = parseForcedCommand(orig, selfScript);
  } catch (e) {
    process.stderr.write(
      `${JSON.stringify({ error: `ssh_entry: 拒绝执行（${e instanceof Error ? e.message : String(e)}）` })}\n`,
    );
    process.exit(78);
  }
  const out = spawnSync(process.execPath, [selfScript, ...parsed.args], {
    env: { ...process.env, ...Object.fromEntries(parsed.envs) },
    stdio: "inherit",
  });
  if (out.error) {
    process.stderr.write(`${JSON.stringify({ error: `ssh_entry: 重启自身失败: ${out.error.message}` })}\n`);
    process.exit(1);
  }
  process.exit(out.status ?? 1);
}

/** SSH_ORIGINAL_COMMAND 的严格语法解析（纯函数，独立测试） */
export function parseForcedCommand(
  orig: string,
  selfScript: string,
): { envs: Array<[string, string]>; args: string[] } {
  const tokens = shlexSplit(orig);
  let i = 0;
  if (tokens[0] === "env") {
    i += 1;
  }
  const envs: Array<[string, string]> = [];
  while (i < tokens.length) {
    const eq = tokens[i].indexOf("=");
    if (eq <= 0) break;
    const name = tokens[i].slice(0, eq);
    if (!SSH_ENTRY_ENV_ALLOWLIST.includes(name)) {
      throw new Error(`环境变量 ${name} 不在透传白名单`);
    }
    envs.push([name, tokens[i].slice(eq + 1)]);
    i += 1;
  }
  const program = tokens[i];
  if (program === undefined) {
    throw new Error("缺少 pk 程序路径");
  }
  if (!sameProgram(program, selfScript)) {
    throw new Error("命令程序不是本 pk");
  }
  return { envs, args: tokens.slice(i + 1) };
}

/** 词法切分（POSIX sh 子集：裸词 / 单引号 / 双引号 / 反斜杠转义；不做任何展开）。
 * 只需覆盖本应用两端（shim 生成侧与本入口）的产出形态，不识别的形态宁可报错也不猜 */
export function shlexSplit(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let hasCur = false;
  const chars = [...s];
  let idx = 0;
  const next = (): string | undefined => chars[idx++];
  for (;;) {
    const c = next();
    if (c === undefined) break;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      if (hasCur) {
        out.push(cur);
        cur = "";
        hasCur = false;
      }
    } else if (c === "'") {
      hasCur = true;
      for (;;) {
        const ch = next();
        if (ch === undefined) throw new Error("未闭合的单引号");
        if (ch === "'") break;
        cur += ch;
      }
    } else if (c === '"') {
      hasCur = true;
      for (;;) {
        const ch = next();
        if (ch === undefined) throw new Error("未闭合的双引号");
        if (ch === '"') break;
        if (ch === "\\") {
          const e = next();
          if (e === undefined) throw new Error("双引号内反斜杠悬空");
          if (e === '"' || e === "\\" || e === "$" || e === "`") {
            cur += e;
          } else {
            cur += `\\${e}`;
          }
        } else {
          cur += ch;
        }
      }
    } else if (c === "\\") {
      const ch = next();
      if (ch === undefined) throw new Error("悬空反斜杠");
      cur += ch;
      hasCur = true;
    } else {
      cur += c;
      hasCur = true;
    }
  }
  if (hasCur) out.push(cur);
  return out;
}

/** 程序路径等价判定：realpath 消解符号链接后比较（Windows 大小写不敏感） */
export function sameProgram(a: string, b: string): boolean {
  const resolveOrSelf = (p: string): string => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const pa = resolveOrSelf(a);
  const pb = resolveOrSelf(b);
  return process.platform === "win32" ? pa.toLowerCase() === pb.toLowerCase() : pa === pb;
}
