#!/usr/bin/env python3
"""Agent-side CLI for the task board in this repo (board/tasks.json). Standard library only. Part of the board kit:
the source of this file is rain-ventures-ai/co-assets board/kit/; do not edit it in a board repo (see board/UPGRADING.md).

Works against GitHub using your existing `gh` login (no token handling here), or against a
local file with --file for testing. Every write re-reads the latest file and retries on a
SHA conflict, so a human editing the board in the browser never gets overwritten.

  board.py list [--column todo] [--assignee osouthgate] [--unclaimed] [--attention]
  board.py show ID
  board.py next --for osouthgate --agent claude --session ABC     # claim the first claimable todo task
  board.py claim ID --for osouthgate --agent claude --session ABC [--note ...] [--force]
  board.py heartbeat ID [--note ...] [--status running|blocked|stuck]
  board.py release ID [--column todo]
  board.py done ID [--note ...]
  board.py add "Title" [--assign osouthgate] [--label x] [--due 2026-10-20] [--client "Hurst College"] [--details ...] [--todo "step 1" --todo "step 2"]
  board.py todo-add ID "text"      # add a checklist item
  board.py todo-done ID N          # tick item N (1-based, as shown by `show`); todo-undo / todo-rm work the same way
  board.py history ID              # print the card's history log
  board.py comment ID "text"       # post a comment on the card (questions, updates, hand-offs for people and agents)
  board.py comments ID             # print the whole comment stream
  board.py move ID COLUMN [--note ...]          # change status (column id, e.g. todo, in-progress, done)
  board.py assign ID USER [USER...] [--add|--remove] [--note ...]   # hand the task to people (replaces assignees unless --add/--remove)
  board.py link ID URL [--title ...]            # attach a link, e.g. the pull request
  ID may also be a task number: '#12' (quote the # in a shell).

ID may be any unique prefix. Defaults: BOARD_REPO, BOARD_BRANCH, BOARD_PATH, BOARD_AGENT, BOARD_USER,
BOARD_SESSION (or CLAUDE_SESSION_ID / CODEX_SESSION_ID).

Auth: uses the `gh` CLI if it is installed and BOARD_TOKEN is not set. Otherwise (cloud sandboxes, CI) it
calls the GitHub API directly with a fine-grained token from BOARD_TOKEN, GH_TOKEN or GITHUB_TOKEN
(Contents: Read and write on this repo).

Claude's cloud sandbox (routines, Claude Code on the web) lets the GitHub API read but blocks its writes. When a
write is refused that way, board.py saves instead by committing tasks.json and running `git push` from the clone it
lives in (the sandbox allows git pushes). BOARD_WRITE=git forces that; BOARD_WRITE=api turns it off.

  board.py auto-heartbeat      # for a hook: refreshes your active claim at most every 5 minutes, silent no-op otherwise

Board kit (shared tools, kept in one place and copied into each board repo):
  board.py kit-check [--card]  # is this repo's kit older than the published one? --card adds an upgrade task for the upgrade owner
  board.py kit-update [--from DIR]   # copy the published kit into this repo and set board/KIT_VERSION (does not commit)
  board.py migrate             # bring tasks.json up to the schema this board.py knows (safe to run twice)
  board.py kit-owner [USER]    # show or set whose Claude does kit upgrades on this board (settings.kit_owner)
"""
import argparse, base64, contextlib, datetime as dt, io, json, os, re, shutil, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def repo_from_git():
    """owner/name of this clone's origin, so the same board.py works in every board repo."""
    p = subprocess.run(["git", "-C", ROOT, "remote", "get-url", "origin"], capture_output=True, text=True)
    m = re.search(r"github\.com[:/]+([\w.-]+/[\w.-]+?)(?:\.git)?/?$", p.stdout.strip()) if p.returncode == 0 else None
    return m.group(1) if m else ""


REPO = os.environ.get("BOARD_REPO") or repo_from_git()
SCHEMA = 2  # the tasks.json version this board.py understands; newer files are read-only here (run kit-update)
KIT_URL = os.environ.get("BOARD_KIT_URL", "https://raw.githubusercontent.com/rain-ventures-ai/co-assets/master/board/kit")
KIT_GIT = "https://github.com/rain-ventures-ai/co-assets"
BRANCH = os.environ.get("BOARD_BRANCH", "master")
PATH = os.environ.get("BOARD_PATH", "board/tasks.json")
FILE = None  # set by --file
WRITE = os.environ.get("BOARD_WRITE", "auto").lower()  # auto | api | git (auto switches to git when the sandbox blocks API writes)


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def parse(ts):
    return dt.datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)


CLAIM_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".board-claim.json")  # local, gitignored
HEARTBEAT_EVERY = 300  # seconds between automatic heartbeats


def token():
    return os.environ.get("BOARD_TOKEN") or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""


