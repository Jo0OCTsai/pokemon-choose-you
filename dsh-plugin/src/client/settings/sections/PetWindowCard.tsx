/**
 * 桌宠窗口行为卡（P1 D5/D6，从 PetSection 拆出——棘轮 max-lines 等量迁移）：
 * 置顶开关 + 缩放档 + 透明度档（写共享键，host 写后即推 sys-config）+ 重置位置动作
 * + 首启进度 hook（P1 D7：一次性进度链，仅在下载/解压活跃阶段续询、自动终止）。
 */
import { useEffect, useState } from "react";
import { useClient } from "../../clientContext";
import { useT } from "../../i18n";
import type { HostClient } from "../../rpcTypes";
import { Select, Toggle } from "../../ui/controls";
import ui from "../../ui/ui.module.css";
import type { SectionProps } from "../sectionProps";
import styles from "../settings.module.css";
import { PET_OPACITIES, PET_SCALES } from "../optionSets";

/** Electron 首启进度（P1 D7）：未运行时查询阶段，活跃（下载/解压）才续询——面板无周期性自动动作纪律 */
export function usePetSetupPhase(client: HostClient, petRunning: boolean | null): "downloading" | "extracting" | null {
  const [phase, setPhase] = useState<"downloading" | "extracting" | null>(null);
  useEffect(() => {
    if (petRunning !== false) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      void client.petSetupProgress().then((r) => {
        if (!alive || !r.ok) return;
        const next = r.data.phase === "downloading" || r.data.phase === "extracting" ? r.data.phase : null;
        setPhase(next);
        if (next !== null) timer = setTimeout(poll, 1_000);
      });
    };
    poll();
    return () => {
      alive = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [client, petRunning]);
  return phase;
}

export function PetWindowCard({ draft, onField }: Pick<SectionProps, "draft" | "onField">): React.JSX.Element {
  const client = useClient();
  const t = useT();
  return (
    <div className={ui.card}>
      <h4 className={styles.cardTitle}>{t("dsh.pet.windowTitle")}</h4>
      <Toggle
        label={t("dsh.pet.alwaysOnTop")}
        tip={t("dsh.pet.alwaysOnTopDesc")}
        checked={draft["pet_always_on_top"] !== "false"}
        onChange={(v) => onField("pet_always_on_top", String(v))}
      />
      <Select
        label={t("dsh.pet.scale")}
        tip={t("dsh.pet.scaleDesc")}
        value={draft["pet_scale"] ?? "1"}
        options={PET_SCALES.map((s) => ({ value: String(s), label: `${String(s)}×` }))}
        onChange={(v) => onField("pet_scale", v)}
      />
      <Select
        label={t("dsh.pet.opacity")}
        tip={t("dsh.pet.opacityDesc")}
        value={draft["pet_opacity"] ?? "100"}
        options={PET_OPACITIES.map((o) => ({ value: String(o), label: `${String(o)}%` }))}
        onChange={(v) => onField("pet_opacity", v)}
      />
      {/* 重置位置：清宿主记忆位 + helper 即刻回默认位 */}
      <div className={styles.filterRow} data-testid="pet-reset-row">
        <span style={{ flex: 1 }}>{t("dsh.pet.resetPos")}</span>
        <button
          type="button"
          className={ui.button}
          aria-label={t("dsh.pet.resetPos")}
          onClick={() => void client.petResetPos()}
        >
          {t("dsh.pet.resetPosGo")}
        </button>
      </div>
    </div>
  );
}
