// Historical flag name: detects the Pages build, not demo data. Pages uses the shared HTTPS API.
export const STATIC_DEMO = import.meta.env.MODE === "pages";
export const WATER_API = STATIC_DEMO
  ? "https://poor-map-api.gong7968.workers.dev"
  : "";
