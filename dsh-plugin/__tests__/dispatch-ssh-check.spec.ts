/**
 * dispatch/sshCheck · SSH 免密预检探测器（从 dispatch-interactive.spec 拆出以控文件
 * 行数棘轮）：systemSshProbe 真实子进程路径（fake ssh 脚本成功/失败/不可达）+
 * probe 注入集成（argv 组装 BatchMode/ConnectTimeout/端口解析与错误信封）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sshCheck, sshProbeArgv, systemSshProbe } from "../src/host/dispatch/sshCheck";
import { createTestDb, type TestDb } from "./helpers";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

describe("sshCheck 系统探测器（fake ssh 探测脚本：成功/失败）", () => {
  /** 写一个 fake ssh 脚本（真实子进程路径，bin 注入） */
  function fakeSshScript(body: string): string {
    const path = join(db.dir, "fake-ssh.sh");
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  }

  it("exit 0（带 stderr 告警文本）→ ok", async () => {
    const probe = systemSshProbe(fakeSshScript("echo warning-to-stderr >&2; exit 0"));
    expect(await sshCheck("u@h", { probe })).toEqual({ ok: true });
  });

  it("exit 255 无输出 → ok:false，错误文案取 exec 错误信息", async () => {
    const probe = systemSshProbe(fakeSshScript("exit 255"));
    const outcome = await sshCheck("u@h", { probe });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("SSH_AUTH_REQUIRED");
      expect(outcome.error.message).toMatch(/Command failed|u@h/);
    }
  });

  it("不可达真实目标 → ok:false（SSH_AUTH_REQUIRED，不挂起）", async () => {
    const outcome = await sshCheck("u@nonexistent-host-pky.invalid", { connectTimeoutSecs: 1 });
    expect(outcome.ok).toBe(false);
  });

  it("sshProbeArgv：无端口目标不带 -p", () => {
    expect(sshProbeArgv("u@h")).toEqual(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", "u@h", "true"]);
  });
});

describe("sshCheck 集成（fake 探测器：成功/失败）", () => {
  it("exit 0 → ok；非 0 → SSH_AUTH_REQUIRED（argv 含 BatchMode/ConnectTimeout/端口解析）", async () => {
    const seen: string[][] = [];
    const okProbe = async (argv: string[], opts: { timeoutMs: number }) => {
      seen.push(argv);
      expect(opts.timeoutMs).toBe(15_000);
      return { code: 0, stderr: "" };
    };
    expect(await sshCheck("vscode@localhost:1022", { probe: okProbe })).toEqual({ ok: true });
    expect(seen[0]).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-p",
      "1022",
      "--",
      "vscode@localhost",
      "true",
    ]);
    const fail = await sshCheck("u@h", {
      probe: async () => ({ code: 255, stderr: "Permission denied (publickey)." }),
    });
    expect(fail.ok).toBe(false);
    if (!fail.ok) {
      expect(fail.error.code).toBe("SSH_AUTH_REQUIRED");
      expect(fail.error.message).toContain("Permission denied");
      expect(fail.error.hint).toMatch(/免密/);
    }
  });
});
