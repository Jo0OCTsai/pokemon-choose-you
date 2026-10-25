/**
 * worktree 策略（真实 dsh worktrees 子系统后续装配；接口先行）——行为基准 =
 * src-tauri/src/commands/dispatch/headless.rs ensure_worktree：仓库旁建兄弟目录与
 * 分支 pk-<任务id>（幂等复用）；失败降级原目录 + note。deployment 远端的 worktree
 * 预备经 ShellRunner 抽象（SSH provider 实现同型接口后续装配）。
 */
import { execFile } from "node:child_process";
import { posixQuote } from "./cmdline";

/** shell 脚本执行器（local = sh -c；deployment 远端执行世界后续以 SSH provider 实现同型接口） */
export type ShellRunner = (script: string) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export const localShellRunner: ShellRunner = (script) =>
  new Promise((resolve) => {
    execFile("sh", ["-c", script], { timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr ?? error?.message ?? "") });
    });
  });

export interface WorktreeStrategy {
  /** 幂等确保 worktree（返回生效目录；null = 降级原目录 + note 给用户） */
  ensure(input: { workdir: string; taskId: number }): Promise<{ dir: string | null; note: string | null }>;
}

/** 直跑原目录（不隔离；配置驱动的缺省策略） */
export function noOpWorktree(): WorktreeStrategy {
  return {
    async ensure() {
      return { dir: null, note: null };
    },
  };
}

/** worktree 建立脚本（ensure_worktree 同构：定位仓库根 → 兄弟目录建/复用 → 哨兵回显） */
function worktreeScript(workdir: string, taskId: number): string {
  const dir = posixQuote(workdir.trim());
  return (
    `cd ${dir} || exit 1; ` +
    "top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 1; " +
    `wt="$(dirname "$top")/$(basename "$top")-pk-${taskId}"; ` +
    'if [ ! -d "$wt" ]; then ' +
    `git -C "$top" worktree add -b pk-${taskId} "$wt" 2>/dev/null ` +
    `|| git -C "$top" worktree add "$wt" pk-${taskId} 2>/dev/null ` +
    "|| exit 1; " +
    "fi; " +
    'echo "PK_WT $wt"'
  );
}

/** 解析 worktree 脚本输出（哨兵行 → 生效目录；缺失/失败 → 降级原目录 + note） */
function parseWorktreeResult(
  result: { ok: boolean; stdout: string; stderr: string },
  taskId: number,
): { dir: string | null; note: string | null } {
  if (!result.ok) {
    return { dir: null, note: `worktree 建立失败（${result.stderr.slice(0, 120)}），改用原工作目录` };
  }
  const line = result.stdout.split("\n").find((l) => l.startsWith("PK_WT "));
  if (line === undefined) {
    return { dir: null, note: "worktree 输出异常，改用原工作目录" };
  }
  return { dir: line.slice("PK_WT ".length), note: `worktree 隔离：分支 pk-${taskId}，完成后人工合并` };
}

/** 仓库旁建兄弟目录与分支 pk-<任务id>（ensure_worktree 同构；幂等复用） */
export function gitWorktree(runner: ShellRunner = localShellRunner): WorktreeStrategy {
  return {
    async ensure({ workdir, taskId }) {
      return parseWorktreeResult(await runner(worktreeScript(workdir, taskId)), taskId);
    },
  };
}
