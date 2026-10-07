import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WaterPage from "./WaterPage";
import "./style.css";
import { installTelemetry } from "./telemetry";
installTelemetry();
function Router() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const update = () => setRoute(location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route.startsWith("#/water") ? <WaterPage /> : <App />;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>,
);
