/**
 * 分区组件公共 props（保存制：草稿值由 SettingsSegment 持有，分区只读写字段与触发保存）。
 */
export interface SectionProps {
  /** 全量草稿（本分区经 onField 写自己的键） */
  draft: Record<string, string>;
  /** 已保存基线（dirty = 任一键离开基线） */
  saved: Record<string, string>;
  onField: (key: string, value: string) => void;
  onSavedKeys: (keys: string[], values: Record<string, string>) => void;
}
