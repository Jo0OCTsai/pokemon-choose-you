/**
 * toolSchema 映射器单测（平台胶水层纯逻辑件）：
 * ① 22 工具参数表完整性——键集与注册表 params 摘要逐工具双向一致（防漂移单源）；
 * ② ParamDecl → dsh JSON DSL 的映射形态（string/enum/integer/number/boolean/
 *    string[]/json[]，required 透传、description 透传）；
 * ③ 输出节点结构合法（enum 只出现在 string 节点、items 只出现在 array 节点）。
 */
import { describe, expect, it } from "vitest";
import { createTodoTools, TODO_TOOL_NAMES } from "../src/host/tools/todoTools";
import { toDslParameters, TODO_TOOL_PARAM_DECLS, type DslNode, type ParamDecls } from "../src/host/dsh/toolSchema";

const registry = createTodoTools();

describe("参数表完整性（与注册表逐工具双向一致）", () => {
  it("表键集 == TODO_TOOL_NAMES 全集", () => {
    expect(Object.keys(TODO_TOOL_PARAM_DECLS).sort()).toEqual([...TODO_TOOL_NAMES].sort());
  });

  it.each([...TODO_TOOL_NAMES])("%s：表参数名 == 注册表 params 摘要", (toolName) => {
    const def = registry.get(toolName);
    expect(Object.keys(TODO_TOOL_PARAM_DECLS[toolName] ?? {}).sort()).toEqual([...(def.params ?? [])].sort());
  });

  it("必填声明抽查：create.title 必填、category 可选", () => {
    const create = TODO_TOOL_PARAM_DECLS.todo_task_create;
    expect(create?.title?.required).toBe(true);
    expect(create?.category?.required).toBeUndefined();
  });
});

describe("toDslParameters 基础形态", () => {
  it("空声明集 → 空参数表", () => {
    expect(toDslParameters({})).toEqual({});
  });

  it("string + enum + required + description 透传", () => {
    const decls: ParamDecls = {
      scope: { type: "string", enum: ["open", "done"], required: true, description: "口径" },
    };
    expect(toDslParameters(decls)).toEqual({
      scope: { type: "string", required: true, description: "口径", enum: ["open", "done"] },
    });
  });

  it("integer/number/boolean 基础形态（不带 enum/items 键）", () => {
    expect(
      toDslParameters({
        id: { type: "integer", required: true },
        cost: { type: "number" },
        dry: { type: "boolean", description: "只回显" },
      }),
    ).toEqual({
      id: { type: "integer", required: true },
      cost: { type: "number" },
      dry: { type: "boolean", description: "只回显" },
    });
  });

  it("string[] → array of string；json[] → array of json", () => {
    expect(toDslParameters({ tags: { type: "string[]" }, results: { type: "json[]", required: true } })).toEqual({
      tags: { type: "array", items: { type: "string" } },
      results: { type: "array", required: true, items: { type: "json" } },
    });
  });
});

// 结构合法性走查（模块级助手：enum 仅 string、items 仅 array、type 取值封闭）
const allowedTypes = new Set(["string", "integer", "number", "boolean", "array", "json"]);

function assertNodeStructure(node: DslNode): void {
  expect(allowedTypes.has(node.type)).toBe(true);
  if (node.type === "array") {
    expect(node.items).toBeDefined();
    expect("enum" in node && node.enum !== undefined).toBe(false);
    return;
  }
  expect("items" in node).toBe(false);
  if (node.type !== "string") {
    expect("enum" in node && node.enum !== undefined).toBe(false);
  }
}

describe("全表输出节点结构合法性", () => {
  it("每个登记参数的映射节点均满足判别联合约束", () => {
    for (const decls of Object.values(TODO_TOOL_PARAM_DECLS)) {
      for (const node of Object.values(toDslParameters(decls))) {
        assertNodeStructure(node);
      }
    }
  });
});
