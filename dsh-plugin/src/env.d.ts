// vite ?raw 资源模块的环境类型（__tests__ 以 `import x from "....sql?raw"` 编译期加载契约 SQL）。
// 自声明而非引 vite/client：本包不直接依赖 vite（经 vitest 传递），类型面自包含。
declare module "*?raw" {
  const content: string;
  export default content;
}

// CSS Modules（client 半边 scoped 样式；vitest css:false 下导入返回类名映射代理）
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

// 主应用宝可梦名录（@app-pokemon alias → 仓根 src/pokemon；vite/esbuild 原生 json loader，
// 类型面在此自声明——tsconfig 不开 resolveJsonModule 以维持主仓口径一致）
declare module "@app-pokemon/catalog.json" {
  const catalog: { v: number; entries: [number, string, string, string, string][] };
  export default catalog;
}
