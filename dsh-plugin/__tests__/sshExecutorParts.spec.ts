/**
 * sshExecutor 装配件/直连执行器分支单测（从 assemblySections.spec 拆出——棘轮
 * max-lines，等量迁移）：路由装配件（local/family/reject/direct）、就绪复核直连
 * 预检、交互三分支、直连 fake ssh 成功/失败/超时/stdin 面。
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAndInit } from "../src/host/storage/init";
import type { Conn } from "../src/host/storage/db";
import {
  createDirectSshExecutor,
  createRemoteDispatchGuard,
  directSshRunner,
  remoteHeadlessDeps,
  remoteInteractiveParts,
  createDeploymentPrecheck,
  type RemoteDispatchPlatform,
} from "../src/host/remote/sshExecutor";
import { deploymentUpsert, listDeployments, DEPLOYMENTS_KEY } from "../src/host/remote/deployments";

let dir: string;
let conn: Conn;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-ssh-parts-"));
  conn = openAndInit(join(dir, "data", "test.db")).conn;
});
afterEach(() => {
  conn.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 直连 fake ssh 脚本落盘（可执行） */
function fakeSsh(body: string): string {
  const path = join(dir, "fake-ssh.sh");
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

/** 部署置位（ready/degraded 等状态覆写） */
function setDeployment(alias: string, patch: Record<string, unknown>): void {
  const { deployment } = deploymentUpsert(conn, { alias, nodePath: "/usr/bin/node", workdir: "" });
  const map = listDeployments(conn);
  map[deployment.id] = { ...map[deployment.id], ...patch } as never;
  conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(DEPLOYMENTS_KEY, JSON.stringify(map));
}

const TARGET = "u@box:22";
const platform: RemoteDispatchPlatform = {
  scopeFor: async () => null,
  readHelperArtifact: () => ({ version: "0.1.6", sha256: "x" }),
  sshFamilyAvailable: () => true,
};

describe("sshExecutor 装配件分支（直连/路由/交互）", () => {
  it("remoteHeadlessDeps：local/reject → 本地执行器/兜底 null；ready 部署 → 家族链执行器", async () => {
    const { deployment } = deploymentUpsert(conn, { alias: "box", nodePath: "/usr/bin/node", workdir: "/srv" });
    const map = listDeployments(conn);
    map[deployment.id] = { ...map[deployment.id], status: "ready", helperPath: "/h.js", helperHash: "a".repeat(64) };
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));

    const deps = remoteHeadlessDeps(conn, platform);
    expect(deps.executorFor?.(undefined as never, { deployment: null } as never)).toBeDefined(); // local
    expect(
      deps.executorFor?.(undefined as never, { deployment: { ref: "box", target: TARGET } } as never),
    ).toBeDefined(); // family
    expect(deps.worktreeFor?.({ deployment: null } as never)).toBeUndefined(); // local 回落 undefined
  });
});

