import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyChanges,
  findCredentialProblems,
  planChanges,
  renderServers,
  seedDesktopCommander,
} from "./apply.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifestText = readFileSync(join(here, "servers.json"), "utf8");
const manifest = JSON.parse(manifestText);

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-apply-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function recorder(failOn = () => false) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return failOn(args) ? { status: 1, stderr: "boom" } : { status: 0, stderr: "" };
  };
  return { calls, run };
}

test("renderServers substitutes HOME and REPO with forward slashes", () => {
  const out = renderServers(manifest, {
    home: "C:\\Users\\a b",
    repo: "C:\\Users\\a b\\claude-config",
  });
  assert.equal(out.memory.env.MEMORY_FILE_PATH, "C:/Users/a b/.claude/mcp-memory.jsonl");
  assert.equal(
    out.github.headersHelper,
    'node "C:/Users/a b/claude-config/mcp/github-headers.mjs"',
  );
});

test("planChanges adds missing and replaces changed", () => {
  const plan = planChanges(
    { a: { command: "a" }, b: { command: "new" } },
    { b: { command: "old" } },
    [],
  );
  assert.deepEqual(plan, { add: ["a"], replace: ["b"], remove: [] });
});

test("is idempotent when config already matches", () => {
  const plan = planChanges(
    { a: { command: "a", args: ["x"] } },
    { a: { type: "stdio", args: ["x"], env: {}, command: "a" } },
    [],
  );
  assert.deepEqual(plan, { add: [], replace: [], remove: [] });
});

test("leaves unlisted servers alone", () => {
  const plan = planChanges({ a: { command: "a" } }, { a: { command: "a" }, mine: { command: "m" } }, [
    "MCP_DOCKER",
  ]);
  assert.ok(![...plan.add, ...plan.replace, ...plan.remove].includes("mine"));
});

test("removes retired servers only when present", () => {
  assert.deepEqual(planChanges({}, { MCP_DOCKER: { command: "docker" } }, ["MCP_DOCKER"]).remove, [
    "MCP_DOCKER",
  ]);
  assert.deepEqual(planChanges({}, {}, ["MCP_DOCKER"]).remove, []);
});

test("applies adds before removes", () => {
  const desired = { a: { command: "a" }, b: { command: "b" } };
  const { calls, run } = recorder();
  applyChanges({ add: ["a"], replace: ["b"], remove: ["MCP_DOCKER"] }, desired, run);
  assert.deepEqual(calls, [
    ["mcp", "add-json", "-s", "user", "a", JSON.stringify(desired.a)],
    ["mcp", "remove", "-s", "user", "b"],
    ["mcp", "add-json", "-s", "user", "b", JSON.stringify(desired.b)],
    ["mcp", "remove", "-s", "user", "MCP_DOCKER"],
  ]);
});

test("keeps retired servers when an add fails", () => {
  const { calls, run } = recorder((args) => args[1] === "add-json");
  assert.throws(
    () => applyChanges({ add: ["a"], replace: [], remove: ["MCP_DOCKER"] }, { a: { command: "a" } }, run),
    /boom/,
  );
  assert.ok(!calls.some((args) => args.includes("MCP_DOCKER")));
});

test("seedDesktopCommander writes telemetry off and keeps other keys", () => {
  withTemp((home) => {
    const file = join(home, ".claude-server-commander", "config.json");
    seedDesktopCommander(home);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { telemetryEnabled: false });

    writeFileSync(file, JSON.stringify({ telemetryEnabled: true, x: 1 }));
    seedDesktopCommander(home);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { telemetryEnabled: false, x: 1 });
  });
});

test("github-headers exits 1 with a login hint", () => {
  withTemp((dir) => {
    // gh falls back to the OS keyring, so a logged-out gh can't be faked by config alone.
    // Hide gh from PATH instead: a missing gh and a failing gh share one error path.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"),
    );
    env.PATH = dir;
    const result = spawnSync(process.execPath, [join(here, "github-headers.mjs")], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /gh auth login/);
  });
});

test("servers.json contains no credentials", () => {
  assert.doesNotMatch(
    manifestText,
    /gh[opusr]_[A-Za-z0-9]|github_pat_|Bearer |mongodb(\+srv)?:\/\/|sk-[A-Za-z0-9]{8}/,
  );
});

test("servers.json pins every package", () => {
  for (const [name, server] of Object.entries(manifest.servers)) {
    if (server.command === "npx") {
      const pkg = server.args.find((arg) => !arg.startsWith("-"));
      assert.match(pkg, /@\d[^@]*$/, name);
    } else if (server.command === "uvx") {
      assert.match(server.args[0], /==/, name);
    }
  }
});

test("playwright keeps its output out of project folders", () => {
  const { args } = renderServers(manifest, { home: "/h", repo: "/r" }).playwright;
  assert.equal(args[args.indexOf("--output-dir") + 1], "/h/.claude/playwright-mcp");
});

test("runs when reached through a junction and explains a missing claude", () => {
  withTemp((dir) => {
    const link = join(dir, "link");
    symlinkSync(here, link, "junction");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"),
    );
    env.PATH = dir;
    env.CLAUDE_CONFIG_DIR = dir;
    const result = spawnSync(process.execPath, [join(link, "apply.mjs")], { encoding: "utf8", env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /'claude' not found.*native installer/);
  });
});

test("findCredentialProblems flags secrets by shape and by env name", () => {
  const problems = (server) => findCredentialProblems({ servers: { x: server } });
  assert.equal(problems({ env: { BRAVE_API_KEY: "abc123" } }).length, 1);
  assert.equal(problems({ env: { SERVICE_TOKEN: "abc123" } }).length, 1);
  assert.equal(problems({ headers: { "X-Whatever": "abc123" } }).length, 1);
  assert.equal(problems({ args: ["--key", "xoxb-1234567890"] }).length, 1);
  assert.equal(problems({ args: ["AKIAABCDEFGHIJKLMNOP"] }).length, 1);
  assert.equal(problems({ env: { API_KEY: "{{HOME}}/key" } }).length, 0);
  assert.equal(problems({ env: { MEMORY_FILE_PATH: "/x" } }).length, 0);
  assert.deepEqual(findCredentialProblems(manifest), []);
});
