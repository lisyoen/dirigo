import { chmod, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../lib/storage/index";
import { getConfig } from "../lib/config/loader";

function contains(root: string, target: string) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

export async function resolveRunWorkdir(base: string, project: string, configured?: string) {
  const projectRoot = path.resolve(base);
  const relative = Boolean(configured) && !path.isAbsolute(configured!);
  const requested = configured
    ? relative ? path.resolve(projectRoot, configured) : path.resolve(configured)
    : path.join(projectRoot, "workspace");
  const roots = [dataRoot(), ...getConfig({ project }).config.worker.workdir_allowlist];
  if (roots.some((root) => !path.isAbsolute(root))) throw new Error("workdir allowlist entries must be absolute paths");
  const allowedRoots = roots.map((root) => path.resolve(root));
  const permitted = (!relative || contains(projectRoot, requested)) && allowedRoots.some((root) => contains(root, requested));
  if (!permitted) {
    throw new Error(`workdir outside allowed roots: project=${project} requested=${requested} allowed=${allowedRoots.join(path.delimiter)}`);
  }
  await Promise.all(roots.map((root) => mkdir(root, { recursive: true, mode: 0o700 })));
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const [target, ...allowed] = await Promise.all([realpath(requested), ...roots.map((root) => realpath(root))]);
  const escapedProject = relative && !contains(await realpath(projectRoot), target);
  if (escapedProject || !allowed.some((root) => contains(root, target))) {
    throw new Error(`workdir outside allowed roots: project=${project} requested=${requested} allowed=${allowed.join(path.delimiter)}`);
  }
  return target;
}

export async function buildRunEnv(user: string, project: string, run: string): Promise<Record<string, string | undefined>> {
  const root = path.join(dataRoot(), user, ".opencode");
  const directories = {
    HOME: root,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
  };
  await Promise.all(Object.values(directories).map(async (directory) => { await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700); }));
  const env: Record<string, string | undefined> = { ...directories, DIRIGO_USER: user, DIRIGO_PROJECT: project, DIRIGO_RUN: run };
  for (const key of ["PATH", "LANG", "TZ"] as const) if (process.env[key]) env[key] = process.env[key];
  return env;
}