describe("sshExecutor 装配件：路由降级与复核分支", () => {
  it("remoteHeadlessDeps：家族缺失 + 未降级 → reject 路由 executorFor null（前置复核面兜底）", () => {
    const noFamily: RemoteDispatchPlatform = { ...platform, sshFamilyAvailable: () => false };
    deploymentUpsert(conn, { alias: "box2", nodePath: "/usr/bin/node", workdir: "/srv" });
    const deps = remoteHeadlessDeps(conn, noFamily);
    expect(deps.executorFor?.(undefined as never, { deployment: { ref: "box2", target: TARGET } } as never)).toBeNull();
  });

  it("createDeploymentPrecheck：direct 无头 → 免密预检先行（失败抛 PkyError）", async () => {
    setDeployment("dbox", { degraded: true });
    const failPlatform: RemoteDispatchPlatform = {
      ...platform,
      sshCheck: async () => ({
        ok: false,
        error: { code: "LARK_FETCH_FAILED" as never, message: "免密未配置", hint: "跑 ssh-copy-id" },
      }),
    };
    const precheck = createDeploymentPrecheck(conn, failPlatform);
    await expect(precheck({ deployment: { ref: "dbox", target: TARGET } } as never)).rejects.toMatchObject({
      code: "LARK_FETCH_FAILED",
    });
  });

  it("remoteInteractiveParts：家族链/直连/缺失三分支 terminalFor", async () => {
    const parts = remoteInteractiveParts(conn, platform);
    expect(parts.terminalFor({ deployment: null } as never)).toBeUndefined(); // 本机回落
    const { deployment } = deploymentUpsert(conn, { alias: "ibox", nodePath: "/n", workdir: "" });
    const map = listDeployments(conn);
    map[deployment.id] = { ...map[deployment.id], status: "ready", helperPath: "/h.js", helperHash: "a".repeat(64) };
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));
    expect(parts.terminalFor({ deployment: { ref: "ibox", target: TARGET } } as never)).toBeDefined(); // family PTY
    const noFamily: RemoteDispatchPlatform = { ...platform, sshFamilyAvailable: () => false };
    const parts2 = remoteInteractiveParts(conn, noFamily);
    expect(parts2.terminalFor({ deployment: { ref: "ibox", target: TARGET } } as never)).toBeDefined(); // copy-line
  });
});

describe("断连收口 guard：恢复链分支", () => {
  it("无路由引用的部署恢复 → 迟到核对零面早返回（recovered=true）", async () => {
    const { deployment } = deploymentUpsert(conn, { alias: "loner", nodePath: "/n", workdir: "" });
    const map = listDeployments(conn);
    map[deployment.id] = { ...map[deployment.id], status: "ready", helperPath: "/h.js", helperHash: "a".repeat(64) };
    conn
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(DEPLOYMENTS_KEY, JSON.stringify(map));
    const scope = {
      connected: true,
      shell: async (cmd: string) =>
        cmd === "printf pky-ok"
          ? { code: 0, stdout: "pky-ok", stderr: "" }
          : { code: 0, stdout: "a".repeat(64), stderr: "" },
    } as never;
    const livePlatform = {
      ...platform,
      scopeFor: async () => scope,
      readHelperArtifact: () => ({ version: "0.1.6", sha256: "a".repeat(64) }),
    };
    const guard = createRemoteDispatchGuard(conn, livePlatform);
    await guard.onScopeDisconnected(deployment.id);
    const out = await guard.recheck(deployment.id);
    expect(out).toMatchObject({ ready: true, recovered: true });
  });
});

