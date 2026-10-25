/**
 * 开通向导步进循环钩子（从 DeploymentCard.tsx 拆出——棘轮 max-lines，等量迁移）：
 * 拉式步进（provisionRun 单步同步返回 → 未完成自动推进；失败即停）；[中止] 标记
 * 经 abortRef（中止后循环停在当前态；再次开通幂等续跑）。restart（断开行的
 * 「重装远端组件」入口）：全 ok 快照也强制发起首步，由 provisionRun 重置重跑。
 */
import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { HostClient, ProvisionStatus, ProvisionStep } from "../../rpc";
import type { WizardLogLine } from "./DeploymentWizard";

/** 向导运行编排状态（挂在卡片上——Modal 关闭后后台继续，M8） */
export interface WizardState {
  id: string;
  open: boolean;
  running: boolean;
  runningStep: ProvisionStep | null;
  status: ProvisionStatus | null;
  log: WizardLogLine[];
  /** 本轮开跑前已完成步骤集（重跑呈现「跳过（已完成）」） */
  preCompleted: ReadonlySet<ProvisionStep>;
}

type WizardSetter = Dispatch<SetStateAction<WizardState | null>>;

/** 收束执行态（running/runningStep 归零；id 已切换则不动） */
function stopWizardRun(setWizard: WizardSetter, id: string): void {
  setWizard((prev) => (prev !== null && prev.id === id ? { ...prev, running: false, runningStep: null } : prev));
}

/** 失败收尾（log 追加失败行；失败步状态以 provisionStatus 为准——错误信封不带 step 数据） */
async function recordWizardFailure(
  client: HostClient,
  setWizard: WizardSetter,
  id: string,
  next: ProvisionStep,
  result: { ok: false; error: { message: string; hint?: string } },
): Promise<void> {
  const text =
    result.error.hint !== undefined ? `${result.error.message} — ${result.error.hint}` : result.error.message;
  setWizard((prev) => {
    if (prev === null || prev.id !== id) {
      return prev;
    }
    return {
      ...prev,
      running: false,
      runningStep: null,
      log: [...prev.log, { step: next, ok: false, text }],
    };
  });
  // 失败步呈现以 provisionStatus 为准（纪要 §3 状态面消解）
  const failStatus = await client.provisionStatus({ id });
  if (failStatus.ok) {
    setWizard((prev) => (prev !== null && prev.id === id ? { ...prev, status: failStatus.data.status } : prev));
  }
}

/** 成功推进收尾（log 追加 ok 行 + 刷新状态；全步完成 → 收束 + 通知列表刷新） */
function recordWizardSuccess(
  setWizard: WizardSetter,
  onChanged: () => void,
  id: string,
  next: ProvisionStep,
  status: ProvisionStatus,
): void {
  const executed = status.steps.find((s) => s.step === next);
  setWizard((prev) => {
    if (prev === null || prev.id !== id) {
      return prev;
    }
    return {
      ...prev,
      status,
      log: [...prev.log, { step: next, ok: true, text: executed?.message ?? "" }],
    };
  });
  if (status.done) {
    stopWizardRun(setWizard, id);
    onChanged();
  }
}

/** 开跑编排（读 provisionStatus → 打开向导态 + 预完成集；返回呈现基准状态；restart 时预完成集置空——旧快照全 ok 会误标「跳过」） */
async function openWizardRun(
  client: HostClient,
  setWizard: WizardSetter,
  id: string,
  restart: boolean,
): Promise<ProvisionStatus | null> {
  const statusR = await client.provisionStatus({ id });
  const preStatus = statusR.ok ? statusR.data.status : null;
  const preCompleted = new Set<ProvisionStep>(
    restart ? [] : (preStatus?.steps ?? []).filter((s) => s.status === "ok").map((s) => s.step),
  );
  setWizard((prev) =>
    prev !== null && prev.id === id
      ? { ...prev, open: true, running: true, runningStep: null, status: preStatus ?? prev.status, preCompleted }
      : { id, open: true, running: true, runningStep: null, status: preStatus, log: [], preCompleted },
  );
  return preStatus;
}

/** 步进解析：下一未完成步；null = 无步可跑（forced = restart 首步强制发起——全 ok 快照会被 provisionRun 重置） */
function nextWizardStep(status: ProvisionStatus | null, forced: boolean): ProvisionStep | null {
  const found = status?.steps.find((s) => s.status !== "ok")?.step ?? null;
  return found ?? (forced ? "probe-ssh" : null);
}

/** 向导步进循环（拉式：单步同步返回 → 未完成自动推进；失败即停） */
export function useWizardRunner(deps: { client: HostClient; reload: () => void; onChanged: () => void }): {
  wizard: WizardState | null;
  runWizard: (id: string, opts?: { restart?: boolean }) => Promise<void>;
  abortRef: MutableRefObject<boolean>;
  setWizard: WizardSetter;
} {
  const { client, reload, onChanged } = deps;
  const abortRef = useRef(false);
  const [wizard, setWizard] = useState<WizardState | null>(null);

  const runWizard = useCallback(
    async (id: string, opts: { restart?: boolean } = {}) => {
      abortRef.current = false;
      const restart = opts.restart === true;
      let status = await openWizardRun(client, setWizard, id, restart);
      let forced = restart; // restart：全 ok 快照也强制发起首步（provisionRun 在重置后返回真实状态）
      for (;;) {
        if (abortRef.current) {
          stopWizardRun(setWizard, id);
          return;
        }
        const next = nextWizardStep(status, forced);
        if (next === null) {
          // 打开即全部完成（幂等重入）——收束执行态
          stopWizardRun(setWizard, id);
          return;
        }
        setWizard((prev) => (prev !== null && prev.id === id ? { ...prev, runningStep: next } : prev));
        const result = await client.provisionRun(restart ? { id, restart: true } : { id });
        forced = false;
        reload();
        if (!result.ok) {
          await recordWizardFailure(client, setWizard, id, next, result);
          return;
        }
        status = result.data.status;
        recordWizardSuccess(setWizard, onChanged, id, next, status);
        if (status.done) {
          return;
        }
      }
    },
    [client, reload, onChanged, setWizard],
  );

  return { wizard, runWizard, abortRef, setWizard };
}
