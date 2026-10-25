/**
 * remote/provision：四步幂等状态机（AD §4.5）——免密失败即停、$HOME 探测展开与
 * helperPath 版本段、单步推进、幂等重跑、摘要不符拒绝就绪不降级（D31）+ 强制重装。
 * degradeConfirm 拆件 → provisionDegrade.spec；步③ upload 拆件 → provisionUpload.spec；
 * 夹具 = provisionFx.ts。
 */
import { describe, expect, it } from "vitest";
import {
  PROVISION_STEPS,
  defaultHelperPath,
  initialProvisionState,
  mismatchRecorded,
  provisionRun,
  provisionStatusOf,
  workdirProbeCommand,
  type ProvisionRunResult,
} from "../../src/host/remote/provision";
import { deploymentUpsert, listDeployments } from "../../src/host/remote/deployments";
import { DEFAULT_HELPER_CONTENT, FakeSshScope, fakeProvisionDeps, sha256Of } from "./fakeSshScope";
import { setupProvisionFx } from "./provisionFx";

const fx = setupProvisionFx();
const seedDeployment = (alias = "dev-box") => fx.seedDeployment(alias);
const makeDeps = (scope: FakeSshScope | null, opts: { pluginVersion?: string; helperContent?: string } = {}) =>
  fx.makeDeps(scope, opts);
const runWizard = (id: string, deps: Parameters<typeof fx.runWizard>[1], maxSteps?: number) =>
  fx.runWizard(id, deps, maxSteps);

describe("步① probe-ssh（免密失败即停——Gherkin FR-RD2）", () => {
  it("scope 不可达（null）→ SSH_AUTH_REQUIRED + ssh-copy-id 指引，状态停未就绪可重试", async () => {
    const id = seedDeployment();
    const result = await provisionRun(fx.db.conn, id, makeDeps(null));
    expect(result).toMatchObject({ ok: false, step: "probe-ssh", tag: "SSH_AUTH_REQUIRED" });
    expect(result.hint).toContain("ssh-copy-id");
    const entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("not_ready");
    expect(entity.lastError).toContain("SSH 连接失败");
    expect(result.status.retryable).toBe(true);
    expect(result.status.failedStep).toBe("probe-ssh");
    // 只执行了一步：远端零命令
  });

  it("连接已断开（connected=false）→ 同免密失败语义", async () => {
    const id = seedDeployment();
    const scope = new FakeSshScope();
    scope.simulateDisconnect();
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result.tag).toBe("SSH_AUTH_REQUIRED");
    expect(listDeployments(fx.db.conn)[id].status).toBe("not_ready");
  });

  it("探测命令失败 → SSH_AUTH_REQUIRED（步① 失败统归免密语义）", async () => {
    const id = seedDeployment();
    const scope = new FakeSshScope();
    scope.program(/\$HOME/, { code: 255, stderr: "Permission denied" });
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result.tag).toBe("SSH_AUTH_REQUIRED");
  });

  it("通过 → 状态 probing + 远端 $HOME 持久化（路径展开基准）", async () => {
    const id = seedDeployment();
    const scope = new FakeSshScope();
    scope.homeDir = "/home/pky";
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: true, step: "probe-ssh" });
    const entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("probing");
    expect(entity.provision?.homeDir).toBe("/home/pky");
    expect(entity.provision?.steps["probe-ssh"].status).toBe("ok");
  });
});

describe("步① probe-ssh：登记工作目录存在性", () => {
  it("工作目录在远端不存在 → 步① 失败给改正指引（开通面拦截，不漏到判定/派发误报）", async () => {
    const id = seedDeployment(); // workdir = /srv/app
    const scope = new FakeSshScope();
    scope.program(/^test -d /, { code: 1 });
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "probe-ssh", tag: "PROVISION_STEP_FAILED" });
    expect(result.message).toContain("工作目录在远端不存在：/srv/app");
    expect(result.hint).toContain("留空使用登录目录");
    const entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("not_ready");
    expect(entity.lastError).toContain("工作目录在远端不存在");
  });

  it("工作目录存在 → 探测通过不拦截；留空（登录目录缺省）→ 不探测", async () => {
    const id = seedDeployment();
    const scope = new FakeSshScope();
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: true, step: "probe-ssh" });
    expect(scope.commands).toContain(workdirProbeCommand("/srv/app"));
    const emptyId = deploymentUpsert(fx.db.conn, { alias: "dev-empty", nodePath: "/usr/local/bin/node", workdir: "" })
      .deployment.id;
    const emptyScope = new FakeSshScope();
    const emptyResult = await provisionRun(fx.db.conn, emptyId, makeDeps(emptyScope));
    expect(emptyResult).toMatchObject({ ok: true, step: "probe-ssh" });
    expect(emptyScope.commands.some((c) => c.startsWith("test -d "))).toBe(false);
  });
});

