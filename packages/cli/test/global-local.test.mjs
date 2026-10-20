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
  CLI_VERSION,
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
      ([k]) => !/^(?:npm_|XDG_|ASTRYX|CI$|NO_UPDATE_NOTIFIER$)/iu.test(k),
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
    /** The update notice lines (FR10). */
    notice: result.stderr
      .split(/\r?\n/u)
      .filter(line =>
        /^(?:A new release of Astryx|To upgrade|The astryx command)/u.test(
          line,
        ),
      ),
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
  writeJson(path.join(pc.home, '.config', 'astryx', 'state.json'), state);
}

/**
 * The saved state.
 * @param {ReturnType<typeof computer>} pc
 * @returns {Record<string, any>}
 */
function readState(pc) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(pc.home, '.config', 'astryx', 'state.json'),
        'utf8',
      ),
    );
  } catch {
    return {};
  }
}

/**
 * An integration (by default `@acme/widgets`) installed in `root`'s
 * node_modules, with one doc topic; `manifest` replaces its manifest's text.
 * @param {string} root
 * @param {{topic: string, peers?: Record<string, string>, name?: string, manifest?: string}} options
 */
function acmeWidgets(root, {topic, peers, name = '@acme/widgets', manifest}) {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  writeJson(path.join(dir, 'package.json'), {
    name,
    version: '1.0.0',
    ...(peers ? {peerDependencies: peers} : {}),
  });
  fs.writeFileSync(
    path.join(dir, 'astryx.integration.mjs'),
    manifest ?? "export default {docs: './docs'};\n",
  );
  fs.mkdirSync(path.join(dir, 'docs'), {recursive: true});
  fs.writeFileSync(
    path.join(dir, 'docs', `${topic}.doc.mjs`),
    `export const docs = ${JSON.stringify({
      type: 'generic',
      name: topic,
      title: 'Deploying',
      description: 'How to ship an app built with Acme widgets.',
      category: 'guide',
      sections: [
        {
          title: 'Overview',
          content: [{type: 'prose', text: 'Push the button.'}],
        },
      ],
    })};\n`,
  );
  return dir;
}

