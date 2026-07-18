import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./theme-apple.css";
import "./theme-site.css";

// Deployment-specific theme: only the squadreader.com build is made with
// VITE_THEME=apple (npm run build:apple). Setting the attribute synchronously
// before render activates the token overrides with no flash. The agent build
// never sets it, so altaisquad keeps the default indigo theme.
//   /replay/* → data-theme="apple": the dark viewer that matches the (dark) map.
//   /stats/*  → data-site="1":      the light+dark, theme-aware SITE surface that
//               matches the squadreader.com homepage (central/web/index.html).
if (import.meta.env.VITE_THEME === "apple") {
  const isStats = window.location.pathname.startsWith("/stats");
  document.documentElement.setAttribute(
    isStats ? "data-site" : "data-theme",
    isStats ? "1" : "apple");
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");
createRoot(root).render(<StrictMode><App /></StrictMode>);
