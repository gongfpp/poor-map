import { wgs84ToGcj02 } from "./domain";
let pending: Promise<[number, number]> | null = null;
export function currentLocation(force = false) {
  if (force) pending = null;
  if (!pending)
    pending = new Promise<[number, number]>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("当前浏览器不支持定位"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(wgs84ToGcj02([p.coords.longitude, p.coords.latitude])),
        (e) =>
          reject(new Error(e.code === 1 ? "未获得定位权限" : "定位暂时失败")),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: force ? 0 : 300000,
        },
      );
    });
  return pending;
}
