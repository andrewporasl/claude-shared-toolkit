// Calls a real tool on each MCP server in servers.json, with Docker hidden from PATH.
// Usage: node mcp/smoke.mjs [name...]
// Never logs headers: the GitHub helper's output contains a token.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain, renderServers } from "./apply.mjs";

const TIMEOUT_MS = 180_000;
const INIT = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "mcp-smoke", version: "1" },
};

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
const onWindows = process.platform === "win32";

// Windows keeps docker in its own folders, so those can go. Elsewhere it shares /usr/bin with
// node and uvx, so shadow it with a stub that fails instead.
export function dockerFreeEnv(source, platform, stubDir, sep = delimiter) {
  const env = {};
  let path = "";
  for (const [key, value] of Object.entries(source)) {
    if (key.toUpperCase() === "PATH") path = value;
    else env[key] = value;
  }
  env.PATH =
    platform === "win32"
      ? path
          .split(sep)
          .filter((dir) => dir && !["docker", "docker.exe"].some((bin) => existsSync(join(dir, bin))))
          .join(sep)
      : [stubDir, path].join(sep);
  return env;
}

function assertNoDocker(env) {
  const result = spawnSync("docker", ["--version"], { env, encoding: "utf8" });
  if (!result.error && result.status === 0) {
    throw new Error("docker is still resolvable, so this run proves nothing");
  }
}

function stdioClient(server, env) {
  const child = spawn(server.command, server.args ?? [], {
    env: { ...env, ...server.env },
    shell: onWindows,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map();
  let buffer = "";
  let nextId = 1;
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      try {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
      } catch {
        // Servers may log non-JSON to stdout.
      }
    }
  });
  return {
    request: (method, params = {}) =>
      new Promise((done) => {
        const id = nextId++;
        pending.set(id, done);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      }),
    notify: (method) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`),
    close: () => {
      if (onWindows && child.pid) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill();
      }
    },
  };
}

function httpClient(server) {
  const helper = spawnSync(server.headersHelper, { shell: true, encoding: "utf8" });
  if (helper.status !== 0) throw new Error("headers helper failed");
  const headers = {
    ...JSON.parse(helper.stdout),
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  let nextId = 1;
  const post = async (body) => {
    const response = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const session = response.headers.get("mcp-session-id");
    if (session) headers["Mcp-Session-Id"] = session;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  };
  return {
    request: async (method, params = {}) => {
      const id = nextId++;
      const text = await post({ jsonrpc: "2.0", id, method, params });
      const frames = text.startsWith("{")
        ? [text]
        : text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5));
      for (const frame of frames) {
        const message = JSON.parse(frame);
        if (message.id === id) return message;
      }
      throw new Error(`no response to ${method}`);
    },
    notify: (method) => post({ jsonrpc: "2.0", method }),
    close: () => {},
  };
}

function textOf(message, label) {
  if (message.error) throw new Error(`${label}: ${JSON.stringify(message.error)}`);
  const text = (message.result?.content ?? []).map((item) => item.text ?? "").join("\n");
  if (message.result?.isError) throw new Error(`${label}: ${text.slice(0, 300)}`);
  return text;
}

async function call(client, name, args) {
  return textOf(await client.request("tools/call", { name, arguments: args }), name);
}

function expectText(text, needle, label) {
  if (!text.includes(needle)) {
    throw new Error(`${label}: "${needle}" not in ${JSON.stringify(text.slice(0, 200))}`);
  }
}

// Run after the server exits: on Windows it holds a lock on the folder it searched.
const cleanups = [];

const probes = {
  github: async (client) => expectText(await call(client, "get_me", {}), "\"login\"", "get_me"),
  playwright: async (client) => {
    const text = await call(client, "browser_navigate", { url: "https://example.com" });
    await call(client, "browser_close", {});
    expectText(text, "Example Domain", "browser_navigate");
  },
  fetch: async (client) =>
    expectText(await call(client, "fetch", { url: "https://example.com" }), "Example Domain", "fetch"),
  time: async (client) =>
    expectText(await call(client, "get_current_time", { timezone: "UTC" }), "UTC", "get_current_time"),
  git: async (client) =>
    expectText(await call(client, "git_status", { repo_path: repo }), "branch", "git_status"),
  duckduckgo: async (client) => {
    const text = await call(client, "search", { query: "model context protocol" });
    if (!text.trim()) throw new Error("search: empty result");
  },
  wikipedia: async (client, tools) => {
    const tool = tools.find((name) => name.includes("search"));
    if (!tool) throw new Error("no search tool");
    const text = await call(client, tool, { query: "Python" });
    if (!text.trim()) throw new Error(`${tool}: empty result`);
  },
  memory: async (client) => {
    await call(client, "read_graph", {});
  },
  sequentialthinking: async () => {},
  "desktop-commander": async (client) => {
    const dir = mkdtempSync(join(home, ".mcp-smoke-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
    writeFileSync(join(dir, "a.txt"), "needle-xyz\n");
    const started = await call(client, "start_search", {
      path: dir,
      pattern: "needle-xyz",
      searchType: "content",
    });
    const sessionId = started.match(/search_[\w-]+/)?.[0];
    if (!sessionId) throw new Error(`start_search: no session in ${started.slice(0, 200)}`);
    let found = started;
    for (let i = 0; i < 20 && !found.includes("a.txt"); i += 1) {
      await new Promise((done) => setTimeout(done, 500));
      found = await call(client, "get_more_search_results", { sessionId });
    }
    expectText(found, "a.txt", "start_search");
  },
};

async function check(name, server, env) {
  const client = server.type === "http" ? httpClient(server) : stdioClient(server, env);
  let timer;
  try {
    const work = (async () => {
      const init = await client.request("initialize", INIT);
      if (init.error) throw new Error(`initialize: ${JSON.stringify(init.error)}`);
      await client.notify("notifications/initialized");
      const listed = await client.request("tools/list");
      const tools = (listed.result?.tools ?? []).map((tool) => tool.name);
      if (!tools.length) throw new Error("no tools listed");
      await probes[name](client, tools);
      return tools.length;
    })();
    const timeout = new Promise((_, fail) => {
      timer = setTimeout(() => fail(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    client.close();
    for (const cleanup of cleanups.splice(0)) cleanup();
  }
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(repo, "mcp", "servers.json"), "utf8"));
  const servers = renderServers(manifest, { home, repo });
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(servers);
  const stubDir = mkdtempSync(join(tmpdir(), "mcp-smoke-stub-"));
  writeFileSync(join(stubDir, "docker"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const env = dockerFreeEnv(process.env, process.platform, stubDir);
  assertNoDocker(env);

  let failed = false;
  for (const name of names) {
    try {
      if (!servers[name]) throw new Error("not in servers.json");
      if (!probes[name]) throw new Error("no probe defined; add one to smoke.mjs");
      console.log(`PASS ${name} (${await check(name, servers[name], env)} tools)`);
    } catch (error) {
      failed = true;
      console.log(`FAIL ${name}: ${error.message}`);
    }
  }
  rmSync(stubDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

if (isMain(import.meta.url)) await main();
