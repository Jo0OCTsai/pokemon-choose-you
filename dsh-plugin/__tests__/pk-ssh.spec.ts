/**
 * pk 自持 ssh 底座：failureDetail 流选择（ai/runner.rs failure_detail 同构语义，
 * #127 现场复盘——stderr 只剩良性 ssh -R 告警时补 stdout 片段不丢真因）与
 * sshRun 失败分支收编。
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { failureDetail, sshRun, type SshCtx } from "../src/pk/ssh";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("failureDetail 流选择", () => {
  it("stderr 全是良性 Warning 行 + stdout 非空 → 警告保留、stdout 片段拼后", () => {
    expect(failureDetail("Warning: remote port forwarding failed for listen port 10022\n", "Not logged in")).toBe(
      "Warning: remote port forwarding failed for listen port 10022；stdout：Not logged in",
    );
  });

  it("stderr 为空 + stdout 非空 → 直接回 stdout 片段", () => {
    expect(failureDetail("", "real cause")).toBe("real cause");
  });

  it("stderr 含非 Warning 诊断行 → 只回 stderr，不掺 stdout 噪音", () => {
    expect(failureDetail("env: node: No such file or directory", "noise")).toBe("env: node: No such file or directory");
  });

  it("两流皆空 → 空串（调用方回落「退出码 N」）", () => {
    expect(failureDetail("", "")).toBe("");
  });

  it("超长片段截断到 300 字符", () => {
    const long = "x".repeat(500);
    expect(failureDetail("", long)).toHaveLength(300);
  });
});

describe("sshRun 失败分支收编 failureDetail", () => {
  it("stderr 只剩良性 -R 告警 → 失败详情带回 stdout 真因（现场形态）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pk-ssh-"));
    dirs.push(dir);
    const ssh = join(dir, "fake-ssh");
    writeFileSync(
      ssh,
      '#!/bin/sh\necho "Warning: remote port forwarding failed for listen port 10022" >&2\necho "Not logged in"\nexit 1\n',
    );
    chmodSync(ssh, 0o755);
    const ctx: SshCtx = {
      sshProgram: ssh,
      keyscanProgram: "ssh-keyscan",
      host: "user@box",
      sshPort: 0,
      agentKey: null,
      stepTimeoutMs: 10_000,
    };
    const [ok, out] = sshRun(ctx, [], "whatever", null);
    expect(ok).toBe(false);
    expect(out).toContain("Warning: remote port forwarding failed");
    expect(out).toContain("；stdout：Not logged in");
  });
});
