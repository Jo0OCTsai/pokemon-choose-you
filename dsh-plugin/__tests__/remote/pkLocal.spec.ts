/**
 * pk 本机落位（remote/pkLocal，ADR-0003 §4）：`~/.choose-you/bin/pk` 缺失时从包内
 * vendor 拷当前平台 triple（已存在复用不覆盖；vendor 缺件 → undefined 降级）。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalPk, hostTriple, localPkPath, vendorDir } from "../../src/host/remote/pkLocal";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pky-pklocal-"));
  process.env.CHOOSE_YOU_HOME = home;
});

afterEach(() => {
  delete process.env.CHOOSE_YOU_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("localPkPath", () => {
  it("落点 = <appHome>/bin/pk（CHOOSE_YOU_HOME 覆盖优先）", () => {
    expect(localPkPath()).toBe(join(home, "bin", "pk"));
  });
});

describe("ensureLocalPk", () => {
  it("已存在 → 复用不覆盖", () => {
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "sentinel");
    chmodSync(target, 0o755);
    expect(ensureLocalPk()).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("sentinel");
  });

  it("缺失 → 从 vendor 落位（自建 vendor 注入：拷当前 triple + 执行位；CI 无仓内 vendor 亦成立）", () => {
    const vendor = join(home, "vendor-src");
    mkdirSync(vendor, { recursive: true });
    const triple = hostTriple();
    writeFileSync(join(vendor, `pk-${triple}`), "#!/bin/sh\necho fake-pk\n");
    const p = ensureLocalPk(vendor);
    expect(p).toBe(join(home, "bin", "pk"));
    expect(readFileSync(p!, "utf8")).toContain("fake-pk");
  });
});

describe("ensureLocalPk 缺件路径", () => {
  it("vendor 缺件 → undefined（命令面降级拒绝；vendorOverride 注入空目录）", () => {
    expect(ensureLocalPk(join(home, "no-vendor"))).toBeUndefined();
  });
});

describe("vendorDir", () => {
  it("起点无 vendor（临时目录向上到根）→ undefined", () => {
    expect(vendorDir(home)).toBeUndefined();
  });

  it("默认起点（包内）→ 包根 vendor（仓内构建后在位；CI 干净检出无 vendor 时跳过）", () => {
    const dir = vendorDir();
    if (dir === undefined) {
      return;
    }
    expect(dir.endsWith("vendor")).toBe(true);
  });
});
