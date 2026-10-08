import { distance } from "../src/domain.ts";
export function validateArea(point, radius) {
  return (
    Array.isArray(point) &&
    point.length === 2 &&
    point.every(Number.isFinite) &&
    point[0] >= 72 &&
    point[0] <= 138 &&
    point[1] >= 0.8 &&
    point[1] <= 56 &&
    Number.isInteger(radius) &&
    radius >= 100 &&
    radius <= 10000
  );
}
export async function savePlaces(env, scope, stores, run, stats = null) {
  const fetchedAt = run.fetchedAt || new Date().toISOString(),
    statements = [];
  let accepted = 0;
  for (const s of stores) {
    if (
      !s ||
      !["amap", "tencent", "baidu", "tianditu"].includes(s.source) ||
      !["discount", "mixue", "market"].includes(s.category) ||
      !validateArea(s.location, 1000) ||
      typeof s.id !== "string" ||
      !/^[\w-]{1,160}$/.test(s.id) ||
      typeof s.name !== "string"
    )
      continue;
    if (!s.name.trim()) continue;
    accepted++;
    const clean = {
      id: s.id,
      name: s.name.slice(0, 80),
      address: String(s.address || "").slice(0, 200),
      category: s.category,
      location: s.location,
      tags: [],
      source: s.source,
      locationPrecision: "poi",
    };
    statements.push(
      env.DB.prepare(
        "INSERT INTO cached_pois(scope,provider,id,city,category,lng,lat,record,fetched_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,provider,id) DO UPDATE SET city=CASE WHEN excluded.city='' THEN cached_pois.city ELSE excluded.city END,category=excluded.category,lng=excluded.lng,lat=excluded.lat,record=excluded.record,fetched_at=excluded.fetched_at WHERE cached_pois.record<>excluded.record OR cached_pois.fetched_at<>excluded.fetched_at OR (excluded.city<>'' AND cached_pois.city<>excluded.city)",
      ).bind(
        scope,
        s.source,
        s.id,
        run.city || "",
        s.category,
        ...s.location,
        JSON.stringify(clean),
        fetchedAt,
      ),
    );
  }
  statements.push(
    env.DB.prepare(
      "INSERT INTO cache_runs(scope,run_key,provider,city,record,fetched_at) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,run_key) DO UPDATE SET record=excluded.record,fetched_at=excluded.fetched_at",
    ).bind(
      scope,
      run.key,
      run.provider,
      run.city || "",
      JSON.stringify({ ...run, fetchedAt }),
      fetchedAt,
    ),
  );
  for (let i = 0; i < statements.length; i += 80) {
    const results = await env.DB.batch(statements.slice(i, i + 80));
    if (stats) {
      stats.rowsWritten =
        (stats.rowsWritten || 0) +
        results.reduce((n, r) => n + (r.meta?.rows_written || 0), 0);
      stats.rowsRead =
        (stats.rowsRead || 0) +
        results.reduce((n, r) => n + (r.meta?.rows_read || 0), 0);
    }
  }
  return accepted;
}
export function validPlaceFilters(filters = {}, mode = "home") {
  return (
    filters &&
    [
      "all",
      ...(mode === "home" ? ["discount", "mixue"] : ["discount", "market"]),
    ].includes(filters.category || "all") &&
    (filters.query == null ||
      (typeof filters.query === "string" && filters.query.length <= 80))
  );
}
export async function readPlaces(
  env,
  scope,
  center,
  radius,
  mode = "home",
  filters = {},
) {
  if (!validateArea(center, radius) || !["home", "water"].includes(mode))
    return { error: "查询中心或范围无效。", status: 400 };
  if (!validPlaceFilters(filters, mode))
    return { error: "查询筛选无效。", status: 400 };
  const dy = (radius + 100) / 111000,
    dx = dy / Math.cos((center[1] * Math.PI) / 180),
    cats =
      filters.category && filters.category !== "all"
        ? [filters.category, filters.category]
        : mode === "home"
          ? ["discount", "mixue"]
          : ["discount", "market"],
    query = (filters.query || "").trim();
  const rows = await env.DB.prepare(
    "SELECT record,fetched_at,city FROM cached_pois WHERE scope=? AND category IN (?,?) AND lng BETWEEN ? AND ? AND lat BETWEEN ? AND ? AND (?='' OR instr(lower(json_extract(record,'$.name') || ' ' || json_extract(record,'$.address')), lower(?))>0) ORDER BY (lng-?)*(lng-?)*?+(lat-?)*(lat-?) LIMIT 650",
  )
    .bind(
      scope,
      ...cats,
      center[0] - dx,
      center[0] + dx,
      center[1] - dy,
      center[1] + dy,
      query,
      query,
      center[0],
      center[0],
      Math.cos((center[1] * Math.PI) / 180) ** 2,
      center[1],
      center[1],
    )
    .all();
  const all = rows.results
    .map((r) => ({ ...JSON.parse(r.record), cachedAt: r.fetched_at }))
    .filter(
      (s) =>
        distance(center, s.location) <= radius &&
        !/暂停营业|停止营业|已关闭|已停业|装修中/.test(s.name),
    )
    .sort(
      (a, b) => distance(center, a.location) - distance(center, b.location),
    );
  const unique = new Map();
  for (const s of all) {
    if (!unique.has(s.id)) unique.set(s.id, s);
  }
  const stores = [...unique.values()].slice(0, 500);
  const runs = await env.DB.prepare(
    "SELECT record FROM cache_runs WHERE scope=? ORDER BY fetched_at DESC LIMIT 200",
  )
    .bind(scope)
    .all();
  const cityIds = new Set(rows.results.map((r) => r.city).filter(Boolean));
  const relevant = runs.results
    .map((r) => JSON.parse(r.record))
    .filter(
      (r) =>
        (r.city && cityIds.has(r.city)) ||
        (!r.city &&
          Array.isArray(r.storeIds) &&
          r.storeIds.some((id) => unique.has(id))),
    );
  return {
    stores,
    configured: true,
    cacheOnly: true,
    fetchedAt: stores.length ? stores.map((s) => s.cachedAt).sort()[0] : null,
    warnings: [...new Set(relevant.flatMap((r) => r.warnings || []))].slice(
      0,
      5,
    ),
    limited: rows.results.length >= 650 || unique.size > 500,
    coverage: relevant
      .filter((r) => r.city)
      .map((r) => ({
        city: r.city,
        complete: !!r.complete,
        fetchedAt: r.fetchedAt,
      })),
    note: stores.length
      ? "已保存门店，只在手动刷新时更新。"
      : "这一带还没有保存的门店，请手动刷新或选择已收集城市。",
  };
}
export async function cacheSummary(env, scope) {
  const rows = await env.DB.prepare(
    "SELECT provider,city,COUNT(*) AS count FROM cached_pois WHERE scope=? GROUP BY provider,city",
  )
    .bind(scope)
    .all();
  const runs = await env.DB.prepare(
    "SELECT record FROM cache_runs WHERE scope=? AND city<>'' ORDER BY city",
  )
    .bind(scope)
    .all();
  return {
    groups: rows.results,
    cities: runs.results.map((r) => JSON.parse(r.record)),
  };
}
