/**
 * fake SshScope 的模拟远端文件系统原语与应答族（从 fakeSshScope.ts 拆出——棘轮
 * max-lines，等量迁移；posixUnquote / sha256Of 经 fakeSshScope 再出口，消费面不变）：
 * head 头部读取 / sha256sum 复核 / rm -rf 目录删除三类 shell 命令的内存 Map 应答。
 */
import { createHash } from "node:crypto";

/** posixQuote 逆操作（fake 远端解析 shell 命令取回路径用；只覆盖 posixQuote 的产物形态） */
export function posixUnquote(token: string): string {
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replaceAll(`'\\''`, `'`);
  }
  return token;
}

export function sha256Of(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** shell 应答信封形态 */
export interface ShellOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

/** head -c <n> <path> 应答（CLI 头部分类探测——模拟远端文件系统；未登记 = 不存在） */
export function headCOutcome(files: Map<string, string>, cmd: string): ShellOutcome | null {
  const m = /^head -c (\d+) (.+)$/.exec(cmd);
  if (m === null) return null;
  const path = posixUnquote(m[2]);
  const content = files.get(path);
  return content === undefined
    ? { code: 1, stdout: "", stderr: `head: ${path}: No such file or directory` }
    : { code: 0, stdout: content.slice(0, Number(m[1])), stderr: "" };
}

/** sha256sum 应答（模拟远端文件系统内容自洽） */
export function sha256Outcome(files: Map<string, string>, cmd: string): ShellOutcome {
  const path = posixUnquote(cmd.slice("sha256sum ".length));
  const content = files.get(path);
  if (content === undefined) {
    return { code: 1, stdout: "", stderr: `sha256sum: ${path}: No such file or directory` };
  }
  return { code: 0, stdout: `${sha256Of(content)}  ${path}\n`, stderr: "" };
}

/** rm -rf -- <dir> 应答（目录级删除模拟远端文件系统条目） */
export function rmRfOutcome(files: Map<string, string>, cmd: string): ShellOutcome {
  const dir = posixUnquote(cmd.slice("rm -rf -- ".length));
  for (const key of [...files.keys()]) {
    if (key === dir || key.startsWith(`${dir}/`)) {
      files.delete(key);
    }
  }
  return { code: 0, stdout: "", stderr: "" };
}
