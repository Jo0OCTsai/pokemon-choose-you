/**
 * 兼容矩阵一致性断言（NFR-3 ③ / FR-X7）：docs/compatibility.md 兼容矩阵的「探测键」列
 * 与 src/host/index.ts 的 CAPABILITY_KEYS apply 期能力探测清单**双向相等**——矩阵行
 * 增删而探测清单未同步（或反向）即红。矩阵解析按表格行规约（表头含「探测键」，
 * 每行首个反引号代码段 = 键）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPABILITY_KEYS, probeNodeRuntime, probeNodeSqlite } from "../src/host/index";

const MATRIX = readFileSync(join(import.meta.dirname, "..", "docs", "compatibility.md"), "utf8");

/** 矩阵表数据行 → 探测键（行内第一个 `code` 段） */
function matrixKeys(): string[] {
  const lines = MATRIX.split("\n");
  const headerIdx = lines.findIndex((l) => l.trim().startsWith("|") && l.includes("探测键"));
  expect(headerIdx, "矩阵须含「探测键」列（NFR-3 ③ 单源比对位）").toBeGreaterThanOrEqual(0);
  const keys: string[] = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.trim().startsWith("|")) {
      break; // 表格结束
    }
    const cell = line.split("|")[3] ?? "";
    const key = /`([a-z0-9-]+)`/.exec(cell)?.[1];
    expect(key, `矩阵行缺探测键：${line.trim()}`).toBeTruthy();
    keys.push(key as string);
  }
  return keys;
}

describe("兼容矩阵一致性（FR-X7 / NFR-3 ③）", () => {
  it("矩阵「探测键」列与 CAPABILITY_KEYS 探测清单双向相等", () => {
    expect(new Set(matrixKeys())).toEqual(new Set(CAPABILITY_KEYS));
    expect(matrixKeys()).toHaveLength(CAPABILITY_KEYS.length);
  });

  it("矩阵键无重复；探测清单覆盖 node:sqlite/timer/session/worktrees/ssh/storage/slots/terminal 全集", () => {
    const keys = matrixKeys();
    expect(new Set(keys).size).toBe(keys.length);
    for (const surface of [
      "node-sqlite",
      "dsh-timer",
      "dsh-session",
      "dsh-worktrees",
      "dsh-ssh",
      "dsh-storage",
      "dsh-slots",
      "dsh-terminal",
    ]) {
      expect(keys).toContain(surface);
    }
  });

  it("可直接探测项的本机现状（node ≥ 24 / node:sqlite 可开）", () => {
    expect(probeNodeRuntime().ok).toBe(true);
    expect(probeNodeSqlite().ok).toBe(true);
  });
});
