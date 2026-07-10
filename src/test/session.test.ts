import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { SCHEME } from '../content';
import * as session from '../session';
import { Fixture, makeFixture } from './fixture';

function activeDiffInput(): vscode.TabInputTextDiff | null {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return tab?.input instanceof vscode.TabInputTextDiff ? tab.input : null;
}

suite('session', () => {
  let fx: Fixture;

  suiteSetup(() => {
    fx = makeFixture();
  });
  suiteTeardown(async () => {
    await session.close();
    fx.cleanup();
  });

  test('review opens a session on trunk...HEAD and the first diff pair', async () => {
    await session.review(undefined, fx.root);
    const s = session.current();
    assert.ok(s, 'session exists');
    assert.strictEqual(s.range, 'main...HEAD');
    assert.strictEqual(s.entries.length, 5);
    assert.strictEqual(s.index, 0);

    const input = activeDiffInput();
    assert.ok(input, 'active tab is a diff editor');
    assert.strictEqual(input.original.scheme, SCHEME);
  });

  test('next and prev move with clamped edges', async () => {
    const s = session.current()!;
    await session.next();
    assert.strictEqual(s.index, 1);
    await session.prev();
    assert.strictEqual(s.index, 0);
    await session.prev(); // at the first file: stays put
    assert.strictEqual(s.index, 0);
  });

  test('deleted files diff against an empty gone: right side', async () => {
    const s = session.current()!;
    const delIdx = s.entries.findIndex((e) => e.status === 'D');
    assert.ok(delIdx >= 0);
    await session.open(delIdx);
    const input = activeDiffInput();
    assert.ok(input);
    assert.strictEqual(input.original.scheme, SCHEME);
    assert.strictEqual(input.modified.scheme, SCHEME);
    assert.strictEqual(input.modified.authority, 'gone');
  });

  test('added files diff against an empty left side', async () => {
    const s = session.current()!;
    await session.open(s.entries.findIndex((e) => e.path === 'new.txt'));
    const input = activeDiffInput();
    assert.ok(input);
    assert.strictEqual(input.original.authority, 'empty');
    assert.strictEqual(input.modified.scheme, 'file');
  });

  test('mark toggles reviewed and advances to the next unreviewed', async () => {
    const s = session.current()!;
    await session.open(0);
    await session.mark();
    assert.strictEqual(s.entries[0].reviewed, true);
    assert.strictEqual(s.index, 1, 'advanced past the marked file');

    // Un-marking stays put: go back to the marked file and toggle it off.
    await session.open(0);
    await session.mark();
    assert.strictEqual(s.entries[0].reviewed, false);
    assert.strictEqual(s.index, 0, 'un-marking does not move');
  });

  test('toggleReviewed flips without advancing', async () => {
    const s = session.current()!;
    const idx = s.index;
    const before = s.entries[2].reviewed;
    session.toggleReviewed(2, !before);
    assert.strictEqual(s.entries[2].reviewed, !before);
    assert.strictEqual(s.index, idx);
  });

  test('marking every file completes the review and close drops all state', async () => {
    const s = session.current()!;
    for (const e of s.entries) {
      e.reviewed = false;
    }
    await session.open(0);
    for (let i = 0; i < s.entries.length; i++) {
      await session.mark();
    }
    assert.ok(
      s.entries.every((e) => e.reviewed),
      'every file marked'
    );

    await session.close();
    assert.strictEqual(session.current(), null);
    assert.strictEqual(activeDiffInput(), null, 'session-owned diff tab closed');
  });

  test('a second review replaces the first cleanly', async () => {
    await session.review('main...HEAD', fx.root);
    const first = session.current();
    await session.review(undefined, fx.root);
    const second = session.current();
    assert.ok(second && second !== first);
    await session.close();
  });

  test('review outside a git repository errors without a session', async () => {
    await session.review(undefined, '/');
    assert.strictEqual(session.current(), null);
  });
});
