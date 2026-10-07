import { useEffect, useRef, useState } from "react";
import { LocateFixed, Minus, Plus, RotateCcw } from "lucide-react";
import { categories, type Store } from "./domain";
declare global {
  interface Window {
    AMap: any;
    _AMapSecurityConfig: { serviceHost: string };
  }
}
let sdkPromise: Promise<any> | null = null;
function loadSdk(key: string) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!sdkPromise)
    sdkPromise = new Promise((resolve, reject) => {
      window._AMapSecurityConfig = {
        serviceHost: `${location.origin}/_AMapService`,
      };
      const script = document.createElement("script");
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
      const timer = setTimeout(() => {
        script.remove();
        sdkPromise = null;
        reject(new Error("地图加载超时，请检查网络或密钥配置。"));
      }, 15000);
      script.onload = () => {
        clearTimeout(timer);
        if (window.AMap) resolve(window.AMap);
        else {
          sdkPromise = null;
          reject(new Error("地图 SDK 未能初始化。"));
        }
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        sdkPromise = null;
        reject(new Error("高德底图加载失败，请检查网络。"));
      };
      document.head.appendChild(script);
    });
  return sdkPromise;
}
type Props = {
  stores: Store[];
  center: [number, number];
  selected: string | null;
  onSelect: (id: string) => void;
  demo: boolean;
  jsKey: string;
  mapReady: boolean;
  onLocate: () => void;
  onMove: (center: [number, number]) => void;
  eventIds: Set<string>;
};
export default function MapView({
  stores,
  center,
  selected,
  onSelect,
  demo,
  jsKey,
  mapReady,
  onLocate,
  onMove,
  eventIds,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<any>(null),
    markers = useRef<any[]>([]),
    callbacks = useRef({ onSelect, onMove });
  const [mapState, setMapState] = useState(""),
    [zoom, setZoom] = useState(1),
    [retry, setRetry] = useState(0),
    [ready, setReady] = useState(false);
  callbacks.current = { onSelect, onMove };
  const latestCenter = useRef(center);
  latestCenter.current = center;
  useEffect(() => {
    if (demo || !mapReady || !host.current) {
      setReady(false);
      return;
    }
    let cancelled = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    setMapState("正在加载高德地图…");
    loadSdk(jsKey)
      .then((AMap) => {
        if (cancelled) return;
        map.current = new AMap.Map(host.current, {
          zoom: 15,
          center: latestCenter.current,
          viewMode: "2D",
          mapStyle: "amap://styles/normal",
        });
        map.current.on("dragend", () => {
          const c = map.current?.getCenter();
          if (c) callbacks.current.onMove([c.lng, c.lat]);
        });
        readyTimer = setTimeout(() => {
          if (!cancelled)
            setMapState("底图未完成加载，请检查高德密钥权限和网络后重试。");
        }, 15000);
        map.current.on("complete", () => {
          clearTimeout(readyTimer);
          if (!cancelled) {
            setReady(true);
            setMapState("");
          }
        });
      })
      .catch((e) => {
        if (!cancelled) setMapState(e.message);
      });
    return () => {
      cancelled = true;
      clearTimeout(readyTimer);
      map.current?.destroy();
      map.current = null;
      setReady(false);
    };
  }, [demo, mapReady, jsKey, retry]);
  useEffect(() => {
    map.current?.setCenter(center);
    setZoom(1);
  }, [center]);
  useEffect(() => {
    if (!map.current || !ready) return;
    map.current.remove(markers.current);
    markers.current = stores.map((s) => {
      const button = document.createElement("button");
      button.className = `pin ${selected === s.id ? "selected" : ""} ${eventIds.has(s.id) ? "event-pin" : ""}`;
      button.style.setProperty(
        "--pin-color",
        categories.find((c) => c.id === s.category)!.color,
      );
      button.textContent = eventIds.has(s.id)
        ? "免"
        : categories.find((c) => c.id === s.category)!.short;
      button.title = s.name;
      button.setAttribute("aria-label", `查看 ${s.name}`);
      button.onclick = () => callbacks.current.onSelect(s.id);
      return new window.AMap.Marker({
        position: s.location,
        content: button,
        offset: new window.AMap.Pixel(-22, -45),
        zIndex: selected === s.id ? 200 : 100,
      });
    });
    map.current.add(markers.current);
    return () => {
      if (map.current) map.current.remove(markers.current);
    };
  }, [stores, selected, ready, eventIds]);
  function changeZoom(delta: number) {
    if (map.current) map.current.setZoom(map.current.getZoom() + delta);
    else setZoom((z) => Math.min(1.8, Math.max(0.65, z + delta * 0.2)));
  }
  return (
    <div className="map-canvas">
      <div
        ref={host}
        className="amap-container"
        style={{ visibility: !demo && mapReady ? "visible" : "hidden" }}
      />
      {(demo || !ready) && (
        <div className="schematic" aria-label="坐标示意图，非真实道路地图">
          <div className="map-drawing" style={{ transform: `scale(${zoom})` }}>
            <svg
              viewBox="0 0 1000 800"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <defs>
                <pattern
                  id="blocks"
                  width="146"
                  height="116"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(-13)"
                >
                  <rect width="146" height="116" fill="#eeede7" />
                  <rect
                    x="14"
                    y="14"
                    width="118"
                    height="88"
                    rx="7"
                    fill="#e6e4dd"
                  />
                  <rect
                    x="24"
                    y="22"
                    width="39"
                    height="30"
                    rx="3"
                    fill="#dfdcd4"
                  />
                  <rect
                    x="70"
                    y="22"
                    width="48"
                    height="55"
                    rx="3"
                    fill="#dedbd4"
                  />
                  <path
                    d="M0 0h146v116H0z"
                    fill="none"
                    stroke="#faf9f5"
                    strokeWidth="12"
                  />
                </pattern>
              </defs>
              <rect width="1000" height="800" fill="url(#blocks)" />
              <path
                d="M830 -40C650 170 1050 255 735 455S810 682 600 860"
                fill="none"
                stroke="#bedbd8"
                strokeWidth="90"
              />
              <path
                d="M830 -40C650 170 1050 255 735 455S810 682 600 860"
                fill="none"
                stroke="#cce6e3"
                strokeWidth="64"
              />
              <path
                d="M-60 260L1090 540M340 -30L620 870M-60 655L1080 275"
                stroke="#dcd8cd"
                strokeWidth="32"
                fill="none"
              />
              <path
                d="M-60 260L1090 540M340 -30L620 870M-60 655L1080 275"
                stroke="#fcfbf6"
                strokeWidth="25"
                fill="none"
              />
              <path
                d="M140 100h145v93H140zM310 545l100-20 25 140-100 20zM833 614h150v114H833z"
                fill="#c9d9b6"
                stroke="#bcccaa"
                strokeWidth="2"
              />
              <g fontSize="12" fill="#a6a398" fontFamily="sans-serif">
                <text x="145" y="152">
                  街区绿地
                </text>
                <text x="835" y="660">
                  邻里公园
                </text>
                <text x="350" y="618">
                  社区花园
                </text>
                <text x="100" y="346" transform="rotate(14 100 346)">
                  生活路（示意）
                </text>
                <text x="350" y="190" transform="rotate(71 350 190)">
                  邻里路（示意）
                </text>
                <text x="762" y="335" transform="rotate(-24 762 335)">
                  河道示意
                </text>
                <text x="62" y="570" transform="rotate(-19 62 570)">
                  街角路（示意）
                </text>
              </g>
              <circle
                cx="500"
                cy="400"
                r="210"
                fill="#8863c9"
                fillOpacity=".035"
                stroke="#9371cb"
                strokeDasharray="5 8"
                strokeOpacity=".25"
              />
            </svg>
            <span className="center-dot" title="搜索中心">
              <i />
            </span>
            {stores.map((s) => {
              const x = 50 + (s.location[0] - center[0]) * 1250,
                y = 50 - (s.location[1] - center[1]) * 1550;
              if (x < 1 || x > 99 || y < 2 || y > 98) return null;
              return (
                <button
                  key={s.id}
                  className={`pin demo-pin ${selected === s.id ? "selected" : ""} ${eventIds.has(s.id) ? "event-pin" : ""}`}
                  style={
                    {
                      left: `${x}%`,
                      top: `${y}%`,
                      "--pin-color": categories.find(
                        (c) => c.id === s.category,
                      )!.color,
                    } as React.CSSProperties
                  }
                  title={s.name}
                  aria-label={`查看 ${s.name}`}
                  onClick={() => onSelect(s.id)}
                >
                  {eventIds.has(s.id)
                    ? "免"
                    : categories.find((c) => c.id === s.category)!.short}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="map-source">
        <span className={`status-dot ${demo ? "" : "live"}`} />
        {demo
          ? "演示街区 · 非真实道路"
          : ready
            ? "高德地图 · GCJ-02"
            : "坐标示意 · 底图尚未就绪"}
      </div>
      {!demo && mapState && (
        <div className="map-error">
          {mapState}
          <button onClick={() => setRetry((v) => v + 1)}>重新加载</button>
        </div>
      )}
      <div className="map-controls">
        <button
          title="回到搜索中心"
          aria-label="回到搜索中心"
          onClick={() => {
            map.current?.setCenter(center);
            setZoom(1);
          }}
        >
          <RotateCcw size={18} />
        </button>
        <button
          title="放大"
          aria-label="放大地图"
          onClick={() => changeZoom(1)}
        >
          <Plus size={20} />
        </button>
        <button
          title="缩小"
          aria-label="缩小地图"
          onClick={() => changeZoom(-1)}
        >
          <Minus size={20} />
        </button>
        <button title="定位到我" aria-label="定位到我" onClick={onLocate}>
          <LocateFixed size={20} />
        </button>
      </div>
      <div className="map-legend">
        {categories.map((c) => (
          <span key={c.id}>
            <i style={{ background: c.color }} />
            {c.short}
          </span>
        ))}
        <span>
          <i style={{ background: "#5d35c9" }} />
          免费线索
        </span>
      </div>
    </div>
  );
}
