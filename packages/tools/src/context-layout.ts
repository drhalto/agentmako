import type { ContextLayoutZone } from "@mako-ai/contracts";

const ZONE_RANK: Record<ContextLayoutZone, number> = {
  start: 0,
  middle: 1,
  end: 2,
};

export function orderByContextLayout<T extends { layoutZone?: ContextLayoutZone }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const zoneDelta =
        ZONE_RANK[left.item.layoutZone ?? "middle"] -
        ZONE_RANK[right.item.layoutZone ?? "middle"];
      return zoneDelta === 0 ? left.index - right.index : zoneDelta;
    })
    .map((entry) => entry.item);
}
