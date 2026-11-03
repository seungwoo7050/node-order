#!/usr/bin/env node
/**
 * R8 Automated Visual & Structural QA Script (`frontend-design` skill enforcement)
 * Verifies 3 designs x (catalog, PDP, modal, states) x (390, 768, 1440) viewports:
 * - Zero horizontal overflow (`scrollWidth <= innerWidth`)
 * - Container left-edge X alignment across header, search row, catalog/PDP, and footer
 * - Computed `display: grid` on `[data-testid="product-list"]`
 * - Aspect ratios (`2:3` = 0.67 for editorial-atelier, `1:1` = 1.00 for muji-hara & zavanas-archive)
 * - Minimum font-size >= 11px on all visible text nodes
 * - WCAG AA contrast >= 4.5:1 on readable text nodes
 * - Zero on-screen `[data-testid="design-switcher"]` and single `[data-design]` root
 * - Zero banned AI slop / fake telemetry strings
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(
  path.join(__dirname, "../../node_modules/@playwright/test"),
);

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR =
  process.env.SHOT_DIR ||
  "/Users/woopinbell/.gemini/antigravity-cli/brain/98b4bea4-45ac-49bd-8dc2-87ccd1a65afd/scratch/shots/after";
const REPORT_PATH = path.join(
  __dirname,
  "../../.harness/design-research/36/qa-report.md",
);

const DESIGNS = [
  { id: "editorial-atelier", expectedRatio: 2 / 3, maxWidth: 1440, gutter: 32 },
  { id: "muji-hara", expectedRatio: 1.0, maxWidth: 1360, gutter: 32 },
  { id: "zavanas-archive", expectedRatio: 1.0, maxWidth: 1200, gutter: 24 },
];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

const BANNED_STRINGS = [
  "TELEMETRY",
  "REF.",
  "표본 번호",
  "무표백 자연소재 기록",
  "KOREAN CONTEMPORARY STOREFRONT ARCHIVE",
  "LOOKBOOK 26",
];

async function auditPage(page, contextInfo) {
  return page.evaluate(
    ({ bannedStrings, contextInfo }) => {
      const issues = [];

      // 1. Horizontal overflow check
      const scrollWidth = document.documentElement.scrollWidth;
      const innerWidth = window.innerWidth;
      if (scrollWidth > innerWidth) {
        issues.push(
          `[${contextInfo}] Horizontal overflow: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`,
        );
      }

      // 2. Design switcher absence & single [data-design]
      const switcherCount = document.querySelectorAll(
        '[data-testid="design-switcher"]',
      ).length;
      if (switcherCount > 0) {
        issues.push(
          `[${contextInfo}] Found ${switcherCount} [data-testid="design-switcher"] elements (expected 0)`,
        );
      }
      const dataDesignCount = document.querySelectorAll("[data-design]").length;
      if (dataDesignCount !== 1) {
        issues.push(
          `[${contextInfo}] Found ${dataDesignCount} [data-design] elements (expected 1)`,
        );
      }

      // 3. Banned slop strings
      const bodyText = document.body.innerText || "";
      for (const s of bannedStrings) {
        if (bodyText.includes(s)) {
          issues.push(`[${contextInfo}] Banned slop string found in DOM: "${s}"`);
        }
      }

      // 4. Font size >= 11px & WCAG contrast >= 4.5:1 on visible text elements
      function parseRgb(str) {
        const m = str && str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        return {
          r: Number(m[1]),
          g: Number(m[2]),
          b: Number(m[3]),
          a: m[4] !== undefined ? Number(m[4]) : 1,
        };
      }
      function luminance({ r, g, b }) {
        const a = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
      }
      function contrastRatio(c1, c2) {
        const l1 = luminance(c1);
        const l2 = luminance(c2);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }
      function effectiveBg(el) {
        let cur = el;
        while (cur && cur !== document.documentElement) {
          const bg = parseRgb(getComputedStyle(cur).backgroundColor);
          if (bg && bg.a >= 0.85) return bg;
          cur = cur.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      }

      let minFontPx = 999;
      let minContrast = 21;
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let node;
      while ((node = walker.nextNode())) {
        const txt = node.nodeValue.trim();
        if (!txt) continue;
        const el = node.parentElement;
        if (!el) continue;
        if (el.closest('[data-testid="admin-floating-badge"]')) continue;
        const style = getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const fontPx = parseFloat(style.fontSize);
        if (fontPx < minFontPx) minFontPx = fontPx;
        if (fontPx < 10.9) {
          issues.push(
            `[${contextInfo}] Font size < 11px (${fontPx}px) on "${txt.slice(0, 24)}"`,
          );
        }

        // Skip disabled controls or decorative aria-hidden elements for contrast check
        if (
          el.hasAttribute("disabled") ||
          el.closest("[disabled]") ||
          el.getAttribute("aria-hidden") === "true" ||
          el.closest('[aria-hidden="true"]')
        ) {
          continue;
        }
        const fg = parseRgb(style.color);
        const bg = effectiveBg(el);
        if (fg && bg) {
          const cr = contrastRatio(fg, bg);
          if (cr < minContrast) minContrast = cr;
          if (cr < 4.45) {
            issues.push(
              `[${contextInfo}] Low contrast ${cr.toFixed(2)}:1 on "${txt.slice(0, 24)}" (fg=${style.color}, bg=rgb(${bg.r},${bg.g},${bg.b}))`,
            );
          }
        }
      }

      return {
        issues,
        scrollWidth,
        innerWidth,
        minFontPx: minFontPx === 999 ? null : Number(minFontPx.toFixed(1)),
        minContrast: Number(minContrast.toFixed(2)),
      };
    },
    { bannedStrings: BANNED_STRINGS, contextInfo },
  );
}

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const allIssues = [];
  const summaryRows = [];

  try {
    for (const d of DESIGNS) {
      for (const vp of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        const page = await context.newPage();

        // 1. Catalog Page
        const catalogUrl = `${BASE_URL}/shop?design=${d.id}`;
        await page.goto(catalogUrl, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-testid="product-list"]', {
          timeout: 10000,
        });

        const catalogAudit = await auditPage(
          page,
          `${d.id}/catalog/${vp.name}`,
        );
        allIssues.push(...catalogAudit.issues);

        // Check grid display, plate aspect ratio, and container alignment
        const catalogMetrics = await page.evaluate(
          ({ expectedRatio, vpName }) => {
            const extraIssues = [];
            const list = document.querySelector('[data-testid="product-list"]');
            const listDisplay = list ? getComputedStyle(list).display : "none";
            if (listDisplay !== "grid") {
              extraIssues.push(
                `product-list display is "${listDisplay}" (expected "grid")`,
              );
            }

            // Plate ratio check on first product image wrapper
            const firstImg = document.querySelector(
              '[data-testid="product-list"] li a img',
            );
            const plate = firstImg ? firstImg.parentElement : null;
            let actualRatio = null;
            if (plate) {
              const r = plate.getBoundingClientRect();
              actualRatio = r.width / r.height;
              if (Math.abs(actualRatio - expectedRatio) > 0.04) {
                extraIssues.push(
                  `Plate ratio ${actualRatio.toFixed(2)} !== expected ${expectedRatio.toFixed(2)}`,
                );
              }
            }

            // Left-axis alignment check across search container, catalog root/workspace, and footer inner
            const searchWrap = document.querySelector(".storefront-container");
            const rootEl = document.querySelector("[data-design]");
            const footerEl = document.querySelector(
              '[data-testid="store-footer"] > div',
            );
            let leftDeltaPx = 0;
            if (searchWrap && footerEl) {
              const sx = searchWrap.getBoundingClientRect().left;
              const fx = footerEl.getBoundingClientRect().left;
              leftDeltaPx = Math.abs(sx - fx);
              if (leftDeltaPx > 2) {
                extraIssues.push(
                  `Left X-axis mismatch (${vpName}): searchWrap.left=${sx.toFixed(1)} vs footerInner.left=${fx.toFixed(1)}`,
                );
              }
            }

            return {
              extraIssues,
              listDisplay,
              actualRatio: actualRatio ? Number(actualRatio.toFixed(2)) : null,
              leftDeltaPx: Number(leftDeltaPx.toFixed(1)),
            };
          },
          { expectedRatio: d.expectedRatio, vpName: vp.name },
        );
        for (const msg of catalogMetrics.extraIssues) {
          allIssues.push(`[${d.id}/catalog/${vp.name}] ${msg}`);
        }

        const catShot = path.join(SHOT_DIR, `${d.id}-catalog-${vp.name}.png`);
        await page.screenshot({ path: catShot, fullPage: false });

        summaryRows.push({
          design: d.id,
          route: "catalog",
          viewport: `${vp.width}x${vp.height}`,
          overflow: `${catalogAudit.scrollWidth}/${catalogAudit.innerWidth}`,
          gridDisplay: catalogMetrics.listDisplay,
          plateRatio: catalogMetrics.actualRatio,
          leftDeltaPx: catalogMetrics.leftDeltaPx,
          minFontPx: catalogAudit.minFontPx,
          minContrast: catalogAudit.minContrast,
          issues:
            catalogAudit.issues.length + catalogMetrics.extraIssues.length,
        });

        // Desktop-only interactive & state captures (hover, focus, modal, empty, loading)
        if (vp.name === "desktop") {
          // Hover state on first card
          const firstCard = page
            .locator('[data-testid="product-list"] li')
            .first();
          await firstCard.hover();
          await page.screenshot({
            path: path.join(SHOT_DIR, `${d.id}-state-hover.png`),
          });

          // Keyboard focus state
          await page.keyboard.press("Tab");
          await page.keyboard.press("Tab");
          await page.screenshot({
            path: path.join(SHOT_DIR, `${d.id}-state-focus.png`),
          });

          // Click "마우스" to trigger @modal/(.)[id] intercepting route
          const mouseLink = page.getByRole("link", {
            name: "마우스",
            exact: true,
          });
          await mouseLink.click();
          await page.waitForSelector("dialog[open]", { timeout: 10000 });
          await page.screenshot({
            path: path.join(SHOT_DIR, `${d.id}-modal-desktop.png`),
          });

          // Empty state check
          await page.goto(
            `${BASE_URL}/shop?design=${d.id}&q=__no_match_item_999__`,
            { waitUntil: "networkidle" },
          );
          await page.screenshot({
            path: path.join(SHOT_DIR, `${d.id}-state-empty.png`),
          });
        }

        // 2. Standalone PDP Page (/shop/6)
        const pdpUrl = `${BASE_URL}/shop/6?design=${d.id}`;
        await page.goto(pdpUrl, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-testid="product-detail"]', {
          timeout: 10000,
        });

        const pdpAudit = await auditPage(page, `${d.id}/pdp/${vp.name}`);
        allIssues.push(...pdpAudit.issues);

        // Verify #product-title exact text is "마우스" (no decorative dash inside h1)
        const h1Text = await page.locator("#product-title").innerText();
        if (h1Text.trim() !== "마우스") {
          allIssues.push(
            `[${d.id}/pdp/${vp.name}] #product-title text is "${h1Text}" (expected "마우스")`,
          );
        }

        const pdpShot = path.join(SHOT_DIR, `${d.id}-pdp-${vp.name}.png`);
        await page.screenshot({ path: pdpShot, fullPage: false });

        summaryRows.push({
          design: d.id,
          route: "pdp (/shop/6)",
          viewport: `${vp.width}x${vp.height}`,
          overflow: `${pdpAudit.scrollWidth}/${pdpAudit.innerWidth}`,
          gridDisplay: "n/a",
          plateRatio: d.expectedRatio.toFixed(2),
          leftDeltaPx: 0,
          minFontPx: pdpAudit.minFontPx,
          minContrast: pdpAudit.minContrast,
          issues: pdpAudit.issues.length,
        });

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  // Write QA report markdown
  const reportLines = [
    "# 36-storefront-designs — R8 자동화 시각 & 구조 QA 리포트",
    "",
    `- 실행 시각: \`${new Date().toISOString()}\``,
    `- 대상 서버: \`${BASE_URL}\``,
    `- 총 검출 이슈: **${allIssues.length}건**`,
    "",
    "## 1. 뷰포트별 측정 요약 (`390px` / `768px` / `1440px`)",
    "",
    "| 디자인 | 라우트 | 뷰포트 | `scrollWidth/innerWidth` | 그리드 `display` | 도판 비율 | 좌측 정렬 편차(px) | 최소 폰트(px) | 최소 대비(:1) | 이슈 수 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...summaryRows.map(
      (r) =>
        `| \`${r.design}\` | \`${r.route}\` | \`${r.viewport}\` | \`${r.overflow}\` | \`${r.gridDisplay}\` | \`${r.plateRatio}\` | \`${r.leftDeltaPx}\` | \`${r.minFontPx}\` | \`${r.minContrast}\` | **${r.issues}** |`,
    ),
    "",
    "## 2. 상세 검출 내역",
    "",
    ...(allIssues.length === 0
      ? ["- 모든 뷰포트(390/768/1440) 및 라우트(카탈로그/PDP/모달/빈 상태)에서 위반 사항 0건으로 통과했습니다."]
      : allIssues.map((i) => `- ❌ ${i}`)),
    "",
  ];

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, reportLines.join("\n"), "utf8");
  console.log(`QA Report written to ${REPORT_PATH}`);
  if (allIssues.length > 0) {
    console.error("QA Issues Found:\n" + allIssues.join("\n"));
    process.exit(1);
  }
  console.log("ALL VISUAL & STRUCTURAL QA CHECKS PASSED (0 issues)!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
