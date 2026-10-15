export function writesPaused(env) {
  return (
    env.STORAGE_KIND !== "SQLite" &&
    Date.now() < Date.parse(env.WRITE_PAUSED_UNTIL || "")
  );
}
export const quotaError = (e) =>
  /D1.*exceeded.*(?:row write|daily.*write)/i.test(String(e?.message || ""));
export const quotaMessage =
  "今日共享写入额度已用完，请在北京时间08:00额度恢复后重试。已保存门店、水价和导航仍可查看。";

export const placeSearchPaused = (env) =>
  String(env.PLACE_SEARCH_PAUSED) === "true";
export const placeSearchPauseMessage =
  "为保留地图搜索额度，新增搜店已暂停。已保存门店、水价和社区功能仍可使用。";
