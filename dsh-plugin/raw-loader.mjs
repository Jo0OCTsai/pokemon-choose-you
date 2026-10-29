import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * vite `?raw` 等价 loader（build.mjs 与 pk 打包/信封回放共用）：?raw 后缀解析为
 * 原文件内容字符串——contracts schema 与 agent-plugins 技能文档经此编译期内嵌。
 */
export const rawPlugin = {
  name: "contracts-raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
      namespace: "raw",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({
      contents: `export default ${JSON.stringify(readFileSync(args.path, "utf8"))};`,
      loader: "js",
    }));
  },
};
