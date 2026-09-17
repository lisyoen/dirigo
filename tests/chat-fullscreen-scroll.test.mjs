import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url);
const screenshotDir = new URL(
  "../work-reports/dirigo/20260917-043-screenshots/",
  import.meta.url,
);

async function renderChat(page, layout, css) {
  const messages = Array.from(
    { length: 48 },
    (_, index) =>
      `<article class="${index % 2 ? "assistant" : "user"}"><p>스크롤 회귀 메시지 ${index + 1} — ${"충분히 긴 대화 내용 ".repeat(5)}</p></article>`,
  ).join("");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    ${css}
    html,body{height:100%;margin:0} body{overflow:hidden}
    [hidden]{display:none!important}.panel-stage{height:760px;width:420px;margin:20px 0 0 auto}
  </style><div class="${layout === "panel" ? "panel-stage" : ""}">
    <main class="chat-app chat-${layout}" data-chat-panel="${layout}">
      <div class="chat-main">
        <header class="chat-sticky-header"><div class="chat-session-heading chat-header-title"><span class="project-context">Dirigo #043</span><div class="session-picker"><button class="session-picker-toggle"><span class="session-title">전체화면 고정 헤더와 최신 메시지 이동 회귀 테스트</span><span>▾</span></button></div></div><div class="chat-header-actions"><button>${layout === "fullscreen" ? "패널로" : "전체화면"}</button></div></header>
        <div class="conversation-shell"><div class="conversation">${messages}<div data-testid="bottom"></div></div><button type="button" class="scroll-to-latest" hidden><span>↓</span><span>최신으로</span></button></div>
        <div class="composer-area"><form class="composer"><textarea aria-label="메시지"></textarea><button>↑</button></form></div>
      </div>
    </main></div>`);
  await page.evaluate(() => {
    const conversation = document.querySelector(".conversation");
    const latest = document.querySelector(".scroll-to-latest");
    conversation.addEventListener("scroll", () => {
      latest.hidden =
        conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight <= 80;
    });
    latest.addEventListener("click", () => {
      document.querySelector("[data-testid=bottom]").scrollIntoView();
      latest.hidden = true;
    });
    conversation.scrollTop = conversation.scrollHeight;
  });
}

async function verifyScrollContract(page, label) {
  const initial = await page.evaluate(() => {
    const documentScroller = document.scrollingElement;
    const conversation = document.querySelector(".conversation");
    const header = document.querySelector(".chat-sticky-header");
    return {
      documentScrollHeight: documentScroller.scrollHeight,
      documentClientHeight: documentScroller.clientHeight,
      documentScrollTop: documentScroller.scrollTop,
      conversationScrollHeight: conversation.scrollHeight,
      conversationClientHeight: conversation.clientHeight,
      headerTop: header.getBoundingClientRect().top,
    };
  });
  assert.ok(
    initial.conversationScrollHeight > initial.conversationClientHeight,
    `${label}: the conversation must be the scroll container`,
  );
  await page.locator(".conversation").evaluate((element) => {
    element.scrollTop = Math.floor(element.scrollHeight / 3);
  });
  await page.locator(".scroll-to-latest").waitFor({ state: "visible" });
  const scrolled = await page.evaluate(() => ({
    headerTop: document.querySelector(".chat-sticky-header").getBoundingClientRect().top,
    documentScrollTop: document.scrollingElement.scrollTop,
  }));
  assert.equal(scrolled.headerTop, initial.headerTop, `${label}: header top changed`);
  assert.equal(scrolled.documentScrollTop, 0, `${label}: document scrolled`);
  await page.locator(".scroll-to-latest").click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-testid=bottom]").getBoundingClientRect().bottom <=
      innerHeight,
  );
  const final = await page.evaluate(() => ({
    lastBottom: document
      .querySelector(".conversation article:last-of-type")
      .getBoundingClientRect().bottom,
    viewportHeight: innerHeight,
    documentScrollTop: document.scrollingElement.scrollTop,
    latestHidden: document.querySelector(".scroll-to-latest").hidden,
  }));
  assert.ok(final.lastBottom <= final.viewportHeight, `${label}: last message is outside viewport`);
  assert.equal(final.documentScrollTop, 0);
  assert.equal(final.latestHidden, true);
  return { initial, scrolled, final };
}

test("Chromium keeps fullscreen and panel chat on one message scroller", async (t) => {
  await mkdir(screenshotDir, { recursive: true });
  const [panelCss, globalCss, panelSource] = await Promise.all([
    readFile(new URL("src/components/chat/ChatPanel.css", root), "utf8"),
    readFile(new URL("src/app/globals.css", root), "utf8"),
    readFile(new URL("src/components/chat/ChatPanel.tsx", root), "utf8"),
  ]);
  assert.match(panelCss, /\.chat-fullscreen\s*\{[^}]*height:\s*100dvh;[^}]*overflow:\s*hidden;/s);
  assert.match(panelCss, /\.chat-fullscreen \.chat-main\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(panelCss, /\.chat-app \.conversation\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/s);
  assert.match(panelSource, /onScroll=\{handleConversationScroll\}/);
  assert.match(panelSource, /onClick=\{scrollToLatest\}/);

  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium",
    headless: true,
  });
  t.after(() => browser.close());
  const css = `${panelCss}\n${globalCss}`;
  for (const scenario of [
    { layout: "fullscreen", width: 1280, height: 800, file: "fullscreen-1280x800.png" },
    { layout: "fullscreen", width: 375, height: 812, file: "fullscreen-375x812.png" },
    { layout: "panel", width: 1280, height: 800, file: "panel-1280x800.png" },
  ]) {
    const page = await browser.newPage({ viewport: scenario });
    await renderChat(page, scenario.layout, css);
    const measurements = await verifyScrollContract(
      page,
      `${scenario.layout} ${scenario.width}x${scenario.height}`,
    );
    await page.locator(".conversation").evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight * 0.72);
    });
    await page.locator(".scroll-to-latest").waitFor({ state: "visible" });
    t.diagnostic(`${scenario.layout} ${scenario.width}x${scenario.height}: ${JSON.stringify(measurements)}`);
    await page.screenshot({
      path: fileURLToPath(new URL(scenario.file, screenshotDir)),
      fullPage: true,
    });
    await page.close();
  }
});
