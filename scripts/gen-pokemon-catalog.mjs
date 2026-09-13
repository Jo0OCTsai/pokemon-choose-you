#!/usr/bin/env node
/**
 * 生成全量宝可梦名录 src/pokemon/catalog.json（数据源 pokeapi.co）。
 *
 *   node scripts/gen-pokemon-catalog.mjs
 *
 * 拉取 pokemon-species 1..N（默认 1025），抽取 zh-Hans / zh-Hant / en 三语名，
 * 输出紧凑 JSON：{ v: 1, entries: [[id, key, hans, hant, en], ...] }。
 * 繁中名缺失时回退简中（PokeAPI 部分新世代的宝可梦没有 zh-Hant 名）。
 * 名录变更（新世代发售、官方译名调整）后重跑本脚本即可。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "pokemon", "catalog.json");
const TOTAL = Number(process.argv[2] ?? 1025);
const CONCURRENCY = 24;

/** 单只拉取：带 3 次重试（pokeapi 偶发 502/超时） */
async function fetchSpecies(id, retries = 3) {
  const url = `https://pokeapi.co/api/v2/pokemon-species/${id}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === retries) throw new Error(`species ${id}: ${e}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error(`species ${id}: unreachable`);
}

function extract(data) {
  const by = {};
  for (const n of data.names ?? []) by[n.language.name.toLowerCase()] = n.name;
  const hans = by["zh-hans"] ?? by["zh-hant"] ?? data.name;
  const hant = by["zh-hant"] ?? hans;
  return [data.id, data.name, hans, hant, by.en ?? data.name];
}

const entries = new Array(TOTAL);
let done = 0;
const queue = Array.from({ length: TOTAL }, (_, i) => i + 1);

async function worker() {
  for (;;) {
    const id = queue.shift();
    if (id == null) return;
    entries[id - 1] = extract(await fetchSpecies(id));
    done++;
    if (done % 100 === 0 || done === TOTAL) console.log(`  ${done}/${TOTAL}`);
  }
}

console.log(`Fetching ${TOTAL} species from pokeapi.co (concurrency ${CONCURRENCY})…`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// 完整性：任何一只失败上面就会抛错，这里再校验无空洞后落盘
if (entries.some((e) => !e)) throw new Error("catalog has holes, aborting");

const json = JSON.stringify({ v: 1, entries });
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, json + "\n");
console.log(`Wrote ${entries.length} entries → ${OUT} (${(json.length / 1024).toFixed(1)} KB)`);
