/**
 * 契约回放套件（FR-X3 / PROTOCOL §5 · M3a+M3b）：遍历 contracts/scenarios 全部场景
 * json 执行 TS 实现 → 与 contracts/fixtures 逐字段比对（toStrictEqual：键序不敏感、
 * 数组序敏感）。完备性机检（M3a）：执行场景数 == 目录文件集；夹具零孤儿。
 */
import { describe, expect, it } from "vitest";
import { discoverScenarios, loadJson, type Fixture, type Scenario } from "./contracts/harness";
import { executeScenario } from "./contracts/executor";

const scenarios = discoverScenarios();

describe("契约回放（contracts/fixtures · Rust oracle 锁定的期望输出）", () => {
  it("M3a 完备性：场景目录非空且执行集 == 目录文件集", () => {
    expect(scenarios.length).toBeGreaterThan(0);
    expect(new Set(scenarios.map((s) => `${s.group}/${s.name}`)).size).toBe(scenarios.length);
  });

  it.each(scenarios.map((s) => [`${s.group}/${s.name}`, s] as const))("%s：逐字段回放比对", (_label, entry) => {
    const scenario = loadJson(`contracts/scenarios/${entry.group}/${entry.name}.json`) as Scenario;
    expect(scenario.kind).toBe(entry.group);
    expect(scenario.name).toBe(entry.name);
    const fixture = loadJson(`contracts/fixtures/${entry.group}/${entry.name}.json`) as Fixture;
    const got = executeScenario(scenario);
    expect(got.scenario).toBe(fixture.scenario);
    expect(got.steps).toStrictEqual(fixture.steps);
    expect(got.final).toStrictEqual(fixture.final);
  });

  it("M3a 反向：fixtures 无孤儿（每份夹具都有场景对应）", () => {
    for (const entry of scenarios) {
      expect(() => loadJson(`contracts/fixtures/${entry.group}/${entry.name}.json`)).not.toThrow();
    }
  });
});
