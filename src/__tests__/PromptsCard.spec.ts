import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PromptsCard from "../components/settings/PromptsCard.vue";
import { api } from "../api";
import { i18n } from "../i18n";
import { ACTION_TOAST, useActionToast } from "../composables/useActionToast";
import type { PromptSpecInfo } from "../types";

function makeSpec(over: Partial<PromptSpecInfo> = {}): PromptSpecInfo {
  return {
    id: "im_classify",
    storageKey: "ai_prompt_im_classify",
    editable: true,
    defaultText: "默认判定器 <AGENT_ID>",
    requiredPlaceholders: ["<AGENT_ID>"],
    lengthLimit: 20000,
    overrideText: null,
    source: "default",
    missingPlaceholders: [],
    overlong: false,
    ...over,
  };
}

const SPECS: PromptSpecInfo[] = [
  makeSpec(),
  makeSpec({
    id: "capture",
    storageKey: "ai_prompt_capture",
    defaultText: "快速捕捉默认 <AGENT_ID>",
  }),
  makeSpec({
    id: "pet_chat",
    storageKey: "ai_prompt_pet_chat",
    defaultText: "桌宠默认 <CONTEXT> <QUESTION>",
    requiredPlaceholders: ["<CONTEXT>", "<QUESTION>"],
    overrideText: "自定义桌宠 <CONTEXT> <QUESTION>",
    source: "custom",
  }),
  makeSpec({
    id: "tag_health",
    storageKey: "ai_prompt_tag_health",
    defaultText: "标签治理指令",
    requiredPlaceholders: [],
  }),
  makeSpec({
    id: "dispatch",
    storageKey: null,
    editable: false,
    defaultText: "派发示例结构",
    requiredPlaceholders: [],
  }),
];

vi.mock("../api", () => ({
  api: {
    listAiPromptSpecs: vi.fn(async () => SPECS),
    saveAiPrompt: vi.fn(async () => ({ spec: SPECS[0], unknownPlaceholders: [] })),
  },
  errorMessage: vi.fn((e: unknown) => String(e)),
}));

vi.mock("../contextMenu", () => ({
  clipWrite: vi.fn(async () => true),
  openContextMenu: vi.fn(),
}));

async function mountCard() {
  const toast = useActionToast();
  const w = mount(PromptsCard, {
    global: { plugins: [i18n], provide: { [ACTION_TOAST]: toast } },
  });
  await new Promise((r) => setTimeout(r));
  return w;
}

/** 取指定功能的面板组件（v-for 顺序 = SPECS 顺序） */
function panelOf(w: Awaited<ReturnType<typeof mountCard>>, id: string) {
  const idx = SPECS.findIndex((s) => s.id === id);
  return w.findAll(".panel")[idx];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PromptsCard 装载与读取失败", () => {
  it("装载后渲染 5 个功能折叠面板（目录顺序），默认全部折叠", async () => {
    const w = await mountCard();
    const heads = w.findAll(".panel-name").map((n) => n.text());
    expect(heads).toEqual(["IM 分类", "快速捕捉", "桌宠对话", "标签治理", "待办派发"]);
    expect(w.findAll(".panel-head").every((h) => h.attributes("aria-expanded") === "false")).toBe(true);
  });

  it("读取失败显示错误行与重试，重试成功后面板呈现", async () => {
    vi.mocked(api.listAiPromptSpecs).mockRejectedValueOnce(new Error("db 繁忙"));
    const w = await mountCard();
    expect(w.get(".load-error .err-text").text()).toContain("db 繁忙");
    expect(w.findAll(".panel")).toHaveLength(0);
    await w.get(".load-error .btn").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(w.find(".load-error").exists()).toBe(false);
    expect(w.findAll(".panel")).toHaveLength(5);
  });
});

