# Board kit: upgrade notes

> **Retired: moved to [rain-ventures-ai/keeptrack](https://github.com/rain-ventures-ai/keeptrack).** The board kit (`board/kit/`, `board.py`) and the web board here are no longer maintained. Use the kit and `keeptrack.py` from keeptrack, and the web board at https://rain-ventures-ai.github.io/keeptrack/board/. The files stay here only so old clones keep working; do not change them.

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

### v4 (retired)
The board kit has moved to [rain-ventures-ai/keeptrack](https://github.com/rain-ventures-ai/keeptrack) (`board/kit/`). co-assets publishes no more kit versions. A plain `board.py kit-update` (from co-assets) stops on purpose with "cannot read moved-to/github.com/rain-ventures-ai/keeptrack", so a repo is not marked v4 with the old tools. Move the repo to keeptrack's kit and `keeptrack.py` instead, with the steps below. They were tested on a v3 board (schema 2) with keeptrack kit v44; `python3 -m unittest discover -s tests` in co-assets runs them on a scratch board.

Agent steps, on a branch (`git checkout -b claude/board-kit-keeptrack`):
1. `git clone --depth 1 https://github.com/rain-ventures-ai/keeptrack /tmp/kt`
2. `python3 board/board.py kit-update --from /tmp/kt/board/kit`. The old `board.py` copies keeptrack's kit, including `board/keeptrack.py`, and sets `board/KIT_VERSION` to keeptrack's version.
3. `python3 board/keeptrack.py kit-update --from /tmp/kt/board/kit`. The new tool repeats the copy and also applies keeptrack's removals and optional files, which `board.py` does not know. It normally says "changed: nothing".
4. `git rm board/board.py`. Change every `board.py` (and so `board/board.py`) to `keeptrack.py` in `.claude/settings.json` (the auto-heartbeat hook), `AGENTS.md`, `CLAUDE.md` and any routine or note. `grep -rn "board\.py" --exclude-dir=.git .` should then find it only in `board/UPGRADING.md`.
5. Add these lines to `.gitignore` if they are missing: `.board/cache/`, `*.json.lock`, `.tmp-*.part`.
6. Read the new `board/UPGRADING.md` from v5 on for anything else this repo needs. Do not migrate yet.
7. Check: `python3 -m py_compile board/keeptrack.py`, `python3 board/keeptrack.py kit-check` (current) and `python3 board/keeptrack.py list` (works; it reads the schema-2 file as it is).
8. Commit, push the branch, open a pull request and link it on the card. Say in the PR that the data migration follows the merge.

Migration, after the PR is merged, from the default branch. It splits `board/tasks.json` into `board/cards/` and `board/people/` files, which only keeptrack's web board reads, so tell the team first:
1. `python3 board/keeptrack.py migrate --to 4 --dry-run`. Check the counts and the file list.
2. `python3 board/keeptrack.py migrate --to 4`. It goes straight from schema 2 to 4 and makes a backup tag (`keeptrack-v3-backup-YYYYMMDD-HHMM`) first. Keep the tag.
3. `python3 board/keeptrack.py verify --against <backup tag>`. It must say OK.
4. `python3 board/keeptrack.py doctor`. It must exit 0; a warning such as `MEMBER_NO_PERSON` is fine (`keeptrack.py doctor --json` says `"healthy": true`).
5. Check: `board/tasks.json` has `"version": 4` and `"layout": "split"`, and `board/cards/` holds a file for each card. Then finish the upgrade card with a link to the PR.

- Web board: after the move, use https://rain-ventures-ai.github.io/keeptrack/board/?repo=<owner>/<repo>&path=board/tasks.json. The old page here cannot read a schema-4 board.

### v3 (schema 2)
Boards can be used from any project, and the kit is also a Claude Code plugin (`board@rain-board`, see `PLUGIN.md`).
- `board.py use owner/name [--user U] [--token-env VAR]` writes a gitignored `.board/config.json` in a project; `board.py where` shows which board and auth a folder uses.
- In the kit, the skills that are copied into board repos moved from `skills/` to `repo-skills/` (`skills/` is now the plugin's skill). The paths in a board repo do not change.
- Agent steps: run `kit-update` only. No data change.
- Check: `python3 board/board.py kit-check` says v3 is current, and `python3 board/board.py where` shows the repo from the git remote.

### v2 (schema 2)
New boards can be set up with one command, and the web board has Settings → Boards.
- `board.py init --person user:Name` sets up a new board repo: the kit, starter `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.claude/settings.json` (only when missing) and an empty `tasks.json`. The starter files come from `templates/` in the kit and belong to the repo after that.
- `NEW-BOARD.md` in the kit is the guide that the "new board" prompt in Settings → Boards points to.
- Agent steps: run `kit-update` only. No data change.
- Check: `python3 board/board.py kit-check` says v2 is current.

### v1 (schema 2)
First kit version. The tools move from `rain-ventures-ai/consulting/board/` into co-assets.
- Agent steps: run `kit-update` (no data change: schema 2 stays 2, so no migration). Make sure `AGENTS.md` in the repo keeps its own rules and links to `board/README.md` for the schema.
- `board.py` now gets the repo from the git remote (`origin`). `BOARD_REPO` still overrides it.
- New commands: `kit-check`, `kit-update`, `migrate`, `kit-owner`.
- Check: `python3 board/board.py kit-check` says current, and `python3 board/board.py list` works.
- After v1 is in every board repo, change board tools only in co-assets `board/kit/`.
