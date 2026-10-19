// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The per-user update state, and the background check that keeps it
 * current (spec AST-081 FR6).
 *
 * The CLI never installs a newer release for the computer; it tells its user
 * one exists, the way `gh` and the Vercel CLI do (notices.mjs). At most once a
 * day, never in the first day after the first run, a run starts a detached
 * check of the release the registry tags `latest`; no run waits for it. No
 * check starts when the standard `CI` variable is set, or when
 * `NO_UPDATE_NOTIFIER` is (update-notice-env.mjs).
 *
 *     <user config>/astryx/state.json
 *       firstRunAt   when a run first kept this state (no check before a day)
 *       checkedAt    when the last check started
 *       checkOkAt    when a check last reached the registry
 *       latest       the version `latest` named then
 *       latestNode   the Node range that release declares, or null
 *       agentText    the computer-level agent text: {writtenBy, attemptFor,
 *                    attemptAt}, the release that last wrote it and the last
 *                    background attempt (spec AST-081 FR8)
 *       notifiedAt   when each update notice last printed (notices.mjs)
 *
 * @input  the clock, the registry's `latest` tag (in the worker)
 * @output the newest release known, for notices and doctor
 * @position foundation/release — read by the bin and doctor; the check runs
 *   in refresh-worker.mjs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveLatestRelease, tryLock, isReleaseVersion} from './cache.mjs';
import {readJson} from './project.mjs';
import {userConfigDir} from '../env/user-dirs.mjs';
import {computerAgentTextSettings} from '../env/user-settings.mjs';
import {updateNoticesOff} from './update-notice-env.mjs';

/** How often a check may start: once a day, as `gh` and update-notifier do. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * @typedef {object} GlobalState
 * @property {number} [firstRunAt]
 * @property {number} [checkedAt]
 * @property {number} [checkOkAt]
 * @property {string} [latest]
 * @property {string | null} [latestNode]
 * @property {{writtenBy?: string, attemptFor?: string, attemptAt?: number}} [agentText]
 * @property {Record<string, number>} [notifiedAt] when each update notice
 *   last printed (notices.mjs)
 */

/**
 * The state file.
 * @param {string} [stateDir] the per-user configuration folder
 * @returns {string}
 */
export function stateFile(stateDir = userConfigDir()) {
  return path.join(stateDir, 'state.json');
}

/**
 * The saved state; `{}` when there is none or it cannot be read.
 * @param {string} [stateDir]
 * @returns {GlobalState}
 */
export function readGlobalState(stateDir = userConfigDir()) {
  const state = readJson(stateFile(stateDir));
  return state && typeof state === 'object' && !Array.isArray(state)
    ? state
    : {};
}

/**
 * Merge `patch` into the saved state, atomically. An unwritable folder never
 * fails a run.
 * @param {Partial<GlobalState>} patch
 * @param {string} [stateDir]
 * @returns {GlobalState}
 */
