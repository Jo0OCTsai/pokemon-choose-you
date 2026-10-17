/**
 * remote/provision 步③ upload（runtime 闭包安装，spike 修正 C）：npm 探测路径
 * （node 同目录 sibling 优先 + command -v 回落——远端非交互 shell 无 nvm PATH）、
 * 安装命令黄金串、失败路径（探测/安装/制品读取）。从 provision.spec 拆出——棘轮
 * max-lines，等量迁移；夹具 = provisionFx.ts。
 */
import { describe, expect, it } from "vitest";
import {
  defaultHelperPath,
  npmInstallCommand,
  npmProbeCommand,
  provisionRun,
  sshFamilySpec,
} from "../../src/host/remote/provision";
import { listDeployments } from "../../src/host/remote/deployments";
import { DEFAULT_HELPER_CONTENT, FakeSshScope, fakeProvisionDeps } from "./fakeSshScope";
import { setupProvisionFx } from "./provisionFx";

const fx = setupProvisionFx();
const seedDeployment = () => fx.seedDeployment();
const makeDeps = (scope: FakeSshScope | null) => fx.makeDeps(scope);

/** 步进至 probing（步① 已完成）——本文件用例共用起点 */
async function seedAtProbing(scope: FakeSshScope): Promise<string> {
  const id = seedDeployment();
  await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步①
  return id;
}

describe("步③ upload（runtime 闭包安装，spike 修正 C）", () => {
  it("npm 探测 + install --prefix 引号引用；缺省 helperPath = <安装目录>/node_modules/…/lib/helper.js", async () => {
    const scope = new FakeSshScope();
    scope.homeDir = "/home/pky";
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步③
    expect(result).toMatchObject({ ok: true, step: "upload" });
    const installDir = "/home/pky/.dsh-helper/pky-0.1.0";
    const expectedPath = `${installDir}/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js`;
    expect(defaultHelperPath("/home/pky", "0.1.0")).toBe(expectedPath);
    // npm 探测（sibling 优先 + command -v 回落）+ 安装两条命令；安装命令黄金串（引号全量引用）
    expect(scope.commands).toContain(npmProbeCommand("/usr/local/bin/node"));
    expect(scope.commands).toContain(
      npmInstallCommand("/usr/bin/npm", installDir, sshFamilySpec("0.1.6-alpha.1"), "/usr/local/bin/node"),
    );
    expect(scope.npmInstalls).toHaveLength(1);
    expect(scope.npmInstalls[0]).toMatchObject({
      npmPath: "/usr/bin/npm",
      installDir,
      pkgSpec: "@deepseek-ai/dsh-ssh@0.1.6-alpha.1",
    });
    // 闭包布局落盘：安装目录出现 helper 入口（verify 自洽面）
    expect(scope.files.get(expectedPath)).toBe(DEFAULT_HELPER_CONTENT);
    const entity = listDeployments(fx.db.conn)[id];
    expect(entity.helperPath).toBe(expectedPath);
    expect(entity.provision?.steps.upload.status).toBe("ok");
  });

  it("node 同目录 sibling npm 在场 → 探测优先应答 sibling 路径（远端非交互 shell 无 nvm PATH）", async () => {
    const scope = new FakeSshScope();
    scope.siblingNpmInstalled = true;
    scope.homeDir = "/home/pky";
    const id = seedDeployment(); // nodePath = /usr/local/bin/node → sibling /usr/local/bin/npm
    await fx.runWizard(id, makeDeps(scope), 3); // ①②③
    expect(scope.npmInstalls).toHaveLength(1);
    expect(scope.npmInstalls[0].npmPath).toBe("/usr/local/bin/npm"); // 不是回落的 /usr/bin/npm
    expect(listDeployments(fx.db.conn)[id].status).toBe("installing");
  });

  it("npm 探测输出含空格路径（sibling 分支）→ 按行解析整路径（首段截断防护）", async () => {
    const scope = new FakeSshScope();
    scope.program(/^if \[ -x .*\/npm \]; then printf %s/, { code: 0, stdout: "/opt/my node/bin/npm\n" });
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步③ 探测过 → 安装用整路径
    expect(result).toMatchObject({ ok: true, step: "upload" });
    expect(scope.npmInstalls[0].npmPath).toBe("/opt/my node/bin/npm");
  });
});

describe("步③ upload：安装命令形态（真机暴露面的回归锁）", () => {
  it("npm 安装命令带 PATH=<node bin> 前缀（npm shebang `env node` 在非交互 shell 缺 PATH——真机实测修复面）", async () => {
    const scope = new FakeSshScope();
    scope.homeDir = "/home/pky";
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步③
    expect(result).toMatchObject({ ok: true, step: "upload" });
    expect(scope.npmInstalls[0].command.startsWith("PATH=/usr/local/bin:$PATH ")).toBe(true);
  });
});

describe("步③ upload：失败路径", () => {
  it("远端 npm 探测失败（未安装）→ PROVISION_STEP_FAILED(step=upload) + registry hint", async () => {
    const scope = new FakeSshScope();
    scope.program(/^if \[ -x .*\/npm \]; then printf %s/, { code: 127, stderr: "not found" });
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "upload", tag: "PROVISION_STEP_FAILED" });
    expect(result.hint).toContain("npm registry");
    expect(listDeployments(fx.db.conn)[id].status).toBe("not_ready");
  });

  it("npm 探测输出非绝对路径（相对/空）→ 同步失败语义", async () => {
    const scope = new FakeSshScope();
    scope.program(/^if \[ -x .*\/npm \]; then printf %s/, { code: 0, stdout: "npm" });
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "upload", tag: "PROVISION_STEP_FAILED" });
  });

  it("npm install 失败（网络不可达 registry）→ PROVISION_STEP_FAILED(step=upload) + registry hint", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    scope.program(/ install --prefix /, { code: 1, stderr: "network unreachable" });
    const result = await provisionRun(fx.db.conn, id, makeDeps(scope));
    expect(result).toMatchObject({ ok: false, step: "upload", tag: "PROVISION_STEP_FAILED" });
    expect(result.message).toContain("npm 闭包安装失败");
    expect(result.hint).toContain("npm registry");
    expect(listDeployments(fx.db.conn)[id].status).toBe("not_ready");
  });

  it("本地制品读取失败 → upload 步失败", async () => {
    const scope = new FakeSshScope();
    const id = await seedAtProbing(scope);
    await provisionRun(fx.db.conn, id, makeDeps(scope)); // 步②
    const deps = fakeProvisionDeps(async () => scope);
    deps.readHelperArtifact = () => {
      throw new Error("ENOENT lib/helper.js");
    };
    const result = await provisionRun(fx.db.conn, id, deps);
    expect(result).toMatchObject({ ok: false, step: "upload", tag: "PROVISION_STEP_FAILED" });
    expect(result.message).toContain("制品读取失败");
  });
});
