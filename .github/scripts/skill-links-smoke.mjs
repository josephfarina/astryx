#!/usr/bin/env node
// Skill-link and custom-prefix smoke for the Astryx CLI (fork-only, runs after the repo smoke). One Node script, no dependencies.
//
//   node global-mode-smoke.mjs --packs <dir with astryxdesign-cli-*.tgz and astryxdesign-core-*.tgz> [--out results.json]
//
// It starts small local package registries in this process (they forward to the public registry and add the
// packed branch packages), installs the packed CLI globally with npm into a throwaway prefix, and checks, in
// throwaway folders with a throwaway home folder:
//   - which release answers in a project with its own CLI, a project with Core only, a fresh clone and an empty
//     folder; the one-line "answered by" notice; --json output that is clean JSON with nothing on stderr;
//   - that a fresh clone gets nothing written into it;
//   - the background update switch (and the one-time notice) when the registry's latest tag moves;
//   - offline: ERR_VERSIONS_UNAVAILABLE, quickly, with JSON intact;
//   - stopping a run in the middle of a release install (Ctrl-C, and killing the CLI process alone): which
//     package-manager processes are left, and whether the next run recovers;
//   - `astryx init --user` / `--remove-agents` (files under the home folder, valid frontmatter, nothing in the project);
//   - the commands the CLI prints, pasted into PowerShell and cmd (Windows) or sh (macOS, Linux).
// Exit status 1 when any check fails. Results are written as JSON, and as Markdown to $GITHUB_STEP_SUMMARY when set.

import {spawn, execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const UPSTREAM = args.upstream || 'https://registry.npmjs.org';
const OUT = args.out || 'global-mode-smoke-results.json';
const results = [];
const T0 = Date.now();

function log(...a) {
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
}
function record(name, status, detail) {
  results.push({name, status, detail});
  log(`${status.toUpperCase().padEnd(4)} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}
const ok = (name, cond, detail) => record(name, cond ? 'pass' : 'fail', detail);

// ---------------------------------------------------------------- packed branch packages
function readTgzPackageJson(file) {
  const buf = zlib.gunzipSync(fs.readFileSync(file));
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    let name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    if (prefix) name = `${prefix}/${name}`;
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === 'x') {
      const m = body.toString('utf8').match(/\d+ path=([^\n]+)\n/);
      if (m) longName = m[1];
    } else {
      if (longName) name = longName;
      longName = null;
      if (name.replace(/^[^/]+\//, '') === 'package.json' && name.split('/').length === 2) return JSON.parse(body.toString('utf8'));
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`no package.json in ${file}`);
}

const packsDir = path.resolve(args.packs || 'packs');
const packFiles = fs.readdirSync(packsDir).filter(f => f.endsWith('.tgz'));
const overlay = {};
for (const f of packFiles) {
  const file = path.join(packsDir, f);
  const pj = readTgzPackageJson(file);
  if (!['@astryxdesign/cli', '@astryxdesign/core'].includes(pj.name)) continue;
  const bytes = fs.readFileSync(file);
  overlay[pj.name] = {pj, bytes, integrity: 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64'), shasum: crypto.createHash('sha1').update(bytes).digest('hex')};
}
if (!overlay['@astryxdesign/cli'] || !overlay['@astryxdesign/core']) {
  console.error(`need packed @astryxdesign/cli and @astryxdesign/core in ${packsDir}`);
  process.exit(2);
}
const LABEL = overlay['@astryxdesign/cli'].pj.version;
if (overlay['@astryxdesign/core'].pj.version !== LABEL) {
  console.error('packed CLI and Core versions differ');
  process.exit(2);
}

// ---------------------------------------------------------------- local registries
const upstreamCache = new Map();
async function upstreamPackument(name, accept) {
  const key = `${name}|${accept}`;
  if (!upstreamCache.has(key)) {
    upstreamCache.set(key, (async () => {
      const r = await fetch(`${UPSTREAM}/${name.replace('/', '%2f')}`, {headers: {accept}});
      if (!r.ok) return null;
      return r.text();
    })());
  }
  const t = await upstreamCache.get(key);
  return t == null ? null : JSON.parse(t);
}

function startRegistry({latest = null, throttleBytesPerSec = 0} = {}) {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const self = `http://127.0.0.1:${server.address().port}`;
        const tgz = url.match(/^\/((?:@[^/]+\/)?[^/]+)\/-\/(.+\.tgz)$/);
        if (tgz) {
          const [, name, file] = tgz;
          let body;
          if (overlay[name] && file.endsWith(`-${LABEL}.tgz`)) body = overlay[name].bytes;
          else {
            const r = await fetch(`${UPSTREAM}/${name}/-/${file}`);
            if (!r.ok) {
              res.writeHead(r.status);
              return res.end();
            }
            body = Buffer.from(await r.arrayBuffer());
          }
          res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': body.length});
          if (!throttleBytesPerSec) return res.end(body);
          let i = 0;
          const step = Math.max(1, Math.floor(throttleBytesPerSec / 10));
          const t = setInterval(() => {
            if (res.destroyed) return clearInterval(t);
            res.write(body.subarray(i, i + step));
            i += step;
            if (i >= body.length) {
              clearInterval(t);
              res.end();
            }
          }, 100);
          return;
        }
        const m = url.match(/^\/((?:@[^/]+\/)?[^/@]+)(?:\/(.+))?$/);
        if (!m || url.startsWith('/-/')) {
          res.writeHead(404);
          return res.end('{}');
        }
        const name = m[1];
        const accept = req.headers.accept && req.headers.accept.includes('install-v1') ? 'application/vnd.npm.install-v1+json' : 'application/json';
        const p = await upstreamPackument(name, accept);
        if (!p) {
          res.writeHead(404);
          return res.end('{}');
        }
        if (throttleBytesPerSec) {
          for (const v of Object.values(p.versions || {})) if (v.dist?.tarball) v.dist.tarball = v.dist.tarball.replace(/^https?:\/\/[^/]+/, self);
        }
        if (overlay[name]) {
          const o = overlay[name];
          const keep = ['dependencies', 'peerDependencies', 'peerDependenciesMeta', 'optionalDependencies', 'bin', 'engines'];
          p.versions[LABEL] = {
            name, version: LABEL, ...Object.fromEntries(keep.filter(k => o.pj[k]).map(k => [k, o.pj[k]])),
            dist: {tarball: `${self}/${name}/-/${name.split('/')[1]}-${LABEL}.tgz`, integrity: o.integrity, shasum: o.shasum},
          };
          if (p.time) p.time[LABEL] = new Date(Date.now() - 3 * 86400e3).toISOString();
          p['dist-tags'] = {...p['dist-tags'], latest: latest || LABEL};
        }
        if (m[2]) {
          const v = p['dist-tags'][m[2]] || m[2];
          const body = p.versions[v];
          res.writeHead(body ? 200 : 404, {'content-type': 'application/json'});
          return res.end(JSON.stringify(body || {}));
        }
        const body = Buffer.from(JSON.stringify(p));
        res.writeHead(200, {'content-type': 'application/json', 'content-length': body.length});
        res.end(body);
      } catch (e) {
        res.writeHead(502);
        res.end(JSON.stringify({error: String(e)}));
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({server, url: `http://127.0.0.1:${server.address().port}/`}));
  });
}