describe("PromptsCard 查看态：徽章/生效标签/警示", () => {
  it("徽章与生效标签：default「内置默认/当前生效」，custom「自定义/当前生效 · 自定义」+ 恢复默认与对照入口，派发「只读」无编辑钮", async () => {
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    expect(im.get(".badge.b-default").text()).toBe("内置默认");
    await im.get(".panel-head").trigger("click");
    expect(im.get(".lcd-tag").text()).toBe("当前生效");
    expect(im.get(".view-lcd").text()).toBe(SPECS[0].defaultText);
    expect(im.text()).not.toContain("恢复默认…");
    expect(im.text()).not.toContain("内置默认对照");

    const pet = panelOf(w, "pet_chat");
    expect(pet.get(".badge.b-custom").text()).toBe("自定义");
    await pet.get(".panel-head").trigger("click");
    expect(pet.get(".lcd-tag").text()).toBe("当前生效 · 自定义");
    expect(pet.get(".view-lcd").text()).toBe(SPECS[2].overrideText);
    expect(pet.text()).toContain("恢复默认…");
    expect(pet.text()).toContain("内置默认对照 ▾");

    const dis = panelOf(w, "dispatch");
    expect(dis.get(".badge.b-readonly").text()).toBe("只读");
    await dis.get(".panel-head").trigger("click");
    expect(dis.text()).toContain("不可信消息的隔离结构");
    expect(dis.get(".act-row").text()).toBe(""); // 无编辑/恢复默认/对照任何操作钮
    expect(dis.findAll(".chip")).toHaveLength(0); // 占位符空集不渲染该行
  });

  it("警示态：default_warned 带警示徽章、警示行列缺失占位符、查看屏回落默认、编辑预填覆盖原文", async () => {
    vi.mocked(api.listAiPromptSpecs).mockResolvedValueOnce([
      makeSpec({
        overrideText: "旧版覆盖，缺占位符",
        source: "default_warned",
        missingPlaceholders: ["<AGENT_ID>"],
      }),
      ...SPECS.slice(1),
    ]);
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    expect(im.get(".badge.b-warn").text()).toBe("⚠ 不可用");
    await im.get(".panel-head").trigger("click");
    expect(im.get(".warn-line").text()).toContain("<AGENT_ID>");
    expect(im.get(".view-lcd").text()).toBe(SPECS[0].defaultText); // 生效文本回落默认
    await im.get(".act-row .btn").trigger("click"); // 编辑
    expect((im.get("textarea").element as HTMLTextAreaElement).value).toBe("旧版覆盖，缺占位符");
  });
});

describe("PromptsCard 编辑会话与校验", () => {
  it("编辑会话：进入编辑预填 + aria-label，修改亮未保存徽章，取消丢弃回查看态", async () => {
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".act-row .btn").trigger("click");
    const ta = im.get("textarea").element as HTMLTextAreaElement;
    expect(ta.value).toBe(SPECS[0].defaultText);
    expect(ta.getAttribute("aria-label")).toBe("编辑IM 分类提示词");
    expect(im.find(".editor-warn").exists()).toBe(true); // 常驻警示条
    await im.get("textarea").setValue("改过的判定器 <AGENT_ID>");
    expect(im.get(".badge.b-unsaved").text()).toBe("未保存");
    const btns = im.findAll(".act-row .btn");
    await btns[btns.length - 1].trigger("click"); // 取消
    expect(im.find("textarea").exists()).toBe(false);
    expect(im.find(".badge.b-unsaved").exists()).toBe(false);
    expect(im.get(".view-lcd").text()).toBe(SPECS[0].defaultText);
  });

  it("校验阻断：删占位符出现红色阻断文案且保存禁用，chip 插入后恢复可用", async () => {
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".act-row .btn").trigger("click");
    await im.get("textarea").setValue("没有占位符");
    expect(im.get(".v-block").text()).toContain("<AGENT_ID>");
    expect(im.findAll(".act-row .btn")[0].attributes("disabled")).toBeDefined();
    expect(im.get(".chip.missing").text()).toBe("<AGENT_ID>"); // 缺失签名态
    await im.get(".chip").trigger("click"); // 占位符行编辑态仍渲染（面板级常驻）且可插入
    expect((im.get("textarea").element as HTMLTextAreaElement).value).toContain("<AGENT_ID>");
    expect(im.find(".v-block").exists()).toBe(false);
    expect(im.findAll(".act-row .btn")[0].attributes("disabled")).toBeUndefined();
  });

  it("中性预告不阻断：空白给恢复默认预告，保存走 save(key, value)", async () => {
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".act-row .btn").trigger("click");
    await im.get("textarea").setValue("   ");
    expect(im.get(".v-info").text()).toContain("内置默认");
    await im.findAll(".act-row .btn")[0].trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.saveAiPrompt).toHaveBeenCalledWith("ai_prompt_im_classify", "   ");
  });
});

