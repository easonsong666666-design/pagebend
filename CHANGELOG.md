# Changelog

## 0.1.1

- Run a first scan with `--setup`: install the matching Chromium browser when needed and continue directly to the report. Downloads remain opt-in.
- Give actionable missing-browser instructions for temporary `npx` installs.
- Read the report version from the installed package so diagnostics identify the actual release.
- Document a one-command trial with no global installation or Git requirement, and separate output folders for demo and app reports.
- Explain the recorded public demo and show how to run the same scanner locally.

## 0.1.0

- Scan a real URL with six isolated content and layout stress profiles.
- Compare baseline and stressed geometry, with before/after screenshots in a portable offline report.
- Include fragile and repaired examples, a JavaScript API, and CI exit codes.
