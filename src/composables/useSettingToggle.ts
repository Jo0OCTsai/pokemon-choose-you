import { computed } from "vue";
import { useSettingsStore } from "../stores/settings";

/**
 * 复选框 ↔ 字符串设置项 的双向绑定（原 SettingsTab 的 boolSetting 工厂抽出，读写时机不变）：
 * get 读 store 的 sget 合并视图；set 即时写 values 缓冲（不落库），持久化仍随「保存设置」。
 * store 是 pinia 单例，各分区组件各自调用拿到同一实例，与原单处定义等价。
 */
export function useSettingToggle(key: string) {
  const settings = useSettingsStore();
  return computed({
    get: () => settings.sget(key) === "true",
    set: (v: boolean) => (settings.values[key] = v ? "true" : "false"),
  });
}