// ---------------------------------------------------------------- processes
function quoteWin(a) {
  return /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}
function run(cmd, argv, {cwd, env, timeoutMs = 300_000, shell = false, input = null} = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let child;
    if (shell && WIN) child = spawn('cmd.exe', ['/d', '/s', '/c', `"${[cmd, ...argv].map(quoteWin).join(' ')}"`], {cwd, env, windowsVerbatimArguments: true});
    else child = spawn(cmd, argv, {cwd, env});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
    const timer = setTimeout(() => {
      stderr += '\n[smoke: timed out]';
      try {
        if (WIN) execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {stdio: 'ignore'});
        else child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({code, signal, stdout, stderr, secs: +((Date.now() - t0) / 1000).toFixed(2)});
    });
    child.on('error', e => {
      clearTimeout(timer);
      resolve({code: -1, signal: null, stdout, stderr: stderr + String(e), secs: +((Date.now() - t0) / 1000).toFixed(2)});
    });
  });
}

function listProcesses(match) {
  try {
    if (WIN) {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${match}*' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`], {encoding: 'utf8'});
      if (!out.trim()) return [];
      const j = JSON.parse(out);
      return (Array.isArray(j) ? j : [j]).filter(p => !String(p.CommandLine).includes('Get-CimInstance')).map(p => ({pid: p.ProcessId, cmd: String(p.CommandLine).slice(0, 160)}));
    }
    const out = execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'});
    return out.split('\n').filter(l => l.includes(match) && !l.includes('ps -axo')).map(l => ({pid: +l.trim().split(/\s+/)[0], cmd: l.trim().slice(0, 160)}));
  } catch (e) {
    return [{error: String(e).slice(0, 200)}];
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- setup
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-smoke-'));
const PREFIX = path.join(WORK, 'prefix');
const BIN_DIR = WIN ? PREFIX : path.join(PREFIX, 'bin');
const CLI_ENTRY = path.join(PREFIX, WIN ? '' : 'lib', 'node_modules', '@astryxdesign', 'cli', 'clients', 'cli', 'bin', 'astryx.mjs');

function homeEnv(home, registry) {
  const env = {...process.env};
  for (const k of Object.keys(env)) if (/^(npm_|NPM_|XDG_CACHE_HOME$|ASTRYX)/.test(k)) delete env[k];
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  const oldPath = env[pathKey] || '';
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'PATH') delete env[k];
  env[pathKey] = `${BIN_DIR}${path.delimiter}${oldPath}`;
  Object.assign(env, {
    HOME: home, USERPROFILE: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), APPDATA: path.join(home, 'AppData', 'Roaming'),
    npm_config_registry: registry, npm_config_cache: path.join(WORK, 'npm-cache'), npm_config_update_notifier: 'false',
    npm_config_fund: 'false', npm_config_audit: 'false', NO_COLOR: '1',
  });
  return env;
}
function newHome(name) {
  const h = path.join(WORK, 'homes', name);
  fs.mkdirSync(path.join(h, 'AppData', 'Local'), {recursive: true});
  fs.mkdirSync(path.join(h, 'AppData', 'Roaming'), {recursive: true});
  return h;
}
function cacheDirOf(home) {
  if (WIN) return path.join(home, 'AppData', 'Local', 'astryx', 'Cache');
  if (MAC) return path.join(home, 'Library', 'Caches', 'astryx');
  return path.join(home, '.cache', 'astryx');
}
const npmCmd = 'npm';
const astryx = (argv, opts) => run('astryx', argv, {...opts, shell: true});
const astryxDirect = (argv, opts) => run(process.execPath, [CLI_ENTRY, ...argv], opts);

