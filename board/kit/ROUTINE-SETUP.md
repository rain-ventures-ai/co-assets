# Connect your own Claude routine to the board (`@claude` comments)

Each person on the board sets up **their own** routine, one for each board repo. A routine acts for one person: it uses their Claude usage and limits, and its work is recorded against them. Typing `@claude ...` in a task comment on the web board then starts *your* routine for that board on that task, after you confirm "Send to Claude?".

If you would like an agent to walk you through this, ask Claude Code in this repo: **"set up my board routine"**. It uses the `board-routine-setup` skill, checks each step, and tells you when it needs you to paste a secret. An agent can guide, check and verify, but it cannot create the API trigger or paste secrets for you (see "What only you can do").

## Who needs what

| Item | Each person? | Where it lives |
|---|---|---|
| A routine (their own) | Yes | claude.ai (their account) |
| Routine trigger URL + token | Yes, one per routine | Their browser (board Settings → Agents); also held by cron-job.org for the minute or two a send takes |
| `BOARD_TOKEN` (GitHub token, Contents read/write on this repo) | Yes, their own | The routine's cloud environment on claude.ai (never in the repo) |
| cron-job.org API key | One per cron-job.org account. Each person can have their own free account (simplest), or share one key | Their browser (board Settings → Agents) |
| GitHub token for the web board | Yes (already done) | Their browser (board Settings → Connection) |

Nothing secret is ever committed to this repo. "Copy settings code" on the board moves your browser's values to your phone or another browser.

## Let Claude set it up for you
You can ask Claude (Claude Code in this repo, the Claude desktop app, or claude.ai) to do the setup. In the board, open **Settings → Agents → tick Claude → Copy setup prompt for Claude** and paste it into a new chat. It points Claude at this guide and offers two modes: **guide me step by step**, or **do it in my browser** (Claude in Chrome or the built-in browser: you stay signed in, Claude does the clicking and the non-secret fields).

Whichever mode, Claude must never type, read back or store a secret. At each secret it stops, tells you where to click and what to paste, and waits. The secrets are the routine's trigger token, `BOARD_TOKEN`, and the cron-job.org key.

The same prompt, for pasting into any chat (replace the placeholders):

```
Please set up my Claude routine for the task board in <owner>/<repo>, so that typing @claude in a task comment starts it.

My GitHub username is <your-github-username>. The board repo is <owner>/<repo>.
Read these first:
- https://github.com/<owner>/<repo>/blob/master/board/ROUTINE-SETUP.md (the runbook)
- https://github.com/<owner>/<repo>/blob/master/board/routine-loader.txt (the short prompt to paste into the routine; it points at routine-prompt.md in the repo)
- https://github.com/<owner>/<repo>/blob/master/.claude/skills/board-routine-setup/SKILL.md (what you may and may not do)

Then ask me which mode I want:
A) Guide me: walk me through each step in order and check each one.
B) Do it for me in my browser: if you have a browser tool (Claude in Chrome or the built-in browser), open claude.ai/code/routines, GitHub's fine-grained token page and console.cron-job.org (I am already signed in) and do the clicking and the non-secret fields: routine name, the loader prompt from routine-loader.txt, the repository, a dedicated environment with Trusted network access, no connectors, and the API trigger.

Rules: never type, paste, read back or store a secret (routine trigger token, BOARD_TOKEN, cron-job.org API key). At each secret step, stop, tell me exactly where to click and what to paste, and wait until I say it is done. Remove all connectors from the routine. Finish by running the verification checklist and the first test from the runbook and tell me what passed and failed.
```

## What only you can do
- Create the routine's **API trigger** and generate its token (claude.ai web only; the CLI cannot).
- Create the **BOARD_TOKEN** value and paste it into the routine's environment.
- Create the **cron-job.org** account and API key, and paste the three values into the board's Settings → Agents.

## Steps

### 1. Create the routine (claude.ai/code/routines → New routine)
- **Name:** `Board assistant (<your name>)`.
- **Prompt:** paste the short **loader** from [`board/routine-loader.txt`](routine-loader.txt) (four lines). It tells the routine to read [`board/routine-prompt.md`](routine-prompt.md) from the repo on every run, so **you change the routine's behaviour by editing `routine-prompt.md` in GitHub, not by editing the routine**. The loader must mention the payload, otherwise the routine treats the board's request text as inert. Edits apply from the next run (the routine reads the default branch, `master`). Anyone who can write to this repo can change what the routine does, which is already true of the board itself; keep branch protection in mind if the repo audience grows.
- **Repository:** the board's repo (`<owner>/<repo>`). The board skill and the heartbeat hook are committed in this repo (`.claude/skills/board/`, `.claude/settings.json`), so a routine session picks them up from the clone. No plugin is needed.
- **Model:** Sonnet is plenty; choose Opus only if you ask for hard reasoning tasks.
- **Connectors:** remove all of them. The routine needs only the repo and the board; connectors let a run write to other services without asking.
- **Environment:** create a dedicated one (see "Which environment" below), not the shared Default.

### Which environment (and does it need open internet?)
Use a **dedicated environment** called `Board assistant (<your name>)` rather than Default:
- `BOARD_TOKEN` is an environment variable, and environment variables are visible to anyone who uses that environment. A private environment keeps it away from your other routines and sessions.
- You can tune its network access without affecting anything else.

What the routine's cloud session needs, and what the default **Trusted** network level gives it:

