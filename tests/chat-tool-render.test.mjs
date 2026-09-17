import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSessionMessage } from "../src/app/api/sessions/[id]/route.ts";

function stored(tool, output, metadata = {}) {
  return {
    id: `${tool}-id`,
    role: "tool",
    content: JSON.stringify(output),
    created_at: "2026-09-17T05:20:00.000Z",
    metadata: { tool, status: "ok", duration_ms: 700, ...metadata },
  };
}

const cases = [
  [
    "fetch_url ok",
    stored("fetch_url", {
      ok: true,
      url: "https://example.com/readme",
      finalUrl: "https://example.com/dirigo/README.md",
      title: "Dirigo README",
      text: "SECRET PAGE BODY",
    }, { target: "https://example.com/readme" }),
    /Dirigo README.*README\.md/,
  ],
  [
    "web_search",
    stored("web_search", {
      ok: true,
      query: "Dirigo",
      results: [{ title: "one", snippet: "SECRET SNIPPET" }, { title: "two" }],
    }),
    /Dirigo.*2건/,
  ],
  [
    "append_planning",
    stored("append_planning", {
      recorded: true,
      section: "## 기획 2026-09-17",
      added: ["SECRET PLAN ONE", "SECRET PLAN TWO"],
    }),
    /기획 2026-09-17.*2건/,
  ],
  [
    "create_task",
    stored("create_task", {
      task: { id: "private-id", title: "private title" },
      card: "작업지시서 #20260917-044 발주됨",
      body: "SECRET TASK BODY",
    }),
    /20260917-044/,
  ],
  [
    "error",
    stored("fetch_url", {
      ok: false,
      error: "blocked_address",
      message: "URL 읽기 실패 — 차단된 주소",
      text: "SECRET ERROR BODY",
    }, { status: "error" }),
    /blocked_address.*차단된 주소/,
  ],
];

for (const [name, message, summary] of cases) {
  test(`tool summary: ${name}`, () => {
    const result = summarizeSessionMessage(message);
    assert.equal(result.role, "tool");
    assert.equal("content" in result, false);
    assert.match(result.summary, summary);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /SECRET|\"text\"|\"body\"|\"results\"/);
    assert.deepEqual(Object.keys(result.metadata).sort(),
      ["duration_ms", "status", "target", "tool"].filter((key) => key in result.metadata).sort());
  });
}

test("non-tool messages pass through unchanged", () => {
  const message = { id: "user-id", role: "user", content: "hello", created_at: "now" };
  assert.equal(summarizeSessionMessage(message), message);
});
