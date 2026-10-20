/**
 * ~/.ssh/config 的 Host 别名解析（部署表单下拉数据源）：部署实体以 OpenSSH 别名为
 * 连接键（凭据由别名承载），本模块把本机 config 中可选的确定性别名枚举给客户端。
 * 纯文本解析 + 文件读，零 dsh 依赖（remote/ 不变量）。读侧展开 Include 指令，口径同
 * ssh_config(5)：glob 词典序、`~/` 展开到 home、相对路径挂 ~/.ssh、嵌套上限与 OpenSSH
 * 同为 16；已读文件不重入（环）。Host/Match 块内的条件 Include 不判条件一律展开——
 * 这里只枚举候选别名，宁多勿漏。
 */
import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** OpenSSH readconf.c MAX_READCONF_DEPTH 同值：主 config 为第 0 层，更深的 Include 静默跳过 */
const MAX_INCLUDE_DEPTH = 16;

/** 判定单个 Host 模式是否可选：通配（* / ?）、否定（!）、带引号形态一律剔除——
 * 只有确定性别名能作为部署目标（连接键须可被 dsh-ssh 严格复现） */
function isConcreteAlias(pattern: string): boolean {
  return !pattern.includes("*") && !pattern.includes("?") && !pattern.startsWith("!") && !pattern.startsWith('"');
}

/** Include 路径两端引号剥除（空白切分后只认整 token，含空白的引号路径不支持） */
function unquote(token: string): string {
  return token.length >= 2 && token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
}

/**
 * 逐行扫描 ssh_config 指令，只回调 Host / Include 两种关键字：
 * - 关键字大小写不敏感；行首 # 整行注释忽略（OpenSSH 口径：仅行首 # 是注释，参数内 # 不剥）。
 */
function scanDirectives(
  text: string,
  onHost: (patterns: string[]) => void,
  onInclude: (paths: string[]) => void,
): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const [keyword, ...args] = trimmed.split(/\s+/);
    const lowered = keyword!.toLowerCase();
    if (lowered === "host") {
      onHost(args);
    } else if (lowered === "include") {
      onInclude(args.map(unquote));
    }
  }
}

/** 去重保序的别名收集（config 序 = ssh 优先序；跨 Include 文件共享同一序列） */
function aliasSink(): { list: string[]; add: (patterns: string[]) => void } {
  const seen = new Set<string>();
  const list: string[] = [];
  return {
    list,
    add: (patterns) => {
      for (const pattern of patterns) {
        if (isConcreteAlias(pattern) && !seen.has(pattern)) {
          seen.add(pattern);
          list.push(pattern);
        }
      }
    },
  };
}

/**
 * 解析 ssh_config 文本中的 Host 别名（纯函数）：一行多模式逐个提取；通配 / 否定 / 引号
 * 模式剔除；去重保序。无文件上下文，Include 行按普通指令跳过——展开在读侧。
 */
export function parseSshHostAliases(text: string): string[] {
  const sink = aliasSink();
  scanDirectives(text, sink.add, () => undefined);
  return sink.list;
}

/** Include 路径 → 绝对路径候选：`~/` 展开到 home，相对路径挂 ~/.ssh，glob 结果词典序 */
function resolveIncludes(raw: string, homeDir: string): string[] {
  const expanded = raw.startsWith("~/") ? join(homeDir, raw.slice(2)) : raw;
  const absolute = isAbsolute(expanded) ? expanded : join(homeDir, ".ssh", expanded);
  return globSync(absolute).sort();
}

/**
 * 读 <home>/.ssh/config 并解析别名，Include 原位递归展开；文件/目录缺席或不可读 = 跳过
 * （主 config 缺席即空列表——表单呈现空态提示而非报错，别名仍可经编辑既有部署保留）。
 */
export function readSshConfigAliases(homeDir: string = homedir()): string[] {
  const sink = aliasSink();
  const visited = new Set<string>();
  const walk = (file: string, depth: number): void => {
    if (depth > MAX_INCLUDE_DEPTH || visited.has(file)) {
      return;
    }
    visited.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      return;
    }
    scanDirectives(text, sink.add, (paths) => {
      for (const path of paths) {
        for (const match of resolveIncludes(path, homeDir)) {
          walk(match, depth + 1);
        }
      }
    });
  };
  walk(join(homeDir, ".ssh", "config"), 0);
  return sink.list;
}
