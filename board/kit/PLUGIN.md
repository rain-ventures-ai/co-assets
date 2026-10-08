# Use a board from any project (Claude plugin, Codex)

A board repo (for example `rain-ventures-ai/consulting`) has its own copy of the board tools. To use a board from **another** project, install the `board` plugin once. The plugin is this folder (`board/kit/` in `rain-ventures-ai/co-assets`), so it is always the latest kit.

## Claude Code: install once
```bash
claude plugin marketplace add rain-ventures-ai/co-assets
claude plugin install board@rain-board
```
Or in a session: `/plugin marketplace add rain-ventures-ai/co-assets`, then `/plugin install board@rain-board`.

**Keep it updated:** in a session, open `/plugin`, go to **Marketplaces**, select **rain-board**, and select **Enable auto-update**. Auto-update is off by default for marketplaces that are not Anthropic's. The plugin has no `version` field, so each commit to co-assets is a new version. Claude Code checks in the background and loads the new version at the next start (or `/reload-plugins`). To update by hand: `claude plugin marketplace update rain-board`.

The same with settings (`~/.claude/settings.json`), for example on a new machine:
```json
{
  "extraKnownMarketplaces": {
    "rain-board": { "source": { "source": "github", "repo": "rain-ventures-ai/co-assets" }, "autoUpdate": true }
  },
  "enabledPlugins": { "board@rain-board": true }
}
```

The plugin gives:
- the skill `board:board` (find, claim, update and finish tasks from any project),
- `board.py` at `${CLAUDE_PLUGIN_ROOT}/board.py`,
- a hook that sends a quiet heartbeat while a claim is active.

## Each project: which board?
In the project, run (or ask Claude to run):
```bash
python3 <plugin>/board.py use osouthgate/private-tasks --user osouthgate --token-env BOARD_TOKEN_PRIVATE
python3 <plugin>/board.py where
```
- `use` writes `.board/config.json` in the project root, plus `.board/.gitignore` (`*`), so the folder is never committed. Claims go in `.board/claim.json`.
- The file holds the repo, branch, path and user, and optionally the **name** of the environment variable with that board's token. Never a token.
- Auth: a `gh` login that can see the board repo, or a fine-grained token in that variable (or in `BOARD_TOKEN`). A fine-grained token covers one owner only, so `osouthgate/...` and `rain-ventures-ai/...` boards need separate tokens.
- Environment variables (`BOARD_REPO`, `BOARD_USER`, ...) still win over the file.

## Codex
Codex has no plugins. Keep a clone of co-assets and point Codex at it in `~/.codex/AGENTS.md`:
```markdown
## Task boards
To use a task board from any project, run `python3 ~/dev/co-assets/board/kit/board.py` (first `git -C ~/dev/co-assets pull -q`).
Run `board.py where` first. If no board is set, ask which board, then `board.py use <owner/name> --user <user>`.
Follow ~/dev/co-assets/board/kit/skills/board/SKILL.md, with `$B` meaning that board.py. Use BOARD_AGENT=codex.
```

## Limits
- From another project there is no clone of the board repo, so the git-push fallback is not available. In Claude's cloud sandbox (which blocks GitHub API writes) writes fail there; do them in the board repo.
- `kit-check`, `kit-update` and `init` work only inside a board repo.
