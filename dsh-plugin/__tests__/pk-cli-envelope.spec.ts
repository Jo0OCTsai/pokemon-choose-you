/**
 * CLI 信封契约回放（对齐 src-tauri/tests/cli_envelope.rs oracle 的 TS 侧）：
 * 现场 esbuild 打包 src/pk/main.ts → spawn 真入口，按 contracts/scenarios/cli_envelope/
 * 逐 invocation 执行并归一化，与 fixtures 逐字段比对（字段树语义，不看键序——serde 与
 * JSON.stringify 的键序天然不同）。完备性断言：场景数 == 夹具数 == 执行数。
 *
 * 归一化占位符双侧同构：<tsN>（ISO 时间戳按 invocation 内序号）、<pk-version>
 * （工具版本 semver 三段）、<home>/<cwd>（家目录/场景工作目录）。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import esbuild from "esbuild";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rawPlugin } from "../raw-loader.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scenariosDir = join(repoRoot, "contracts", "scenarios", "cli_envelope");
const fixturesDir = join(repoRoot, "contracts", "fixtures", "cli_envelope");

const PLATFORM_PREFIXES = [
  "src/host/dsh/",
  "src/host/radio/",
  "src/host/dispatch/",
  "src/host/remote/",
  "src/host/pet/",
  "src/client/",
];

let pkBundle: string;
let meta: import("esbuild").Metafile;
const workdirs: string[] = [];

beforeAll(async () => {
  const out = join(mkdtempSync(join(tmpdir(), "pk-cli-ts-")), "pk.mjs");
  const result = await esbuild.build({
    entryPoints: [join(repoRoot, "dsh-plugin", "src", "pk", "main.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: out,
    metafile: true,
    define: { __PK_CLI_VERSION__: '"9.9.9-test"' },
    plugins: [rawPlugin],
    logLevel: "silent",
  });
  pkBundle = out;
  meta = result.metafile!;
});

afterEach(() => {
  for (const dir of workdirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pk bundle 依赖图纯度（零 dsh 平台面依赖）", () => {
  it("metafile 无平台面路径前缀", () => {
    expect(pkBundle).toBeDefined();
    const inputs = Object.keys(meta.inputs);
    const offenders = inputs.filter((p) => PLATFORM_PREFIXES.some((pre) => p.includes(pre)));
    expect(offenders, `pk bundle 引入了平台面模块: ${offenders.join(", ")}`).toEqual([]);
  });
});

// ---- 归一化（与 Rust oracle 逐条同构） ----

function isIsoTimestamp(s: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/.test(s) &&
    s.length >= 10 &&
    s
      .slice(0, 4)
      .split("")
      .every((c) => c >= "0" && c <= "9") &&
    s[4] === "-" &&
    s
      .slice(5, 7)
      .split("")
      .every((c) => c >= "0" && c <= "9") &&
    s[7] === "-" &&
    s
      .slice(8, 10)
      .split("")
      .every((c) => c >= "0" && c <= "9")
  );
}

function isPkVersion(s: string): boolean {
  // 三段数字开头即可（兼容 prerelease 后缀：TS 包版本可带 -beta.1 之类，与 Rust oracle 同款判定）
  return /^\d+\.\d+\.\d+/.test(s);
}

function normalizeStr(s: string, home: string, cwd: string, ts: { n: number }): string {
  if (isIsoTimestamp(s)) {
    ts.n += 1;
    return `<ts${ts.n}>`;
  }
  return s.split(cwd).join("<cwd>").split(home).join("<home>");
}

function normalize(v: unknown, home: string, cwd: string, ts: { n: number }): unknown {
  if (Array.isArray(v)) return v.map((x) => normalize(x, home, cwd, ts));
  if (v !== null && typeof v === "object") {
    // 键排序后再遍历（serde_json BTreeMap 字典序同构——<tsN> 编号两侧一致的前提）
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      out[k] =
        k === "version" && typeof val === "string" && isPkVersion(val) ? "<pk-version>" : normalize(val, home, cwd, ts);
    }
    return out;
  }
  if (typeof v === "string") return normalizeStr(v, home, cwd, ts);
  return v;
}

function normalizeOutput(raw: string, home: string, cwd: string): unknown {
  const text = raw.replace(/\s+$/, "");
  try {
    return normalize(JSON.parse(text), home, cwd, { n: 0 });
  } catch {
    if (isPkVersion(text)) return "<pk-version>";
    return text.split(cwd).join("<cwd>").split(home).join("<home>");
  }
}

// ---- 场景执行 ----

interface Invocation {
  argv: string[];
  stdin?: string;
  env?: Record<string, string>;
}

interface Scenario {
  name: string;
  setup?: { chatMessages?: Array<{ id: number; messageId: string; content: string; createdAt: string }> };
  invocations: Invocation[];
}

function runPk(workdir: string, inv: Invocation) {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.PK_LOG_FILE;
  delete env.PK_SSH_BIN;
  delete env.PK_DISPATCH_TASK;
  env.PK_DB = join(workdir, "env.db");
  for (const [k, v] of Object.entries(inv.env ?? {})) env[k] = v;
  return spawnSync(process.execPath, [pkBundle, ...inv.argv], {
    cwd: workdir,
    env,
    input: inv.stdin ?? undefined,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function scenarioFiles(): string[] {
  return readdirSync(scenariosDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

describe("CLI 信封契约回放（contracts/cli_envelope）", () => {
  it("场景数 == 夹具数（完备性）", () => {
    const fixtures = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
    expect(scenarioFiles().length).toBe(fixtures.length);
  });

  it.each(scenarioFiles().map((f) => [f.replace(/\.json$/, ""), f] as const))(
    "场景 %s 与 Rust oracle 夹具一致",
    (_name, file) => {
      const sc: Scenario = JSON.parse(readFileSync(join(scenariosDir, file), "utf8"));
      const home = homedir();
      const workdir = mkdtempSync(join(tmpdir(), `pk-cli-env-${sc.name}-`));
      workdirs.push(workdir);
      // 归一化替换源用 realpath：与 Rust oracle 的 canonicalize 同口径（macOS 的
      // current_dir / process.cwd 返回 /private 前缀真路径，须与逻辑路径统一消解）
      const cwdNorm = realpathSync(workdir);
      // 预备：独立库引导（对齐 oracle harness 的 init-db 预备步骤）
      const prep = runPk(workdir, { argv: ["init-db"] });
      expect(prep.status, `init-db 预备失败: ${prep.stderr}`).toBe(0);
      if (sc.setup?.chatMessages?.length) {
        const conn = new DatabaseSync(join(workdir, "env.db"));
        for (const seed of sc.setup.chatMessages) {
          conn
            .prepare("INSERT INTO chat_messages (id, message_id, content, created_at) VALUES (?, ?, ?, ?)")
            .run(seed.id, seed.messageId, seed.content, seed.createdAt);
        }
        conn.close();
      }
      const fixture = JSON.parse(readFileSync(join(fixturesDir, `${sc.name}.json`), "utf8"));
      expect(fixture.name).toBe(sc.name);
      expect(sc.invocations.length).toBe(fixture.results.length);
      sc.invocations.forEach((inv, i) => {
        const out = runPk(workdir, inv);
        const actual = {
          exitCode: out.status,
          stdout: normalizeOutput(out.stdout ?? "", home, cwdNorm),
          stderr: normalizeOutput(out.stderr ?? "", home, cwdNorm),
        };
        expect(actual, `invocation #${i} (${inv.argv.join(" ")})`).toEqual(fixture.results[i]);
      });
    },
  );
});
