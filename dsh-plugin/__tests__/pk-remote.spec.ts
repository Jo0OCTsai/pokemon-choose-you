/**
 * remote 家族 TS 实现测试（对齐 Rust remote_pk.rs / bin/pk/remote.rs 的测试面）：
 * shlex 表驱动、forced-command 四类拒绝、程序等价判定、九步全链（假 ssh/keyscan/
 * keygen 注入）、authorized_keys 四形态收口、__ssh_entry 端到端（spawn bundle）。
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  authorizedEntry,
  defaultCtx,
  runSetup,
  shimScript,
  toKnownHostsLines,
  type SetupCtx,
  type SetupReport,
} from "../src/pk/setup";
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

// ---- 九步全链：假 ssh / ssh-keyscan / ssh-keygen 注入 ----

interface FakeBin {
  binDir: string;
  home: string;
  keyDir: string;
  pkPath: string;
  calls: string[];
}

/** 假程序注入（Rust inject_fake_ssh 同款模式）：记录调用、按 remote_line 应答 */
function makeFakeBin(): FakeBin {
  const root = mkdtempSync(join(tmpdir(), "pk-setup-fake-"));
  cleanup.push(root);
  const binDir = join(root, "bin");
  const home = join(root, "home");
  const keyDir = join(root, "data");
  mkdirSync(binDir);
  mkdirSync(home);
  const log = join(root, "calls.log");
  const pkPath = join(binDir, "pk");
  writeFileSync(pkPath, "#!/bin/sh\nexit 0\n");
  chmodSync(pkPath, 0o755);
  const fakeSsh = `#!/bin/sh
echo "ssh $*" >> ${JSON.stringify(log)}
line="$*"
case "$line" in
  *"command -v pk"*) echo "${JSON.stringify(join(binDir, "pk"))}"; exit 0;;
  *"pk --version"*) echo "9.9.9-test"; exit 0;;
esac
cat > /dev/null
exit 0
`;
  writeFileSync(join(binDir, "ssh"), fakeSsh);
  chmodSync(join(binDir, "ssh"), 0o755);
  writeFileSync(
    join(binDir, "ssh-keyscan"),
    `#!/bin/sh\necho "[localhost]:22 ssh-ed25519 AAAAFAKEHOSTKEY pk-setup-test"\n`,
  );
  chmodSync(join(binDir, "ssh-keyscan"), 0o755);
  writeFileSync(
    join(binDir, "ssh-keygen"),
    `#!/bin/sh
f=""
prev=""
for a in "$@"; do if [ "$prev" = "-f" ]; then f="$a"; fi; prev="$a"; done
echo "ssh-keygen $*" >> ${JSON.stringify(log)}
printf '-----BEGIN OPENSSH PRIVATE KEY-----\\nFAKE\\n-----END OPENSSH PRIVATE KEY-----\\n' > "$f"
echo "ssh-ed25519 AAAAFAKEPUBKEY pk-setup-test" > "$f.pub"
exit 0
`,
  );
  chmodSync(join(binDir, "ssh-keygen"), 0o755);
  return { binDir, home, keyDir, pkPath, calls: [] };
}

function ctxOf(fake: FakeBin, over: Partial<SetupCtx> = {}): SetupCtx {
  const base = defaultCtx({
    host: "dev-box",
    tunnelPort: 10022,
    pkPath: fake.pkPath,
    keyDir: fake.keyDir,
    timeoutSecs: 5,
  });
  return {
    ...base,
    sshProgram: join(fake.binDir, "ssh"),
    keyscanProgram: join(fake.binDir, "ssh-keyscan"),
    sshKeygenProgram: join(fake.binDir, "ssh-keygen"),
    localHome: fake.home,
    localUser: "jo",
    ...over,
  };
}

const PUB_LINE = "ssh-ed25519 AAAAFAKEPUBKEY pk-setup-test";

