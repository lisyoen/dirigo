import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { changedDocuments } from "../src/app/api/chat/route.ts";

test("changed derives proposal and task mutations from successful tool outputs", () => {
  assert.deepEqual(changedDocuments([{ name: "append_planning", output: { recorded: true, added: ["새 항목"], duplicates: [] } }]), ["proposal"]);
  assert.deepEqual(changedDocuments([{ name: "append_planning", output: { recorded: false, added: [], duplicates: ["기존 항목"] } }]), ["proposal"]);
  assert.deepEqual(changedDocuments([{ name: "append_planning", output: { recorded: false, error: "planning_secret_rejected" } }]), []);
  assert.deepEqual(changedDocuments([{ name: "create_task", output: { task: { id: "task-1" } } }]), ["tasks"]);
  assert.deepEqual(changedDocuments([{ name: "fetch_url", output: { ok: true } }]), []);
  assert.deepEqual(changedDocuments([]), []);
});

test("chat response and UI preserve document changes, links, and both notification paths", async () => {
  const [route, panel, project] = await Promise.all([
    readFile(new URL("../src/app/api/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/chat/ChatPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/p/[slug]/project-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /changed,\s*\n\s*usage:/);
  assert.match(panel, /onDocumentsChanged\?\.\(data\.changed\)/);
  assert.match(panel, /new CustomEvent\("dirigo:documents-changed"/);
  assert.match(panel, /기획서 보기/);
  assert.match(panel, /작업 보기/);
  assert.match(panel, /layout === "fullscreen"[\s\S]*CHAT_PANEL_FULLSCREEN_KEY[\s\S]*router\.push/);
  assert.match(project, /if \(editing\)[\s\S]*setExternalChange\(true\)/);
  assert.match(project, /채팅이 기획서를 갱신했습니다\. 저장 시 충돌이 날 수 있습니다/);
});
