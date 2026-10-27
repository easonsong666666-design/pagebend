<h1 align="center">PageBend</h1>
<p align="center"><strong>Your UI looks great. Now give it real-world content.</strong></p>
<p align="center">Long names. Huge fonts. Narrow screens. Missing images.<br>Stress-test a real URL and get an offline before/after report. No API key. No test suite to write.</p>
<p align="center">
  <a href="https://easonsong666666-design.github.io/pagebend/">Open a real report</a> ·
  <a href="#try-it">Try it</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/easonsong666666-design/pagebend/releases">Releases</a>
</p>

[![Tests](https://github.com/easonsong666666-design/pagebend/actions/workflows/ci.yml/badge.svg)](https://github.com/easonsong666666-design/pagebend/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/license-MIT-ea7549.svg)](LICENSE)

![Real PageBend run: inspect fragile layouts, then compare the repaired page](docs/demo.gif)

[Watch the compact video](https://easonsong666666-design.github.io/pagebend/demo.webm) · [View a still screenshot](docs/preview.png)

A neat sample name fits your card. A real customer's name does not. A translated label clips the checkout button. Increasing font size pushes a price outside its container.

PageBend opens your page in Chromium, applies one temporary stress condition at a time, and records the result. It compares geometry **before and after** so you can distinguish new candidates from problems that already existed. Each candidate includes a CSS selector, measured overflow, a screenshot location and a copyable repair prompt.

See [one clipped button, the CSS repair, and the rescan](docs/repair-walkthrough.md) for a concrete walkthrough.

## Try it

Requires **Node.js 20+**. Try the included page with one command — no global install or Git required:

```sh
npx --yes https://github.com/easonsong666666-design/pagebend/releases/download/v0.1.2/pagebend-0.1.2.tgz demo --setup --open
```

`--setup` installs the matching Chromium browser if needed, then runs the scan. The first download can take a few minutes. Already have Chrome? Replace `--setup` with `--channel chrome` to skip it. The report opens in your browser; PageBend runs locally. No account, API key, telemetry or cloud service is needed to run a scan.

Replace `demo` with `http://localhost:3000` to scan your own running app; add `--out my-app-report` to keep it separate from the demo. The package currently comes from a GitHub Release, not the npm registry.

For regular use, install once:

```sh
npm install -g https://github.com/easonsong666666-design/pagebend/releases/download/v0.1.2/pagebend-0.1.2.tgz

pagebend http://localhost:3000 --setup --out my-app-report --open
```

After the browser is installed, you can omit `--setup`. `pagebend install-browser` remains available as a separate setup step, including for CI.

Prefer a local checkout?

```sh
git clone https://github.com/easonsong666666-design/pagebend.git
cd pagebend
npm ci --ignore-scripts
npm run install:browser
npm run demo
# Open pagebend-report/report.html
```

The output folder contains **`report.html`** (all screenshots, styles and scripts embedded) and **`report.json`** (machine-readable evidence). Copy the HTML file to another machine and open it. No server required. Existing output is preserved unless you pass `--force`.

## Six ways to bend a page

| Profile | What changes | What to inspect |
| --- | --- | --- |
| `long-text` | Visible text grows to roughly 2× its length | Tight buttons, cards, labels and navigation |
| `unbroken` | A deterministic 56-character word is appended | Missing wrapping and flex min-width issues |
| `text-zoom` | Computed font sizes are doubled once | Fixed-height containers and clipped text |
| `narrow` | Viewport becomes 375 CSS pixels wide | Responsive reflow and horizontal overflow |
| `rtl` | Layout direction becomes right-to-left | Directional assumptions; review visually |
| `missing-images` | Images are replaced by broken data URIs | Fallback text, spacing and missing dimensions |

Every scenario starts in a **fresh browser context**. Text changes preserve markup and skip code blocks, inputs, editable areas and hidden content. No source files are modified and no forms are submitted. The target page still executes its own JavaScript and makes its normal network requests.

## Fit it into your workflow

```sh
# Only run the checks you need.
pagebend http://localhost:3000 --profiles long-text,text-zoom,narrow

# Wait for an SPA's ready state. Exclude intentional scrolling or decoration.
pagebend http://localhost:3000 --wait-for '[data-ready]' --ignore '.ticker'

# Test a single component; ignore selectors can be repeated.
pagebend http://localhost:3000 --scope '#checkout' --ignore '[data-pagebend-ignore]'

# Use your locally saved Playwright session for a signed-in page.
pagebend http://localhost:3000 --storage-state playwright/.auth/user.json

# Fail a CI step when new geometry candidates appear.
pagebend http://localhost:3000 --fail-on new --out artifacts/pagebend

# Run the repaired version of the included demo.
pagebend demo --fixed --out pagebend-fixed-report --open
```

`--fail-on none` is the default. `--fail-on new` returns **1** for new candidates; `--fail-on any` also counts existing candidates. Execution or scenario errors return **2**, including unreachable pages and missing selectors. Successful scans return **0**. RTL and missing-image scenarios still need visual review even if they produce no geometry candidates.

Use `pagebend --help` for viewport, settle time, timeout and browser options. Tests do not click through menus, scroll to trigger every lazy-loaded section, or navigate to other routes. Scan each relevant page/state explicitly.

### Use from JavaScript

Install PageBend **inside the project that will import it**. A global or temporary `npx` installation only provides the CLI; Node does not resolve it as a project dependency.

```sh
npm install --save-dev https://github.com/easonsong666666-design/pagebend/releases/download/v0.1.2/pagebend-0.1.2.tgz
npx --no-install pagebend install-browser
```

Save this as `check-layout.mjs` in that project, start your app, then run `node check-layout.mjs`:

```js
import { scan, renderReport } from 'pagebend';
import { writeFile } from 'node:fs/promises';

const report = await scan({
  url: 'http://localhost:3000',
  profiles: ['long-text', 'narrow'],
  ignore: ['.carousel'],
});
await writeFile('report.html', renderReport(report));
```

### GitHub Actions

Start your app using your project's existing workflow, wait until it is ready, then run PageBend and upload the report even if it finds candidates. A complete example is in [docs/ci-example.md](docs/ci-example.md). Pin the release or a commit when using it in CI.

## What the findings mean

PageBend reports **review candidates**, not a design score or an accessibility certificate. It measures page/element overflow and text overflowing a clipping box, suppressing common intentional patterns such as scroll containers, ellipsis and line clamps. It cannot infer every design intention.

“New” means that the same check and selector were absent in that scenario's baseline. An existing candidate can become worse; its before/after measurements remain in the report. Repeated findings across scenarios are counted separately.

Text expansion is a layout stress test, not a real translation. Doubling font sizes is not browser zoom. RTL does not translate text. Missing-images changes `<img>` sources, not every CSS background. v0.1 inspects rendered light DOM, not iframe, shadow DOM or canvas contents. Animated, randomized or frequently rerendered content can vary between captures. DOM inspection is capped at 5,000 elements, findings at 100 per scenario, and screenshots at 12,000px high; the report warns when limits are reached.

**Reports contain screenshots and visible content.** URL query strings and fragments are removed from the displayed URL, but private information can still appear on the page. Review reports before sharing. Authentication state is read locally and is not included in the report.

## Why another visual testing tool?

Screenshot regression tools compare one version of an application with another. PageBend asks a different question: **does this same page survive less convenient content and display conditions?** You do not need existing translations, baseline image files, or an account.

The ideas build on established practice. Microsoft's [pseudolocalization guidance](https://learn.microsoft.com/globalization/methodology/pseudolocalization) explains how expanded strings expose layout issues. [Playwright](https://playwright.dev/) provides the browser engine. [LocalePass](https://github.com/CodingRasi/LocalePass), [Playwright Layout Inspector](https://github.com/spelech/playwright-layout-inspector), and [stress-test-ui](https://github.com/ardjo-s/stress-test-ui) explore adjacent problems. PageBend's focus is temporary stress on your actual URL plus a portable report.

## Development

```sh
npm ci --ignore-scripts
npm run install:browser
npm test
```

Tests exercise real browser geometry, known fragile and repaired pages, profile isolation, deliberate scrolling/ellipsis, report injection and command failures. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a reproducible case.

MIT licensed. Built with AI assistance and reviewed through executable tests; the tests and limits are in the repository. If PageBend finds a layout bug you would have shipped, a small reproducible issue is especially useful.
