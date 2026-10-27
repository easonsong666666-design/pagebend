# Add PageBend to an existing GitHub Actions job

Your application must already be installed, running and ready. Keep the start/wait steps appropriate to your project; PageBend does not guess your dev command or run your package scripts.

After those steps:

```yaml
- name: Install PageBend
  run: |
    npm install -g https://github.com/easonsong666666-design/pagebend/releases/download/v0.1.0/pagebend-0.1.0.tgz
    pagebend install-browser

- name: Stress the checkout page
  run: pagebend http://127.0.0.1:3000/checkout --profiles long-text,text-zoom,narrow --fail-on new --out artifacts/pagebend

- name: Keep the visual evidence
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: pagebend-checkout
    path: artifacts/pagebend/
    if-no-files-found: ignore
```

Linux runners may need Chromium OS dependencies. If they are not preinstalled, use `npx --package=playwright@1.64.1 playwright install --with-deps chromium --no-shell` in a setup step. Avoid publishing reports from authenticated production pages: use fixtures or a test account with synthetic data.

Start with `--fail-on none` to review candidate quality for your app. Add intentional elements to `--ignore`, then choose a blocking policy. A failed browser scenario returns 2 even when the candidate policy is `none`.
