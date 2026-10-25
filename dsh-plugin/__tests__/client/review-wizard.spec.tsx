/**
 * 每周复盘向导 · 导航/总览/路线/草丛/收尾/入口（对照主应用 ReviewWizard.vue；标签体检
 * 见 review-wizard-tags.spec；公共夹具见 reviewWizardHarness）。收尾写 review_last_done +
 * 图鉴段入口（DexView 筛选行 🧢复盘，仅图鉴段、只读禁用）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost } from "../../src/client/rpc";
import { DexView } from "../../src/client/tasks/views";
import { flush, goStep, localToday, renderWizard, wizardData, wizardHost } from "./reviewWizardHarness";

afterEach(cleanup);

describe("五步导航与总览", () => {
  it("步骤条五步：总览 → 路线 → 草丛 → 标签体检 → 收尾", async () => {
    renderWizard();
    expect(screen.getByTestId("review-wizard").getAttribute("data-step")).toBe("0");
    expect(screen.getByText(/训练家复盘/)).toBeTruthy();
    await goStep(4);
    expect(screen.getByTestId("review-wizard").getAttribute("data-step")).toBe("4");
    expect(screen.getByText("🎉")).toBeTruthy();
    expect(screen.getByText("结束复盘")).toBeTruthy();
    // 取消按钮常驻；本周共收服 = weekDone(2) + 路线复盘完成数(0)
    expect(screen.getByText("取消")).toBeTruthy();
    expect(screen.getByText("本周共收服 2 只宝可梦！")).toBeTruthy();
  });

  it("总览统计：本周捕捉/专注(分)/路线上/草丛里 + 每分类条形", () => {
    renderWizard();
    expect(screen.getByTestId("review-stat-caught").textContent).toContain("2");
    expect(screen.getByTestId("review-stat-focus").textContent).toContain("40");
    expect(screen.getByTestId("review-stat-route").textContent).toContain("2");
    expect(screen.getByTestId("review-stat-grass").textContent).toContain("2");
    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.getByText("生活")).toBeTruthy();
  });

  it("取消按钮触发关闭回调（卸载由入口方承接，见图鉴段入口用例）", async () => {
    const { onClose } = renderWizard();
    fireEvent.click(screen.getByText("取消"));
    await flush();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("路线复盘（Step 1）", () => {
  it("任务卡字段 + 当天过期标红（等急了）+ 主按钮变跳过路线", async () => {
    renderWizard();
    await goStep(1);
    expect(screen.getByText("No.003")).toBeTruthy();
    expect(screen.getByText("逾期路线任务")).toBeTruthy();
    expect(screen.getByText(/等急了/)).toBeTruthy();
    expect(screen.getByText("路线备注")).toBeTruthy();
    expect(screen.getByText("高")).toBeTruthy(); // priority.high
    expect(screen.getByText(/1 \/ 2/)).toBeTruthy(); // 进度提示
    expect(screen.getByText("跳过路线")).toBeTruthy();
  });

  it("✔完成 → taskUpdate status:done + onChanged 刷新；计数进收尾", async () => {
    const { host, onChanged } = renderWizard();
    await goStep(1);
    fireEvent.click(screen.getByText("✔ 完成"));
    await flush();
    expect(host.calls).toContainEqual({ command: "taskUpdate", params: { id: 3, status: "done" } });
    expect(onChanged).toHaveBeenCalled();
    await goStep(4);
    expect(screen.getByText("本周共收服 3 只宝可梦！")).toBeTruthy();
  });

  it("归草丛 → taskUpdate dueAt:null；逃走 → taskUpdate status:cancelled", async () => {
    const first = renderWizard();
    await goStep(1);
    fireEvent.click(screen.getByText("归草丛"));
    await flush();
    expect(first.host.calls).toContainEqual({ command: "taskUpdate", params: { id: 3, dueAt: null } });

    cleanup();
    const second = renderWizard();
    await goStep(1);
    fireEvent.click(screen.getByText("🚪 逃走"));
    await flush();
    expect(second.host.calls).toContainEqual({ command: "taskUpdate", params: { id: 3, status: "cancelled" } });
  });

  it("保留仅指针 +1（不发命令），指向下一只", async () => {
    const { host } = renderWizard();
    await goStep(1);
    fireEvent.click(screen.getByText("保留"));
    await flush();
    expect(host.calls.filter((c) => c.command === "taskUpdate")).toHaveLength(0);
    expect(screen.getByText("No.007")).toBeTruthy();
  });
});

describe("草丛归位（Step 2）", () => {
  it("全选 → 批量放生（逐只 taskDelete 串行）→ 计数提示", async () => {
    const { host, onChanged } = renderWizard();
    await goStep(2);
    const toggleAll = (screen.getByText(/全选草丛/) as HTMLLabelElement).querySelector("input") as HTMLInputElement;
    fireEvent.click(toggleAll);
    fireEvent.click(screen.getByText(/批量放生/));
    await flush();
    expect(host.calls).toContainEqual({ command: "taskDelete", params: { taskId: 4 } });
    expect(host.calls).toContainEqual({ command: "taskDelete", params: { taskId: 5 } });
    expect(screen.getByText("已放生 2 只")).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("单选一只只放生", async () => {
    const { host } = renderWizard();
    await goStep(2);
    fireEvent.click(screen.getByLabelText("草丛乙"));
    fireEvent.click(screen.getByText(/批量放生/));
    await flush();
    expect(host.calls).toContainEqual({ command: "taskDelete", params: { taskId: 5 } });
    expect(host.calls.filter((c) => c.command === "taskDelete")).toHaveLength(1);
  });
});

describe("收尾（Step 4）与图鉴段入口", () => {
  it("结束复盘 → configWrite review_last_done（本地日期）+ 回读刷新 + 关闭", async () => {
    const { host, onChanged, onClose } = renderWizard();
    await goStep(4);
    fireEvent.click(screen.getByText("结束复盘"));
    await flush();
    expect(host.calls).toContainEqual({
      command: "configWrite",
      params: { keyValues: { review_last_done: localToday() } },
    });
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("图鉴段筛选行 🧢复盘 入口打开向导；关闭即重置；只读态禁用", async () => {
    const host = wizardHost();
    const data = wizardData();
    const onChanged = vi.fn();
    render(
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">
          <DexView data={data} readonly={false} onOpen={() => undefined} onChanged={onChanged} />
        </I18nProvider>
      </ClientProvider>,
    );
    fireEvent.click(screen.getByText("🧢 复盘"));
    await flush();
    expect(screen.getByTestId("review-wizard")).toBeTruthy();
    // 关闭即卸载（向导状态全内存态，重开重置）
    fireEvent.click(screen.getByText("取消"));
    await flush();
    expect(screen.queryByTestId("review-wizard")).toBeNull();

    cleanup();
    render(
      <ClientProvider client={host}>
        <I18nProvider locale="zh-Hans">
          <DexView data={data} readonly={true} onOpen={() => undefined} onChanged={onChanged} />
        </I18nProvider>
      </ClientProvider>,
    );
    expect((screen.getByText("🧢 复盘") as HTMLButtonElement).disabled).toBe(true);
  });

  it("空词表报告也可走完向导（全空 → 词表很健康）", async () => {
    renderWizard(wizardData(), mockHost());
    await goStep(4);
    expect(screen.getByText("结束复盘")).toBeTruthy();
  });
});
