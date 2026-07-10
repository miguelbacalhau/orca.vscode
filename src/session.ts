// orca.vscode — branch review inside the user's own VS Code.
//
// A session is the merge-base diff of <base>...<head>: changed files as a
// tree view, one native diff pair open at a time. State is module-local and
// dies with the session; nothing is written anywhere — no files, no git
// state, no marks beyond the in-memory ✓.

import * as vscode from 'vscode';
import * as git from './git';
import { SCHEME, emptyUri, goneUri, mergeBaseUri } from './content';

export interface Session {
  entries: git.ChangedFile[];
  index: number; // 0-based; -1 before the first open
  mergebase: string;
  toplevel: string;
  range: string;
}

interface Ui {
  refresh(): void;
  reveal(index: number): void;
}

let session: Session | null = null;
let ui: Ui | null = null;

export function attachUi(u: Ui): void {
  ui = u;
}

export function current(): Session | null {
  return session;
}

function notify(msg: string): void {
  void vscode.window.showInformationMessage(`Orca: ${msg}`);
}

function error(msg: string): void {
  void vscode.window.showErrorMessage(`Orca: ${msg}`);
}

function setContext(active: boolean): void {
  void vscode.commands.executeCommand('setContext', 'orca.reviewActive', active);
}

function refreshUi(): void {
  ui?.refresh();
  if (session && session.index >= 0) {
    ui?.reveal(session.index);
  }
}

// Every diff tab the session owns has an orca-git: side — unambiguous, so
// closing them can never touch a tab the user opened themselves. This is
// both the teardown and the enablePreview:false fallback: with preview tabs
// the next pair replaces the last anyway; with pinned tabs this stops them
// accumulating.
function ownedTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => {
      const input = t.input;
      return (
        input instanceof vscode.TabInputTextDiff &&
        (input.original.scheme === SCHEME || input.modified.scheme === SCHEME)
      );
    });
}

// Whether the session's diff pair is currently open somewhere. Binary
// entries open the plain file, so they never count as an owned tab.
export function hasOwnedTab(): boolean {
  return ownedTabs().length > 0;
}

async function closeOwnedTabs(): Promise<void> {
  const owned = ownedTabs();
  if (owned.length > 0) {
    await vscode.window.tabGroups.close(owned);
  }
}

// Start (or restart) a review session. `range` is '<base>...<head>', a bare
// '<base>' (head defaults to HEAD), or empty for <trunk>...HEAD. `cwd` is
// where git runs — the handoff passes the worktree; the command path uses
// the first workspace folder.
export async function review(range?: string, cwd?: string): Promise<void> {
  const dir = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!dir) {
    return error('no folder open — open the worktree to review first');
  }
  if (session) {
    await close();
  }

  let base: string;
  let head: string;
  try {
    if (range && range.trim() !== '') {
      const m = range.trim().match(/^(.*?)\.\.\.(.*)$/);
      if (m && m[1] !== '') {
        base = m[1];
        head = m[2] !== '' ? m[2] : 'HEAD';
      } else {
        base = range.trim();
        head = 'HEAD';
      }
    } else {
      base = await git.trunk(dir);
      head = 'HEAD';
    }

    const toplevel = await git.toplevel(dir);
    const mergebase = await git.mergeBase(dir, base, head);
    const entries = await git.changedFiles(dir, mergebase, head);
    if (entries.length === 0) {
      return notify(`nothing to review — ${base}...${head} has no changes`);
    }

    session = { entries, index: -1, mergebase, toplevel, range: `${base}...${head}` };
  } catch (e) {
    return error(e instanceof Error ? e.message : String(e));
  }

  setContext(true);
  const n = session.entries.length;
  notify(`${n} file${n === 1 ? '' : 's'} in ${session.range}`);
  await open(0);
}

// Open the diff pair for the idx-th changed file (0-based).
export async function open(idx: number): Promise<void> {
  if (!session) {
    return error('no review session — start one with "Orca: Review"');
  }
  idx = Math.max(0, Math.min(idx, session.entries.length - 1));
  session.index = idx;
  const e = session.entries[idx];
  const abs = vscode.Uri.file(`${session.toplevel}/${e.path}`);

  await closeOwnedTabs();

  // Binary files get no diff pair: just open the file itself.
  if (e.binary) {
    refreshUi();
    try {
      await vscode.commands.executeCommand('vscode.open', abs, { preview: true });
    } catch {
      // vscode.open renders binaries it recognizes and errors on the rest;
      // either way the tree shows (binary) and the walk continues.
    }
    notify(`${e.path} is binary — opened without a diff`);
    return;
  }

  let left: vscode.Uri;
  let right: vscode.Uri;
  let title: string;
  if (e.status === 'A') {
    left = emptyUri(e.path);
    right = abs;
    title = `${e.path} (added)`;
  } else if (e.status === 'D') {
    left = mergeBaseUri(session.mergebase, e.oldPath);
    right = goneUri(e.path);
    title = `${e.path} (deleted)`;
  } else {
    left = mergeBaseUri(session.mergebase, e.oldPath);
    right = abs;
    title = e.oldPath !== e.path ? `${e.oldPath} → ${e.path}` : `${e.path} (${session.range})`;
  }

  refreshUi();
  try {
    await vscode.commands.executeCommand('vscode.diff', left, right, `Orca: ${title}`, {
      preview: true,
    });
  } catch (err) {
    error(`cannot open diff for ${e.path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Move to the next/previous file's pair. At the edge, a polite message; no
// wrapping — mirroring nvim's ]q/[q contract.
export async function next(): Promise<void> {
  if (!session) {
    return error('no review session — start one with "Orca: Review"');
  }
  if (session.index >= session.entries.length - 1) {
    return notify('already at the last file');
  }
  await open(session.index + 1);
}

export async function prev(): Promise<void> {
  if (!session) {
    return error('no review session — start one with "Orca: Review"');
  }
  if (session.index <= 0) {
    return notify('already at the first file');
  }
  await open(session.index - 1);
}

// Toggle reviewed (✓) on the current file. Marking advances to the next
// unreviewed file (wrapping once); un-marking stays put.
export async function mark(): Promise<void> {
  if (!session) {
    return error('no review session — start one with "Orca: Review"');
  }
  if (session.index < 0) {
    return notify('no file open — "Orca: Review: Next File" opens the first');
  }
  const entry = session.entries[session.index];
  entry.reviewed = !entry.reviewed;
  refreshUi();
  if (!entry.reviewed) {
    return;
  }
  const n = session.entries.length;
  for (let step = 1; step <= n; step++) {
    const i = (session.index + step) % n;
    if (!session.entries[i].reviewed) {
      return open(i);
    }
  }
  notify('review complete — every file marked ✓');
}

// A checkbox click is positional, not sequential: toggle without advancing.
export function toggleReviewed(idx: number, reviewed: boolean): void {
  const e = session?.entries[idx];
  if (!e) {
    return;
  }
  e.reviewed = reviewed;
  ui?.refresh();
}

// End the session: context cleared (tree vanishes), session-owned diff tab
// closed, all state dropped. Nothing persists.
export async function close(): Promise<void> {
  if (!session) {
    return;
  }
  session = null;
  setContext(false);
  ui?.refresh();
  await closeOwnedTabs();
}
