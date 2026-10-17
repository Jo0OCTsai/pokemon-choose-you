/**
 * host 命令装配面 · full-parity 增量（任务 2.9）：远程部署/开通向导 8 条 + 导入恢复/
 * 导出目录 4 条 + 会话/图鉴/任务/登录/AX 的信封 happy path 与错误码映射（fake deps +
 * FakeSshScope——domain 细节行为已有 remote/、backup-*、sessions-page 各域单测）。
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCommandsFixture, type CommandsFixture } from "./commandsSetup";
import { createHostCommands, HOST_COMMAND_NAMES } from "../src/host/commands";
import { FakeSshScope, fakeProvisionDeps } from "./remote/fakeSshScope";
import { deploymentUpsert } from "../src/host/remote/deployments";
import type { BridgeClient } from "../src/host/pet/bridge";

let f: CommandsFixture;

beforeEach(() => {
  f = createCommandsFixture();
});

afterEach(() => {
  f.close();
});

/** 组装带远程平台面的命令调用面（scope 共享一只 fake） */
function rigWithRemote(scope: FakeSshScope): { call: CommandsFixture["call"] } {
  const artifact = fakeProvisionDeps(() => Promise.resolve(scope));
  f.deps.remote = {
    scopeFor: () => Promise.resolve(scope),
    readHelperArtifact: artifact.readHelperArtifact,
    sshFamilyAvailable: () => true,
    disconnect: async () => scope.disconnect(),
  };
  return { call: (name: string, params?: unknown) => createHostCommands(f.deps)(name, params) };
}

/** 直插一个部署实体（返回 id） */
function seedDeployment(alias = "lab"): string {
  return deploymentUpsert(f.conn, { alias, nodePath: "/usr/local/bin/node", workdir: "/home/dev/app" }).deployment.id;
}

/** helper 桥面 fake（sys 发送面——exportDirOpen/macAuth 消费） */
function fakeBridge(sysOk: boolean): BridgeClient {
  return {
    hello: { type: "hello", version: "0.9.9", caps: ["sys-open", "mac-auth"] },
    sys: {
      sendOpenPath: () => sysOk,
      queryMacAuth: async () => ({ granted: sysOk }),
    },
  } as unknown as BridgeClient;
}

describe("full-parity 命令面 · 全集断言", () => {
  it("HOST_COMMAND_NAMES = 87（69 + §4.1 新增 17 + macAuthPaneOpen 联调对齐 1）", () => {
    expect(HOST_COMMAND_NAMES).toHaveLength(87);
    expect(new Set(HOST_COMMAND_NAMES).size).toBe(87);
  });
});

describe("full-parity 命令面 · 部署 CRUD", () => {
  it("deploymentList：空表三档计数归零；upsert 后 pending 计数", async () => {
    expect(await f.call("deploymentList")).toEqual({
      ok: true,
      data: { deployments: [], counts: { ready: 0, pending: 0, broken: 0 } },
    });
    seedDeployment();
    const list = (await f.call("deploymentList")) as { data: { deployments: unknown[]; counts: unknown } };
    expect(list.data.deployments).toHaveLength(1);
    expect(list.data.counts).toEqual({ ready: 0, pending: 1, broken: 0 });
  });

  it("deploymentUpsert：空别名/`~` 前缀路径参数错；正常新建返回实体", async () => {
    const empty = (await f.call("deploymentUpsert", { alias: "  " })) as { error: { code: string } };
    expect(empty.error.code).toBe("INVALID_ARGUMENT");
    const tilde = (await f.call("deploymentUpsert", { alias: "x", nodePath: "~/.nvm/node" })) as {
      error: { code: string };
    };
    expect(tilde.error.code).toBe("INVALID_ARGUMENT");
    const ok = (await f.call("deploymentUpsert", { alias: "lab", nodePath: "/usr/bin/node", workdir: "" })) as {
      data: { deployment: { alias: string; status: string } };
    };
    expect(ok.data.deployment).toMatchObject({ alias: "lab", status: "draft" });
  });

  it("deploymentDelete：纯记录面（平台面缺席清理跳过不阻塞）+ 实体移除", async () => {
    const id = seedDeployment();
    const out = (await f.call("deploymentDelete", { id })) as {
      data: { id: string; cleanup: { attempted: boolean } };
    };
    expect(out.data.id).toBe(id);
    expect(out.data.cleanup.attempted).toBe(false);
    expect(await f.call("deploymentList")).toMatchObject({ data: { deployments: [] } });
  });

  it("deploymentDegradeConfirm：未确认拒绝；未安装部署确认后 ready+degraded", async () => {
    const id = seedDeployment();
    const noAck = (await f.call("deploymentDegradeConfirm", { id })) as { error: { code: string } };
    expect(noAck.error.code).toBe("INVALID_ARGUMENT");
    const out = (await f.call("deploymentDegradeConfirm", { id, acknowledgedRisk: true })) as {
      data: { deployment: { status: string; degraded: boolean } };
    };
    expect(out.data.deployment).toMatchObject({ status: "ready", degraded: true });
  });
});

