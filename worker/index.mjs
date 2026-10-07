import { seedWater, validateWater } from "../src/water-domain.ts";
const origins = new Set([
  "https://gongfpp.github.io",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);
const groups = [
  ["snack", "赵一鸣零食|零食很忙|零食有鸣"],
  ["discount", "好特卖|嗨特购|奥特乐"],
  ["market", "三江购物|生鲜超市|超市"],
];
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
  await env.DB.batch(
    seedWater.map((o) =>
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
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
  if (path === "/api/water/config" && req.method === "GET")
    return output({
      jsKey: env.AMAP_JS_KEY || "",
      mapReady: !!(env.AMAP_JS_KEY && env.AMAP_JS_SECURITY_CODE),
      searchReady: !!env.AMAP_WEB_SERVICE_KEY,
      shared: true,
    });
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
      !/^\/v[345]\/(place\/(around|text|detail)|geocode\/(geo|regeo)|assistant\/inputtips|config\/district|map\/styles)\/?$/.test(
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
  if (path === "/api/water/candidates" && req.method === "GET") {
    if (!env.AMAP_WEB_SERVICE_KEY)
      return output({
        stores: [],
        configured: false,
        note: "高德门店检索尚未开通；以下水价线索来自用户收录。",
      });
    if (!(await rate(req, env, scope, 60, "search")))
      return output({ error: "搜店请求较频繁，请稍后重试。" }, 429);
    const coords = (url.searchParams.get("center") || "")
        .split(",")
        .map(Number),
      radius = Number(url.searchParams.get("radius"));
    if (
      coords.length !== 2 ||
      !coords.every(Number.isFinite) ||
      coords[0] < 72 ||
      coords[0] > 138 ||
      coords[1] < 0.8 ||
      coords[1] > 56 ||
      !Number.isInteger(radius) ||
      radius < 100 ||
      radius > 10000
    )
      return output({ error: "查询中心或范围无效。" }, 400);
    const results = await Promise.allSettled(
      groups.map(async ([category, keywords]) => {
        const d = await amap(env, "/v3/place/around", {
          location: coords.map((n) => n.toFixed(6)).join(","),
          radius,
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
        warnings.push(r.reason.message);
        return;
      }
      if (r.value.count > r.value.pois.length)
        warnings.push(`${groups[i][0]} 仅展示首批门店，可缩小范围。`);
      for (const p of r.value.pois) {
        const location = String(p.location || "")
          .split(",")
          .map(Number);
        if (
          p.id &&
          location.length === 2 &&
          location.every(Number.isFinite) &&
          !found.has(p.id)
        )
          found.set(p.id, {
            id: p.id,
            name: p.name,
            address: [p.cityname, p.adname, p.address]
              .filter((x) => typeof x === "string")
              .join(" "),
            location,
            category: r.value.category,
            tags: ["可能卖水", "价格未收录"],
            source: "amap",
          });
      }
    });
    if (results.every((r) => r.status === "rejected"))
      return output({ error: warnings.join(" ") }, 502);
    return output({ stores: [...found.values()], configured: true, warnings });
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
      response = output(
        {
          error:
            e instanceof SyntaxError
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
      "Content-Type,X-QA-Token,X-QA-Scope",
    );
    return new Response(response.body, { status: response.status, headers });
  },
};
