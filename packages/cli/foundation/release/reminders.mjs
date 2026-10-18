// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The reminders a text-mode run prints when a release is behind (spec
 * AST-081 FR10), and the facts `doctor` reports from the same source.
 *
 * Three reminders, each at most once in any 24 hours:
 *
 * - the global copy cannot move to the newest release it knows of: that
 *   release needs a newer Node, the per-user cache cannot be written, or no
 *   check has reached the package registry for 7 days. The line points at
 *   `astryx doctor`, which names the fix for this computer.
 * - the release that answers a project is older than the newest release the
 *   global copy knows of. The line names both versions and the exact install
 *   and upgrade commands for the project's package manager. Kept per project.
 * - the first `astryx` on the search path is an Astryx CLI release that
 *   predates the hand-off, so it answers every folder itself. The line names
 *   the command that replaces it.
 *
 * The times of the reminders are kept in `astryx/reminders.json` in the
 * per-user configuration folder. A reminder whose time cannot be recorded is
 * not printed, so a computer that cannot keep the file never prints one on
 * every run. A computer that has never completed a check knows no newest
 * release, so it prints no reminder about one. Prerelease and canary releases
 * are never reported as behind.
 *
 * @input  the global state, the release choice, the project's files, the
 *   search path, and the clock
 * @output reminder lines, and the facts behind them
 * @position foundation/release — printed by handoff.mjs's startRun, read by
 *   doctor.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {userConfigDir} from '../env/user-dirs.mjs';
import {astryxCommandsOnSearchPath} from '../env/search-path.mjs';
import {
  CLI_PACKAGE,
  detectPackageManager,
  getDlxPrefix,
  getRunPrefix,
} from '../env/package-manager.mjs';
import {semverCompare} from '../env/semver.mjs';
import {isReleaseVersion, userCacheDir} from './cache.mjs';
import {currentGlobalRelease, readGlobalState} from './global-state.mjs';
import {projectRootOf} from './choose.mjs';
import {readJson, readReleaseFacts} from './project.mjs';
import {samePath} from '../fs/path-compare.mjs';

/** A reminder prints at most once in this long. */
export const REMINDER_INTERVAL_MS = 24 * 60 * 60_000;

/** After this long without reaching the registry, the global copy says so. */
export const OFFLINE_REMINDER_MS = 7 * 24 * 60 * 60_000;

/** Reminder times older than this are dropped from the file. */
const FORGET_AFTER_MS = 30 * 24 * 60 * 60_000;

/** The command that replaces a global copy that predates the hand-off. */
export const REPLACE_GLOBAL_COPY = 'npm i -g @astryxdesign/cli@latest';

/**
 * The file that keeps the reminder times.
 * @param {string} [configDir]
 * @returns {string}
 */
export function remindersFile(configDir = userConfigDir()) {
  return path.join(configDir, 'reminders.json');
}

/**
 * @param {string} configDir
 * @returns {Record<string, number>}
 */
