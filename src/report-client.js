(() => {
  "use strict";
  const report = JSON.parse(
    document.getElementById("pagebend-data").textContent,
  );
  const $ = (id) => document.getElementById(id);
  const node = (tag, className, content) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = String(content);
    return element;
  };
  const number = (value, fallback = 0) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const cases = report.cases;
  const icons = {
    "long-text": "A↔",
    unbroken: "Aa",
    "text-zoom": "2×",
    rtl: "←",
    "missing-images": "▧",
    narrow: "▯",
  };
  const kinds = {
    "viewport-overflow": "Viewport overflow",
    "text-clipping": "Text clipping",
    "element-overflow": "Element overflow",
  };
  let currentIndex = 0;
  let mode = "split";
  let selectedId = null;
  let toastTimer;

  $("target-url").textContent = report.url || "Local page";
  const date = new Date(report.createdAt);
  const when = Number.isNaN(date.getTime())
    ? "Capture time unavailable"
    : date.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
  $("run-meta").textContent =
    `${when}  ·  ${(number(report.durationMs) / 1000).toFixed(1)}s  ·  ${number(report.settings?.width)} × ${number(report.settings?.height)} baseline`;
  $("new-count").textContent = number(report.summary?.newFindings);
  $("existing-count").textContent = number(report.summary?.existingFindings);
  $("case-count").textContent = cases.length;
  $("review-count").textContent = number(report.summary?.reviewCases);
  $("profile-count").textContent = String(cases.length).padStart(2, "0");
  $("report-version").textContent =
    `PageBend ${report.version || "0.1.0"} · no network required`;

  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  if (warnings.length) {
    $("warning-panel").hidden = false;
    $("warning-panel").append(
      node("summary", "", `Capture notes (${warnings.length})`),
    );
    // Generic interpretation notes should not displace the visual comparison.
    // Operational limits remain conspicuous when a capture was incomplete.
    $("warning-panel").open = warnings.some((warning) =>
      /capped|truncat|timed?\s*out|did not finish|could not|failed|unavailable|limit (?:was |has been )?reached/i.test(String(warning)),
    );
    const list = node("ul");
    for (const warning of warnings) list.append(node("li", "", warning));
    $("warning-panel").append(list);
  }

  function notify(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 2800);
  }

  function promptFor(finding, testCase) {
    const lines = [
      "# PageBend layout review",
      "",
      `Page: ${report.url || "Local page"}`,
      `Stress profile: ${testCase.label || testCase.id}`,
      `Viewport: ${number(testCase.viewport?.width)} × ${number(testCase.viewport?.height)}`,
      `Candidate: ${kinds[finding.kind] || finding.kind}`,
      `Selector: ${finding.selector || "(unknown)"}`,
      `Status: ${finding.status === "existing" ? "Already present before stress" : "New after stress"}`,
      `Observation: ${finding.message || ""}`,
      `Excess: ${number(finding.excessPx).toFixed(1)} CSS px`,
      "",
      `Suggested starting point: ${finding.hint || "Inspect the element and its containing layout."}`,
      "",
      "Inspect this candidate in the source and confirm whether it is unintended. Fix the underlying layout while preserving the design. Do not simply hide the overflow. Re-run this stress profile and check the baseline. This automated observation is not proof of a defect.",
    ];
    return lines.join("\n");
  }

  async function copyPrompt(finding, testCase, button) {
    const text = promptFor(finding, testCase);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
    } catch {
      const field = node("textarea", "clipboard-fallback");
      field.value = text;
      field.setAttribute("aria-label", "Repair prompt");
      document.body.append(field);
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        /* The prompt remains downloadable below. */
      }
      field.remove();
      if (!copied) {
        download(text, "pagebend-repair-prompt.md", "text/markdown");
        notify("Clipboard unavailable. Repair prompt downloaded.");
        return;
      }
    }
    button.textContent = "Copied ✓";
    notify("Repair prompt copied.");
    setTimeout(() => {
      button.textContent = "Copy repair prompt";
    }, 2200);
  }

  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = node("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("download-json").addEventListener("click", () =>
    download(
      JSON.stringify(report, null, 2),
      "pagebend-report.json",
      "application/json",
    ),
  );

  for (const [index, testCase] of cases.entries()) {
    const button = node("button", "profile-button");
    button.type = "button";
    button.append(
      node("span", "profile-icon", icons[testCase.id] || "◈"),
      node("span", "profile-name", testCase.label || testCase.id),
    );
    const newCount = (testCase.findings || []).filter(
      (finding) => finding.status === "new",
    ).length;
    button.append(
      node(
        "span",
        `profile-badge${newCount ? "" : " zero"}`,
        testCase.error ? "!" : newCount || "✓",
      ),
    );
    button.setAttribute(
      "aria-label",
      `${testCase.label || testCase.id}, ${testCase.error ? "capture error" : `${newCount} new candidates`}`,
    );
    button.addEventListener("click", () => showCase(index));
    button.addEventListener("keydown", (event) => {
      if (
        ![
          "ArrowDown",
          "ArrowUp",
          "ArrowLeft",
          "ArrowRight",
          "Home",
          "End",
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
      const target =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? cases.length - 1
            : (index + (forward ? 1 : -1) + cases.length) % cases.length;
      showCase(target);
      $("profile-nav").children[target].focus();
    });
    $("profile-nav").append(button);
  }

  function safeImage(snapshot, label) {
    if (
      !snapshot ||
      typeof snapshot.image !== "string" ||
      !/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=\s]+$/i.test(
        snapshot.image,
      )
    )
      return null;
    const image = node("img");
    image.src = snapshot.image;
    image.alt = label;
    image.decoding = "async";
    image.draggable = false;
    return image;
  }

  function markFor(finding, index, snapshot) {
    const rect = finding.rect || {};
    const width = Math.max(1, number(snapshot.width));
    const height = Math.max(1, number(snapshot.height));
    const x = Math.max(0, number(rect.x));
    const y = Math.max(0, number(rect.y));
    if (x >= width || y >= height) return null;
    const mark = node(
      "button",
      `finding-mark${finding.status === "existing" ? " existing" : ""}${finding.id === selectedId ? " selected" : ""}`,
    );
    mark.type = "button";
    mark.dataset.findingId = String(finding.id);
    mark.style.left = `${(100 * x) / width}%`;
    mark.style.top = `${(100 * y) / height}%`;
    mark.style.width = `${(100 * Math.max(1, Math.min(number(rect.width), width - x))) / width}%`;
    mark.style.height = `${(100 * Math.max(1, Math.min(number(rect.height), height - y))) / height}%`;
    mark.title = `${index + 1}. ${finding.message || "Inspect candidate"}`;
    mark.setAttribute(
      "aria-label",
      `Candidate ${index + 1}: ${finding.message || finding.kind}`,
    );
    mark.append(node("span", "mark-number", index + 1));
    mark.addEventListener("click", () => selectFinding(finding, true));
    return mark;
  }

  function screenshotPanel(snapshot, title, stressed, testCase) {
    const panel = node("section", "screenshot-panel");
    panel.setAttribute("aria-label", title);
    const label = node("div", `screenshot-label${stressed ? " stressed" : ""}`);
    label.append(
      node("span", "tiny-dot"),
      node("span", "", title),
      node(
        "small",
        "",
        `${number(snapshot?.viewportWidth || snapshot?.width)} px`,
      ),
    );
    panel.append(label);
    const viewport = node("div", "screenshot-viewport");
    viewport.tabIndex = 0;
    viewport.setAttribute(
      "aria-label",
      `${title} screenshot, scroll to inspect`,
    );
    const image = safeImage(
      snapshot,
      `${title} — ${testCase.label || testCase.id}`,
    );
    if (!image)
      viewport.append(
        node(
          "p",
          "screenshot-placeholder",
          "Screenshot unavailable for this capture.",
        ),
      );
    else {
      const canvas = node("div", "screenshot-canvas");
      canvas.style.maxWidth = `${Math.max(1, number(snapshot.width))}px`;
      canvas.append(image);
      if (stressed)
        for (const [index, finding] of (testCase.findings || []).entries()) {
          if (!$("include-existing").checked && finding.status === "existing")
            continue;
          const mark = markFor(finding, index, snapshot);
          if (mark) canvas.append(mark);
        }
      viewport.append(canvas);
    }
    panel.append(viewport);
    return panel;
  }

  function renderComparison(testCase) {
    const root = $("compare-root");
    root.replaceChildren();
    root.classList.toggle("overlay-view", mode === "overlay");
    root.classList.toggle("hide-highlights", !$("show-highlights").checked);
    $("slider-control").hidden = mode !== "overlay";
    if (mode === "split") {
      root.append(
        screenshotPanel(testCase.before, "BASELINE", false, testCase),
        screenshotPanel(testCase.after, "STRESSED", true, testCase),
      );
      $("comparison-note").textContent =
        "Scroll either capture to inspect the full page. Select a note below to locate its element. Boxes refer to the stressed capture.";
      return;
    }
    const before = safeImage(testCase.before, "Baseline screenshot");
    const after = safeImage(testCase.after, "Stressed screenshot");
    const panel = node("section", "screenshot-panel");
    panel.setAttribute("aria-label", "Overlay comparison");
    const label = node("div", "screenshot-label stressed");
    label.append(
      node("span", "tiny-dot"),
      node("span", "", "STRESSED / BASELINE"),
      node("small", "", "Use slider or arrow keys"),
    );
    panel.append(label);
    const viewport = node("div", "screenshot-viewport");
    viewport.tabIndex = 0;
    viewport.setAttribute(
      "aria-label",
      "Overlay screenshot, scroll to inspect",
    );
    if (!before || !after)
      viewport.append(
        node(
          "p",
          "screenshot-placeholder",
          "Both captures are needed for overlay mode.",
        ),
      );
    else {
      const width = Math.max(1, number(testCase.before.width));
      const height = Math.max(
        1,
        number(testCase.before.height),
        number(testCase.after.height),
      );
      const canvas = node("div", "screenshot-canvas overlay-canvas");
      canvas.style.maxWidth = `${width}px`;
      canvas.style.aspectRatio = `${width} / ${height}`;
      canvas.append(before);
      const layer = node("div", "overlay-after");
      layer.id = "overlay-after";
      layer.append(after);
      for (const [index, finding] of (testCase.findings || []).entries()) {
        if (!$("include-existing").checked && finding.status === "existing")
          continue;
        const mark = markFor(finding, index, { ...testCase.after, height });
        if (mark) layer.append(mark);
      }
      canvas.append(layer);
      const divider = node("div", "overlay-divider");
      divider.id = "overlay-divider";
      canvas.append(divider);
      viewport.append(canvas);
    }
    panel.append(viewport);
    root.append(panel);
    updateSlider();
    $("comparison-note").textContent =
      "Stressed capture on the left; baseline on the right. Drag the slider, or focus it and use arrow keys. Equal image widths preserve pixel alignment.";
  }

  function updateSlider() {
    const value = number($("compare-slider").value, 50);
    if ($("overlay-after"))
      $("overlay-after").style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    if ($("overlay-divider")) $("overlay-divider").style.left = `${value}%`;
    $("compare-slider").setAttribute(
      "aria-valuetext",
      `${value} percent stressed screenshot`,
    );
  }
  $("compare-slider").addEventListener("input", updateSlider);

  function selectFinding(finding, fromImage = false) {
    selectedId = finding.id;
    for (const element of document.querySelectorAll("[data-finding-id]"))
      element.classList.toggle(
        element.classList.contains("finding-mark") ? "selected" : "active",
        element.dataset.findingId === String(finding.id),
      );
    const rows = [...$("findings-list").children];
    const row = rows.find(
      (element) => element.dataset.findingId === String(finding.id),
    );
    if (fromImage && row) {
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      row.querySelector(".finding-select")?.focus({ preventScroll: true });
    } else {
      const mark = [
        ...$("compare-root").querySelectorAll(".finding-mark"),
      ].find((element) => element.dataset.findingId === String(finding.id));
      if (mark) {
        if (mode === "overlay") {
          $("compare-slider").value = 100;
          updateSlider();
        }
        const viewport = mark.closest(".screenshot-viewport");
        const viewportRect = viewport.getBoundingClientRect();
        const markRect = mark.getBoundingClientRect();
        viewport.scrollTo({
          top:
            viewport.scrollTop +
            markRect.top -
            viewportRect.top -
            viewport.clientHeight / 3,
          behavior: "smooth",
        });
        viewport.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else
        notify(
          "This element is outside the captured image. Inspect its selector in the page.",
        );
    }
  }

  function renderFindings(testCase) {
    const list = $("findings-list");
    list.replaceChildren();
    const findings = testCase.findings || [];
    const shown = findings.filter(
      (finding) =>
        $("include-existing").checked || finding.status !== "existing",
    );
    $("finding-count").textContent = `(${shown.length})`;
    if (!shown.length) {
      const empty = node("div", "empty-state");
      empty.append(node("span", "empty-symbol", testCase.error ? "!" : "✓"));
      const content = node("div");
      content.append(
        node(
          "strong",
          "",
          testCase.error
            ? "This capture needs attention"
            : findings.length
              ? "No new candidates in this profile"
              : "No geometric candidates detected",
        ),
      );
      content.append(
        node(
          "p",
          "",
          testCase.error
            ? "The scan did not complete for this profile. Review the error above and re-run it."
            : "Compare the captures anyway. Wrong direction, missing content, contrast, awkward wrapping, and intentional clipping still need a human eye.",
        ),
      );
      empty.append(content);
      list.append(empty);
      return;
    }
    for (const finding of shown) {
      const index = findings.indexOf(finding);
      const row = node(
        "article",
        `finding-row${finding.status === "existing" ? " is-existing" : ""}${finding.id === selectedId ? " active" : ""}`,
      );
      row.dataset.findingId = String(finding.id);
      row.append(
        node("span", "finding-number", String(index + 1).padStart(2, "0")),
      );
      const content = node("div");
      const select = node("button", "finding-select");
      select.type = "button";
      select.setAttribute(
        "aria-label",
        `Locate candidate ${index + 1}: ${finding.message || finding.kind}`,
      );
      select.append(
        node(
          "p",
          "finding-message",
          finding.message || kinds[finding.kind] || "Layout candidate",
        ),
        node(
          "span",
          "finding-selector",
          finding.selector || "(unknown selector)",
        ),
      );
      select.addEventListener("click", () => selectFinding(finding));
      content.append(select);
      const tags = node("div", "finding-tags");
      tags.append(
        node(
          "span",
          `finding-tag${finding.status === "new" ? " new" : ""}`,
          finding.status === "new" ? "NEW" : "EXISTING",
        ),
        node("span", "", kinds[finding.kind] || finding.kind || "Geometry"),
        node("span", "", `${number(finding.excessPx).toFixed(1)} px excess`),
      );
      content.append(tags);
      if (finding.hint) content.append(node("p", "finding-hint", finding.hint));
      row.append(content);
      const copy = node("button", "copy-button", "Copy repair prompt");
      copy.type = "button";
      copy.addEventListener("click", () => copyPrompt(finding, testCase, copy));
      row.append(copy);
      list.append(row);
    }
  }

  function showCase(index) {
    if (!cases[index]) return;
    currentIndex = index;
    selectedId = null;
    const testCase = cases[index];
    for (const [buttonIndex, button] of [
      ...$("profile-nav").children,
    ].entries()) {
      button.classList.toggle("active", buttonIndex === index);
      if (buttonIndex === index) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    }
    $("case-index").textContent =
      `PROFILE ${String(index + 1).padStart(2, "0")} / ${String(cases.length).padStart(2, "0")}`;
    $("case-title").textContent = testCase.label || testCase.id;
    $("case-description").textContent =
      testCase.description ||
      "Compare the baseline with this temporary layout stress.";
    const count = (testCase.findings || []).filter(
      (finding) => finding.status === "new",
    ).length;
    $("case-result").textContent = testCase.error
      ? "Capture incomplete"
      : count
        ? `${count} new ${count === 1 ? "candidate" : "candidates"}`
        : "Visual review";
    $("case-result").classList.toggle("clear", !count && !testCase.error);
    $("case-error").hidden = !testCase.error;
    $("case-error").textContent = testCase.error || "";
    $("mutation-details").textContent =
      testCase.mutation?.details ||
      `${number(testCase.mutation?.changed)} elements changed. The source page was not modified.`;
    $("viewport-label").textContent =
      `${number(testCase.viewport?.width)} × ${number(testCase.viewport?.height)} CSS px`;
    const canOverlay =
      number(testCase.before?.width) > 0 &&
      number(testCase.before?.width) === number(testCase.after?.width);
    $("overlay-mode").disabled = !canOverlay;
    $("overlay-mode").title = canOverlay
      ? "Compare at the same pixel scale"
      : "Different capture widths: use side-by-side comparison";
    if (!canOverlay) mode = "split";
    updateModeButtons();
    renderComparison(testCase);
    renderFindings(testCase);
  }

  function updateModeButtons() {
    for (const name of ["split", "overlay"]) {
      $(`${name}-mode`).classList.toggle("active", mode === name);
      $(`${name}-mode`).setAttribute("aria-pressed", String(mode === name));
    }
  }
  for (const name of ["split", "overlay"])
    $(`${name}-mode`).addEventListener("click", () => {
      mode = name;
      updateModeButtons();
      renderComparison(cases[currentIndex]);
    });
  $("show-highlights").addEventListener("change", () =>
    $("compare-root").classList.toggle(
      "hide-highlights",
      !$("show-highlights").checked,
    ),
  );
  $("include-existing").addEventListener("change", () => {
    renderComparison(cases[currentIndex]);
    renderFindings(cases[currentIndex]);
  });

  if (cases.length) showCase(0);
  else {
    $("case-title").textContent = "No profiles captured";
    $("case-description").textContent =
      "This report has no captures. Check the scan output and run PageBend again.";
    $("inspection-toolbar")?.setAttribute("hidden", "");
    $("split-mode").disabled = true;
    $("overlay-mode").disabled = true;
  }
})();