/** The two lines of a newer-release notice. */
const available = (/** @type {string} */ cur, /** @type {string} */ next) =>
  `A new release of Astryx is available: ${cur} → ${next}`;

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

    it('G9 outside a project: every copy answers itself, the global copy included, whatever releases are cached', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      seedPackedRelease(pc.astryxCache, '9.0.2');
      globalState(pc, {firstRunAt: Date.now()});
      const empty = tempDir('empty');
      const r = run(g.bin, ['--version'], {cwd: empty, pc});
      expect(r.stdout).toBe('9.0.0');
      expect(r.lines).toEqual([outsideLine('9.0.0')]);
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

    it('G11 a global copy that predates the hand-off answers itself; newer copies and doctor name its replacement, even in a fresh home', () => {
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
      expect(r.lines).toEqual([]);
      expect(r.notice).toEqual([
        'The astryx command on this computer runs CLI 9.0.0, which answers every folder itself.',
        'To upgrade, run: npm i -g --prefix ~/.npm-global @astryxdesign/cli@latest',
      ]);
      expect(run(projectBin, ['--version'], {cwd: dir, pc}).notice).toEqual([]);
      const doctor = JSON.parse(
        run(projectBin, ['doctor', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'cli-on-path',
        ),
      ).toMatchObject({
        status: 'warn',
        fix: 'To upgrade, run: `npm i -g --prefix ~/.npm-global @astryxdesign/cli@latest`.',
      });
    });

    it('G12 two global installs: the first on the search path starts and answers itself; doctor lists both', () => {
      const pc = computer();
      const npm = globalCli('npm', '9.0.0', {root: pc.home});
      const pnpm = globalCli('pnpm', '9.0.1', {root: pc.home});
      pc.path.unshift(npm.binDir, pnpm.binDir);
      const empty = tempDir('empty');
      expect(run(npm.bin, ['--version'], {cwd: empty, pc}).stdout).toBe(
        '9.0.0',
      );
      expect(run(pnpm.bin, ['--version'], {cwd: empty, pc}).stdout).toBe(
        '9.0.1',
      );
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

    it('G14 a Node version manager: each Node has its own global copy, which answers itself', () => {
      const pc = computer();
      for (const layout of /** @type {const} */ (['nvm', 'fnm', 'volta'])) {
        const copy = globalCli(layout, '9.0.0', {root: pc.home});
        expect(isGlobalCopy(copy.dir, pc.astryxCache)).toBe(true);
        expect(
          run(copy.bin, ['--version'], {cwd: tempDir('empty'), pc}).stdout,
        ).toBe('9.0.0');
      }
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
      // A release that must be fetched and cannot be: the starting copy
      // answers, as before global mode, without touching the project.
      const missing = makeProject({core: '9.0.7'});
      const missingBefore = filesIn(missing);
      const r = run(g.bin, ['--version'], {cwd: missing, pc});
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('9.0.0');
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
      'G17 the cache cannot be written: the global copy still answers outside, and in a project that needs a release it answers instead, with a warning and copy fallback',
      () => {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        fs.mkdirSync(pc.astryxCache, {recursive: true});
        fs.chmodSync(pc.astryxCache, 0o555);
        try {
          const outside = run(g.bin, ['--version'], {
            cwd: tempDir('empty'),
            pc,
          });
          expect(outside.status).toBe(0);
          expect(outside.stdout).toBe('9.0.0');
          const dir = makeProject({core: '9.0.1'});
          const text = run(g.bin, ['--version'], {cwd: dir, pc});
          expect(text.status).toBe(0);
          expect(text.stdout).toBe('9.0.0');
          expect(text.lines).toEqual([
            expect.stringMatching(
              /^astryx: could not get Astryx 9\.0\.1 to match this project's Core \(the release cache .* cannot be written.*\); answering with CLI 9\.0\.0 instead$/u,
            ),
          ]);
          const json = run(g.bin, ['docs', '--json'], {cwd: dir, pc});
          expect(json.status).toBe(0);
          expect(JSON.parse(json.stdout).meta.answeredBy.copy).toBe('fallback');
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
      expect(fs.existsSync(path.join(pc.home, '.config', 'astryx'))).toBe(true);
      expect(
        userCacheDir({
          home: pc.home,
          platform: 'linux',
          env: {XDG_CACHE_HOME: '/abs'},
        }),
      ).toBe(path.join('/abs', 'astryx'));
    });

    it('G19 continuous integration (CI set, a fresh home): no check and no notice; the guide is written in the background', async () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const r = run(g.bin, ['--version'], {
        cwd: tempDir('empty'),
        pc,
        env: {CI: 'true'},
      });
      expect(r.lines).toEqual([outsideLine('9.0.0')]);
      expect(r.notice).toEqual([]);
      expect(readState(pc).checkedAt).toBeUndefined();
      expect(readState(pc).firstRunAt).toBeUndefined();
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

    it('G22 a project behind the newest release: the notice after the command, once a day, after a real check of the registry', async () => {
      const registry = await startRegistry({
        versions: ['9.0.1', '9.0.5'],
        latest: '9.0.5',
      });
      try {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        globalState(pc, {firstRunAt: Date.now() - 2 * 24 * 60 * 60_000});
        const env = {npm_config_registry: registry.url};
        run(g.bin, ['--version'], {cwd: tempDir('empty'), pc, env});
        for (let i = 0; i < 300 && !readState(pc).latest; i++) {
          await new Promise(done => setTimeout(done, 100));
        }
        expect(readState(pc).latest).toBe('9.0.5');
        // The check installed nothing.
        expect(
          fs.existsSync(path.join(pc.astryxCache, 'releases', '9.0.5')),
        ).toBe(false);
        const dir = makeProject({core: '9.0.1', cli: '9.0.1'});
        writeJson(path.join(dir, 'package-lock.json'), {lockfileVersion: 3});
        const json = run(g.bin, ['--version', '--json'], {cwd: dir, pc, env});
        expect(json.notice).toEqual([]);
        const first = run(g.bin, ['--version'], {cwd: dir, pc, env});
        expect(first.lines).toEqual([handedTo('9.0.1')('9.0.0')]);
        expect(first.notice).toEqual([
          available('9.0.1', '9.0.5'),
          'To upgrade, run: npm install @astryxdesign/core@9.0.5 @astryxdesign/cli@9.0.5, then npx astryx upgrade --from 9.0.1 --apply',
        ]);
        // The notice comes after the command's own output.
        expect(first.stderr.trim().split('\n').at(-1)).toBe(first.notice[1]);
        expect(run(g.bin, ['--version'], {cwd: dir, pc, env}).notice).toEqual(
          [],
        );
      } finally {
        await registry.close();
      }
    }, 60_000);

    it('G23 the newest release needs a newer Node: the global copy answers, and the notice and doctor name the Node first', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      globalState(pc, {
        latest: '9.0.5',
        latestNode: '>=99',
        checkOkAt: Date.now(),
        checkedAt: Date.now(),
        firstRunAt: Date.now(),
      });
      const empty = tempDir('empty');
      const r = run(g.bin, ['--version'], {cwd: empty, pc});
      expect(r.stdout).toBe('9.0.0');
      expect(r.notice).toEqual([
        available('9.0.0', '9.0.5'),
        `To upgrade, install Node >=99 (this computer runs Node ${process.versions.node}), then run: npm i -g --prefix ~/.npm-global @astryxdesign/cli@latest`,
      ]);
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'newest-release',
        ),
      ).toMatchObject({
        status: 'info',
        fix: `To upgrade, install Node >=99 (this computer runs Node ${process.versions.node}), then run: npm i -g --prefix ~/.npm-global @astryxdesign/cli@latest.`,
      });
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
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !/^(?:npm_|XDG_|CI$|NO_UPDATE_NOTIFIER$)/iu.test(key),
            ),
          ),
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
      const r = run(g.bin, ['--version'], {
        cwd: tempDir('empty'),
        pc,
        env: {npm_command: 'exec', npm_lifecycle_event: 'npx'},
      });
      expect(r.stdout).toBe('9.0.0');
      expect(r.lines).toEqual([outsideLine('9.0.0')]);
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

    it('G31 a damaged cached release is not used: the run installs it again, or, when it cannot, the starting copy answers instead', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const cached = seedPackedRelease(pc.astryxCache, '9.0.2');
      const dir = makeProject({core: '9.0.2'});
      expect(run(g.bin, ['--version'], {cwd: dir, pc}).stdout).toBe('9.0.2');
      fs.rmSync(
        path.join(
          cached.dir,
          'node_modules',
          '@astryxdesign',
          'core',
          'package.json',
        ),
      );
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('9.0.0');
      expect(r.lines.filter(l => l.includes('could not get'))).toEqual([
        expect.stringMatching(/^astryx: could not get Astryx 9\.0\.2 /u),
      ]);
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
      // Inside the CLI's own package, whose node_modules links this
      // checkout's Core: label the workspace with that Core's version.
      const repo = tempDir('repo');
      writeJson(path.join(repo, 'package.json'), {name: 'repo', private: true});
      writeJson(path.join(repo, 'packages', 'core', 'package.json'), {
        name: '@astryxdesign/core',
        version: CLI_VERSION,
      });
      const own = placeCli(path.join(repo, 'packages', 'cli'), CLI_VERSION);
      for (const cwd of [own.dir, path.join(own.dir, 'foundation')]) {
        const r = run(g.bin, ['--version'], {cwd, pc});
        expect(r.stdout).toBe(CLI_VERSION);
        expect(r.lines).toEqual([handedTo(CLI_VERSION)('9.0.0')]);
      }
    });

    it('G33 the global copy behind the newest release: the notice after the command names the package manager that installed it', () => {
      for (const [layout, command] of /** @type {const} */ ([
        // The npm layout is a prefix in the home folder (`~/.npm-global`),
        // so the upgrade names it.
        ['npm', 'npm i -g --prefix ~/.npm-global @astryxdesign/cli@latest'],
        ['pnpm', 'pnpm add -g @astryxdesign/cli@latest'],
        ['volta', 'volta install @astryxdesign/cli@latest'],
      ])) {
        const pc = computer();
        const g = globalCli(layout, '9.0.0', {root: pc.home});
        globalState(pc, {
          latest: '9.0.5',
          checkOkAt: Date.now(),
          firstRunAt: Date.now(),
        });
        const empty = tempDir('empty');
        const r = run(g.bin, ['--version'], {cwd: empty, pc});
        expect(r.status).toBe(0);
        expect(r.notice).toEqual([
          available('9.0.0', '9.0.5'),
          `To upgrade, run: ${command}`,
        ]);
        expect(run(g.bin, ['--version'], {cwd: empty, pc}).notice).toEqual([]);
      }
      // A failed command prints no notice.
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      globalState(pc, {latest: '9.0.5', checkOkAt: Date.now(), firstRunAt: 0});
      const failed = run(g.bin, ['no-such-command'], {
        cwd: tempDir('empty'),
        pc,
      });
      expect(failed.status).not.toBe(0);
      expect(failed.notice).toEqual([]);
    });

    it('G34 NO_UPDATE_NOTIFIER or CI set: no check and no notice, whatever is due', () => {
      for (const env of [{NO_UPDATE_NOTIFIER: '1'}, {CI: '1'}]) {
        const pc = computer();
        const g = globalCli('npm', '9.0.0', {root: pc.home});
        globalState(pc, {
          latest: '9.0.5',
          checkOkAt: 1,
          checkedAt: 1,
          firstRunAt: 1,
        });
        const r = run(g.bin, ['--version'], {cwd: tempDir('empty'), pc, env});
        expect(r.notice).toEqual([]);
        expect(readState(pc).checkedAt).toBe(1);
        expect(readState(pc).notifiedAt).toBeUndefined();
      }
    });

    it('G35 outside a project: an integration installed beside the global copy contributes its docs, components, and discover entry', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      acmeWidgets(path.resolve(g.dir, '..', '..', '..'), {
        topic: 'acme-deploying',
      });
      const empty = tempDir('empty');
      const docs = JSON.parse(
        run(g.bin, ['docs', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        docs.data.find((/** @type {any} */ t) => t.topic === 'acme-deploying'),
      ).toMatchObject({package: '@acme/widgets'});
      const discover = JSON.parse(
        run(g.bin, ['discover', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(discover.data.map((/** @type {any} */ p) => p.name)).toContain(
        '@acme/widgets',
      );
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'computer-integrations',
        ),
      ).toMatchObject({
        status: 'pass',
        message: 'Used outside a project: @acme/widgets@1.0.0.',
      });
    });

    it("G36 inside a project: an integration installed for the computer adds nothing, and discover and doctor list it as available with the project's install command", () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      acmeWidgets(path.resolve(g.dir, '..', '..', '..'), {
        topic: 'acme-deploying',
      });
      // The global copy is on the search path, as it is once installed.
      pc.path.unshift(g.binDir);
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      writeJson(path.join(dir, 'package-lock.json'), {lockfileVersion: 3});
      const docs = JSON.parse(
        run(g.bin, ['docs', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(
        docs.data.some((/** @type {any} */ t) => t.topic === 'acme-deploying'),
      ).toBe(false);
      const discover = JSON.parse(
        run(g.bin, ['discover', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(discover.data).toEqual([]);
      expect(discover.meta.available).toEqual([
        {
          name: '@acme/widgets',
          components: [],
          version: '1.0.0',
          source: 'installed for this computer',
          install: 'npm install @acme/widgets',
        },
      ]);
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'computer-integrations',
        ),
      ).toMatchObject({
        status: 'info',
        fix: 'To use one in this project, run `npm install @acme/widgets`.',
      });
    });

    it("G37 a project that installs the same integration uses only its own copy, outside the project's folder rules too", () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      acmeWidgets(path.resolve(g.dir, '..', '..', '..'), {
        topic: 'acme-global',
      });
      // The global copy is on the search path, as it is once installed.
      pc.path.unshift(g.binDir);
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
      );
      writeJson(path.join(dir, 'package.json'), {
        ...pkg,
        dependencies: {...pkg.dependencies, '@acme/widgets': '1.0.0'},
      });
      acmeWidgets(dir, {topic: 'acme-project'});
      const docs = JSON.parse(
        run(g.bin, ['docs', '--json'], {cwd: dir, pc}).stdout,
      );
      const topics = docs.data.map((/** @type {any} */ t) => t.topic);
      expect(topics).toContain('acme-project');
      expect(topics).not.toContain('acme-global');
      const discover = JSON.parse(
        run(g.bin, ['discover', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(discover.meta?.available ?? []).toEqual([]);
    });

    it('G38 an integration whose peer range excludes the answering release is skipped outside a project, and doctor warns', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      acmeWidgets(path.resolve(g.dir, '..', '..', '..'), {
        topic: 'acme-deploying',
        peers: {'@astryxdesign/core': '>=10.0.0'},
      });
      const empty = tempDir('empty');
      const docs = JSON.parse(
        run(g.bin, ['docs', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        docs.data.some((/** @type {any} */ t) => t.topic === 'acme-deploying'),
      ).toBe(false);
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'computer-integrations',
        ),
      ).toMatchObject({
        status: 'warn',
        message:
          "Skipped @acme/widgets@1.0.0: it needs @astryxdesign/core >=10.0.0, and this computer's CLI is 9.0.0.",
      });
    });

    it("G39 a door's package set: integrations installed with the CLI in one root count, with no host entry", () => {
      const pc = computer();
      const root = tempDir('runtime');
      writeJson(path.join(root, 'package.json'), {
        name: 'door-runtime',
        private: true,
        dependencies: {
          '@astryxdesign/cli': '9.0.0',
          '@acme/widgets': '1.0.0',
        },
      });
      const cli = placeCli(
        path.join(root, 'node_modules', '@astryxdesign', 'cli'),
        '9.0.0',
      );
      acmeWidgets(root, {topic: 'acme-door'});
      const docs = JSON.parse(
        run(cli.bin, ['docs', '--json'], {cwd: tempDir('empty'), pc}).stdout,
      );
      expect(
        docs.data.find((/** @type {any} */ t) => t.topic === 'acme-door'),
      ).toMatchObject({package: '@acme/widgets'});
    });

    it('G40 pnpm global folders: one shared folder before pnpm 11, a folder per package since, with or without the global virtual store', () => {
      const pc = computer();
      // Before pnpm 11: the CLI's files are in `global/5/.pnpm`, and
      // `global/5/package.json` lists everything installed globally.
      const g5 = path.join(pc.home, '.local', 'share', 'pnpm', 'global', '5');
      const real5 = placeCli(
        path.join(
          g5,
          '.pnpm',
          '@astryxdesign+cli@9.0.0',
          'node_modules',
          '@astryxdesign',
          'cli',
        ),
        '9.0.0',
      );
      writeJson(path.join(g5, 'package.json'), {
        dependencies: {'@astryxdesign/cli': '9.0.0', '@acme/widgets': '1.0.0'},
      });
      fs.mkdirSync(path.join(g5, 'node_modules', '@astryxdesign'), {
        recursive: true,
      });
      fs.symlinkSync(
        real5.dir,
        path.join(g5, 'node_modules', '@astryxdesign', 'cli'),
      );
      acmeWidgets(g5, {topic: 'acme-pnpm10'});
      const empty = tempDir('empty');
      const docs10 = JSON.parse(
        run(real5.bin, ['docs', '--json'], {cwd: empty, pc}).stdout,
      );
      expect(docs10.data.map((/** @type {any} */ t) => t.topic)).toContain(
        'acme-pnpm10',
      );

      // pnpm 11 and later: each global package has a folder of its own under
      // `global/v11`, and the files are in `store/v11/links`.
      const pc2 = computer();
      const home = path.join(pc2.home, '.local', 'share', 'pnpm');
      const store = placeCli(
        path.join(
          home,
          'store',
          'v11',
          'links',
          '@astryxdesign',
          'cli',
          '9.0.0',
          'h1',
          'node_modules',
          '@astryxdesign',
          'cli',
        ),
        '9.0.0',
      );
      const cliFolder = path.join(home, 'global', 'v11', 'a1');
      writeJson(path.join(cliFolder, 'package.json'), {
        dependencies: {'@astryxdesign/cli': '9.0.0'},
      });
      fs.mkdirSync(path.join(cliFolder, 'node_modules', '@astryxdesign'), {
        recursive: true,
      });
      fs.symlinkSync(
        store.dir,
        path.join(cliFolder, 'node_modules', '@astryxdesign', 'cli'),
      );
      const widgetsFolder = path.join(home, 'global', 'v11', 'b2');
      writeJson(path.join(widgetsFolder, 'package.json'), {
        dependencies: {'@acme/widgets': '1.0.0'},
      });
      acmeWidgets(widgetsFolder, {topic: 'acme-pnpm11'});
      const docs11 = JSON.parse(
        run(store.bin, ['docs', '--json'], {cwd: tempDir('empty'), pc: pc2})
          .stdout,
      );
      expect(docs11.data.map((/** @type {any} */ t) => t.topic)).toContain(
        'acme-pnpm11',
      );

      // pnpm 12: no global virtual store, so the CLI's files sit inside its
      // own global folder, under `.pnpm`.
      const pc3 = computer();
      const g12 = path.join(
        pc3.home,
        '.local',
        'share',
        'pnpm',
        'global',
        'v11',
      );
      const own = path.join(g12, 'c3');
      writeJson(path.join(own, 'package.json'), {
        dependencies: {'@astryxdesign/cli': '9.0.0'},
      });
      const inner = placeCli(
        path.join(
          own,
          'node_modules',
          '.pnpm',
          '@astryxdesign+cli@9.0.0',
          'node_modules',
          '@astryxdesign',
          'cli',
        ),
        '9.0.0',
      );
      fs.mkdirSync(path.join(own, 'node_modules', '@astryxdesign'), {
        recursive: true,
      });
      fs.symlinkSync(
        inner.dir,
        path.join(own, 'node_modules', '@astryxdesign', 'cli'),
      );
      const sibling = path.join(g12, 'd4');
      writeJson(path.join(sibling, 'package.json'), {
        dependencies: {'@acme/widgets': '1.0.0'},
      });
      acmeWidgets(sibling, {topic: 'acme-pnpm12'});
      const docs12 = JSON.parse(
        run(inner.bin, ['docs', '--json'], {cwd: tempDir('empty'), pc: pc3})
          .stdout,
      );
      expect(docs12.data.map((/** @type {any} */ t) => t.topic)).toContain(
        'acme-pnpm12',
      );
    });

    it("G41 an integration's own source folder, outside a project: the folder's copy is used, and doctor says so without a warning", () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      acmeWidgets(path.resolve(g.dir, '..', '..', '..'), {
        topic: 'acme-global',
      });
      const source = tempDir('source');
      writeJson(path.join(source, 'package.json'), {
        name: '@acme/widgets',
        version: '2.0.0',
      });
      fs.writeFileSync(
        path.join(source, 'astryx.integration.mjs'),
        'export default {};\n',
      );
      const docs = JSON.parse(
        run(g.bin, ['docs', '--json'], {cwd: source, pc}).stdout,
      );
      expect(docs.data.map((/** @type {any} */ t) => t.topic)).not.toContain(
        'acme-global',
      );
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: source, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'computer-integrations',
        ),
      ).toMatchObject({
        status: 'pass',
        message:
          '@acme/widgets@1.0.0 is not used here: this folder loads its own copy of @acme/widgets.',
      });
    });

    it('G42 inside a project, an integration installed for the computer is offered only when its peer range admits the project release and it loads', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const lib = path.resolve(g.dir, '..', '..', '..');
      acmeWidgets(lib, {topic: 'acme-ok'});
      acmeWidgets(lib, {
        topic: 'acme-old',
        name: '@acme/old',
        peers: {'@astryxdesign/core': '>=10.0.0'},
      });
      acmeWidgets(lib, {
        topic: 'acme-broken',
        name: '@acme/broken',
        manifest: "throw new Error('broken');\n",
      });
      pc.path.unshift(g.binDir);
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      writeJson(path.join(dir, 'package-lock.json'), {lockfileVersion: 3});
      const discover = JSON.parse(
        run(g.bin, ['discover', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(
        discover.meta.available.map((/** @type {any} */ p) => p.name),
      ).toEqual(['@acme/widgets']);
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'computer-integrations',
        ).fix,
      ).toBe('To use one in this project, run `npm install @acme/widgets`.');
    });

    it("G43 inside a project a door's package set answers for: its integrations are offered as available", () => {
      const pc = computer();
      const root = tempDir('runtime');
      writeJson(path.join(root, 'package.json'), {
        name: 'door-runtime',
        private: true,
        dependencies: {'@astryxdesign/cli': '9.0.0', '@acme/widgets': '1.0.0'},
      });
      const cli = placeCli(
        path.join(root, 'node_modules', '@astryxdesign', 'cli'),
        '9.0.0',
      );
      acmeWidgets(root, {topic: 'acme-door'});
      // The project installs only Core 9.0.0, so the door's copy, that
      // release, answers it.
      const dir = makeProject({core: '9.0.0'});
      writeJson(path.join(dir, 'package-lock.json'), {lockfileVersion: 3});
      const discover = JSON.parse(
        run(cli.bin, ['discover', '--json'], {cwd: dir, pc}).stdout,
      );
      expect(discover.meta.answeredBy.copy).toBe('matched');
      expect(discover.meta.available).toEqual([
        {
          name: '@acme/widgets',
          components: [],
          version: '1.0.0',
          source: 'installed for this computer',
          install: 'npm install @acme/widgets',
        },
      ]);
    });

    it("G44 npm's own prefix (npm i -g --prefix ~/.local): the upgrade names that prefix, integrations installed there apply outside a project, and doctor finds ~/.local/bin/astryx", () => {
      const pc = computer();
      const prefix = path.join(pc.home, '.local');
      const cli = placeCli(
        path.join(prefix, 'lib', 'node_modules', '@astryxdesign', 'cli'),
        '9.0.0',
      );
      fs.mkdirSync(path.join(prefix, 'bin'), {recursive: true});
      fs.symlinkSync(cli.bin, path.join(prefix, 'bin', 'astryx'));
      pc.path.unshift(path.join(prefix, 'bin'));
      acmeWidgets(path.join(prefix, 'lib'), {topic: 'acme-prefix'});
      globalState(pc, {latest: '9.0.5', checkOkAt: Date.now(), firstRunAt: 0});
      const empty = tempDir('empty');
      const docs = run(cli.bin, ['docs', '--json'], {cwd: empty, pc});
      expect(
        JSON.parse(docs.stdout).data.map((/** @type {any} */ t) => t.topic),
      ).toContain('acme-prefix');
      // --json prints no notice; a text run does.
      expect(docs.notice).toEqual([]);
      expect(run(cli.bin, ['--version'], {cwd: empty, pc}).notice).toEqual([
        available('9.0.0', '9.0.5'),
        'To upgrade, run: npm i -g --prefix ~/.local @astryxdesign/cli@latest',
      ]);
      const doctor = JSON.parse(
        run(cli.bin, ['doctor', '--json'], {cwd: empty, pc}).stdout,
      );
      const onPath = doctor.data.checks.find(
        (/** @type {any} */ c) => c.id === 'cli-on-path',
      );
      expect(onPath.status).toBe('pass');
      expect(onPath.message).toContain(path.join(prefix, 'bin', 'astryx'));
    });

    it("G45 the agent guide: the global copy's first run writes one file and links Claude Code's folder to it; a folder Astryx did not create is kept and doctor names it; --remove-agents removes the file and the link", async () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const file = path.join(
        pc.home,
        '.agents',
        'skills',
        'astryx',
        'SKILL.md',
      );
      const claude = path.join(pc.home, '.claude', 'skills', 'astryx');
      run(g.bin, ['--version'], {cwd: tempDir('empty'), pc});
      for (let i = 0; i < 100 && !fs.existsSync(claude); i++) {
        await new Promise(done => setTimeout(done, 100));
      }
      expect(fs.readFileSync(file, 'utf8')).toContain('name: astryx');
      expect(fs.lstatSync(claude).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(path.join(claude, 'SKILL.md'), 'utf8')).toBe(
        fs.readFileSync(file, 'utf8'),
      );
      const removed = run(g.bin, ['init', '--user', '--remove-agents'], {
        cwd: tempDir('empty'),
        pc,
      });
      expect(removed.status).toBe(0);
      expect(fs.existsSync(file)).toBe(false);
      expect(fs.existsSync(claude)).toBe(false);

      // A folder someone else put there is never replaced.
      fs.mkdirSync(claude, {recursive: true});
      fs.writeFileSync(path.join(claude, 'SKILL.md'), 'mine\n');
      expect(
        run(g.bin, ['init', '--user'], {cwd: tempDir('empty'), pc}).status,
      ).toBe(0);
      expect(fs.readFileSync(path.join(claude, 'SKILL.md'), 'utf8')).toBe(
        'mine\n',
      );
      const doctor = JSON.parse(
        run(g.bin, ['doctor', '--json'], {cwd: tempDir('empty'), pc}).stdout,
      );
      expect(
        doctor.data.checks.find(
          (/** @type {any} */ c) => c.id === 'computer-agent-text',
        ).message,
      ).toContain(
        `Not linked, because something Astryx did not create is there: ~${path.sep}${path.join('.claude', 'skills', 'astryx')}`,
      );
    });

    it('G46 docs global inside a project whose release predates it: the copy that started the run answers, for this computer, never handed off', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.5', {root: pc.home});
      const dir = makeProject({core: '9.0.0', cli: '9.0.0'});
      for (const args of [
        ['docs', 'global'],
        ['docs', 'global/problems'],
      ]) {
        const r = run(g.bin, args, {cwd: dir, pc});
        expect(r.status).toBe(0);
        expect(r.lines).toEqual([
          'astryx: answered by CLI 9.0.5 with Core 9.0.5, for this computer',
        ]);
      }
      // Any other docs topic is still the project's.
      expect(run(g.bin, ['docs'], {cwd: dir, pc}).lines).toEqual([
        "astryx: answered by this project's CLI 9.0.0, handed over from CLI 9.0.5",
      ]);
    });

    it("G47 offline, a project whose CLI is newer than its Core: that project's own CLI answers, as before global mode, with one warning", () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      // Core 9.0.3 needs release 9.0.3, which is not cached and cannot be
      // fetched; the project's own CLI is 9.0.4.
      const dir = makeProject({core: '9.0.3', cli: '9.0.4'});
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('9.0.4');
      expect(r.lines.filter(l => l.includes('could not get Astryx'))).toEqual([
        expect.stringMatching(
          /^astryx: could not get Astryx 9\.0\.3 to match this project's Core \(.+\); answering with CLI 9\.0\.4 instead$/u,
        ),
      ]);
      const json = run(g.bin, ['docs', '--json'], {cwd: dir, pc});
      expect(json.status).toBe(0);
      expect(JSON.parse(json.stdout).meta.answeredBy).toMatchObject({
        cli: '9.0.4',
        copy: 'fallback',
      });
    });

    it('G48 offline, a project that installs only Core: the starting copy answers, with one warning and copy fallback', () => {
      const pc = computer();
      const g = globalCli('npm', '9.0.0', {root: pc.home});
      const dir = makeProject({core: '9.0.3'});
      const r = run(g.bin, ['--version'], {cwd: dir, pc});
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('9.0.0');
      // After the line saying it tries to install the release, one warning.
      expect(r.lines.filter(l => !l.includes('installing'))).toEqual([
        expect.stringMatching(
          /^astryx: could not get Astryx 9\.0\.3 to match this project's Core \(.+\); answering with CLI 9\.0\.0 instead$/u,
        ),
      ]);
      const json = run(g.bin, ['docs', '--json'], {cwd: dir, pc});
      expect(JSON.parse(json.stdout).meta.answeredBy).toMatchObject({
        cli: '9.0.0',
        copy: 'fallback',
      });
    });
  },
);

it('names every row of the table exactly once', () => {
  const text = fs.readFileSync(new URL(import.meta.url), 'utf8');
  const rows = [
    ...text.matchAll(/^\s+it(?:\.skipIf\([^)]*\)\()?\(?\s*['"](G\d+) /gmu),
  ].map(m => m[1]);
  expect(rows).toEqual(Array.from({length: 48}, (_, i) => `G${i + 1}`));
  expect(os.EOL).toBeTypeOf('string');
});
