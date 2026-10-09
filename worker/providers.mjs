import { gcj02ToWgs84, wgs84ToGcj02, distance } from "../src/domain.ts";
import { validateArea } from "./place-cache.mjs";
import { signBaiduUrl } from "./baidu-sign.mjs";
const names = ["赵一鸣", "零食很忙", "零食有鸣", "好特卖", "嗨特购", "奥特乐"];
export const providerNames = {
  amap: "高德",
  tencent: "腾讯",
  baidu: "百度",
  tianditu: "天地图",
};
export class DiscoveryError extends Error {}
export function providerConfigured(env, provider) {
  return !!{
    amap: env.AMAP_WEB_SERVICE_KEY,
    tencent: env.TENCENT_WEB_SERVICE_KEY,
    baidu: env.BAIDU_WEB_SERVICE_KEY,
    tianditu: env.TIANDITU_SERVICE_KEY,
  }[provider];
}
async function jsonRequest(url, fetcher) {
  let r;
  try {
    r = await fetcher.call(globalThis, url, {
      signal: AbortSignal.timeout(12000),
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "PoorMap/0.2 personal-research",
      },
    });
  } catch {
    throw new DiscoveryError("地图服务网络请求失败或超时。");
  }
  if (!r.ok) throw new DiscoveryError("请求失败（" + r.status + "）");
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new DiscoveryError(
      /安全验证|验证码|captcha/i.test(text)
        ? "地图服务返回安全验证页，云端请求暂不可用。"
        : "地图服务响应格式无效。",
    );
  }
}
export async function backupDiscovery(
  provider,
  center,
  radius,
  mode,
  env,
  fetcher = fetch,
) {
  if (!validateArea(center, radius) || !["home", "water"].includes(mode))
    throw Error("查询区域或模式无效。");
  if (!providerConfigured(env, provider))
    throw Error(providerNames[provider] + "查询未配置。");
  const queries = names.map((n) => ["discount", n]);
  queries.push(mode === "home" ? ["mixue", "蜜雪冰城"] : ["market", "超市"]);
  const stores = new Map(),
    warnings = [];
  let ok = 0;
  const deadline = Date.now() + 35000;
  for (const [category, keyword] of queries) {
    if (Date.now() > deadline) {
      warnings.push("备用门店查询超时，部分品牌未查询。");
      break;
    }
    if (fetcher === fetch) await new Promise((r) => setTimeout(r, 1250));
    try {
      let rows, count;
      if (provider === "tencent") {
        const u = new URL("https://apis.map.qq.com/ws/place/v1/search");
        for (const [k, v] of Object.entries({
          key: env.TENCENT_WEB_SERVICE_KEY,
          keyword,
          boundary: `nearby(${center[1]},${center[0]},${radius},0)`,
          page_size: 20,
          page_index: 1,
          orderby: "_distance",
        }))
          u.searchParams.set(k, String(v));
        const d = await jsonRequest(u, fetcher);
        if (d.status !== 0) throw Error("腾讯查询失败（" + d.status + "）");
        count = d.count;
        rows = (Array.isArray(d.data) ? d.data : [])
          .filter((p) => p && typeof p === "object")
          .map((p) => ({
            id: "qq-" + p.id,
            name: p.title,
            address: p.address,
            location: [p.location?.lng, p.location?.lat],
          }));
      } else if (provider === "baidu") {
        const u = new URL("https://api.map.baidu.com/place/v2/search");
        for (const [k, v] of Object.entries({
          ak: env.BAIDU_WEB_SERVICE_KEY,
          query: keyword,
          location: center[1] + "," + center[0],
          radius,
          coord_type: 2,
          ret_coordtype: "gcj02ll",
          output: "json",
          page_size: 20,
          page_num: 0,
          scope: 1,
        }))
          u.searchParams.set(k, String(v));
        try {
          await signBaiduUrl(u, env);
        } catch {
          throw new DiscoveryError("百度请求签名失败。");
        }
        const d = await jsonRequest(u, fetcher);
        if (d.status !== 0)
          throw new DiscoveryError(
            "百度查询失败" +
              (/^\d{1,6}$/.test(String(d.status))
                ? "（" + d.status + "）"
                : ""),
          );
        count = d.total;
        rows = (Array.isArray(d.results) ? d.results : [])
          .filter((p) => p && typeof p === "object")
          .map((p) => ({
            id: "bd-" + p.uid,
            name: p.name,
            address: p.address,
            location: [p.location?.lng, p.location?.lat],
          }));
      } else if (provider === "tianditu") {
        const p = gcj02ToWgs84(center),
          u = new URL("https://api.tianditu.gov.cn/v2/search");
        u.searchParams.set("tk", env.TIANDITU_SERVICE_KEY);
        u.searchParams.set("type", "query");
        u.searchParams.set(
          "postStr",
          JSON.stringify({
            keyWord: keyword,
            pointLonlat: p.join(","),
            queryRadius: radius,
            queryType: 3,
            level: 15,
            start: 0,
            count: 20,
          }),
        );
        const d = await jsonRequest(u, fetcher);
        if (![1000, 3001].includes(Number(d.status?.infocode)))
          throw Error("天地图查询失败。");
        count = d.count;
        rows = (Array.isArray(d.pois) ? d.pois : [])
          .filter((p) => p && typeof p === "object")
          .map((p) => ({
            id: "td-" + p.hotPointID,
            name: p.name,
            address: p.address,
            location: (() => {
              const point = String(p.lonlat || "")
                .trim()
                .split(/[ ,]+/)
                .map(Number);
              return validateArea(point, 1000) ? wgs84ToGcj02(point) : [];
            })(),
          }));
      } else throw Error("未知备用来源。");
      ok++;
      if (Number(count) > 20) warnings.push(keyword + "仅返回首批20家。");
      for (const p of rows) {
        if (
          typeof p.name !== "string" ||
          !p.name.trim() ||
          !/^(qq-|bd-|td-)[\w-]{1,80}$/.test(p.id) ||
          /-(undefined|null)$/.test(p.id) ||
          !validateArea(p.location, 1000) ||
          distance(center, p.location) > radius ||
          /总部|仓库|分公司|有限公司|配送中心|培训/.test(p.name)
        )
          continue;
        if (
          category !== "market" &&
          !p.name.includes(keyword) &&
          !(keyword === "好特卖" && /hotmaxx/i.test(p.name))
        )
          continue;
        if (stores.has(p.id) && stores.get(p.id).category === "discount")
          continue;
        stores.set(p.id, {
          ...p,
          name: p.name.slice(0, 80),
          address: typeof p.address === "string" ? p.address.slice(0, 200) : "",
          category,
          tags: [],
          source: provider,
          locationPrecision: "poi",
        });
      }
    } catch (e) {
      warnings.push(
        providerNames[provider] +
          "的" +
          keyword +
          "查询未成功。" +
          (e instanceof DiscoveryError ? e.message : ""),
      );
      if (!ok) break;
    }
  }
  if (!ok)
    throw new DiscoveryError(
      warnings.join(" ") || providerNames[provider] + "附近查询未成功。",
    );
  return { stores: [...stores.values()], configured: true, warnings };
}
