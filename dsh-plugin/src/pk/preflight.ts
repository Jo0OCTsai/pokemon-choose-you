/**
 * sshd 语境预检（从 setup.ts 拆件控复杂度，doctor 落位体检共用）：pk 通道回连由
 * authorized_keys forced command 经本机 sshd 以默认 PATH（无 Homebrew/nvm）执行——
 * node 脚本形态的 pk 在该语境 `env: node: No such file or directory`（真机实测）。
 * 以最小环境真跑一次 --version 把失败前置暴露（原本要等第 9 步端到端才炸，且失败
 * 详情会被 -R 良性告警淹没）；wrapper 落位内嵌 node 绝对路径后免疫（host/remote/
 * pkLocal 的 pkWrapperScript，平台面侧）
 */
import { spawnSync } from "node:child_process";

/** sshd forced command 语境的默认 PATH（macOS/Linux sshd 给 command= 的最小环境） */
export const SSHD_DEFAULT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export interface PreflightResult {
  /** 非 undefined = 预检失败，值即 fail 步 detail */
  fail?: string;
  /** 通过时追加到 ok detail 的后缀 */
  suffix?: string;
}

/**
 * 以 sshd 默认 PATH 的最小环境真跑一次 `pk --version`。Windows 跳过（sshd 默认
 * shell 是 cmd、node 通常在系统 PATH，该语义不成立）
 */
export function sshdCtxPreflight(pkPath: string): PreflightResult {
  if (process.platform === "win32") {
    return {};
  }
  const probe = spawnSync(pkPath, ["--version"], {
    encoding: "utf8",
    env: { PATH: SSHD_DEFAULT_PATH },
    timeout: 15_000,
  });
  if (probe.status === 0) {
    return { suffix: "（sshd 最小 PATH 语境可用）" };
  }
  const err = (probe.stderr ?? "").trim();
  const why = err !== "" ? err : probe.error !== undefined ? probe.error.message : `退出码 ${probe.status ?? -1}`;
  return {
    fail:
      `本机 pk 在 sshd 默认 PATH 语境不可执行（${why}）：pk 通道回连经 authorized_keys forced ` +
      `command 以最小环境执行，node 脚本形态需 wrapper 落位或 node 在默认 PATH——` +
      `重跑本开通自动落 wrapper；仍失败请确认 node 安装路径`,
  };
}
