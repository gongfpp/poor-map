import type { Store } from "./domain";
export type StoreCluster = { stores: Store[]; location: [number, number] };
// Screen-sized Web Mercator buckets. Aggregates are reference groups, never synthetic shops.
export function clusterStores(
  stores: Store[],
  zoom: number,
  selected: string | null = null,
): StoreCluster[] {
  if (zoom >= 19)
    return stores.map((s) => ({ stores: [s], location: s.location }));
  const cell = (42 * 360) / (256 * 2 ** Math.max(3, zoom)),
    groups = new Map<string, Store[]>();
  for (const store of stores) {
    const [lng, lat] = store.location,
      y =
        (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) /
        Math.PI;
    const key =
      store.id === selected
        ? "selected:" + store.id
        : Math.floor(lng / cell) + ":" + Math.floor(y / cell);
    const group = groups.get(key) || [];
    group.push(store);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    stores: group,
    location:
      group.length === 1
        ? group[0].location
        : [
            group.reduce((n, s) => n + s.location[0], 0) / group.length,
            group.reduce((n, s) => n + s.location[1], 0) / group.length,
          ],
  }));
}
