export const eventNames = [
  "store_create_start",
  "store_create_success",
  "map_pick",
  "page_view",
  "page_exit",
  "control_click",
  "filter_change",
  "search",
  "results_view",
  "store_open",
  "store_close",
  "favorite_change",
  "navigation_open",
  "navigation_blocked",
  "location_request",
  "location_success",
  "location_failure",
  "city_change",
  "map_drag",
  "map_zoom",
  "map_reset",
  "map_ready",
  "map_error",
  "map_retry",
  "mode_change",
  "modal_open",
  "modal_close",
  "list_toggle",
  "query_start",
  "query_success",
  "query_error",
  "comment_view",
  "comment_submit",
  "comment_success",
  "comment_error",
  "reply_start",
  "water_filter",
  "water_select",
  "water_submit",
  "water_save",
  "water_feedback",
  "water_history",
  "water_refresh",
  "api_error",
  "performance",
  "client_error",
  "privacy_change",
] as const;
export type EventName = (typeof eventNames)[number];
export function cleanProperties(
  raw: unknown,
): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object") return {};
  const allowedStrings: Record<string, string[]> = {
    category: ["all", "discount", "mixue", "snack", "market"],
    feed: ["nearby", "events", "saved"],
    action: [
      "open",
      "close",
      "save",
      "unsave",
      "zoom_in",
      "zoom_out",
      "reset",
      "locate",
      "retry",
      "submit",
      "reply",
      "cancel",
      "water",
      "help",
      "insights",
      "share",
      "list",
      "map",
      "city",
      "history",
      "feedback",
      "refresh",
      "privacy",
    ],
    mode: ["demo", "live"],
    source: ["demo", "amap", "community", "user", "tianditu"],
    status: [
      "success",
      "error",
      "denied",
      "timeout",
      "unavailable",
      "available",
      "changed",
      "sold-out",
    ],
    field: [
      "category",
      "radius",
      "query",
      "feed",
      "sort",
      "spec",
      "includeInactive",
    ],
    spec: ["all", "large", "small", "case"],
    sort: ["distance", "liter", "price", "spend"],
    size: ["desktop", "mobile"],
    metric: ["load", "navigation", "lcp", "cls", "duration"],
  };
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && allowedStrings[key]?.includes(value))
      result[key] = value;
    if (
      typeof value === "number" &&
      [
        "count",
        "radius",
        "durationMs",
        "length",
        "value",
        "depth",
        "statusCode",
      ].includes(key) &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 3600000
    )
      result[key] = Math.round(value * 1000) / 1000;
    if (
      typeof value === "boolean" &&
      ["enabled", "empty", "hasReply", "includeInactive"].includes(key)
    )
      result[key] = value;
  }
  return result;
}
