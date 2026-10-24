/**
 * pk 本机落位（remote/pkLocal，ADR-0003 §4）：`~/.choose-you/bin/pk` 与包内 vendor/
 * 保持同源（缺失落位 / 漂移覆盖；vendor 缺件时已存在复用；全缺 → undefined 降级）。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalPk, hostTriple, localPkPath, localPkPathPrefix, vendorDir } from "../../src/host/remote/pkLocal";

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

describe("localPkPathPrefix", () => {
  it('落位在场 → `export PATH=<dir>:"$PATH" && `（posixQuote 条件引用——含空格目录亦安全）', () => {
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(join(home, "bin", "pk"), "#!/bin/sh\n");
    expect(localPkPathPrefix()).toBe(`export PATH=${join(home, "bin")}:"$PATH" && `);
  });

  it("落位缺席 → 空串（行为不变，不加前缀）", () => {
    expect(localPkPathPrefix()).toBe("");
  });
});

describe("ensureLocalPk", () => {
  it("已存在 + vendor 缺件 → 复用不覆盖（包分发缺件时已落位仍可用）", () => {
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "sentinel");
    chmodSync(target, 0o755);
    expect(ensureLocalPk(join(home, "no-vendor"))).toBe(target);
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

  it("落位与 vendor 漂移 → 覆盖更新（新鲜度——重建 pk 后无需手动清落位）", () => {
    const vendor = join(home, "vendor-src");
    mkdirSync(vendor, { recursive: true });
    const triple = hostTriple();
    const src = join(vendor, `pk-${triple}`);
    writeFileSync(src, "#!/bin/sh\necho pk-v2\n");
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "#!/bin/sh\necho pk-v1-stale\n");
    chmodSync(target, 0o755);
    expect(ensureLocalPk(vendor)).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("pk-v2");
  });

  it("落位与 vendor 一致 → 幂等不重拷（返回即落位）", () => {
    const vendor = join(home, "vendor-src");
    mkdirSync(vendor, { recursive: true });
    const triple = hostTriple();
    writeFileSync(join(vendor, `pk-${triple}`), "#!/bin/sh\necho same\n");
    const p1 = ensureLocalPk(vendor);
    const before = statSync(p1!).mtimeMs;
    expect(ensureLocalPk(vendor)).toBe(p1);
    expect(statSync(p1!).mtimeMs).toBe(before);
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