function listTree(dir) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.name === 'node_modules') continue;
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}
const lastLine = s => (s.trim().split(/\r?\n/).pop() || '').trim();
const whoLines = s => s.split(/\r?\n/).filter(l => l.startsWith('astryx: ') && !/installing|waiting/i.test(l));
function cleanJson(r) {
  try {
    const j = JSON.parse(r.stdout);
    return {json: j, clean: r.stderr.trim() === ''};
  } catch {
    return {json: null, clean: false};
  }
}

async function makeProject(dir, deps, registry) {
  fs.mkdirSync(path.join(dir, 'src'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: path.basename(dir), version: '1.0.0', private: true, dependencies: deps}, null, 2));
  const env = homeEnv(newHome(`fx-${path.basename(dir)}`), registry);
  const r = await run(npmCmd, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], {cwd: dir, env, shell: true, timeoutMs: 600_000});
  if (r.code !== 0) throw new Error(`npm install in ${dir} failed: ${r.stderr.slice(-800)}`);
}


// ---------------------------------------------------------------- skill links + custom prefix checks
const isLinkish = p => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
const exists = p => { try { fs.lstatSync(p); return true; } catch { return false; } };
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
async function doctorCheck(env, cwd, id) {
  const r = await astryx(['doctor', '--json'], {cwd, env});
  try { return (JSON.parse(r.stdout).data.checks || []).find(c => c.id === id) || null; } catch { return null; }
}

