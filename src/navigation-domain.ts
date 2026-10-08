import type { Store } from "./domain";

export type NavigationResult = {
  destination: Store;
  distance: number;
  duration: number;
  polyline: [number, number][];
  steps: string[];
  provider: "amap" | "tencent" | "baidu";
  compared: number;
  comparisonLimited: boolean;
  warnings: string[];
};
export function validNavigationPoint(
  point: unknown,
): point is [number, number] {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    point.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    point[0] >= 72 &&
    point[0] <= 138 &&
    point[1] >= 0.8 &&
    point[1] <= 56
  );
}
export function eligibleNavigationStore(store: Store) {
  return (
    store &&
    store.category === "discount" &&
    typeof store.id === "string" &&
    store.id.length > 0 &&
    store.id.length <= 100 &&
    typeof store.name === "string" &&
    !/暂停营业|停止营业|停业|歇业|闭店|已关闭|装修|永久关闭/.test(store.name) &&
    validNavigationPoint(store.location)
  );
}
export function validNavigationResult(
  value: unknown,
): value is NavigationResult {
  if (!value || typeof value !== "object") return false;
  const r = value as NavigationResult;
  return (
    eligibleNavigationStore(r.destination) &&
    [r.distance, r.duration].every(
      (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
    ) &&
    r.distance <= 100000 &&
    r.duration <= 172800 &&
    Array.isArray(r.polyline) &&
    r.polyline.length >= 2 &&
    r.polyline.length <= 20000 &&
    r.polyline.every(validNavigationPoint) &&
    Array.isArray(r.steps) &&
    r.steps.length <= 100 &&
    r.steps.every((s) => typeof s === "string" && s.length <= 400) &&
    ["amap", "tencent", "baidu"].includes(r.provider) &&
    Number.isInteger(r.compared) &&
    r.compared >= 1 &&
    r.compared <= 8 &&
    typeof r.comparisonLimited === "boolean" &&
    Array.isArray(r.warnings) &&
    r.warnings.every((s) => typeof s === "string" && s.length <= 400)
  );
}
// Route planning URI, not a marker URI. GCJ-02 is explicit; this never includes an API Key.
export function walkingNavigationUrl(
  origin: [number, number],
  destination: Store,
) {
  if (
    !validNavigationPoint(origin) ||
    !validNavigationPoint(destination.location)
  )
    throw new Error("起点或终点无效。");
  const url = new URL("https://uri.amap.com/navigation");
  url.search = new URLSearchParams({
    from: `${origin.join(",")},出发点`,
    to: `${destination.location.join(",")},${destination.name}`,
    mode: "walk",
    callnative: "1",
    src: "poor-map",
  }).toString();
  return url.href;
}
