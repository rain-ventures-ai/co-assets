# Team board

> **This folder is the task board for this repo.** It is not the repo's other work. A task can reference a client or area (the `client` field) or be about anything else. Leave `client` empty, or use a label like `internal`.

A Trello-style kanban for this repo with no database and no server. The single source of truth is [`board/tasks.json`](tasks.json). Two things read and write it:

- **The web board** — a static page hosted from the public `co-assets` repo: https://rain-ventures-ai.github.io/co-assets/board/?repo=<owner>/<repo>&path=board/tasks.json (source: `rain-ventures-ai/co-assets`, `board/index.html`). It holds no data. It talks to the GitHub API from your browser with a fine-grained token you paste in once (kept in your browser's localStorage, sent only to api.github.com).
- **The agent CLI** — [`board/board.py`](board.py), used by Claude, Codex or any script, through your existing `gh` login.

Every write re-reads the latest `tasks.json` and retries on a SHA conflict, so edits from the browser and from agents merge instead of overwriting each other.

## Using the web board
1. Open the hosted page above (the link pre-fills the repo).
2. Settings → check the file path is `board/tasks.json`, add your GitHub username and a **fine-grained token** limited to this repo with **Contents: Read and write**; the Settings dialog links to GitHub's token page with the name, expiry and permission pre-filled.
3. Drag cards between columns, or use ◀ ▶. Double-click or **Edit** for the full card.

Filters: client, assignee (including "Claimed by an agent"), label, priority, **Needs attention** (overdue, or an agent claim that is stale/stuck/blocked), hide done.

## `tasks.json` schema (version 2)
```jsonc
{
  "version": 2,
  "settings": { "stale_after_minutes": 30 },     // a "running" claim with no heartbeat for this long shows as STALE
                                                 // optional "kit_owner": "github-user" = whose Claude upgrades the board kit (default: first person)
  "columns": [{ "id": "todo", "name": "To do" }, ...],
  "people":  [{ "github": "osouthgate", "name": "Oliver" }, { "github": "JezHub", "name": "Jez" }],
  "agents":  ["claude", "codex"],
  "clients": ["Hurst College", "Rain Ventures", "General"],
  "labels":  [{ "name": "call", "color": "#0c66e4" }],
  "next_num": 13,                                 // next number to hand out; maintained by the web page and board.py
  "tasks": [{
    "id": "t_ab12cd34",
    "num": 12,                                      // short human number shown as #12 (stable, never reused); assigned automatically in creation order
    "title": "…",
    "column": "todo",
    "client": "Hurst College",               // optional; empty for tasks not tied to a client
    "priority": "high | medium | low",
    "due": "2026-10-20",                           // due-by date, optional
    "labels": ["call", "reply"],
    "assignees": ["osouthgate", "JezHub"],         // GitHub usernames (people)
    "details": "free text; URLs become clickable",
    "todos":   [{ "id": "d_ab12cd", "text": "…", "done": false, "doneBy": "…", "doneAt": "…" }],   // checklist inside the card (not separate tasks)
    "comments": [{ "id": "c_ab12cd", "at": "…", "by": "JezHub", "text": "append-only stream for people and agents" }],
    "history": [{ "at": "…", "by": "claude@osouthgate", "text": "✓ step one" }],               // automatic log, newest last, capped at 200
    "links":    [{ "title": "Drive folder", "url": "https://…" }],   // any URL; GitHub issue/PR/repo links (any repo) show as chips on the card, so use them to group related work
    "contacts": [{ "name": "…", "role": "…", "email": "…", "phone": "…" }],
    "claim": null,                                 // see below
    "last_run": null,                              // set by `done`: the finished claim, shown as one "Last run" line
    "created": "…", "createdBy": "osouthgate", "updated": "…", "updatedBy": "osouthgate"
  }]
}
```
Task order within the array is the order on the board. Humans are assigned with `assignees`; an **agent works on behalf of an assigned human** via a claim.

