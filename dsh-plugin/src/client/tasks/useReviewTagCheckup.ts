/**
 * 复盘向导 · 标签体检状态机（Step 3 的 host 调用与本地行状态）：进入该步自动跑一次
 * tagCheckup（结果缓存在内存）；合并/放生/采纳经 doTagAction 壳——成功才回读刷新，
 * 失败信封保持行现状可重试；忽略/保留为纯本地行移除。
 * 采纳新维度按名解析 id（缺失跳过）、slug 作 key（非 ascii 回落 dim- 时间戳）。
 */
import { useCallback, useEffect, useState } from "react";
import type { Tag } from "../../host/domain/vocabulary-tags";
import { useClient } from "../clientContext";
import type { HostClient, TagCheckupReport } from "../rpc";

type MergeRow = TagCheckupReport["merges"][number];
type ZombieRow = TagCheckupReport["zombies"][number];
type DimRow = TagCheckupReport["newDimensions"][number];
type TagRow = MergeRow | ZombieRow | DimRow;
type RowSection = "merges" | "zombies" | "newDimensions";
type DropRow = (section: RowSection, row: TagRow) => void;

export interface TagCheckupState {
  checkup: TagCheckupReport | null;
  checking: boolean;
  error: string;
  tagBusy: boolean;
  runCheckup(): void;
  mergeTagRow(row: MergeRow): void;
  ignoreMerge(row: MergeRow): void;
  releaseZombie(row: ZombieRow): void;
  keepZombie(row: ZombieRow): void;
  adoptDimension(row: DimRow): void;
  ignoreDimension(row: DimRow): void;
}

/** 检查中/错误态随 hook；报告经 apply 回落调用方（缓存策略归调用方） */
function useCheckupFetch(client: HostClient): {
  checking: boolean;
  error: string;
  fetch(apply: (report: TagCheckupReport) => void): Promise<void>;
} {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const fetchReport = useCallback(
    async (apply: (report: TagCheckupReport) => void): Promise<void> => {
      setChecking(true);
      setError("");
      try {
        const result = await client.tagCheckup();
        if (result.ok) {
          apply(result.data);
        } else {
          setError(result.error.message);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setChecking(false);
      }
    },
    [client],
  );
  return { checking, error, fetch: fetchReport };
}

/** active = 当前处于体检步（进入时自动跑一次；重试走 runCheckup） */
export function useReviewTagCheckup(active: boolean, tags: Tag[], onChanged: () => void): TagCheckupState {
  const client = useClient();
  const [checkup, setCheckup] = useState<TagCheckupReport | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const { checking, error, fetch } = useCheckupFetch(client);

  /** 进入体检步自动跑一次（本次打开向导只跑一次，结果缓存在内存里） */
  useEffect(() => {
    if (active && checkup === null) {
      void fetch(setCheckup);
    }
  }, [active, checkup, fetch]);

  /** 治理动作统一壳：成功（true）才回读刷新；失败信封保持行现状可重试 */
  async function doTagAction(fn: () => Promise<boolean>): Promise<void> {
    if (tagBusy) return;
    setTagBusy(true);
    try {
      if (await fn()) {
        onChanged();
      }
    } finally {
      setTagBusy(false);
    }
  }
  const drop: DropRow = (section, row) =>
    setCheckup((prev) => (prev === null ? prev : { ...prev, [section]: prev[section].filter((x) => x !== row) }));

  return {
    checkup,
    checking,
    error,
    tagBusy,
    runCheckup: () => void fetch(setCheckup),
    mergeTagRow: (m) => void doTagAction(() => mergeRowOn(client, m, drop)),
    ignoreMerge: (m) => drop("merges", m),
    releaseZombie: (z) => void doTagAction(() => releaseZombieOn(client, z, drop)),
    keepZombie: (z) => drop("zombies", z),
    adoptDimension: (d) => void doTagAction(() => adoptDimensionOn(client, d, tags, drop)),
    ignoreDimension: (d) => drop("newDimensions", d),
  };
}

async function mergeRowOn(client: HostClient, m: MergeRow, drop: DropRow): Promise<boolean> {
  const result = await client.tagMerge({ fromId: m.fromId, intoId: m.intoId });
  if (!result.ok) return false;
  drop("merges", m);
  return true;
}

async function releaseZombieOn(client: HostClient, z: ZombieRow, drop: DropRow): Promise<boolean> {
  const result = await client.tagDelete({ id: z.id });
  if (!result.ok) return false;
  drop("zombies", z);
  return true;
}

/** 采纳新维度：名字转 slug 作 key（非 ascii 回落 dim- 时间戳），标签按名找 id 迁过去 */
async function adoptDimensionOn(client: HostClient, d: DimRow, tags: Tag[], drop: DropRow): Promise<boolean> {
  const ids = d.tags.map((name) => tags.find((x) => x.name === name)?.id).filter((v): v is number => v != null);
  if (ids.length === 0) {
    drop("newDimensions", d);
    return true;
  }
  const slug = d.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const key = slug || `dim-${Date.now().toString(36)}`;
  const result = await client.tagMoveDimension({ tagIds: ids, key, name: d.name });
  if (!result.ok) return false;
  drop("newDimensions", d);
  return true;
}
