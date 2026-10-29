/**
 * pk 本机落位（remote/pkLocal，ADR-0006）：`~/.choose-you/bin/pk` 与包内 dist/pk.mjs
 * 保持同源（缺失落位 / 漂移覆盖；bundle 缺件时已存在复用；全缺 → undefined 降级）。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalPk, localPkPath, localPkPathPrefix, pkBundlePath } from "../../src/host/remote/pkLocal";

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

/** 自建一个充当 dist/pk.mjs 的 bundle 注入点（<dir>/dist/pk.mjs） */
function fakeBundle(root: string, content: string): string {
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const p = join(dist, "pk.mjs");
  writeFileSync(p, content);
  return root;
}

describe("ensureLocalPk", () => {
  it("已存在 + bundle 缺件 → 复用不覆盖（包分发缺件时已落位仍可用）", () => {
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "sentinel");
    chmodSync(target, 0o755);
    expect(ensureLocalPk(join(home, "no-bundle"))).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("sentinel");
  });

  it("缺失 → 从 bundle 落位（unix：拷为 pk + 执行位，shebang 由 bundle 自带）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// fake-pk\n");
    const p = ensureLocalPk(join(pkg, "dist", "pk.mjs"));
    expect(p).toBe(join(home, "bin", "pk"));
    expect(readFileSync(p!, "utf8")).toContain("fake-pk");
    expect(statSync(p!).mode & 0o111).not.toBe(0);
  });

  it("落位与 bundle 漂移 → 覆盖更新（新鲜度——重构建后无需手动清落位）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// pk-v2\n");
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "#!/bin/sh\necho pk-v1-stale\n");
    chmodSync(target, 0o755);
    expect(ensureLocalPk(join(pkg, "dist", "pk.mjs"))).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("pk-v2");
  });

  it("落位与 bundle 一致 → 幂等不重拷（返回即落位）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// same\n");
    const bundle = join(pkg, "dist", "pk.mjs");
    const p1 = ensureLocalPk(bundle);
    const before = statSync(p1!).mtimeMs;
    expect(ensureLocalPk(bundle)).toBe(p1);
    expect(statSync(p1!).mtimeMs).toBe(before);
  });
});

describe("ensureLocalPk 缺件路径", () => {
  it("bundle 缺件 → undefined（命令面降级拒绝；bundleOverride 注入不存在路径）", () => {
    expect(ensureLocalPk(join(home, "no-bundle"))).toBeUndefined();
  });
});

describe("pkBundlePath", () => {
  it("起点无 dist/pk.mjs（临时目录向上到根）→ undefined", () => {
    expect(pkBundlePath(home)).toBeUndefined();
  });

  it("默认起点（包内）→ 仓内构建产物 dist/pk.mjs（构建后在位；CI 干净检出去重后跳过）", () => {
    const p = pkBundlePath();
    if (p === undefined) {
      return;
    }
    expect(p.endsWith(join("dist", "pk.mjs"))).toBe(true);
  });
});
