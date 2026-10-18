// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The computer-level agent text (spec AST-081 FR8): one skill file,
 * written to the skill folders coding agents read in the home folder, so an
 * agent working anywhere on the computer knows how to use Astryx.
 *
 * `COMPUTER_AGENT_FILES` names each agent and the file it reads; agents that
 * share a file share one write:
 *
 * - `claude` reads `~/.claude/skills/astryx/SKILL.md`
 * - `codex`, `gemini`, `copilot`, `cursor`, `opencode`, and most other agent
 *   tools read `~/.agents/skills/astryx/SKILL.md`
 * - `continue`, `kiro`, and `windsurf` read only their own folder, written
 *   for every agent only when that tool's folder exists
 *
 * Tools that read both shared folders list the skill once; no always-on
 * instructions file is written, since no tool merges one with a skill.
 *
 * The body comes from the same source as a project's agent-docs block
 * (`generateCompressedIndex`, scope `computer`): no version, no component
 * count, no integrations, and a lead line that defers to a project's own agent
 * docs. It keeps the Astryx markers, which is how a file Astryx wrote is told
 * apart from one a person wrote, and records, inside them, a hash of the
 * file's text, which is how a file a person edited is told apart from an
 * older rendering. A file without the markers, an edited file, and a
 * symlinked file are never changed.
 *
 * `astryx init --user` writes and removes these files, and the global copy's
 * background step (`foundation/release/agent-text-worker.mjs`) keeps them on
 * its release (FR7, FR8). Both honor the person's choices in the settings file
 * (`foundation/env/user-settings.mjs`). This module is deliberately separate
 * from the project agent-docs root resolution: it names fixed files in the
 * home folder and nothing else.
 *
 * @input  the home folder, the running release, the host's door (if any),
 *   the chosen agents
 * @output the rendered text, its state on disk, and the write/remove receipt rows
 * @position foundation/agent-docs — read by `init --user`, by the background
 *   step, and by `doctor`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {cliDoor} from '../env/cli-command.mjs';
import {astryxCommandsOnSearchPath} from '../env/search-path.mjs';
import {generateCompressedIndex} from './agent-docs.mjs';
import {createHash} from 'node:crypto';
import {MARKER_START, MARKER_END} from './agent-doc-state.mjs';

/** The command the computer-level text uses when no host door is set. */
export const COMPUTER_COMMAND = 'astryx';

/** The install step for the CLI copy the computer-level text relies on. */
export const COMPUTER_INSTALL_STEP = 'npm i -g @astryxdesign/cli';

const SHARED_SKILL = path.join('.agents', 'skills', 'astryx', 'SKILL.md');
const CLAUDE_SKILL = path.join('.claude', 'skills', 'astryx', 'SKILL.md');
const CONTINUE_SKILL = path.join('.continue', 'skills', 'astryx', 'SKILL.md');
const KIRO_SKILL = path.join('.kiro', 'skills', 'astryx', 'SKILL.md');
const WINDSURF_SKILL = path.join(
  '.codeium',
  'windsurf',
  'skills',
  'astryx',
  'SKILL.md',
);

/**
 * Each agent name `astryx init --user --agent` accepts, and the file, relative
 * to the home folder, that agent reads. Most agent tools read the shared
 * `.agents/skills` folder; Claude Code reads only its own; a few tools read
 * only their own folder, which no other tool reads, so writing it adds no
 * second copy anywhere.
 * @type {Readonly<Record<string, string>>}
 */
export const COMPUTER_AGENT_FILES = Object.freeze(
  // Pairs, not an object literal: some agent names are also style property
  // names, and these are file paths, not styles.
  Object.fromEntries([
    ['claude', CLAUDE_SKILL],
    ...[
      'codex',
      'gemini',
      'copilot',
      'cursor',
      'opencode',
      'crush',
      'qwen',
      'cline',
      'amp',
      'goose',
      'roo',
      'zed',
    ].map(name => [name, SHARED_SKILL]),
    ['continue', CONTINUE_SKILL],
    ['kiro', KIRO_SKILL],
    ['windsurf', WINDSURF_SKILL],
  ]),
);

/** The agent names, in the order the docs list them. */
export const COMPUTER_AGENTS = Object.freeze(Object.keys(COMPUTER_AGENT_FILES));

/**
 * Every file, relative to the home folder, in the order they are written and
 * reported, with the folder of the one tool that reads it when only that tool
 * does. Without a chosen agent list, such a file is written only when its
 * tool's folder exists in the home folder.
 * @type {ReadonlyArray<{file: string, toolFolder: string | null}>}
 */
const SKILL_FILES = Object.freeze([
  {file: SHARED_SKILL, toolFolder: null},
  {file: CLAUDE_SKILL, toolFolder: null},
  {file: CONTINUE_SKILL, toolFolder: '.continue'},
  {file: KIRO_SKILL, toolFolder: '.kiro'},
  {file: WINDSURF_SKILL, toolFolder: path.join('.codeium', 'windsurf')},
]);