| Need | How it works | Trusted level enough? |
|---|---|---|
| Clone the repo, push `claude/` branches, open PRs | Anthropic's GitHub proxy, independent of the network level | Yes |
| `board.py` talking to the board (`api.github.com`) | Direct HTTPS from the session | Yes: `api.github.com` and `github.com` are on the default allowlist |
| Python for `board.py` | Python 3 is pre-installed in the image | Yes |
| `board.py` saving the board | The sandbox blocks GitHub API *writes*, so `board.py` saves by committing `tasks.json` and running `git push` to `master` from the clone (allowed). It does this automatically | Yes |
| Installing packages (pip/npm) | Package registries are on the allowlist | Yes |
| General web research (arbitrary sites) | Not on the allowlist, so shell/script requests to other sites fail with 403 `host_not_allowed` | **No**: use Custom (Trusted list plus the domains you need) or Full |

**Recommendation: start with Trusted.** It already covers everything the board needs. Switch to Custom or Full only when you want the routine to research the open web. Anthropic's docs do not say whether Claude's built-in web search and fetch tools are bound by this setting, so test it: ask the routine to look something up and read the run log. Be aware of the trade-off: with open internet, text a run reads (a board comment, a web page) could trick it into sending data out, and `BOARD_TOKEN` lives in that environment. If you widen access, keep the token's scope to this one repository, keep the expiry short, and keep connectors off.

### 2. Give the routine `BOARD_TOKEN`
Create a GitHub fine-grained token: owner `rain-ventures-ai`, only this repository, **Contents: Read and write** (add **Issues: Read and write** if you want issue-driven work), expiry 90 days. Put it in the routine's environment as `BOARD_TOKEN` (on Pro/Max use the environment's API-credentials section so it is not visible to others who use the environment). `board.py` uses it to read and write `tasks.json` over the GitHub API.

### 3. Add the API trigger
In the routine → Edit → **Add another trigger → API**. Save. Open the trigger modal, copy the **URL** (`https://api.anthropic.com/v1/claude_code/routines/trig_.../fire`) and click **Generate token**; copy it immediately (shown once). This token can start only this routine.

### 4. cron-job.org
Browsers cannot call a routine's URL directly (Anthropic's endpoint allows no cross-origin calls), but cron-job.org's API does. Create a free account at https://console.cron-job.org/, then Settings → API → enable → create a key. When you send something to Claude, the board creates a one-off job there that POSTs to your routine, reads the result, then deletes the job. cron-job.org sees your routine token and the task *number* (never the task's text) for about one to two minutes.

### 5. Board Settings → Agents
Tick **Claude** (the switch at the top of the tab), then paste the routine URL, routine token and cron-job.org key, Save, then **Test cron-job.org key**.

### 6. First run
1. **Test the routine's write access first.** In the routine page click **Run now** with text `Board request from @<you> for task #1. Run board.py comment '#1' "routine write test" and report whether it worked.` In the run log the comment command must say `commented on ...` (not `write failed: HTTP 403`). If it fails, fix `BOARD_TOKEN` (see Troubleshooting) before going further.
2. On the board, open any low-stakes task and comment: `@claude add a comment saying hello`, press Comment, choose **Send to Claude**.
3. Within one to two minutes the card shows a claude claim and a comment from claude appears. (If the card says "session started" without a link, the routine did start: open claude.ai/code/routines → your routine → recent runs.)

## How a send flows
Comment with `@claude` → confirm dialog → comment saved with a claim on the card → one-off cron-job.org job (runs at the next whole minute at least ~75 s away) → POST to your routine's `/fire` → the page records the session link and deletes the job → the routine claims the task, works, comments, assigns it back to you and marks it done.

## Troubleshooting
| Symptom | Likely cause |
|---|---|
| "To make @claude start your routine, set it up in Settings → Agents" | One of the three values is missing or the URL is malformed |
| "cron-job.org rejected the API key" | Key typed wrongly or revoked; free accounts allow about 100 API calls a day |
| Card shows "stuck: routine returned HTTP 401" | Routine token wrong or regenerated; generate a new one and update Settings |
| A write says `HTTP 403 ... not permitted through this proxy` | Claude's cloud sandbox lets the GitHub API read but blocks its writes. Not a token problem. `board.py` switches to saving with `git push` by itself; if you see this, the routine is running an old `board.py` or has `BOARD_WRITE=api` set |
| A write says `git push ... was refused` | The sandbox or branch protection would not let the routine push to `master`. Read the run log for the reason |
| Run starts, reads the board, but every write says `HTTP 403 Forbidden` (no mention of a proxy) | `BOARD_TOKEN` can read but not write: its **Contents** permission is Read-only. Edit the token (github.com/settings/personal-access-tokens → the token → Repository permissions → Contents: **Read and write**). The token value stays the same, so nothing to re-paste; for an organisation repo an owner may need to approve the change. Then Run now again |
| Reads fail too (`404` or `401`) | Token missing, expired, owner/repository not selected, or not approved by the organisation |
| Routine started but did nothing useful | The routine's saved prompt is not the loader, or the loader was edited so it no longer mentions the payload; paste `routine-loader.txt` again. To change behaviour, edit `routine-prompt.md` |
| Card claim goes stale after 30 minutes | The routine ended without `done`; open the session link to see why, then Release claim |

Keep keys in the board's Settings only. If a key or token is ever pasted into chat or committed, revoke and regenerate it.
