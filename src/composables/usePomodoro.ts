import { computed, onUnmounted, ref } from "vue";
import { api } from "../api";
import { t } from "../i18n";
import { useSettingsStore } from "../stores/settings";

/** 从 PetApp 抽出的番茄钟状态机：倒计时、每分钟上报专注、番茄结束通知 + 短休息 */
export function usePomodoro(hooks: {
  /** 当前任务 id（上报专注用），null 时不计时 */
  currentId: () => number | null;
  currentTitle: () => string;
  /** 番茄专注结束（通知与气泡由调用方决定） */
  onFocusDone: (title: string) => void;
  onBreakStart: () => void;
  onBreakEnd: () => void;
}) {
  const settings = useSettingsStore();
  const remainSec = ref(25 * 60);
  const phase = ref<"focus" | "break">("focus");
  const running = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let reported = 0;

  const enabled = () => settings.sget("pomodoro_enabled") === "true";
  const pomoMinutes = () => settings.sgetNum("pomodoro_minutes", 25);
  const breakMinutes = () => settings.sgetNum("break_minutes", 5);

  const mmss = computed(() => {
    const m = Math.floor(remainSec.value / 60);
    const s = remainSec.value % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  });

  async function sendNotification(title: string, body: string) {
    try {
      const n = await import("@tauri-apps/plugin-notification");
      let granted = await n.isPermissionGranted();
      if (!granted) {
        granted = (await n.requestPermission()) === "granted";
      }
      if (granted) n.sendNotification({ title, body });
    } catch {
      /* 通知不可用时静默，桌宠气泡兜底 */
    }
  }

  function stopTick() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** 停表并退出计时状态（暂停任务 / 关闭番茄钟时用） */
  function stop() {
    stopTick();
    running.value = false;
  }

  function start() {
    if (hooks.currentId() == null) return;
    stopTick();
    phase.value = "focus";
    remainSec.value = pomoMinutes() * 60;
    reported = 0;
    running.value = true;
    timer = setInterval(onTick, 1000);
  }

  function startBreak() {
    stopTick();
    phase.value = "break";
    remainSec.value = breakMinutes() * 60;
    running.value = true;
    timer = setInterval(onTick, 1000);
    hooks.onBreakStart();
  }

  function onTick() {
    remainSec.value -= 1;
    if (phase.value === "focus") {
      const total = pomoMinutes() * 60;
      const elapsed = total - remainSec.value;
      if (elapsed - reported >= 60) {
        api.addFocusSeconds(hooks.currentId() ?? 0, elapsed - reported).catch(() => {});
        reported = elapsed;
      }
    }
    if (remainSec.value <= 0) {
      stopTick();
      if (phase.value === "focus") {
        hooks.onFocusDone(hooks.currentTitle());
        if (settings.sget("pomodoro_notify") === "true") {
          sendNotification(t("pet.pomoNotifTitle"), t("pet.pomoNotifBody", { t: hooks.currentTitle() }));
        }
        if (breakMinutes() > 0) {
          startBreak();
        }
      } else {
        running.value = false;
        hooks.onBreakEnd();
      }
    }
  }

  onUnmounted(stopTick);

  return { remainSec, phase, running, mmss, enabled, start, stop, stopTick, sendNotification };
}