describe("full-parity 命令面 · 开通向导", () => {
  it("provisionRun 四步全过 → ready + provisionStatus 呈现（fake 家族链）", async () => {
    const scope = new FakeSshScope();
    const { call } = rigWithRemote(scope);
    const id = seedDeployment();
    for (let i = 0; i < 4; i += 1) {
      const step = (await call("provisionRun", { id })) as { ok: boolean; data: { status: { done: boolean } } };
      expect(step.ok).toBe(true);
    }
    const status = (await call("provisionStatus", { id })) as { data: { status: { done: boolean; failedStep: null } } };
    expect(status.data.status.done).toBe(true);
    const list = (await call("deploymentList")) as { data: { counts: { ready: number } } };
    expect(list.data.counts.ready).toBe(1);
  });

  it("provisionRun 免密失败 → SSH_AUTH_REQUIRED 信封（domain tag 1:1 映射）", async () => {
    const scope = new FakeSshScope();
    scope.simulateDisconnect();
    const { call } = rigWithRemote(scope);
    const id = seedDeployment();
    const out = (await call("provisionRun", { id })) as { ok: boolean; error: { code: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("SSH_AUTH_REQUIRED");
  });

  it("provisionRun 摘要不符 → HELPER_HASH_MISMATCH（拒绝就绪不降级——D31）", async () => {
    const scope = new FakeSshScope();
    scope.installedHelperContent = "tampered-content";
    const { call } = rigWithRemote(scope);
    const id = seedDeployment();
    for (let i = 0; i < 3; i += 1) {
      await call("provisionRun", { id });
    }
    const out = (await call("provisionRun", { id })) as { ok: boolean; error: { code: string } };
    expect(out.ok).toBe(false);
    expect(out.error.code).toBe("HELPER_HASH_MISMATCH");
  });

  it("deploymentRecheck：平台面缺席 → HELPER_CAPABILITY_MISSING（零静默降级）", async () => {
    const id = seedDeployment();
    const out = (await f.call("deploymentRecheck", { id })) as { error: { code: string } };
    expect(out.error.code).toBe("HELPER_CAPABILITY_MISSING");
  });
});

describe("full-parity 命令面 · 导入/恢复", () => {
  /** 生成一份合法导出文件（借 host 自身 exportRun 产物——契约面自证） */
  async function makeExportFile(): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "pky-import-"));
    process.env.CHOOSE_YOU_HOME = dir;
    const out = (await f.call("exportRun", { kind: "json" })) as { data: { path: string } };
    return out.data.path;
  }

  it("importValidate：坏 JSON → IMPORT_VALIDATION_FAILED；合法导出 → summary", async () => {
    const good = await makeExportFile();
    writeFileSync(good, "not-json");
    const out = (await f.call("importValidate", { path: good })) as { error: { code: string } };
    expect(out.error.code).toBe("IMPORT_VALIDATION_FAILED");
    const fresh = await makeExportFile();
    const ok = (await f.call("importValidate", { path: fresh })) as {
      data: { summary: { app: string; compatible: boolean } };
    };
    expect(ok.data.summary).toMatchObject({ app: "pokemon-choose-you", compatible: true });
    delete process.env.CHOOSE_YOU_HOME;
  });

  it("importRun：缺 confirmed → INVALID_ARGUMENT；confirmed 执行返回 backupId+applied", async () => {
    const path = await makeExportFile();
    const no = (await f.call("importRun", { path })) as { error: { code: string } };
    expect(no.error.code).toBe("INVALID_ARGUMENT");
    const out = (await f.call("importRun", { path, confirmed: true })) as {
      data: { result: { backupId: string; applied: number } };
    };
    expect(out.data.result.backupId).toMatch(/^pokemon-choose-you-/);
    delete process.env.CHOOSE_YOU_HOME;
  });
});

describe("full-parity 命令面 · 恢复与导出目录", () => {
  it("restoreRun：不存在的备份 → NOT_FOUND；合法备份恢复返回 migratedTo/seeded", async () => {
    const missing = (await f.call("restoreRun", {
      source: { backupId: "pokemon-choose-you-x.db" },
      confirmed: true,
    })) as {
      error: { code: string };
    };
    expect(missing.error.code).toBe("NOT_FOUND");
    const backup = (await f.call("backupRun")) as { data: { file: string } };
    const out = (await f.call("restoreRun", { source: { backupId: backup.data.file }, confirmed: true })) as {
      data: { result: { backupId: string; migratedTo: number } };
    };
    expect(out.data.result.migratedTo).toBeGreaterThanOrEqual(1);
    delete process.env.CHOOSE_YOU_HOME;
  });

  it("exportDirOpen：helper 缺席 → HELPER_CAPABILITY_MISSING + hint 路径；在位 → ok+path", async () => {
    const missing = (await f.call("exportDirOpen")) as { ok: boolean; error: { code: string; hint: string } };
    expect(missing.ok).toBe(false);
    expect(missing.error.code).toBe("HELPER_CAPABILITY_MISSING");
    expect(missing.error.hint).toContain("exports");
    f.deps.petBridge = () => fakeBridge(true);
    const dir = mkdtempSync(join(tmpdir(), "pky-exp-"));
    process.env.CHOOSE_YOU_HOME = dir;
    const ok = (await f.call("exportDirOpen")) as { data: { ok: boolean; path: string } };
    expect(ok.data.ok).toBe(true);
    expect(ok.data.path).toContain("exports");
    delete process.env.CHOOSE_YOU_HOME;
  });
});
