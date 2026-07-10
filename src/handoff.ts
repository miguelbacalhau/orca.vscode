// The URI handoff: `code --open-url 'vscode://miguelbacalhau.orca-vscode/review
// ?worktree=<abs>'` routes to whatever window VS Code picks — generally not a
// window on that worktree — so the handler never assumes it's home. Match →
// start directly; no match → a transient pending-review record in globalState
// (shared across windows) plus openFolder, and the new window's startup check
// consumes it. Records are consumed or expired, never accumulated.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import * as git from './git';
import * as session from './session';

const PENDING_KEY = 'orca.pendingReview';
const PENDING_TTL_MS = 2 * 60 * 1000;

interface PendingReview {
  worktree: string;
  range?: string;
  expires: number;
}

function error(msg: string): void {
  void vscode.window.showErrorMessage(`Orca: ${msg}`);
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

// The workspace folder sitting on `worktree`, if this window has one.
async function matchingFolder(worktree: string): Promise<vscode.WorkspaceFolder | null> {
  const target = await realpathOrNull(worktree);
  if (!target) {
    return null;
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if ((await realpathOrNull(folder.uri.fsPath)) === target) {
      return folder;
    }
  }
  return null;
}

export function registerUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: (uri) => void handleUri(context, uri),
    })
  );
}

async function handleUri(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  if (uri.path !== '/review') {
    return error(`unknown URI path ${uri.path} — expected /review`);
  }
  const params = new URLSearchParams(uri.query);
  const worktree = params.get('worktree');
  const range = params.get('range') ?? undefined;

  // Required, absolute, a directory, a git worktree — anything else is a
  // loud error, never a guess.
  if (!worktree) {
    return error('review URI is missing the required worktree parameter');
  }
  if (!path.isAbsolute(worktree)) {
    return error(`worktree must be an absolute path: ${worktree}`);
  }
  const stat = await fs.stat(worktree).catch(() => null);
  if (!stat?.isDirectory()) {
    return error(`worktree is not a directory: ${worktree}`);
  }
  try {
    await git.toplevel(worktree);
  } catch {
    return error(`worktree is not a git worktree: ${worktree}`);
  }

  const folder = await matchingFolder(worktree);
  if (folder) {
    return session.review(range, folder.uri.fsPath);
  }

  // Not our worktree: leave the handoff record and open the right folder in
  // a new window; its startup check picks the record up.
  const pending: PendingReview = { worktree, range, expires: Date.now() + PENDING_TTL_MS };
  await context.globalState.update(PENDING_KEY, pending);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktree), {
    forceNewWindow: true,
  });
}

// Startup half of the handoff: consume a pending record aimed at this
// window's workspace. Expired or non-matching records are deleted silently —
// stale handoffs must never fire on an innocent later open.
export async function checkPending(context: vscode.ExtensionContext): Promise<void> {
  const pending = context.globalState.get<PendingReview>(PENDING_KEY);
  if (!pending) {
    return;
  }
  await context.globalState.update(PENDING_KEY, undefined);
  if (Date.now() > pending.expires) {
    return;
  }
  const folder = await matchingFolder(pending.worktree);
  if (folder) {
    await session.review(pending.range, folder.uri.fsPath);
  }
}
