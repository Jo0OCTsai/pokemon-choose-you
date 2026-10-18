/**
 * ~/.ssh/config 的 Host 别名解析（部署表单下拉数据源）：部署实体以 OpenSSH 别名为
 * 连接键（凭据由别名承载），本模块把本机 config 中可选的确定性别名枚举给客户端。
 * 纯文本解析 + 单次文件读，零 dsh 依赖（remote/ 不变量）。不展开 Include 指令
 * （含 glob 形态——记 docs/debt.md，主 config 直写的别名已覆盖当前用法）。
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 判定单个 Host 模式是否可选：通配（* / ?）、否定（!）、带引号形态一律剔除——
 * 只有确定性别名能作为部署目标（连接键须可被 dsh-ssh 严格复现） */
function isConcreteAlias(pattern: string): boolean {
  return !pattern.includes("*") && !pattern.includes("?") && !pattern.startsWith("!") && !pattern.startsWith('"');
}

/**
 * 解析 ssh_config 文本中的 Host 别名（纯函数）：
 * - 关键字大小写不敏感（Host / host）；一行多模式逐个提取；
 * - 行首 # 整行注释忽略（OpenSSH 口径：仅行首 # 是注释，参数内 # 不剥）；
 * - 通配 / 否定 / 引号模式剔除；去重保序（config 序 = ssh 优先序）。
 */
export function parseSshHostAliases(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    if (tokens[0]!.toLowerCase() !== "host") {
      continue;
    }
    for (const pattern of tokens.slice(1)) {
      if (isConcreteAlias(pattern) && !seen.has(pattern)) {
        seen.add(pattern);
        out.push(pattern);
      }
    }
  }
  return out;
}

/**
 * 读 <home>/.ssh/config 并解析别名；文件/目录缺席或不可读 = 空列表（表单呈现
 * 空态提示而非报错——config 缺席不是错误态，别名仍可经编辑既有部署保留）。
 */
export function readSshConfigAliases(homeDir: string = homedir()): string[] {
  try {
    return parseSshHostAliases(readFileSync(join(homeDir, ".ssh", "config"), "utf8"));
  } catch {
    return [];
  }
}
