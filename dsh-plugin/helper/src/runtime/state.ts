/**
 * runtime 只读状态面（从 impl.ts 拆出——棘轮 max-lines，等量迁移）：字段 + getter
 * 基类——protected 供 RuntimeImpl 写入，对外只读面由 HelperRuntime 契约束。
 */
import type { ActiveTask, Lang, QuickTask } from "../bridge/protocol.ts";
import { PET_IDLE_STATE, type PetState } from "../state/petState.ts";
import type { InputResponseView } from "./index.ts";

export abstract class RuntimeStateBase {
  protected petStateValue: PetState = PET_IDLE_STATE;
  protected langValue: Lang = "zh-Hans";
  protected activeTaskValue: ActiveTask | null = null;
  protected todayTasksValue: QuickTask[] = [];
  protected reducedMotionValue = false;
  protected petVisibleValue = true;
  protected perchedValue = false;
  protected inputResponseValue: InputResponseView = { enabled: false, hopCoupleMax: 0 };
  protected petConfigValue: { mate: boolean; agentConfigured: boolean } = { mate: false, agentConfigured: true };

  get petState(): PetState {
    return this.petStateValue;
  }
  get lang(): Lang {
    return this.langValue;
  }
  get activeTask(): ActiveTask | null {
    return this.activeTaskValue;
  }
  get todayTasks(): QuickTask[] {
    return this.todayTasksValue;
  }
  get reducedMotion(): boolean {
    return this.reducedMotionValue;
  }
  get petVisible(): boolean {
    return this.petVisibleValue;
  }
  get inputResponse(): InputResponseView {
    return this.inputResponseValue;
  }
  get petConfig(): { mate: boolean; agentConfigured: boolean } {
    return this.petConfigValue;
  }
}
