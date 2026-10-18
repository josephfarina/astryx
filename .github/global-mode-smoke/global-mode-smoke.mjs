#!/usr/bin/env node
// Global-mode smoke test for the Astryx CLI: one Node script, no dependencies, runs on macOS, Windows and Linux.
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

// ---------------------------------------------------------------- main
async function main() {
  log(`platform ${process.platform} ${os.release()} node ${process.version}; branch label ${LABEL}; work ${WORK}`);
  const regMain = await startRegistry();
  const regLatest071 = await startRegistry({latest: '0.7.1'});
  const regSlow = await startRegistry({throttleBytesPerSec: 20_000});
  const OFFLINE = 'http://127.0.0.1:9/';
  const npmV = await run(npmCmd, ['--version'], {env: homeEnv(newHome('v'), regMain.url), shell: true});
  log(`npm ${npmV.stdout.trim()}`);

  // global install of the packed branch
  const homeG = newHome('global');
  const gi = await run(npmCmd, ['install', '-g', '--prefix', PREFIX, `@astryxdesign/cli@${LABEL}`, '--no-audit', '--no-fund', '--loglevel=error'],
    {env: homeEnv(homeG, regMain.url), shell: true, timeoutMs: 600_000});
  ok('global npm install of the packed CLI', gi.code === 0 && fs.existsSync(CLI_ENTRY), `rc=${gi.code} ${gi.stderr.trim().slice(-300)}`);
  if (gi.code !== 0) return;

  // fixtures
  const FX = path.join(WORK, 'fx');
  const own068 = path.join(FX, 'own 068');  // a space in the path on purpose
  const core071 = path.join(FX, 'core071');
  const core070 = path.join(FX, 'core070');
  const core063 = path.join(FX, 'core063');
  const fresh068 = path.join(FX, 'fresh068');
  const empty = path.join(FX, 'empty', 'a');
  await Promise.all([
    makeProject(own068, {'@astryxdesign/cli': '0.6.8', '@astryxdesign/core': '0.6.8'}, regMain.url),
    makeProject(core071, {'@astryxdesign/core': '0.7.1'}, regMain.url),
    makeProject(core070, {'@astryxdesign/core': '0.7.0'}, regMain.url),
    makeProject(core063, {'@astryxdesign/core': '0.6.3'}, regMain.url),
  ]);
  fs.mkdirSync(path.join(fresh068, 'src'), {recursive: true});
  const fdeps = {'@astryxdesign/cli': '0.6.8', '@astryxdesign/core': '0.6.8'};
  fs.writeFileSync(path.join(fresh068, 'package.json'), JSON.stringify({name: 'fresh068', version: '1.0.0', private: true, dependencies: fdeps}, null, 2));
  fs.writeFileSync(path.join(fresh068, 'package-lock.json'), JSON.stringify({name: 'fresh068', lockfileVersion: 3, requires: true, packages: {
    '': {name: 'fresh068', dependencies: fdeps},
    'node_modules/@astryxdesign/cli': {version: '0.6.8'}, 'node_modules/@astryxdesign/core': {version: '0.6.8'}}}, null, 2));
  fs.mkdirSync(empty, {recursive: true});
  log('fixtures ready');

  // which release answers, the notice, --json clean
  const homeA = newHome('answers');
  const envA = homeEnv(homeA, regMain.url);
  const cases = [
    ['project with its own CLI 0.6.8', own068, '0.6.8', `answered by this project's CLI 0.6.8, handed over from CLI ${LABEL}`],
    ['project with Core 0.7.1 only', core071, '0.7.1', "answered by CLI 0.7.1 with Core 0.7.1, the release that matches this project's Core"],
    ['fresh clone (lockfile 0.6.8, nothing installed)', fresh068, '0.6.8', "answered by CLI 0.6.8 with Core 0.6.8, the release that matches this project's Core"],
    ['empty folder', empty, LABEL, 'outside a project'],
  ];
  for (const [label, dir, want, line] of cases) {
    const before = listTree(dir);
    const v = await astryx(['--version'], {cwd: dir, env: envA});
    const who = whoLines(v.stderr);
    ok(`${label}: release`, v.code === 0 && lastLine(v.stdout) === want, `rc=${v.code} answered ${lastLine(v.stdout)} (want ${want}) ${v.secs}s`);
    ok(`${label}: one notice line`, who.length === 1 && who[0].includes(line), who.join(' | ') || v.stderr.trim().slice(-200));
    const j = await astryx(['component', 'Typeahead', '--json'], {cwd: dir, env: envA});
    const {json, clean} = cleanJson(j);
    const ab = json?.meta?.answeredBy;
    const abOk = want === LABEL ? ab && ab.cli === LABEL : true;  // older releases predate the field
    // a fresh clone has no Core installed: the matched release answers as it would there (ERR_CORE_NOT_FOUND), still as clean JSON
    const rcOk = j.code === 0 || (dir === fresh068 && json?.code === 'ERR_CORE_NOT_FOUND');
    ok(`${label}: --json clean`, rcOk && json && clean && abOk, `rc=${j.code} json=${!!json} code=${json?.code ?? '-'} stderr=${JSON.stringify(j.stderr.trim().slice(0, 160))} answeredBy=${JSON.stringify(ab)}`);
    if (dir === fresh068) {
      const after = listTree(dir);
      ok(`${label}: nothing written in the project`, JSON.stringify(before) === JSON.stringify(after), `before=${before.length} after=${after.length} new=${after.filter(f => !before.includes(f)).slice(0, 4)}`);
    }
  }

  // printed commands, pasted into the shells people use
  for (const [label, dir, want] of [['project with Core 0.7.1 only', core071, '0.7.1'], ['empty folder', empty, LABEL]]) {
    const b = await astryx(['build', 'settings page'], {cwd: dir, env: envA});
    const line = (b.stdout + '\n' + b.stderr).split(/\r?\n/).find(l => /^command:\s+/.test(l));
    if (!line) {
      ok(`${label}: printed command found`, false, b.stdout.slice(0, 300));
      continue;
    }
    const printed = line.replace(/^command:\s+/, '').trim();
    const target = `out-${Math.random().toString(36).slice(2, 6)}/Settings.tsx`;
    const cmd = printed.replace('<path>', target);
    const shells = WIN ? [['PowerShell', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]], ['cmd', 'cmd.exe', ['/d', '/s', '/c', cmd]]]
      : [['sh', '/bin/sh', ['-c', cmd]]];
    for (const [sname, exe, argv] of shells) {
      const t = path.join(dir, target.split('/')[0]);
      fs.rmSync(t, {recursive: true, force: true});
      const r = await run(exe, argv, {cwd: dir, env: envA, timeoutMs: 300_000});
      const made = fs.existsSync(path.join(dir, target));
      const same = r.stderr.includes(`CLI ${want} with Core`) || r.stderr.includes(`project's CLI ${want}`);
      ok(`${label}: printed command runs in ${sname} and reaches ${want}`, r.code === 0 && made && same, `${printed} -> rc=${r.code} wrote=${made} answered=${JSON.stringify(whoLines(r.stderr))} ${r.code ? r.stderr.trim().slice(-200) : ''}`);
      fs.rmSync(t, {recursive: true, force: true});
    }
  }

  // init --user in a project on an older release (computer-level text)
  {
    const home = newHome('user-text');
    const env = homeEnv(home, regMain.url);
    const before = listTree(own068);
    const r = await astryx(['init', '--user'], {cwd: own068, env});
    const files = [path.join(home, '.agents', 'skills', 'astryx', 'SKILL.md'), path.join(home, '.claude', 'skills', 'astryx', 'SKILL.md')];
    const exist = files.map(f => fs.existsSync(f));
    const txt = exist[0] ? fs.readFileSync(files[0], 'utf8') : '';
    const same = exist.every(Boolean) && txt === fs.readFileSync(files[1], 'utf8');
    const desc = (txt.match(/^description: (.*)$/m) || [])[1] || '';
    const quoted = /^".*"$/.test(desc);
    ok('init --user writes both skill files under the home folder', r.code === 0 && same, `rc=${r.code} files=${files.map(f => path.relative(home, f)).join(', ')} exist=${exist} identical=${same}`);
    ok('init --user skill frontmatter description is quoted', quoted, desc.slice(0, 80));
    ok('init --user writes nothing in the project', JSON.stringify(before) === JSON.stringify(listTree(own068)), 'project unchanged');
    const rm = await astryx(['init', '--user', '--remove-agents'], {cwd: own068, env});
    ok('init --user --remove-agents removes them', rm.code === 0 && files.every(f => !fs.existsSync(f)), `rc=${rm.code}`);
  }

  // offline, cold cache
  {
    const home = newHome('offline');
    const r = await astryx(['component', 'Typeahead', '--json'], {cwd: core070, env: homeEnv(home, OFFLINE), });
    let j = null;
    try {
      j = JSON.parse(r.stdout);
    } catch {}
    ok('offline, release not cached: ERR_VERSIONS_UNAVAILABLE', r.code !== 0 && j?.code === 'ERR_VERSIONS_UNAVAILABLE' && r.secs < 90, `rc=${r.code} code=${j?.code} ${r.secs}s`);
    const o = await astryx(['--version'], {cwd: empty, env: homeEnv(home, OFFLINE)});
    ok('offline, outside a project: answers at once', o.code === 0 && lastLine(o.stdout) === LABEL && o.secs < 20, `rc=${o.code} ${lastLine(o.stdout)} ${o.secs}s`);
  }

  // stopping a run in the middle of a release install
  for (const how of ['ctrl-c', 'kill-cli-only']) {
    const home = newHome(`stop-${how}`);
    const env = homeEnv(home, regSlow.url);
    const child = spawn(process.execPath, [CLI_ENTRY, '--version'], {cwd: core063, env, detached: !WIN});
    let err = '';
    child.stderr.on('data', d => (err += d));
    child.stdout.on('data', () => {});
    const started = Date.now();
    while (!/installing/i.test(err) && Date.now() - started < 30_000) await sleep(250);
    await sleep(3000);
    const during = listProcesses('@astryxdesign/cli@0.6.3');
    if (how === 'ctrl-c') {
      if (WIN) {
        // no console to send Ctrl-C to from here; closest equivalent is ending the process tree
        try { execFileSync('taskkill', ['/pid', String(child.pid), '/t'], {stdio: 'ignore'}); } catch {}
      } else process.kill(-child.pid, 'SIGINT');
    } else {
      child.kill('SIGKILL');  // the CLI process alone (TerminateProcess on Windows)
    }
    const closed = await Promise.race([new Promise(r => child.on('close', () => r(true))), sleep(15_000).then(() => false)]);
    if (!closed) {
      child.kill('SIGKILL');
      await new Promise(r => child.on('close', r));
    }
    await sleep(3000);
    const left = listProcesses('@astryxdesign/cli@0.6.3');
    const status = left.length === 0 ? 'pass' : (WIN ? 'info' : 'fail');  // Windows: documented limit, reported
    record(`stop during install (${how}): no package-manager process left`, status,
      `${WIN ? (how === 'ctrl-c' ? 'taskkill /t' + (closed ? '' : ' then forced') : 'TerminateProcess') + '; ' : ''}progress line=${/installing/i.test(err)} npm processes during=${during.length} after=${left.length} ${JSON.stringify(left).slice(0, 300)}`);
    for (const p of left) if (p.pid) try { process.kill(p.pid, 'SIGKILL'); } catch {}
    const again = await astryxDirect(['--version'], {cwd: core063, env: homeEnv(home, regMain.url), timeoutMs: 400_000});
    ok(`stop during install (${how}): next run recovers`, again.code === 0 && lastLine(again.stdout) === '0.6.3', `rc=${again.code} ${lastLine(again.stdout)} ${again.secs}s`);
  }

  // case-insensitive file systems (macOS default APFS, Windows NTFS): the same folder spelled in another case
  {
    const caseDir = path.join(FX, 'CaseProj');
    await makeProject(caseDir, {'@astryxdesign/core': '0.7.1'}, regMain.url);
    const other = path.join(FX, 'caseproj');
    const insensitive = fs.existsSync(other);
    if (!insensitive) record('case: file system is case-sensitive here', 'info', 'skipped');
    else {
      const home = newHome('case');
      const env = homeEnv(home, regMain.url);
      const a = await astryx(['--version'], {cwd: caseDir, env});
      const b = await astryx(['--version'], {cwd: path.join(other, 'src'), env});
      const rel = fs.existsSync(path.join(cacheDirOf(home), 'releases')) ? fs.readdirSync(path.join(cacheDirOf(home), 'releases')).filter(n => !n.startsWith('.')) : [];
      ok('case: project reached through a differently cased path answers the same release', lastLine(a.stdout) === '0.7.1' && lastLine(b.stdout) === '0.7.1' && whoLines(b.stderr).length === 1,
        `CaseProj -> ${lastLine(a.stdout)}; caseproj/src -> ${lastLine(b.stdout)} ${JSON.stringify(whoLines(b.stderr))}`);
      ok('case: no second install for the same release', rel.filter(n => n.toLowerCase() === '0.7.1').length === 1 && !/installing/i.test(b.stderr), `releases=${JSON.stringify(rel)}`);
      // the home folder spelled in another case (USERPROFILE / HOME casing differs between tools)
      const homeAlt = home.replace(/homes([\\/])case$/, 'HOMES$1CASE');
      if (homeAlt !== home && fs.existsSync(homeAlt)) {
        const c = await astryx(['--version'], {cwd: caseDir, env: homeEnv(homeAlt, regMain.url)});
        ok('case: home folder spelled in another case reuses the cache', lastLine(c.stdout) === '0.7.1' && !/installing/i.test(c.stderr), `${lastLine(c.stdout)} ${JSON.stringify(c.stderr.trim().split(/\r?\n/).slice(0, 2))}`);
      }
      // a project folder whose own CLI is spelled in another case on PATH lookups
      const d = await astryx(['component', 'Typeahead', '--json'], {cwd: path.join(other, 'src'), env});
      const {json, clean} = cleanJson(d);
      ok('case: --json clean through the differently cased path', d.code === 0 && json && clean, `rc=${d.code} stderr=${JSON.stringify(d.stderr.trim().slice(0, 120))}`);
    }
  }

  // two global installs on PATH: the branch and an older release that predates global mode
  {
    const PREFIX2 = path.join(WORK, 'prefix-old');
    const BIN2 = WIN ? PREFIX2 : path.join(PREFIX2, 'bin');
    const home = newHome('two-globals');
    const base = homeEnv(home, regMain.url);
    const gi2 = await run(npmCmd, ['install', '-g', '--prefix', PREFIX2, '@astryxdesign/cli@0.7.1', '--no-audit', '--no-fund', '--loglevel=error'], {env: base, shell: true, timeoutMs: 600_000});
    const pk = Object.keys(base).find(k => k.toUpperCase() === 'PATH');
    const rest = base[pk].split(path.delimiter).filter(p => p !== BIN_DIR);
    const envA = {...base, [pk]: [BIN_DIR, BIN2, ...rest].join(path.delimiter)};
    const envB = {...base, [pk]: [BIN2, BIN_DIR, ...rest].join(path.delimiter)};
    const a = await astryx(['--version'], {cwd: core070, env: envA});
    const b = await astryx(['--version'], {cwd: core070, env: envB});
    ok('two global installs, branch first on PATH: hands off (Core 0.7.0 project)', gi2.code === 0 && lastLine(a.stdout) === '0.7.0', `install rc=${gi2.code}; answered ${lastLine(a.stdout)}`);
    record('two global installs, 0.7.1 first on PATH', 'info', `answered ${lastLine(b.stdout)} (0.7.1 predates the hand-off and answers itself)`);
  }

  // background update switch (outside a project), last because it changes what answers outside projects
  {
    const home = newHome('update');
    const env1 = homeEnv(home, regLatest071.url);
    await astryx(['--version'], {cwd: empty, env: env1});
    const gfile = path.join(cacheDirOf(home), 'global.json');
    let st = {};
    try { st = JSON.parse(fs.readFileSync(gfile, 'utf8')); } catch {}
    st.firstRunAt = Date.now() - 2 * 3600e3;
    fs.mkdirSync(path.dirname(gfile), {recursive: true});
    fs.writeFileSync(gfile, JSON.stringify(st));
    const kick = await astryx(['--version'], {cwd: empty, env: env1});
    const lock = path.join(cacheDirOf(home), '.lock-check');
    const t = Date.now();
    await sleep(2000);
    while (fs.existsSync(lock) && Date.now() - t < 240_000) await sleep(1000);
    await sleep(1500);
    const js = await astryx(['search', 'button', '--json'], {cwd: empty, env: env1});
    const a = await astryx(['--version'], {cwd: empty, env: env1});
    const b = await astryx(['--version'], {cwd: empty, env: env1});
    const notice = whoLines(a.stderr).filter(l => l.includes('now using'));
    ok('update check does not slow the run that starts it', kick.secs < 10, `${kick.secs}s`);
    ok('update: switches to the latest tag (0.7.1)', lastLine(a.stdout) === '0.7.1', `answered ${lastLine(a.stdout)}; state=${fs.existsSync(gfile) ? fs.readFileSync(gfile, 'utf8').slice(0, 200) : 'none'}`);
    ok('update: one notice on the first text run, none in JSON, none after', notice.length === 1 && js.stderr.trim() === '' && !whoLines(b.stderr).some(l => l.includes('now using')),
      `notice=${JSON.stringify(notice)} json-stderr=${JSON.stringify(js.stderr.trim().slice(0, 100))}`);
  }
}

main().catch(e => record('smoke harness', 'fail', String(e.stack || e).slice(0, 800))).finally(() => {
  const summary = {platform: process.platform, release: os.release(), node: process.version, label: LABEL, results,
    pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length, info: results.filter(r => r.status === 'info').length};
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  const md = [`### Global-mode smoke: ${process.platform} (${os.release()}), Node ${process.version}, CLI ${LABEL}`, '',
    `pass ${summary.pass} · fail ${summary.fail} · info ${summary.info}`, '', '| Check | Result | Detail |', '|---|---|---|',
    ...results.map(r => `| ${r.name} | ${r.status} | ${String(typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 300)} |`)].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  console.log('\n' + md);
  process.exit(summary.fail ? 1 : 0);
});
