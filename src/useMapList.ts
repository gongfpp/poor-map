import { useCallback, useEffect, useRef, useState } from "react";

// Keep the map and list mounted so filters, scroll and map position survive closing.
export function useMapList() {
  const [mapOnly, setMapOnly] = useState(() => window.innerWidth < 800);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeList = useCallback(() => {
    setMapOnly(true);
    requestAnimationFrame(() => toggleRef.current?.focus());
  }, []);
  const toggleList = () => {
    if (!mapOnly) closeList();
    else {
      setMapOnly(false);
      requestAnimationFrame(() => closeRef.current?.focus());
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !mapOnly &&
        !document.querySelector('[role="dialog"]') &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        closeList();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [mapOnly, closeList]);
  return { mapOnly, setMapOnly, closeList, toggleList, toggleRef, closeRef };
}
