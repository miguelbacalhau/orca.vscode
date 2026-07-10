// Git plumbing for orca.vscode: trunk and merge-base resolution, the changed-
// file list, and file-at-revision readers. Pure queries — nothing here writes
// to the repository or touches editor state.

import { execFile } from 'node:child_process';
import * as path from 'node:path';

export interface ChangedFile {
  status: string; // 'M' | 'A' | 'D' | 'R' | 'C' | 'T'
  path: string; // current name, repo-root-relative
  oldPath: string; // merge-base name (differs only for renames/copies)
  binary: boolean;
  reviewed: boolean;
}

export class GitError extends Error {}

// Run git with list-form arguments (no shell involved) in `cwd`. Resolves to
// stdout, rejects with a GitError naming the command.
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new GitError(`git ${args.join(' ')} failed`));
      } else {
        resolve(stdout);
      }
    });
  });
}

function lines(out: string): string[] {
  const all = out.split('\n');
  while (all.length > 0 && all[all.length - 1] === '') {
    all.pop();
  }
  return all;
}

async function gitLines(cwd: string, args: string[]): Promise<string[]> {
  return lines(await git(cwd, args));
}

async function gitLinesOrNull(cwd: string, args: string[]): Promise<string[] | null> {
  try {
    return await gitLines(cwd, args);
  } catch {
    return null;
  }
}

// Absolute path of the working tree root.
export async function toplevel(cwd: string): Promise<string> {
  const out = await gitLinesOrNull(cwd, ['rev-parse', '--show-toplevel']);
  if (!out || !out[0]) {
    throw new GitError('not inside a git working tree');
  }
  return out[0];
}

// The default review base — a default, not discovery; explicit ranges
// bypass it. Resolved in tiers:
//  1. In a linked worktree, the symbolic HEAD of the *common* git dir — in
//     orca's bare-repo-with-worktrees layout, the bare repo's trunk branch.
//  2. Otherwise HEAD is the branch under review, not a trunk signal (a
//     normal checkout's common dir is its own .git): origin/HEAD names the
//     remote's default branch; prefer its local twin.
//  3. Last resort: the first of main/master/trunk that exists locally.
export async function trunk(cwd: string): Promise<string> {
  const gitdir = await gitLinesOrNull(cwd, ['rev-parse', '--path-format=absolute', '--git-dir']);
  const common = await gitLinesOrNull(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!gitdir?.[0] || !common?.[0]) {
    throw new GitError('not inside a git repository');
  }
  if (path.resolve(gitdir[0]) !== path.resolve(common[0])) {
    const ref = await gitLinesOrNull(cwd, [
      `--git-dir=${path.resolve(common[0])}`,
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ]);
    if (ref?.[0]) {
      return ref[0];
    }
  }
  const origin = await gitLinesOrNull(cwd, [
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ]);
  const name = origin?.[0]?.match(/^origin\/(.+)$/)?.[1];
  if (name) {
    if (await gitLinesOrNull(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) {
      return name;
    }
    return origin![0];
  }
  for (const cand of ['main', 'master', 'trunk']) {
    if (await gitLinesOrNull(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`])) {
      return cand;
    }
  }
  throw new GitError('cannot resolve a trunk branch — pass an explicit range: Orca: Review <base>...<head>');
}

export async function mergeBase(cwd: string, base: string, head: string): Promise<string> {
  const out = await gitLinesOrNull(cwd, ['merge-base', base, head]);
  if (!out || !out[0]) {
    throw new GitError(`no merge-base for ${base} and ${head}`);
  }
  return out[0];
}

// One entry per file changed between the merge-base and head. `path` is the
// current name, `oldPath` the merge-base name; both repo-root-relative.
export async function changedFiles(cwd: string, mergebase: string, head: string): Promise<ChangedFile[]> {
  const statusLines = await gitLines(cwd, ['diff', '--name-status', '-M', mergebase, head]);
  // Same diff, same options: numstat lists files in the same order, and
  // marks binary ones with "-<TAB>-" counts. Zip by index to detect them
  // without re-parsing rename paths.
  const numstatLines = (await gitLinesOrNull(cwd, ['diff', '--numstat', '-M', mergebase, head])) ?? [];
  return statusLines.map((line, i) => {
    const fields = line.split('\t');
    return {
      status: fields[0].charAt(0),
      oldPath: fields[1],
      path: fields[fields.length - 1],
      binary: /^-\t-\t/.test(numstatLines[i] ?? ''),
      reviewed: false,
    };
  });
}

// Contents of <path> (repo-root-relative) at <rev>.
export async function show(cwd: string, rev: string, filePath: string): Promise<string> {
  return git(cwd, ['show', `${rev}:${filePath}`]);
}
