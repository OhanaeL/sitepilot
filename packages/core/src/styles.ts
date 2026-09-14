import driverCss from "driver.js/dist/driver.css";

const STYLE_ID = "sitepilot-driver-css";

export function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = driverCss;
  document.head.appendChild(style);
}
