// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The reminders (spec AST-081 FR10): when each one applies, the exact
 * commands it names, and that it prints at most once a day.
 */

import {afterEach, describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  OFFLINE_REMINDER_MS,
  REMINDER_INTERVAL_MS,
  globalLag,
  globalLagLine,
  oldGlobalCommand,
  oldGlobalLine,
  projectLag,
  projectLagLine,
  reminderLines,
  remindersFile,
  takeReminder,
} from './reminders.mjs';
import {updateGlobalState} from './global-state.mjs';
import {
  cleanupFixtures,
  installCore,
  installStandInCli,
  project,
  seedRelease,
  tempDir,
  writeJson,
} from '../../test-utils/release-fixtures.mjs';

afterEach(cleanupFixtures);

const DAY = 24 * 60 * 60_000;

/**
 * An Astryx CLI package on a search path folder, with or without the hand-off.
 * @param {string} version
 * @param {{handsOff?: boolean}} [options]
 */
function cliOnPath(version, {handsOff = false} = {}) {
  const prefix = tempDir('prefix');
  const pkg = path.join(prefix, 'lib', 'node_modules', '@astryxdesign', 'cli');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({name: '@astryxdesign/cli', version}),
  );
  fs.writeFileSync(path.join(pkg, 'bin.mjs'), '#!/usr/bin/env node\n');
  fs.chmodSync(path.join(pkg, 'bin.mjs'), 0o755);
  if (handsOff) {
    fs.mkdirSync(path.join(pkg, 'foundation', 'release'), {recursive: true});
    fs.writeFileSync(path.join(pkg, 'foundation', 'release', 'choose.mjs'), '');
  }
  fs.mkdirSync(path.join(prefix, 'bin'));
  fs.symlinkSync(path.join(pkg, 'bin.mjs'), path.join(prefix, 'bin', 'astryx'));
  return {bin: path.join(prefix, 'bin'), pkg};
}

describe('takeReminder', () => {
  it('lets a reminder print once in any 24 hours, per key', () => {
    const configDir = tempDir('config');
    expect(takeReminder('a', {configDir, now: 1000})).toBe(true);
    expect(takeReminder('a', {configDir, now: 1000 + DAY - 1})).toBe(false);
    expect(takeReminder('b', {configDir, now: 2000})).toBe(true);
    expect(
      takeReminder('a', {configDir, now: 1000 + REMINDER_INTERVAL_MS}),
    ).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(remindersFile(configDir), 'utf8')),
    ).toEqual({
      a: 1000 + REMINDER_INTERVAL_MS,
      b: 2000,
    });
  });

  it('prints nothing when the time cannot be recorded', () => {
    const file = path.join(tempDir('config'), 'file');
    fs.writeFileSync(file, '');
    expect(takeReminder('a', {configDir: file, now: 1})).toBe(false);
  });
});