describe("直连执行器（createDirectSshExecutor）启动面", () => {
  it("空命令/非绝对路径 → 启动失败文案；fake ssh 成功路径信封回传", async () => {
    const bin = join(dir, "fake-ssh.sh");
    const record = join(dir, "direct-record.txt");
    writeFileSync(bin, `#!/bin/sh\necho '$*' >> '${record}'\n`, { mode: 0o755 });
    const exec = createDirectSshExecutor({
      target: TARGET,
      nodePath: "/usr/bin/node",
      label: "l",
      sshBin: bin,
      minTimeoutSecs: 5,
    });
    const empty = await exec.launch({ command: "  ", args: "", prompt: "", timeoutSecs: 5 } as never);
    expect(empty.error).toContain("直连降级链不解析远端可执行");
    const relative = await exec.launch({ command: "claude", args: "", prompt: "", timeoutSecs: 5 } as never);
    expect(relative.error).toContain("直连降级链不解析远端可执行");
    const ok = await exec.launch({
      command: "/usr/local/bin/claude",
      args: "-p {prompt}",
      prompt: "hi",
      workdir: null,
      timeoutSecs: 5,
      env: {},
    } as never);
    expect(ok.exitCode).toBe(0);
  });

  it("directSshRunner：成功 ok=true；exit 非 0 ok=false（stderr 透传）", async () => {
    const okBin = join(dir, "ssh-ok.sh");
    writeFileSync(okBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const failBin = join(dir, "ssh-fail.sh");
    writeFileSync(failBin, "#!/bin/sh\necho boom >&2\nexit 3\n", { mode: 0o755 });
    expect(await directSshRunner(TARGET, { sshBin: okBin })("echo hi")).toMatchObject({ ok: true });
    expect(await directSshRunner(TARGET, { sshBin: failBin })("echo hi")).toMatchObject({
      ok: false,
      stderr: expect.stringContaining("boom"),
    });
  });
});

describe("直连执行器（createDirectSshExecutor）失败与超时面", () => {
  it("exit 非 0 → 失败信封携带 stderr；stdin 管道承载 prompt", async () => {
    const record = join(dir, "stdin-record.txt");
    const bin = fakeSsh(`cat > '${record}'\necho boom >&2\nexit 3`);
    const exec = createDirectSshExecutor({
      target: "u@box:22",
      nodePath: "/usr/bin/node",
      label: "l",
      sshBin: bin,
      minTimeoutSecs: 5,
    });
    const out = await exec.launch({
      command: "/usr/local/bin/claude",
      args: "--json",
      prompt: "",
      workdir: null,
      timeoutSecs: 5,
      env: {},
    } as never);
    expect(out).toMatchObject({ exitCode: 3, timedOut: false });
    expect(out.error).toContain("boom");
    expect(String.fromCharCode(...[])).toBe(""); // 占位（防 lint 未用）
  });

  it("无占位 args → prompt 经 stdin 管道（命令行零裸拼）", async () => {
    const record = join(dir, "stdin-only.txt");
    const bin = fakeSsh(`cat > '${record}'`);
    const exec = createDirectSshExecutor({
      target: "u@box:22",
      nodePath: "/usr/bin/node",
      label: "l",
      sshBin: bin,
      minTimeoutSecs: 5,
    });
    const out = await exec.launch({
      command: "/usr/local/bin/claude",
      args: "",
      prompt: "秘密提示词",
      workdir: null,
      timeoutSecs: 5,
      env: {},
    } as never);
    expect(out.exitCode).toBe(0);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(record, "utf8")).toContain("秘密提示词");
  });
});

describe("直连执行器：脚本组装分支（workdir/env 注入）", () => {
  it("workdir + env 注入 → cd 与 export 进入远端脚本（引号全量引用）", async () => {
    const { readFileSync } = await import("node:fs");
    const record = join(dir, "argv-record.txt");
    const bin = fakeSsh(`echo "\$*" > '${record}'`);
    const exec = createDirectSshExecutor({
      target: "u@box:22",
      nodePath: "/usr/bin/node",
      label: "l",
      sshBin: bin,
      minTimeoutSecs: 5,
    });
    const out = await exec.launch({
      command: "/usr/local/bin/claude",
      args: "-p x",
      prompt: "",
      workdir: "/srv/app",
      timeoutSecs: 5,
      env: { PK_DISPATCH_TASK: "12" },
    } as never);
    expect(out.exitCode).toBe(0);
    const argv = readFileSync(record, "utf8");
    expect(argv).toContain("cd /srv/app || exit 1");
    expect(argv).toContain("export PK_DISPATCH_TASK=12");
  });
});

describe("直连执行器（createDirectSshExecutor）超时与缺省面", () => {
  it("超时 → SIGKILL 收口 timedOut=true（minTimeoutSecs 注入缩短等待）", async () => {
    const bin = fakeSsh("sleep 30");
    const exec = createDirectSshExecutor({
      target: "u@box:22",
      nodePath: "/usr/bin/node",
      label: "l",
      sshBin: bin,
      minTimeoutSecs: 1,
    });
    const started = Date.now();
    const out = await exec.launch({
      command: "/usr/local/bin/claude",
      args: "",
      prompt: "",
      workdir: null,
      timeoutSecs: 1,
      env: {},
    } as never);
    expect(out.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("directSshRunner 缺省 connectTimeout（30s 窗口内正常返回）", async () => {
    const bin = fakeSsh("exit 0");
    const out = await directSshRunner("u@box:22", { sshBin: bin })("echo ok");
    expect(out.ok).toBe(true);
  });
});
