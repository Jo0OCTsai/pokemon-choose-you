/**
 * setup 缺省上下文组装（CLI 侧缺省值；从 setup.ts 拆件控文件规模）。
 */
import { statSync } from "node:fs";
import { userInfo } from "node:os";
import type { SetupCtx } from "./setup";

/**
 * argv[1] 缺省定位：wrapper 落位语境（`exec node pk.mjs`）argv[1] 是裸 pk.mjs，而
 * sshd 语境（预检/forced command/shim）需最小 PATH 可执行形态——pk.mjs → 同目录
 * wrapper（unix 需执行位；win32 取 pk.cmd 存在即可），不可达则原样返回
 */
export function defaultPkPath(argv1: string): string {
  if (!argv1.endsWith(".mjs")) return argv1;
  const wrapper = process.platform === "win32" ? `${argv1.slice(0, -4)}.cmd` : argv1.slice(0, -4);
  try {
    return process.platform === "win32" || (statSync(wrapper).mode & 0o111) !== 0 ? wrapper : argv1;
  } catch {
    return argv1;
  }
}

export function defaultCtx(opts: {
  host: string;
  tunnelPort: number;
  pkPath: string;
  keyDir: string;
  localUser?: string;
  timeoutSecs: number;
}): SetupCtx {
  return {
    sshProgram: sshProgramOf(),
    keyscanProgram: "ssh-keyscan",
    sshKeygenProgram: "ssh-keygen",
    host: opts.host,
    sshPort: 0,
    agentKey: null,
    stepTimeoutMs: opts.timeoutSecs * 1000,
    tunnelPort: opts.tunnelPort,
    localUser: opts.localUser ?? userInfo().username,
    pkPath: opts.pkPath,
    keyDir: opts.keyDir,
    localHome: userInfo().homedir,
  };
}

// 内部函数随迁
function sshProgramOf(): string {
  const v = process.env.PK_SSH_BIN;
  return v !== undefined && v.trim() !== "" ? v.trim() : "ssh";
}
