import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const screenshotDir = new URL("../work-reports/dirigo/20260917-044-screenshots/", import.meta.url);

test("Chromium renders reloaded tool history as one collapsed badge group", async (t) => {
  await mkdir(screenshotDir, { recursive: true });
  const css = await readFile(new URL("src/app/globals.css", root), "utf8");
  const browser = await chromium.launch(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH, headless: true }
    : { headless: true });
  t.after(async () => { await browser.close(); });
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  await page.setContent(`<!doctype html><style>${css}</style><main class="chat-app"><section class="conversation"><article class="assistant"><p>Dirigo 소개 페이지를 준비했습니다.</p></article><div class="tool-message-group" aria-label="도구 호출 내역"><details class="tool-message"><summary><span>🔧</span><strong>append_planning</strong><span>✓</span><span>0.1s</span><span class="tool-message-target">— proposal</span></summary><p>## 기획 2026-09-17 — 추가 2건</p></details><details class="tool-message"><summary><span>🔧</span><strong>fetch_url</strong><span>✓</span><span>0.7s</span><span class="tool-message-target">— dirigo/README.md</span></summary><p>Dirigo README — https://example.com/dirigo/README.md</p></details><details class="tool-message"><summary><span>🔧</span><strong>create_task</strong><span>✓</span><span>0.2s</span><span class="tool-message-target">— task</span></summary><p>작업지시서 #20260917-044 발주됨</p></details></div></section></main>`);
  assert.equal(await page.locator(".tool-message-group").count(), 1);
  assert.equal(await page.locator(".tool-message").count(), 3);
  for (const tool of ["append_planning", "fetch_url", "create_task"])
    await assert.doesNotReject(page.getByText(tool, { exact: true }).waitFor());
  const body = await page.locator("body").innerText();
  assert.doesNotMatch(body, /\{"recorded":true|"ok":true,"url"/);
  await page.screenshot({ path: fileURLToPath(new URL("dirigo-intro-page-reload.png", screenshotDir)), fullPage: true });
  await page.close();
});
