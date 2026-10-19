/**
 * pk 本机落位（remote/pkLocal，ADR-0003 §4）：`~/.choose-you/bin/pk` 缺失时从包内
 * vendor 拷当前平台 triple（已存在复用不覆盖；vendor 缺件 → undefined 降级）。
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalPk, localPkPath, vendorDir } from "../../src/host/remote/pkLocal";

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

  it("缺失 → 从包内 vendor 落位（真实链路：build.mjs 已把当前 triple 拷入 vendor/）", () => {
    const p = ensureLocalPk();
    expect(p).toBe(join(home, "bin", "pk"));
    expect(existsSync(p!)).toBe(true);
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

  it("默认起点（包内）→ 包根 vendor", () => {
    const dir = vendorDir();
    expect(dir).toBeDefined();
    expect(dir!.endsWith("vendor")).toBe(true);
  });
});
