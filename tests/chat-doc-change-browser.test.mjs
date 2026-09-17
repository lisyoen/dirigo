import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const screenshotDir = new URL("../work-reports/dirigo/20260917-042-screenshots/", import.meta.url);

async function harness(page, editing) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    :root{--ink:#17202d;--line:#e6e9ee;--soft:#f7f8fa;--accent:#315efb}body{font-family:Arial,sans-serif;color:var(--ink);padding:32px}.document-change-banner{max-width:1080px;margin:0 0 12px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--soft)}button{color:var(--accent)}article{max-width:720px;padding:24px;border:1px solid var(--line);border-radius:12px}</style>
    <article><h1>기획서</h1><div id="banner"></div><div id="document">이전 기획서 본문</div></article>`);
  await page.evaluate((isEditing) => {
    window.fetchCalls = 1;
    window.editing = isEditing;
    window.addEventListener("dirigo:documents-changed", async (event) => {
      if (event.detail.project !== "browser-project" || !event.detail.changed.includes("proposal")) return;
      if (window.editing) {
        document.querySelector("#banner").innerHTML = '<div class="document-change-banner" role="alert">채팅이 기획서를 갱신했습니다. 저장 시 충돌이 날 수 있습니다 — <button>다시 불러오기</button></div>';
        return;
      }
      window.fetchCalls += 1;
      document.querySelector("#document").textContent = "자동 갱신된 기획서 본문";
    });
  }, editing);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("dirigo:documents-changed", { detail: { project: "browser-project", changed: ["proposal"] } })));
}

test("Chromium reloads an open proposal and protects an active editor", async (t) => {
  await mkdir(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium", headless: true });
  t.after(() => browser.close());

  const viewing = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await harness(viewing, false);
  assert.equal(await viewing.evaluate(() => window.fetchCalls), 2);
  assert.equal(await viewing.locator("#document").textContent(), "자동 갱신된 기획서 본문");
  await viewing.screenshot({ path: fileURLToPath(new URL("proposal-auto-refresh.png", screenshotDir)), fullPage: true });

  const editing = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  await harness(editing, true);
  assert.equal(await editing.evaluate(() => window.fetchCalls), 1);
  assert.equal(await editing.locator("#document").textContent(), "이전 기획서 본문");
  await editing.getByRole("alert").waitFor();
  assert.match(await editing.getByRole("alert").textContent(), /다시 불러오기/);
  await editing.screenshot({ path: fileURLToPath(new URL("proposal-edit-conflict-banner.png", screenshotDir)), fullPage: true });
});
