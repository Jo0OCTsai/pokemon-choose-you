/**
 * setup 缺省上下文组装（CLI 侧缺省值；从 setup.ts 拆件控文件规模）。
 */
import { userInfo } from "node:os";
import type { SetupCtx } from "./setup";

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