async function main() {
  log(`platform ${process.platform} ${os.release()} node ${process.version}; branch label ${LABEL}`);
  const reg = await startRegistry();
  const gi = await run(npmCmd, ['install', '-g', '--prefix', PREFIX, `@astryxdesign/cli@${LABEL}`, '--no-audit', '--no-fund', '--loglevel=error'],
    {env: homeEnv(newHome('install'), reg.url), shell: true, timeoutMs: 600_000});
  ok('global npm install of the packed CLI', gi.code === 0, `rc=${gi.code} ${gi.stderr.trim().slice(-300)}`);
  if (gi.code !== 0) return;
  const empty = path.join(WORK, 'empty'); fs.mkdirSync(empty, {recursive: true});

  // one file, links (junctions on Windows) or a copy, the Continue copy
  const home = newHome('links');
  for (const d of ['.continue', '.kiro', path.join('.codeium', 'windsurf')]) fs.mkdirSync(path.join(home, d), {recursive: true});
  const env = homeEnv(home, reg.url);
  const r = await astryx(['init', '--user'], {cwd: empty, env});
  const main = path.join(home, '.agents', 'skills', 'astryx');
  const mainFile = path.join(main, 'SKILL.md');
  const text = read(mainFile);
  ok('init --user: one file at ~/.agents/skills/astryx/SKILL.md', r.code === 0 && !!text && !isLinkish(main), `rc=${r.code} ${r.stderr.trim().slice(-200)}`);
  for (const rel of [path.join('.claude', 'skills', 'astryx'), path.join('.kiro', 'skills', 'astryx'), path.join('.codeium', 'windsurf', 'skills', 'astryx')]) {
    const p = path.join(home, rel);
    let kind = !exists(p) ? 'missing' : isLinkish(p) ? 'link' : 'copy';
    let target = null;
    try { target = kind === 'link' ? fs.readlinkSync(p) : null; } catch {}
    ok(`${rel}: a link/junction (or a copy) whose SKILL.md reads the same`, kind !== 'missing' && read(path.join(p, 'SKILL.md')) === text, `kind=${kind} target=${target}`);
  }
  const cont = path.join(home, '.continue', 'skills', 'astryx');
  ok('Continue: a real copy, identical', exists(cont) && !isLinkish(cont) && read(path.join(cont, 'SKILL.md')) === text, `exists=${exists(cont)} link=${isLinkish(cont)}`);
  const c1 = await doctorCheck(env, empty, 'computer-agent-text');
  ok('doctor computer-agent-text: no warning', c1 && c1.status !== 'warn' && c1.status !== 'fail', JSON.stringify(c1).slice(0, 300));
  fs.rmSync(main, {recursive: true, force: true});
  const c2 = await doctorCheck(env, empty, 'computer-agent-text');
  ok('main folder deleted: doctor names the dangling links and gives a fix (the check is info-only)', c2 && /points to is not there/.test(c2.message || '') && !!c2.fix, JSON.stringify(c2).slice(0, 400));
  await astryx(['init', '--user'], {cwd: empty, env});
  ok('init --user repairs it', read(path.join(home, '.claude', 'skills', 'astryx', 'SKILL.md')) === text, 'repaired');
  const rm = await astryx(['init', '--user', '--remove-agents'], {cwd: empty, env});
  const left = [main, cont, path.join(home, '.claude', 'skills', 'astryx'), path.join(home, '.kiro', 'skills', 'astryx'), path.join(home, '.codeium', 'windsurf', 'skills', 'astryx')].filter(exists);
  ok('--remove-agents removes the file, every link/junction and the Continue copy', rm.code === 0 && left.length === 0, `rc=${rm.code} left=${JSON.stringify(left)}`);

  // a user's own folder is never replaced
  const home2 = newHome('foreign');
  fs.mkdirSync(path.join(home2, '.claude', 'skills', 'astryx'), {recursive: true});
  fs.writeFileSync(path.join(home2, '.claude', 'skills', 'astryx', 'SKILL.md'), 'mine\n');
  await astryx(['init', '--user'], {cwd: empty, env: homeEnv(home2, reg.url)});
  ok("a user's own ~/.claude/skills/astryx is kept", read(path.join(home2, '.claude', 'skills', 'astryx', 'SKILL.md')) === 'mine\n', 'kept');

  // custom npm prefixes
  for (const [label, how] of [['--prefix', 'flag'], ['NPM_CONFIG_PREFIX', 'env']]) {
    const h = newHome(`prefix-${how}`);
    const pre = path.join(h, how === 'flag' ? '.local' : 'npmenv');
    const e = homeEnv(h, reg.url);
    if (how === 'env') e.NPM_CONFIG_PREFIX = pre;
    const argv = ['install', '-g', ...(how === 'flag' ? ['--prefix', pre] : []), `@astryxdesign/cli@${LABEL}`, '--no-audit', '--no-fund', '--loglevel=error'];
    const ir = await run(npmCmd, argv, {env: e, shell: true, timeoutMs: 600_000});
    const bin = WIN ? pre : path.join(pre, 'bin');
    const pk = Object.keys(e).find(k => k.toUpperCase() === 'PATH');
    const e2 = {...e, [pk]: [bin, ...e[pk].split(path.delimiter).filter(p => p !== BIN_DIR)].join(path.delimiter)};
    const v = await astryx(['--version'], {cwd: empty, env: e2});
    ok(`npm ${label}: astryx runs from the custom prefix`, ir.code === 0 && lastLine(v.stdout) === LABEL, `rc=${ir.code} ${lastLine(v.stdout)} ${ir.stderr.trim().slice(-200)}`);
    const c = await doctorCheck(e2, empty, 'cli-on-path');
    ok(`npm ${label}: doctor cli-on-path names it`, c && JSON.stringify(c).toLowerCase().includes(path.basename(pre).toLowerCase()), JSON.stringify(c).slice(0, 300));
  }
}

main().catch(e => record('skill-links harness', 'fail', String(e.stack || e).slice(0, 800))).finally(() => {
  const summary = {platform: process.platform, release: os.release(), node: process.version, label: LABEL, results,
    pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length, info: results.filter(r => r.status === 'info').length};
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  const md = [`### Skill links + prefix smoke: ${process.platform}, Node ${process.version}, CLI ${LABEL}`, '', `pass ${summary.pass} · fail ${summary.fail} · info ${summary.info}`, '',
    '| Check | Result | Detail |', '|---|---|---|', ...results.map(r => `| ${r.name} | ${r.status} | ${String(r.detail).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 300)} |`)].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log('\n' + md);
  process.exit(summary.fail ? 1 : 0);
});
