# co-assets

Shared static assets and small tools for Rain Ventures. **Public repo: never put client data, names, credentials or anything confidential here.**

## board/
A static kanban page. It holds no data: it reads and writes a `tasks.json` file in a (private) GitHub repo using a fine-grained token you paste into Settings, kept only in your browser's localStorage and sent only to api.github.com.

Hosted at https://rain-ventures-ai.github.io/co-assets/board/

First-run prefill (no secrets in the link): `.../board/?repo=owner/name&branch=master&path=tasks.json`. Then open Settings and add your GitHub username and token.

Data format and the agent CLI live with the data, in the repo that owns `tasks.json` (for us: `rain-ventures-ai/consulting`, folder `board/`).
