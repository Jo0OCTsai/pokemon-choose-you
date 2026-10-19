/**
 * remote/sshOps：SshScope 组合原语（shell / writeFile）——进程内家族链与 broker
 * 传输两实现共用的单一源。分支面：shell 的 255 兜底；writeFile 的写失败 /
 * sha256 执行失败 / 输出解析失败 / 复核不符四拒绝路径 + 成功回执。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { shellViaSpawn, writeFileViaSpawn, type SpawnFace } from "../../src/host/remote/sshOps";
import type { SshSpawnResult } from "../../src/host/remote/sshScope";

function spawnOf(script: (cmd: string[]) => Partial<SshSpawnResult>): SpawnFace {
  return async (cmd) =>
    ({
      code: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      ...script(cmd),
    }) as SshSpawnResult;
}

describe("shellViaSpawn", () => {
  it("经 /bin/sh -c 执行；正常退出码/输出透传", async () => {
    const calls: string[][] = [];
    const out = await shellViaSpawn(
      spawnOf((cmd) => {
        calls.push(cmd);
        return { code: 3, stdout: "o", stderr: "e" };
      }),
      "echo hi",
    );
    expect(calls).toEqual([["/bin/sh", "-c", "echo hi"]]);
    expect(out).toEqual({ code: 3, stdout: "o", stderr: "e" });
  });

  it("退出码 null（被信号杀）→ 255 兜底（与 ssh 连接失败惯例值一致）", async () => {
    const out = await shellViaSpawn(
      spawnOf(() => ({ code: null })),
      "x",
    );
    expect(out.code).toBe(255);
  });
});

/** 按 cmd 前缀分派的 fake spawn：cat > 写入分支与 sha256sum 复核分支结果分别注入 */
function catShaSpawn(cat: Partial<SshSpawnResult>, sha: Partial<SshSpawnResult>): SpawnFace {
  return spawnOf((cmd) => (cmd[2]?.startsWith("cat >") === true ? cat : sha));
}

describe("writeFileViaSpawn", () => {
  const good = (text: string): SpawnFace =>
    spawnOf((cmd) => {
      if (cmd[2]?.startsWith("cat >") === true) return { code: 0 };
      return { code: 0, stdout: `${createHash("sha256").update(text, "utf8").digest("hex")}  path` };
    });

  it("成功：cat 管道写入 + sha256sum 复核一致 → 回执远端摘要", async () => {
    const result = await writeFileViaSpawn(good("hello"), "/tmp/f", "hello");
    expect(result.sha256).toBe(createHash("sha256").update("hello", "utf8").digest("hex"));
  });

  it("Buffer 内容按 utf8 同口径复核", async () => {
    const result = await writeFileViaSpawn(good("bytes"), "/tmp/f", Buffer.from("bytes"));
    expect(result.sha256).toBe(createHash("sha256").update("bytes", "utf8").digest("hex"));
  });

  it("cat 非零退出 → 写入失败（带 stderr 摘要）", async () => {
    await expect(
      writeFileViaSpawn(catShaSpawn({ code: 1, stderr: "EACCES" }, { code: 0 }), "/tmp/f", "x"),
    ).rejects.toThrow(/远端写入失败（exit 1）：EACCES/);
  });

  it("sha256sum 非零退出 / 输出非 64 位 hex → 解析拒绝", async () => {
    await expect(
      writeFileViaSpawn(catShaSpawn({ code: 0 }, { code: 2, stderr: "no file" }), "/tmp/f", "x"),
    ).rejects.toThrow(/sha256sum 失败（exit 2）/);
    await expect(writeFileViaSpawn(catShaSpawn({ code: 0 }, { stdout: "zzz" }), "/tmp/f", "x")).rejects.toThrow(
      /无法解析/,
    );
  });

  it("远端摘要与内容不符 → 复核不符拒绝（写入完整性内建保障）", async () => {
    await expect(
      writeFileViaSpawn(catShaSpawn({ code: 0 }, { stdout: `${"0".repeat(64)}  p` }), "/tmp/f", "x"),
    ).rejects.toThrow(/复核不符/);
  });
});
