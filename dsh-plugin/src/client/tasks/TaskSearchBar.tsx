/**
 * 任务分段共享搜索栏（对照主应用 TaskTab.vue 顶部搜索）：输入防抖 300ms 调
 * taskSearch（标题/备注/标签/跟进记录全文匹配），命中计数 / 无结果空态，结果复用
 * TaskList 渲染；搜索期间隐藏该视图常规内容（children），清空即恢复原视图。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Task } from "../../host/domain/tasks";
import { useClient } from "../clientContext";
import { useT } from "../i18n";
import type { PanelData } from "../model";
import { TaskList } from "./TaskList";
import styles from "./tasks.module.css";

/** 防抖窗（RPC 往返节流，dsh 形态增量——主应用直查无防抖） */
const SEARCH_DEBOUNCE_MS = 300;

export function TaskSearchShell({
  data,
  readonly,
  onOpen,
  onChanged,
  onEdit,
  children,
}: {
  data: PanelData;
  readonly: boolean;
  onOpen: (taskId: number) => void;
  onChanged: () => void;
  onEdit: (task: Task) => void;
  /** 非搜索态的常规分段内容（搜索时整体隐藏） */
  children: ReactNode;
}): React.JSX.Element {
  const t = useT();
  const client = useClient();
  const [query, setQuery] = useState("");
  /** null = 非搜索态（无结果面）；空数组 = 已查询且无命中 */
  const [results, setResults] = useState<Task[] | null>(null);
  const [searching, setSearching] = useState(false);
  /** 序号防在途回包乱序：清空/新输入后旧回包不再落地 */
  const seqRef = useRef(0);
  const trimmed = query.trim();
  const searchMode = trimmed !== "";

  useEffect(() => {
    if (trimmed === "") {
      seqRef.current += 1;
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void client.taskSearch({ query: trimmed }).then((result) => {
        if (seq !== seqRef.current) {
          return;
        }
        setResults(result.ok ? result.data.tasks : []);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, client]);

  return (
    <>
      <div className={styles.searchBar} data-testid="task-search">
        <input
          className={styles.searchInput}
          value={query}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        {searchMode && (
          <span className={styles.searchHint}>
            {searching ? t("search.searching") : t("search.resultCount", { n: results?.length ?? 0 })}
          </span>
        )}
      </div>
      {searchMode ? (
        results === null ? null : results.length === 0 ? (
          <div className={styles.emptyState}>{t("search.empty")}</div>
        ) : (
          <TaskList
            tasks={results}
            categories={data.categories}
            readonly={readonly}
            onOpen={onOpen}
            onChanged={onChanged}
            onEdit={onEdit}
          />
        )
      ) : (
        children
      )}
    </>
  );
}
