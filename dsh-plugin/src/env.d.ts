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
