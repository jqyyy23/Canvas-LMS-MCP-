/**
 * Builds `canvas-ubc.mcpb`, the single file a student installs in Claude Desktop.
 *
 *   npm run pack
 *
 * This stages a clean tree in `dist-mcpb/` and packs *that*, rather than zipping
 * the working directory with exclusion rules. The difference matters: `.env` in
 * the repo root holds a live Canvas session cookie for whoever built the bundle,
 * and handing that to classmates would be handing them your account. An allowlist
 * cannot leak a file nobody remembered to deny, so this copies in only what it
 * names, then refuses to pack if anything credential-shaped turns up anyway.
 */

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const stage = join(root, 'dist-mcpb');
const output = join(root, 'canvas-ubc.mcpb');

/**
 * `npm` and `npx` are `.cmd` shims on Windows, so they need a shell — and a shell
 * concatenates the argument list rather than passing it through, which splits any
 * path containing a space. This project's own directory is usually one of those,
 * so arguments are quoted here instead of hoping they are all single words.
 */
const run = (cmd, args, opts = {}) => {
    const shell = process.platform === 'win32';
    const argv = shell ? args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)) : args;
    return execFileSync(cmd, argv, { cwd: root, encoding: 'utf8', shell, ...opts });
};

function step(message) {
    console.log(`\n→ ${message}`);
}

/**
 * The tools the built server actually registers.
 *
 * `manifest.json` restates them for the install screen, and Claude Desktop shows
 * that list before the student grants anything. A stale entry there is a promise
 * the server does not keep, so it is checked rather than trusted.
 */
async function actualTools() {
    const requests = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pack', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ];

    // Credentials good enough to construct the client; this never reaches Canvas.
    const child = spawn(process.execPath, [join(root, 'build', 'src', 'index.js')], {
        cwd: root,
        env: { ...process.env, CANVAS_BASE_URL: 'https://canvas.ubc.ca', CANVAS_SESSION_COOKIE: 'x'.repeat(64) },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stdin.write(requests.map((r) => JSON.stringify(r)).join('\n') + '\n');
    child.stdin.end();

    await new Promise((res, rej) => {
        child.on('close', res);
        child.on('error', rej);
        setTimeout(() => child.kill(), 15_000).unref?.();
    });

    for (const line of out.split('\n')) {
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id === 2 && msg.result) return msg.result.tools.map((t) => t.name).sort();
    }
    throw new Error(`Could not read tools/list from the built server. Output was:\n${out}`);
}

/** Absolute paths of the production dependency tree, devDependencies excluded. */
function productionDependencies() {
    const listed = run('npm', ['ls', '--omit=dev', '--all', '--parseable'])
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => resolve(l));
    // The first entry is the project itself.
    return listed.filter((p) => p !== resolve(root) && p.includes('node_modules'));
}

/** Fails loudly if anything that could carry a credential reached the staging tree. */
async function assertNoSecrets(dir) {
    const forbidden = /^\.env(\..*)?$|\.pem$|\.key$|^\.git$|^\.npmrc$/i;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (forbidden.test(entry.name)) {
            throw new Error(`Refusing to pack: ${join(dir, entry.name)} must never ship in the bundle.`);
        }
        if (entry.isDirectory()) await assertNoSecrets(join(dir, entry.name));
    }
}

step('Type-checking and building');
run('npm', ['run', 'build'], { stdio: 'inherit' });

step('Checking manifest.json against the tools the server registers');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const declared = manifest.tools.map((t) => t.name).sort();
const registered = await actualTools();
if (declared.join() !== registered.join()) {
    const missing = registered.filter((n) => !declared.includes(n));
    const extra = declared.filter((n) => !registered.includes(n));
    throw new Error(
        'manifest.json "tools" is out of date.' +
            (missing.length ? `\n  Registered but not declared: ${missing.join(', ')}` : '') +
            (extra.length ? `\n  Declared but not registered: ${extra.join(', ')}` : ''),
    );
}
console.log(`  ${registered.length} tools, all accounted for.`);

step(`Staging ${relative(root, stage)}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// Only the compiled server: build/scripts holds the maintainer's cookie helper,
// which has no business in a student's install.
cpSync(join(root, 'build', 'src'), join(stage, 'build', 'src'), {
    recursive: true,
    filter: (src) => !src.endsWith('.map'),
});
for (const file of ['manifest.json', 'icon.png']) {
    cpSync(join(root, file), join(stage, file));
}

// Node needs `"type": "module"` beside the compiled ESM output, but the rest of
// package.json describes a development checkout that will not exist here.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(
    join(stage, 'package.json'),
    JSON.stringify(
        {
            name: pkg.name,
            version: pkg.version,
            description: pkg.description,
            type: pkg.type,
            private: true,
            dependencies: pkg.dependencies,
        },
        null,
        2,
    ) + '\n',
);

step('Copying production dependencies');
const deps = productionDependencies();
for (const dep of deps) {
    const target = join(stage, relative(root, dep));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(dep, target, { recursive: true, filter: (src) => !/[\\/]\.(bin|cache)[\\/]?$/.test(src) });
}
console.log(`  ${deps.length} packages.`);

step('Verifying no credentials were staged');
await assertNoSecrets(stage);
console.log('  Clean.');

step('Validating and packing');
run('npx', ['--yes', '@anthropic-ai/mcpb@latest', 'validate', join(stage, 'manifest.json')], { stdio: 'inherit' });
rmSync(output, { force: true });
run('npx', ['--yes', '@anthropic-ai/mcpb@latest', 'pack', stage, output], { stdio: 'inherit' });

if (!existsSync(output)) throw new Error('mcpb pack reported success but produced no file.');
console.log(`\n✓ ${relative(root, output)} is ready to hand out.`);
