---
name: board-upgrade
description: Upgrade this repo's board tools (the board kit from rain-ventures-ai/co-assets) and migrate board/tasks.json. Use when a board card or a person asks to upgrade the board kit or board tools, or kit-check says the kit is out of date.
---

# Upgrade the board kit

You act for the board's upgrade owner (`python3 board/board.py kit-owner`). If you act for someone else, comment on the card that the upgrade belongs to the owner, assign it to them, and stop.

1. `python3 board/board.py kit-check`. If it says current, comment that on the card and finish the card with `done`.
2. Claim the card. Make a branch: `git checkout -b claude/board-kit-v<N>`.
3. `python3 board/board.py kit-update`. It copies the kit files and writes `board/KIT_VERSION`. It does not commit.
4. Read `board/UPGRADING.md`. Do the agent steps of each version after the old version, in order.
5. Do **not** run `migrate` before the PR is merged: the board's live data would then be newer than the tools other agents run from the default branch, and they would stop writing. After the merge, the first board write migrates the data (board.py and the web board both do it); `python3 board/board.py migrate` does it at once. Say this in the PR and on the card when the upgrade changes the schema.
6. Keep this repo's own files: `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json` and anything outside the manifest are not kit files. Change them only when the upgrade notes say so. Do not put repo-specific text into kit files: if a kit file is wrong for this repo, say so in a card comment for the kit to be fixed in co-assets.
7. Check: `python3 -m py_compile board/board.py`, `python3 board/board.py kit-check` (current), `python3 board/board.py list` (works), and every check the upgrade notes give.
8. Commit, push the branch, open a pull request, and `board.py link` it on the card. Tick the card's checklist as you go.
9. Comment the result, assign the card to the owner for the merge, and mark it `done`.

If the card is still open after the merge and the schema changed, run `python3 board/board.py migrate` from the default branch, then finish the card.

Never push kit changes to the default branch yourself, and never edit `board/tasks.json` by hand.
