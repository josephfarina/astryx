// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file One test per row of AST-081's "Who answers when global and project
 * copies meet" table (spec AST-081 FR11). Each row runs real copies of this
 * CLI, packed the way it is published and labeled with test versions, in the
 * install layouts the row names, with a private home folder, cache, and
 * search path, and checks who answered and what the run printed.
 *
 * Rows that depend on an operating system's own file system (G25, G26) test
 * their path rules here; on macOS and Windows themselves they run only in
 * the cross-platform smoke workflow.
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {
  globalCli,
  packedCli,
  placeCli,
  seedPackedRelease,
  startRegistry,
} from '../test-utils/global-local-fixtures.mjs';
import {
  cleanupFixtures,
  installCore,
  project,
  tempDir,
  writeJson,
} from '../test-utils/release-fixtures.mjs';
import {installPlaceOf, isGlobalCopy} from '../foundation/release/choose.mjs';
import {relativeWithin, samePath} from '../foundation/fs/path-compare.mjs';
import {userCacheDir} from '../foundation/env/user-dirs.mjs';
import {astryxCommandsOnSearchPath} from '../foundation/env/search-path.mjs';
import {tryLock} from '../foundation/release/cache.mjs';
import {LEASE_SILENCE_MS} from '../foundation/release/lock-lease.mjs';

const POSIX = process.platform !== 'win32';
const ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const OFFLINE = 'http://127.0.0.1:9/';

beforeAll(() => {
  packedCli();
}, 120_000);
afterEach(cleanupFixtures);
afterAll(() => {
  fs.rmSync(path.dirname(packedCli()), {recursive: true, force: true});
});

/**
 * A private computer: a home folder, a cache, and a search path.
 * @param {{path?: string[]}} [options]
 */
function computer(options = {}) {
  const home = tempDir('home');
  const cache = path.join(home, '.cache');
  // A `node` command for scripts that start with `#!/usr/bin/env node`.
  const nodeBin = tempDir('node-bin');
  fs.symlinkSync(process.execPath, path.join(nodeBin, 'node'));
  return {
    home,
    cache,
    /** The `astryx` cache folder global mode uses. */
    astryxCache: path.join(cache, 'astryx'),
    path: [...(options.path ?? []), nodeBin],
  };
}

/**
 * Run an `astryx` entry file with node, on a private computer.
 * @param {string} bin
 * @param {string[]} args
 * @param {{cwd: string, pc: ReturnType<typeof computer>, env?: Record<string, string | undefined>}} options
 */
function run(bin, args, {cwd, pc, env = {}}) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(npm_|XDG_|ASTRYX)/iu.test(k),
    ),
  );
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...base,
      HOME: pc.home,
      USERPROFILE: pc.home,
      XDG_CACHE_HOME: pc.cache,
      XDG_CONFIG_HOME: path.join(pc.home, '.config'),
      PATH: pc.path.join(path.delimiter),
      npm_config_registry: OFFLINE,
      npm_config_update_notifier: 'false',
      // An unreachable registry fails at once instead of after npm's backoff.
      npm_config_fetch_retry_mintimeout: '50',
      npm_config_fetch_retry_maxtimeout: '100',
      NO_COLOR: '1',
      ...env,
    },
    timeout: 60_000,
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
    /** The stderr lines that start with `astryx: `. */
    lines: result.stderr
      .split(/\r?\n/u)
      .filter(line => line.startsWith('astryx: ')),
  };
}

/**
 * A project with Core installed at `core`, and its own CLI at `cli`.
 * @param {{core?: string, cli?: string, declare?: Record<string, string>}} spec
 */
function makeProject({core, cli, declare}) {
  const deps = {
    ...(core ? {'@astryxdesign/core': core} : {}),
    ...(cli ? {'@astryxdesign/cli': cli} : {}),
    ...declare,
  };
  const dir = project(tempDir('project'), deps);
  if (core) installCore(dir, core);
  if (cli)
    placeCli(path.join(dir, 'node_modules', '@astryxdesign', 'cli'), cli);
  return dir;
}

/** @param {string} version */
const handedTo = version => (/** @type {string} */ from) =>
  `astryx: answered by this project's CLI ${version}, handed over from CLI ${from}`;
