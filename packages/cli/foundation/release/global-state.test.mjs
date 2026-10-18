// Copyright (c) Meta Platforms, Inc. and affiliates.

import {describe, it, expect, afterEach} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  AGENT_TEXT_RETRY_MS,
  CHECK_INTERVAL_MS,
  currentGlobalRelease,
  maybeKeepAgentText,
  recordAgentTextWritten,
  knownLatestRelease,
  maybeStartCheck,
  readGlobalState,
  runCheck,
  updateGlobalState,
} from './global-state.mjs';
import {
  CLI_VERSION,
  cleanupFixtures,
  seedRelease,
  tempDir,
} from '../../test-utils/release-fixtures.mjs';
import {recordComputerAgentTextSettings} from '../env/user-settings.mjs';
import {userConfigDir} from '../env/user-dirs.mjs';
import {renderComputerAgentText} from '../agent-docs/computer-agent-text.mjs';

afterEach(cleanupFixtures);

describe('maybeStartCheck', () => {
  it('never checks in the first hour, then at most once an hour', () => {
    const cacheDir = tempDir('cache');
    /** @type {number[]} */
    const started = [];
    const start = () => started.push(1);
    const t0 = 1_000_000;
    expect(maybeStartCheck({cacheDir, now: t0, start})).toBe(false);
    expect(
      maybeStartCheck({cacheDir, now: t0 + CHECK_INTERVAL_MS - 1, start}),
    ).toBe(false);
    expect(
      maybeStartCheck({cacheDir, now: t0 + CHECK_INTERVAL_MS, start}),
    ).toBe(true);
    expect(
      maybeStartCheck({cacheDir, now: t0 + CHECK_INTERVAL_MS + 10, start}),
    ).toBe(false);
    expect(
      maybeStartCheck({cacheDir, now: t0 + 2 * CHECK_INTERVAL_MS, start}),
    ).toBe(true);
    expect(started).toHaveLength(2);
  });
});

describe('runCheck', () => {
  it('installs a new latest, keeps the previous one, and leaves a notice', () => {
    const cacheDir = tempDir('cache');
    seedRelease(cacheDir, '0.7.2');
    updateGlobalState({current: '0.7.2'}, cacheDir);
    const state = runCheck({
      cacheDir,
      resolve: () => '0.7.3',
      ensure: version => {
        const dir = seedRelease(cacheDir, version);
        return {version, dir, cliDir: dir, coreDir: dir, bin: dir};
      },
    });
    expect(state).toMatchObject({
      latest: '0.7.3',
      current: '0.7.3',
      previous: '0.7.2',
      notice: {from: '0.7.2', to: '0.7.3'},
    });
    expect(currentGlobalRelease(cacheDir)?.version).toBe('0.7.3');
    expect(knownLatestRelease(cacheDir)).toBe('0.7.3');
  });

  it('follows the tag back down', () => {
    const cacheDir = tempDir('cache');
    seedRelease(cacheDir, '0.8.0');
    updateGlobalState({current: '0.8.0', latest: '0.8.0'}, cacheDir);
    runCheck({
      cacheDir,
      resolve: () => '0.7.9',
      ensure: version => {
        const dir = seedRelease(cacheDir, version);
        return {version, dir, cliDir: dir, coreDir: dir, bin: dir};
      },
    });
    expect(readGlobalState(cacheDir)).toMatchObject({
      current: '0.7.9',
      previous: '0.8.0',
    });
  });

  it('keeps the current release when the registry or the install fails', () => {
    const cacheDir = tempDir('cache');
    seedRelease(cacheDir, '0.7.2');
    updateGlobalState({current: '0.7.2'}, cacheDir);
    runCheck({cacheDir, resolve: () => null});
    runCheck({
      cacheDir,
      resolve: () => '0.7.3',
      ensure: version => ({
        version,
        reason: 'the registry could not be reached',
      }),
    });
    expect(readGlobalState(cacheDir)).toMatchObject({
      current: '0.7.2',
      latest: '0.7.3',
    });
    expect(readGlobalState(cacheDir).notice ?? null).toBeNull();
  });

  it('says once that a release needs a newer Node, and stays', () => {
    const cacheDir = tempDir('cache');
    seedRelease(cacheDir, '0.7.2');
    updateGlobalState({current: '0.7.2'}, cacheDir);
    const ensure = (/** @type {string} */ version) => ({
      version,
      reason: 'it needs Node >=24, and this computer runs Node 22.13.0',
    });
    runCheck({cacheDir, resolve: () => '0.8.0', ensure});
    expect(readGlobalState(cacheDir)).toMatchObject({
      current: '0.7.2',
      notice: {blockedVersion: '0.8.0'},
    });
  });

  it('does nothing while another check runs', () => {
    const cacheDir = tempDir('cache');
    updateGlobalState({current: '0.7.2'}, cacheDir);
    let asked = false;
    runCheck({
      cacheDir,
      resolve: () => {
        // A second check started while this one holds the lock.
        runCheck({
          cacheDir,
          resolve: () => {
            asked = true;
            return '9.9.9';
          },
        });
        return null;
      },
    });
    expect(asked).toBe(false);
  });
});

