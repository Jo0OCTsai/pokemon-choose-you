/**
 * 抽屉测试公共件：TaskDetailDrawer 渲染壳 + mockHost 装配
 * （drawer.spec 与 drawer-followups.spec 共用；对照 reviewWizardHarness 手法）。
 */
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ClientProvider } from "../../src/client/clientContext";
import { I18nProvider } from "../../src/client/i18n";
import { mockHost, type MockHostState } from "../../src/client/rpc";
import { TaskDetailDrawer } from "../../src/client/tasks/TaskDetailDrawer";
import { makeData, makeTask } from "./fixtures";

export function renderDrawer(taskId = 1, data = makeData(), initial: Partial<MockHostState> = {}) {
  const host = mockHost({ tasks: data.tasks, ...initial });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const task = data.tasks.find((t) => t.id === taskId) ?? makeTask({ id: taskId });
  render(
    <ClientProvider client={host}>
      <I18nProvider locale="zh-Hans">
        <TaskDetailDrawer
          task={task}
          data={data}
          categories={data.categories}
          onClose={onClose}
          onChanged={onChanged}
        />
      </I18nProvider>
    </ClientProvider>,
  );
  return { host, onClose, onChanged };
}
