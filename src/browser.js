import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PROFILES, getProfile, applyProfile } from './profiles.js';
import { detect, compareFindings } from './detect.js';

const MAX_HEIGHT = 12000;
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const numeric = (value, fallback, min, max, name) => {
  const number = value ?? fallback;
  if (!Number.isFinite(number) || number < min || number > max || !Number.isInteger(number)) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return number;
};

export function redactUrl(value) {
  const url = new URL(value);
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return url.href;
}

function safeError(error, target, storageState) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.split(target).join(redactUrl(target));
  if (typeof storageState === 'string') message = message.split(storageState).join('[storage state]');
  // Browser errors sometimes include a redirect URL instead of the target URL.
  return message.replace(/https?:\/\/[^\s<>"']+/g, (value) => {
    try { return redactUrl(value); } catch { return '[URL]'; }
  }).slice(0, 1000);
}

async function settle(page, wait) {
  const fontsReady = await page.evaluate(async () => {
    if (!document.fonts) return true;
    return Promise.race([document.fonts.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2000))]);
  });
  if (wait) await page.waitForTimeout(wait);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return fontsReady;
}

async function snapshot(page, options, warnings, caseId) {
  const geometry = await detect(page, options);
  warnings.push(...geometry.warnings.map((warning) => `${caseId}: ${warning}`));
  const dimensions = await page.evaluate(() => ({
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, innerHeight),
    width: innerWidth,
  }));
  const height = Math.min(MAX_HEIGHT, dimensions.height);
  if (dimensions.height > MAX_HEIGHT) warnings.push(`${caseId}: Screenshot clipped to the first ${MAX_HEIGHT}px of a ${dimensions.height}px page; findings below the image may still be listed.`);
  await page.evaluate(() => scrollTo(0, 0));
  const buffer = await page.screenshot({
    type: 'png', animations: 'disabled', caret: 'hide', scale: 'css',
    clip: { x: 0, y: 0, width: dimensions.width, height },
    timeout: options.timeout,
  });
  return { image: `data:image/png;base64,${buffer.toString('base64')}`, width: dimensions.width, height,
    pageWidth: geometry.pageWidth, viewportWidth: geometry.viewportWidth, findings: geometry.findings };
}

