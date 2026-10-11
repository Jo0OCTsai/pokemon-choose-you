/** storage/paths：CHOOSE_YOU_HOME 归一化根解析（与 db.rs app_home_from 同规则） */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appHomeFrom, dbFileFrom, DB_FILE, DEFAULT_HOME_DIR, HOME_ENV } from "../src/host/storage/paths";

describe("归一化根解析（db.rs app_home_from 同构）", () => {
  it("env 非空优先：直接作为根目录", () => {
    expect(appHomeFrom("/var/cy", "/Users/demo")).toBe("/var/cy");
  });

  it("env 空串视同未设：回落 home/.choose-you", () => {
    expect(appHomeFrom("", "/Users/demo")).toBe(join("/Users/demo", DEFAULT_HOME_DIR));
  });

  it("env 未设：缺省 <home>/.choose-you", () => {
    expect(appHomeFrom(undefined, "/Users/demo")).toBe(join("/Users/demo", DEFAULT_HOME_DIR));
  });

  it("env 与 home 都缺：返回 undefined（调用方决定报错）", () => {
    expect(appHomeFrom(undefined, undefined)).toBeUndefined();
    expect(appHomeFrom("", undefined)).toBeUndefined();
  });

  it("库文件 = <root>/data/pokemon-choose-you.db", () => {
    expect(dbFileFrom("/var/cy", undefined)).toBe(join("/var/cy", "data", DB_FILE));
    expect(dbFileFrom(undefined, "/Users/demo")).toBe(join("/Users/demo", DEFAULT_HOME_DIR, "data", DB_FILE));
  });

  it("环境变量键名与主应用一致（CHOOSE_YOU_HOME）", () => {
    expect(HOME_ENV).toBe("CHOOSE_YOU_HOME");
  });
});
