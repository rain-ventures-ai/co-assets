---
name: board
description: Work from the team task board (board/tasks.json) via board/board.py. Use when asked what to work on, to pick up, claim, update, finish or add a task, or to check for stuck agent work.
---

# Team board

The board lives in `board/tasks.json` and is managed only through `python3 board/board.py`. Read `AGENTS.md` for the rules; this is the procedure.

## 1. Identify who you act for
Use `BOARD_USER` (or `gh api user --jq .login`). Valid users: the `people` in `board/tasks.json`. Set `BOARD_AGENT=claude` and `BOARD_SESSION` to a short id for this session.

## 2. Find work
```bash
python3 board/board.py list --assignee "$BOARD_USER" --column todo --unclaimed
python3 board/board.py show <id>        # read details, links and contacts before starting
```
If the human named a task, use that one. Do not pick tasks assigned to someone else.

## 3. Claim, work, heartbeat
```bash
python3 board/board.py claim <id> --note "starting: <one-line plan>"
python3 board/board.py heartbeat <id> --note "<current step>"     # at each milestone
```
In Claude Code a project hook sends a quiet heartbeat automatically (at most every 5 min) while a claim is active, so the claim does not go stale during long work. The manual heartbeat is for updating the note. Without `gh`, set `BOARD_TOKEN` (fine-grained, Contents read/write on this repo).
If a claim is refused because another session holds it, stop and tell the human. Do not use `--force` unless they say so.

## 3b. Checklist
If `show` lists to-dos, work through them in order and tick each one as soon as it is done. Add steps you discover.
```bash
python3 board/board.py todo-done <id> <N>      # N is the number shown by `show`
python3 board/board.py todo-add <id> "<new step>"
python3 board/board.py todo-undo <id> <N>      # reopen
python3 board/board.py todo-rm <id> <N>
python3 board/board.py history <id>            # automatic log of claims, progress notes, ticks and moves
```

## 3c. Comments
`show` prints the latest comments; read them first, since people leave instructions and answers there.
```bash
python3 board/board.py comments <id>             # full stream
python3 board/board.py comment <id> "question, update or hand-off"
```
Post a short comment when you finish (what you did, with links) and whenever you need a human.

## 4. Blocked or stuck
```bash
python3 board/board.py heartbeat <id> --status blocked --note "<exactly what you need>"
```
Then tell the human in your reply.

## 5. Finish
```bash
python3 board/board.py done <id> --note "<result and link to the file/PR>"
# or hand back:
python3 board/board.py release <id> --column todo
```

## Adding tasks
```bash
python3 board/board.py add "Title" --assign <user> --label <label> --due YYYY-MM-DD --client "Hurst College" --details "<text and URLs>" --todo "step 1" --todo "step 2"
```
`--client` is optional; leave it out for tasks that are not about a client.

## Checking on others
`python3 board/board.py list --attention` lists stale, stuck and blocked claims.

## Never
- Edit `board/tasks.json` directly.
- Put client-confidential content in card text.
- Contact anyone outside the repo or share prices without the human's explicit approval.

## Numbers and mentions
- Refer to tasks as `#12` (shown on each card); `board.py show '#12'` works wherever an id is accepted.
- To get a human's attention, add a comment containing `@github-username` plus the reason; they see an "@ you" marker on the card.

## Working from a GitHub issue (board-task)
Issues created with the board's "Create issue" button carry `<!-- board-task: id=... num=N -->` and are titled `[#N] ...`. When you are asked to work such an issue:
1. `python3 board/board.py show '#N'` for the card, comments and checklist; the issue body is a snapshot.
2. Report back on the board, not only on the issue: `comment '#N' "..."` for progress or questions, `move '#N' in-progress|todo|done` for status, `link '#N' <PR url> --title "PR"` when you open a pull request.
3. Need a person (decision, access, review)? `assign '#N' <github-user> --note "why"` and comment with `@username`; then stop and wait.
4. Finish with `done '#N' --note "<result, PR link>"`. Set BOARD_USER and BOARD_AGENT; without a `gh` login set BOARD_TOKEN (or GH_TOKEN in GitHub Actions).

## Fired from the board (a person typed `@claude` in a comment)
A routine run starts with a `routine-fire-payload` naming a task number (`#N`) and the person (`@user`). The page has already put a claim on the card for this run, so:
1. `export BOARD_USER=<user> BOARD_AGENT=claude BOARD_SESSION=<short id>`; `BOARD_TOKEN` is set in the routine's environment.
2. `python3 board/board.py claim '#N' --for <user> --agent claude --session "$BOARD_SESSION" --force --note "working"` (`--force` is expected here: it replaces the page's placeholder claim).
3. `board.py show '#N'` and `board.py comments '#N'`; do what the newest `@claude` comment from that user asks, and nothing beyond it.
4. Keep the card honest while you work: `heartbeat '#N' --note "..."`, `todo-add` / `todo-done` for steps, `comment '#N'` for anything a human should read, `link '#N' <PR url> --title "PR"` for pull requests, `move '#N' <column>` for status.
5. Need a decision, access or review? `comment` with `@<user>` and the question, `assign '#N' <user> --note "why"`, then stop. Never guess.
6. Finish: `comment` the outcome, `assign '#N' <user>`, `done '#N' --note "<result>"`.

### Command cheat sheet
`list`, `show`, `claim`, `next`, `heartbeat`, `release`, `done`, `add`, `move ID COLUMN`, `assign ID USER... [--add|--remove]`, `link ID URL --title`, `todo-add|todo-done|todo-undo|todo-rm`, `comment`, `comments`, `history`. `ID` may be a task number such as `'#12'`. Columns: `backlog`, `todo`, `in-progress`, `done`. People: the `people` in `board/tasks.json`.
