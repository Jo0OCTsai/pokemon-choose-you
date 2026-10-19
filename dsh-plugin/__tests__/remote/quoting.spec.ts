/**
 * NFR-11④ 引号全量引用静态断言：遍历 remote/ 全部远端命令组装路径（provision 四步
 * （步③ npm 闭包安装——spike 修正 C）+ recheck 活性/摘要 + deployments 自清理），
 * 逐条断言插值参数经 posixQuote 包裹（对抗样例：空格/单引号/分号/`$`/反引号）；
 * `~` 前置不变式（实体路径永不含 `~`，posixQuote 永不与 `~` 展开叠加——
 * deploymentUpsert 拒收 + 落库实体复扫）；别名永不进命令组装面（经连接配置承载）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { posixQuote } from "../../src/host/dispatch/cmdline";
import {
  defaultHelperPath,
  homeProbeCommand,
  installDirFromHelperPath,
  npmInstallCommand,
  npmProbeCommand,
  probeNodeCommand,
  provisionRun,
  sha256Command,
  sshFamilySpec,
} from "../../src/host/remote/provision";
import { livenessCommand, recheckDeployment } from "../../src/host/remote/recheck";
import { cleanupCommand, deploymentUpsert, listDeployments } from "../../src/host/remote/deployments";
import { createTestDb, type TestDb } from "../helpers";
import { DEFAULT_HELPER_CONTENT, FakeSshScope, sha256Of } from "./fakeSshScope";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => {
  db.close();
});

/** 对抗样例：空格 / 单引号 / 双引号 / 分号 / `$` / 反引号 / 换行 / 中文（安全字符集外全量引用） */
const ADVERSARIAL = [
  "/opt/my node/bin/node",
  "/opt/n'de/bin/node",
  '/opt/n"de/bin/node',
  "/opt/a;rm -rf /",
  "/opt/a$(reboot)/node",
  "/opt/a`id`/node",
  "/opt/a\nb/node",
  "/opt/节点/bin/node",
];

/** 直插部署实体种子（对抗测试：敌意数据不经 upsert 校验直接落库） */
function seedDeploymentRaw(id: string, alias: string): void {
  db.conn.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    "dsh:deployments",
    JSON.stringify({
      [id]: {
        id,
        alias,
        nodePath: "/usr/bin/node",
        helperPath: "",
        helperHash: null,
        workdir: "",
        note: "",
        status: "draft",
        lastError: null,
        provision: null,
        degraded: false,
        pkTunnel: null,
      },
    }),
  );
}

describe("组装函数逐条引用断言（posixQuote 单点）", () => {
  it("probeNodeCommand：<nodePath> --version 逐参引用（黄金串精确匹配）", () => {
    for (const sample of ADVERSARIAL) {
      expect(probeNodeCommand(sample)).toBe(`${posixQuote(sample)} --version`);
      expect(probeNodeCommand(sample)).toContain(posixQuote(sample));
    }
  });

  it("npmInstallCommand：PATH 前缀 + npmPath / installDir / pkgSpec 四参逐条引用（黄金串精确匹配）", () => {
    const specs = [sshFamilySpec("0.1.6-alpha.1"), sshFamilySpec("0.1.6-alpha.1-beta+2")];
    for (const sample of [...ADVERSARIAL, "/usr/bin/npm"]) {
      for (const dir of [...ADVERSARIAL, "/home/dev user/.dsh-helper/pky-0.1.0"]) {
        for (const node of [...ADVERSARIAL, "/usr/local/bin/node"]) {
          for (const spec of specs) {
            expect(npmInstallCommand(sample, dir, spec, node)).toBe(
              `PATH=${posixQuote(node.slice(0, node.lastIndexOf("/")))}:$PATH ${posixQuote(sample)} install --prefix ${posixQuote(dir)} ${posixQuote(spec)}`,
            );
          }
        }
      }
    }
  });
});

describe("组装函数逐条引用断言（续：摘要与自清理）", () => {
  it("sha256Command / cleanupCommand：路径参数逐条引用（cleanup 剥离闭包布局后缀指向安装目录）", () => {
    for (const sample of ADVERSARIAL) {
      expect(sha256Command(sample)).toBe(`sha256sum ${posixQuote(sample)}`);
      const dir = sample.slice(0, sample.lastIndexOf("/")); // 自清理目标 = dirname（非闭包布局回落）
      expect(cleanupCommand(sample)).toBe(`rm -rf -- ${posixQuote(dir)}`);
    }
    // dirname 语义：自清理目标是 helperPath 的托管目录
    expect(cleanupCommand("/home/dev user/.dsh-helper/pky-helper-0.1.0.js")).toBe(
      `rm -rf -- ${posixQuote("/home/dev user/.dsh-helper")}`,
    );
    // 闭包布局（npm 安装，spike 修正 C）：剥离 node_modules 后缀 → 安装目录整树清理
    expect(cleanupCommand(defaultHelperPath("/home/dev user", "0.1.0"))).toBe(
      `rm -rf -- ${posixQuote("/home/dev user/.dsh-helper/pky-0.1.0")}`,
    );
    expect(installDirFromHelperPath(defaultHelperPath("/home/dev", "0.1.0"))).toBe("/home/dev/.dsh-helper/pky-0.1.0");
  });

  it("npmProbeCommand：node 同目录 sibling 优先 + command -v 回落（dirname 逐条引用，黄金串精确匹配）", () => {
    for (const sample of [...ADVERSARIAL, "/usr/local/bin/node"]) {
      const dir = sample.slice(0, sample.lastIndexOf("/"));
      const sibling = `${posixQuote(dir)}/npm`;
      expect(npmProbeCommand(sample)).toBe(`if [ -x ${sibling} ]; then printf %s ${sibling}; else command -v npm; fi`);
    }
    // nodePath 就在根目录的退化形态（dirname = /，不落空串）
    expect(npmProbeCommand("/node")).toBe("if [ -x /npm ]; then printf %s /npm; else command -v npm; fi");
  });

  it("零插值命令为固定串（homeProbe / liveness）：永不拼接外部输入", () => {
    expect(homeProbeCommand()).toBe('printf %s "$HOME"');
    expect(livenessCommand()).toBe("printf pky-ok");
  });

  it("对抗样例的引用形态确为包裹（安全字符集外必带单引号包裹）", () => {
    for (const sample of ADVERSARIAL) {
      const quoted = posixQuote(sample);
      expect(quoted).not.toBe(sample); // 全部样例落在安全字符集外 → 必须被包裹
      expect(quoted.startsWith("'")).toBe(true);
      expect(quoted.endsWith("'")).toBe(true);
    }
  });
});

