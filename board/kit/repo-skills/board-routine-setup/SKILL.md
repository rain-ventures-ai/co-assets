---
name: board-routine-setup
description: Guide, check and verify a person's Claude routine setup for the team board's @claude comments (routine, BOARD_TOKEN, API trigger, cron-job.org relay, board Settings). Use when asked to set up, check or fix "my board routine", "@claude on the board", or the cron-job.org relay.
---

# Board routine setup (guide and verify, never handle secrets)

Read `board/ROUTINE-SETUP.md` (the runbook), `board/routine-loader.txt` (the short prompt pasted into the routine) and `board/routine-prompt.md` (the full instructions the routine reads from the repo each run) first.

## You may
- Walk the person through each runbook step, one at a time, and say which values they will need next.
- Offer two modes first: **guide** (you instruct, they click) or **browser** (you drive their browser through claude.ai/code/routines, the GitHub token page and console.cron-job.org using a browser tool such as Claude in Chrome or the built-in browser). In browser mode you may click and fill **non-secret** fields (routine name, the loader prompt from `board/routine-loader.txt`, repository, environment name and network level, removing connectors). Ask before submitting each form. The person types or pastes every secret.
- Recommend a dedicated environment `Board assistant (<name>)` with **Trusted** network access (see the runbook's "Which environment"); widen it only if the person wants open-web research, and explain the token-exposure trade-off.
- Check the repo side: `python3 board/board.py show '#1'` works, `board/routine-prompt.md` matches what the routine contains (ask the person to paste the loader, or read it from the routine page), `.claude/skills/board/SKILL.md` and `.claude/settings.json` exist in the default branch (the routine clones them).
- Run `/schedule list` (or the RemoteTrigger list action) to confirm the routine exists, and read its recent run logs to diagnose a failed first run.
- Draft troubleshooting from the runbook table.

## You must not
- Type, paste, request, repeat or store any token, API key or trigger URL (routine token, `BOARD_TOKEN`, cron-job.org key). If one appears in chat, tell the person to revoke and regenerate it.
- Create the routine's API trigger or token (claude.ai web only) or the cron-job.org account on their behalf.
- Attach connectors to the routine, or grant it more than this repository and `BOARD_TOKEN`.

## Verification checklist (report each as pass/fail)
1. Routine exists, repo is this board's repo, no connectors, saved prompt equals `board/routine-loader.txt` (the full instructions live in `board/routine-prompt.md`, not in the routine).
2. Environment has `BOARD_TOKEN` (ask; you cannot read it).
3. API trigger exists (ask the person to confirm they copied URL and token).
4. Board Settings → Agents saved; "Test cron-job.org key" says it works.
5. First run: a comment `@claude add a comment saying hello` on a low-stakes task ends with a claude comment on the card and the task assigned back.
