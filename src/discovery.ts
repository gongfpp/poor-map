import {
  distance,
  wgs84ToGcj02,
  gcj02ToWgs84,
  type Store,
  type Category,
} from "./domain";
const brands: [Category, string][] = [
  ["mixue", "蜜雪冰城"],
  ["discount", "赵一鸣"],
  ["discount", "零食很忙"],
  ["discount", "零食有鸣"],
  ["discount", "好特卖"],
  ["discount", "嗨特购"],
  ["discount", "奥特乐"],
];
type Result = { stores: Store[]; truncated: boolean };
const cache = new Map<string, { expires: number; result: Result }>();
let nextRequestAt = 0;
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function pacedRequest(
  url: URL,
  signal: AbortSignal | undefined,
  fetcher: typeof fetch,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = Math.max(Date.now(), nextRequestAt);
    nextRequestAt = start + 1250; // Keep the browser's sessions below one search request per second.
    await pause(Math.max(0, start - Date.now()), signal);
    const response = await fetcher(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000),
    });
    if (response.status !== 429 || attempt) return response;
    const seconds = Number(response.headers.get("retry-after") || 2);
    if (!Number.isFinite(seconds) || seconds > 10) return response;
    const until = Date.now() + Math.max(2000, seconds * 1000);
    nextRequestAt = Math.max(nextRequestAt, until);
  }
  throw new Error("附近门店检索暂不可用。");
}
export function clearDiscoveryCache() {
  cache.clear();
}
function fallbackId(name: string, address: string, point: number[]) {
  let h = 2166136261;
  for (const c of JSON.stringify([
    name,
    address,
    point.map((n) => n.toFixed(6)),
  ]))
    h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}
export function parsePois(
  raw: unknown,
  category: Category,
  keyword: string,
): Store[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    if (
      !p ||
      typeof p.name !== "string" ||
      !(
        p.name.includes(keyword) ||
        (keyword === "好特卖" && /hotmaxx/i.test(p.name)) ||
        (keyword === "超市" &&
          /超市|超级市场|便利店|生鲜/.test(`${p.name} ${p.typeName || ""}`))
      ) ||
      typeof p.lonlat !== "string"
    )
      return [];
    if (/总部|总仓|仓库|供应链|分公司|有限公司|配送中心|培训/.test(p.name))
      return [];
    const point = p.lonlat
      .trim()
      .split(/[,\s]+/)
      .map(Number);
    if (
      point.length !== 2 ||
      !point.every(Number.isFinite) ||
      point[0] < 72 ||
      point[0] > 138 ||
      point[1] < 0 ||
      point[1] > 56
    )
      return [];
    const name = p.name.slice(0, 80),
      address = typeof p.address === "string" ? p.address.slice(0, 200) : "",
      id =
        typeof p.hotPointID === "string" && /^[\w-]{1,80}$/.test(p.hotPointID)
          ? p.hotPointID
          : fallbackId(name, address, point);
    return [
      {
        id: "td-" + id,
        name,
        address,
        category,
        location: wgs84ToGcj02(point as [number, number]),
        locationPrecision: "poi" as const,
        tags: [],
        source: "tianditu" as const,
      },
    ];
  });
}
export async function discoverStores(
  key: string,
  center: [number, number],
  radius: number,
  water = false,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  onProgress?: (stores: Store[]) => void,
): Promise<{ stores: Store[]; warnings: string[] }> {
  if (!key) throw new Error("门店检索尚未配置。");
  if (!Number.isFinite(radius) || radius < 1 || radius > 10000)
    throw new Error("检索范围需在10公里内。");
  const geographic = gcj02ToWgs84(center).map((n) => Number(n.toFixed(3))); // Approximate search anchor; exact device coordinates are not persisted or sent.
  const queries = water
    ? [
        ...brands.filter(([cat]) => cat === "discount"),
        ["market", "超市"] as [Category, string],
      ]
    : brands;
  const found = new Map<string, Store>(),
    warnings: string[] = [];
  let cursor = 0,
    successes = 0;
  async function worker() {
    while (cursor < queries.length) {
      const [category, keyword] = queries[cursor++];
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const cacheKey = JSON.stringify([
        key,
        geographic,
        radius,
        category,
        keyword,
      ]);
      let result =
        cache.get(cacheKey)?.expires! > Date.now()
          ? cache.get(cacheKey)!.result
          : null;
      try {
        if (!result) {
          const url = new URL("https://api.tianditu.gov.cn/v2/search");
          url.searchParams.set("type", "query");
          url.searchParams.set("tk", key);
          url.searchParams.set(
            "postStr",
            JSON.stringify({
              keyWord: keyword,
              level: 15,
              queryType: 3,
              queryRadius: Math.min(10000, radius + 100),
              pointLonlat: geographic.join(","),
              start: 0,
              count: 20,
            }),
          );
          const response = await pacedRequest(url, signal, fetcher),
            data = await response.json();
          if (
            !response.ok ||
            ![1000, 3001].includes(Number(data.status?.infocode))
          )
            throw new Error();
          const stores = parsePois(data.pois, category, keyword);
          result = { stores, truncated: Number(data.count) > 20 };
          cache.set(cacheKey, { expires: Date.now() + 5 * 60000, result });
          if (cache.size > 80) cache.delete(cache.keys().next().value!);
        }
        successes++;
        for (const store of result.stores)
          if (distance(center, store.location) <= radius)
            found.set(store.id, store);
        if (result.truncated)
          warnings.push(`${keyword}仅取首批20家，可缩小范围。`);
        if (!signal?.aborted) onProgress?.([...found.values()]);
      } catch (e) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        warnings.push(`${keyword}查询暂不可用。`);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!successes) throw new Error("附近门店检索暂不可用，请稍后重试。");
  return { stores: [...found.values()], warnings };
}
export function mergeStores(community: Store[], candidates: Store[]): Store[] {
  const result = [...community];
  for (const s of candidates) {
    if (result.some((x) => x.id === s.id)) continue;
    // Preserve the community identity and its user-selected position; never migrate prices/comments on a fuzzy brand match.
    const same = result.some(
      (x) =>
        x.category === s.category &&
        x.name.replace(/[\s·（）()]/g, "") ===
          s.name.replace(/[\s·（）()]/g, "") &&
        distance(x.location, s.location) <= 100,
    );
    if (!same) result.push(s);
  }
  return result;
}
