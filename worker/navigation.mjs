import { distance } from "../src/domain.ts";
import { signBaiduUrl } from "./baidu-sign.mjs";
import {
  eligibleNavigationStore,
  validNavigationPoint,
} from "../src/navigation-domain.ts";

export class NavigationError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
const cleanInstruction = (s) =>
  typeof s === "string"
    ? s
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/g, " ")
        .slice(0, 400)
    : "";
const coordinates = (raw) =>
  typeof raw === "string"
    ? raw
        .split(";")
        .filter(Boolean)
        .map((s) => s.split(",").map(Number))
    : [];

function normalize(route, provider, origin, destination) {
  if (!route || !Array.isArray(route.steps))
    throw new NavigationError("路线数据不完整。");
  let polyline;
  if (provider === "tencent") {
    const points = route.polyline;
    if (
      !Array.isArray(points) ||
      points.length < 4 ||
      points.length % 2 ||
      points.length > 40000 ||
      !points.every((n) => typeof n === "number" && Number.isFinite(n))
    )
      throw new NavigationError("路线坐标无效。");
    const decoded = [...points];
    for (let i = 2; i < decoded.length; i++)
      decoded[i] = decoded[i - 2] + decoded[i] / 1e6;
    polyline = [];
    for (let i = 0; i < decoded.length; i += 2)
      polyline.push([decoded[i + 1], decoded[i]]);
  } else
    polyline = route.steps.flatMap((s) =>
      coordinates(provider === "baidu" ? s.path : s.polyline),
    );
  if (
    polyline.length < 2 ||
    polyline.length > 20000 ||
    !polyline.every(validNavigationPoint) ||
    distance(origin, polyline[0]) > 1500 ||
    distance(destination.location, polyline.at(-1)) > 1500
  )
    throw new NavigationError("路线坐标无效或与起终点不符。");
  const meters = Number(route.distance),
    seconds = Number(route.duration) * (provider === "tencent" ? 60 : 1);
  if (
    ![meters, seconds].every(Number.isFinite) ||
    meters < 0 ||
    seconds < 0 ||
    meters > 100000 ||
    seconds > 172800 ||
    (meters === 0 && distance(origin, destination.location) > 20) ||
    (seconds === 0 && meters > 20)
  )
    throw new NavigationError("路线距离或时间无效。");
  return {
    distance: meters,
    duration: seconds,
    polyline,
    steps: route.steps
      .slice(0, 100)
      .map((s) => cleanInstruction(s.instruction))
      .filter(Boolean),
    provider,
  };
}

