// headersHelper for the GitHub MCP server: prints auth headers built from the gh login.
// The token is only ever written to stdout for Claude Code to read. Never log it.
import { execFileSync } from "node:child_process";

try {
  const token = execFileSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!token) throw new Error("empty token");
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }));
} catch {
  console.error("GitHub MCP: run 'gh auth login'");
  process.exit(1);
}