/** 步进至 probing（步① 已完成）——步②③ 用例共用起点 */
async function seedAtProbing(scope: FakeSshScope): Promise<string> {
  const id = seedDeployment();
  await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步①
  return id;
}

describe("步② probe-node", () => {
  it("node 探测失败 → PROVISION_STEP_FAILED(step=probe-node) + 安装指引；步① 不重跑", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope);
    scope.program(/ --version$/, { code: 127, stderr: "not found" });
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "probe-node", tag: "PROVISION_STEP_FAILED" });
    expect(result.hint).toContain("Node");
    expect(listDeployments(fx.db.conn)[id].status).toBe("not_ready");
    // 幂等重跑：步① 已完成跳过（无新的 $HOME 探测命令）
    const before = scope.commands.length;
    await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(scope.commands.slice(before).some((c) => c === 'printf %s "$HOME"')).toBe(false);
  });
});

describe("步② probe-node：通过路径", () => {
  it("node 探测通过 → installing", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope);
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: true, step: "probe-node" });
    expect(listDeployments(fx.db.conn)[id].status).toBe("installing");
  });
});

describe("步④ verify 与全链状态机", () => {
  it("全链四步 → ready + helperHash = 权威摘要（运行时计算）", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    const statuses: string[] = [];
    const results: ProvisionRunResult[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
      results.push(result);
      statuses.push(listDeployments(fx.db.conn)[id].status);
      if (result.step === null) {
        break;
      }
    }
    expect(results.map((r) => r.step)).toEqual(["probe-ssh", "probe-node", "upload", "verify", null]);
    expect(results.slice(0, 4).every((r) => r.ok)).toBe(true);
    const entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("ready");
    expect(entity.helperHash).toBe(sha256Of(DEFAULT_HELPER_CONTENT));
    expect(entity.lastError).toBeNull();
    expect(entity.degraded).toBe(false);
    // 状态轨迹（SDD §3.3）：draft → probing → installing → installing → ready
    expect(statuses).toEqual(["probing", "installing", "installing", "ready", "ready"]);
  });

  it("全部完成后重跑 → 幂等无操作（step=null，零新远端命令）", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    await runWizard(id, makeDeps(scope));
    const before = scope.commands.length;
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result.step).toBeNull();
    expect(result.ok).toBe(true);
    expect(scope.commands.length).toBe(before);
    expect(result.status.done).toBe(true);
  });

  it("sha256sum 执行失败（远端缺工具）→ PROVISION_STEP_FAILED(step=verify)", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    await runWizard(id, makeDeps(scope), 3); // 到 upload 完成
    scope.program(/^sha256sum/, { code: 127, stderr: "command not found" });
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "verify", tag: "PROVISION_STEP_FAILED" });
  });
});

describe("步④ verify：摘要不符与版本漂移（D31 拒绝就绪）", () => {
  it("摘要不符 → HELPER_HASH_MISMATCH，拒绝就绪不降级（D31），强制重装后恢复", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    await runWizard(id, makeDeps(scope), 3); // ①②③ 完成
    scope.files.set(defaultHelperPath("/home/dev", "0.1.0"), "tampered-artifact"); // 远端被篡改
    const mismatch = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(mismatch).toMatchObject({ ok: false, step: "verify", tag: "HELPER_HASH_MISMATCH" });
    expect(mismatch.hint).toContain("重新安装");
    let entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("not_ready");
    expect(entity.helperHash).toBeNull();
    expect(entity.degraded).toBe(false); // 不降级直连
    expect(mismatchRecorded(entity)).toBe(true);
    // upload 被重置：下一轮重跑只重执行 upload→verify（①② 不重复发命令）
    const before = scope.commands.length;
    const rest = await runWizard(id, makeDeps(scope), 3);
    expect(rest.map((r) => r.step)).toEqual(["upload", "verify", null]);
    const newCommands = scope.commands.slice(before);
    expect(newCommands.some((c) => c === 'printf %s "$HOME"')).toBe(false);
    expect(newCommands.some((c) => c.endsWith(" --version"))).toBe(false);
    expect(newCommands.some((c) => c.includes(" install --prefix "))).toBe(true);
    entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("ready");
    expect(entity.helperHash).toBe(sha256Of(DEFAULT_HELPER_CONTENT));
  });

  it("制品版本漂移（本地更新）→ verify 权威源比对检出不符 → 重装后一致", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    await runWizard(id, makeDeps(scope), 3);
    const drifted = fakeProvisionDeps(async () => scope, { helperContent: "NEW_ARTIFACT" });
    const result = await provisionRun(fx.db.conn, id, drifted); // 旧远端闭包 vs 新本地制品
    expect(result.tag).toBe("HELPER_HASH_MISMATCH");
    scope.installedHelperContent = "NEW_ARTIFACT"; // 重装 = npm 拉到与本地闭包匹配的新版本
    const rest = await runWizard(id, drifted, 3); // 重装新闭包
    expect(rest.map((r) => r.step)).toEqual(["upload", "verify", null]);
    expect(listDeployments(fx.db.conn)[id].helperHash).toBe(sha256Of("NEW_ARTIFACT"));
  });
});

