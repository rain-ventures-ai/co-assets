"""The retired co-assets kit: notices, the deliberate kit-update stop, and the UPGRADING.md v4 move to keeptrack.

Run: python3 -m unittest discover -s tests
The move test needs keeptrack's kit: set KEEPTRACK_KIT to a local board/kit folder, or it clones
https://github.com/rain-ventures-ai/keeptrack (skipped when that is not possible).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
KIT = os.path.join(REPO, "board", "kit")
NOTICE = re.compile(r"Retired: moved to \[?rain-ventures-ai/keeptrack")


def read(path):
    with open(path) as f:
        return f.read()


def run(cwd, *args, ok=True):
    env = dict(os.environ, BOARD_USER="osouthgate", BOARD_AGENT="claude", BOARD_SESSION="abcd1234",
               BOARD_REPO="", BOARD_TOKEN="", GH_TOKEN="", GITHUB_TOKEN="")
    p = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, env=env)
    if ok and p.returncode:
        raise AssertionError(f"{' '.join(args)} failed ({p.returncode}):\n{p.stdout}\n{p.stderr}")
    return p


def git(cwd, *args):
    return run(cwd, "git", "-c", "user.email=test@example.com", "-c", "user.name=test", *args)


UPGRADE_TODOS = ["Read UPGRADING.md v4 (retired)", "kit-update from a keeptrack clone on a branch",
         "Switch to keeptrack.py and update .gitignore", "Checks pass", "Open and link the PR",
         "After the merge: migrate --to 4, verify, doctor"]
STOP_SOURCE = "moved-to/rain-ventures-ai/keeptrack/follow-co-assets-board-kit-UPGRADING.md-v4-retired"


def v4_section():
    text = read(os.path.join(KIT, "UPGRADING.md"))
    return text[text.index("### v4 (retired)"):text.index("### v3 (schema 2)")]


class V3Board:
    """A scratch board repo made by the v3 kit (the kit here with its manifest put back to v3)."""

    def __init__(self, tmp):
        self.v3kit = os.path.join(tmp, "v3kit")
        shutil.copytree(KIT, self.v3kit)
        mpath = os.path.join(self.v3kit, "manifest.json")
        m = json.loads(read(mpath))
        m["version"] = 3; m.pop("moved", None)
        m["files"] = {d: s for d, s in m["files"].items() if not s.startswith("moved-to/")}
        with open(mpath, "w") as f:
            json.dump(m, f, indent=2)
        self.root = os.path.join(tmp, "board-repo")
        os.makedirs(os.path.join(self.root, "board"))
        git(self.root, "init", "-q", "-b", "master")
        git(self.root, "remote", "add", "origin", "https://github.com/example/scratch-board.git")
        shutil.copy(os.path.join(self.v3kit, "board.py"), os.path.join(self.root, "board", "board.py"))
        run(self.root, sys.executable, "board/board.py", "init", "--from", self.v3kit, "--person", "osouthgate:Oliver")
        ff = ["--file", "board/tasks.json"]
        run(self.root, sys.executable, "board/board.py", *ff, "add", "Card one", "--assign", "osouthgate", "--details", "hello")
        run(self.root, sys.executable, "board/board.py", *ff, "add", "Card two", "--assign", "osouthgate")
        run(self.root, sys.executable, "board/board.py", *ff, "comment", "#1", "a comment")
        git(self.root, "add", "-A"); git(self.root, "commit", "-qm", "v3 board")

    def read(self, path):
        return read(os.path.join(self.root, path))


class RetiredNotices(unittest.TestCase):
    def test_every_entry_doc_says_retired(self):
        for name in ["README.md", "board/kit/README.md", "board/kit/PLUGIN.md", "board/kit/UPGRADING.md",
                     "board/kit/NEW-BOARD.md", "board/kit/ROUTINE-SETUP.md", "board/kit/routine-prompt.md",
                     "board/kit/skills/board/SKILL.md"]:
            head = "".join(read(os.path.join(REPO, name)).splitlines(True)[:8])
            self.assertRegex(head, NOTICE, name)

    def test_plugin_says_retired_and_names_no_live_board(self):
        plugin = json.loads(read(os.path.join(KIT, ".claude-plugin", "plugin.json")))
        market = json.loads(read(os.path.join(REPO, ".claude-plugin", "marketplace.json")))
        for desc in [plugin["description"], market["plugins"][0]["description"]]:
            self.assertTrue(desc.startswith("Retired: moved to rain-ventures-ai/keeptrack."), desc)
        skill = read(os.path.join(KIT, "skills", "board", "SKILL.md"))
        self.assertIn("keeptrack.py", skill)
        for board in ["rain-ventures-ai/consulting", "osouthgate/private-tasks"]:
            self.assertNotIn(board, skill)

    def test_stop_entry_comes_first(self):
        files = list(json.loads(read(os.path.join(KIT, "manifest.json")))["files"].values())
        self.assertEqual(files[0], STOP_SOURCE)

    def test_new_board_docs_point_to_keeptrack_init(self):
        for name in ["NEW-BOARD.md", "ROUTINE-SETUP.md", "routine-prompt.md"]:
            head = "".join(read(os.path.join(KIT, name)).splitlines(True)[:8])
            self.assertIn("keeptrack.py init", head, name)
            self.assertIn("NEW-BOARD.md", head, name)

    def test_web_upgrade_card_points_at_v4_steps(self):
        js = read(os.path.join(REPO, "board", "board.js"))
        body = js[js.index("function renderKitBar"):js.index("async function diagnose404")]
        self.assertIn("UPGRADING.md#v4-retired", body)
        self.assertIn('"v4 (retired)" steps', body)
        self.assertIn("### v4 (retired)", read(os.path.join(KIT, "UPGRADING.md")))
        todos = re.search(r"todos: \[([^\]]*)\]\.map", body).group(1)
        self.assertEqual(json.loads("[" + todos.replace("'", '"') + "]"), UPGRADE_TODOS)

    def test_routine_prompt_sends_the_kit_upgrade_to_v4_steps(self):
        text = read(os.path.join(KIT, "routine-prompt.md"))
        line = text[text.index("If your task is the kit upgrade"):].split("\n- ")[0]
        self.assertIn("UPGRADING.md#v4-retired", line)
        self.assertIn("not `.claude/skills/board-upgrade/SKILL.md`", line)

    def test_upgrade_owner_section_sends_the_routine_to_v4_steps(self):
        text = read(os.path.join(KIT, "UPGRADING.md"))
        line = [x for x in text.splitlines() if "comments `@claude upgrade the board kit`" in x][0]
        self.assertIn('from v4 on it follows the "v4 (retired)" steps below instead', line)

    def test_stop_source_names_the_v4_steps(self):
        m = json.loads(read(os.path.join(KIT, "manifest.json")))
        self.assertIn(STOP_SOURCE, m["files"].values())
        self.assertFalse(os.path.exists(os.path.join(KIT, STOP_SOURCE)))
        self.assertIn(STOP_SOURCE, v4_section())


class RetiredKitUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="retired-kit-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.board = V3Board(self.tmp)

    def test_plain_kit_update_stops_with_nothing_changed(self):
        p = run(self.board.root, sys.executable, "board/board.py", "kit-update", "--from", KIT, ok=False)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("nothing changed", p.stderr)
        self.assertIn(STOP_SOURCE, p.stderr)
        self.assertEqual(self.board.read("board/KIT_VERSION").strip(), "3")
        self.assertEqual(git(self.board.root, "status", "--porcelain").stdout, "")

    def test_v1_kit_update_stops_before_writing(self):
        # v1's kit-update (7713e30) fetches and writes one file at a time: the stop entry must come first.
        p = subprocess.run(["git", "show", "7713e30:board/kit/board.py"], cwd=REPO, capture_output=True, text=True)
        if p.returncode:
            self.skipTest("commit 7713e30 is not in this clone")
        with open(os.path.join(self.board.root, "board", "board.py"), "w") as f:
            f.write(p.stdout)
        git(self.board.root, "commit", "-qam", "v1 board.py")
        r = run(self.board.root, sys.executable, "board/board.py", "kit-update", "--from", KIT, ok=False)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn(STOP_SOURCE, r.stderr)
        self.assertEqual(self.board.read("board/KIT_VERSION").strip(), "3")
        self.assertEqual(git(self.board.root, "status", "--porcelain").stdout, "")

    def test_kit_check_card_points_at_v4_steps(self):
        p = run(self.board.root, sys.executable, "board/board.py", "--file", "board/tasks.json", "kit-check", "--card", "--from", KIT)
        self.assertIn("UPGRADING.md#v4-retired", p.stdout)
        card = [t for t in json.loads(self.board.read("board/tasks.json"))["tasks"] if t["title"] == "Upgrade board tools to kit v4"][0]
        self.assertEqual([t["text"] for t in card["todos"]], UPGRADE_TODOS)
        self.assertTrue(card["links"][0]["url"].endswith("/board/kit/UPGRADING.md#v4-retired"))
        self.assertIn('"v4 (retired)" steps', card["details"])
        self.assertIn("not .claude/skills/board-upgrade/SKILL.md", card["details"])

    def keeptrack_kit(self):
        kit = os.environ.get("KEEPTRACK_KIT")
        if kit:
            return kit
        d = os.path.join(self.tmp, "kt")
        p = subprocess.run(["git", "clone", "-q", "--depth", "1", "https://github.com/rain-ventures-ai/keeptrack", d],
                           capture_output=True, text=True)
        if p.returncode:
            self.skipTest(f"cannot clone keeptrack: {p.stderr.strip()}")
        return os.path.join(d, "board", "kit")

    def test_v4_steps_move_a_v3_board_to_keeptrack(self):
        kt = self.keeptrack_kit()
        root, sec = self.board.root, v4_section()
        cmds = re.findall(r"`((?:git clone|python3 board/)[^`]*)`", sec)
        py = lambda c: [sys.executable] + c.split()[1:]
        # Agent steps, on a branch: the two kit-update commands, exactly as written apart from the clone path.
        self.assertIn("git clone --depth 1 https://github.com/rain-ventures-ai/keeptrack /tmp/kt", cmds)
        updates = [c for c in cmds if "kit-update --from" in c]
        self.assertEqual(updates, ["python3 board/board.py kit-update --from /tmp/kt/board/kit",
                                   "python3 board/keeptrack.py kit-update --from /tmp/kt/board/kit"])
        git(root, "checkout", "-qb", "claude/board-kit-keeptrack")
        for c in updates:
            run(root, *py(c.replace("/tmp/kt/board/kit", kt)))
        want = json.loads(read(os.path.join(kt, "manifest.json")))["version"]
        self.assertEqual(self.board.read("board/KIT_VERSION").strip(), str(want))
        ff = ["--file", "board/tasks.json"]
        run(root, sys.executable, "board/board.py", *ff, "claim", "#1", "--note", "starting the kit upgrade")
        # Step 4: keep the old tool outside the repo for every board write until the merge (--file mode keeps no claim record).
        step1 = sec[sec.index("\n1. "):sec.index("\n2. ")]
        self.assertIn("`cp board/board.py /tmp/board.py`", step1)
        self.assertIn("`python3 /tmp/board.py todo-done <card> <N>`", step1)
        self.assertIn("mv .board-claim.json /tmp/board-claim.moved.json", sec)
        self.assertIn("`/tmp/board.py` does not use it", sec)
        self.assertIn("never `keeptrack.py`", sec)
        old_dir = os.path.join(self.tmp, "old-tool")
        os.makedirs(old_dir)
        shutil.copy(os.path.join(root, "board", "board.py"), os.path.join(old_dir, "board.py"))
        old = lambda *a: run(root, sys.executable, os.path.join(old_dir, "board.py"), *ff, *a)
        # Step 5 and 6: drop board.py, point the hook and repo files at keeptrack.py, extend .gitignore.
        git(root, "rm", "-q", "board/board.py")
        for name in [".claude/settings.json", "AGENTS.md", "CLAUDE.md"]:
            path = os.path.join(root, name)
            text = read(path)
            with open(path, "w") as f:
                f.write(text.replace("board.py", "keeptrack.py"))
        with open(os.path.join(root, ".gitignore"), "a") as f:
            f.write(".board/cache/\n*.json.lock\n.tmp-*.part\n")
        git(root, "add", "-A")
        left = run(root, "git", "grep", "-l", "board\\.py", ok=False).stdout.split()
        self.assertEqual(left, ["board/UPGRADING.md"])
        self.assertIn("board/keeptrack.py", self.board.read(".claude/settings.json"))
        # Step 8: checks.
        run(root, sys.executable, "-m", "py_compile", "board/keeptrack.py")
        self.assertIn("current", run(root, sys.executable, "board/keeptrack.py", "kit-check", "--from", kt).stdout)
        self.assertIn("Card one", run(root, sys.executable, "board/keeptrack.py", *ff, "list").stdout)
        git(root, "add", "-A"); git(root, "commit", "-qm", "Move the board to keeptrack")
        # Step 9 and the routine's own writes before the merge: the old tool keeps the live board on schema 2.
        self.assertIn("python3 /tmp/board.py link", sec)
        old("heartbeat", "#1", "--note", "PR open")
        old("link", "#1", "https://github.com/example/scratch-board/pull/1", "--title", "PR")
        old("todo-add", "#1", "Open and link the PR"); old("todo-add", "#1", "After the merge: migrate --to 4, verify, doctor")
        old("todo-done", "#1", "1")
        old("comment", "#1", "PR open; the migration follows the merge")
        data = json.loads(self.board.read("board/tasks.json"))
        self.assertEqual(data["version"], 2)
        self.assertEqual(data["tasks"][0]["links"][-1]["title"], "PR")
        self.assertEqual(data["tasks"][0]["claim"]["status"], "running")
        # Step 10: hand the card over for the merge with the old tool; it stays open for the migration.
        step10 = sec[sec.index("\n10. "):sec.index("Migration, after the PR")]
        for word in ["/tmp/board.py", "`release` it with `--column in-progress`", "`assign` it to the upgrade owner",
                     "Do not mark it `done`", "leave that item open until the migration"]:
            self.assertIn(word, step10)
        old("release", "#1", "--column", "in-progress"); old("assign", "#1", "osouthgate")
        data = json.loads(self.board.read("board/tasks.json"))
        self.assertEqual(data["version"], 2)
        self.assertEqual((data["tasks"][0]["column"], data["tasks"][0]["claim"], data["tasks"][0]["assignees"]),
                         ("in-progress", None, ["osouthgate"]))
        # Why: the same write with keeptrack.py would move the live board to schema 3, which board.py will not write.
        probe = os.path.join(self.tmp, "probe", "tasks.json"); os.makedirs(os.path.dirname(probe))
        shutil.copy(os.path.join(root, "board", "tasks.json"), probe)
        run(root, sys.executable, "board/keeptrack.py", "--file", probe, "link", "#2", "https://example.com/x")
        self.assertEqual(json.loads(read(probe))["version"], 3)
        self.assertNotEqual(run(root, sys.executable, os.path.join(old_dir, "board.py"), "--file", probe,
                                "comment", "#2", "x", ok=False).returncode, 0)
        # Migration, after the merge (a local file here: the backup is the committed schema-2 tasks.json).
        backup = os.path.join(self.tmp, "backup.json")
        with open(backup, "w") as f:
            f.write(self.board.read("board/tasks.json"))
        migration = sec[sec.index("Migration, after the PR"):]
        mig = re.findall(r"`(python3 board/keeptrack\.py (?:migrate|verify|doctor)[^`]*)`", migration)
        self.assertEqual(mig[:4], ["python3 board/keeptrack.py migrate --to 4 --dry-run", "python3 board/keeptrack.py migrate --to 4",
                                   "python3 board/keeptrack.py verify --against <backup tag>", "python3 board/keeptrack.py doctor"])
        for c in mig[:4]:
            args = py(c.replace("<backup tag>", backup))
            out = run(root, *args[:2], *ff, *args[2:]).stdout
            if "verify" in c:
                self.assertIn("OK", out)
        doctor = json.loads(run(root, sys.executable, "board/keeptrack.py", *ff, "doctor", "--json").stdout)
        self.assertTrue(doctor["healthy"], doctor)
        data = json.loads(self.board.read("board/tasks.json"))
        self.assertEqual((data["version"], data.get("layout")), (4, "split"))
        self.assertEqual(len(os.listdir(os.path.join(root, "board", "cards"))), 2)
        # Migration step 5: tick what is left, then done with a note (keeptrack refuses open to-dos or no note).
        final = migration[migration.index("\n5. "):]
        self.assertIn("`python3 board/keeptrack.py todo-done <card> <N>`", final)
        self.assertIn('`python3 board/keeptrack.py done <card> --note "<PR link>; migrated to schema 4, backup tag <tag>"`', final)
        kt_ = lambda *a, ok=True: run(root, sys.executable, "board/keeptrack.py", *ff, *a, ok=ok)
        self.assertNotEqual(kt_("done", "#1", "--note", "x", ok=False).returncode, 0)
        n = kt_("show", "#1").stdout
        opened = re.findall(r"^\s*(\d+)\. \[ \]", n, re.M)
        self.assertTrue(opened, n)
        for i in opened:
            kt_("todo-done", "#1", i)
        kt_("done", "#1", "--note", "https://github.com/example/scratch-board/pull/1; migrated to schema 4, backup tag t")
        cards = [json.loads(self.board.read(os.path.join("board", "cards", n))) for n in os.listdir(os.path.join(root, "board", "cards"))]
        one = [c for c in cards if c["title"] == "Card one"][0]
        self.assertEqual((one["column"], one.get("outcome")), ("done", "completed"))
        self.assertTrue(all(d.get("done") for d in one["todos"]))


if __name__ == "__main__":
    unittest.main()