describe("PromptsCard 保存", () => {
  it("保存成功：徽章随响应切换，成功提示行 + 未知占位符警告，面板回查看态", async () => {
    const saved = makeSpec({ overrideText: "新规则 <AGENT_ID>", source: "custom" });
    vi.mocked(api.saveAiPrompt).mockResolvedValueOnce({ spec: saved, unknownPlaceholders: ["<FOO>"] });
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".act-row .btn").trigger("click");
    await im.get("textarea").setValue("新规则 <AGENT_ID>");
    await im.findAll(".act-row .btn")[0].trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(im.get(".badge.b-custom").text()).toBe("自定义");
    expect(im.get(".ok-line").text()).toContain("IM 分类");
    expect(im.get(".v-warn").text()).toContain("<FOO>"); // 未知占位符警告（后端清单）
    expect(im.find("textarea").exists()).toBe(false);
  });

  it("保存失败：编辑态与缓冲保留，错误文案进校验区", async () => {
    vi.mocked(api.saveAiPrompt).mockRejectedValueOnce(new Error("长度超过上限"));
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".act-row .btn").trigger("click");
    await im.get("textarea").setValue("新规则 <AGENT_ID>");
    await im.findAll(".act-row .btn")[0].trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(im.find("textarea").exists()).toBe(true);
    expect((im.get("textarea").element as HTMLTextAreaElement).value).toBe("新规则 <AGENT_ID>");
    expect(im.get(".v-block").text()).toContain("长度超过上限");
  });
});

describe("PromptsCard 恢复默认与复制", () => {
  it("恢复默认两步确认：确认条 role=group 原位展开，取消收起，确认后清覆盖回默认态", async () => {
    const restored = makeSpec({
      id: "pet_chat",
      storageKey: "ai_prompt_pet_chat",
      overrideText: null,
      source: "default",
    });
    vi.mocked(api.saveAiPrompt).mockResolvedValueOnce({ spec: restored, unknownPlaceholders: [] });
    const w = await mountCard();
    const pet = panelOf(w, "pet_chat");
    await pet.get(".panel-head").trigger("click");
    await pet
      .findAll(".act-row .btn")
      .find((b) => b.text() === "恢复默认…")!
      .trigger("click");
    const bar = pet.get(".confirm-bar");
    expect(bar.attributes("role")).toBe("group");
    expect(bar.attributes("aria-label")).toBe("恢复默认确认");
    expect(bar.text()).toContain("将清除自定义内容");
    await bar.findAll(".btn")[1].trigger("click"); // 取消
    expect(pet.find(".confirm-bar").exists()).toBe(false);
    expect(pet.text()).toContain("恢复默认…");
    await pet
      .findAll(".act-row .btn")
      .find((b) => b.text() === "恢复默认…")!
      .trigger("click");
    await pet.get(".confirm-bar .confirm-primary").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(api.saveAiPrompt).toHaveBeenCalledWith("ai_prompt_pet_chat", "");
    expect(pet.get(".badge.b-default").text()).toBe("内置默认");
    expect(pet.get(".ok-line").text()).toContain("已恢复内置默认");
  });
});

describe("PromptsCard 折叠缓冲与复制", () => {
  it("编辑期间面板折叠再展开：缓冲与未保存徽章保留（面板级缓冲）", async () => {
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".act-row .btn").trigger("click");
    await im.get("textarea").setValue("折叠中暂存 <AGENT_ID>");
    await im.get(".panel-head").trigger("click"); // 折叠
    expect(im.get(".badge.b-unsaved").text()).toBe("未保存");
    await im.get(".panel-head").trigger("click"); // 展开
    expect((im.get("textarea").element as HTMLTextAreaElement).value).toBe("折叠中暂存 <AGENT_ID>");
  });

  it("复制全文：点击查看屏复制钮走剪贴板", async () => {
    const { clipWrite } = await import("../contextMenu");
    const w = await mountCard();
    const im = panelOf(w, "im_classify");
    await im.get(".panel-head").trigger("click");
    await im.get(".lcd-copy").trigger("click");
    await new Promise((r) => setTimeout(r));
    expect(clipWrite).toHaveBeenCalledWith(SPECS[0].defaultText);
  });
});
