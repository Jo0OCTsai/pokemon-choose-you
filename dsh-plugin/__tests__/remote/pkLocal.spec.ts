/**
 * pk 本机落位（remote/pkLocal，ADR-0006）：`~/.choose-you/bin/pk` 与包内 dist/pk.mjs
 * 保持同源（缺失落位 / 漂移覆盖；bundle 缺件时已存在复用；全缺 → undefined 降级）。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureLocalPk,
  localPkPath,
  localPkPathPrefix,
  pkBundlePath,
  pkWrapperScript,
  resolveNodeBin,
} from "../../src/host/remote/pkLocal";

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

/** 自建一个充当 dist/pk.mjs 的 bundle 注入点（<dir>/dist/pk.mjs；可选 package.json 定版本） */
function fakeBundle(root: string, content: string, version?: string): string {
  const dist = join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const p = join(dist, "pk.mjs");
  writeFileSync(p, content);
  if (version !== undefined) {
    writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
  }
  return root;
}

describe("ensureLocalPk：落位形态与迁移", () => {
  it("已存在 + bundle 缺件 → 复用不覆盖（包分发缺件时已落位仍可用）", () => {
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, "sentinel");
    chmodSync(target, 0o755);
    expect(ensureLocalPk(join(home, "no-bundle"))).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("sentinel");
  });

  it("缺失 → 落 wrapper + pk.mjs 双文件（wrapper 内嵌 node 绝对路径与 provenance 标记）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// fake-pk\n", "9.9.9");
    const p = ensureLocalPk(join(pkg, "dist", "pk.mjs"));
    expect(p).toBe(join(home, "bin", "pk"));
    const wrapper = readFileSync(p!, "utf8");
    // wrapper 形态：sh 头 + provenance 标记（插件版本可读）+ 同目录 pk.mjs 直启 + PATH 兜底
    expect(wrapper.startsWith("#!/bin/sh\n")).toBe(true);
    expect(wrapper).toContain("pky-pk-wrapper v1 (9.9.9)");
    expect(wrapper).toContain('exec node "$d/pk.mjs" "$@"');
    if (resolveNodeBin() !== null) {
      expect(wrapper).toMatch(/\[ -x "[^"]+" \] && exec "[^"]+" "\$d\/pk\.mjs" "\$@"/);
    }
    // bundle 原样落在 pk.mjs；执行位在 wrapper 上
    expect(readFileSync(`${p}.mjs`, "utf8")).toContain("fake-pk");
    expect(statSync(p!).mode & 0o111).not.toBe(0);
  });

  it("absNode 为 null → 只留 PATH 兜底（预检/doctor 负责暴露）", () => {
    const script = pkWrapperScript(null, "1.2.3");
    expect(script).toContain("pky-pk-wrapper v1 (1.2.3)");
    expect(script).not.toContain("[ -x ");
    expect(script).toContain("command -v node");
  });

  it("旧形态落位（Rust 二进制 / 裸 mjs）→ 自动迁移 wrapper", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// fake-pk\n", "9.9.9");
    const target = join(home, "bin", "pk");
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(target, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00])); // Mach-O 头样的旧 Rust 二进制
    chmodSync(target, 0o755);
    expect(ensureLocalPk(join(pkg, "dist", "pk.mjs"))).toBe(target);
    expect(readFileSync(target, "utf8")).toContain("pky-pk-wrapper");
    expect(readFileSync(`${target}.mjs`, "utf8")).toContain("fake-pk");
  });
});

describe("ensureLocalPk：新鲜度与幂等（stat 缓存）", () => {
  it("落位与 bundle 漂移 → pk.mjs 覆盖更新，wrapper 原样不动（新鲜度）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// pk-v1\n", "9.9.9");
    const bundle = join(pkg, "dist", "pk.mjs");
    const target = ensureLocalPk(bundle)!;
    const wrapperBefore = readFileSync(target, "utf8");
    const wrapperMtime = statSync(target).mtimeMs;
    writeFileSync(bundle, "#!/usr/bin/env node\n// pk-v2\n");
    expect(ensureLocalPk(bundle)).toBe(target);
    expect(readFileSync(`${target}.mjs`, "utf8")).toContain("pk-v2");
    expect(readFileSync(target, "utf8")).toBe(wrapperBefore);
    expect(statSync(target).mtimeMs).toBe(wrapperMtime);
  });

  it("插件版本变化 → wrapper 原地重写（provenance 跟随）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// same\n", "9.9.9");
    const bundle = join(pkg, "dist", "pk.mjs");
    const p1 = ensureLocalPk(bundle);
    expect(readFileSync(p1!, "utf8")).toContain("(9.9.9)");
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version: "10.0.0" }));
    const p2 = ensureLocalPk(bundle);
    expect(p2).toBe(p1);
    expect(readFileSync(p2!, "utf8")).toContain("(10.0.0)");
  });

  it("落位与 bundle 一致 → 幂等不重拷（两文件 mtime 均不变；stat 缓存命中）", () => {
    const pkg = fakeBundle(home, "#!/usr/bin/env node\n// same\n", "9.9.9");
    const bundle = join(pkg, "dist", "pk.mjs");
    const p1 = ensureLocalPk(bundle);
    const before = statSync(p1!).mtimeMs;
    const beforeMjs = statSync(`${p1}.mjs`).mtimeMs;
    expect(ensureLocalPk(bundle)).toBe(p1);
    expect(statSync(p1!).mtimeMs).toBe(before);
    expect(statSync(`${p1}.mjs`).mtimeMs).toBe(beforeMjs);
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
