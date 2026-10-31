/**
 * remote setup 九步全链与 doctor 测试（从 pk-remote.spec.ts 拆件控文件规模）：
 * 假 ssh/keyscan/keygen 注入跑通九步、authorized_keys 四形态收口、doctor 检查面。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSetup, type SetupCtx, type SetupReport } from "../src/pk/setup";
import { classifyClientAlive } from "../src/pk/client-alive";
import { defaultCtx } from "../src/pk/setup-ctx";
import { authorizedEntry } from "../src/pk/authorized-keys";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
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
  *clientaliveinterval*) echo "clientaliveinterval 15"; exit 0;;
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
const SETUP_STEP_NAMES = [
  "定位 pk",
  "本机 sshd",
  "专用密钥",
  "本机公钥装配",
  "推送私钥",
  "预信任主机指纹",
  "安装 shim",
  "远程 PATH",
  "端到端验证",
  "sshd 存活探测",
];

describe("run_setup 全链：全新与幂等（假程序注入）", () => {
  it("全新环境：九步全 ok 且端到端版本回传", () => {
    const fake = makeFakeBin();
    const report: SetupReport = runSetup(ctxOf(fake));
    expect(report.ok).toBe(true);
    expect(report.version).toBe("9.9.9-test");
    expect(report.steps.map((s) => s.name)).toEqual(SETUP_STEP_NAMES);
    expect(report.steps.every((s) => s.status === "ok")).toBe(true);
  });

  it("全新环境：authorized_keys 追加受限条目，shim 落点报告", () => {
    const fake = makeFakeBin();
    const report: SetupReport = runSetup(ctxOf(fake));
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
});

describe("run_setup 公钥四形态收口（假程序注入）", () => {
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
});

describe("run_setup 失败路径（假程序注入）", () => {
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

describe("sshd 存活探测三分类（classify_client_alive 同构）", () => {
  it("1–60s → ok", () => {
    expect(classifyClientAlive("clientaliveinterval 15")).toMatchObject({ name: "sshd 存活探测", status: "ok" });
    expect(classifyClientAlive("ClientAliveInterval 60").status).toBe("ok");
  });
  it("0 或 >60 → warn 带配置建议", () => {
    expect(classifyClientAlive("clientaliveinterval 0")).toMatchObject({ status: "warn" });
    expect(classifyClientAlive("clientaliveinterval 300").detail).toContain("ClientAliveInterval 15");
  });
  it("不可确认 → warn（UNCONFIRMED / 空输出）", () => {
    expect(classifyClientAlive("UNCONFIRMED").detail).toContain("无法确认");
    expect(classifyClientAlive("").status).toBe("warn");
  });
});
