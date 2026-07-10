import * as assert from 'node:assert';
import * as git from '../git';
import { Fixture, makeBareLayoutFixture, makeFixture } from './fixture';

suite('git', () => {
  let fx: Fixture;

  suiteSetup(() => {
    fx = makeFixture();
  });
  suiteTeardown(() => {
    fx.cleanup();
  });

  test('toplevel resolves the checkout root', async () => {
    const top = await git.toplevel(fx.root);
    assert.ok(top.length > 0);
    assert.strictEqual(await git.toplevel(top), top);
  });

  test('trunk falls back to main in a plain checkout', async () => {
    assert.strictEqual(await git.trunk(fx.root), 'main');
  });

  test('trunk reads the bare repo symbolic HEAD in a linked worktree', async function () {
    const bare = makeBareLayoutFixture();
    try {
      assert.strictEqual(await git.trunk(bare.root), 'main');
    } finally {
      bare.cleanup();
    }
  });

  test('mergeBase resolves; garbage refs throw GitError', async () => {
    const mb = await git.mergeBase(fx.root, 'main', 'HEAD');
    assert.match(mb, /^[0-9a-f]{40}$/);
    await assert.rejects(git.mergeBase(fx.root, 'no-such-ref', 'HEAD'), git.GitError);
  });

  test('changedFiles parses status, renames, and binary detection', async () => {
    const mb = await git.mergeBase(fx.root, 'main', 'HEAD');
    const entries = await git.changedFiles(fx.root, mb, 'HEAD');
    const byPath = new Map(entries.map((e) => [e.path, e]));

    assert.strictEqual(entries.length, 5);
    assert.strictEqual(byPath.get('a.txt')?.status, 'M');
    assert.strictEqual(byPath.get('new.txt')?.status, 'A');
    assert.strictEqual(byPath.get('del.txt')?.status, 'D');

    const ren = byPath.get('renamed.txt');
    assert.strictEqual(ren?.status, 'R');
    assert.strictEqual(ren?.oldPath, 'ren.txt');

    assert.strictEqual(byPath.get('bin.dat')?.binary, true);
    assert.strictEqual(byPath.get('a.txt')?.binary, false);

    for (const e of entries) {
      assert.strictEqual(e.reviewed, false);
    }
  });

  test('show reads a file at the merge-base', async () => {
    const mb = await git.mergeBase(fx.root, 'main', 'HEAD');
    assert.strictEqual(await git.show(fx.root, mb, 'a.txt'), 'alpha\none\n');
    await assert.rejects(git.show(fx.root, mb, 'new.txt'), git.GitError);
  });
});
