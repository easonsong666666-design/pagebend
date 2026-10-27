# Changelog

## 0.1.2

- Prevent authentication state initialization errors from including credential file contents or invalid cookie values in HTML/JSON reports and JavaScript progress events. Use a fixed recovery message instead; retain normal navigation diagnostics after a context is successfully created.
- Cover malformed authentication files and invalid state objects with browser-backed API and CLI regression tests. Failed scans still save a report and return exit code 2.

## 0.1.1

- Capture content below the viewport up to the documented 12,000px limit; screenshot pixels now match the dimensions used for report overlays.
- Exclude fully clipped screen-reader-only labels from visual clipping candidates.
- Run a first scan with `--setup`: install the matching Chromium browser when needed and continue directly to the report. Downloads remain opt-in.
- Give actionable missing-browser instructions for temporary `npx` installs.
- Read the report version from the installed package so diagnostics identify the actual release.
- Document a one-command trial with no global installation or Git requirement, and separate output folders for demo and app reports.
- Explain the recorded public demo and show how to run the same scanner locally.

## 0.1.0

- Scan a real URL with six isolated content and layout stress profiles.
- Compare baseline and stressed geometry, with before/after screenshots in a portable offline report.
- Include fragile and repaired examples, a JavaScript API, and CI exit codes.
