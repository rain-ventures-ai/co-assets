---
name: board
description: Use a Rain task board (board/tasks.json in a GitHub repo, e.g. rain-ventures-ai/consulting or osouthgate/private-tasks) from any project. Use when asked what to work on, to pick up, claim, update, comment on, finish or add a board task, or "which board does this project use".
---

# Task board (from any project)

A board is `board/tasks.json` in a GitHub repo. People use the web board; agents use `board.py`. Never edit `tasks.json` by hand.

Run board.py like this (the path is filled in by the plugin):
```bash
B="python3 ${CLAUDE_PLUGIN_ROOT}/board.py"
```
If the current folder is itself a board repo (it has `board/board.py` and `board/tasks.json`), use `python3 board/board.py` from that repo instead, and follow its `.claude/skills/board/SKILL.md`.

## 1. Which board?
```bash
$B where
```
- It shows the board, user and auth, and where each setting comes from. It never prints a token.
- If it says `board: (none)`, ask the human which board this project uses (for example `rain-ventures-ai/consulting` for team or client work, `osouthgate/private-tasks` for Ollie's own tasks). Then save the choice:
  ```bash
  $B use <owner/name> --user <their-github-user> [--token-env <VAR_NAME>]
  ```
  This writes `.board/config.json` in the project root and a `.board/.gitignore` with `*`, so it is never committed.
- `--token-env` names the environment variable that holds that board's token (for example `BOARD_TOKEN_PRIVATE`). Never write a token into a file, a command or a message. If the human has a `gh` login with access to the board repo, no token is needed.
- A fine-grained token covers one owner only. A board under another owner needs its own token.

## 2. Find work
```bash
$B list --assignee <user> --column todo --unclaimed
$B show '#12'             # details, checklist, comments and history; read the comments before you start
```
Only work on tasks assigned to the human you act for, unless they tell you otherwise.

## 3. Claim, work, report
```bash
export BOARD_AGENT=claude BOARD_SESSION=<short session id>
$B claim '#12' --note "starting: <one-line plan>"
$B heartbeat '#12' --note "<current step>"        # at each milestone
$B todo-done '#12' <N>                            # tick each checklist item the moment it is done
$B comment '#12' "<question or update>"            # questions also need: heartbeat --status blocked
$B link '#12' <pull request url> --title "PR"
$B done '#12' --note "<result, link>"              # or: release '#12' --column todo
```
The plugin's hook sends a quiet heartbeat at most every 5 minutes while a claim is active. The claim is recorded in `.board/claim.json` (ignored by git).

## 4. Add a task
```bash
$B add "Title" --assign <user> --client "<client>" --due YYYY-MM-DD --details "<text>" --todo "step 1" --todo "step 2"
```
Keep client-confidential detail out of cards: link to the file or document instead.

## Rules
- Do not send anything outside the repo (emails, messages, quotes) without the human's explicit say-so.
- Never use `--force` on someone else's claim unless the human says so.
- If a write fails with "cannot save with git", the GitHub API refused the write (Claude's cloud sandbox does this). From another project there is no clone to push from: tell the human, and suggest running the step in the board repo instead.
