# co-assets

> **Retired: moved to [rain-ventures-ai/keeptrack](https://github.com/rain-ventures-ai/keeptrack).** The board kit (`board/kit/`, `board.py`) and the web board here are no longer maintained. Use the kit and `keeptrack.py` from keeptrack, and the web board at https://rain-ventures-ai.github.io/keeptrack/board/. The files stay here only so old clones keep working; do not change them.

Shared static assets and small tools for Rain Ventures. **Public repo: never put client data, names, credentials or anything confidential here.**

## board/
A static kanban page. It holds no data: it reads and writes a `tasks.json` file in a (private) GitHub repo using a fine-grained token you paste into Settings, kept only in your browser's localStorage and sent only to api.github.com.

Files: `index.html` (markup), `board.css` (styles and the five themes), `board.js` (app logic), `theme.js` (applies the saved theme before first paint). The theme picker in the header (Auto, Light, Dark, Midnight, Sand) is remembered per browser.

Hosted at https://rain-ventures-ai.github.io/co-assets/board/

First-run prefill (no secrets in the link): `.../board/?repo=owner/name&branch=master&path=tasks.json`. Then open Settings and add your GitHub username and token.

Data format and the agent CLI live with the data, in the repo that owns `tasks.json` (for us: `rain-ventures-ai/consulting`, folder `board/`).