### Agent claim
When an agent picks up a task it writes (and keeps refreshing) a `claim`, so anyone can see who is running it and spot a stuck session:
```jsonc
"claim": {
  "agent": "claude",                 // or "codex", …
  "on_behalf_of": "osouthgate",      // the human assignee
  "session_id": "sess-9f2a",
  "session_url": "https://…",        // link to the session if there is one
  "host": "oliver-desktop",          // machine
  "cwd": "/home/osouthgate/dev/<repo>",
  "branch": "feature/x",
  "status": "running | blocked | stuck",
  "note": "what it is doing right now",
  "claimed_at": "…", "heartbeat_at": "…", "finished_at": "…"
}
```
The board shows each claim on the card (green running, amber stale/blocked, red stuck) and the card's edit dialog shows every field. A human can **Mark stuck** or **Release claim** from the board.

When the agent runs `done`, the claim is removed (no banner is left on the card) and kept as `last_run`: `{agent, on_behalf_of, session_id, session_url, started_at, finished_at, note}`. The card's drawer shows it as a single "Last run" line with the session link; the history also records it. `session_url` is filled automatically in Claude cloud sessions (from `CLAUDE_CODE_REMOTE_SESSION_ID`) or by the web page when it started the run; older claims with `status: "done"` are shown the same way.

## Agent protocol (copy into an agent's instructions)
```
You work from the team board (board/tasks.json) using board/board.py.
1. Find work:      python3 board/board.py list --assignee <github-user> --column todo --unclaimed
2. Claim it:       python3 board/board.py claim <id> --for <github-user> --agent <claude|codex> --session <session-id> --note "starting"
                   (or:  board.py next --for <github-user> --agent claude --session <id>)
   - You may only claim tasks assigned to the human you work for. A fresh claim by another session is refused.
3. While working:  board.py heartbeat <id> --note "<what you are doing>"      # at least every 10 minutes
   If blocked:     board.py heartbeat <id> --status blocked --note "<why>"
4. Finish:         board.py done <id> --note "<result, PR link>"            # or: board.py release <id> --column todo
Never edit tasks.json by hand; always go through board.py so conflicts are handled.
```
**In Claude's cloud sandbox** (routines, Claude Code on the web) the GitHub API is read-only: writes come back `403 ... not permitted through this proxy`. `board.py` then saves by committing `tasks.json` on top of the latest `master` and running `git push` from its clone (retrying if someone else pushed first), without touching your working tree. `BOARD_WRITE=git` forces this, `BOARD_WRITE=api` disables it.

**Auth without `gh`:** set `BOARD_TOKEN` (or `GH_TOKEN`/`GITHUB_TOKEN`) to a fine-grained token with Contents: Read and write on this repo and `board.py` calls the GitHub API directly with the standard library. If `BOARD_TOKEN` is set it is used even when `gh` exists. This is the route for cloud agent sandboxes.

**Automatic heartbeat:** `claim` writes `.board-claim.json` (gitignored). `board.py auto-heartbeat` refreshes that claim at most every 5 minutes and silently does nothing if there is no active claim, it was released or finished, or another session took the task over. `.claude/settings.json` runs it as a Claude Code `PostToolUse` hook. Other agents call `board.py heartbeat` themselves.

Useful environment variables: `BOARD_USER`, `BOARD_AGENT`, `BOARD_SESSION` (also `CLAUDE_SESSION_ID` / `CODEX_SESSION_ID`), `BOARD_REPO`, `BOARD_BRANCH`, `BOARD_PATH` (default `board/tasks.json`). Test safely with `--file some-copy.json`.

## Hosting the web page
GitHub Pages is not available for private repos on the current (free) org plan, so the page lives in the small public repo `rain-ventures-ai/co-assets` (served by GitHub Pages). It contains no client data; the data stays in this private repo and is fetched only with your token. Edit the page there, not here.

