// The "Orca Review" tree in the Source Control sidebar: one flat list,
// ordered as git emitted it. Checkbox = reviewed ✓, label = status letter +
// path, rename arrow and (binary) in the description, selection follows the
// current file. Elements are indices into the session's entry list.

import * as vscode from 'vscode';
import * as session from './session';

export class ReviewTreeProvider implements vscode.TreeDataProvider<number> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(element?: number): number[] {
    if (element !== undefined) {
      return [];
    }
    const s = session.current();
    return s ? s.entries.map((_, i) => i) : [];
  }

  // Flat list; reveal() needs this to exist.
  getParent(): undefined {
    return undefined;
  }

  getTreeItem(idx: number): vscode.TreeItem {
    const s = session.current();
    const e = s?.entries[idx];
    if (!s || !e) {
      return new vscode.TreeItem('');
    }
    const item = new vscode.TreeItem(`${e.status} ${e.path}`);
    item.id = String(idx);
    item.checkboxState = e.reviewed
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    const notes: string[] = [];
    if (e.oldPath !== e.path) {
      notes.push(`${e.oldPath} → ${e.path}`);
    }
    if (e.binary) {
      notes.push('(binary)');
    }
    if (idx === s.index) {
      notes.push('● current');
    }
    item.description = notes.join(' ') || undefined;
    item.resourceUri = vscode.Uri.file(`${s.toplevel}/${e.path}`);
    item.command = {
      command: 'orca.reviewOpen',
      title: 'Open diff',
      arguments: [idx],
    };
    return item;
  }
}

export function createTree(): { view: vscode.TreeView<number>; provider: ReviewTreeProvider } {
  const provider = new ReviewTreeProvider();
  const view = vscode.window.createTreeView('orcaReview', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  view.onDidChangeCheckboxState((ev) => {
    for (const [idx, state] of ev.items) {
      session.toggleReviewed(idx, state === vscode.TreeItemCheckboxState.Checked);
    }
  });
  return { view, provider };
}
