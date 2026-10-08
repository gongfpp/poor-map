import { clusterStores } from "./map-clusters";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { LocateFixed, Minus, Plus, RotateCcw } from "lucide-react";
import { activeCategories, gcj02ToWgs84, wgs84ToGcj02 } from "./domain";
import { track } from "./telemetry";
import type { MapProps } from "./MapView";
import "./tianditu.css";
const latLng = (point: [number, number]): L.LatLngTuple => {
  const p = gcj02ToWgs84(point);
  return [p[1], p[0]];
};
export function tileUrl(layer: "vec" | "cva", key: string) {
  return `https://t{s}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(key)}`;
}
export default function TiandituMapView({
  stores,
  center,
  selected,
  onSelect,
  onPickLocation,
  onReadyChange,
  jsKey,
  mapReady,
  onLocate,
  onMove,
  eventIds,
  canLocate = true,
  waterMode = false,
  markerLabels,
  radiusMeters = 3000,
  navigationRoute,
}: MapProps) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    pins = useRef<L.LayerGroup | null>(null),
    ring = useRef<L.Circle | null>(null),
    searchPoint = useRef<L.CircleMarker | null>(null),
    callbacks = useRef({ onSelect, onMove, onPickLocation, onReadyChange });
  callbacks.current = { onSelect, onMove, onPickLocation, onReadyChange };
  const [state, setState] = useState("正在加载天地图…"),
    [ready, setReady] = useState(false),
    [retry, setRetry] = useState(0),
    [currentZoom, setCurrentZoom] = useState(15);
  const latestCenter = useRef(center);
  latestCenter.current = center;
  const latestRadius = useRef(radiusMeters);
  latestRadius.current = radiusMeters;
  useEffect(() => {
    if (!host.current || !mapReady || !jsKey) return;
    setReady(false);
    setCurrentZoom(15);
    callbacks.current.onReadyChange?.(false);
    setState("正在加载天地图…");
    const m = L.map(host.current, {
      zoomControl: false,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 18,
    }).setView(latLng(latestCenter.current), 15);
    map.current = m;
    pins.current = L.layerGroup().addTo(m);
    ring.current = L.circle(latLng(latestCenter.current), {
      radius: latestRadius.current,
      color: "#7b68bb",
      weight: 1,
      opacity: 0.35,
      dashArray: "5 7",
      fillOpacity: 0.015,
      interactive: false,
    }).addTo(m);
    searchPoint.current = L.circleMarker(latLng(latestCenter.current), {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: "#7152c8",
      fillOpacity: 1,
    })
      .bindTooltip("搜索中心")
      .addTo(m);
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>',
    );
    const layers = ["vec", "cva"].map((type) =>
      L.tileLayer(tileUrl(type as "vec" | "cva", jsKey), {
        subdomains: "01234567",
        minZoom: 3,
        maxZoom: 18,
        keepBuffer: 1,
        updateWhenIdle: true,
        attribution:
          type === "vec"
            ? '<a href="https://www.tianditu.gov.cn/" target="_blank" rel="noopener noreferrer">天地图</a>'
            : "",
      }),
    );
    let loaded = new Set<number>(),
      failed = false,
      reported = false;
    const timer = setTimeout(() => {
      setState("地图加载超时，请检查网络后重试。");
      track("map_error");
    }, 20000);
    layers.forEach((layer, i) => {
      layer.on("loading", () => {
        loaded.delete(i);
      });
      layer.on("tileerror", () => {
        failed = true;
        setReady(false);
        callbacks.current.onReadyChange?.(false);
        setState("天地图暂时无法加载，请稍后重试。");
        if (!reported) {
          track("map_error");
          reported = true;
        }
      });
      layer.on("load", () => {
        loaded.add(i);
        if (loaded.size === 2 && !failed) {
          clearTimeout(timer);
          setReady(true);
          callbacks.current.onReadyChange?.(true);
          setState("");
          if (!reported) {
            track("map_ready");
            reported = true;
          }
        }
      });
      layer.addTo(m);
    });
    m.on("zoomend", () => setCurrentZoom(m.getZoom()));
    m.on("click", (e: L.LeafletMouseEvent) => {
      callbacks.current.onPickLocation?.(
        wgs84ToGcj02([e.latlng.lng, e.latlng.lat]),
      );
    });
    m.on("dragend", () => {
      const c = m.getCenter();
      callbacks.current.onMove(wgs84ToGcj02([c.lng, c.lat]));
    });
    const resize = new ResizeObserver(() => m.invalidateSize({ pan: false }));
    resize.observe(host.current);
    return () => {
      clearTimeout(timer);
      resize.disconnect();
      callbacks.current.onReadyChange?.(false);
      m.remove();
      map.current = null;
      pins.current = null;
    };
  }, [jsKey, mapReady, retry]);
  useEffect(() => {
    map.current?.setView(latLng(center), map.current.getZoom(), {
      animate: false,
    });
    ring.current?.setLatLng(latLng(center)).setRadius(radiusMeters);
    searchPoint.current?.setLatLng(latLng(center));
  }, [center, radiusMeters]);
  useEffect(() => {
    const group = pins.current;
    if (!group) return;
    group.clearLayers();
    const groups = waterMode
      ? stores.map((s) => ({ stores: [s], location: s.location }))
      : clusterStores(stores, currentZoom, selected);
    groups.forEach((entry) => {
      const s = entry.stores[0],
        clustered = entry.stores.length > 1;
      const button = document.createElement("button"),
        cat =
          activeCategories.find((c) => c.id === s.category) ||
          activeCategories[0];
      button.className = `pin ${s.id === selected ? "selected" : ""} ${eventIds.has(s.id) ? "event-pin" : ""}`;
      if (clustered) button.classList.add("cluster-pin");
      button.dataset.storeCount = String(entry.stores.length);
      button.style.setProperty(
        "--pin-color",
        waterMode
          ? s.source === "community"
            ? "#659ac4"
            : "#c4a36f"
          : cat.color,
      );
      button.textContent = clustered
        ? String(entry.stores.length)
        : markerLabels?.[s.id] ||
          (waterMode ? (s.source === "community" ? "水" : "店") : cat.short);
      button.title = clustered
        ? `${entry.stores.length}家参考门店，点击展开`
        : s.name;
      button.setAttribute(
        "aria-label",
        clustered ? `展开附近${entry.stores.length}家门店` : `查看 ${s.name}`,
      );
      button.onclick = () => {
        if (clustered)
          map.current?.setView(
            latLng(entry.location),
            Math.min(19, currentZoom + 2),
          );
        else callbacks.current.onSelect(s.id);
      };
      L.marker(latLng(entry.location), {
        icon: L.divIcon({
          html: button,
          className: "td-marker",
          iconSize: [44, 45],
          iconAnchor: [22, 45],
        }),
        zIndexOffset: s.id === selected ? 1000 : 0,
        keyboard: false,
      }).addTo(group);
    });
  }, [stores, selected, ready, eventIds, waterMode, markerLabels, currentZoom]);
  useEffect(() => {
    if (!ready || !map.current || !navigationRoute) return;
    const line = L.polyline(
      navigationRoute.polyline.map((p) => latLng(p)),
      { color: "#7353bf", weight: 6 },
    ).addTo(map.current);
    map.current.fitBounds(line.getBounds(), { padding: [80, 80] });
    return () => {
      line.remove();
    };
  }, [navigationRoute, ready]);
  function zoom(delta: number) {
    track("map_zoom", { action: delta > 0 ? "zoom_in" : "zoom_out" });
    map.current?.setZoom(map.current.getZoom() + delta);
  }
  return (
    <div className="map-canvas td-canvas">
      <div ref={host} className="td-map" aria-label="天地图道路底图" />
      <div className="map-source">
        <span className={`status-dot ${ready ? "live" : ""}`} />
        {ready ? "天地图" : "天地图 · 底图尚未就绪"}
      </div>
      {state && (
        <div className="map-error" role="status">
          {state}
          <button
            onClick={() => {
              setRetry((n) => n + 1);
              track("map_retry");
            }}
          >
            重新加载
          </button>
        </div>
      )}
      <div className="map-controls">
        <button
          aria-label="回到搜索中心"
          onClick={() => {
            map.current?.setView(latLng(center), 15);
            track("map_reset");
          }}
        >
          <RotateCcw size={18} />
        </button>
        <button
          aria-label="放大地图"
          disabled={currentZoom >= 18}
          onClick={() => zoom(1)}
        >
          <Plus size={20} />
        </button>
        <button
          aria-label="缩小地图"
          disabled={currentZoom <= 3}
          onClick={() => zoom(-1)}
        >
          <Minus size={20} />
        </button>
        {canLocate && (
          <button aria-label="定位到我" onClick={onLocate}>
            <LocateFixed size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
