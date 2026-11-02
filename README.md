# claude-shared-toolkit

A starter set of Claude Code skills and MCP servers. Fork it and make it yours. Feel free to remove whatever bloatware you think I have, but tbh I think it's a good foundation to start tbh.

> [!WARNING]`
> Setup runs code from this repo on your machine. Read anything you pull in before you run it.

## Install

You need [Claude Code](https://docs.claude.com/en/docs/claude-code), [Node](https://nodejs.org) 20+ and [uv](https://docs.astral.sh/uv/). For the `github` server, you also need the [GitHub CLI](https://cli.github.com), logged in with `gh auth login`.

1. Click **Fork** on GitHub.
2. Clone your fork and make your own branch:
   ```bash
   git clone https://github.com/<you>/claude-shared-toolkit ~/claude-shared-toolkit
   cd ~/claude-shared-toolkit
   git switch -c <you>
   git push -u origin <you>
   ```
3. Run setup (`bash setup.sh`, or `.\setup.ps1` on Windows), then restart Claude Code.

Setup only adds things. It won't touch your own skills, settings or `CLAUDE.md`. Run it again after any change.

## Your branch

Keep `main` untouched and put all your changes on your own branch:

- **Add a skill:** create `skills/<name>/SKILL.md`.
- **Add an MCP server:** add it to `mcp/servers.json` with an exact version.
- **Get updates from the base:** click **Sync fork** on GitHub, then run `git fetch origin && git merge origin/main`.
- **Take a skill from a friend:**
  ```bash
  git remote add sam https://github.com/sam/claude-shared-toolkit
  git fetch sam
  git checkout sam/sam -- skills/some-skill
  ```

**Never commit secrets.** Forks are public.

## Using it on more than one computer

Your fork on GitHub is the copy you keep. Each computer just downloads it.

**Setting up another computer** (once):
```bash
git clone https://github.com/<you>/claude-shared-toolkit ~/claude-shared-toolkit
cd ~/claude-shared-toolkit
git switch <you>
bash setup.sh
```

**When you change something**, upload it from that computer:
```bash
cd ~/claude-shared-toolkit
git add -A
git commit -m "what you changed"
git push
```

**On your other computers**, download it:
```bash
cd ~/claude-shared-toolkit
git pull
bash setup.sh
```

Then restart Claude Code.

**Tip:** run `git pull` *before* you start changing things on a computer. That way you're always working on the latest version and git won't complain about conflicts.

## Troubleshooting

- **`uvx` not found:** install uv, then restart your terminal and Claude Code.
- **playwright says `Connection closed`:** upgrade Node to 20 or later.
- **A skill doesn't show up:** you already have a skill with that name. Yours wins.

## Credits

Third-party skills come from [anthropics/skills](https://github.com/anthropics/skills), [vercel-labs/skills](https://github.com/vercel-labs/skills), [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) and [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill). See each project for its license.
