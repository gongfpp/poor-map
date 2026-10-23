import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WaterPage from "./WaterPage";
import "./style.css";
import "./map-list.css";
import { installTelemetry } from "./telemetry";
import { sharedStoreId } from "./store-link";
installTelemetry();
function Router() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const storeId = sharedStoreId(route);
  return route.startsWith("#/water") ? (
    <WaterPage />
  ) : (
    <App key={storeId ?? "home"} sharedStoreId={storeId} />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
);
