import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });

  if (result.status !== 0) {
    const output = `${result.stdout}${result.stderr}`.trim();
    throw new Error(output || `${command} ${args.join(' ')} failed`);
  }

  return result.stdout.trim();
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function stagedFiles() {
  return capture('git', ['diff', '--cached', '--name-only'])
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

function titleForPost(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) return undefined;

  const source = readFileSync(fullPath, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;

  const data = yaml.load(match[1]) ?? {};
  return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
}

function commitMessage(files) {
  const posts = files.filter((file) => /^src\/content\/posts\/.*\.mdx?$/.test(file) && existsSync(path.join(root, file)));

  if (posts.length === 1) {
    const title = titleForPost(posts[0]);
    if (title) return `Publish "${title.replaceAll('"', "'")}"`;
  }

  if (posts.length > 1) return `Publish ${posts.length} posts`;

  return 'Update site';
}

function currentBranch() {
  const branch = capture('git', ['branch', '--show-current']);
  if (!branch) {
    throw new Error('Cannot publish from a detached HEAD. Check out a branch first.');
  }
  return branch;
}

function hasUpstream() {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function push() {
  const branch = currentBranch();
  if (hasUpstream()) {
    run('git', ['push']);
  } else {
    run('git', ['push', '-u', 'origin', branch]);
  }
}

function main() {
  run('git', ['add', '-A']);

  const files = stagedFiles();

  if (files.length > 0) {
    const message = commitMessage(files);
    run('git', ['commit', '-m', message]);
  } else {
    console.log('No local changes to commit.');
  }

  push();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
