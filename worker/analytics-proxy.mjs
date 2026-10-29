// Only the analytics protocol crosses this boundary; never forward client headers/IPs.
export async function proxyAnalytics(req, env, scope, { body, output }) {
  const url = new URL(req.url);
  const valid =
    (req.method === "POST" && url.pathname === "/api/analytics/events") ||
    (req.method === "GET" && url.pathname === "/api/analytics/stats") ||
    (req.method === "DELETE" &&
      url.pathname === "/api/analytics/qa" &&
      scope.startsWith("qa:"));
  if (!valid) return output({ error: "接口不存在。" }, 404);
  if (
    req.method === "GET" &&
    (!env.ANALYTICS_TOKEN ||
      req.headers.get("authorization") !== `Bearer ${env.ANALYTICS_TOKEN}`)
  )
    return output({ error: "需要统计访问凭据。" }, 403);
  const target = new URL(env.ANALYTICS_ORIGIN + url.pathname);
  if (target.protocol !== "https:" || !env.ANALYTICS_INGEST_TOKEN)
    return output({ error: "统计服务配置不可用。" }, 503);
  if (req.method === "GET")
    target.searchParams.set(
      "days",
      String(
        Math.min(30, Math.max(1, Number(url.searchParams.get("days")) || 7)),
      ),
    );
  const headers = {
    "Content-Type": "application/json",
    "X-Analytics-Key": env.ANALYTICS_INGEST_TOKEN,
    "X-Analytics-Scope": scope,
  };
  if (req.method === "GET")
    headers.Authorization = `Bearer ${env.ANALYTICS_TOKEN}`;
  // Hourly salted pseudonym exists only in bounded receiver memory, never in the DB.
  const raw = `${req.headers.get("cf-connecting-ip") || "local"}:${Math.floor(Date.now() / 3600000)}:${env.ANALYTICS_INGEST_TOKEN}`;
  headers["X-Analytics-Rate"] = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const payload =
    req.method === "POST" ? JSON.stringify(await body(req)) : undefined;
  try {
    const response = await (env.ANALYTICS_FETCH || fetch)(target, {
      method: req.method,
      headers,
      body: payload,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status >= 300 && response.status < 400)
      throw new Error("redirect");
    return output(await response.json(), response.status);
  } catch {
    return output({ error: "统计服务暂时不可用。" }, 503);
  }
}
