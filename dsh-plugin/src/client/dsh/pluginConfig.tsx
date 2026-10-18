/**
 * 插件私有配置消费面（dsh 宿主 Config schema 键：judgeExecutor / petAutoStart）。
 * 数据通道 = 客户端 configForms 服务（ui-settings 设置域基础服务）：读 = describe
 * 镜像快照（base/user 双层 + schema 校验），写 = set() 排队 → remote.settings →
 * 宿主 configEditor 落 profile patch（cordis.patch.yml；volatile 字段强校验 +
 * revision CAS + Loader 热应用）——与手写 patch 同层同效（真机验证）。
 * **背包为唯一编辑面**（用户裁决 2026-10-18：插件详情页回归纯信息页，原
 * plugins.bundle.config 槽已撤）：clientEntry 经 main 面板以 Context 注入分区行。
 * subscribe/getSnapshot 必须工厂期箭头绑定——ConfigFormController 是 class，React
 * 以裸函数调用回调，解绑即 this 丢失渲染崩（真机踩坑回归项）。
 */
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

/** configForms 快照（ConfigFormController.getSnapshot 形状） */
export interface ConfigFormSnapshot {
  status: "loading" | "ready" | "unavailable";
  value?: Record<string, unknown>;
  writable: boolean;
}

/** configForms scope（ui-settings ConfigFormController 消费面收窄） */
export interface ConfigFormScope {
  getSnapshot(): ConfigFormSnapshot;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<boolean>;
}

/** configForms 服务消费面（get(entryId) → 该 host entry 的 Config 表单 scope） */
export type ConfigFormsFace = { get(entryId: string): ConfigFormScope };

/** 本插件 host entry id（settings namespace = hostEntry 的 name 导出，与 cordis.patch.yml 的 id 同源） */
export const PLUGIN_CONFIG_NAMESPACE = "pokemon-choose-you";

/** 绑定 receiver 后的配置控制器（背包分区行消费面） */
export interface PluginConfigController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConfigFormSnapshot;
  set(field: string, value: unknown): Promise<boolean>;
}

/** 工厂：取本插件 scope 并绑定方法 receiver（返回稳定引用，供 Context/useSyncExternalStore） */
export function createPluginConfig(forms: ConfigFormsFace): PluginConfigController {
  const scope = forms.get(PLUGIN_CONFIG_NAMESPACE);
  return {
    subscribe: (listener) => scope.subscribe(listener),
    getSnapshot: () => scope.getSnapshot(),
    set: (field, value) => scope.set(field, value),
  };
}

/** 面板级 Context（缺席 = 组合无 configForms / 分区测试未包 provider——行不渲染） */
const PluginConfigContext = createContext<PluginConfigController | null>(null);

export function PluginConfigProvider({
  controller,
  children,
}: {
  controller: PluginConfigController | null;
  children: ReactNode;
}): React.JSX.Element {
  return <PluginConfigContext.Provider value={controller}>{children}</PluginConfigContext.Provider>;
}

export function usePluginConfig(): PluginConfigController | null {
  return useContext(PluginConfigContext);
}

/** controller 缺席态的固定快照（subscribe 为 noop——引用稳定满足 useSyncExternalStore） */
const ABSENT_SNAPSHOT: ConfigFormSnapshot = { status: "unavailable", writable: false };
const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;

/** 快照 hook：controller 经 Context 取（缺省 null → unavailable 固定形态） */
export function usePluginConfigSnapshot(controller: PluginConfigController | null): ConfigFormSnapshot {
  return useSyncExternalStore(
    controller?.subscribe ?? NOOP_SUBSCRIBE,
    controller?.getSnapshot ?? (() => ABSENT_SNAPSHOT),
    () => ABSENT_SNAPSHOT,
  );
}
