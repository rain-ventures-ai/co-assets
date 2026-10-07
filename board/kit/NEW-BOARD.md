# Set up a new task board

A board is a GitHub repo with the board kit and a `board/tasks.json`. The web board at
https://rain-ventures-ai.github.io/co-assets/board/ works with any such repo. This guide is for a person and for the
Claude that helps them. It is the target of the "Copy new-board prompt for Claude" button in Settings → Boards.

## Rules for Claude
- Never type, paste, read back or store a secret (GitHub token, routine token, cron-job.org key). At each secret step,
  tell the person where to click and what to paste, and wait until they say it is done.
- Do not create anything outside the new repo. Ask before each step that cannot be undone.

## 1. Agree the basics (ask the person)
- The repo: owner and name, for example `osouthgate/private-tasks` or `rain-ventures-ai/ops-board`. A board for one
  person usually goes in their own account; a team board goes in the organisation.
- The people: GitHub username and display name for each one. The first person is the **upgrade owner**: their Claude
  does future board kit upgrades (change it later with `board.py kit-owner`).
- Optional: the client or area names for the `client` field (default: `General`).

## 2. Create the repo (the person, or Claude if it has a tool that can)
Create an **empty, private** repo with no README: `https://github.com/new?name=<name>&visibility=private`
(for an organisation, choose it as the owner). Claude often cannot create repos in a person's account; then the person
does it and says when it is done.

## 3. Add the board kit (Claude, in a clone of the new repo)
```bash
git clone https://github.com/<owner>/<name> && cd <name>
git checkout -b master            # the web board and board.py use the master branch by default
mkdir -p board
curl -fsSL https://raw.githubusercontent.com/rain-ventures-ai/co-assets/master/board/kit/board.py -o board/board.py
python3 board/board.py init --person <user>:<Name> [--person <user2>:<Name2>] [--client "<area>"]
python3 board/board.py --file board/tasks.json list   # empty board, no error
python3 board/board.py kit-check                      # says the kit is current
git add -A && git commit -m "Set up task board (board kit)" && git push -u origin master
```
`init` writes the kit files, a starter `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.claude/settings.json` and an empty
`board/tasks.json`. It never overwrites a file that exists. Add the repo's own rules to `AGENTS.md` if it has other work.
If the repo's default branch is `main`, either make `master` the default branch in GitHub (Settings → General) or set the
branch to `main` in the web board and `BOARD_BRANCH=main` for agents.

## 4. Connect the web board (the person)
1. Make a fine-grained token: owner = the repo's owner, **Only select repositories** = this repo, **Contents: Read and
   write**, and **Issues: Read and write** for the Create issue button. The token link in Settings → Connection fills
   most of this in.
2. On the web board: Settings → **Boards** → **Add an existing board**. Type `<owner>/<name>` and paste the token.
3. The header's board menu now switches between your boards. Each board keeps its own token in this browser.

Each person on the board does steps 4.1 and 4.2 in their own browser, with their own token.

## 5. Claude routine for @claude (optional, each person)
Follow `board/ROUTINE-SETUP.md` in the new repo, with the new repo as the routine's repository and a `BOARD_TOKEN` for
this repo. Then open the new board and paste the routine URL and token in Settings → Agents. A routine for another
board cannot write to this one.

## 6. Check
- The web board opens the new board with no error and no "out of date" banner.
- Add a test card on the web board, then `python3 board/board.py list` shows it.
