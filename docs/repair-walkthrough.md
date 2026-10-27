# Repair a clipped “Create invoice” button

This walkthrough uses PageBend’s **synthetic fixture**, not a customer incident. Open the [fragile report](https://easonsong666666-design.github.io/pagebend/) and select **Long text**. Find `#overview > header > button`: the captured run reports **14px of text clipping** after expanding the label. Compare it with the [repaired report](https://easonsong666666-design.github.io/pagebend/fixed.html).

## Understand the constraint

The button contains separate icon and label spans. Its original CSS fixes both dimensions, prevents wrapping and hides excess content. These are the relevant declarations from [demo/index.html](../demo/index.html):

```css
.action {
  height: 36px;
  width: 132px;
  overflow: hidden;
  white-space: nowrap;
  flex-shrink: 0;
}
```

The ordinary label fits. Under the long-text profile, the extra text needs space that the button cannot provide. PageBend measures that conflict; it does not decide whether truncation is appropriate for your application.

## Allow the button and its wrappers to reflow

The following override rules are copied from [demo/fixed.html](../demo/fixed.html). The file retains the base styles above them, including colors, borders and flex alignment.

```css
.heading {
  flex-wrap: wrap;
}
.heading > div {
  min-width: 0;
  flex: 1 1 420px;
}
.action {
  width: auto;
  min-height: 36px;
  height: auto;
  max-width: 100%;
  padding: 9px 14px;
  white-space: normal;
  overflow: visible;
  overflow-wrap: anywhere;
}
.action span {
  min-width: 0;
}
```

The button can grow vertically and break a long word. Its label’s `min-width: 0` lets the flex child shrink instead of forcing an intrinsic text width. The header can wrap the button onto another line, while its text wrapper can shrink. Removing `overflow: hidden` alone would merely expose text outside a constrained box.

The complete repaired fixture also changes the heading’s fixed dimensions, card labels, customer-name wrappers and responsive grid rules. **This button patch is not a claim to fix all 33 candidates** in the original report; candidates can repeat across profiles.

## Run the same check again

With PageBend and its browser installed:

```sh
pagebend demo --profiles long-text --fail-on new --out fragile-check
pagebend demo --fixed --profiles long-text --fail-on new --out fixed-check
```

The fragile run is expected to exit **1** because it finds candidates. Inspect both reports and confirm that the button’s candidate disappears after repair. Use distinct output folders; PageBend preserves existing output unless explicitly told to overwrite it.

For your running app, recheck the changed route:

```sh
pagebend http://127.0.0.1:3000/checkout \
  --profiles long-text,text-zoom,narrow \
  --fail-on new --out artifacts/pagebend
```

New geometry candidates return exit code **1**; execution errors return **2**. Keep the report as a CI artifact even on failure—see the [CI example](ci-example.md). Review intentional layouts before making this blocking. A clean result still requires visual and interaction checks; it is not an accessibility certificate.
