# Contributing to PageBend

The best contribution is a small page that breaks the detector. We care about actionable evidence more than bigger issue counts.

```sh
npm ci --ignore-scripts
npm run install:browser
npm test
```

Please include a minimal HTML fixture with bug reports. For changes to detection or a profile, add a browser test showing the issue and a fixed page showing it no longer occurs. Preserve intentional scrolling, ellipsis, hidden content and existing semantics. Findings must remain review candidates rather than claims of compliance.

Runtime code is plain Node.js ESM, with Playwright as the only runtime dependency. Reports must stay self-contained, work from a local file, never execute text captured from a page, and make no network requests. New capabilities must retain those properties.

Do not attach real authentication state, secrets or private page screenshots to an issue. Please credit relevant prior work. Human and AI-assisted contributions follow the same review and test requirements; describe what you actually verified.
