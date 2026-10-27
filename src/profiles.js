/** Deterministic, temporary DOM mutations. Nothing is written to the target app. */
export const PROFILES = Object.freeze([
  { id: 'long-text', label: 'Long text', description: 'Expand visible text to roughly twice its length. A layout stress test, not a translation.' },
  { id: 'unbroken', label: 'Unbroken text', description: 'Append a deterministic 56-character word to visible text to expose missing wrapping rules.' },
  { id: 'text-zoom', label: 'Text at 200%', description: 'Double computed font sizes without changing containers. This is not browser zoom or an accessibility certification.' },
  { id: 'rtl', label: 'Right to left', description: 'Switch layout direction for visual review. Does not translate text or certify RTL support.' },
  { id: 'missing-images', label: 'Missing images', description: 'Replace image sources with a broken local data URI to inspect layout fallbacks.' },
  { id: 'narrow', label: 'Narrow screen', description: 'Resize to a 375px viewport and inspect reflow.' },
]);

export const DEFAULT_PROFILES = Object.freeze(PROFILES.map(({ id }) => id));
export const getProfile = (id) => PROFILES.find((profile) => profile.id === id);

export async function applyProfile(page, id, options = {}) {
  if (!getProfile(id)) throw new Error(`Unknown profile: ${id}`);
  if (id === 'narrow') {
    await page.setViewportSize({ width: 375, height: options.height ?? 900 });
    return { changed: 1, details: 'Viewport resized to 375 CSS pixels; no text was changed.' };
  }
  return page.evaluate(({ id, scope, ignore, maxElements }) => {
    const roots = scope ? [...document.querySelectorAll(scope)] : [document.body];
    const excludedTags = 'script,style,noscript,template,code,pre,svg,math,textarea,input,select,option,[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"])';
    const ignored = (element) => ignore.some((selector) => element.closest(selector));
    const visible = (element) => {
      if (!element || element.closest(excludedTags) || ignored(element)) return false;
      for (let parent = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const all = [];
    const seen = new Set();
    const rootSet = new Set(roots);
    let capped = false;
    for (const root of roots) {
      if (!root) continue;
      let covered = false;
      for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (rootSet.has(ancestor)) { covered = true; break; }
      }
      if (covered) continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      for (let element = root; element; element = walker.nextNode()) {
        if (!seen.has(element)) {
          seen.add(element);
          if (all.length >= maxElements) { capped = true; break; }
          all.push(element);
        }
      }
      if (capped) break;
    }
    let changed = 0;
    if (id === 'rtl') {
      // A scope is a subtree operation. Ignore selectors cannot isolate inherited
      // direction, so preserve their computed direction before the mutation.
      const preserved = ignore.flatMap((selector) => [...document.querySelectorAll(selector)])
        .map((element) => [element, getComputedStyle(element).direction]);
      for (const root of roots) {
        if (!root || ignored(root)) continue;
        root.setAttribute('dir', 'rtl');
        root.style.setProperty('direction', 'rtl', 'important');
        changed++;
      }
      if (!scope && document.documentElement) document.documentElement.setAttribute('dir', 'rtl');
      for (const [element, direction] of preserved) element.style.setProperty('direction', direction, 'important');
    } else if (id === 'text-zoom') {
      // Read all computed sizes before changing any ancestor: inherited sizes
      // must not become 2x, 4x, 8x as we walk down the tree.
      const sizes = all.filter(visible).map((element) => [element, parseFloat(getComputedStyle(element).fontSize)]);
      // Protect excluded descendants from the inherited font-size of a changed
      // ancestor, including ignored controls and contenteditable regions.
      const preserved = all.filter((element) => element.matches(excludedTags) || ignore.some((selector) => element.matches(selector)))
        .map((element) => [element, getComputedStyle(element).fontSize]);
      for (const [element, size] of sizes) {
        if (!Number.isFinite(size) || size <= 0) continue;
        element.style.setProperty('font-size', `${size * 2}px`, 'important');
        changed++;
      }
      for (const [element, size] of preserved) element.style.setProperty('font-size', size, 'important');
    } else if (id === 'missing-images') {
      for (const image of all.filter((element) => element.tagName === 'IMG' && visible(element))) {
        image.closest('picture')?.querySelectorAll('source').forEach((source) => source.removeAttribute('srcset'));
        image.removeAttribute('srcset');
        image.removeAttribute('sizes');
        image.src = 'data:image/png;base64,AA==';
        changed++;
      }
    } else {
      for (const element of all) {
        if (!visible(element)) continue;
        for (const node of [...element.childNodes]) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
          const original = node.textContent;
          // Skip tiny punctuation/icon labels and very large blocks. Preserve
          // whitespace around the string and every descendant element/listener.
          const text = original.trim();
          if (text.length < 2 || text.length > 2000 || !/[\p{L}\p{N}]/u.test(text)) continue;
          const prefix = original.slice(0, original.indexOf(text));
          const suffix = original.slice(original.indexOf(text) + text.length);
          const addition = id === 'long-text' ? ` ${text}` : ' WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW';
          node.textContent = prefix + text + addition + suffix;
          changed++;
        }
      }
    }
    const details = {
      'long-text': 'Visible text nodes duplicated deterministically; markup and input values preserved.',
      unbroken: 'Appended a 56-character unbroken token; markup and input values preserved.',
      'text-zoom': 'Computed font sizes doubled once; container dimensions unchanged.',
      rtl: 'Layout direction changed to RTL; original language preserved. Visual review required.',
      'missing-images': 'Image sources replaced by an invalid data URI; no external image URL was introduced.',
    }[id];
    return { changed, details: details + (capped ? ` Mutation limited to the first ${maxElements} elements.` : ''), capped };
  }, { id, scope: options.scope, ignore: options.ignore ?? [], maxElements: options.maxElements ?? 5000 });
}
