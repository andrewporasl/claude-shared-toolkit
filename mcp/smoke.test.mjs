import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerFreeEnv } from "./smoke.mjs";

test("dockerFreeEnv keeps shared bin dirs on non-Windows and shadows docker", () => {
  const env = dockerFreeEnv({ PATH: "/usr/local/bin:/usr/bin", HOME: "/h" }, "linux", "/stub", ":");
  assert.equal(env.PATH, "/stub:/usr/local/bin:/usr/bin");
  assert.equal(env.HOME, "/h");
});

test("dockerFreeEnv strips docker dirs on Windows", () => {
  const dir = mkdtempSync(join(tmpdir(), "mcp-smoke-"));
  try {
    const withDocker = join(dir, "docker-bin");
    mkdirSync(withDocker);
    writeFileSync(join(withDocker, "docker.exe"), "");
    const env = dockerFreeEnv({ Path: `${withDocker};${dir}` }, "win32", "/stub", ";");
    assert.equal(env.PATH, dir);
    assert.equal(env.Path, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