export function updateGlobalState(patch, stateDir = userConfigDir()) {
  const next = {...readGlobalState(stateDir), ...patch};
  const file = stateFile(stateDir);
  try {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch {
    // An unwritable folder never fails a run; the state is simply not kept.
  }
  return next;
}

/**
 * The newest release the last check found, and the Node range it declares;
 * null when no check has reached the registry.
 * @param {string} [stateDir]
 * @returns {{version: string, node: string | null} | null}
 */
export function knownLatest(stateDir = userConfigDir()) {
  const state = readGlobalState(stateDir);
  if (typeof state.checkOkAt !== 'number' || !isReleaseVersion(state.latest)) {
    return null;
  }
  return {
    version: state.latest,
    node: typeof state.latestNode === 'string' ? state.latestNode : null,
  };
}

/**
 * The version of the newest release known, or null.
 * @param {string} [stateDir]
 * @returns {string | null}
 */
export function knownLatestRelease(stateDir = userConfigDir()) {
  return knownLatest(stateDir)?.version ?? null;
}

/**
 * Record the release that last wrote the computer-level agent text.
 * @param {string | null} version
 * @param {string} [stateDir]
 */
export function recordAgentTextWritten(version, stateDir = userConfigDir()) {
  if (!isReleaseVersion(version)) return;
  updateGlobalState({agentText: {writtenBy: version}}, stateDir);
}

/** A background attempt to write the agent text is retried after an hour. */
export const AGENT_TEXT_RETRY_MS = 60 * 60_000;

/**
 * The global copy keeps the computer-level agent text installed (spec
 * AST-081 FR8): when the person has not turned it off and the running global
 * version has not written it yet, as after the person upgraded the global
 * copy, that release's own background step writes it, detached, so no command
 * waits. Returns whether a step was started.
 *
 * @param {{
 *   release: {version: string, root: string},
 *   stateDir?: string,
 *   configDir?: string,
 *   now?: number,
 *   start?: (worker: string, stateDir: string) => void,
 * }} options
 * @returns {boolean}
 */
export function maybeKeepAgentText({
  release,
  stateDir = userConfigDir(),
  configDir,
  now = Date.now(),
  start = startWorker,
}) {
  if (!computerAgentTextSettings(configDir).install) return false;
  const {agentText} = readGlobalState(stateDir);
  if (agentText?.writtenBy === release.version) return false;
  if (
    agentText?.attemptFor === release.version &&
    typeof agentText.attemptAt === 'number' &&
    now - agentText.attemptAt < AGENT_TEXT_RETRY_MS
  ) {
    return false;
  }
  const worker = path.join(
    release.root,
    'foundation',
    'release',
    'agent-text-worker.mjs',
  );
  // A release without the step predates it; it never writes the text.
  if (!fs.existsSync(worker)) return false;
  updateGlobalState(
    {agentText: {...agentText, attemptFor: release.version, attemptAt: now}},
    stateDir,
  );
  // An attempt that cannot be recorded would start again on every run.
  if (readGlobalState(stateDir).agentText?.attemptAt !== now) return false;
  start(worker, stateDir);
  return true;
}

/**
 * Start the background check when one is due: never when the environment
 * turns update notices off (`CI`, `NO_UPDATE_NOTIFIER`), never in the first
 * day after the first run, and at most once a day. Returns whether a check
 * was started.
 *
 * @param {{
 *   stateDir?: string,
 *   now?: number,
 *   env?: Record<string, string | undefined>,
 *   start?: (worker: string, stateDir: string) => void,
 * }} [options]
 * @returns {boolean}
 */
export function maybeStartCheck(options = {}) {
  const {
    stateDir = userConfigDir(),
    now = Date.now(),
    env = process.env,
    start = startWorker,
  } = options;
  if (updateNoticesOff(env)) return false;
  const state = readGlobalState(stateDir);
  if (typeof state.firstRunAt !== 'number') {
    updateGlobalState({firstRunAt: now}, stateDir);
    return false;
  }
  const last = Math.max(state.firstRunAt, state.checkedAt ?? 0);
  if (now - last < CHECK_INTERVAL_MS) return false;
  updateGlobalState({checkedAt: now}, stateDir);
  // A start time that cannot be recorded would start a check on every run.
  if (readGlobalState(stateDir).checkedAt !== now) return false;
  start(
    fileURLToPath(new URL('./refresh-worker.mjs', import.meta.url)),
    stateDir,
  );
  return true;
}

/**
 * Start a detached worker that outlives this run and reaches no stream.
 * @param {string} worker
 * @param {string} stateDir
 */
function startWorker(worker, stateDir) {
  try {
    const child = spawn(process.execPath, [worker, stateDir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    // A check that cannot start is the same as a failed check.
  }
}

/**
 * The check itself: ask the registry for `latest` and save what it says. It
 * installs nothing. At most one check runs at a time.
 * @param {{stateDir?: string, resolve?: typeof resolveLatestRelease}} [options]
 * @returns {GlobalState}
 */
export function runCheck(options = {}) {
  const {stateDir = userConfigDir(), resolve = resolveLatestRelease} = options;
  const lockDir = path.join(stateDir, '.lock-check');
  try {
    if (!tryLock(lockDir)) return readGlobalState(stateDir);
  } catch {
    return readGlobalState(stateDir);
  }
  try {
    const latest = resolve();
    if (!latest) return readGlobalState(stateDir);
    return updateGlobalState(
      {latest: latest.version, latestNode: latest.node, checkOkAt: Date.now()},
      stateDir,
    );
  } finally {
    fs.rmSync(lockDir, {recursive: true, force: true});
  }
}
