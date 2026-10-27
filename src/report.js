import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./report.css", import.meta.url), "utf8");
const client = readFileSync(
  new URL("./report-client.js", import.meta.url),
  "utf8",
);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

/** Render the same report data as a portable document. No server or CDN required. */
export function renderReport(report) {
  if (!report || !Array.isArray(report.cases))
    throw new TypeError("A PageBend report must contain a cases array.");
  const json = JSON.stringify(report).replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>PageBend — ${escapeHtml(report.url || "Layout stress report")}</title>
<style>${css}</style>
</head>
<body>
<a class="skip-link" href="#report-main">Skip to report</a>
<div class="app-shell">
  <aside class="sidebar" aria-label="Report navigation">
    <a class="brand" href="#report-main" aria-label="PageBend report"><span class="brand-mark" aria-hidden="true"><i></i><i></i></span><span>PageBend<span class="brand-period">.</span></span></a>
    <div class="sidebar-intro">BEND YOUR PAGE.<br>FIND ITS LIMITS.</div>
    <div class="sidebar-section-label">STRESS PROFILES <span id="profile-count"></span></div>
    <nav id="profile-nav" aria-label="Stress profiles"></nav>
    <div class="sidebar-bottom"><span class="local-dot"></span> A portable, offline report<br><span class="sidebar-version" id="report-version"></span></div>
  </aside>
  <main id="report-main" tabindex="-1">
    <header class="report-topbar"><span class="eyebrow">LAYOUT STRESS REPORT</span><button class="button button-quiet" id="download-json" type="button"><span aria-hidden="true">↓</span> Export JSON</button></header>
    <section class="overview" aria-label="Report overview">
      <div class="overview-copy"><div class="kicker"><span class="status-dot"></span> REAL PAGE. TEMPORARY CHANGES.</div><h1>Good design<br><em>holds up.</em></h1><p class="target-url" id="target-url"></p><p class="run-meta" id="run-meta"></p></div>
      <div class="overview-stats"><div class="primary-stat"><span class="stat-value" id="new-count">—</span><div><span class="stat-label">new candidates</span><p>Places to inspect after the page bends.</p></div></div><div class="secondary-stats"><div><strong id="case-count">—</strong><span>profiles run</span></div><div><strong id="existing-count">—</strong><span>already present</span></div><div><strong id="review-count">—</strong><span>need visual review</span></div></div></div>
    </section>
    <details id="warning-panel" class="warning-panel" hidden></details>
    <section class="case-section" aria-labelledby="case-title">
      <div class="case-heading"><div><p class="eyebrow" id="case-index"></p><h2 id="case-title"></h2><p id="case-description" class="case-description"></p></div><div class="case-result" id="case-result"></div></div>
      <div id="case-error" class="case-error" hidden></div>
      <div class="inspection-toolbar"><div class="view-toggle" role="group" aria-label="Screenshot comparison mode"><button type="button" id="split-mode" class="active" aria-pressed="true">Side by side</button><button type="button" id="overlay-mode" aria-pressed="false">Overlay</button></div><label class="highlight-toggle"><input id="show-highlights" type="checkbox" checked><span>Highlight candidates</span></label><span class="viewport-label" id="viewport-label"></span></div>
      <div id="compare-root" class="compare-root"></div>
      <div id="slider-control" class="slider-control" hidden><span>Baseline</span><input id="compare-slider" type="range" min="0" max="100" value="50" aria-label="Reveal stressed screenshot" aria-valuetext="50 percent stressed screenshot"><span>Stressed</span></div>
      <p class="comparison-note" id="comparison-note"></p>
      <div class="findings-heading"><h3>Inspection notes <span id="finding-count"></span></h3><label class="existing-toggle"><input type="checkbox" id="include-existing" checked> Include existing</label></div>
      <div id="findings-list" class="findings-list"></div>
      <div class="mutation-note"><span class="mutation-icon" aria-hidden="true">↳</span><div><strong>What changed in this capture</strong><p id="mutation-details"></p></div></div>
    </section>
    <footer class="report-footer"><p><strong>Evidence to inspect. Not a verdict.</strong> These deterministic checks surface possible layout problems. Intentional cropping and custom widgets can need human judgment. A clean result does not prove accessibility or responsive correctness.</p><span>Made with PageBend<span class="brand-period">.</span></span></footer>
  </main>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<noscript><p class="noscript">Enable JavaScript to inspect this offline report. The original report JSON is embedded in this file.</p></noscript>
<script id="pagebend-data" type="application/json">${json}</script>
<script>${client}</script>
</body>
</html>`;
}
