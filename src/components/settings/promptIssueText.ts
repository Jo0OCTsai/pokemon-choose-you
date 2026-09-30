import type { PromptIssue } from "../../composables/usePromptEditor";

/**
 * 校验/呈现问题 → i18n 文案（PromptFeaturePanel 的编辑校验区与查看态遗留问题行共用；
 * 分级着色走 usePromptEditor 的 promptIssueLevel，单源在各消费组件）。
 */
export function promptIssueText(
  t: (key: string, named?: Record<string, unknown>) => string,
  issue: PromptIssue,
): string {
  switch (issue.kind) {
    case "missing":
      return t("prompts.vMissing", { names: issue.names.join(", ") });
    case "overlong":
      return t("prompts.vOverlong", { n: issue.count });
    case "blank":
      return t("prompts.vBlank");
    case "sameDefault":
      return t("prompts.vSameDefault");
    case "unknown":
      return t("prompts.vUnknown", { names: issue.names.join(", ") });
    case "saveFailed":
      return t("prompts.saveFailed", { err: issue.message });
  }
}
