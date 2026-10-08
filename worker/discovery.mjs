import { distance } from "../src/domain.ts";
const homeGroups = [
  ["discount", "赵一鸣零食|零食很忙|零食有鸣|好特卖|嗨特购|奥特乐"],
  ["mixue", "蜜雪冰城"],
];
export async function amapDiscovery(url, env, amap) {
  const mode = url.searchParams.get("mode") || "water";
  const point = (url.searchParams.get("center") || "").split(",").map(Number);
  const radius = Number(url.searchParams.get("radius"));
  if (
    !["home", "water"].includes(mode) ||
    point.length !== 2 ||
    !point.every(Number.isFinite) ||
    point[0] < 72 ||
    point[0] > 138 ||
    point[1] < 0.8 ||
    point[1] > 56 ||
    !Number.isInteger(radius) ||
    radius < 100 ||
    radius > 10000
  )
    return { error: "查询中心或范围无效。", status: 400 };
  const center = point.map((n) => Number(n.toFixed(3)));
  const groups =
    mode === "home" ? homeGroups : [homeGroups[0], ["market", "三江购物|超市"]];
  const results = await Promise.allSettled(
    groups.map(async ([category, keywords]) => {
      const d = await amap(env, "/v3/place/around", {
        location: center.join(","),
        radius: Math.min(10000, radius + 100),
        keywords,
        offset: 25,
        page: 1,
        extensions: "base",
        sortrule: "distance",
      });
      return { category, pois: d.pois || [], count: Number(d.count) || 0 };
    }),
  );
  const found = new Map(),
    warnings = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      warnings.push(
        `${groups[i][0] === "mixue" ? "蜜雪冰城" : groups[i][0] === "market" ? "超市" : "硬折扣"}查询暂不可用。`,
      );
      return;
    }
    if (r.value.count > r.value.pois.length)
      warnings.push(
        `${r.value.category === "mixue" ? "蜜雪冰城" : r.value.category === "market" ? "超市" : "硬折扣"}仅取首批25家，可缩小范围。`,
      );
    for (const p of r.value.pois) {
      const location = String(p.location || "")
          .split(",")
          .map(Number),
        name = typeof p.name === "string" ? p.name : "";
      if (
        !/^[\w-]{1,80}$/.test(p.id || "") ||
        !name ||
        /总部|总仓|仓库|供应链|分公司|有限公司|配送中心|培训/.test(name) ||
        location.length !== 2 ||
        !location.every(Number.isFinite) ||
        location[0] < 72 ||
        location[0] > 138 ||
        location[1] < 0.8 ||
        location[1] > 56 ||
        distance(center, location) > radius + 100
      )
        continue;
      if (
        r.value.category === "discount" &&
        !/赵一鸣|零食很忙|零食有鸣|好特卖|hotmaxx|嗨特购|奥特乐/i.test(name)
      )
        continue;
      if (r.value.category === "mixue" && !name.includes("蜜雪冰城")) continue;
      if (found.has(p.id) && found.get(p.id).category === "discount") continue;
      found.set(p.id, {
        id: p.id,
        name: name.slice(0, 80),
        address: [p.cityname, p.adname, p.address]
          .filter((x) => typeof x === "string")
          .join(" ")
          .slice(0, 200),
        location,
        locationPrecision: "poi",
        category: r.value.category,
        tags: [],
        source: "amap",
      });
    }
  });
  if (results.every((r) => r.status === "rejected"))
    return { error: "高德附近门店检索暂不可用，请稍后重试。", status: 502 };
  const data = { stores: [...found.values()], configured: true, warnings };
  return data;
}
