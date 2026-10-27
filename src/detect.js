/** Geometry checks deliberately return candidates, not judgements of design intent. */
export async function detect(page, { scope, ignore = [], maxElements = 5000, maxFindings = 100 } = {}) {
  return page.evaluate(({ scope, ignore, maxElements, maxFindings }) => {
    const warnings = [];
    // Validate before collecting nodes so malformed selectors are never silent.
    if (scope) document.querySelector(scope);
    ignore.forEach((selector) => document.querySelector(selector));
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const pageWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0, viewportWidth);
    const roots = scope ? [...document.querySelectorAll(scope)] : [document.body];
    if (scope && roots.length === 0) throw new Error(`Scope selector matched no elements: ${scope}`);
    const elements = [];
    const seen = new Set();
    const rootSet = new Set(roots);
    let capped = false;
    for (const subtree of roots) {
      if (!subtree) continue;
      let covered = false;
      for (let ancestor = subtree.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (rootSet.has(ancestor)) { covered = true; break; }
      }
      if (covered) continue;
      const walker = document.createTreeWalker(subtree, NodeFilter.SHOW_ELEMENT);
      for (let element = subtree; element; element = walker.nextNode()) {
        if (!seen.has(element)) {
          seen.add(element);
          if (elements.length === maxElements) { capped = true; break; }
          elements.push(element);
        }
      }
      if (capped) break;
    }
    if (capped) warnings.push(`Inspected only the first ${maxElements} DOM elements; additional elements were not checked.`);
    const findings = [];
    let findingsCapped = false;
    const round = (number) => Math.round(number * 10) / 10;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: round(rect.x + scrollX), y: round(rect.y + scrollY), width: round(rect.width), height: round(rect.height) };
    };
    const selectorFor = (element) => {
      if (element === root) return 'html';
      const parts = [];
      for (let node = element; node?.nodeType === 1; node = node.parentElement) {
        if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        let part = node.localName;
        if (node.parentElement) {
          const siblings = [...node.parentElement.children].filter((other) => other.localName === node.localName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
      }
      return parts.join(' > ');
    };
    const add = (kind, element, excessPx, message, hint) => {
      if (findings.length >= maxFindings) { findingsCapped = true; return; }
      const selector = selectorFor(element);
      findings.push({ id: `${kind}:${selector}`, kind, selector, message, rect: box(element), excessPx: round(excessPx), status: 'new', hint });
    };
    const excluded = 'script,style,noscript,template,svg,math,[hidden],[aria-hidden="true"],input[type="hidden"]';
    const isVisible = (element) => {
      if (element.closest(excluded) || ignore.some((selector) => element.closest(selector))) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || style.transform !== 'none') return false;
      }
      return true;
    };
    const clipsOrScrolls = (element, direction) => {
      for (let parent = element.parentElement; parent && parent !== root && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        const overflow = direction === 'x' ? style.overflowX : style.overflowY;
        if (['auto', 'scroll', 'hidden', 'clip'].includes(overflow)) return true;
      }
      return false;
    };
    let hasUncontainedOverflow = false;
    for (const element of elements) {
      if (element === root || element === document.body || !isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = element.textContent?.trim() ?? '';
      const directText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      // Common component markup wraps copy in a span/strong. The clipping box
      // belongs to its parent, so checking only direct text nodes misses it.
      // Restrict this shortcut to inline content rather than treating every
      // large ancestor that contains text as a duplicate clipping candidate.
      const inlineText = [...element.children].some((child) => {
        const display = getComputedStyle(child).display;
        return (display.startsWith('inline') || display === 'contents') && child.textContent.trim() && isVisible(child);
      });
      const hasText = directText || inlineText || ['BUTTON', 'A', 'LABEL', 'SELECT'].includes(element.tagName);
      // Ignore intentionally positioned decorative objects, but retain text and
      // controls that extend beyond the viewport and cannot be scrolled to.
      const decorative = !text && ['absolute', 'fixed'].includes(style.position);
      const outside = Math.max(rect.right - viewportWidth, -rect.left);
      if (outside > 2 && !decorative && !clipsOrScrolls(element, 'x') && !['auto', 'scroll'].includes(style.overflowX)) {
        hasUncontainedOverflow = true;
        if (element.children.length === 0) {
          add('element-overflow', element, outside,
            `Element extends ${round(outside)}px beyond the viewport.`,
            'Check this element and its parent for fixed/min widths and missing overflow-wrap or min-width: 0.');
        }
      }
      if (!hasText || text.length === 0 || ['INPUT', 'TEXTAREA', 'SELECT', 'PRE', 'CODE'].includes(element.tagName)) continue;
      const intentional = style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '0');
      if (intentional) continue;
      const horizontal = element.scrollWidth - element.clientWidth;
      const vertical = element.scrollHeight - element.clientHeight;
      const clipsX = ['hidden', 'clip'].includes(style.overflowX);
      const clipsY = ['hidden', 'clip'].includes(style.overflowY);
      if ((clipsX && horizontal > 2) || (clipsY && vertical > 2)) {
        const excess = Math.max(clipsX ? horizontal : 0, clipsY ? vertical : 0);
        add('text-clipping', element, excess,
          `Text content exceeds its clipping box by ${round(excess)}px.`,
          'Review fixed heights/widths and overflow: hidden. Expand the container, wrap text or choose an intentional truncation treatment.');
      }
    }
    // A document-wide metric alone also counts intentional transformed/offscreen
    // decoration. Only offer a page-level candidate when a visible, uncontained
    // element supports it. The raw pageWidth stays available in every snapshot.
    if (!scope && !ignore.length && hasUncontainedOverflow && pageWidth > viewportWidth + 2) {
      add('viewport-overflow', root, pageWidth - viewportWidth,
        `Page is ${round(pageWidth - viewportWidth)}px wider than the ${viewportWidth}px viewport.`,
        'Review fixed widths, min-width, flex children and long strings. Intentional horizontal content may be valid.');
    }
    if (findingsCapped) warnings.push(`Findings capped at ${maxFindings}; additional candidates are not included.`);
    const unsupported = [];
    if (document.querySelector('iframe')) unsupported.push('iframe contents');
    if (elements.some((element) => element.shadowRoot)) unsupported.push('shadow DOM contents');
    if (document.querySelector('canvas')) unsupported.push('canvas contents');
    if (unsupported.length) warnings.push(`Not inspected: ${unsupported.join(', ')}.`);
    return { findings, warnings, pageWidth, viewportWidth, inspectedElements: elements.length };
  }, { scope, ignore, maxElements, maxFindings });
}

/** Only compare identical checks/selectors; a pre-existing candidate stays existing. */
export function compareFindings(before, after) {
  const old = new Set(before.map((finding) => finding.id));
  return after.map((finding) => ({ ...finding, status: old.has(finding.id) ? 'existing' : 'new' }));
}
