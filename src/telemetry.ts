import { WATER_API, STATIC_DEMO } from "./config";
import { cleanProperties, type EventName } from "./telemetry-schema";
let session: string = crypto.randomUUID();
try {
  session = sessionStorage.getItem("poor-map:session") || session;
  sessionStorage.setItem("poor-map:session", session);
} catch {}
let queue: unknown[] = [];
let installed = false;
export function analyticsEnabled() {
  try {
    return localStorage.getItem("poor-map:analytics") !== "off";
  } catch {
    return true;
  }
}
export function setAnalyticsEnabled(enabled: boolean) {
  try {
    localStorage.setItem("poor-map:analytics", enabled ? "on" : "off");
  } catch {}
  if (!enabled) queue = [];
}
export function track(
  name: EventName,
  properties: Record<string, unknown> = {},
) {
  if (
    !analyticsEnabled() ||
    navigator.doNotTrack === "1" ||
    (STATIC_DEMO && location.hostname !== "gongfpp.github.io")
  )
    return;
  queue.push({
    id: crypto.randomUUID(),
    page: location.hash.startsWith("#/water") ? "water" : "home",
    name,
    properties: cleanProperties(properties),
  });
  if (queue.length > 96) queue.shift();
  if (queue.length >= 12) void flush();
}
async function flush(beacon = false) {
  if (!queue.length) return;
  const events = queue.splice(0, 24),
    payload = JSON.stringify({ session, events }),
    url = `${WATER_API}/api/analytics/events`;
  try {
    if (beacon) {
      if (
        navigator.sendBeacon(
          url,
          new Blob([payload], { type: "application/json" }),
        )
      )
        return;
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
    if (!r.ok && r.status >= 500) {
      queue.unshift(...events);
      queue = queue.slice(0, 96);
    }
  } catch {
    queue.unshift(...events);
    queue = queue.slice(0, 96);
  }
}
export function installTelemetry() {
  if (installed) return;
  installed = true;
  let started = performance.now();
  const view = () => {
    started = performance.now();
    track("page_view", { size: innerWidth < 800 ? "mobile" : "desktop" });
  };
  view();
  window.addEventListener("hashchange", view);
  window.addEventListener("pagehide", () => {
    track("page_exit", {
      durationMs: Math.min(3600000, performance.now() - started),
    });
    void flush(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement)?.closest<HTMLElement>("[data-track]");
    if (el) track("control_click", { action: el.dataset.track });
  });
  window.addEventListener("error", () => track("client_error"));
  window.addEventListener("unhandledrejection", () => track("client_error"));
  window.addEventListener("load", () =>
    track("performance", {
      metric: "load",
      durationMs: Math.min(performance.now(), 3600000),
    }),
  );
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        track("performance", {
          metric: "lcp",
          durationMs: Math.min(e.startTime, 3600000),
        });
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  setInterval(() => void flush(), 5000);
}
