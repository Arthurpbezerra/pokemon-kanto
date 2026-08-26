import { useEffect, useState } from "react";

/** True only on touch-primary narrow screens (phones). Mouse/trackpad always uses desktop layout. */
export function detectMobileSpLayout(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(pointer: fine)").matches) return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

export function useMobileSpLayout(): boolean {
  const [isMobileSp, setIsMobileSp] = useState(() => detectMobileSpLayout());

  useEffect(() => {
    const mqNarrow = window.matchMedia("(max-width: 768px)");
    const mqFine = window.matchMedia("(pointer: fine)");
    const onChange = () => setIsMobileSp(detectMobileSpLayout());
    mqNarrow.addEventListener("change", onChange);
    mqFine.addEventListener("change", onChange);
    return () => {
      mqNarrow.removeEventListener("change", onChange);
      mqFine.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mapLayout = isMobileSp ? "sp" : "desktop";
    return () => {
      delete document.documentElement.dataset.mapLayout;
    };
  }, [isMobileSp]);

  return isMobileSp;
}
