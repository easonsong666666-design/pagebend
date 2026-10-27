import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/report.js";

const sample = (overrides = {}) => ({
  schemaVersion: 1,
  version: "0.1.0",
  title: "PageBend report",
  url: "http://localhost:3000/demo",
  createdAt: "2026-10-27T00:00:00.000Z",
  durationMs: 2100,
  settings: { width: 1280, height: 900, profiles: ["long-text"] },
  summary: { cases: 1, newFindings: 1, existingFindings: 0, reviewCases: 1 },
  warnings: [],
  cases: [
    {
      id: "long-text",
      label: "Long text",
      description: "Expand text to inspect the layout.",
      viewport: { width: 1280, height: 900 },
      mutation: { changed: 2, details: "Expanded two text nodes." },
      before: {
        image: "data:image/png;base64,iVBORw0KGgo=",
        width: 1280,
        height: 900,
      },
      after: {
        image: "data:image/png;base64,iVBORw0KGgo=",
        width: 1280,
        height: 900,
      },
      findings: [
        {
          id: "text-clipping:#title",
          kind: "text-clipping",
          status: "new",
          selector: "#title",
          message: "Text extends beyond the title.",
          hint: "Allow the title to wrap.",
          rect: { x: 20, y: 20, width: 100, height: 50 },
          excessPx: 12,
        },
      ],
    },
  ],
  ...overrides,
});

test("renders a complete offline document containing all report data", () => {
  const report = sample();
  const html = renderReport(report);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<style>"));
  assert.ok(html.includes("Side by side"));
  assert.ok(html.includes("Overlay"));
  assert.ok(html.includes("Copy repair prompt"));
  assert.ok(html.includes("application/json"));
  assert.ok(html.includes("data:image/png;base64,iVBORw0KGgo="));
  assert.ok(
    !/<script[^>]+src=|<link[^>]+href=|@import\b/.test(html),
    "no external script, stylesheet, or font imports",
  );
  const embedded = html.match(
    /<script id="pagebend-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.deepEqual(JSON.parse(embedded), report);
});

test("hostile report fields cannot break out of the JSON script or document title", () => {
  const payload =
    '</script><script>globalThis.__pagebendInjected=true</script><img src=x onerror=alert(1)> & " \u2028\u2029';
  const report = sample({ url: payload, title: payload, warnings: [payload] });
  report.cases[0].findings[0].message = payload;
  report.cases[0].findings[0].selector = payload;
  report.cases[0].description = payload;
  const html = renderReport(report);
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(!html.includes("<img src=x"));
  const embedded = html.match(
    /<script id="pagebend-data" type="application\/json">([\s\S]*?)<\/script>/,
  )?.[1];
  assert.ok(!embedded.includes("<"));
  assert.ok(!embedded.includes("&"));
  assert.ok(!embedded.includes("\u2028"));
  assert.ok(!embedded.includes("\u2029"));
  assert.deepEqual(
    JSON.parse(embedded),
    report,
    "escaping preserves the exact original strings",
  );
});

test("report includes keyboard-accessible controls and a restrictive network policy", () => {
  const html = renderReport(sample());
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /aria-label="Reveal stressed screenshot"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /Skip to report/);
  assert.match(html, /ArrowDown/);
  assert.match(html, /prefers-reduced-motion/);
  assert.ok(
    !html.includes(".innerHTML"),
    "report content is built with text nodes",
  );
});

test("empty reports render and invalid input fails early", () => {
  assert.ok(
    renderReport(sample({ cases: [] })).includes("No profiles captured"),
  );
  assert.throws(() => renderReport(null), /cases array/);
  assert.throws(() => renderReport({}), /cases array/);
});
