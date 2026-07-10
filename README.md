# orca.vscode

Branch review inside your own VS Code — the companion the [orca](https://github.com/miguelbacalhau/orca)
plugin's `/orca:review` opens when your editor is VS Code, and a standalone tool in any git
repository. The VS Code half of what [orca.nvim](https://github.com/miguelbacalhau/orca.nvim)
is for Neovim.

A review session is the **merge-base diff** of a deliverable branch against trunk: the changed
files as a flat list in the Source Control sidebar, one native diff editor at a time, with a ✓
checkbox per file. The right side of every diff is the **real working-tree file** — editable,
language server attached — so fixing nits during review stays a feature. The left side is the
file as the merge-base had it, served read-only from git.

Nothing is written anywhere: no files, no git state, no persisted marks. The session dies with
the window (or `Orca: Review: Close`), and the tree view only exists while a session does.

## Install

Grab the `.vsix` from the [latest release](https://github.com/miguelbacalhau/orca.vscode/releases)
and:

```sh
code --install-extension orca-vscode-<version>.vsix
```

## Use

Open the worktree of the branch to review, then run **Orca: Review** from the command palette.
With no argument the range is `<trunk>...HEAD` — trunk resolved the same way orca.nvim does
(the bare repo's symbolic HEAD in a linked worktree, else `origin/HEAD`'s local twin, else the
first of `main`/`master`/`trunk`). Programmatic callers can pass an explicit range
(`<base>...<head>`, or a bare `<base>` implying `...HEAD`).

| Command | Action |
|---|---|
| `orca.review` | Start (or restart) a session |
| `orca.reviewNext` / `orca.reviewPrev` | Move to the next/previous file's diff |
| `orca.reviewMark` | Toggle reviewed ✓ on the current file, advance to the next unreviewed |
| `orca.reviewClose` | End the session, clean up |

Walking the list: **mark-and-advance** (`orca.reviewMark`) toggles ✓ and jumps to the next
unreviewed file, wrapping once — when everything is ✓ you get a "review complete"
notification. Clicking a file in the tree opens its diff; clicking its checkbox toggles ✓
*without* advancing (a pointer click is positional, not sequential). Deleted files diff
against an empty right side, added files against an empty left, renames show `old → new`,
binary files open plainly with `(binary)` in the tree.

Hunk navigation, inline/side-by-side toggle, and gutter staging are the native diff editor's
own.

### Keybindings

None ship — VS Code has no native keys meaning next-file/mark/close, so nothing is upgraded
in place (the commands and the tree are the API). A copy-paste `keybindings.json` starting
point, active only during a session:

```jsonc
[
  { "key": "ctrl+alt+n", "command": "orca.reviewNext",  "when": "orca.reviewActive" },
  { "key": "ctrl+alt+p", "command": "orca.reviewPrev",  "when": "orca.reviewActive" },
  { "key": "ctrl+alt+m", "command": "orca.reviewMark",  "when": "orca.reviewActive" },
  { "key": "ctrl+alt+q", "command": "orca.reviewClose", "when": "orca.reviewActive" }
]
```

### The URI handoff

`/orca:review` (or anything else) can open a review in the right window from outside:

```sh
code --open-url 'vscode://orcavscode.orca-vscode/review?worktree=/abs/path/to/worktree'
```

`worktree` is required and must be an absolute path to a git worktree; a `range` query
parameter is optional (omitted → `<trunk>...HEAD`). The receiving window starts the session
directly if it already has that worktree open; otherwise it records a short-lived pending
handoff and opens the folder in a new window, which picks the record up on startup. Records
are consumed or expired (2 minutes), never accumulated.

## Troubleshooting

**"The extension 'orcavscode.orca-vscode' cannot be installed because it was not found."**
The window that received the review URI is in Workspace Trust **Restricted Mode**. Untrusted
windows drop this extension from their registry entirely (it runs git in the workspace, which
is exactly what restricted mode exists to stop), so VS Code mistakes the URI for a request to
install a Marketplace extension that doesn't exist. Trust the worktree — click "Restricted
Mode" in the status bar → Trust — then retry. Orca integration worktrees live inside repos
you've already trusted, and subfolders of trusted folders are auto-trusted, so this mostly
bites ad-hoc folders in `/tmp`.

**`code --open-url` launches VS Code but no window ever opens.**
When VS Code is fully quit and has no session to restore, a cold launch via `--open-url`
alone can come up window-less and the URI dies. Open the worktree first, then fire the URI —
or skip it entirely: `code <worktree>`, then run "Orca: Review" from the palette.

## Develop

```sh
npm install
npm run build      # bundle to dist/extension.js
npm test           # @vscode/test-electron: git layer + session smoke
npm run package    # vsce package → orca-vscode-<version>.vsix
```

## Non-goals (v1)

Review notes (v2, shared format with orca.nvim), multi-diff view, branch discovery/picker UI,
worktree management, and forks of VS Code (`code-insiders`, Cursor, VSCodium) — one binary,
one extension id, on purpose.
