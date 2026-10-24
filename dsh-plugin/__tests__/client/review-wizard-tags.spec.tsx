/**
 * 每周复盘向导 · 标签体检步（Step 3，对照主应用 ReviewWizard.vue 同段）：进入自动跑
 * tagCheckup、三组建议渲染（近义合并/僵尸/新维度）、合并 → tagMerge、放生僵尸 →
 * tagDelete、采纳新维度 → tagMoveDimension（按名解析 id + slug 作 key）、全空健康态
 * 与未判定脚注。公共夹具见 reviewWizardHarness。
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockHost } from "../../src/client/rpc";
import { flush, goStep, renderWizard, wizardData } from "./reviewWizardHarness";

afterEach(cleanup);

describe("标签体检（Step 3）", () => {
  it("进入自动跑 tagCheckup，渲染三组建议 + 未判定脚注", async () => {
    const { host } = renderWizard();
    await goStep(3);
    expect(host.calls.map((c) => c.command)).toContain("tagCheckup");
    expect(screen.getByText(/「周报」→「工作周报」/)).toBeTruthy();
    expect(screen.getByText(/主题 · 90%/)).toBeTruthy();
    expect(screen.getByText(/# 幻觉标签/)).toBeTruthy();
    expect(screen.getByText(/Energy：深度工作、碎片处理/)).toBeTruthy();
    expect(screen.getByText(/本地相似度预筛/)).toBeTruthy();
  });

  it("合并 → tagMerge + 行移除；放生僵尸 → tagDelete", async () => {
    const { host } = renderWizard();
    await goStep(3);
    fireEvent.click(screen.getByText("合并"));
    await flush();
    expect(host.calls).toContainEqual({ command: "tagMerge", params: { fromId: 11, intoId: 12 } });
    expect(screen.queryByText(/「周报」→「工作周报」/)).toBeNull();

    fireEvent.click(screen.getByText("放生"));
    await flush();
    expect(host.calls).toContainEqual({ command: "tagDelete", params: { id: 13 } });
    expect(screen.queryByText(/# 幻觉标签/)).toBeNull();
  });

  it("忽略合并/保留僵尸为本地行移除（不发命令）", async () => {
    const { host } = renderWizard();
    await goStep(3);
    fireEvent.click(screen.getAllByText("忽略")[0]);
    await flush();
    expect(screen.queryByText(/「周报」→「工作周报」/)).toBeNull();
    fireEvent.click(screen.getByText("保留"));
    await flush();
    expect(screen.queryByText(/# 幻觉标签/)).toBeNull();
    expect(host.calls.filter((c) => c.command !== "tagCheckup")).toHaveLength(0);
  });

  it("采纳新维度：按名解析 id + slug 作 key + 行移除", async () => {
    const { host } = renderWizard();
    await goStep(3);
    fireEvent.click(screen.getByText("采纳"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "tagMoveDimension",
      params: { tagIds: [21, 22], key: "energy", name: "Energy" },
    });
    expect(screen.queryByText(/Energy：深度工作、碎片处理/)).toBeNull();
  });

  it("全空报告显示词表很健康", async () => {
    renderWizard(wizardData(), mockHost());
    await goStep(3);
    expect(screen.getByText(/词表很健康/)).toBeTruthy();
    expect(screen.getByText(/本地相似度预筛/)).toBeTruthy();
  });
});
