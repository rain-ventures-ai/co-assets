@AGENTS.md

## Claude Code notes
- Use the `board` skill (`.claude/skills/board/SKILL.md`) for anything involving tasks, claiming work, or "what should I work on".
- If `BOARD_USER` is unset, read it from `gh api user --jq .login`; use `BOARD_AGENT=claude` and the Claude session id as `BOARD_SESSION`.
