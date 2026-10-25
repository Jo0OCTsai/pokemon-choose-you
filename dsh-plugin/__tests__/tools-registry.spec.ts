/**
 * tools 注册面：注册表完整性（22 工具名全集 = AD §4.1 表 20 行）+ 每工具至少一个
 * happy path 转发断言（真实临时库驱动 domain 原语；pet 工具走 fake 生命周期面；
 * 用例表见 tools-cases.ts——拆文件控复杂度棘轮口径）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTodoTools, TODO_TOOL_NAMES } from "../src/host/tools/todoTools";
import { allToolCases, bindCaseDb, type ToolCase } from "./tools-cases";
import { createTestDb, type TestDb } from "./helpers";

let db: TestDb;
beforeEach(() => {
  db = createTestDb();
  bindCaseDb(db.conn);
});
afterEach(() => {
  db.close();
});

const petCalls: string[] = [];

function tools() {
  return createTodoTools();
}

function ctx() {
  return {
    conn: db.conn,
    origin: "dsh:tools",
    pet: { show: async () => petCalls.push("show"), hide: () => petCalls.push("hide") },
  };
}

/** 桌宠双工具的用例（依赖本文件的 petCalls fake，随 spec 内联） */
function petCases(): ToolCase[] {
  return [
    { tool: "todo_pet_hide", args: {}, check: () => expect(petCalls).toContain("hide") },
    { tool: "todo_pet_show", args: {}, check: () => expect(petCalls).toContain("show") },
  ];
}

describe("tools 注册表（AD §4.1）", () => {
  it("22 工具名全集与 AD 表一致（20 行成对工具拆开命名）", () => {
    expect(tools().names().sort()).toEqual([...TODO_TOOL_NAMES].sort());
    expect(TODO_TOOL_NAMES).toHaveLength(22);
  });

  it("未知工具 → INVALID_ARGUMENT 信封；PkyError → 错误信封", async () => {
    const unknown = await tools().call("todo_nope", {}, ctx());
    expect(unknown).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const bad = await tools().call("todo_task_done", { id: 999 }, ctx());
    expect(bad).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it.each([...allToolCases(), ...petCases()].map((c) => [c.tool, c] as const))(
    "%s：happy path 转发断言",
    async (_name, c) => {
      const ids = { seeded: c.prepare?.(db.conn) ?? 0 };
      const result = await tools().call(c.tool, c.args, ctx());
      expect(result.ok).toBe(true);
      if (result.ok) {
        c.check(result.data, ids);
      }
    },
  );
});
