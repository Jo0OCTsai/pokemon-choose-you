/**
 * 契约 SQL 的编译期内嵌（vite `?raw` 链路：vitest / 打包产物消费）。
 * 本模块只在 vite 管线下可加载；plain node 直跑时 migrate.ts 的 loader 回落 fs 读取
 * （双 loader 见 migrate.ts loadSchemaSql）。字节同源由 __tests__/migrate.spec.ts
 * 与磁盘文件比对断言（AD §4.4「schema 同源断言」）。
 */
import schema001 from "../../../../contracts/schema/001_v1.sql?raw";

/** 契约 schema 文件名 → 编译期内嵌内容（与 contracts/schema/ 目录一一对应） */
export default {
  "001_v1.sql": schema001,
} as const;