describe('globalLag', () => {
  it('is null until a check has reached the registry, and when the copy is current', () => {
    const cacheDir = tempDir('cache');
    updateGlobalState({latest: '0.8.0'}, cacheDir);
    expect(globalLag({cacheDir, selfVersion: '0.7.2'})).toBeNull();
    updateGlobalState({checkOkAt: 1, checkedAt: 1}, cacheDir);
    expect(globalLag({cacheDir, selfVersion: '0.8.0'})).toBeNull();
  });

  it('names a newest release that needs a newer Node', () => {
    const cacheDir = tempDir('cache');
    updateGlobalState(
      {
        latest: '0.8.0',
        checkOkAt: 1,
        checkedAt: 1,
        notice: {
          blockedVersion: '0.8.0',
          blockedReason:
            'it needs Node >=24, and this computer runs Node 22.13.0',
        },
      },
      cacheDir,
    );
    const lag = globalLag({cacheDir, selfVersion: '0.7.2'});
    expect(lag).toMatchObject({cause: 'node', newest: '0.8.0'});
    expect(globalLagLine(/** @type {any} */ (lag))).toBe(
      'astryx: cannot move to Astryx 0.8.0: it needs Node >=24, and this computer runs Node 22.13.0. Run astryx doctor for the fix.',
    );
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'names a cache that cannot be written',
    () => {
      const cacheDir = tempDir('cache');
      updateGlobalState(
        {latest: '0.8.0', checkOkAt: 1, checkedAt: 1},
        cacheDir,
      );
      fs.chmodSync(cacheDir, 0o500);
      try {
        const lag = globalLag({cacheDir, selfVersion: '0.7.2'});
        expect(lag).toMatchObject({cause: 'cache', newest: '0.8.0'});
        expect(lag?.message).toContain(cacheDir);
      } finally {
        fs.chmodSync(cacheDir, 0o700);
      }
    },
  );

  it('names seven days without reaching the registry', () => {
    const cacheDir = tempDir('cache');
    const now = 100 * DAY;
    updateGlobalState(
      {
        latest: '0.8.0',
        current: '0.8.0',
        checkOkAt: now - 9 * DAY,
        checkedAt: now - 1,
      },
      cacheDir,
    );
    seedRelease(cacheDir, '0.8.0');
    const lag = globalLag({cacheDir, selfVersion: '0.7.2', now});
    expect(lag).toMatchObject({cause: 'offline', newest: null});
    expect(globalLagLine(/** @type {any} */ (lag))).toBe(
      'astryx: cannot check for newer releases: the package registry has not been reached for 9 days. Run astryx doctor for the fix.',
    );
    updateGlobalState(
      {checkedAt: now - 9 * DAY + OFFLINE_REMINDER_MS - 1},
      cacheDir,
    );
    expect(globalLag({cacheDir, selfVersion: '0.7.2', now})).toBeNull();
  });
});

describe('projectLag', () => {
  it('names the install and upgrade commands for the project', () => {
    const cacheDir = tempDir('cache');
    updateGlobalState({latest: '0.7.3', checkOkAt: 1}, cacheDir);
    const coreOnly = project(tempDir(), {'@astryxdesign/core': '0.7.1'});
    // The lockfile names the package manager, whatever runs the tests.
    writeJson(path.join(coreOnly, 'package-lock.json'), {lockfileVersion: 3});
    installCore(coreOnly, '0.7.1');
    const lag = projectLag({cwd: coreOnly, current: '0.7.1', cacheDir});
    expect(lag).toMatchObject({
      root: coreOnly,
      install: 'npm install @astryxdesign/core@0.7.3',
      upgrade: 'npx @astryxdesign/cli@0.7.3 upgrade --from 0.7.1 --apply',
    });
    expect(projectLagLine(/** @type {any} */ (lag))).toBe(
      'astryx: this project uses Astryx 0.7.1; 0.7.3 is the newest. To upgrade: npm install @astryxdesign/core@0.7.3, then npx @astryxdesign/cli@0.7.3 upgrade --from 0.7.1 --apply.',
    );

    const pnpm = project(tempDir(), {
      '@astryxdesign/core': '0.7.1',
      '@astryxdesign/cli': '0.7.1',
    });
    fs.writeFileSync(
      path.join(pnpm, 'pnpm-lock.yaml'),
      "lockfileVersion: '9.0'\n",
    );
    installCore(pnpm, '0.7.1');
    installStandInCli(pnpm, '0.7.1');
    expect(projectLag({cwd: pnpm, current: '0.7.1', cacheDir})).toMatchObject({
      install: 'pnpm add @astryxdesign/core@0.7.3 @astryxdesign/cli@0.7.3',
      upgrade: 'pnpm exec astryx upgrade --from 0.7.1 --apply',
    });
  });

  it('is null for a current, newer, or prerelease project, and with no known newest', () => {
    const cacheDir = tempDir('cache');
    const dir = project(tempDir(), {'@astryxdesign/core': '0.7.3'});
    expect(projectLag({cwd: dir, current: '0.7.1', cacheDir})).toBeNull();
    updateGlobalState({latest: '0.7.3', checkOkAt: 1}, cacheDir);
    for (const current of ['0.7.3', '0.8.0', '0.7.2-canary.4']) {
      expect(projectLag({cwd: dir, current, cacheDir})).toBeNull();
    }
  });
});

describe.skipIf(process.platform === 'win32')('oldGlobalCommand', () => {
  it('names a first astryx that predates the hand-off, and not one that hands off', () => {
    const old = cliOnPath('0.7.1');
    expect(oldGlobalCommand({searchPath: old.bin, platform: 'linux'})).toEqual({
      file: path.join(old.bin, 'astryx'),
      version: '0.7.1',
    });
    expect(oldGlobalLine({version: '0.7.1'})).toBe(
      'astryx: the astryx command on this computer runs CLI 0.7.1, which answers every folder itself. Replace it: npm i -g @astryxdesign/cli@latest.',
    );
    const current = cliOnPath('0.8.0', {handsOff: true});
    expect(
      oldGlobalCommand({
        searchPath: [current.bin, old.bin].join(path.delimiter),
        platform: 'linux',
      }),
    ).toBeNull();
    expect(
      oldGlobalCommand({
        selfRoot: old.pkg,
        searchPath: old.bin,
        platform: 'linux',
      }),
    ).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('reminderLines', () => {
  it('prints each reminder at most once a day', () => {
    const cacheDir = tempDir('cache');
    const configDir = tempDir('config');
    updateGlobalState({latest: '0.7.3', checkOkAt: 1}, cacheDir);
    const dir = project(tempDir(), {'@astryxdesign/core': '0.7.1'});
    installCore(dir, '0.7.1');
    const old = cliOnPath('0.7.1');
    const input = {
      cwd: dir,
      self: {version: '0.7.1', root: tempDir('self')},
      global: false,
      choice: {inProject: true, version: '0.7.1'},
      cacheDir,
      configDir,
      searchPath: old.bin,
    };
    expect(reminderLines({...input, now: 10})).toEqual([
      expect.stringContaining(
        'this project uses Astryx 0.7.1; 0.7.3 is the newest',
      ),
      expect.stringContaining(
        'runs CLI 0.7.1, which answers every folder itself',
      ),
    ]);
    expect(reminderLines({...input, now: 20})).toEqual([]);
    expect(reminderLines({...input, now: 10 + DAY})).toHaveLength(2);
  });
});
