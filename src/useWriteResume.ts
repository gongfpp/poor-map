import { useEffect } from "react";
import { WATER_API } from "./config";

// One read of our configuration after a known quota reset. Store snapshots never expire or refresh here.
export function useWriteResume(
  pausedUntil: string | null | undefined,
  map: string,
  onConfig: (config: any) => void,
) {
  useEffect(() => {
    if (!pausedUntil) return;
    const resetAt = Date.parse(pausedUntil);
    if (!Number.isFinite(resetAt)) return;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          const response = await fetch(
            `${WATER_API}/api/water/config?map=${encodeURIComponent(map)}`,
            { signal: controller.signal },
          );
          if (response.ok) onConfig(await response.json());
        } catch {
          /* Keep the last confirmed availability if the server cannot be reached. */
        }
      },
      Math.min(2147483647, Math.max(1500, resetAt - Date.now() + 1500)),
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pausedUntil, map, onConfig]);
}