def use_http():
    """Direct API when BOARD_TOKEN is set explicitly, or when gh is not installed (then any of the token vars)."""
    return bool(os.environ.get("BOARD_TOKEN")) or not shutil.which("gh")


def http(method, path, body=None):
    t = token()
    if not t:
        sys.exit("no GitHub auth: install and log in to `gh`, or set BOARD_TOKEN (fine-grained token, Contents read/write on the repo)")
    req = urllib.request.Request(os.environ.get("BOARD_API", "https://api.github.com").rstrip("/") + "/" + path.lstrip("/"), method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {t}", "Accept": "application/vnd.github+json",
                                          "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "board-cli",
                                          **({"Content-Type": "application/json"} if body is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return 0, r.read().decode(), ""
    except urllib.error.HTTPError as e:
        return 1, e.read().decode(errors="replace"), f"HTTP {e.code}: {e.reason}"
    except (urllib.error.URLError, OSError) as e:
        return 1, "", f"network error: {e}"


def gh(*args, body=None):
    """gh-api-style call: gh("repos/x/contents/y?ref=b") or gh("-X", "PUT", "repos/x/contents/y", "--input", "-", body=...)."""
    if use_http():
        method, path, rest = "GET", None, list(args)
        if rest[:1] == ["-X"]:
            method, rest = rest[1], rest[2:]
        path = rest[0]
        if path == "user" and "--jq" in rest:
            rc, out, err = http("GET", "user")
            return (rc, json.loads(out).get("login", "") if rc == 0 else out, err)
        return http(method, path, body)
    p = subprocess.run(["gh", "api", *args], input=json.dumps(body) if body is not None else None,
                       capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def assign_nums(data):
    """Task numbers (#12): stable and never reused. Same rule as the web page: unnumbered tasks get the next
    numbers in creation order, so concurrent writers converge instead of colliding."""
    tasks = data.get("tasks", [])
    mx = max([t["num"] for t in tasks if isinstance(t.get("num"), int)] or [0])
    nxt = max(data["next_num"] if isinstance(data.get("next_num"), int) else 1, mx + 1)
    for _, t in sorted(((i, t) for i, t in enumerate(tasks) if not isinstance(t.get("num"), int)),
                       key=lambda p: (p[1].get("created") or "", p[0])):
        t["num"] = nxt
        nxt += 1
    data["next_num"] = nxt
    return data


# ---- git transport: commit tasks.json on top of the remote branch and push it, without touching the working tree


def git(*args, inp=None, env=None):
    p = subprocess.run(["git", "-C", ROOT, *args], input=inp, capture_output=True, text=True,
                       env={**os.environ, **(env or {})})
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def git_load():
    rc, url, _ = git("remote", "get-url", "origin")
    if rc or REPO.lower() not in url.lower().removesuffix(".git"):
        sys.exit(f"cannot save with git: {ROOT} is not a clone of {REPO} (origin is {url or 'missing'})")
    rc, _, err = git("fetch", "-q", "origin", BRANCH)
    if rc:
        sys.exit(f"cannot fetch {REPO}@{BRANCH} with git: {err}")
    rc, parent, _ = git("rev-parse", "FETCH_HEAD")
    rc2, raw, err = git("show", f"{parent}:{PATH}")
    if rc or rc2:
        sys.exit(f"cannot read {PATH} from {REPO}@{BRANCH} with git: {err}")
    return assign_nums(json.loads(raw)), parent


def git_save(text, parent, message):
    """Commit the new file on top of `parent` and push it as a fast-forward; False when someone else got there first."""
    _, blob, _ = git("hash-object", "-w", "--stdin", inp=text)
    fd, idx = tempfile.mkstemp(prefix="board-index-")
    os.close(fd)
    os.remove(idx)  # git creates the index file itself
    try:
        e = {"GIT_INDEX_FILE": idx}
        for args in (("read-tree", parent), ("update-index", "--add", "--cacheinfo", f"100644,{blob},{PATH}")):
            rc, _, err = git(*args, env=e)
            if rc:
                sys.exit(f"write failed (git {args[0]}): {err}")
        _, tree, _ = git("write-tree", env=e)
    finally:
        if os.path.exists(idx):
            os.remove(idx)
    name = who_am_i()
    ident = {"GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": "board@users.noreply.github.com",
             "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": "board@users.noreply.github.com"}
    rc, commit, err = git("commit-tree", tree, "-p", parent, "-m", message, env=ident)
    if rc:
        sys.exit(f"write failed (git commit-tree): {err}")
    rc, _, err = git("push", "-q", "origin", f"{commit}:refs/heads/{BRANCH}")
    if rc == 0:
        return True
    if "non-fast-forward" in err or "fetch first" in err or "rejected" in err:
        return False
    sys.exit(f"write failed: git push to {REPO}@{BRANCH} was refused: {err}")


def load():
    if not REPO and not FILE:
        sys.exit("cannot tell which repo this board is in: run board.py from a clone of the board repo, or set BOARD_REPO=owner/name")
    if FILE:
        raw = open(FILE, "rb").read()
        return assign_nums(json.loads(raw)), None
    if WRITE == "git":
        return git_load()
    rc, out, err = gh(f"repos/{REPO}/contents/{PATH}?ref={BRANCH}")
    if rc:
        sys.exit(f"cannot read {PATH} from {REPO}@{BRANCH}: {err.strip() or out.strip()}")
    d = json.loads(out)
    return assign_nums(json.loads(base64.b64decode(d["content"]))), d["sha"]


def save(data, sha, message):
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    if FILE:
        open(FILE, "w").write(text)
        return True
    if WRITE == "git":
        return git_save(text, sha, message)
    body = {"message": message, "branch": BRANCH, "sha": sha,
            "content": base64.b64encode(text.encode()).decode()}
    rc, out, err = gh("-X", "PUT", f"repos/{REPO}/contents/{PATH}", "--input", "-", body=body)
    if rc == 0:
        return True
    if "409" in err or "422" in err or "does not match" in err:
        return False
    try:
        gh_msg = json.loads(out).get("message", "")
    except (ValueError, AttributeError):
        gh_msg = ""
    detail = (err.strip() + (f" ({gh_msg})" if gh_msg else "")) or out.strip()
    if "403" in err and "proxy" in gh_msg.lower():
        # Claude's cloud sandbox: the GitHub API is read-only from here, git pushes are allowed. Not a token problem.
        if WRITE == "auto":
            raise UseGit()
        sys.exit(f"write failed: {detail}\nThis is Claude's cloud sandbox blocking GitHub API writes, not your token. "
                 "Unset BOARD_WRITE (or set it to git) so board.py saves with git push instead.")
    hint = ""
    if "403" in err or "404" in err:
        hint = (f"\nThe token can read this repo but cannot write it. It needs Contents: Read and write on {REPO} "
                "(fine-grained token: github.com/settings/personal-access-tokens, edit the token's repository permissions; the "
                "token value does not change). If the repo belongs to an organisation, an owner may need to approve the change. "
                "A person or agent cannot fix this from the board: tell a human.")
    sys.exit(f"write failed: {detail}{hint}")


class UseGit(Exception):
    """The API refused the write because of the sandbox proxy: switch to the git transport and retry."""


def mutate(fn, message):
    """Apply fn(data) to the latest file; retry on SHA conflict. fn may raise SystemExit to abort."""
    global WRITE
    for attempt in range(6):
        data, sha = load()
        guard_schema(data)
        migrate_data(data)  # an older file is brought up to SCHEMA by the first write (the web board does the same)
        out = io.StringIO()  # fn's messages are printed only once the save has worked, so a retry does not repeat them
        with contextlib.redirect_stdout(out):
            result = fn(data)
        assign_nums(data)
        try:
            ok = save(data, sha, message)
        except UseGit:
            WRITE = "git"  # re-read through git and apply the change again
            continue
        if ok:
            print(out.getvalue(), end="")
            return result
        time.sleep(0.4 * (attempt + 1))
    sys.exit("could not save after retries (board busy)")


def guard_schema(data):
    v = data.get("version", 1)
    if isinstance(v, int) and v > SCHEMA:
        sys.exit(f"tasks.json is schema v{v}, but this board.py only knows v{SCHEMA}, so it will not write (it could lose data).\n"
                 "Update the board tools first: python3 board/board.py kit-update (see board/UPGRADING.md).")


# Data migrations: MIGRATIONS[n] turns a schema-n file into schema n+1. Each step must be safe to run twice.
MIGRATIONS = {
    1: lambda d: d,  # v1 -> v2: the web board and board.py already read v1 cards; only the version number changes
}


def migrate_data(data):
    v = data.get("version", 1) if isinstance(data.get("version", 1), int) else 1
    steps = []
    while v < SCHEMA:
        MIGRATIONS[v](data); v += 1; data["version"] = v; steps.append(v)
    return steps


def who_am_i(t=None):
    c = (t or {}).get("claim") or {}
    user = os.environ.get("BOARD_USER", "")
    agent = os.environ.get("BOARD_AGENT", "") or c.get("agent", "")
    return f"{agent}@{user}" if agent and user else (agent or user or "cli")


def hist(t, text, who=None):
    h = t.setdefault("history", [])
    h.append({"at": now(), "by": who or who_am_i(t), "text": text})
    if len(h) > 200:
        del h[: len(h) - 200]


def find(data, tid):
    ref = tid.lstrip("#")
    if ref.isdigit():
        m = [t for t in data["tasks"] if t.get("num") == int(ref)]
        if len(m) == 1:
            return m[0]
        sys.exit(f"no task #{ref}")
    m = [t for t in data["tasks"] if t["id"] == tid] or [t for t in data["tasks"] if t["id"].startswith(tid)]
    if len(m) != 1:
        sys.exit(f"task '{tid}' not found" if not m else f"'{tid}' is ambiguous: " + ", ".join(t["id"] for t in m))
    return m[0]


def claim_state(data, c):
    if not c:
        return None
    if c.get("status") in ("done", "stuck", "blocked"):
        return c["status"]
    last = parse(c.get("heartbeat_at") or c["claimed_at"])
    mins = (dt.datetime.now(dt.timezone.utc) - last).total_seconds() / 60
    return "stale" if mins > data.get("settings", {}).get("stale_after_minutes", 30) else "running"


def git_branch():
    p = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ""


def default_user():
    if os.environ.get("BOARD_USER"):
        return os.environ["BOARD_USER"]
    rc, out, _ = gh("user", "--jq", ".login")
    return out.strip() if rc == 0 else ""


def session_id(args):
    return args.session or os.environ.get("BOARD_SESSION") or os.environ.get("CLAUDE_SESSION_ID") \
        or os.environ.get("CODEX_SESSION_ID") or uuid.uuid4().hex[:8]


def line(data, t):
    cs = claim_state(data, t.get("claim"))
    who = ",".join("@" + a for a in t.get("assignees", [])) or "-"
    cl = f"  [{t['claim']['agent']}:{cs}]" if t.get("claim") else ""
    td = t.get("todos") or []
    pr = f"  [{sum(1 for d in td if d.get('done'))}/{len(td)}]" if td else ""
    cm = f"  \U0001F4AC{len(t['comments'])}" if t.get("comments") else ""
    return f"#{t.get('num', '?'):<4}{t['id']}  {t['column']:<11} {who:<22} {t['title']}{pr}{cm}{cl}"


def cmd_list(a):
    data, _ = load()
    for t in data["tasks"]:
        if a.column and t["column"] != a.column: continue
        if a.assignee and a.assignee.lower() not in [x.lower() for x in t.get("assignees", [])]: continue
        if a.unclaimed and claim_state(data, t.get("claim")) in ("running", "blocked", "stuck"): continue
        if a.attention and claim_state(data, t.get("claim")) not in ("stale", "stuck", "blocked"): continue
        print(line(data, t))


def cmd_show(a):
    data, _ = load()
    t = find(data, a.id)
    t = dict(t); t["_claim_state"] = claim_state(data, t.get("claim"))
    hs = t.pop("history", []); cms = t.pop("comments", [])
    print(json.dumps(t, indent=2, ensure_ascii=False))
    if t.get("todos"):
        print("\nto-dos:")
        for i, d in enumerate(t["todos"], 1): print(f"  {i}. [{'x' if d.get('done') else ' '}] {d['text']}")
    if cms:
        print(f"\ncomments (last 5 of {len(cms)}; `board.py comments ID` for all):")
        for c in cms[-5:]: print(f"  [{c['at'][:16]}] {c.get('by', '?')}: {c['text']}")
    if hs:
        print(f"\nhistory (last 5 of {len(hs)}):")
        for h in hs[-5:]: print(f"  {h['at'][:16]}  {h.get('by', '?')}: {h['text']}")


def cloud_session_url():
    """The claude.ai link of this run when board.py runs inside a Claude cloud session (routines, Claude Code on the web)."""
    v = os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID", "")
    tail = v.split("_", 1)[1] if "_" in v else v
    return f"https://claude.ai/code/session_{tail}" if tail.isalnum() else ""


def do_claim(a, tid, data):
    t = find(data, tid)
    user = a.for_user or default_user()
    agent = a.agent or os.environ.get("BOARD_AGENT") or "agent"
    sid = session_id(a)
    if not a.force and user and user.lower() not in [x.lower() for x in t.get("assignees", [])]:
        sys.exit(f"refused: task is assigned to {t.get('assignees') or 'nobody'}, not @{user} (use --force to override)")
    cs = claim_state(data, t.get("claim"))
    if t.get("claim") and cs in ("running", "blocked", "stuck") and t["claim"].get("session_id") != sid and not a.force:
        c = t["claim"]
        sys.exit(f"refused: already claimed by {c['agent']} session {c.get('session_id')} ({cs}, last beat {c.get('heartbeat_at')})")
    ts = now()
    old = t.get("claim") or {}
    # keep a link the board already found for this run (it sends the routine, then the routine re-claims with --force)
    keep = old.get("session_url", "") if old.get("agent") == agent and old.get("on_behalf_of") == user else ""
    url = a.session_url or cloud_session_url() or keep
    t["claim"] = {"agent": agent, "on_behalf_of": user, "session_id": sid, "session_url": url,
                  "host": socket.gethostname(), "cwd": os.getcwd(), "branch": git_branch(),
                  "status": "running", "note": a.note or "", "claimed_at": ts, "heartbeat_at": ts}
    if t["column"] != "in-progress":
        t["column"] = "in-progress"
    t["updated"] = ts; t["updatedBy"] = f"{agent}@{user}"
    hist(t, "claimed" + (f": {a.note}" if a.note else ""), f"{agent}@{user}")
    print(f"claimed {t['id']}: {t['title']}  (session {sid})")
    if not FILE:
        try:
            json.dump({"id": t["id"], "agent": agent, "user": user, "session": sid}, open(CLAIM_FILE, "w"))
        except OSError:
            pass
    return t["id"]


def cmd_claim(a):
    mutate(lambda d: do_claim(a, a.id, d), f"Agent claim: {a.id}")


def cmd_next(a):
    def fn(data):
        user = a.for_user or default_user()
        for t in data["tasks"]:
            if t["column"] in ("todo",) and user.lower() in [x.lower() for x in t.get("assignees", [])] \
                    and claim_state(data, t.get("claim")) in (None, "done", "stale"):
                return do_claim(a, t["id"], data)
        sys.exit(f"nothing claimable in 'todo' for @{user}")
    mutate(fn, "Agent claim: next task")


def must_claim(t):
    if not t.get("claim"):
        sys.exit("task has no claim; run 'claim' first")
    return t["claim"]


def cmd_heartbeat(a):
    def fn(data):
        t = find(data, a.id); c = must_claim(t)
        c["heartbeat_at"] = now()
        if a.status and a.status != c.get("status"): hist(t, f"status {a.status}" + (f": {a.note}" if a.note else ""))
        elif a.note is not None and a.note != c.get("note"): hist(t, f"progress: {a.note}")
        if a.note is not None: c["note"] = a.note
        if a.status: c["status"] = a.status
        t["updated"] = now(); print(f"heartbeat {t['id']} ({c['status']})")
    mutate(fn, f"Agent heartbeat: {a.id}")


def drop_claim_file():
    try:
        os.remove(CLAIM_FILE)
    except OSError:
        pass


def cmd_release(a):
    def fn(data):
        t = find(data, a.id); hist(t, "released" + (f" to {a.column}" if a.column else "")); t["claim"] = None; drop_claim_file()
        if a.column: t["column"] = a.column
        t["updated"] = now(); print(f"released {t['id']} -> {t['column']}")
    mutate(fn, f"Agent release: {a.id}")


def cmd_done(a):
    def fn(data):
        t = find(data, a.id)
        c = t.get("claim")
        if c:  # the claim banner goes away; the card keeps a one-line record of the run, with its link
            t["last_run"] = {"agent": c.get("agent", ""), "on_behalf_of": c.get("on_behalf_of", ""), "session_id": c.get("session_id", ""),
                             "session_url": c.get("session_url", ""), "started_at": c.get("claimed_at", ""), "finished_at": now(),
                             "note": a.note or c.get("note", "")}
            t["claim"] = None
        link = (c or {}).get("session_url", "")
        hist(t, "done" + (f": {a.note}" if a.note else "") + (f" (session {link})" if link else "")); t["column"] = "done"; t["updated"] = now(); drop_claim_file(); print(f"done {t['id']}: {t['title']}")
    mutate(fn, f"Agent done: {a.id}")


def cmd_move(a):
    def fn(data):
        t = find(data, a.id)
        cols = [c["id"] for c in data.get("columns", [])]
        if a.column not in cols:
            sys.exit(f"unknown column '{a.column}'. Columns: {', '.join(cols)}")
        old = t["column"]; t["column"] = a.column
        hist(t, f"moved {old} -> {a.column}" + (f": {a.note}" if a.note else "")); t["updated"] = now()
        print(f"#{t['num']} {t['title']}: {old} -> {a.column}")
    mutate(fn, f"Agent move: {a.id}")


def cmd_assign(a):
    """Hand a task to people (replaces the assignees), or --add / --remove individual people."""
    def fn(data):
        t = find(data, a.id)
        known = {p["github"].lower(): p["github"] for p in data.get("people", [])}
        users = [known.get(u.lstrip("@").lower()) or sys.exit(f"unknown person '{u}'. People: {', '.join(known.values())}") for u in a.users]
        cur = list(t.get("assignees", []))
        if a.add: new = cur + [u for u in users if u not in cur]
        elif a.remove: new = [u for u in cur if u not in users]
        else: new = users
        t["assignees"] = new; t["updated"] = now()
        hist(t, "assigned to " + (", ".join("@" + u for u in new) or "nobody") + (f": {a.note}" if a.note else ""))
        print(f"#{t['num']} assignees: {', '.join(new) or '-'}")
    mutate(fn, f"Agent assign: {a.id}")


def cmd_link(a):
    def fn(data):
        t = find(data, a.id)
        if not a.url.startswith(("http://", "https://")): sys.exit("url must be http(s)")
        links = t.setdefault("links", [])
        if not any(l.get("url") == a.url for l in links): links.append({"title": a.title or a.url, "url": a.url})
        hist(t, f"linked {a.title or a.url}"); t["updated"] = now(); print(f"#{t['num']} linked {a.url}")
    mutate(fn, f"Agent link: {a.id}")


def todo_at(t, n):
    todos = t.setdefault("todos", [])
    if not (n.isdigit() and 1 <= int(n) <= len(todos)):
        sys.exit(f"no to-do #{n} on {t['id']} (it has {len(todos)}); numbers come from `show`")
    return todos[int(n) - 1]


def cmd_todo_add(a):
    def fn(data):
        t = find(data, a.id); t.setdefault("todos", []).append({"id": "d_" + uuid.uuid4().hex[:6], "text": a.text, "done": False})
        hist(t, f"added to-do: {a.text}"); t["updated"] = now(); print(f"added to-do #{len(t['todos'])} to {t['id']}")
    mutate(fn, f"Add to-do: {a.id}")


def cmd_todo_set(a, done):
    def fn(data):
        t = find(data, a.id); d = todo_at(t, a.n)
        if bool(d.get("done")) == done:
            print(f"to-do #{a.n} already {'done' if done else 'open'}"); return
        d["done"] = done
        if done: d["doneBy"] = who_am_i(t); d["doneAt"] = now()
        else: d.pop("doneBy", None); d.pop("doneAt", None)
        hist(t, ("✓ " if done else "reopened: ") + d["text"]); t["updated"] = now()
        print(f"to-do #{a.n} {'done' if done else 'reopened'}: {d['text']}  ({sum(1 for x in t['todos'] if x.get('done'))}/{len(t['todos'])})")
    mutate(fn, f"To-do {'done' if done else 'reopened'}: {a.id}")


def cmd_todo_rm(a):
    def fn(data):
        t = find(data, a.id); d = todo_at(t, a.n); t["todos"].remove(d)
        hist(t, f"removed to-do: {d['text']}"); t["updated"] = now(); print(f"removed to-do: {d['text']}")
    mutate(fn, f"Remove to-do: {a.id}")


def cmd_comment(a):
    def fn(data):
        t = find(data, a.id)
        t.setdefault("comments", []).append({"id": "c_" + uuid.uuid4().hex[:6], "at": now(), "by": who_am_i(t), "text": a.text})
        t["updated"] = now(); print(f"commented on {t['id']} ({len(t['comments'])} total)")
    mutate(fn, f"Comment: {a.id}")


def cmd_comments(a):
    data, _ = load(); t = find(data, a.id)
    for c in t.get("comments", []):
        print(f"[{c['at'][:16]}] {c.get('by', '?')}: {c['text']}")
    if not t.get("comments"): print("(no comments)")


def cmd_history(a):
    data, _ = load(); t = find(data, a.id)
    for h in t.get("history", []):
        print(f"{h['at'][:19]}  {h.get('by', '?'):<22} {h['text']}")


def cmd_auto_heartbeat(a):
    """Hook entry point. Never fails loudly: a hook must not break the agent's session."""
    try:
        st = os.stat(CLAIM_FILE)
        if time.time() - st.st_mtime < HEARTBEAT_EVERY:
            return
        info = json.load(open(CLAIM_FILE))
        os.utime(CLAIM_FILE)  # throttle even if the network call fails

        def fn(data):
            t = find(data, info["id"]); c = t.get("claim")
            if not c or c.get("status") == "done" or c.get("session_id") != info.get("session"):
                drop_claim_file(); return  # released, finished, or taken over by another session
            c["heartbeat_at"] = now(); t["updated"] = now()
        mutate(fn, f"Agent heartbeat: {info['id']}")
    except BaseException:
        return


def cmd_add(a):
    def fn(data):
        t = {"id": "t_" + uuid.uuid4().hex[:8], "title": a.title, "column": a.column or "todo",
             "client": a.client or "", "priority": a.priority, "due": a.due or "",
             "labels": a.label or [], "assignees": a.assign or [], "details": a.details or "", "links": [],
             "contacts": [], "todos": [{"id": "d_" + uuid.uuid4().hex[:6], "text": x, "done": False} for x in (a.todo or [])],
             "history": [], "comments": [], "claim": None, "created": now(), "updated": now()}
        hist(t, "created")
        data["tasks"].append(t); assign_nums(data); print(f"added #{t['num']} ({t['id']})")
    mutate(fn, f"Add task: {a.title}")


# ---- board kit: the shared tools live in co-assets board/kit and are copied into each board repo -------------
class KitError(Exception):
    """The published kit could not be read (offline, blocked, or not published yet)."""


def kit_fetch(name, src=None):
    if src:
        try:
            return open(os.path.join(src, name), "rb").read()
        except OSError as e:
            raise KitError(f"cannot read {name} from the kit: {e}")
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{KIT_URL}/{name}", headers={"User-Agent": "board-cli"}), timeout=30) as r:
            return r.read()
    except (urllib.error.URLError, OSError):
        return kit_fetch(name, kit_clone())


_KIT_DIR = None


def kit_clone():
    """Fallback when raw.githubusercontent.com is blocked: a shallow git clone of co-assets (public, no token)."""
    global _KIT_DIR
    if not _KIT_DIR:
        d = tempfile.mkdtemp(prefix="board-kit-")
        p = subprocess.run(["git", "clone", "-q", "--depth", "1", KIT_GIT, d], capture_output=True, text=True)
        if p.returncode:
            raise KitError(f"cannot fetch the board kit from {KIT_URL} or {KIT_GIT}: {p.stderr.strip()}")
        _KIT_DIR = os.path.join(d, "board", "kit")
    return _KIT_DIR


def kit_local():
    try:
        return int(open(os.path.join(ROOT, "board", "KIT_VERSION")).read().strip() or 0)
    except (OSError, ValueError):
        return 0


def kit_owner(data):
    s = data.get("settings", {}).get("kit_owner")
    people = [p.get("github") for p in data.get("people", []) if p.get("github")]
    return s if s else (people[0] if people else "")


def cmd_kit_check(a):
    try:
        m = json.loads(kit_fetch("manifest.json", a.source))
    except (KitError, ValueError) as e:
        print(f"could not check the board kit ({e}); carry on"); return
    have, want = kit_local(), m["version"]
    if have >= want:
        print(f"board kit is current (v{have})"); return
    print(f"board kit is out of date: this repo has v{have}, the published kit is v{want}. "
          "Upgrade with the board-upgrade skill (.claude/skills/board-upgrade/SKILL.md, or board/UPGRADING.md in the kit).")
    if a.card:
        title = f"Upgrade board tools to kit v{want}"

        def fn(data):
            if any(t.get("title") == title and t.get("column") != "done" for t in data["tasks"]):
                print(f"an open card '{title}' already exists"); return
            owner = kit_owner(data)
            t = {"id": "t_" + uuid.uuid4().hex[:8], "title": title, "column": "todo", "client": "", "priority": "medium", "due": "",
                 "labels": ["board"] if any(l.get("name") == "board" for l in data.get("labels", [])) else [],
                 "assignees": [owner] if owner else [], "links": [{"title": "Upgrade notes", "url": f"{KIT_GIT}/blob/master/board/kit/UPGRADING.md"}],
                 "details": f"This repo's board tools are kit v{have}; the published kit is v{want}.\n\n"
                            f"@{owner or 'upgrade owner'}: comment `@claude upgrade the board kit` to start your routine. It follows "
                            ".claude/skills/board-upgrade/SKILL.md: copies the kit on a branch, runs the migrations, keeps this repo's own "
                            "files, checks the board and opens a pull request for you to merge.",
                 "contacts": [], "todos": [{"id": "d_" + uuid.uuid4().hex[:6], "text": x, "done": False} for x in
                                           ["Read UPGRADING.md for each version", "kit-update on a branch", "migrate", "Check repo-specific files",
                                            "Checks pass", "Open and link the PR"]],
                 "history": [], "comments": [], "claim": None, "created": now(), "updated": now()}
            hist(t, "created by kit-check")
            data["tasks"].append(t); assign_nums(data); print(f"added #{t['num']} for @{owner or '?'}: {title}")
        mutate(fn, f"Add task: Upgrade board tools to kit v{want}")
        return  # with --card the caller carries on with its own work
    sys.exit(3)


def cmd_kit_update(a):
    try:
        m = json.loads(kit_fetch("manifest.json", a.source))
        files = {dest: kit_fetch(src, a.source) for dest, src in m["files"].items()}  # fetch everything before writing anything
    except (KitError, ValueError) as e:
        sys.exit(f"kit-update stopped, nothing changed: {e}")
    have = kit_local()
    changed = []
    for dest, new in files.items():
        path = os.path.join(ROOT, dest)
        old = open(path, "rb").read() if os.path.exists(path) else None
        if old != new:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "wb").write(new); changed.append(dest)
    open(os.path.join(ROOT, "board", "KIT_VERSION"), "w").write(f"{m['version']}\n")
    print(f"board kit v{have} -> v{m['version']}; changed: " + (", ".join(changed) or "nothing"))
    print("Next: read board/UPGRADING.md for every version after v%d, run board.py migrate, check this repo's own files, commit on a branch." % have)


def cmd_migrate(a):
    def fn(data):
        print(f"migrated tasks.json to schema v{SCHEMA}")  # mutate() has already applied the steps
    data, _ = load(); guard_schema(data)
    if data.get("version", 1) == SCHEMA:
        print(f"tasks.json is already schema v{SCHEMA}: nothing to migrate"); return
    mutate(fn, f"Migrate tasks.json to schema v{SCHEMA}")


def cmd_kit_owner(a):
    if not a.user:
        data, _ = load(); print(kit_owner(data) or "(none)"); return
    u = a.user.lstrip("@")

    def fn(data):
        if u not in [p.get("github") for p in data.get("people", [])]:
            sys.exit(f"@{u} is not one of the board's people")
        data.setdefault("settings", {})["kit_owner"] = u; print(f"kit upgrades on this board go to @{u}")
    mutate(fn, f"Board kit owner: @{u}")


def main():
    global FILE
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", help="use a local tasks.json instead of GitHub (testing)")
    sub = p.add_subparsers(dest="cmd", required=True)

    def cl(sp):
        sp.add_argument("--for", dest="for_user"); sp.add_argument("--agent"); sp.add_argument("--session")
        sp.add_argument("--session-url"); sp.add_argument("--note"); sp.add_argument("--force", action="store_true")

    s = sub.add_parser("list"); s.add_argument("--column"); s.add_argument("--assignee")
    s.add_argument("--unclaimed", action="store_true"); s.add_argument("--attention", action="store_true"); s.set_defaults(f=cmd_list)
    s = sub.add_parser("show"); s.add_argument("id"); s.set_defaults(f=cmd_show)
    s = sub.add_parser("claim"); s.add_argument("id"); cl(s); s.set_defaults(f=cmd_claim)
    s = sub.add_parser("next"); cl(s); s.set_defaults(f=cmd_next)
    s = sub.add_parser("heartbeat"); s.add_argument("id"); s.add_argument("--note")
    s.add_argument("--status", choices=["running", "blocked", "stuck"]); s.set_defaults(f=cmd_heartbeat)
    s = sub.add_parser("release"); s.add_argument("id"); s.add_argument("--column"); s.set_defaults(f=cmd_release)
    s = sub.add_parser("done"); s.add_argument("id"); s.add_argument("--note"); s.set_defaults(f=cmd_done)
    s = sub.add_parser("auto-heartbeat"); s.set_defaults(f=cmd_auto_heartbeat)
    s = sub.add_parser("todo-add"); s.add_argument("id"); s.add_argument("text"); s.set_defaults(f=cmd_todo_add)
    s = sub.add_parser("todo-done"); s.add_argument("id"); s.add_argument("n"); s.set_defaults(f=lambda a: cmd_todo_set(a, True))
    s = sub.add_parser("todo-undo"); s.add_argument("id"); s.add_argument("n"); s.set_defaults(f=lambda a: cmd_todo_set(a, False))
    s = sub.add_parser("todo-rm"); s.add_argument("id"); s.add_argument("n"); s.set_defaults(f=cmd_todo_rm)
    s = sub.add_parser("move"); s.add_argument("id"); s.add_argument("column"); s.add_argument("--note"); s.set_defaults(f=cmd_move)
    s = sub.add_parser("assign"); s.add_argument("id"); s.add_argument("users", nargs="+"); s.add_argument("--add", action="store_true")
    s.add_argument("--remove", action="store_true"); s.add_argument("--note"); s.set_defaults(f=cmd_assign)
    s = sub.add_parser("link"); s.add_argument("id"); s.add_argument("url"); s.add_argument("--title"); s.set_defaults(f=cmd_link)
    s = sub.add_parser("history"); s.add_argument("id"); s.set_defaults(f=cmd_history)
    s = sub.add_parser("comment"); s.add_argument("id"); s.add_argument("text"); s.set_defaults(f=cmd_comment)
    s = sub.add_parser("comments"); s.add_argument("id"); s.set_defaults(f=cmd_comments)
    s = sub.add_parser("add"); s.add_argument("title"); s.add_argument("--column"); s.add_argument("--client")
    s.add_argument("--priority", default="medium", choices=["high", "medium", "low"]); s.add_argument("--due")
    s.add_argument("--assign", action="append"); s.add_argument("--label", action="append"); s.add_argument("--details")
    s.add_argument("--todo", action="append", help="initial checklist item (repeatable)")
    s.set_defaults(f=cmd_add)
    s = sub.add_parser("kit-check"); s.add_argument("--card", action="store_true"); s.add_argument("--from", dest="source"); s.set_defaults(f=cmd_kit_check)
    s = sub.add_parser("kit-update"); s.add_argument("--from", dest="source", help="a local kit folder instead of the published one (testing)")
    s.set_defaults(f=cmd_kit_update)
    s = sub.add_parser("migrate"); s.set_defaults(f=cmd_migrate)
    s = sub.add_parser("kit-owner"); s.add_argument("user", nargs="?"); s.set_defaults(f=cmd_kit_owner)
    a = p.parse_args()
    FILE = a.file
    a.f(a)


if __name__ == "__main__":
    main()