/** @param {string} version */
const matchedLine = version =>
  `astryx: answered by CLI ${version} with Core ${version}, the release that matches this project's Core`;
/** @param {string} version */
const outsideLine = version =>
  `astryx: answered by CLI ${version} with Core ${version}, outside a project`;

/**
 * Every file under `dir`, for before-and-after comparisons.
 * @param {string} dir
 * @returns {string[]}
 */
function filesIn(dir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ d) => {
    for (const entry of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Write the global copy's state.
 * @param {ReturnType<typeof computer>} pc
 * @param {Record<string, unknown>} state
 */
function globalState(pc, state) {
  writeJson(path.join(pc.astryxCache, 'global.json'), state);
}

describe.skipIf(!POSIX)(
  'who answers when global and project copies meet',
  () => {
    it('G1 global copy newer than the project CLI, which matches its Core', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.1', {root: pc.home});
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('9.0.0');
      expect(r.lines).toEqual([handedTo('9.0.0')('9.0.1')]);
    });

    it('G2 global copy older than the project CLI', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const dir = makeProject({core: '9.0.1', cli: '9.0.1'});
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([handedTo('9.0.1')('9.0.0')]);
    });

    it('G3 the project CLI differs from its Core: the matched release answers', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({core: '9.0.1', cli: '9.0.0'});
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([matchedLine('9.0.1')]);
    });

    it('G4 Core only, no CLI', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({core: '9.0.1'});
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([matchedLine('9.0.1')]);
    });

    it('G5 a fresh clone answers with the release its lockfile records, writing nothing there', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({declare: {'@astryxdesign/core': '^9.0.0'}});
      writeJson(path.join(dir, 'package-lock.json'), {
        lockfileVersion: 3,
        packages: {
          '': {dependencies: {'@astryxdesign/core': '^9.0.0'}},
          'node_modules/@astryxdesign/core': {version: '9.0.1'},
        },
      });
      const before = filesIn(dir);
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([matchedLine('9.0.1')]);
      expect(filesIn(dir)).toEqual(before);
    });

    it('G6 the installed Core wins over a lockfile that disagrees', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({core: '9.0.1'});
      writeJson(path.join(dir, 'package-lock.json'), {
        lockfileVersion: 3,
        packages: {'node_modules/@astryxdesign/core': {version: '9.0.0'}},
      });
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
    });

    it('G7 a workspace member with its own Core gets its matched release; others use the root CLI', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.5', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const root = makeProject({core: '9.0.0', cli: '9.0.0'});
      const member = path.join(root, 'packages', 'app');
      project(member, {'@astryxdesign/core': '9.0.1'});
      installCore(member, '9.0.1');
      const other = path.join(root, 'packages', 'docs');
      fs.mkdirSync(other, {recursive: true});
      expect(run(g.bin, ['--version'], {cwd: member, pc}).stdout).toBe('9.0.1');
      const r = run(g.bin, ['--version'], {cwd: other, pc});
      expect(r.stdout).toBe('9.0.0');
      expect(r.lines).toEqual([handedTo('9.0.0')('9.0.5')]);
    });

    it('G8 a folder inside another project answers with the enclosing project (the released read reach)', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.5', {root: pc.home});
      const root = makeProject({core: '9.0.0', cli: '9.0.0'});
      const nested = path.join(root, 'apps', 'nested');
      project(nested, {'@astryxdesign/core': '9.0.1'});
      fs.mkdirSync(path.join(root, 'vendor', 'repo', '.git'), {
        recursive: true,
      });
      for (const cwd of [nested, path.join(root, 'vendor', 'repo')]) {
        expect(run(g.bin, ['--version'], {cwd, pc}).stdout).toBe('9.0.0');
      }
    });

    it('G9 outside a project: the global copy answers with its newest kept release; another copy answers itself', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.2');
      globalState(pc, {current: '9.0.2', firstRunAt: Date.now()});
      const empty = tempDir('empty');
      const r = run(g.bin, ['--version'], {cwd: empty, pc});
      expect(r.stdout).toBe('9.0.2');
      expect(r.lines).toEqual([outsideLine('9.0.2')]);
      const runner = placeCli(
        path.join(
          tempDir('npx'),
          '_npx',
          'abc',
          'node_modules',
          '@astryxdesign',
          'cli',
        ),
        '9.0.3',
      );
      const own = run(runner.bin, ['--version'], {cwd: empty, pc});
      expect(own.stdout).toBe('9.0.3');
      expect(own.lines).toEqual([outsideLine('9.0.3')]);
    });

    it("G10 a version typed on a package runner: exactly that release outside a project, the project's release inside one", () => {
      const pc = computer();
      const runner = placeCli(
        path.join(
          tempDir('npx'),
          '_npx',
          'def',
          'node_modules',
          '@astryxdesign',
          'cli',
        ),
        '9.0.3',
      );
      expect(
        run(runner.bin, ['--version'], {cwd: tempDir('empty'), pc}).stdout,
      ).toBe('9.0.3');
      const dir = makeProject({core: '9.0.1', cli: '9.0.1'});
      const r = run(runner.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([handedTo('9.0.1')('9.0.3')]);
    });

    it('G11 a global copy that predates the hand-off answers itself; newer copies and doctor name its replacement', () => {
      const pc = computer();
      // A release from before the hand-off: no release-choice module.
      const old = globalCli('npm', '9.0.0', {root: pc.home});
      fs.rmSync(path.join(old.dir, 'foundation', 'release', 'choose.mjs'));
      pc.path.unshift(old.binDir);
      const dir = makeProject({core: '9.0.1', cli: '9.0.1'});
      const projectBin = path.join(
        dir,
        'node_modules',
        '@astryxdesign',
        'cli',
        'clients',
        'cli',
        'bin',
        'astryx.mjs',
      );
      const r = run(projectBin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([
        'astryx: the astryx command on this computer runs CLI 9.0.0, which answers every folder itself. Replace it: npm i -g @astryxdesign/cli@latest.',
      ]);
      expect(run(projectBin, ['--version'], {cwd: dir, pc}).lines).toEqual([]);
      const doctor = JSON.parse(
        run(projectBin, ['doctor', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'cli-on-path',
        ),
      ).toMatchObject({
        status: 'warn',
        fix: 'Replace it: `npm i -g @astryxdesign/cli@latest`.',
      });
    });

    it('G12 two global installs: the first on the search path starts, and both choose the same release', () => {
      const pc = computer();
      const npm = globalCli('npm', '9.0.0', {root: pc.home});
      const pnpm = globalCli('pnpm', '9.0.1', {root: pc.home});
      pc.path.unshift(npm.binDir, pnpm.binDir);
      seedPackedRelease(pc.astryxCache, '9.0.2');
      globalState(pc, {current: '9.0.2', firstRunAt: Date.now()});
      const empty = tempDir('empty');
      for (const g of [npm, pnpm]) {
        expect(run(g.bin, ['--version'], {cwd: empty, pc}).stdout).toBe(
          '9.0.2',
        );
      }
      const doctor = JSON.parse(
        run(npm.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      const check = doctor.data.checks.find(
        (/** @type {any} */ c) => c.id === 'cli-on-path',
      );
      expect(check.status).toBe('pass');
      expect(check.message).toContain(path.join(npm.binDir, 'astryx'));
      expect(check.message).toContain(
        `Later on the search path: ${path.join(pnpm.binDir, 'astryx')} (CLI 9.0.1)`,
      );
    });

    it('G13 an astryx earlier on the search path that is not the Astryx CLI: init --user and doctor warn', () => {
      const pc = computer();
      const other = tempDir('other');
      fs.writeFileSync(path.join(other, 'astryx'), '#!/bin/sh\necho other\n');
      fs.chmodSync(path.join(other, 'astryx'), 0o755);
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      pc.path.unshift(other, g.binDir);
      const empty = tempDir('empty');
      const init = JSON.parse(
        run(g.bin, ['--json', 'init', '--user'], {cwd: empty, pc}).stdout,
      );
      expect(init.data.warnings[0]).toContain('No `astryx` command');
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'cli-on-path',
        ).status,
      ).toBe('warn');
    });

    it('G14 a Node version manager: each Node has its own global copy, and a kept release answers only on a Node it supports', () => {
      const pc = computer();
      for (const layout of /** @type {const} */ (['nvm', 'fnm', 'volta'])) {
        expect(
          isGlobalCopy(globalCli(layout, '9.0.0').dir, pc.astryxCache),
        ).toBe(true);
      }
      const g = globalCli('nvm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      seedPackedRelease(pc.astryxCache, '9.0.2', {engines: {node: '>=99'}});
      globalState(pc, {
        current: '9.0.2',
        previous: '9.0.1',
        firstRunAt: Date.now(),
      });
      expect(
        run(g.bin, ['--version'], {cwd: tempDir('empty'), pc}).stdout,
      ).toBe('9.0.1');
    });

    it('G15 a project pinned through a package manager shim: as for that project, and nothing written there', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({core: '9.0.1'});
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
      );
      writeJson(path.join(dir, 'package.json'), {
        ...pkg,
        packageManager: 'pnpm@10.0.0',
      });
      const before = filesIn(dir);
      expect(run(g.bin, ['--version'], {cwd: dir, pc}).stdout).toBe('9.0.1');
      // A release that must be fetched fails without touching the project.
      const missing = makeProject({core: '9.0.7'});
      const missingBefore = filesIn(missing);
      const r = run(g.bin, ['--version', '--json'], {cwd: missing, pc});
      expect(JSON.parse(r.stdout).code).toBe('ERR_VERSIONS_UNAVAILABLE');
      expect(filesIn(missing)).toEqual(missingBefore);
      expect(filesIn(dir)).toEqual(before);
    });

    it.skipIf(ROOT)(
      'G16 a global copy installed with administrator rights: nothing is written to its install folder',
      () => {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        const prefix = path.join(pc.home, '.npm-global');
        const before = filesIn(prefix);
        fs.chmodSync(g.dir, 0o555);
        try {
          const r = run(g.bin, ['--version'], {cwd: tempDir('empty'), pc});
          expect(r.status).toBe(0);
          expect(r.stdout).toBe('9.0.0');
        } finally {
          fs.chmodSync(g.dir, 0o755);
        }
        expect(filesIn(prefix)).toEqual(before);
      },
    );

    it.skipIf(ROOT)(
      'G17 the cache cannot be written: the installed copy answers outside, a needed release fails, and the reminder says why',
      () => {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        globalState(pc, {
          latest: '9.0.5',
          checkOkAt: Date.now(),
          checkedAt: Date.now(),
          firstRunAt: Date.now(),
        });
        fs.chmodSync(pc.astryxCache, 0o555);
        try {
          const empty = tempDir('empty');
          const outside = run(g.bin, ['--version'], {cwd: empty, pc});
          expect(outside.stdout).toBe('9.0.0');
          expect(outside.lines).toContain(
            `astryx: cannot move to Astryx 9.0.5: the per-user cache ${pc.astryxCache} cannot be written. Run astryx doctor for the fix.`,
          );
          const dir = makeProject({core: '9.0.1'});
          const r = run(g.bin, ['--version', '--json'], {cwd: dir, pc});
          expect(r.status).toBe(1);
          expect(JSON.parse(r.stdout).code).toBe('ERR_VERSIONS_UNAVAILABLE');
        } finally {
          fs.chmodSync(pc.astryxCache, 0o755);
        }
      },
    );

    it('G18 cache and configuration folders set by environment: absolute ones are used, relative ones ignored', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      const before = filesIn(dir);
      const r = run(g.bin, ['--version'], {
        cwd: dir,
        pc,
        env: {XDG_CACHE_HOME: 'rel-cache', XDG_CONFIG_HOME: 'rel-config'},
      });
      expect(r.status).toBe(0);
      expect(filesIn(dir)).toEqual(before);
      expect(fs.existsSync(path.join(pc.home, '.cache', 'astryx'))).toBe(true);
      expect(
        userCacheDir({
          home: pc.home,
          platform: 'linux',
          env: {XDG_CACHE_HOME: '/abs'},
        }),
      ).toBe(path.join('/abs', 'astryx'));
    });

    it('G19 a fresh home, as in continuous integration: no check, no reminder, and the guide is written in the background', async () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const r = run(g.bin, ['--version'], {cwd: tempDir('empty'), pc});
      expect(r.lines).toEqual([outsideLine('9.0.0')]);
      const state = JSON.parse(
        fs.readFileSync(path.join(pc.astryxCache, 'global.json'), 'utf8'),
      );
      expect(state.checkedAt).toBeUndefined();
      const skill = path.join(
        pc.home,
        '.agents',
        'skills',
        'astryx',
        'SKILL.md',
      );
      for (let i = 0; i < 100 && !fs.existsSync(skill); i++) {
        await new Promise(done => setTimeout(done, 100));
      }
      expect(fs.readFileSync(skill, 'utf8')).toContain('name: astryx');
    });

    it.skipIf(ROOT)(
      'G20 a read-only home folder: the run answers, and nothing is written',
      () => {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        fs.chmodSync(pc.home, 0o555);
        try {
          const r = run(g.bin, ['--version'], {cwd: tempDir('empty'), pc});
          expect(r.status).toBe(0);
          expect(r.stdout).toBe('9.0.0');
          expect(fs.existsSync(path.join(pc.home, '.agents'))).toBe(false);
        } finally {
          fs.chmodSync(pc.home, 0o755);
        }
      },
    );

    it("G21 a shared cache: another computer's lock is taken over once it goes unrenewed", () => {
      const lock = path.join(tempDir('cache'), 'releases', '.lock-9.0.1');
      fs.mkdirSync(lock, {recursive: true});
      writeJson(path.join(lock, 'owner.json'), {
        pid: 7,
        host: 'another-computer',
      });
      const t0 = Date.now();
      expect(tryLock(lock, {now: t0})).toBe(false);
      expect(tryLock(lock, {now: t0 + LEASE_SILENCE_MS - 1})).toBe(false);
      expect(tryLock(lock, {now: t0 + LEASE_SILENCE_MS})).toBe(true);
    });

    it('G22 a project behind the newest release: the reminder, once a day, after a real check of the registry', async () => {
      const registry = await startRegistry({
        versions: ['9.0.1', '9.0.5'],
        latest: '9.0.5',
      });
      try {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        globalState(pc, {firstRunAt: Date.now() - 2 * 60 * 60_000});
        const env = {npm_config_registry: registry.url};
        run(g.bin, ['--version'], {cwd: tempDir('empty'), pc, env});
        const stateFile = path.join(pc.astryxCache, 'global.json');
        for (let i = 0; i < 300; i++) {
          if (JSON.parse(fs.readFileSync(stateFile, 'utf8')).latest) break;
          await new Promise(done => setTimeout(done, 100));
        }
        expect(JSON.parse(fs.readFileSync(stateFile, 'utf8')).latest).toBe(
          '9.0.5',
        );
        const dir = makeProject({core: '9.0.1', cli: '9.0.1'});
        const json = run(g.bin, ['--version', '--json'], {cwd: dir, pc, env});
        expect(json.stderr).not.toContain('this project uses');
        const first = run(g.bin, ['--version'], {cwd: dir, pc, env});
        expect(first.lines).toEqual([
          handedTo('9.0.1')('9.0.0'),
          'astryx: this project uses Astryx 9.0.1; 9.0.5 is the newest. To upgrade: npm install @astryxdesign/core@9.0.5 @astryxdesign/cli@9.0.5, then npx astryx upgrade --from 9.0.1 --apply.',
        ]);
        expect(run(g.bin, ['--version'], {cwd: dir, pc, env}).lines).toEqual([
          handedTo('9.0.1')('9.0.0'),
        ]);
      } finally {
        await registry.close();
      }
    }, 60_000);

    it('G23 the global copy cannot move to the newest release: the current one answers, the reminder and doctor say why', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.2');
      globalState(pc, {
        current: '9.0.2',
        latest: '9.0.5',
        checkOkAt: Date.now(),
        checkedAt: Date.now(),
        firstRunAt: Date.now(),
        notice: {
          blockedVersion: '9.0.5',
          blockedReason:
            'it needs Node >=99, and this computer runs Node 24.0.0',
        },
      });
      const empty = tempDir('empty');
      const r = run(g.bin, ['--version'], {cwd: empty, pc});
      expect(r.stdout).toBe('9.0.2');
      expect(r.lines).toContain(
        'astryx: cannot move to Astryx 9.0.5: it needs Node >=99, and this computer runs Node 24.0.0. Run astryx doctor for the fix.',
      );
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'newest-release',
        ),
      ).toMatchObject({status: 'warn'});
    });

    it('G24 a link to a project folder answers as the folder does', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.5', {root: pc.home});
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      const link = path.join(tempDir('links'), 'app');
      fs.symlinkSync(dir, link, 'dir');
      const r = run(g.bin, ['--version'], {cwd: link, pc});
      expect(r.stdout).toBe('9.0.0');
      expect(r.lines).toEqual([handedTo('9.0.0')('9.0.5')]);
    });

    it('G25 a file system that ignores letter case: paths compare without case there (path rules)', () => {
      for (const platform of /** @type {const} */ (['darwin', 'win32'])) {
        expect(samePath('/Users/Ada/App', '/users/ada/app', platform)).toBe(
          true,
        );
      }
      expect(samePath('/home/ada/App', '/home/ada/app', 'linux')).toBe(false);
      expect(
        relativeWithin(
          '/Users/Ada/Proj',
          '/users/ada/proj/node_modules',
          'darwin',
        ),
      ).toBe('node_modules');
      expect(
        relativeWithin(
          'C:\\Users\\Ada\\Proj',
          'c:\\users\\ada\\PROJ\\sub',
          'win32',
        ),
      ).toBe('sub');
    });

    it('G26 Windows paths and installs follow the same rules (path rules)', () => {
      expect(
        installPlaceOf(
          'C:\\Users\\ada\\AppData\\Roaming\\npm\\node_modules\\@astryxdesign\\cli',
        ),
      ).toEqual({
        runner: false,
        owner: 'C:\\Users\\ada\\AppData\\Roaming\\npm',
        knownGlobal: false,
      });
      expect(
        installPlaceOf(
          'C:\\Users\\ada\\AppData\\Local\\Yarn\\Data\\global\\node_modules\\@astryxdesign\\cli',
        ).knownGlobal,
      ).toBe(true);
      expect(
        installPlaceOf(
          'C:\\Users\\ada\\AppData\\Local\\npm-cache\\_npx\\1a2b\\node_modules\\@astryxdesign\\cli',
        ).runner,
      ).toBe(true);
      expect(
        userCacheDir({
          home: 'C:\\Users\\ada',
          platform: 'win32',
          env: {LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local'},
        }),
      ).toBe('C:\\Users\\ada\\AppData\\Local\\astryx\\Cache');
      // npm's Windows shim names the package beside it.
      const bin = tempDir('winbin');
      const pkg = path.join(bin, 'node_modules', '@astryxdesign', 'cli');
      writeJson(path.join(pkg, 'package.json'), {
        name: '@astryxdesign/cli',
        version: '9.0.0',
      });
      fs.writeFileSync(
        path.join(bin, 'astryx.cmd'),
        '@ECHO off\r\n"%~dp0\\node_modules\\@astryxdesign\\cli\\clients\\cli\\bin\\astryx.mjs" %*\r\n',
      );
      expect(
        astryxCommandsOnSearchPath({searchPath: bin, platform: 'win32'}),
      ).toEqual([
        {
          file: path.join(bin, 'astryx.cmd'),
          astryx: true,
          cliRoot: pkg,
          version: '9.0.0',
          handsOff: false,
        },
      ]);
    });

    it('G27 a package script puts the project CLI first: it answers, or the matched release when it differs from its Core', () => {
      const pc = computer();
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({core: '9.0.1', cli: '9.0.0'});
      const binDir = path.join(dir, 'node_modules', '.bin');
      fs.mkdirSync(binDir, {recursive: true});
      const projectBin = path.join(
        dir,
        'node_modules',
        '@astryxdesign',
        'cli',
        'clients',
        'cli',
        'bin',
        'astryx.mjs',
      );
      fs.symlinkSync(projectBin, path.join(binDir, 'astryx'));
      pc.path.unshift(binDir);
      const result = spawnSync('astryx', ['--version'], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: pc.home,
          XDG_CACHE_HOME: pc.cache,
          XDG_CONFIG_HOME: path.join(pc.home, '.config'),
          PATH: pc.path.join(path.delimiter),
          npm_config_registry: OFFLINE,
        },
      });
      expect(result.stdout.trim()).toBe('9.0.1');
    });

    it("G28 a Yarn Plug'n'Play project answers with the release equal to its Core, from the cache", () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.1');
      const dir = makeProject({declare: {'@astryxdesign/core': '^9.0.0'}});
      fs.writeFileSync(path.join(dir, '.pnp.cjs'), '');
      fs.writeFileSync(
        path.join(dir, 'yarn.lock'),
        '__metadata:\n  version: 8\n\n"@astryxdesign/core@npm:^9.0.0":\n  version: 9.0.1\n',
      );
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.stdout).toBe('9.0.1');
      expect(r.lines).toEqual([matchedLine('9.0.1')]);
    });

    it('G29 a package runner that reuses the global install answers as the global copy', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.2');
      globalState(pc, {current: '9.0.2', firstRunAt: Date.now()});
      const r = run(g.bin, ['--version'], {
        cwd: tempDir('empty'),
        pc,
        env: {npm_command: 'exec', npm_lifecycle_event: 'npx'},
      });
      expect(r.stdout).toBe('9.0.2');
    });

    it('G30 init --user inside a project answers for the computer and writes nothing in the project', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.5', {root: pc.home});
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      const before = filesIn(dir);
      const r = run(g.bin, ['init', '--user'], {cwd: dir, pc});
      expect(r.status).toBe(0);
      expect(r.lines).toEqual([
        'astryx: answered by CLI 9.0.5 with Core 9.0.5, for this computer',
      ]);
      expect(
        fs.existsSync(
          path.join(pc.home, '.claude', 'skills', 'astryx', 'SKILL.md'),
        ),
      ).toBe(true);
      expect(filesIn(dir)).toEqual(before);
    });

    it('G31 a damaged kept release: the previous kept release answers, else the installed copy', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const current = seedPackedRelease(pc.astryxCache, '9.0.2');
      seedPackedRelease(pc.astryxCache, '9.0.1');
      globalState(pc, {
        current: '9.0.2',
        previous: '9.0.1',
        firstRunAt: Date.now(),
      });
      fs.rmSync(
        path.join(
          current.dir,
          'node_modules',
          '@astryxdesign',
          'core',
          'package.json',
        ),
      );
      const empty = tempDir('empty');
      expect(run(g.bin, ['--version'], {cwd: empty, pc}).stdout).toBe('9.0.1');
      fs.rmSync(path.join(pc.astryxCache, 'releases', '9.0.1'), {
        recursive: true,
      });
      expect(run(g.bin, ['--version'], {cwd: empty, pc}).stdout).toBe('9.0.0');
    });

    it('G32 a workspace whose own CLI sits beside its own Core answers with that CLI', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const root = tempDir('repo');
      writeJson(path.join(root, 'package.json'), {name: 'repo', private: true});
      writeJson(path.join(root, 'packages', 'core', 'package.json'), {
        name: '@astryxdesign/core',
        version: '9.0.4',
      });
      placeCli(path.join(root, 'packages', 'cli'), '9.0.4');
      // The repository root and another member; `packages/cli` itself reads its
      // own node_modules, which these copies share with this checkout.
      const member = path.join(root, 'apps', 'site');
      fs.mkdirSync(member, {recursive: true});
      for (const cwd of [root, member]) {
        const r = run(g.bin, ['--version'], {cwd, pc});
        expect(r.stdout).toBe('9.0.4');
        expect(r.lines).toEqual([handedTo('9.0.4')('9.0.0')]);
      }
    });
  },
);

it('names every row of the table exactly once', () => {
  const text = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const rows = [
    ...text.matchAll(/^\s+it(?:\.skipIf\([^)]*\)\()?\(?\s*['"](G\d+) /gmu),
  ].map(m => m[1]);
  expect(rows).toEqual(Array.from({length: 32}, (_, i) => `G${i + 1}`));
  expect(os.EOL).toBeTypeOf('string');
});