describe("restart 重跑语义（helper 卸载恢复——破全 ok 短路死锁）", () => {
  it("全 ok + restart → 重置后从步① 重跑（helperHash 清空 = 直连路由前提），全链恢复 ready", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    await runWizard(id, makeDeps(scope)); // 四步全 ok → ready + helperHash 落定
    scope.files.delete(defaultHelperPath("/home/dev", "0.1.0")); // 模拟远端 helper 被卸载
    // 无 restart：全 ok 短路成无操作（原死锁起点）
    const noop = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(noop.step).toBeNull();
    // restart：重置 provision 态 + helperHash，从步① 重跑
    const before = scope.commands.length;
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope), { restart: true });
    expect(result).toMatchObject({ ok: true, step: "probe-ssh" });
    expect(scope.commands.slice(before).some((c) => c === 'printf %s "$HOME"')).toBe(true);
    let entity = listDeployments(fx.db.conn)[id];
    expect(entity.helperHash).toBeNull();
    expect(entity.degraded).toBe(false);
    expect(entity.provision?.steps["probe-ssh"].status).toBe("ok");
    // 重装续跑至收敛：upload 重装 helper → verify 通过 → ready + 摘要回填
    const rest = await runWizard(id, makeDeps(scope));
    expect(rest.map((r) => r.step)).toEqual(["probe-node", "upload", "verify", null]);
    entity = listDeployments(fx.db.conn)[id];
    expect(entity.status).toBe("ready");
    expect(entity.helperHash).toBe(sha256Of(DEFAULT_HELPER_CONTENT));
  });

  it("步骤未全 ok + restart → 不重置（幂等续跑语义不变，已完成步不重跑）", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope); // ① ok、② pending
    const before = scope.commands.length;
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope), { restart: true });
    expect(result).toMatchObject({ ok: true, step: "probe-node" }); // 续跑② 而非重置回①
    expect(scope.commands.slice(before).some((c) => c === 'printf %s "$HOME"')).toBe(false);
    expect(listDeployments(fx.db.conn)[id].provision?.steps["probe-ssh"].status).toBe("ok");
  });
});

describe("provisionStatus 视图", () => {
  it("未开通 → 四步全 pending、不可重试、未完成", () => {
    const id = seedDeployment();
    const status = provisionStatusOf(listDeployments(fx.db.conn)[id]);
    expect(status.steps.map((s) => s.step)).toEqual([...PROVISION_STEPS]);
    expect(status.steps.every((s) => s.status === "pending")).toBe(true);
    expect(status).toMatchObject({ failedStep: null, retryable: false, done: false });
  });

  it("失败步呈现 + 中断处标记", async () => {
    const scope = new FakeSshScope();
    const id = seedDeployment();
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // ①
    scope.program(/ --version$/, { code: 127 });
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // ② 失败
    const status = provisionStatusOf(listDeployments(fx.db.conn)[id]);
    expect(status.steps.find((s) => s.step === "probe-ssh")?.status).toBe("ok");
    expect(status.steps.find((s) => s.step === "probe-node")?.status).toBe("failed");
    expect(status.failedStep).toBe("probe-node");
    expect(status.retryable).toBe(true);
    expect(status.done).toBe(false);
  });

  it("initialProvisionState：四步键齐备", () => {
    const state = initialProvisionState();
    expect(Object.keys(state.steps).sort()).toEqual([...PROVISION_STEPS].sort());
    expect(state.homeDir).toBeNull();
  });
});
