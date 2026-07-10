// The read-only left side of every diff pair: an `orca-git:` scheme serving
// `git show <mergebase>:<path>`. Read-only for free (content providers always
// are), syntax highlighting inferred from the URI path. Two sentinel
// authorities carry the degenerate sides: `empty` (an added file's left) and
// `gone` (a deleted file's right).

import * as vscode from 'vscode';
import * as git from './git';

export const SCHEME = 'orca-git';

function uri(authority: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, authority, path: '/' + filePath });
}

// The file as the merge-base had it: orca-git://<mergebase-short>/<old_path>.
export function mergeBaseUri(mergebase: string, oldPath: string): vscode.Uri {
  return uri(mergebase.slice(0, 12), oldPath);
}

// An added file's left side — nothing existed at the merge-base.
export function emptyUri(filePath: string): vscode.Uri {
  return uri('empty', filePath);
}

// A deleted file's right side — nothing exists in the worktree.
export function goneUri(filePath: string): vscode.Uri {
  return uri('gone', filePath);
}

export class OrcaGitContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly getSession: () => { mergebase: string; toplevel: string } | null) {}

  async provideTextDocumentContent(u: vscode.Uri): Promise<string> {
    if (u.authority === 'empty' || u.authority === 'gone') {
      return '';
    }
    // The authority is display-only (a short hash); the real revision comes
    // from the live session. A stale URI resurrected by tab restore after
    // the session died renders empty rather than erroring.
    const s = this.getSession();
    if (!s) {
      return '';
    }
    try {
      return await git.show(s.toplevel, s.mergebase, u.path.replace(/^\//, ''));
    } catch {
      return '';
    }
  }
}