/** Scan explicit URLs only. A fresh isolated browser context is used for each case. */
export async function scan(options = {}) {
  if (!options.url) throw new Error('A URL is required.');
  const target = new URL(options.url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only http:// and https:// URLs are supported.');
  const width = numeric(options.width, 1280, 240, 3840, 'width');
  const height = numeric(options.height, 900, 240, 2160, 'height');
  const timeout = numeric(options.timeout, 30000, 100, 120000, 'timeout');
  const wait = numeric(options.wait, 300, 0, 30000, 'wait');
  const profiles = options.profiles ?? [...DEFAULT_PROFILES];
  if (!Array.isArray(profiles) || profiles.length === 0 || profiles.length > DEFAULT_PROFILES.length) throw new Error('Choose between one and six profiles.');
  if (new Set(profiles).size !== profiles.length) throw new Error('Profiles must not contain duplicates.');
  for (const id of profiles) if (!getProfile(id)) throw new Error(`Unknown profile: ${id}`);
  if (options.ignore && (!Array.isArray(options.ignore) || options.ignore.some((selector) => typeof selector !== 'string'))) throw new Error('ignore must be an array of CSS selectors.');
  if (options.scope !== undefined && typeof options.scope !== 'string') throw new Error('scope must be a CSS selector.');
  const started = Date.now();
  const report = {
    schemaVersion: 1, version, title: 'PageBend report', url: redactUrl(target.href),
    createdAt: new Date().toISOString(), durationMs: 0,
    settings: { width, height, profiles: [...profiles], scope: options.scope ?? null },
    summary: { cases: 0, newFindings: 0, existingFindings: 0, reviewCases: 0 },
    warnings: ['Geometry findings are review candidates. Intentional layouts may be flagged; a clean scan does not prove usability, localization or accessibility compliance.',
      'An existing candidate keeps that label even if stress makes it worse. Compare before/after excess pixels and screenshots; new-finding counts do not measure severity.',
      'Scans inspect the rendered light DOM without clicking or crawling. Dynamic content, animations and session-dependent pages can differ between cases.'],
    cases: [],
  };
  const settings = { ...options, timeout, height, wait, width };
  const browser = await chromium.launch({ headless: true, timeout: Math.max(10000, Math.min(timeout, 30000)),
    ...(options.executablePath ? {} : { channel: options.channel ?? 'chromium' }),
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  try {
    for (const id of profiles) {
      const profile = getProfile(id);
      const item = { id, label: profile.label, description: profile.description,
        viewport: { width: id === 'narrow' ? 375 : width, height },
        mutation: { changed: 0, details: 'Not applied.' }, before: null, after: null, findings: [] };
      options.onProgress?.({ phase: 'start', profile: id });
      let context;
      try {
        context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1,
          reducedMotion: 'reduce', ...(options.storageState ? { storageState: options.storageState } : {}) });
        const page = await context.newPage();
        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);
        const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout });
        if (response && !response.ok()) throw new Error(`Target returned HTTP ${response.status()}.`);
        if (options.waitFor) await page.locator(options.waitFor).first().waitFor({ state: 'visible', timeout });
        // These rules suppress transient visuals, and remain identical before
        // and after so the stress profile is the only intentional difference.
        try {
          await page.addStyleTag({ content: '*,*::before,*::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
        } catch {
          // Do not bypass the target's CSP: that could enable its own blocked
          // styles/scripts and make the baseline unlike the actual website.
          await page.evaluate(() => document.getAnimations().forEach((animation) => animation.cancel()));
          report.warnings.push(`${id}: Page policy blocked the animation stylesheet. Existing animations were cancelled; newly created animations may affect geometry.`);
        }
        if (!await settle(page, wait)) report.warnings.push(`${id}: Fonts did not finish loading within 2000ms; screenshots may use fallback fonts.`);
        item.resolvedUrl = redactUrl(page.url());
        if (item.resolvedUrl !== report.url) report.warnings.push(`${id}: The target redirected to ${item.resolvedUrl}. Confirm the screenshots show the intended page, especially when using authentication.`);
        item.before = await snapshot(page, settings, report.warnings, id);
        item.before.findings = item.before.findings.map((finding) => ({ ...finding, status: 'existing' }));
        item.mutation = await applyProfile(page, id, settings);
        if (item.mutation.changed === 0) report.warnings.push(`${id}: No eligible elements were changed by this profile. Inspect the screenshots before treating this case as coverage.`);
        if (item.mutation.capped) report.warnings.push(`${id}: Mutation capped at 5000 elements; additional elements were not changed.`);
        await settle(page, wait);
        item.after = await snapshot(page, settings, report.warnings, id);
        item.findings = compareFindings(item.before.findings, item.after.findings);
        item.after.findings = item.findings;
      } catch (error) {
        item.error = safeError(error, target.href, options.storageState);
      } finally {
        await context?.close();
      }
      report.cases.push(item);
      report.summary.newFindings += item.findings.filter((finding) => finding.status === 'new').length;
      report.summary.existingFindings += item.findings.filter((finding) => finding.status === 'existing').length;
      if (item.error || item.findings.length || ['rtl', 'missing-images'].includes(id)) report.summary.reviewCases++;
      options.onProgress?.({ phase: 'complete', profile: id, findings: item.findings.length, error: item.error });
    }
  } finally {
    await browser.close();
  }
  report.summary.cases = report.cases.length;
  report.durationMs = Date.now() - started;
  report.warnings = [...new Set(report.warnings)];
  return report;
}
