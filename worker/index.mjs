import { writesPaused, quotaError, quotaMessage } from "./availability.mjs";
import { communityRoute } from "./community.mjs";
import { amapDiscovery } from "./discovery.mjs";
import {
  readPlaces,
  savePlaces,
  cacheSummary,
  validateArea,
  validPlaceFilters,
} from "./place-cache.mjs";
import {
  backupDiscovery,
  providerConfigured,
  providerNames,
  DiscoveryError,
} from "./providers.mjs";
import { planNearest, NavigationError } from "./navigation.mjs";
import { correctWaterPoint } from "./reference-migration.mjs";
import { seedWater, validateWater } from "../src/water-domain.ts";
import { distance } from "../src/domain.ts";
const origins = new Set([
  "https://gongfpp.github.io",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
const cleanInput = (o) =>
  Object.fromEntries(
    [
      "storeId",
      "storeName",
      "address",
      "location",
      "locationPrecision",
      "product",
      "waterType",
      "volumeMl",
      "bottles",
      "price",
      "priceHigh",
      "channel",
      "sourceUrl",
      "requirements",
      "observedOn",
      "validUntil",
      "status",
    ].map((k) => [k, o[k]]),
  );
const output = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function seed(env) {
  const missing = [];
  for (const o of seedWater)
    if (
      !(await env.DB.prepare("SELECT id FROM offers WHERE scope=? AND id=?")
        .bind("public", o.id)
        .first())
    )
      missing.push(o);
  if (!missing.length || writesPaused(env)) return;
  await env.DB.batch(
    missing.map((o) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO offers (scope,id,record,version,updated_at) VALUES (?,?,?,?,?)",
      ).bind("public", o.id, JSON.stringify(o), 1, o.updatedAt),
    ),
  );
}
async function getOffer(env, scope, id) {
  const row = await env.DB.prepare(
    "SELECT record FROM offers WHERE scope=? AND id=?",
  )
    .bind(scope, id)
    .first();
  return row ? JSON.parse(row.record) : null;
}
async function body(req) {
  if (Number(req.headers.get("content-length")) > 8192)
    throw new Error("内容过长。");
  const text = await req.text();
  if (text.length > 8192) throw new Error("内容过长。");
  return JSON.parse(text);
}
const readRateBuckets = new Map();
async function rate(req, env, scope, maximum = 20, kind = "write") {
  if (scope.startsWith("qa")) return true;
  const bucket = Math.floor(Date.now() / 3600000),
    raw = new TextEncoder().encode(
      (req.headers.get("cf-connecting-ip") || "local") +
        env.QA_TOKEN +
        bucket +
        kind,
    ),
    hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", raw))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  if (["sdk", "map", "geocode", "navigation"].includes(kind)) {
    for (const [key, value] of readRateBuckets)
      if (value.bucket !== bucket) readRateBuckets.delete(key);
    if (readRateBuckets.size >= 2000 && !readRateBuckets.has(hash))
      return false;
    const entry = readRateBuckets.get(hash) || { bucket, count: 0 };
    entry.count++;
    readRateBuckets.set(hash, entry);
    return entry.count <= maximum;
  }
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(ip_hash,bucket,count) VALUES(?,?,1) ON CONFLICT(ip_hash,bucket) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(hash, bucket)
    .first();
  await env.DB.prepare("DELETE FROM rate_limits WHERE bucket<?")
    .bind(bucket - 2)
    .run();
  return row.count <= maximum;
}
async function amap(env, path, params) {
  if (!env.AMAP_WEB_SERVICE_KEY)
    throw new Error("尚未配置高德查询；价格线索仍可正常使用。");
  const url = new URL(`https://restapi.amap.com${path}`);
  for (const [k, v] of Object.entries(params))
    url.searchParams.set(k, String(v));
  url.searchParams.set("key", env.AMAP_WEB_SERVICE_KEY);
  const r = await (env.UPSTREAM_FETCH || fetch)(url, {
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  if (!r.ok || d.status !== "1")
    throw new Error(`高德查询失败（${d.infocode || r.status}），请稍后重试。`);
  return d;
}
export async function route(req, env) {
  const url = new URL(req.url),
    path = url.pathname,
    origin = req.headers.get("origin");
  const isQA = !!env.QA_TOKEN && req.headers.get("x-qa-token") === env.QA_TOKEN,
    scope = isQA
      ? "qa" +
        (/^[a-zA-Z0-9-]{1,60}$/.test(req.headers.get("x-qa-scope") || "")
          ? ":" + req.headers.get("x-qa-scope")
          : "")
      : "public";
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (
    path.startsWith("/api/community/") ||
    path.startsWith("/api/analytics/")
  ) {
    if (req.method === "POST" && !isQA && !origins.has(origin))
      return output({ error: "请从穷鬼地图页面提交。" }, 403);
    if (writesPaused(env) && ["POST", "PUT"].includes(req.method))
      return path.startsWith("/api/analytics/")
        ? output({ accepted: 0, paused: true }, 202)
        : output({ error: quotaMessage }, 503);
    return communityRoute(req, env, scope, { isQA, rate, body, output });
  }
  if (path === "/api/water/config" && req.method === "GET") {
    const td = url.searchParams.get("map") === "tianditu";
    return output({
      provider: td ? "tianditu" : "amap",
      jsKey: (td ? env.TIANDITU_WEB_KEY : env.AMAP_JS_KEY) || "",
      mapReady: td
        ? !!env.TIANDITU_WEB_KEY
        : !!(env.AMAP_JS_KEY && env.AMAP_JS_SECURITY_CODE),
      searchReady: !!env.AMAP_WEB_SERVICE_KEY,
      cacheReady: true,
      writeReady: !writesPaused(env),
      writePausedUntil: writesPaused(env) ? env.WRITE_PAUSED_UNTIL : null,
      providers: Object.keys(providerNames).map((id) => ({
        id,
        name: providerNames[id],
        configured: providerConfigured(env, id),
      })),
      shared: true,
    });
  }
  if (path === "/api/water/health")
    return output({
      ok: true,
      service: "poor-map-water",
      storage: env.STORAGE_KIND || "D1",
    });
  if (path === "/api/water/qa" && req.method === "DELETE") {
    if (!isQA) return output({ error: "未授权。" }, 403);
    await env.DB.batch(
      ["offers", "revisions", "feedback"].map((table) =>
        env.DB.prepare(`DELETE FROM ${table} WHERE scope=?`).bind(scope),
      ),
    );
    return output({ ok: true });
  }
  if (path.startsWith("/_AMapService/")) {
    if (req.method !== "GET" || !env.AMAP_JS_SECURITY_CODE)
      return output({ error: "高德底图尚未配置。" }, 503);
    if (!(await rate(req, env, scope, 300, "sdk")))
      return output({ error: "地图请求较频繁，请稍后重试。" }, 429);
    const upstreamPath = path.replace("/_AMapService", "");
    if (
      !/^\/v[345]\/(place\/(around|text|detail)|geocode\/(geo|regeo)|assistant\/inputtips|config\/district|map\/styles|log\/init)\/?$/.test(
        upstreamPath,
      )
    )
      return output({ error: "代理路径未开放。" }, 403);
    const upstream = new URL(
      upstreamPath + url.search,
      upstreamPath.startsWith("/v4/map/styles")
        ? "https://webapi.amap.com"
        : "https://restapi.amap.com",
    );
    upstream.searchParams.set("key", env.AMAP_JS_KEY);
    upstream.searchParams.set("jscode", env.AMAP_JS_SECURITY_CODE);
    const r = await fetch(upstream, { signal: AbortSignal.timeout(12000) });
    return new Response(r.body, {
      status: r.status,
      headers: {
        "Content-Type": r.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
  if (path === "/api/water/candidates") {
    if (req.method === "GET") {
      const center = (url.searchParams.get("center") || "")
          .split(",")
          .map(Number),
        radius = Number(url.searchParams.get("radius")),
        mode = url.searchParams.get("mode") || "water";
      const result = await readPlaces(env, scope, center, radius, mode, {
        category: url.searchParams.get("category") || "all",
        query: url.searchParams.get("query") || "",
      });
      return output(result, result.status || 200);
    }
    if (req.method === "POST") {
      if (!isQA && !origins.has(origin))
        return output({ error: "请从地图页面手动刷新。" }, 403);
      if (writesPaused(env)) return output({ error: quotaMessage }, 503);
      if (!(await rate(req, env, scope, 10, "refresh")))
        return output({ error: "刷新较频繁，请稍后重试。" }, 429);
      const p = await body(req),
        center = p.center,
        radius = p.radius,
        mode = p.mode || "home";
      if (
        !validateArea(center, radius) ||
        !["home", "water"].includes(mode) ||
        !validPlaceFilters(p, mode)
      )
        return output({ error: "刷新区域无效。" }, 400);
      const requested = p.provider || "auto",
        attempts = [];
      let result, provider;
      if (requested !== "auto" && !providerNames[requested])
        return output({ error: "未知门店来源。" }, 400);
      const candidates =
        requested === "auto" ? Object.keys(providerNames) : [requested];
      for (const id of candidates) {
        if (!providerConfigured(env, id)) continue;
        try {
          const u = new URL(url);
          u.searchParams.set("center", center.join(","));
          u.searchParams.set("radius", radius);
          u.searchParams.set("mode", mode);
          const d =
            id === "amap"
              ? await amapDiscovery(u, env, amap)
              : await backupDiscovery(
                  id,
                  center,
                  radius,
                  mode,
                  env,
                  env.UPSTREAM_FETCH || fetch,
                );
          if (d.error) throw Error(d.error);
          result = d;
          provider = id;
          break;
        } catch (e) {
          attempts.push(
            e instanceof DiscoveryError
              ? e.message
              : providerNames[id] + "刷新未成功。",
          );
        }
      }
      if (!result)
        return output(
          {
            error: attempts.join(" ") || "没有可用的门店来源。旧缓存仍可查看。",
          },
          503,
        );
      const storeIds = result.stores.map((s) => s.id).sort();
      const hash = [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(storeIds.join(",")),
          ),
        ),
      ]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 32);
      const key = ["nearby", provider, mode, hash].join(":");
      await savePlaces(env, scope, result.stores, {
        key,
        provider,
        storeIds,
        mode,
        warnings: [...attempts, ...result.warnings],
        complete: !result.warnings.length,
      });
      const saved = await readPlaces(env, scope, center, radius, mode, p);
      return output({
        ...saved,
        refreshed: true,
        provider,
        warnings: [...attempts, ...result.warnings],
      });
    }
  }
  if (path === "/api/discovery/summary" && req.method === "GET")
    return output(await cacheSummary(env, scope));
  if (path === "/api/discovery/import" && req.method === "POST") {
    if (
      !env.DATA_ADMIN_TOKEN ||
      req.headers.get("authorization") !== `Bearer ${env.DATA_ADMIN_TOKEN}`
    )
      return output({ error: "未授权。" }, 403);
    const text = await req.text();
    if (text.length > 350000) return output({ error: "批次过大。" }, 413);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return output({ error: "导入格式无效。" }, 400);
    }
    if (
      !data ||
      !Array.isArray(data.stores) ||
      data.stores.length > 500 ||
      !data.run ||
      typeof data.run.key !== "string" ||
      !providerNames[data.run.provider]
    )
      return output({ error: "导入格式无效。" }, 400);
    const storage = {};
    const count = await savePlaces(
      env,
      isQA ? scope : "public",
      data.stores,
      data.run,
      storage,
    );
    return output({ ok: true, count, storage });
  }
  if (path === "/api/navigation/nearest" && req.method === "POST") {
    if (!isQA && !origins.has(origin))
      return output({ error: "请从地图页面规划路线。" }, 403);
    if (!(await rate(req, env, scope, 30, "navigation")))
      return output({ error: "导航请求较频繁。" }, 429);
    const p = await body(req);
    if (!validateArea(p.origin, p.radius))
      return output({ error: "请选择有效出发点与范围。" }, 400);
    const cached = await readPlaces(env, scope, p.origin, p.radius, "home", {
      category: "discount",
    });
    const own = await env.DB.prepare("SELECT record FROM stores WHERE scope=?")
      .bind(scope)
      .all();
    const known = new Set();
    const unique = [];
    for (const s of [
      ...own.results.map((r) => JSON.parse(r.record)),
      ...cached.stores,
    ]) {
      if (known.has(s.id)) continue;
      known.add(s.id);
      if (s.amapId) known.add(s.amapId);
      unique.push(s);
    }
    const near = unique.filter(
      (s) =>
        s.category === "discount" &&
        s.location &&
        distance(p.origin, s.location) <= p.radius,
    );
    try {
      return output(
        await planNearest(p.origin, near, env, env.UPSTREAM_FETCH || fetch),
      );
    } catch (e) {
      return output(
        { error: e.message },
        e instanceof NavigationError ? e.status : 503,
      );
    }
  }

  if (path === "/api/water/geocode" && req.method === "GET") {
    if (!(await rate(req, env, scope, 30, "geocode")))
      return output({ error: "地址查询较频繁，请稍后重试。" }, 429);
    const query = (url.searchParams.get("query") || "").trim();
    if (query.length < 2 || query.length > 100)
      return output({ error: "请输入完整城市和门店地址。" }, 400);
    const d = await amap(env, "/v3/geocode/geo", { address: query });
    const place = d.geocodes?.[0];
    return place
      ? output({
          location: place.location.split(",").map(Number),
          address: place.formatted_address,
          precision: ["兴趣点", "门牌号"].includes(place.level)
            ? "poi"
            : "area",
        })
      : output({ error: "未找到地点，请手动补充坐标或保留位置待确认。" }, 404);
  }
  if (path === "/api/water" && req.method === "GET") {
    if (scope === "public") await seed(env);
    if (scope === "public" && !writesPaused(env)) await correctWaterPoint(env);
    const rows = await env.DB.prepare(
      "SELECT record FROM offers WHERE scope=? ORDER BY updated_at DESC LIMIT 1000",
    )
      .bind(scope)
      .all();
    const feedbackRows = await env.DB.prepare(
      "SELECT offer_id, type, COUNT(*) AS count, MAX(created_at) AS last_at FROM feedback WHERE scope=? GROUP BY offer_id,type",
    )
      .bind(scope)
      .all();
    const offers = rows.results.map((r) => {
      const o = JSON.parse(r.record),
        f = { available: 0, changed: 0, soldOut: 0, lastAt: "", lastType: "" };
      for (const row of feedbackRows.results.filter(
        (item) => item.offer_id === o.id,
      )) {
        f[row.type === "sold-out" ? "soldOut" : row.type] = row.count;
        if (row.last_at > f.lastAt) {
          f.lastAt = row.last_at;
          f.lastType = row.type;
        }
      }
      return { ...o, feedback: f };
    });
    return output({
      offers,
      shared: true,
      queriedAt: new Date().toISOString(),
      limit: 1000,
    });
  }
  const history = path.match(/^\/api\/water\/([a-zA-Z0-9-]+)\/history$/);
  if (history && req.method === "GET") {
    const revisions = await env.DB.prepare(
      "SELECT before_record,after_record,created_at FROM revisions WHERE scope=? AND offer_id=? ORDER BY seq DESC LIMIT 20",
    )
      .bind(scope, history[1])
      .all();
    const feedback = await env.DB.prepare(
      "SELECT type,note,created_at FROM feedback WHERE scope=? AND offer_id=? ORDER BY created_at DESC LIMIT 20",
    )
      .bind(scope, history[1])
      .all();
    return output({
      revisions: revisions.results.map((r) => ({
        before: r.before_record ? JSON.parse(r.before_record) : null,
        after: JSON.parse(r.after_record),
        at: r.created_at,
      })),
      feedback: feedback.results,
    });
  }
  if (!["POST", "PUT"].includes(req.method))
    return output({ error: "接口不存在。" }, 404);
  if (!isQA && !origins.has(origin))
    return output({ error: "请从穷鬼地图页面提交。" }, 403);
  if (writesPaused(env)) return output({ error: quotaMessage }, 503);
  if (!(await rate(req, env, scope)))
    return output({ error: "本小时提交较多，请稍后再试。" }, 429);
  const value = await body(req);
  if (path === "/api/water" && req.method === "POST") {
    const input = cleanInput(value),
      issue = validateWater(input);
    if (issue) return output({ error: issue }, 400);
    const o = {
      ...input,
      id: crypto.randomUUID(),
      origin: "community",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO offers (scope,id,record,version,updated_at) VALUES (?,?,?,?,?)",
      ).bind(scope, o.id, JSON.stringify(o), 1, o.updatedAt),
      env.DB.prepare(
        "INSERT INTO revisions(scope,offer_id,before_record,after_record,created_at) VALUES(?,?,?,?,?)",
      ).bind(scope, o.id, null, JSON.stringify(o), o.updatedAt),
    ]);
    return output({ offer: o }, 201);
  }
  const match = path.match(/^\/api\/water\/([a-zA-Z0-9-]+)(\/feedback)?$/);
  if (!match) return output({ error: "接口不存在。" }, 404);
  const o = await getOffer(env, scope, match[1]);
  if (!o) return output({ error: "线索不存在。" }, 404);
  if (match[2] && req.method === "POST") {
    if (
      !["available", "changed", "sold-out"].includes(value.type) ||
      typeof value.note !== "string" ||
      value.note.length > 500
    )
      return output({ error: "反馈类型或内容无效。" }, 400);
    await env.DB.prepare(
      "INSERT INTO feedback(id,scope,offer_id,type,note,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        scope,
        o.id,
        value.type,
        value.note,
        new Date().toISOString(),
      )
      .run();
    return output({ ok: true });
  }
  if (req.method === "PUT") {
    const input = cleanInput(value),
      issue = validateWater(input);
    if (issue) return output({ error: issue }, 400);
    if (value.version !== o.version)
      return output(
        { error: "这条线索已经被别人更新，请刷新后基于最新版再修改。" },
        409,
      );
    const next = {
      ...o,
      ...input,
      version: o.version + 1,
      updatedAt: new Date().toISOString(),
    };
    delete next.feedback;
    const result = await env.DB.batch([
      env.DB.prepare(
        "UPDATE offers SET record=?,version=?,updated_at=? WHERE scope=? AND id=? AND version=?",
      ).bind(
        JSON.stringify(next),
        next.version,
        next.updatedAt,
        scope,
        o.id,
        o.version,
      ),
      env.DB.prepare(
        "INSERT INTO revisions(scope,offer_id,before_record,after_record,created_at) SELECT ?,?,?,?,? WHERE changes()=1",
      ).bind(
        scope,
        o.id,
        JSON.stringify(o),
        JSON.stringify(next),
        next.updatedAt,
      ),
    ]);
    return result[0].meta.changes
      ? output({ offer: next })
      : output({ error: "同时发生了其他更新，请刷新后重试。" }, 409);
  }
  return output({ error: "接口不存在。" }, 404);
}
export default {
  async fetch(req, env) {
    let response;
    try {
      response = await route(req, env);
    } catch (e) {
      if (
        env.DATA_ADMIN_TOKEN &&
        req.headers.get("authorization") === `Bearer ${env.DATA_ADMIN_TOKEN}`
      ) {
        let detail = String(e.message || "request failed").replace(
          /https?:\/\/\S+/g,
          "[URL]",
        );
        for (const [name, value] of Object.entries(env))
          if (
            /KEY|TOKEN|CODE|(?:^|_)SK$/.test(name) &&
            typeof value === "string" &&
            value.length >= 8
          )
            detail = detail.replaceAll(value, "[redacted]");
        return output(
          { error: "服务诊断失败", detail: detail.slice(0, 250) },
          503,
        );
      }
      response = output(
        {
          error: quotaError(e)
            ? quotaMessage
            : e instanceof SyntaxError
              ? "提交的 JSON 无效。"
              : e.message?.includes("高德")
                ? e.message
                : "服务暂时不可用，请稍后重试。",
        },
        e instanceof SyntaxError ? 400 : 503,
      );
    }
    const headers = new Headers(response.headers),
      origin = req.headers.get("origin");
    if (origins.has(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-QA-Token,X-QA-Scope",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
