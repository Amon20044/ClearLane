import { useEffect, useState } from "react";
import { Icon } from "./icons.jsx";

// A floating control surface for map views.
//   * Desktop: a glass accordion docked to a corner (open by default).
//   * Mobile:  a Google-Maps-style bottom sheet — collapsed to a handle bar,
//     expands to (almost) full width/height when tapped.
// pos: "tl" (top-left) | "br" (bottom-right). slot: stack order for mobile sheets.
export default function MapPanel({ title, icon = "settings", pos = "tl", slot = 0,
                                  accent = false, defaultOpenDesktop = true, badge, children }) {
  const isMobile = () => typeof window !== "undefined" && window.innerWidth <= 900;
  const [mobile, setMobile] = useState(isMobile());
  const [open, setOpen] = useState(isMobile() ? false : defaultOpenDesktop);

  useEffect(() => {
    const onResize = () => setMobile(isMobile());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <>
      {mobile && open && <div className="map-sheet-backdrop" onClick={() => setOpen(false)} />}
      <div className={"map-panel " + pos + (open ? " open" : "") + (accent ? " accent" : "")}
        data-slot={slot}>
        <button className="map-panel-head" onClick={() => setOpen((o) => !o)}>
          <span className="mp-grip" />
          <span className="mp-ic"><Icon name={icon} size={16} /></span>
          <span className="mp-title">{title}</span>
          {badge != null && <span className="mp-badge">{badge}</span>}
          <span className="mp-chev"><Icon name="chevron" size={16} /></span>
        </button>
        <div className="map-panel-body"><div className="map-panel-inner">
          <div className="map-panel-pad">{children}</div>
        </div></div>
      </div>
    </>
  );
}