describe('currentGlobalRelease on another Node', () => {
  it('answers with the newest kept release that runs on this Node, else the installed copy', () => {
    const cacheDir = tempDir('cache');
    seedRelease(cacheDir, '0.7.1');
    seedRelease(cacheDir, '0.7.2', {engines: {node: '>=20'}});
    seedRelease(cacheDir, '0.8.0', {engines: {node: '>=24'}});
    updateGlobalState({current: '0.8.0', previous: '0.7.2'}, cacheDir);
    expect(
      currentGlobalRelease(cacheDir, {nodeVersion: '24.1.0'})?.version,
    ).toBe('0.8.0');
    expect(
      currentGlobalRelease(cacheDir, {nodeVersion: '22.13.0'})?.version,
    ).toBe('0.7.2');
    expect(
      currentGlobalRelease(cacheDir, {nodeVersion: '18.0.0'})?.version,
    ).toBe('0.7.1');
    // The installed copy is newer than every kept release that runs here.
    expect(
      currentGlobalRelease(cacheDir, {
        nodeVersion: '22.13.0',
        selfVersion: '0.7.5',
      }),
    ).toBeNull();
  });
});

describe('maybeKeepAgentText', () => {
  /** @param {string} cacheDir */
  const setup = cacheDir => {
    const root = tempDir('cli');
    fs.mkdirSync(path.join(root, 'foundation', 'release'), {recursive: true});
    fs.writeFileSync(
      path.join(root, 'foundation', 'release', 'agent-text-worker.mjs'),
      '',
    );
    return {release: {version: '0.8.0', root}, cacheDir};
  };

  it("starts the answering release's step once per release, retrying after an hour", () => {
    const cacheDir = tempDir('cache');
    const configDir = tempDir('config');
    /** @type {string[]} */
    const started = [];
    const start = (/** @type {string} */ worker) => started.push(worker);
    const base = {...setup(cacheDir), configDir, start};
    expect(maybeKeepAgentText({...base, now: 1000})).toBe(true);
    expect(started[0]).toBe(
      path.join(
        base.release.root,
        'foundation',
        'release',
        'agent-text-worker.mjs',
      ),
    );
    expect(maybeKeepAgentText({...base, now: 2000})).toBe(false);
    expect(maybeKeepAgentText({...base, now: 1000 + AGENT_TEXT_RETRY_MS})).toBe(
      true,
    );
    recordAgentTextWritten('0.8.0', cacheDir);
    expect(
      maybeKeepAgentText({...base, now: 1000 + 3 * AGENT_TEXT_RETRY_MS}),
    ).toBe(false);
    // A switch to another release writes its text again.
    expect(
      maybeKeepAgentText({
        ...base,
        release: {...base.release, version: '0.8.1'},
        now: 1000 + 3 * AGENT_TEXT_RETRY_MS,
      }),
    ).toBe(true);
    expect(started).toHaveLength(3);
  });

  it('starts nothing after the person turned the text off, or for a release without the step', () => {
    const cacheDir = tempDir('cache');
    const configDir = tempDir('config');
    const start = () => {
      throw new Error('started');
    };
    recordComputerAgentTextSettings({install: false, agents: null}, configDir);
    expect(maybeKeepAgentText({...setup(cacheDir), configDir, start})).toBe(
      false,
    );
    const other = tempDir('config');
    expect(
      maybeKeepAgentText({
        release: {version: '0.7.0', root: tempDir('old')},
        cacheDir,
        configDir: other,
        start,
      }),
    ).toBe(false);
  });

  it('starts nothing when the attempt cannot be recorded', () => {
    const cacheDir = path.join(tempDir('cache'), 'file');
    fs.writeFileSync(cacheDir, '');
    const start = () => {
      throw new Error('started');
    };
    expect(
      maybeKeepAgentText({
        ...setup(cacheDir),
        configDir: tempDir('config'),
        start,
      }),
    ).toBe(false);
  });
});

describe('agent-text-worker.mjs', () => {
  it('writes the chosen files with this release and records it, keeping an edited file', () => {
    const home = tempDir('home');
    const cacheDir = path.join(home, '.cache', 'astryx');
    const env = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, '.config'),
      APPDATA: path.join(home, 'AppData', 'Roaming'),
    };
    const configDir = userConfigDir({home, env});
    recordComputerAgentTextSettings(
      {install: true, agents: ['claude']},
      configDir,
    );
    const worker = fileURLToPath(
      new URL('./agent-text-worker.mjs', import.meta.url),
    );
    const run = () =>
      spawnSync(process.execPath, [worker, cacheDir], {env, encoding: 'utf8'});
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout + first.stderr).toBe('');
    const claude = path.join(home, '.claude', 'skills', 'astryx', 'SKILL.md');
    expect(fs.readFileSync(claude, 'utf8')).toBe(
      renderComputerAgentText({command: 'astryx'}),
    );
    expect(
      fs.existsSync(path.join(home, '.agents', 'skills', 'astryx', 'SKILL.md')),
    ).toBe(false);
    expect(readGlobalState(cacheDir).agentText).toEqual({
      writtenBy: CLI_VERSION,
    });
    fs.appendFileSync(claude, 'mine\n');
    expect(run().status).toBe(0);
    expect(fs.readFileSync(claude, 'utf8')).toMatch(/mine\n$/u);
  });
});