## Security notes
- The token is stored in localStorage; use a fine-grained token scoped to this repo only, with an expiry.
- Anyone with write access to this repo can edit the board (and the page's code). Keep client-confidential detail out of card text if the repo audience widens.
- The page escapes all card text (no `innerHTML`) and only links `http(s)` URLs.

## Task numbers and mentions
- Every task has a short number (`#12`) shown on its card and in the drawer; click it to copy. Say "#12" when you discuss a task. `board.py show '#12'` (or `claim`, `done`, `comment`...) accepts it in place of the long id. Quote the `#` in a shell.
- In comments and descriptions, `@github-username` highlights that person (or agent) and `#12` becomes a link to that task. Typing `@` or `#` in the web page offers a pick list.
- A comment that mentions someone shows an **@ you** marker on the card the next time that person opens the board. There are no push notifications; the board is a static page.
- When an agent needs a human's attention, comment with `@username` and the reason: `board.py comment '#12' "@osouthgate blocked: need the Drive link"`.

## Working from a GitHub issue (board-task)
Issues created with the board's "Create issue" button carry `<!-- board-task: id=... num=N -->` and are titled `[#N] ...`. When you are asked to work such an issue:
1. `python3 board/board.py show '#N'` for the card, comments and checklist; the issue body is a snapshot.
2. Report back on the board, not only on the issue: `comment '#N' "..."` for progress or questions, `move '#N' in-progress|todo|done` for status, `link '#N' <PR url> --title "PR"` when you open a pull request.
3. Need a person (decision, access, review)? `assign '#N' <github-user> --note "why"` and comment with `@username`; then stop and wait.
4. Finish with `done '#N' --note "<result, PR link>"`. Set BOARD_USER and BOARD_AGENT; without a `gh` login set BOARD_TOKEN (or GH_TOKEN in GitHub Actions).

## Which agents each person uses (Settings → Agents)
Each person ticks the agents they use: **Claude**, **Codex** or both. The choice is kept in their browser (`kb_agents`) and moves with "Copy settings code". Typing `@` in the web page only offers the agents you have ticked; people are always offered. Before you choose, Claude counts as ticked if your routine is set up. The `agents` list in `tasks.json` is the shared set of names agents may claim under; it does not change per person.

- **Claude:** `@claude` can start your own routine (below).
- **Codex:** `@codex` cannot start Codex by itself: OpenAI only starts Codex cloud tasks from an `@codex` comment on a GitHub pull request and offers no trigger a web page can call. Instead, when a card's newest request is for `@codex` (and no Codex comment or running Codex claim has answered it), the card's **Copy for agent** button turns into a highlighted **Copy for Codex**. It copies instructions that tell Codex to do what the newest `@codex` comment asks, with `BOARD_AGENT=codex`. Paste them into Codex; it claims the card and reports back with `board.py`. The button only changes for people who ticked Codex.

## `@claude` in a comment: your own routine
Each person can connect their own Claude routine so that a comment containing `@claude` starts it (web page, Settings → **Agents**, tick Claude). The values live only in that person's browser and move with "Copy settings code".

**How it works.** Browsers can't call a routine's trigger URL directly (Anthropic's endpoint sends no CORS headers), so the page creates a one-off job on the person's free cron-job.org account (its API does allow browsers) which POSTs to the routine's `/fire` URL. The page then reads the result, records the session link on the card (an agent claim by `claude`, working for that person) and deletes the job. cron-job.org only ever sees the routine token and the task *number* and requester, never the task's text; the routine reads the real content from the board. Starting takes one to two minutes.

**Setup.** Follow [`board/ROUTINE-SETUP.md`](ROUTINE-SETUP.md) (the routine's saved prompt is the short [`routine-loader.txt`](routine-loader.txt); its behaviour lives in [`routine-prompt.md`](routine-prompt.md), which you can edit here without touching the routine). Or ask Claude Code in this repo to "set up my board routine"; the `board-routine-setup` skill guides and verifies it without handling any secrets.

## Board kit
The tools in this folder (and `.claude/skills/board*`) are the **board kit**. Their source is `rain-ventures-ai/co-assets` `board/kit/`; `board/KIT_VERSION` says which version this repo has. Do not edit them here: see `board/UPGRADING.md`.
