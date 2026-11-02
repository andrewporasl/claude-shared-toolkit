// Registers the servers in mcp/servers.json at Claude Code's user scope.
// Usage: node mcp/apply.mjs
// Always goes through the claude CLI, because ~/.claude.json must not be edited by hand.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const forward = (path) => path.replace(/\\/g, "/");

function mapStrings(value, fn) {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

export function renderServers(manifest, { home, repo }) {
  return mapStrings(manifest.servers, (text) =>
    text.replaceAll("{{HOME}}", forward(home)).replaceAll("{{REPO}}", forward(repo)),
  );
}

// The CLI fills in defaults when it stores a server, so compare with those applied.
function normalize(server) {
  const out = { ...server };
  out.type ??= "stdio";
  if (out.type === "stdio") {
    out.args ??= [];
    out.env ??= {};
  }
  return out;
}

export function planChanges(desired, current, retired) {
  const add = [];
  const replace = [];
  for (const [name, server] of Object.entries(desired)) {
    if (!(name in current)) add.push(name);
    else if (!isDeepStrictEqual(normalize(server), normalize(current[name]))) replace.push(name);
  }
  const remove = retired.filter((name) => name in current && !(name in desired));
  return { add, replace, remove };
}

// Runs every add before any retired server is removed, so a failure leaves the old setup working.
export function applyChanges(plan, desired, run) {
  const exec = (args) => {
    const result = run(args);
    if (result.status !== 0) {
      throw new Error(`claude ${args.slice(0, 2).join(" ")} ${args[4]} failed: ${result.stderr}`);
    }
  };
  const addArgs = (name) => ["mcp", "add-json", "-s", "user", name, JSON.stringify(desired[name])];
  const removeArgs = (name) => ["mcp", "remove", "-s", "user", name];

  for (const name of plan.add) exec(addArgs(name));
  for (const name of plan.replace) {
    exec(removeArgs(name));
    exec(addArgs(name));
  }
  for (const name of plan.remove) exec(removeArgs(name));
}

const SECRET_VALUE = /gh[opusr]_[A-Za-z0-9]|github_pat_|xox[abprs]-|AKIA[0-9A-Z]{16}|Bearer |mongodb(\+srv)?:\/\/|sk-[A-Za-z0-9]{8}/;
const SECRET_NAME = /key|token|secret|password/i;

// servers.json is pushed to GitHub, so it may only hold references to secrets, never values.
export function findCredentialProblems(manifest) {
  const problems = [];
  for (const [name, server] of Object.entries(manifest.servers)) {
    if (SECRET_VALUE.test(JSON.stringify(server))) problems.push(`${name}: credential-shaped value`);
    if (server.headers) problems.push(`${name}: inline headers; use headersHelper`);
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (SECRET_NAME.test(key) && !String(value).startsWith("{{")) problems.push(`${name}: env ${key}`);
    }
  }
  return problems;
}

// Desktop Commander reports telemetry unless this is set before its first launch.
export function seedDesktopCommander(home) {
  const file = join(home, ".claude-server-commander", "config.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...config, telemetryEnabled: false }, null, 2));
}

// Node resolves links for the module URL but not argv, so resolve both or a linked repo silently no-ops.
export function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(moduleUrl);
}

function timestamp() {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function main() {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const home = homedir();
  const manifest = JSON.parse(readFileSync(join(repo, "mcp", "servers.json"), "utf8"));
  const problems = findCredentialProblems(manifest);
  if (problems.length) {
    throw new Error(`servers.json looks like it contains secrets, so nothing was applied:\n  ${problems.join("\n  ")}`);
  }
  const desired = renderServers(manifest, { home, repo });

  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const configFile = join(configDir ?? home, ".claude.json");
  const current = existsSync(configFile)
    ? (JSON.parse(readFileSync(configFile, "utf8")).mcpServers ?? {})
    : {};

  const version = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (version.error) {
    throw new Error("'claude' not found as an executable. Install Claude Code with the native installer.");
  }

  seedDesktopCommander(home);

  const plan = planChanges(desired, current, manifest.retired ?? []);
  if (!plan.add.length && !plan.replace.length && !plan.remove.length) {
    console.log("MCP servers already up to date");
    return;
  }

  if (existsSync(configFile)) {
    const backupDir = join(home, ".claude", "backups");
    mkdirSync(backupDir, { recursive: true });
    const backup = join(backupDir, `claude.json.pre-mcp-${timestamp()}`);
    copyFileSync(configFile, backup);
    console.log(`backed up config to ${backup}`);
  }

  applyChanges(plan, desired, (args) => spawnSync("claude", args, { encoding: "utf8" }));
  for (const name of plan.add) console.log(`added ${name}`);
  for (const name of plan.replace) console.log(`replaced ${name}`);
  for (const name of plan.remove) console.log(`removed ${name}`);
}

if (isMain(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
