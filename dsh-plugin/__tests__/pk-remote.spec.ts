/**
 * remote 家族 TS 实现测试（对齐 Rust remote_pk.rs / bin/pk/remote.rs 的测试面）：
 * shlex 表驱动、forced-command 四类拒绝、程序等价判定、九步全链（假 ssh/keyscan/
 * keygen 注入）、authorized_keys 四形态收口、__ssh_entry 端到端（spawn bundle）。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { shimScript, toKnownHostsLines } from "../src/pk/shim";
import { authorizedEntry } from "../src/pk/authorized-keys";
import { parseForcedCommand, sameProgram, shlexSplit } from "../src/pk/remote";
import { buildPkBundle } from "./pk/testBundle";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("shlex 词法切分（POSIX sh 子集，零展开）", () => {
  it.each([
    ["a b c", ["a", "b", "c"]],
    ["  spaced   out  ", ["spaced", "out"]],
    ["'single quoted'", ["single quoted"]],
    ['"weird `$\\ x"', ["weird `$\\ x"]],
    ["back\\ slash\\ word", ["back slash word"]],
    ["--title 交周报 --due 2026-11-06T18:00", ["--title", "交周报", "--due", "2026-11-06T18:00"]],
  ])("%s → %j", (input, expected) => {
    expect(shlexSplit(input)).toEqual(expected);
  });

  it.each([
    ["'unclosed", "未闭合的单引号"],
    ['"unclosed', "未闭合的双引号"],
    ["dangling\\", "悬空反斜杠"],
    ['"dangling\\', "双引号内反斜杠悬空"],
  ])("畸形 %s → 报错", (input, message) => {
    expect(() => shlexSplit(input)).toThrow(message);
  });
});

describe("forced-command 解析（SSH_ORIGINAL_COMMAND 白名单与程序等价）", () => {
  const self = process.execPath;

  it("合法透传：env 前缀 + 白名单变量 + 本程序 + 参数", () => {
    const r = parseForcedCommand(`env PK_LOG_FILE=/tmp/a.log PK_DISPATCH_TASK=7 ${self} task list --limit all`, self);
    expect(r.envs).toEqual([
      ["PK_LOG_FILE", "/tmp/a.log"],
      ["PK_DISPATCH_TASK", "7"],
    ]);
    expect(r.args).toEqual(["task", "list", "--limit", "all"]);
  });

  it("无 env 前缀的直呼形态也接受", () => {
    const r = parseForcedCommand(`${self} version`, self);
    expect(r.envs).toEqual([]);
    expect(r.args).toEqual(["version"]);
  });

  it.each([
    ["env FOO=1 <pk> version", "环境变量 FOO 不在透传白名单"],
    ["env <pk2> version", "命令程序不是本 pk"],
    ["env PK_LOG_FILE=1", "缺少 pk 程序路径"],
  ])("拒绝：%s", (input, message) => {
    const bad = input.replaceAll("<pk>", "/usr/bin/definitely-not-pk");
    const selfArg = input.includes("<pk2>") ? "/usr/bin/other" : self;
    expect(() => parseForcedCommand(bad, selfArg)).toThrow(message);
  });

  it("程序等价：符号链接消解后相等", () => {
    const dir = mkdtempSync(join(tmpdir(), "pk-sameprog-"));
    cleanup.push(dir);
    const target = join(dir, "real-pk");
    writeFileSync(target, "#!/bin/sh\n");
    const link = join(dir, "link-pk");
    symlinkSync(target, link);
    expect(sameProgram(link, target)).toBe(true);
    expect(sameProgram(join(dir, "elsewhere"), target)).toBe(false);
  });
});

describe("条目与脚本文本（与 Rust 产出的锚点对齐）", () => {
  const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITEST test@pk";

  it("authorized_entry：restrict + forced command 转义", () => {
    expect(authorizedEntry("/usr/local/bin/pk", PUB)).toBe(`restrict,command="/usr/local/bin/pk __ssh_entry" ${PUB}`);
    expect(authorizedEntry("/opt/my pk/bin/pk", PUB)).toBe(`restrict,command="'/opt/my pk/bin/pk' __ssh_entry" ${PUB}`);
  });

  it("known_hosts 改写：主机名替换为 [127.0.0.1]:端口", () => {
    const keyscan = "# comment\n[localhost]:22 ssh-ed25519 AAAAKEY host\nlocalhost ssh-ed25519 AAAAKEY2 host2\n";
    expect(toKnownHostsLines(keyscan, 10022)).toBe(
      "[127.0.0.1]:10022 ssh-ed25519 AAAAKEY host\n[127.0.0.1]:10022 ssh-ed25519 AAAAKEY2 host2\n",
    );
  });

  it("shim 脚本：隧道回连 + 环境透传段 + ControlMaster", () => {
    const s = shimScript("/usr/local/bin/pk", 10022, "jo");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain('-p 10022 jo@127.0.0.1 "$fwd /usr/local/bin/pk" "$@"');
    expect(s).toContain("exec ssh -o BatchMode=yes -o ConnectTimeout=10 \\");
    expect(s).toContain('ControlPath="/tmp/pk-shim-$(id -u)-%C"');
    expect(s).toContain('[ -n "$PK_LOG_FILE" ]');
  });
});

// ---- __ssh_entry 端到端（spawn bundle） ----

describe("doctor 环境自检（隔离库全检查项）", () => {
  let bundle: string;
  beforeAll(async () => {
    bundle = (await buildPkBundle()).path;
  });

  it("init-db 后全检查面 ok（runtime/version/skill warn 不计 fail）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pk-doctor-"));
    cleanup.push(dir);
    const env = { ...process.env, PK_DB: join(dir, "env.db") } as Record<string, string>;
    delete env.PK_LOG_FILE;
    const init = spawnSync(process.execPath, [bundle, "init-db"], { env, encoding: "utf8" });
    expect(init.status).toBe(0);
    const out = spawnSync(process.execPath, [bundle, "doctor"], { env, encoding: "utf8" });
    expect(out.status).toBe(0);
    const report = JSON.parse(out.stdout);
    expect(report.summary.fail).toBe(0);
    const names = report.checks.map((c: { name: string }) => c.name);
    for (const expected of [
      "version",
      "database",
      "schema",
      "tables",
      "integrity",
      "concurrency",
      "context",
      "runtime",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("库不存在：database fail 且退出码 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "pk-doctor-missing-"));
    cleanup.push(dir);
    const env = { ...process.env, PK_DB: join(dir, "nope.db") } as Record<string, string>;
    const out = spawnSync(process.execPath, [bundle, "doctor"], { env, encoding: "utf8" });
    expect(out.status).toBe(1);
    expect(JSON.parse(out.stdout).summary.fail).toBeGreaterThan(0);
  });
});

describe("__ssh_entry 端到端", () => {
  let bundle: string;
  beforeAll(async () => {
    bundle = (await buildPkBundle()).path;
  });

  const runEntry = (orig: string) => {
    const env = { ...process.env, SSH_ORIGINAL_COMMAND: orig } as Record<string, string>;
    delete env.PK_LOG_FILE;
    delete env.PK_DISPATCH_TASK;
    return spawnSync(process.execPath, [bundle, "__ssh_entry"], { env, encoding: "utf8", timeout: 30_000 });
  };

  it("合法透传：env 白名单 + 本程序 + version → 透传执行", () => {
    const out = runEntry(`env PK_LOG_FILE=/tmp/x.log ${bundle} version`);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe("9.9.9-test");
  });

  it.each([["env FOO=1 <pk> version"], ["env <other> version"], ["'unclosed-quote"]])(
    "拒绝：%s（退出码 78）",
    (input) => {
      const orig = input.replaceAll("<pk>", bundle).replaceAll("<other>", "/usr/bin/some-other");
      const out = runEntry(orig);
      expect(out.status).toBe(78);
      expect(out.stderr).toContain('"error"');
    },
  );
});
