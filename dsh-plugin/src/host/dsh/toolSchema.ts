/**
 * 工具参数摘要 → dsh defineTool JSON DSL 的映射器（平台胶水层，Phase A）。
 *
 * 业务核心的 ToolDef 只带参数名清单（`params: string[]`——类型信息刻意不入业务核心，
 * 见 tools/registry.ts 约定）；dsh 的 defineTool 参数面是自有 JSON DSL
 * （`{ <key>: { type, required?, description?, enum?, items? } }`，非 schemastery）。
 * 本表按工具逐参数补类型标注（22 工具单源），`toDslParameters` 做纯映射——
 * 完整性由 __tests__/dsh-tool-schema.spec.ts 断言（表键集 == 注册表 params 摘要）。
 *
 * 零 dsh 依赖（含类型面）：输出节点为纯 JSON 对象，结构上可赋值给 dsh-tools 的
 * ParameterSchemaSpec（判别联合逐成员对齐），hostEntry 直接透传给 defineTool。
 */

/** 参数种类（本表单源）：string/integer/number/boolean + string[]/json[] 两类数组 */
export type ParamKind = "string" | "integer" | "number" | "boolean" | "string[]" | "json[]";

/** 单参数声明：种类 + 可选必填/枚举/描述 */
export interface ParamDecl {
  type: ParamKind;
  required?: true;
  enum?: readonly string[];
  description?: string;
}

/** 一工具的参数声明集（键 = 参数名） */
export type ParamDecls = Readonly<Record<string, ParamDecl>>;

/**
 * dsh JSON DSL 参数节点（判别联合：enum 只配 string、items 只配 array）。
 * json 节点 = dsh 的无约束 lossless JSON（注解式放行，提交期校验兜底）——
 * 本表只作为数组 items 出现；顶层参数不落 json 形态。
 */
export type DslNode =
  | { type: "string"; required?: true; description?: string; enum?: readonly string[] }
  | { type: "integer" | "number"; required?: true; description?: string }
  | { type: "boolean"; required?: true; description?: string }
  | { type: "json"; required?: true; description?: string }
  | { type: "array"; required?: true; description?: string; items: DslNode };

/**
 * 22 个 todo_* 工具的参数类型表（与 tools/todoTools.ts 装配的注册表逐行对应）。
 * 描述面向会话模型；行为校验仍在 handler/domain 层（本表只做形态投影）。
 */
export const TODO_TOOL_PARAM_DECLS: Readonly<Record<string, ParamDecls>> = {
  todo_context: {},
  todo_task_list: {
    scope: { type: "string", enum: ["open", "done", "today", "all"], description: "列表口径，默认 open" },
    limit: { type: "integer", description: "截断上限，默认 50" },
  },
  todo_task_get: {
    id: { type: "integer", required: true, description: "待办 id" },
  },
  todo_task_search: {
    query: { type: "string", required: true, description: "搜索词（标题/备注/跟进/标签名）" },
  },
  todo_task_create: {
    title: { type: "string", required: true, description: "标题（非空）" },
    category: { type: "string", description: "分类名（须来自词表，先 todo_context 查）" },
    due: { type: "string", description: "截止时间 RFC3339；提供即 scheduled，缺省 inbox" },
    priority: { type: "string", description: "优先级（词表口径）" },
    tags: { type: "string[]", description: "标签名清单（须来自词表）" },
    note: { type: "string", description: "备注" },
    dryRun: { type: "boolean", description: "true = 只校验回显不落库" },
  },
  todo_task_update: {
    id: { type: "integer", required: true, description: "待办 id" },
    title: { type: "string", description: "新标题" },
    note: { type: "string", description: "新备注" },
    due: { type: "string", description: "新截止；空串 = 清空" },
    priority: { type: "string", description: "新优先级" },
    category: { type: "string", description: "新分类名" },
    tags: { type: "string[]", description: "新标签名清单" },
  },
  todo_task_done: {
    id: { type: "integer", required: true, description: "待办 id" },
  },
  todo_task_undone: {
    id: { type: "integer", required: true, description: "待办 id" },
  },
  todo_task_start: {
    id: { type: "integer", required: true, description: "待办 id（全局唯一进行中）" },
  },
  todo_task_pause: {
    id: { type: "integer", description: "待办 id；缺省 = 当前进行中" },
  },
  todo_task_current: {},
  todo_task_delete: {
    id: { type: "integer", required: true, description: "待办 id（放生：级联清理 + 审计墓碑）" },
  },
  todo_task_escape: {
    id: { type: "integer", required: true, description: "待办 id（逃走留档可恢复）" },
  },
  todo_note_add: {
    taskId: { type: "integer", required: true, description: "待办 id" },
    content: { type: "string", required: true, description: "跟进内容（假名真名还原后落库）" },
    source: { type: "string", description: "来源标注" },
  },
  todo_tag_list: {},
  todo_tag_create: {
    name: { type: "string", required: true, description: "标签名" },
    dimension: { type: "string", required: true, description: "归属维度（须为启用维度）" },
  },
  todo_suggest_batch: {
    results: {
      type: "json[]",
      required: true,
      description:
        "AiSuggestion[]（PROTOCOL §3）：{messageId, action: todo|update|followUp|none, title?, note?, " +
        "category?, priority?, due?, tags?: [{name, dimension?, isNew?}], followUpTaskId?, updateTaskId?, " +
        "reason?, confidence?}——整批强校验，任一违规整批拒绝",
    },
  },
  todo_dispatch_done: {
    taskId: { type: "integer", required: true, description: "派发中的待办 id" },
    note: { type: "string", description: "成功反馈备注" },
  },
  todo_dispatch_fail: {
    taskId: { type: "integer", required: true, description: "派发中的待办 id" },
    note: { type: "string", description: "失败原因（入审计）" },
  },
  todo_session_log: {
    agentId: { type: "string", required: true, description: "agent 标识" },
    taskId: { type: "integer", description: "关联待办 id（可空）" },
    sessionId: { type: "string", description: "会话 id" },
    costUsd: { type: "number", description: "成本（美元）" },
    durationMs: { type: "integer", description: "时长（毫秒）" },
    exitCode: { type: "integer", description: "退出码（>0 记 error）" },
  },
  todo_pet_hide: {},
  todo_pet_show: {},
};

/**
 * 参数声明集 → dsh JSON DSL 参数表（纯函数；返回结构可直接作为 defineTool 的
 * parameters——完整性由单测锁两向一致）。未登记的工具名映射为空参数表（无参工具）。
 */
export function toDslParameters(decls: ParamDecls): Record<string, DslNode> {
  const out: Record<string, DslNode> = {};
  for (const [key, decl] of Object.entries(decls)) {
    out[key] = toDslNode(decl);
  }
  return out;
}

function toDslNode(decl: ParamDecl): DslNode {
  // 显式注解防字面量拓宽（required: boolean 会被判别联合拒绝——dsh 侧要求字面 true）
  const required: { required?: true } = decl.required === true ? { required: true } : {};
  const description: { description?: string } = decl.description === undefined ? {} : { description: decl.description };
  switch (decl.type) {
    case "string":
      return {
        type: "string",
        ...required,
        ...description,
        ...(decl.enum === undefined ? {} : { enum: decl.enum }),
      };
    case "integer":
    case "number":
      return { type: decl.type, ...required, ...description };
    case "boolean":
      return { type: "boolean", ...required, ...description };
    case "string[]":
      return { type: "array", ...required, ...description, items: { type: "string" } };
    case "json[]":
      return { type: "array", ...required, ...description, items: { type: "json" } };
  }
}
