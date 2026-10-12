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
                     "board/kit/NEW-BOARD.md", "board/kit/ROUTINE-SETUP.md", "board/kit/routine-prompt.md"]:
            head = "".join(read(os.path.join(REPO, name)).splitlines(True)[:8])
            self.assertRegex(head, NOTICE, name)

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


class RetiredKitUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="retired-kit-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.board = V3Board(self.tmp)

    def test_plain_kit_update_stops_with_nothing_changed(self):
        p = run(self.board.root, sys.executable, "board/board.py", "kit-update", "--from", KIT, ok=False)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("nothing changed", p.stderr)
        self.assertIn("moved-to/github.com/rain-ventures-ai/keeptrack", p.stderr)
        self.assertEqual(self.board.read("board/KIT_VERSION").strip(), "3")
        self.assertEqual(git(self.board.root, "status", "--porcelain").stdout, "")

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
        # Step 4 and 5: drop board.py, point the hook and repo files at keeptrack.py, extend .gitignore.
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
        # Step 7: checks.
        run(root, sys.executable, "-m", "py_compile", "board/keeptrack.py")
        self.assertIn("current", run(root, sys.executable, "board/keeptrack.py", "kit-check", "--from", kt).stdout)
        ff = ["--file", "board/tasks.json"]
        self.assertIn("Card one", run(root, sys.executable, "board/keeptrack.py", *ff, "list").stdout)
        git(root, "add", "-A"); git(root, "commit", "-qm", "Move the board to keeptrack")
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


if __name__ == "__main__":
    unittest.main()
