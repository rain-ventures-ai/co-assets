# Board kit: upgrade notes

The board kit is the set of shared board tools. Its source is `rain-ventures-ai/co-assets`, folder `board/kit/`. Each board repo has a copy, and `board/KIT_VERSION` in the repo gives the kit version of that copy. `manifest.json` lists the files and where they go in a board repo.

**Do not edit kit files in a board repo.** Change them in co-assets and publish a new kit version. Then upgrade each board.

## Who upgrades a board
Each board has one **upgrade owner**: `settings.kit_owner` in `tasks.json`. If it is not set, the owner is the first person in `people`. Only the owner's Claude routine does the upgrade.
- See or change the owner: `python3 board/board.py kit-owner [github-user]`.
- When the kit is out of date, the web board shows a banner. For the owner, the banner has a button that makes the upgrade card. Other people see who the owner is.
- `board.py kit-check --card` makes the same card. A routine run does this at its start, so drift shows on the board with no CI.
- The owner comments `@claude upgrade the board kit` on the card. Their routine follows `.claude/skills/board-upgrade/SKILL.md`.

## Rules for a kit change (for whoever changes co-assets board/kit)
1. Increase `version` in `manifest.json` by one, and add a section below for the new version.
2. If `tasks.json` changes shape: increase `SCHEMA` in `board.py` and `KNOWN_SCHEMA` in the web board's `board.js` together, increase `schema` in `manifest.json`, add a step to `MIGRATIONS` in `board.py`, and make the web board's `normalise()` do the same change. The step must be safe to run two times. The first write after a repo's upgrade PR is merged migrates the data; do not migrate before the merge.
3. The web board and `board.py` must still read the schema version before the new one, so boards that are not upgraded yet continue to work.
4. A change that needs more than a file copy is not finished until its section here says what the upgrading agent must do and how to check it.

## Versions

### v1 (schema 2)
First kit version. The tools move from `rain-ventures-ai/consulting/board/` into co-assets.
- Agent steps: run `kit-update` (no data change: schema 2 stays 2, so no migration). Make sure `AGENTS.md` in the repo keeps its own rules and links to `board/README.md` for the schema.
- `board.py` now gets the repo from the git remote (`origin`). `BOARD_REPO` still overrides it.
- New commands: `kit-check`, `kit-update`, `migrate`, `kit-owner`.
- Check: `python3 board/board.py kit-check` says current, and `python3 board/board.py list` works.
- After v1 is in every board repo, change board tools only in co-assets `board/kit/`.
