import { useEffect, useRef, useState } from "react";
import { WATER_API } from "./config";
import { distanceText } from "./domain";
import {
  validNavigationPoint,
  validNavigationResult,
  walkingNavigationUrl,
  type NavigationResult,
} from "./navigation-domain";
import "./navigation.css";
import { track } from "./telemetry";

export type NavigationPanelProps = {
  gpsOrigin: [number, number] | null;
  mapCenter: [number, number];
  radius: number;
  onLocate: () => Promise<[number, number]>;
  onPickOrigin: () => void;
  pickedOrigin: [number, number] | null;
  onRoute: (route: NavigationResult | null) => void;
  onShowRoute: () => void;
};
export function NavigationPanel({
  gpsOrigin,
  mapCenter,
  radius,
  onLocate,
  onPickOrigin,
  pickedOrigin,
  onRoute,
  onShowRoute,
}: NavigationPanelProps) {
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [originLabel, setOriginLabel] = useState("");
  const [route, setRoute] = useState<NavigationResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"locating" | "routing" | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;
  const choose = (point: [number, number], label: string) => {
    if (!validNavigationPoint(point)) {
      setError("出发点坐标无效，请重新选择。");
      return;
    }
    track("navigation_origin", {
      action: label.startsWith("设备")
        ? "gps"
        : label.startsWith("地图中心")
          ? "map_center"
          : "map_pick",
    });
    generation.current++;
    request.current?.abort();
    setOrigin(point);
    setOriginLabel(label);
    setError("");
    setBusy(null);
    setRoute(null);
    onRouteRef.current(null);
  };
  useEffect(() => {
    if (pickedOrigin) choose(pickedOrigin, "地图点选出发点（参考）");
  }, [pickedOrigin]);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    generation.current++;
    request.current?.abort();
    setRoute(null);
    setBusy(null);
    onRouteRef.current(null);
  }, [radius]);
  const locate = async () => {
    request.current?.abort();
    const current = ++generation.current;
    setBusy("locating");
    setError("");
    setRoute(null);
    onRouteRef.current(null);
    try {
      // An existing position is only adopted after this explicit button click.
      const point = await onLocate();
      if (generation.current === current) choose(point, "设备定位出发点");
    } catch {
      if (generation.current === current) {
        setOrigin(null);
        setOriginLabel("");
        setError("定位失败。请允许位置权限，或点选地图作为参考出发点。");
      }
    } finally {
      if (generation.current === current) setBusy(null);
    }
  };
  const plan = async () => {
    if (!origin || !validNavigationPoint(origin)) {
      setError("请先选择出发点。");
      return;
    }
    const current = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    track("navigation_plan_start");
    setBusy("routing");
    setError("");
    setRoute(null);
    onRouteRef.current(null);
    try {
      const response = await fetch(`${WATER_API}/api/navigation/nearest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, radius }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(35000),
        ]),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error.slice(0, 200)
            : "步行路线暂不可用。",
        );
      if (!validNavigationResult(data))
        throw new Error("收到的路线数据无效，请重新规划。");
      if (generation.current === current) {
        track("navigation_plan_success", {
          count: data.compared,
          source: data.provider,
        });
        setRoute(data);
        onRouteRef.current(data);
      }
    } catch (e) {
      if (generation.current === current && !controller.signal.aborted) {
        track("navigation_plan_error");
        setError(
          e instanceof Error && e.name !== "TimeoutError"
            ? e.message
            : "算路超时，请稍后重试。",
        );
      }
    } finally {
      if (generation.current === current) setBusy(null);
    }
  };
  return (
    <details className="navigation-panel" aria-label="步行去硬折扣店">
      <summary>
        步行去硬折扣店 <span>选择出发点 → 比较路线</span>
      </summary>
      <div className="navigation-body">
        <div className="navigation-origins">
          <button type="button" onClick={locate} disabled={!!busy}>
            {busy === "locating" ? "定位中…" : "从我的位置出发"}
          </button>
          <button
            type="button"
            onClick={() => choose([...mapCenter], "地图中心出发点（参考）")}
          >
            从地图中心出发（参考）
          </button>
          <button
            type="button"
            onClick={() => {
              generation.current++;
              request.current?.abort();
              setBusy(null);
              setOrigin(null);
              setOriginLabel("");
              setError("");
              setRoute(null);
              onRouteRef.current(null);
              onPickOrigin();
            }}
          >
            点选出发点
          </button>
        </div>
        <p className="navigation-origin">
          {origin
            ? originLabel
            : gpsOrigin
              ? "已获得设备位置，点击“从我的位置出发”重新定位。"
              : "选择出发点；定位不可用时，可点选地图。"}
        </p>
        <button
          type="button"
          className="navigation-plan"
          disabled={!origin || !!busy}
          onClick={plan}
        >
          {busy === "routing" ? "正在比较步行路线…" : "找步行最近的折扣店"}
        </button>
        {error && (
          <p className="navigation-error" role="alert">
            {error}
          </p>
        )}
        {route && origin && (
          <div className="navigation-result" aria-live="polite">
            <strong>{route.destination.name}</strong>
            <p>
              步行 {distanceText(route.distance)} · 约{" "}
              {Math.max(1, Math.ceil(route.duration / 60))} 分钟
            </p>
            <p>
              {route.comparisonLimited
                ? "已成功算路门店中距离最短"
                : "当前范围缓存门店中步行距离最短"}{" "}
              · 比较 {route.compared} 家 ·{" "}
              {{ amap: "高德", tencent: "腾讯", baidu: "百度" }[route.provider]}
            </p>
            <button type="button" onClick={onShowRoute}>
              查看路线地图
            </button>
            <a
              href={walkingNavigationUrl(origin, route.destination)}
              target="_blank"
              rel="noopener noreferrer"
            >
              打开高德步行导航
            </a>
            <small>
              语音导航在高德 App
              中进行；参考出发点需自行确认，室内楼层以现场为准。
            </small>
            {route.steps.length > 0 && (
              <details>
                <summary>步行指引（{route.steps.length} 步）</summary>
                <ol>
                  {route.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </details>
            )}
            {route.warnings.map((warning, i) => (
              <p className="navigation-warning" key={i}>
                {warning}
              </p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