/**
 * When an agent should load the skill; the frontmatter `description`.
 */
const SKILL_DESCRIPTION =
  'Build and change UI with the Astryx design system: components, page templates, blocks, themes, and tokens from @astryxdesign packages. ' +
  'Use when a task mentions Astryx or @astryxdesign, or builds UI in a project that uses them.';

/**
 * A home-folder path as a person reads it: `~/.claude/skills/astryx/SKILL.md`.
 * @param {string} file
 * @param {string} [home]
 * @returns {string}
 */
export function displayHomePath(file, home = os.homedir()) {
  const rel = path.relative(home, file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
    ? `~${path.sep}${rel}`
    : file;
}

/**
 * The absolute paths of the computer-level text the chosen agents read: with
 * no list, the shared and Claude Code files, and each single-tool file whose
 * tool's folder exists; with a list, exactly the files those agents read.
 * @param {string} [home] the home folder; defaults to the current user's
 * @param {readonly string[] | null} [agents] agent names; `null` for every agent
 * @returns {string[]}
 */
export function computerAgentTextPaths(home = os.homedir(), agents = null) {
  const wanted = agents
    ? new Set(agents.map(name => COMPUTER_AGENT_FILES[name]).filter(Boolean))
    : null;
  return SKILL_FILES.filter(({file, toolFolder}) =>
    wanted
      ? wanted.has(file)
      : !toolFolder || fs.existsSync(path.join(home, toolFolder)),
  ).map(({file}) => path.join(home, file));
}

/**
 * Every file Astryx may write for the computer-level text, whether or not
 * any chosen agent reads it.
 * @param {string} [home]
 * @returns {string[]}
 */
export function allComputerAgentTextPaths(home = os.homedir()) {
  return SKILL_FILES.map(({file}) => path.join(home, file));
}

/**
 * The names in `agents` that are not agent names.
 * @param {readonly string[]} agents
 * @returns {string[]}
 */
export function unknownComputerAgents(agents) {
  return agents.filter(name => !Object.hasOwn(COMPUTER_AGENT_FILES, name));
}

/**
 * The command the computer-level text tells agents to run: the host's door
 * when one started this run, else `astryx`. An integration's `cliCommand`
 * never applies: no project, so no integration, is in scope.
 * @returns {string}
 */
export function computerAgentCommand() {
  return cliDoor() ?? COMPUTER_COMMAND;
}

/**
 * The full skill file this release writes.
 * @param {{command?: string}} [options]
 * @returns {string}
 */
export function renderComputerAgentText({
  command = computerAgentCommand(),
} = {}) {
  const body = generateCompressedIndex(null, {
    scope: 'computer',
    invocation: command,
  });
  return withHash(
    [
      '---',
      'name: astryx',
      // Quoted: the description holds `: `, which strict YAML parsers read as a
      // second mapping, and an agent tool with one drops the whole skill.
      `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
      '---',
      '',
      body,
      '',
    ].join('\n'),
  );
}

/** The line, right after the start marker, that records the file's hash. */
const HASH_LINE = /^<!-- astryx-managed sha256:([0-9a-f]{64}) -->\n/mu;

/**
 * The sha256 of a file's text without its hash line.
 * @param {string} text
 * @returns {string}
 */
function hashOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Insert the hash line after the start marker.
 * @param {string} text a rendering without a hash line
 * @returns {string}
 */
function withHash(text) {
  const at = text.indexOf(MARKER_START);
  if (at === -1) return text;
  const lineEnd = text.indexOf('\n', at);
  const cut = lineEnd === -1 ? text.length : lineEnd + 1;
  return `${text.slice(0, cut)}<!-- astryx-managed sha256:${hashOf(text)} -->\n${text.slice(cut)}`;
}

/**
 * Whether a file with the markers is unedited: it carries a hash line, and
 * the hash matches the rest of its text.
 * @param {string} content
 * @returns {boolean}
 */
function isUnedited(content) {
  const match = HASH_LINE.exec(content);
  if (!match) return false;
  return hashOf(content.replace(HASH_LINE, '')) === match[1];
}

/**
 * What is at one path of the computer-level text.
 * - `absent`: nothing there.
 * - `current`: an Astryx file with exactly this release's rendering.
 * - `differs`: an unedited Astryx file (its recorded hash matches) with
 *   another rendering, such as another release's.
 * - `edited`: an Astryx file (it has the markers) whose text no longer
 *   matches its recorded hash, or that records none: a person changed it.
 *   Never changed.
 * - `foreign`: a file without the Astryx markers, a symlink, or something
 *   other than a regular file. Never changed.
 * @typedef {'absent' | 'current' | 'differs' | 'edited' | 'foreign'} ComputerAgentTextState
 */

/**
 * @param {string} content
 * @returns {boolean}
 */
function hasMarkers(content) {
  const start = content.indexOf(MARKER_START);
  return start !== -1 && content.indexOf(MARKER_END, start) !== -1;
}

/**
 * The state of one path, read without following a symlinked file.
 * @param {string} file
 * @param {string} expected
 * @returns {ComputerAgentTextState}
 */
function stateOf(file, expected) {
  /** @type {fs.Stats} */
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return 'absent';
  }
  if (!stat.isFile()) return 'foreign';
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return 'foreign';
  }
  if (!hasMarkers(content)) return 'foreign';
  if (content === expected) return 'current';
  return isUnedited(content) ? 'differs' : 'edited';
}

/**
 * Read-only: the state of each file of the computer-level text against this
 * release's rendering: every file, or only the named agents' files.
 * @param {{home?: string, command?: string, agents?: readonly string[] | null}} [options]
 * @returns {Array<{path: string, state: ComputerAgentTextState}>}
 */
export function inspectComputerAgentText({
  home = os.homedir(),
  command,
  agents = null,
} = {}) {
  const expected = renderComputerAgentText({command});
  return computerAgentTextPaths(home, agents).map(file => ({
    path: file,
    state: stateOf(file, expected),
  }));
}

/**
 * Write `content` to `file` without following a symlink planted at it.
 * @param {string} file
 * @param {string} content
 */
function writeNoFollow(file, content) {
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_TRUNC |
    (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(file, flags, 0o644);
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Why a file was kept: a person edited it, or Astryx did not write it.
 * @param {ComputerAgentTextState} state
 * @returns {'edited' | 'not-astryx'}
 */
const keptReason = state => (state === 'edited' ? 'edited' : 'not-astryx');

/**
 * Remove one unedited Astryx file and its emptied skill folder.
 * @param {string} file
 */
function removeFile(file) {
  fs.unlinkSync(file);
  try {
    fs.rmdirSync(path.dirname(file));
  } catch {
    // The folder holds something else; leave it.
  }
}

/**
 * Write or refresh the files the chosen agents read, and remove the
 * unedited Astryx files no chosen agent reads. A file without the Astryx
 * markers, an edited one, or a symlinked one is kept as it is. Creates the
 * skill folders it needs.
 * @param {{home?: string, command?: string, agents?: readonly string[] | null}} [options]
 * @returns {import('../../api/init/init.type.mjs').InitUserFile[]}
 */
export function writeComputerAgentText({
  home = os.homedir(),
  command,
  agents = null,
} = {}) {
  const expected = renderComputerAgentText({command});
  const wanted = new Set(computerAgentTextPaths(home, agents));
  /** @type {import('../../api/init/init.type.mjs').InitUserFile[]} */
  const rows = [];
  for (const file of allComputerAgentTextPaths(home)) {
    const state = stateOf(file, expected);
    if (!wanted.has(file)) {
      if (state === 'current' || state === 'differs') {
        removeFile(file);
        rows.push({path: file, action: 'removed'});
      }
      continue;
    }
    if (state === 'foreign' || state === 'edited') {
      rows.push({path: file, action: 'kept', reason: keptReason(state)});
    } else if (state === 'current') {
      rows.push({path: file, action: 'unchanged'});
    } else {
      fs.mkdirSync(path.dirname(file), {recursive: true});
      writeNoFollow(file, expected);
      rows.push({path: file, action: 'written'});
    }
  }
  return rows;
}

/**
 * Remove every file. A file without the Astryx markers, an edited one, or a
 * symlinked one is kept. An emptied skill folder is removed with its file.
 * @param {{home?: string}} [options]
 * @returns {import('../../api/init/init.type.mjs').InitUserFile[]}
 */
export function removeComputerAgentText({home = os.homedir()} = {}) {
  /** @type {import('../../api/init/init.type.mjs').InitUserFile[]} */
  const rows = [];
  allComputerAgentTextPaths(home).forEach((file, index) => {
    const state = stateOf(file, '');
    // The single-tool files are reported only when there is one to act on.
    if (state === 'absent') {
      if (index < 2) rows.push({path: file, action: 'absent'});
      return;
    }
    if (state === 'foreign' || state === 'edited') {
      rows.push({path: file, action: 'kept', reason: keptReason(state)});
      return;
    }
    removeFile(file);
    rows.push({path: file, action: 'removed'});
  });
  return rows;
}

/**
 * Whether the `astryx` a shell would run from this computer's search path is
 * the Astryx CLI: the first `astryx` found is the one that runs.
 * @param {{searchPath?: string, platform?: NodeJS.Platform}} [options]
 * @returns {boolean}
 */
export function astryxOnSearchPath(options = {}) {
  return astryxCommandsOnSearchPath(options)[0]?.astryx ?? false;
}
