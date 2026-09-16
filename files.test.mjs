#!/usr/bin/env node
/** Flow tests: drive the real scripts the way the host drives them. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'herdr-files-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const git = (args, cwd = scratch) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000, input: '' });

const repo = join(scratch, 'repo');
mkdirSync(join(repo, 'src/nested'), { recursive: true });
writeFileSync(join(repo, 'README.md'), '# fixture\n\nA boring fixture repository.\n');
writeFileSync(join(repo, 'src/app.mjs'), 'export const app = true;\n');
writeFileSync(join(repo, 'src/nested/deep.txt'), 'deep\n');
git(['init', '-q', '-b', 'main'], repo);
git(['config', 'user.name', 'Fixture'], repo);
git(['config', 'user.email', 'fixture@example.invalid'], repo);
git(['add', '.'], repo);
git(['commit', '-qm', 'One'], repo);
writeFileSync(join(repo, 'src/app.mjs'), 'export const app = true;\nexport const added = 1;\n');
git(['add', '.'], repo);
git(['commit', '-qm', 'Two'], repo);

const context = JSON.stringify({ sessions: [{ cwd: repo }] });
const run = (script, method, input, contextOverride) => spawnSync(process.execPath, [join(root, script), method], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify(input ?? {}),
    env: contextOverride === null ? { ...process.env } : { ...process.env, MUXR_PLUGIN_CONTEXT_JSON: contextOverride ?? context },
    timeout: 20_000,
});
const ok = (script, method, input, contextOverride) => {
    const result = run(script, method, input, contextOverride);
    assert.equal(result.status, 0, `${script} ${method} failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
};

describe('files tree', () => {
    it('refuses to open a repository without sessions context', () => {
        // Without the host no caller may choose the cwd, so only `root` is offered.
        const denied = run('files.mjs', 'list', { root: repo }, null);
        assert.notEqual(denied.status, 0);
        assert.match(`${denied.stderr}${denied.stdout}`, /unknown repository/);
    });

    it('lists the session repository with folders first and bounded notes', () => {
        const listed = ok('files.mjs', 'list', { cwd: repo, root: repo });
        assert.equal(listed.root, repo);
        assert.equal(listed.title, 'repo');
        assert.equal(listed.count, '3 files');
        const kinds = listed.tree.map((node) => `${node.kind}:${node.name}`);
        assert.deepEqual(kinds, ['folder:src', 'file:README.md']);
        assert.equal(listed.tree[0].hasChildren, true);
        assert.equal(listed.treeNote, '');
    });

    it('lists a folder one level down', () => {
        const listed = ok('files.mjs', 'list', { cwd: repo, root: repo, path: 'src' });
        assert.deepEqual(listed.tree.map((node) => `${node.kind}:${node.name}`), ['folder:nested', 'file:app.mjs']);
    });

    it('previews a bounded text file by exact path', () => {
        const preview = ok('files.mjs', 'read', { cwd: repo, root: repo, path: 'README.md' });
        assert.equal(preview.name, 'README.md');
        assert.equal(preview.path, 'README.md');
        assert.match(preview.body, /boring fixture/);
        assert.equal(preview.note, '');
    });

    it('never reads outside the repository', () => {
        const escape = run('files.mjs', 'read', { cwd: repo, root: repo, path: '../../etc/passwd' });
        assert.notEqual(escape.status, 0);
        assert.match(`${escape.stderr}${escape.stdout}`, /outside repository|file unavailable/);
    });

    it('discovers repositories from the session snapshot', () => {
        const found = ok('files.mjs', 'repos', {});
        assert.ok(found.repos.some((entry) => entry.root === repo), JSON.stringify(found));
    });
});

describe('history', () => {
    it('lists recent commits with readable metadata', () => {
        const log = ok('history.mjs', 'log', { cwd: repo, sessionId: 's1' });
        assert.equal(log.title, 'repo');
        assert.equal(log.count, '2 recent commits');
        assert.equal(log.commits[0].subject, 'Two');
        assert.equal(log.commits[1].subject, 'One');
        for (const commit of log.commits) {
            assert.match(commit.sha, /^[0-9a-f]{40}$/);
            assert.match(commit.meta, /^[0-9a-f]+ · Fixture · \d{4}-\d{2}-\d{2}$/);
            assert.equal(commit.sessionId, 's1');
        }
    });

    it('shows one commit as subject plus patch', () => {
        const head = git(['rev-parse', 'HEAD'], repo).trim();
        const shown = ok('history.mjs', 'show', { cwd: repo, sha: head });
        assert.equal(shown.subject, 'Two');
        assert.match(shown.meta, /Fixture · \d{4}-\d{2}-\d{2}/);
        assert.match(shown.patch, /\+export const added = 1;/);
    });

    it('rejects an invalid commit id', () => {
        const bad = run('history.mjs', 'show', { cwd: repo, sha: 'not-a-sha' });
        assert.notEqual(bad.status, 0);
        assert.match(`${bad.stderr}${bad.stdout}`, /invalid commit/);
    });

    it('treats a session without a directory as an empty state, not a crash', () => {
        const empty = ok('history.mjs', 'log', { cwd: '', sessionId: 's1' });
        assert.deepEqual(empty.commits, []);
        assert.match(empty.count, /No repository/);
    });
});

describe('manifest', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'muxr-ui.json'), 'utf8'));
    const toml = readFileSync(join(root, 'herdr-plugin.toml'), 'utf8');
    const pluginId = toml.match(/^id\s*=\s*"([^"]+)"/m)?.[1];
    const declared = new Set(manifest.contributions.map((contribution) => contribution.id));

    it('keeps the Herdr identity and the muxr manifest in agreement', () => {
        assert.equal(pluginId, 'muxr.code');
        assert.equal(manifest.pluginId, pluginId);
        assert.match(toml, /^min_herdr_version\s*=\s*"0\.8\.0"/m);
        assert.equal(manifest.schemaVersion, 1);
        assert.ok(manifest.minMuxrVersion >= 1);
    });

    it('resolves every internal reference and entry file', () => {
        const references = [];
        const walk = (node) => {
            if (Array.isArray(node)) return node.forEach(walk);
            if (!node || typeof node !== 'object') return;
            for (const [key, value] of Object.entries(node)) {
                if ((key === 'contributionId' || key === 'contentContributionId') && typeof value === 'string' && !value.includes('{{')) references.push(value);
                if (key === 'entry' && typeof value === 'string') assert.ok(readFileSync(join(root, value)), value);
                walk(value);
            }
        };
        walk(manifest.contributions);
        for (const reference of references) assert.ok(declared.has(reference), `dangling reference: ${reference}`);
    });

    it('ships the read-only surface: a Files tab and a history entry, nothing that writes', () => {
        const nav = manifest.contributions.filter((contribution) => contribution.slot === 'navigation.primary');
        assert.equal(nav.length, 1);
        assert.equal(nav[0].id, 'files.nav');
        assert.ok(declared.has('history.open'));
        for (const rpc of manifest.contributions.filter((contribution) => contribution.slot === 'host.rpc')) {
            assert.equal(rpc.mode, 'read', rpc.id);
        }
        assert.ok(![...declared].some((id) => id.startsWith('changes')), 'the Changes review surface is muxr product code, not this plugin');
    });
});