describe("run_setup 九步全链（假程序注入）", () => {
  it("全新环境：九步全 ok，端到端版本回传，authorized_keys 追加受限条目", () => {
    const fake = makeFakeBin();
    const report: SetupReport = runSetup(ctxOf(fake));
    expect(report.ok).toBe(true);
    expect(report.version).toBe("9.9.9-test");
    expect(report.steps.map((s) => s.name)).toEqual([
      "定位 pk",
      "本机 sshd",
      "专用密钥",
      "本机公钥装配",
      "推送私钥",
      "预信任主机指纹",
      "安装 shim",
      "远程 PATH",
      "端到端验证",
    ]);
    expect(report.steps.every((s) => s.status === "ok")).toBe(true);
    const ak = readFileSync(join(fake.home, ".ssh/authorized_keys"), "utf8").trim();
    expect(ak).toBe(authorizedEntry(fake.pkPath, PUB_LINE));
    // shim 落盘载荷含隧道回连（假 ssh 的 stdin 已吞，这里验证脚本生成端点）
    expect(report.steps.find((s) => s.name === "安装 shim")!.detail).toContain("~/.local/bin/pk");
  });

  it("重复执行幂等：密钥与公钥装配均 skip", () => {
    const fake = makeFakeBin();
    runSetup(ctxOf(fake));
    const again = runSetup(ctxOf(fake));
    expect(again.ok).toBe(true);
    expect(again.steps.find((s) => s.name === "专用密钥")!.status).toBe("skip");
    expect(again.steps.find((s) => s.name === "本机公钥装配")!.status).toBe("skip");
    const ak = readFileSync(join(fake.home, ".ssh/authorized_keys"), "utf8");
    expect(ak.trim().split("\n")).toHaveLength(1);
  });

  it("旧版裸公钥行：原位升级为受限条目", () => {
    const fake = makeFakeBin();
    const sshDir = join(fake.home, ".ssh");
    mkdirSync(sshDir);
    writeFileSync(join(sshDir, "authorized_keys"), `other-key line\n${PUB_LINE}\n`);
    const report = runSetup(ctxOf(fake));
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "本机公钥装配")!.status).toBe("ok");
    const lines = readFileSync(join(sshDir, "authorized_keys"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("other-key line");
    expect(lines[1]).toBe(authorizedEntry(fake.pkPath, PUB_LINE));
  });

  it("自家受限条目旧 pk 路径：原位搬移 command", () => {
    const fake = makeFakeBin();
    const sshDir = join(fake.home, ".ssh");
    mkdirSync(sshDir);
    const stale = authorizedEntry("/old/location/pk", PUB_LINE);
    writeFileSync(join(sshDir, "authorized_keys"), `${stale}\n`);
    const report = runSetup(ctxOf(fake));
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "本机公钥装配")!.detail).toContain("旧路径");
    const lines = readFileSync(join(sshDir, "authorized_keys"), "utf8").trim().split("\n");
    expect(lines[0]).toBe(authorizedEntry(fake.pkPath, PUB_LINE));
  });

  it("陌生自定义形态：保持不动（skip）", () => {
    const fake = makeFakeBin();
    const sshDir = join(fake.home, ".ssh");
    mkdirSync(sshDir);
    const custom = `command="/usr/bin/logger",no-pty ${PUB_LINE}`;
    writeFileSync(join(sshDir, "authorized_keys"), `${custom}\n`);
    const report = runSetup(ctxOf(fake));
    expect(report.ok).toBe(true);
    expect(report.steps.find((s) => s.name === "本机公钥装配")!.status).toBe("skip");
    expect(readFileSync(join(sshDir, "authorized_keys"), "utf8").trim()).toBe(custom);
  });

  it("本机 sshd 不可达：第二步失败并带修复建议", () => {
    const fake = makeFakeBin();
    writeFileSync(join(fake.binDir, "ssh-keyscan"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(fake.binDir, "ssh-keyscan"), 0o755);
    const report = runSetup(ctxOf(fake));
    expect(report.ok).toBe(false);
    expect(report.steps).toHaveLength(2);
    expect(report.steps[1]).toMatchObject({ name: "本机 sshd", status: "fail" });
    expect(report.steps[1].detail).toContain("远程登录");
  });

  it("空 pk 占位：第一步失败", () => {
    const fake = makeFakeBin();
    writeFileSync(fake.pkPath, "");
    const report = runSetup(ctxOf(fake));
    expect(report.ok).toBe(false);
    expect(report.steps[0]).toMatchObject({ name: "定位 pk", status: "fail" });
    expect(report.steps[0].detail).toContain("空占位");
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
