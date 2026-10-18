/**
 * SshScope 之上的组合原语（shell / writeFile——从 DshSshScope 抽出的单一源）：
 * 家族链 scope（进程内）与 broker scope（系统 Node 子进程传输）两实现共用，
 * 保证两种传输的语义逐字节一致（posixQuote 组装 / cat 管道上传 / sha256 复核）。
 * 零 dsh import（remote/ 不变量）。
 */
import { createHash } from "node:crypto";
import { posixQuote } from "../dispatch/cmdline";
import type { SshScope, SshSpawnResult } from "./sshScope";

/** shell 包裹被信号杀死（拿不到退出码）时的替代退出码（对齐 ssh 连接失败惯例值） */
export const SHELL_SIGNAL_EXIT_CODE = 255;

/** spawn 面子集（组合原语的最小依赖——两个实现 + 测试 fake 同形） */
export type SpawnFace = (cmd: string[], opts?: Parameters<SshScope["spawn"]>[1]) => Promise<SshSpawnResult>;

/** 无终端 shell 快捷命令：/bin/sh -c 原样执行（组装方保证逐参 posixQuote——NFR-11④） */
export async function shellViaSpawn(
  spawn: SpawnFace,
  cmd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await spawn(["/bin/sh", "-c", cmd]);
  return { code: result.code ?? SHELL_SIGNAL_EXIT_CODE, stdout: result.stdout, stderr: result.stderr };
}

/** 远端文件写入：spawn `cat > path` + stdin 管道灌内容（字节安全、零命令行拼接），
 * 写毕远端 sha256 复核并返回（AD §4.5 步③上传原语） */
export async function writeFileViaSpawn(
  spawn: SpawnFace,
  path: string,
  content: Buffer | string,
): Promise<{ sha256: string }> {
  const text = typeof content === "string" ? content : content.toString("utf8");
  const write = await spawn(["/bin/sh", "-c", `cat > ${posixQuote(path)}`], { stdin: text });
  if (write.code !== 0) {
    throw new Error(`远端写入失败（exit ${write.code}）：${write.stderr.slice(0, 160)}`);
  }
  const expected = createHash("sha256").update(text, "utf8").digest("hex");
  const verify = await spawn(["/bin/sh", "-c", `sha256sum ${posixQuote(path)}`]);
  if (verify.code !== 0) {
    throw new Error(`远端 sha256sum 失败（exit ${verify.code}）：${verify.stderr.slice(0, 160)}`);
  }
  const token = verify.stdout.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new Error("远端 sha256sum 输出无法解析（首段非 64 位 hex）");
  }
  if (token !== expected) {
    throw new Error(`远端写入复核不符（远端 ${token} ≠ 预期 ${expected}）`);
  }
  return { sha256: token };
}