async function requestRoute(
  provider,
  origin,
  destination,
  key,
  fetcher,
  signal,
  env,
) {
  const lnglat = (p) => p.map((n) => Number(n.toFixed(6))).join(",");
  const latlng = (p) => lnglat([p[1], p[0]]);
  let url;
  if (provider === "amap") {
    url = new URL("https://restapi.amap.com/v3/direction/walking");
    url.search = new URLSearchParams({
      key,
      origin: lnglat(origin),
      destination: lnglat(destination.location),
      output: "JSON",
    });
    const id =
      destination.amapId ||
      (destination.source === "amap" ? destination.id : "");
    if (/^[\w-]{1,80}$/.test(id)) url.searchParams.set("destination_id", id);
  } else if (provider === "tencent") {
    url = new URL("https://apis.map.qq.com/ws/direction/v1/walking/");
    url.search = new URLSearchParams({
      key,
      from: latlng(origin),
      to: latlng(destination.location),
      output: "json",
    });
  } else {
    url = new URL("https://api.map.baidu.com/directionlite/v1/walking");
    url.search = new URLSearchParams({
      ak: key,
      origin: latlng(origin),
      destination: latlng(destination.location),
      coord_type: "gcj02",
      ret_coordtype: "gcj02",
      steps_info: "1",
    });
    if (env.BAIDU_WEB_SERVICE_SK)
      url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
    await signBaiduUrl(url, env);
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10000);
  let response;
  try {
    response = await fetcher.call(globalThis, url, {
      signal: controller.signal,
      redirect: "manual",
    });
  } catch {
    throw new NavigationError("路线网络请求失败或超时。");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
  if (!response.ok) throw new NavigationError("路线服务暂不可用。");
  const data = await response.json();
  if (provider === "amap" ? data.status !== "1" : data.status !== 0) {
    const code = String(provider === "amap" ? data.infocode : data.status);
    throw new NavigationError(
      "路线服务没有返回可用步行路线" +
        (/^\d{1,6}$/.test(code) ? "（" + code + "）" : "") +
        "。",
    );
  }
  const routes = provider === "amap" ? data.route?.paths : data.result?.routes;
  if (!Array.isArray(routes) || !routes.length)
    throw new NavigationError("没有可用步行路线。");
  const usable = routes.slice(0, 3).flatMap((route) => {
    try {
      return [normalize(route, provider, origin, destination)];
    } catch {
      return [];
    }
  });
  if (!usable.length) throw new NavigationError("没有有效的步行路线。");
  return usable.sort((a, b) => a.distance - b.distance)[0];
}

// Precise origins and routes are request-local only. Neither is cached, persisted, nor logged.
export async function planNearest(origin, candidates, env, fetcher = fetch) {
  if (!validNavigationPoint(origin))
    throw new NavigationError("请先选择有效的出发点。", 400);
  if (!Array.isArray(candidates))
    throw new NavigationError("门店数据无效。", 400);
  const providers = [
    ["amap", env.AMAP_WEB_SERVICE_KEY],
    ["tencent", env.TENCENT_WEB_SERVICE_KEY || env.TENCENT_MAP_KEY],
    ["baidu", env.BAIDU_WEB_SERVICE_KEY || env.BAIDU_MAP_AK],
  ].filter(([, key]) => typeof key === "string" && key.trim());
  if (!providers.length)
    throw new NavigationError("步行路线服务尚未配置。", 503);
  const found = new Map();
  for (const store of candidates) {
    if (eligibleNavigationStore(store) && !found.has(store.id))
      found.set(store.id, store);
  }
  const eligible = [...found.values()].sort(
    (a, b) => distance(origin, a.location) - distance(origin, b.location),
  );
  if (!eligible.length)
    throw new NavigationError("当前缓存范围内没有可导航的硬折扣店。", 404);
  const shortlist = eligible.slice(0, 8),
    successes = [],
    warnings = [],
    failures = new Set();
  const timeout = AbortSignal.timeout(25000);
  let cursor = 0,
    failed = 0,
    fallback = false;
  await Promise.all(
    [0, 1].map(async () => {
      while (cursor < shortlist.length && !timeout.aborted) {
        const destination = shortlist[cursor++];
        let planned = false;
        for (let i = 0; i < providers.length && !timeout.aborted; i++) {
          const [provider, key] = providers[i];
          try {
            const route = await requestRoute(
              provider,
              origin,
              destination,
              key,
              fetcher,
              timeout,
              env,
            );
            successes.push({ ...route, destination });
            if (i > 0) fallback = true;
            planned = true;
            break;
          } catch (e) {
            if (e instanceof NavigationError) failures.add(e.message);
            /* Errors may contain credential URLs; never expose or log them. */
          }
        }
        if (!planned) failed++;
      }
    }),
  );
  if (!successes.length)
    throw new NavigationError(
      "步行路线服务暂不可用，请稍后重试或在地图 App 中规划路线。" +
        [...failures].slice(0, 2).join(" "),
    );
  if (eligible.length > 8)
    warnings.push("本次只比较直线距离最近的 8 家缓存门店。");
  if (failed || cursor < shortlist.length)
    warnings.push("部分门店算路失败或超时，未完成全部比较。");
  if (fallback)
    warnings.push("部分路线使用备用地图服务，不同服务的路线可能存在差异。");
  warnings.push("仅比较已缓存的门店，营业状态和门店入口请到店核对。");
  const best = successes.sort(
    (a, b) => a.distance - b.distance || a.duration - b.duration,
  )[0];
  return {
    ...best,
    compared: successes.length,
    comparisonLimited: eligible.length > successes.length,
    warnings,
  };
}
