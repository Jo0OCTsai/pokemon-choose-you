/**
 * dsh/directScope：provision 前置步直连 ssh 传输兜底（acceptance §4 已知项 1）——
 * shell/spawn 经本机 ssh 二进制（BatchMode/ConnectTimeout 选项与 sshCheck 同款 +
 * 端口解析）、connected = 最近一次操作成功、超时 kill、spawnTerminal/writeFile 不
 * 支持、disconnect no-op。单元面走 fake ssh 脚本（argv 逐行记录 + 可编程应答）；
 * 真链冒烟经 env 门控（PKY_TEST_SSH_ALIAS / PKY_TEST_SSH_FAIL_ALIAS——本机 sshd
 * 别名 pky-spike-a / 配错别名；CI 无别名自动 skip）。
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { posixQuote } from "../src/host/dispatch/cmdline";
import { DirectSshScope } from "../src/host/dsh/directScope";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pky-direct-scope-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** fake ssh 脚本落盘（0755）：body 可记录 argv（逐行）与固定应答 */
function fakeSsh(body: string): string {
  const bin = join(dir, "fake-ssh.sh");
  writeFileSync(bin, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(bin, 0o755);
  return bin;
}

/** argv 记录文件路径 */
function recordPath(): string {
  return join(dir, "argv-record.txt");
}

/** 读取 argv 记录（每参数一行） */
function recordedArgs(): string[] {
  return String(readFileSync(recordPath(), "utf8"))
    .split("\n")
    .filter((l) => l !== "");
}

/** "--" 之后的参数（host + 远端命令串） */
function argsAfterSeparator(args: string[]): string[] {
  return args.slice(args.indexOf("--") + 1);
}

describe("DirectSshScope：连接选项与结果信封（fake ssh 脚本）", () => {
  it("shell 成功：BatchMode + ConnectTimeout + -- host cmd 的 argv 形态；code 0 + stdout 回读 + connected=true", async () => {
    const bin = fakeSsh(`printf '%s\\n' "$@" >> '${recordPath()}'\necho pky-ok`);
    const scope = new DirectSshScope("dev-box", { sshBin: bin });
    const result = await scope.shell("printf pky-ok");
    expect(result).toMatchObject({ code: 0, stdout: "pky-ok\n" });
    expect(scope.connected).toBe(true);
    const args = recordedArgs();
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ConnectTimeout=10");
    expect(argsAfterSeparator(args)).toEqual(["dev-box", "printf pky-ok"]);
  });

  it("别名带端口与 user@：[user@]host[:port] → -p <port> + host 参数剥离端口（sshCheck 同款解析）", async () => {
    const bin = fakeSsh(`printf '%s\\n' "$@" >> '${recordPath()}'\ntrue`);
    const scope = new DirectSshScope("u@dev-box:2222", { sshBin: bin });
    await scope.shell("true");
    const args = recordedArgs();
    expect(args[args.indexOf("-p") + 1]).toBe("2222");
    expect(argsAfterSeparator(args)).toEqual(["u@dev-box", "true"]);
  });

  it("shell 失败（远端退出码）→ code 透传 + stderr 回读 + connected=false", async () => {
    const bin = fakeSsh("echo 'not found' >&2\nexit 127");
    const scope = new DirectSshScope("dev-box", { sshBin: bin });
    const failed = await scope.shell("command -v npm");
    expect(failed).toMatchObject({ code: 127, stderr: "not found\n" });
    expect(scope.connected).toBe(false); // connected = 最近一次操作成功
  });

  it("spawn：argv 逐参 posixQuote 拼远端命令（对抗参数不裸拼）；stdin 管道灌入可回读", async () => {
    const bin = fakeSsh(`printf '%s\\n' "$@" >> '${recordPath()}'\ncat`);
    const scope = new DirectSshScope("dev-box", { sshBin: bin });
    const result = await scope.spawn(["echo", "a b", "c;d"], { stdin: "payload" });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("payload");
    expect(scope.connected).toBe(true);
    const rest = argsAfterSeparator(recordedArgs());
    expect(rest.slice(1).join(" ")).toBe(`echo ${posixQuote("a b")} ${posixQuote("c;d")}`);
  });
});

describe("DirectSshScope：超时与不支持面（fake ssh 脚本）", () => {
  it("超时（timeoutMs）→ SIGKILL 收口：code null + durationMs 覆盖超时窗 + connected=false", async () => {
    const bin = fakeSsh("sleep 5");
    const scope = new DirectSshScope("dev-box", { sshBin: bin });
    const startedAt = Date.now();
    const result = await scope.spawn(["true"], { timeoutMs: 200 });
    expect(result.code).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
    expect(Date.now() - startedAt).toBeLessThan(4000);
    expect(scope.connected).toBe(false);
  });

  it("spawnTerminal / writeFile 抛不支持；disconnect no-op（无长连，connected 不变）", async () => {
    const bin = fakeSsh("true");
    const scope = new DirectSshScope("dev-box", { sshBin: bin });
    await expect(scope.spawnTerminal({ command: "/bin/sh" })).rejects.toThrow(/不支持终端会话/);
    await expect(scope.writeFile("/tmp/x", "data")).rejects.toThrow(/不支持文件写入/);
    await expect(scope.disconnect()).resolves.toBeUndefined();
    expect(scope.connected).toBe(true); // 乐观初值未被破坏
  });
});

// ---- 真链冒烟（env 门控：本机 sshd 别名；CI 无别名自动 skip） ----

const SSH_ALIAS = process.env.PKY_TEST_SSH_ALIAS ?? "";
const SSH_FAIL_ALIAS = process.env.PKY_TEST_SSH_FAIL_ALIAS ?? "";

describe("DirectSshScope：真链冒烟（PKY_TEST_SSH_ALIAS 门控）", () => {
  (SSH_ALIAS === "" ? it.skip : it)(
    "真别名 shell echo 成功（免密连通 + code 0）",
    async () => {
      const scope = new DirectSshScope(SSH_ALIAS);
      const result = await scope.shell("printf pky-ok");
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("pky-ok");
      expect(scope.connected).toBe(true);
    },
    15_000,
  );

  (SSH_FAIL_ALIAS === "" ? it.skip : it)(
    "免密失败别名 → ssh 传输层失败（exit 255 + Permission denied 语义 → SSH_AUTH_REQUIRED 判定原料）",
    async () => {
      const scope = new DirectSshScope(SSH_FAIL_ALIAS);
      const result = await scope.shell("printf pky-ok");
      expect(result.code).not.toBe(0);
      expect(scope.connected).toBe(false);
    },
    15_000,
  );
});
