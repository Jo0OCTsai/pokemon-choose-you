/**
 * pk 使用技能文件的内嵌单源（对齐主应用 src-tauri/src/skills.rs 的 include_str 分发）：
 * 源文件在主仓 src-tauri/skills/，经 `?raw` 编译期内嵌进 host 产物——安装形态
 * （profile node_modules）磁盘相对路径不可达，技能安装不依赖主应用安装（schema-raw
 * 同款链路）。字节同源：__tests__/skills.spec.ts 与磁盘文件比对断言。
 */
import skillMd from "../../../src-tauri/skills/pokemon-choose-you.md?raw";
import commandsMd from "../../../src-tauri/skills/references/commands.md?raw";
import workflowMd from "../../../src-tauri/skills/references/suggest-workflow.md?raw";

/** 安装目标相对路径 → 内嵌内容（local_install 的 (rel, content) 对同构） */
export const SKILL_FILES: ReadonlyArray<readonly [string, string]> = [
  ["SKILL.md", skillMd],
  ["references/commands.md", commandsMd],
  ["references/suggest-workflow.md", workflowMd],
];

/** 主文件原文（frontmatter 版本号解析用；skills.rs SKILL_MD 同位） */
export const SKILL_MD: string = skillMd;