function readTimes(configDir) {
  const value = readJson(remindersFile(configDir));
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/**
 * Whether reminder `key` may print now; when it may, its time is recorded
 * first, and a time that cannot be recorded keeps it from printing.
 * @param {string} key
 * @param {{configDir?: string, now?: number}} [options]
 * @returns {boolean}
 */
export function takeReminder(
  key,
  {configDir = userConfigDir(), now = Date.now()} = {},
) {
  const times = readTimes(configDir);
  const last = times[key];
  if (typeof last === 'number' && now - last < REMINDER_INTERVAL_MS) {
    return false;
  }
  /** @type {Record<string, number>} */
  const next = {};
  for (const [k, t] of Object.entries(times)) {
    if (typeof t === 'number' && now - t < FORGET_AFTER_MS) next[k] = t;
  }
  next[key] = now;
  const file = remindersFile(configDir);
  try {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch {
    return false;
  }
  return readTimes(configDir)[key] === now;
}

/**
 * Whether a folder, or the nearest folder above it that exists, can be
 * written.
 * @param {string} dir
 * @returns {boolean}
 */
export function canWrite(dir) {
  for (let at = path.resolve(dir); ;) {
    if (fs.existsSync(at)) {
      try {
        fs.accessSync(at, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }
    const parent = path.dirname(at);
    if (parent === at) return false;
    at = parent;
  }
}

/**
 * Is `version` a plain release older than `newest`?
 * @param {string | null | undefined} version
 * @param {string | null | undefined} newest
 * @returns {boolean}
 */
function isBehind(version, newest) {
  return (
    isReleaseVersion(version) &&
    isReleaseVersion(newest) &&
    !version.includes('-') &&
    !newest.includes('-') &&
    semverCompare(newest, version) > 0
  );
}

/**
 * @typedef {object} GlobalLag
 * @property {'node' | 'cache' | 'offline'} cause
 * @property {string | null} newest the newest release known, when the cause
 *   keeps the copy from it
 * @property {string} message why, in words
 * @property {string} fix what to do about it
 */

/**
 * Why the global copy cannot move to the newest release, or null when it can
 * or no newest release is known.
 * @param {{cacheDir?: string, selfVersion: string, now?: number}} options
 * @returns {GlobalLag | null}
 */
export function globalLag({
  cacheDir = userCacheDir(),
  selfVersion,
  now = Date.now(),
}) {
  const state = readGlobalState(cacheDir);
  if (typeof state.checkOkAt !== 'number') return null;
  const latest = isReleaseVersion(state.latest) ? state.latest : null;
  const answering =
    currentGlobalRelease(cacheDir, {selfVersion})?.version ?? selfVersion;
  if (latest && isBehind(answering, latest)) {
    if (state.notice?.blockedVersion === latest && state.notice.blockedReason) {
      return {
        cause: 'node',
        newest: latest,
        message: state.notice.blockedReason,
        fix: `Install a Node version that ${latest} supports, then run \`astryx --version\`.`,
      };
    }
    if (!canWrite(cacheDir)) {
      return {
        cause: 'cache',
        newest: latest,
        message: `the per-user cache ${cacheDir} cannot be written`,
        fix: `Make ${cacheDir} writable by your user, or remove it so the CLI can create it again.`,
      };
    }
  }
  const lastTry = typeof state.checkedAt === 'number' ? state.checkedAt : 0;
  if (lastTry - state.checkOkAt > OFFLINE_REMINDER_MS) {
    const days = Math.floor((now - state.checkOkAt) / (24 * 60 * 60_000));
    return {
      cause: 'offline',
      newest: null,
      message: `the package registry has not been reached for ${days} days`,
      fix: 'Check that npm can reach your package registry (`npm view @astryxdesign/cli version`); the CLI uses your npm registry, proxy, and offline settings.',
    };
  }
  return null;
}

/**
 * The line for a global copy that cannot move.
 * @param {GlobalLag} lag
 * @returns {string}
 */
export function globalLagLine(lag) {
  return lag.newest
    ? `astryx: cannot move to Astryx ${lag.newest}: ${lag.message}. Run astryx doctor for the fix.`
    : `astryx: cannot check for newer releases: ${lag.message}. Run astryx doctor for the fix.`;
}

/**
 * @typedef {object} ProjectLag
 * @property {string} root the project's folder
 * @property {string} current the release that answers it
 * @property {string} newest the newest release known
 * @property {string} install the command that installs the newest release
 * @property {string} upgrade the command that migrates the project
 */

/**
 * The install verb of each package manager.
 * @type {Record<string, string>}
 */
const ADD = {
  npm: 'npm install',
  pnpm: 'pnpm add',
  yarn: 'yarn add',
  bun: 'bun add',
};

/**
 * Whether the project's release is older than the newest release the global
 * copy knows of, and the commands that upgrade it.
 * @param {{cwd: string, current: string, cacheDir?: string}} options
 * @returns {ProjectLag | null}
 */
export function projectLag({cwd, current, cacheDir = userCacheDir()}) {
  const state = readGlobalState(cacheDir);
  if (typeof state.checkOkAt !== 'number') return null;
  const newest = isReleaseVersion(state.latest) ? state.latest : null;
  if (!newest || !isBehind(current, newest)) return null;
  const facts = readReleaseFacts(cwd);
  if (!facts.inProject) return null;
  const root = projectRootOf(facts) ?? cwd;
  const declaresCli = Boolean(facts.cli || facts.declaredCliRange);
  const pm = detectPackageManager(root);
  const packages = [`@astryxdesign/core@${newest}`];
  if (declaresCli) packages.push(`${CLI_PACKAGE}@${newest}`);
  const install = `${ADD[pm] ?? ADD.npm} ${packages.join(' ')}`;
  const stem = declaresCli
    ? `${getRunPrefix(root)} astryx`
    : `${getDlxPrefix(root)} ${CLI_PACKAGE}@${newest}`;
  return {
    root,
    current,
    newest,
    install,
    upgrade: `${stem} upgrade --from ${current} --apply`,
  };
}

/**
 * The line for a project on an older release.
 * @param {ProjectLag} lag
 * @returns {string}
 */
export function projectLagLine(lag) {
  return `astryx: this project uses Astryx ${lag.current}; ${lag.newest} is the newest. To upgrade: ${lag.install}, then ${lag.upgrade}.`;
}

/**
 * The first `astryx` on the search path, when it is an Astryx CLI release
 * that predates the hand-off and is not the running copy.
 * @param {{selfRoot?: string, searchPath?: string, platform?: NodeJS.Platform}} [options]
 * @returns {{file: string, version: string | null} | null}
 */
export function oldGlobalCommand({selfRoot, ...options} = {}) {
  const first = astryxCommandsOnSearchPath(options)[0];
  if (!first?.astryx || !first.cliRoot || first.handsOff !== false) return null;
  if (selfRoot && samePath(real(selfRoot), real(first.cliRoot))) return null;
  return {file: first.file, version: first.version};
}

/**
 * @param {string} p
 * @returns {string}
 */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The line for a global copy that predates the hand-off.
 * @param {{version: string | null}} old
 * @returns {string}
 */
export function oldGlobalLine(old) {
  return `astryx: the astryx command on this computer runs CLI ${old.version ?? '(unknown version)'}, which answers every folder itself. Replace it: ${REPLACE_GLOBAL_COPY}.`;
}

/**
 * The reminder lines a text-mode run prints, each recorded as printed.
 * Never throws.
 * @param {{
 *   cwd: string,
 *   self: {version: string, root: string},
 *   global: boolean,
 *   choice: {inProject: boolean, version: string},
 *   cacheDir?: string,
 *   configDir?: string,
 *   now?: number,
 *   searchPath?: string,
 * }} options
 * @returns {string[]}
 */
export function reminderLines({
  cwd,
  self,
  global,
  choice,
  cacheDir = userCacheDir(),
  configDir = userConfigDir(),
  now = Date.now(),
  searchPath,
}) {
  /** @type {string[]} */
  const lines = [];
  const take = (/** @type {string} */ key) =>
    takeReminder(key, {configDir, now});
  try {
    if (global) {
      const lag = globalLag({cacheDir, selfVersion: self.version, now});
      if (lag && take(`global:${lag.cause}`)) lines.push(globalLagLine(lag));
    }
  } catch {
    // A reminder never fails a run.
  }
  try {
    if (choice.inProject) {
      const lag = projectLag({cwd, current: choice.version, cacheDir});
      if (lag && take(`project:${lag.root}`)) lines.push(projectLagLine(lag));
    }
  } catch {
    // Nor does this one.
  }
  try {
    const times = readTimes(configDir);
    const last = times['old-global'];
    if (typeof last !== 'number' || now - last >= REMINDER_INTERVAL_MS) {
      const old = oldGlobalCommand({
        selfRoot: self.root,
        ...(searchPath === undefined ? {} : {searchPath}),
      });
      if (old && take('old-global')) lines.push(oldGlobalLine(old));
    }
  } catch {
    // Nor this one.
  }
  return lines;
}
