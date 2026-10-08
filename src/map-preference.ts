export function preferredMap(): "amap" | "tianditu" {
  try {
    return localStorage.getItem("poor-map:basemap") === "tianditu"
      ? "tianditu"
      : "amap";
  } catch {
    return "amap";
  }
}
export function rememberMap(value: string) {
  if (!["amap", "tianditu"].includes(value)) return;
  try {
    localStorage.setItem("poor-map:basemap", value);
  } catch {}
}
