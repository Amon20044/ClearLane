import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import "./styles/app.css";

// Concise copy on phones: the long explainer paragraphs (.sub) are clamped to a
// couple of lines via CSS; tapping one expands the full text. Delegated once,
// globally, so every screen gets it for free (no per-component wiring).
document.addEventListener("click", (e) => {
  const sub = e.target.closest?.(".sub");
  if (sub && !e.target.closest("a, button, input, select")) sub.classList.toggle("sub--open");
});
// Only flag paragraphs that are ACTUALLY truncated, so the "… more" hint never
// shows on short copy. Re-checked on view changes (DOM mutations) and resize.
function markClampedSubs() {
  document.querySelectorAll(".panel .sub").forEach((el) => {
    const open = el.classList.contains("sub--open");
    el.classList.toggle("is-clamped", !open && el.scrollHeight - el.clientHeight > 2);
  });
}
let _raf = 0;
const scheduleMark = () => { cancelAnimationFrame(_raf); _raf = requestAnimationFrame(markClampedSubs); };
new MutationObserver(scheduleMark).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("resize", scheduleMark);
window.addEventListener("load", scheduleMark);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <InstallPrompt />
  </React.StrictMode>
);
