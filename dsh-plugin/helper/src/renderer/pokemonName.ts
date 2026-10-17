/**
 * 精灵名取用（从 renderer.ts 拆出——棘轮 max-lines，等量迁移）：ui-event 台词与
 * 时刻台词共用——bridge.spriteName 通道，失败回退 categoryPokemon key 本身。
 */
import { mirror } from "./mirror.ts";

const bridge = window.petBridge;

export function withPokemonName(then: (name: string) => void): void {
  const key = mirror.lastTask?.categoryPokemon ?? "";
  bridge
    .spriteName(key, mirror.lang)
    .then(then)
    .catch(() => then(key));
}
