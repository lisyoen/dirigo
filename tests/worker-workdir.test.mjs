import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveRunWorkdir } from "../src/worker/security.ts";

const originalRoot = process.env.DIRIGO_DATA_ROOT;
const originalAllowlist = process.env.DIRIGO_WORKDIR_ALLOWLIST;
const temporaryRoots = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "dirigo-workdir-root-"));
  temporaryRoots.push(root);
  process.env.DIRIGO_DATA_ROOT = root;
  delete process.env.DIRIGO_WORKDIR_ALLOWLIST;
  return { base: path.join(root, "user", "project") };
}

afterEach(async () => {
  process.env.DIRIGO_DATA_ROOT = originalRoot;
  if (originalAllowlist === undefined) delete process.env.DIRIGO_WORKDIR_ALLOWLIST;
  else process.env.DIRIGO_WORKDIR_ALLOWLIST = originalAllowlist;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('workdir "." resolves to the project root', async () => {
  const { base } = await fixture();
  assert.equal(await resolveRunWorkdir(base, "project", "."), await realpath(base));
});

test('relative workdir "work" resolves below the project root', async () => {
  const { base } = await fixture();
  assert.equal(await resolveRunWorkdir(base, "project", "work"), await realpath(path.join(base, "work")));
});

test('relative workdir cannot escape the project root with "../x"', async () => {
  const { base } = await fixture();
  await assert.rejects(resolveRunWorkdir(base, "project", "../x"), /requested=.*allowed=/);
});

test("absolute workdir is accepted inside an allowlist root and rejected outside allowed roots", async () => {
  const { base } = await fixture();
  const allowed = await mkdtemp(path.join(tmpdir(), "dirigo-workdir-allowed-"));
  const outside = await mkdtemp(path.join(tmpdir(), "dirigo-workdir-outside-"));
  temporaryRoots.push(allowed, outside);
  process.env.DIRIGO_WORKDIR_ALLOWLIST = allowed;
  const requested = path.join(allowed, "checkout");
  assert.equal(await resolveRunWorkdir(base, "project", requested), await realpath(requested));
  await assert.rejects(resolveRunWorkdir(base, "project", outside), /requested=.*allowed=/);
});

test("missing workdir uses the project workspace directory", async () => {
  const { base } = await fixture();
  assert.equal(await resolveRunWorkdir(base, "project"), await realpath(path.join(base, "workspace")));
});