/** 开通全链跑至 ready（四步 + 幂等收尾；对抗路径由 fake 按 unquote 解析回） */
async function runProvisionToReady(scope: FakeSshScope, deploymentId: string): Promise<void> {
  const deps = {
    scopeFor: async () => scope,
    readHelperArtifact: () => ({ version: "0.1.6-alpha.1", sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
    pluginVersion: "0.1.0",
  };
  for (let i = 0; i < 5; i += 1) {
    if ((await provisionRun(db.conn, deploymentId, deps)).step === null) {
      break;
    }
  }
}

describe("全流程组装面复核（fake 远端命令记录逐条断言）", () => {
  it("对抗 nodePath + 含空格 $HOME 的开通全链：每条命令与黄金串精确相等、注入语义失效", async () => {
    const nodePath = "/opt/my node;rm -rf /bin/node";
    const scope = new FakeSshScope();
    scope.homeDir = "/home/dev user";
    const { deployment } = deploymentUpsert(db.conn, { alias: "dev-box", nodePath, workdir: "/srv/a b" });
    await runProvisionToReady(scope, deployment.id);
    const entity = listDeployments(db.conn)[deployment.id];
    expect(entity.status).toBe("ready"); // 含空格 HOME + 对抗 nodePath 全链走通（fake 按 unquote 解析回路径）
    const helperPath = defaultHelperPath("/home/dev user", "0.1.0");
    // 逐条断言：命令与黄金串精确相等（posixQuote 包裹，无裸拼）
    expect(scope.commands).toContain(`printf %s "$HOME"`);
    expect(scope.commands).toContain(probeNodeCommand(nodePath));
    expect(scope.commands).toContain(npmProbeCommand(nodePath));
    expect(scope.commands).toContain(
      npmInstallCommand(
        "/usr/bin/npm",
        "/home/dev user/.dsh-helper/pky-0.1.0",
        sshFamilySpec("0.1.6-alpha.1"),
        nodePath,
      ),
    );
    expect(scope.commands).toContain(sha256Command(helperPath));
    // 注入面：未引用的对抗片段不作为独立 token 出现（分号注入段不裸在命令串外层）
    for (const cmd of scope.commands) {
      expect(cmd).not.toMatch(/;rm -rf \/bin\/node(?!')/); // 只允许出现在引号包裹内（黄金串已覆盖）
    }
    // 复核链路同样走引用组装
    await recheckDeployment(db.conn, deployment.id, {
      scopeFor: async () => scope,
      readHelperArtifact: () => ({ sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
    });
    expect(scope.commands.filter((c) => c === sha256Command(helperPath)).length).toBeGreaterThanOrEqual(2);
  });

  it("别名永不进命令组装面（对抗别名注入样本零泄漏）", async () => {
    const evilAlias = "dev;rm -rf /box";
    const scope = new FakeSshScope();
    seedDeploymentRaw("dep-evil", evilAlias);
    await runProvisionToReady(scope, "dep-evil");
    expect(listDeployments(db.conn)["dep-evil"].status).toBe("ready");
    for (const cmd of scope.commands) {
      expect(cmd).not.toContain(evilAlias); // alias 经连接配置（scope 装配）承载，不进命令串
    }
  });
});

describe("`~` 前置不变式（posixQuote 永不与 `~` 展开叠加）", () => {
  it("upsert 拒收 `~` 前缀路径（nodePath/workdir）；helperPath 由展开后 $HOME 生成", async () => {
    expect(() => deploymentUpsert(db.conn, { alias: "a", nodePath: "~/bin/node", workdir: "" })).toThrowError(/~/);
    expect(() => deploymentUpsert(db.conn, { alias: "a", nodePath: "/bin/node", workdir: "~/app" })).toThrowError(/~/);
    const scope = new FakeSshScope();
    scope.homeDir = "/home/pky";
    const { deployment } = deploymentUpsert(db.conn, { alias: "ok", nodePath: "/usr/bin/node", workdir: "/srv" });
    const deps = {
      scopeFor: async () => scope,
      readHelperArtifact: () => ({ version: "0.1.6-alpha.1", sha256: sha256Of(DEFAULT_HELPER_CONTENT) }),
      pluginVersion: "0.1.0",
    };
    for (let i = 0; i < 5; i += 1) {
      if ((await provisionRun(db.conn, deployment.id, deps)).step === null) {
        break;
      }
    }
    const entity = listDeployments(db.conn)[deployment.id];
    // 实体路径三元组永不含 `~` 前缀（全部展开后绝对路径）
    for (const path of [entity.nodePath, entity.workdir, entity.helperPath]) {
      expect(path.startsWith("~")).toBe(false);
      if (path !== "") {
        expect(path.startsWith("/")).toBe(true);
      }
    }
    expect(entity.helperPath).toBe("/home/pky/.dsh-helper/pky-0.1.0/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js");
  });
});
