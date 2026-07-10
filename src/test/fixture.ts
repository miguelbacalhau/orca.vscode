// A throwaway git repository exercising every entry shape the session must
// handle: modify, add, delete, rename, and a binary file.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface Fixture {
  root: string; // the checkout under review, on branch feature/x
  cleanup(): void;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'orca-test',
      GIT_AUTHOR_EMAIL: 'orca@test.invalid',
      GIT_COMMITTER_NAME: 'orca-test',
      GIT_COMMITTER_EMAIL: 'orca@test.invalid',
    },
  });
}

function write(root: string, rel: string, content: string | Buffer): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

export function makeFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-vscode-test-'));
  git(root, 'init', '-b', 'main');

  write(root, 'a.txt', 'alpha\none\n');
  write(root, 'del.txt', 'doomed\n');
  write(root, 'ren.txt', 'stable content that survives the rename\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'trunk');

  git(root, 'checkout', '-b', 'feature/x');
  write(root, 'a.txt', 'alpha\ntwo\n');
  write(root, 'new.txt', 'fresh\n');
  fs.rmSync(path.join(root, 'del.txt'));
  git(root, 'mv', 'ren.txt', 'renamed.txt');
  write(root, 'bin.dat', Buffer.from([0, 1, 2, 0, 255, 0, 3]));
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'deliverable');

  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

// The orca layout: a bare repo with trunk as its symbolic HEAD and a linked
// worktree checked out on the deliverable branch.
export function makeBareLayoutFixture(): Fixture {
  const src = makeFixture();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-vscode-bare-'));
  const bare = path.join(dir, 'repo.git');
  git(dir, 'clone', '--bare', src.root, bare);
  git(bare, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  const worktree = path.join(dir, 'orca-x');
  git(bare, 'worktree', 'add', worktree, 'feature/x');
  src.cleanup();
  return {
    root: worktree,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
