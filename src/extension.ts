// Composition root: wire the commands, the tree, the orca-git: content
// provider, and the URI handoff. Everything stateful lives in session.ts.

import * as vscode from 'vscode';
import { OrcaGitContentProvider, SCHEME } from './content';
import * as handoff from './handoff';
import * as session from './session';
import { createTree } from './tree';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      SCHEME,
      new OrcaGitContentProvider(() => session.current())
    )
  );

  const { view, provider } = createTree();
  context.subscriptions.push(view);
  session.attachUi({
    refresh: () => provider.refresh(),
    reveal: (index) => {
      // reveal() also shows the view if hidden — the "reveal the tree" step
      // of session start rides on it. Failures (view disposed mid-race) are
      // cosmetic only.
      view.reveal(index, { select: true, focus: false }).then(undefined, () => {});
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('orca.review', (range?: string) =>
      session.review(typeof range === 'string' ? range : undefined)
    ),
    vscode.commands.registerCommand('orca.reviewNext', () => session.next()),
    vscode.commands.registerCommand('orca.reviewPrev', () => session.prev()),
    vscode.commands.registerCommand('orca.reviewMark', () => session.mark()),
    vscode.commands.registerCommand('orca.reviewClose', () => session.close()),
    // Internal: what a tree item click runs. Not contributed — palette
    // surface stays the four public commands.
    vscode.commands.registerCommand('orca.reviewOpen', (idx: number) => session.open(idx))
  );

  handoff.registerUriHandler(context);
  void handoff.checkPending(context);
}

export function deactivate(): void {
  void session.close();
}
