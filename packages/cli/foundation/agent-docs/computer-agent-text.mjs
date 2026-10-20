// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The computer-level agent text (spec AST-081 FR8): one skill file,
 * `~/.agents/skills/astryx/SKILL.md`, which most coding agents read, linked
 * into the skill folder of each agent that reads only its own
 * (`SKILL_LINKS`), so every agent on the computer knows Astryx is there.
 *
 * - One file is written. Each other folder gets a link to its folder: a
 *   directory symlink, or a junction on Windows, which needs no
 *   administrator rights. A refresh rewrites only the file; the links follow.
 * - `SKILL_LINKS` is the one table of link targets: a folder relative to the
 *   home folder, and the folder that must already exist for it to be linked
 *   (`null`: always). The writer, the remover, doctor, and the docs all read it.
 * - The text is version-free and names only stable entry points
 *   (`STABLE_COMMANDS`), so an older file never misleads. Two renderings exist
 *   while their wording is compared (`COMPUTER_AGENT_TEXT_VARIANTS`); `long` is
 *   the one written.
 * - The file keeps the Astryx markers, which tell a file Astryx wrote from one
 *   a person wrote, and records inside them a hash of its text, which tells an
 *   edited file from an older rendering. A file without the markers, an
 *   edited file, and a symlinked file are never changed. A link target that
 *   holds anything Astryx did not create is never replaced; doctor names it.
 * - The links Astryx made are recorded in the settings file, so removal
 *   removes exactly those.
 *
 * `astryx init --user` writes and removes them, and the global copy's
 * background step (`foundation/release/agent-text-worker.mjs`) keeps the file
 * on its release (FR7, FR8). Both honor the settings file
 * (`foundation/env/user-settings.mjs`). This module names fixed paths in the
 * home folder and nothing else.
 *
 * @input  the home folder, the host's door (if any), the settings file
 * @output the rendered text, its state on disk, and the write/remove receipt rows
 * @position foundation/agent-docs — read by `init --user`, by the background
 *   step, and by `doctor`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {cliDoor} from '../env/cli-command.mjs';
import {astryxCommandsOnSearchPath} from '../env/search-path.mjs';
import {samePath} from '../fs/path-compare.mjs';
import {MARKER_START, MARKER_END} from './agent-doc-state.mjs';

/** The command the computer-level text uses when no host door is set. */
export const COMPUTER_COMMAND = 'astryx';

/** The install step for the CLI copy the computer-level text relies on. */
export const COMPUTER_INSTALL_STEP = 'npm i -g @astryxdesign/cli';

/** The skill folder, relative to the home folder, that holds the one file. */
const SKILL_FOLDER = path.join('.agents', 'skills', 'astryx');

/**
 * Where the skill folder reaches agents that read only their own skills
 * folder, each relative to the home folder: the agent's skills folder, the
 * folder that must already exist for it to be used (`null`: always), and how:
 * `link`, a folder link to the skill folder with a relative target, or `copy`,
 * a managed copy of the file for an agent whose scanner skips links. Public
 * agents only. Never a store another tool manages, such as `~/.codex/skills`.
 * @type {ReadonlyArray<{skills: string, when: string | null, mode: 'link' | 'copy'}>}
 */
export const SKILL_LINKS = Object.freeze([
  {skills: path.join('.claude', 'skills'), when: null, mode: 'link'},
  {skills: path.join('.kiro', 'skills'), when: '.kiro', mode: 'link'},
  {
    skills: path.join('.codeium', 'windsurf', 'skills'),
    when: path.join('.codeium', 'windsurf'),
    mode: 'link',
  },
  {skills: path.join('.letta', 'skills'), when: '.letta', mode: 'link'},
  {
    skills: path.join(
      'Library',
      'Developer',
      'Xcode',
      'CodingAssistant',
      'ClaudeAgentConfig',
      'skills',
    ),
    when: path.join('Library', 'Developer', 'Xcode', 'CodingAssistant'),
    mode: 'link',
  },
  // Kimi reads only the first of `~/.config/agents/skills` and
  // `~/.agents/skills` that exists.
  {
    skills: path.join('.config', 'agents', 'skills'),
    when: path.join('.config', 'agents', 'skills'),
    mode: 'link',
  },
  {skills: path.join('.continue', 'skills'), when: '.continue', mode: 'copy'},
]);

/**
 * The commands the text may name: stable entry points every release keeps.
 * computer-agent-text.test.mjs fails on any other.
 */
export const STABLE_COMMANDS = Object.freeze([
  'search',
  'docs',
  'component',
  'template',
  'build',
  'theme',
  'init',
  'doctor',
  'help',
]);

/** The renderings, while their wording is compared; the first is written. */
export const COMPUTER_AGENT_TEXT_VARIANTS = Object.freeze(['long', 'short']);

/**
 * When an agent should load the skill; the frontmatter `description`. One
 * sentence.
 */
const SKILL_DESCRIPTION =
  'Astryx, a design system and UI library, is available on this computer through the astryx command; use it when building or changing UI, choosing components, layout, styling or theming, working with a design system, or in any project that depends on @astryxdesign packages or mentions Astryx.';

/**
 * A home-folder path as a person reads it: `~/.claude/skills/astryx`.
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
 * The skill file's absolute path.
 * @param {string} [home]
 * @returns {string}
 */
export function computerSkillFile(home = os.homedir()) {
  return path.join(home, SKILL_FOLDER, 'SKILL.md');
}

/**
 * The absolute path of each link the table names, and whether it is wanted
 * on this computer (its condition folder exists).
 * @param {string} [home]
 * @returns {Array<{path: string, wanted: boolean, mode: 'link' | 'copy'}>}
 */
export function computerSkillLinks(home = os.homedir()) {
  return SKILL_LINKS.map(({skills, when, mode}) => ({
    path: path.join(home, skills, 'astryx'),
    wanted: when == null || fs.existsSync(path.join(home, when)),
    mode,
  }));
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
 * The body lines of a rendering, with `run` as the command.
 * @param {string} run
 * @param {'long' | 'short'} variant
 * @returns {string[]}
 */
function bodyLines(run, variant) {
  const opening = [
    'Astryx, a design system and UI library, is available on this computer.',
    'Use it when you build or change UI, pick components, or style or theme an app.',
    `Its docs, components, templates, and themes are all reachable through \`${run}\`. Start with \`${run} search '<what you need>'\`.`,
  ];
  if (variant === 'short') {
    return [
      ...opening,
      `Then read \`${run} component <Name>\` or \`${run} docs <topic>\`, not the package's files.`,
      "In a project, the project's version of Astryx answers automatically.",
    ];
  }
  return [
    ...opening,
    '',
    `Read docs with \`${run} docs <topic>\`, not by opening the package's files.`,
    '',
    'LOOK IT UP BEFORE YOU WRITE',
    `1. \`${run} search '<words>'\`: components, templates, docs, and hooks.`,
    `2. \`${run} component <Name>\`: props, variants, and examples for one component.`,
    `3. \`${run} docs <topic>\`: guides such as getting-started, layout, and theme (\`${run} docs\` lists them).`,
    `Never guess props: check \`${run} component <Name>\` first.`,
    '',
    'STARTING POINTS',
    `- A page or a section: \`${run} build '<idea>'\` names a template to start from; \`${run} template <name> <path>\` copies it into the app.`,
    `- Look and feel: \`${run} theme list\`, then \`${run} theme add <slug>\` in the app.`,
    `- A new project: install \`@astryxdesign/core\` and \`@astryxdesign/cli\`, then run \`${run} init\`; \`${run} docs getting-started\` has the steps.`,
    '',
    'WHEN SOMETHING IS OFF',
    `- \`${run} doctor\` checks the project, or this computer outside a project.`,
    '',
    'VERSIONS',
    "- In a project, the project's version of Astryx answers automatically, and the project's own agent docs (AGENTS.md or CLAUDE.md) come first.",
    '',
    `\`${run} help\` lists every command; \`${run} docs global\` explains Astryx on this computer.`,
  ];
}

/**
 * The full skill file.
 * @param {{command?: string, variant?: 'long' | 'short'}} [options]
 * @returns {string}
 */
export function renderComputerAgentText({
  command = computerAgentCommand(),
  variant = 'long',
} = {}) {
  return withHash(
    [
      '---',
      'name: astryx',
      // Quoted: the description holds `: ` and `;`, which strict YAML parsers
      // can misread, and an agent tool that fails to parse drops the skill.
      `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
      '---',
      '',
      MARKER_START,
      ...bodyLines(command, variant),
      MARKER_END,
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
 * - `linked`, `dangling` (a link only): a link to the skill folder, or one
 *   whose folder is missing (see linkStateOf).
 * @typedef {'absent' | 'current' | 'differs' | 'edited' | 'foreign' | 'linked' | 'dangling'} ComputerAgentTextState
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
 * The state of one link target.
 * - `linked`: a link to the skill folder.
 * - `dangling`: a link to the skill folder, which is not there, as in a
 *   container that mounts only the agent's own folder.
 * - `absent`: nothing there.
 * - `differs`: a real folder holding only an unedited Astryx skill file, as a
 *   copy left it; replaced by the link.
 * - `foreign`: anything else. Never changed.
 * @param {string} at
 * @param {string} folder the skill folder
 * @returns {ComputerAgentTextState}
 */
function linkStateOf(at, folder) {
  /** @type {fs.Stats} */
  let stat;
  try {
    stat = fs.lstatSync(at);
  } catch {
    return 'absent';
  }
  if (stat.isSymbolicLink()) {
    if (!pointsAt(at, folder)) return 'foreign';
    return fs.existsSync(path.join(folder, 'SKILL.md')) ? 'linked' : 'dangling';
  }
  if (!stat.isDirectory()) return 'foreign';
  return copyStateOf(at, '') === 'differs' ? 'differs' : 'foreign';
}

/**
 * The state of a managed copy: a real folder at `at` holding only the skill
 * file, read like the skill file itself.
 * @param {string} at
 * @param {string} expected
 * @returns {ComputerAgentTextState}
 */
function copyStateOf(at, expected) {
  /** @type {fs.Stats} */
  let stat;
  try {
    stat = fs.lstatSync(at);
  } catch {
    return 'absent';
  }
  if (!stat.isDirectory()) return 'foreign';
  let names;
  try {
    names = fs.readdirSync(at);
  } catch {
    return 'foreign';
  }
  if (names.length === 0) return 'absent';
  if (names.length !== 1 || names[0] !== 'SKILL.md') return 'foreign';
  const state = stateOf(path.join(at, 'SKILL.md'), expected);
  return state === 'current' && expected === '' ? 'differs' : state;
}

/**
 * Whether the link at `at` points at `folder`.
 * @param {string} at
 * @param {string} folder
 * @returns {boolean}
 */
function pointsAt(at, folder) {
  try {
    const target = path.resolve(path.dirname(at), fs.readlinkSync(at));
    return samePath(target.replace(/[\\/]+$/u, ''), folder);
  } catch {
    return false;
  }
}

/**
 * Read-only: the state of the skill file against this release's rendering,
 * then of each place the table wants on this computer, or that Astryx linked.
 * @param {{home?: string, command?: string, links?: readonly string[]}} [options]
 *   `links`: the links Astryx made, from the settings file
 * @returns {Array<{path: string, state: ComputerAgentTextState, link?: true}>}
 */
export function inspectComputerAgentText({
  home = os.homedir(),
  command,
  links = [],
} = {}) {
  const expected = renderComputerAgentText({command});
  const folder = path.join(home, SKILL_FOLDER);
  const made = new Set(links);
  return [
    {
      path: computerSkillFile(home),
      state: stateOf(computerSkillFile(home), expected),
    },
    ...computerSkillLinks(home)
      .filter(place => place.wanted || made.has(place.path))
      .map(place => {
        const linkState = linkStateOf(place.path, folder);
        const state =
          place.mode === 'copy' && linkState !== 'linked'
            ? copyStateOf(place.path, expected)
            : linkState;
        return {path: place.path, state, link: /** @type {const} */ (true)};
      }),
  ];
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
 * Why a path was kept: a person edited it, or Astryx did not create it.
 * @param {ComputerAgentTextState} state
 * @returns {'edited' | 'not-astryx'}
 */
const keptReason = state => (state === 'edited' ? 'edited' : 'not-astryx');

/**
 * Remove an unedited Astryx file, or a folder holding only one, and its
 * emptied folder.
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
 * Link `at` to `folder`: a folder symlink with a relative target, which
 * survives a moved or synced home folder, or a junction (absolute) on Windows.
 * @param {string} at
 * @param {string} folder
 */
function makeLink(at, folder) {
  fs.mkdirSync(path.dirname(at), {recursive: true});
  if (process.platform === 'win32') {
    fs.symlinkSync(folder, at, 'junction');
  } else {
    fs.symlinkSync(path.relative(path.dirname(at), folder), at, 'dir');
  }
}

/**
 * Write or refresh a managed copy of the skill file in the folder `at`.
 * @param {string} at
 * @param {string} expected
 * @returns {import('../../api/init/init.type.mjs').InitUserFile}
 */
function writeCopy(at, expected) {
  const state = copyStateOf(at, expected);
  if (state === 'current') return {path: at, action: 'unchanged'};
  if (state === 'foreign' || state === 'edited') {
    return {path: at, action: 'kept', reason: keptReason(state)};
  }
  try {
    fs.mkdirSync(at, {recursive: true});
    writeNoFollow(path.join(at, 'SKILL.md'), expected);
    return {path: at, action: 'written'};
  } catch {
    return {path: at, action: 'kept', reason: 'not-astryx'};
  }
}

/**
 * Write or refresh the skill file, and link it into every folder the table
 * wants on this computer. A file without the Astryx markers, an edited one, a
 * symlinked one, and a link target holding anything Astryx did not create are
 * kept as they are. Returns the receipt rows and the links that now point at
 * the skill folder, for the settings file.
 * @param {{home?: string, command?: string}} [options]
 * @returns {{rows: import('../../api/init/init.type.mjs').InitUserFile[], links: string[]}}
 */
export function writeComputerAgentText({home = os.homedir(), command} = {}) {
  const expected = renderComputerAgentText({command});
  const file = computerSkillFile(home);
  const folder = path.dirname(file);
  /** @type {import('../../api/init/init.type.mjs').InitUserFile[]} */
  const rows = [];
  const state = stateOf(file, expected);
  if (state === 'foreign' || state === 'edited') {
    rows.push({path: file, action: 'kept', reason: keptReason(state)});
  } else if (state === 'current') {
    rows.push({path: file, action: 'unchanged'});
  } else {
    fs.mkdirSync(folder, {recursive: true});
    writeNoFollow(file, expected);
    rows.push({path: file, action: 'written'});
  }
  /** @type {string[]} */
  const links = [];
  for (const place of computerSkillLinks(home)) {
    if (!place.wanted) continue;
    const at = place.path;
    const linkState = linkStateOf(at, folder);
    if (linkState === 'linked') {
      links.push(at);
      rows.push({path: at, action: 'unchanged'});
      continue;
    }
    if (place.mode === 'copy') {
      rows.push(writeCopy(at, expected));
      continue;
    }
    if (linkState === 'foreign' || linkState === 'dangling') {
      rows.push({path: at, action: 'kept', reason: 'not-astryx'});
      continue;
    }
    if (linkState === 'differs') removeFile(path.join(at, 'SKILL.md'));
    try {
      makeLink(at, folder);
      links.push(at);
      rows.push({path: at, action: 'linked'});
    } catch {
      // A folder link that cannot be made (Windows without a junction, a
      // file system without links) gets a managed copy instead.
      rows.push(writeCopy(at, expected));
    }
  }
  return {rows, links};
}

/**
 * Remove the skill file and every link Astryx made that still points at its
 * folder. A file without the Astryx markers, an edited one, or a symlinked
 * one, and any link Astryx did not make, are kept.
 * @param {{home?: string, links?: readonly string[]}} [options]
 * @returns {import('../../api/init/init.type.mjs').InitUserFile[]}
 */
export function removeComputerAgentText({
  home = os.homedir(),
  links = [],
} = {}) {
  const file = computerSkillFile(home);
  const folder = path.dirname(file);
  /** @type {import('../../api/init/init.type.mjs').InitUserFile[]} */
  const rows = [];
  for (const at of links) {
    const linkState = linkStateOf(at, folder);
    if (linkState !== 'linked' && linkState !== 'dangling') continue;
    try {
      fs.unlinkSync(at);
      rows.push({path: at, action: 'removed'});
    } catch {
      rows.push({path: at, action: 'kept', reason: 'not-astryx'});
    }
  }
  // Managed copies are told apart by their markers and hash, like the file.
  for (const place of computerSkillLinks(home)) {
    if (copyStateOf(place.path, '') !== 'differs') continue;
    removeFile(path.join(place.path, 'SKILL.md'));
    rows.push({path: place.path, action: 'removed'});
  }
  const state = stateOf(file, '');
  if (state === 'absent') {
    rows.unshift({path: file, action: 'absent'});
  } else if (state === 'foreign' || state === 'edited') {
    rows.unshift({path: file, action: 'kept', reason: keptReason(state)});
  } else {
    removeFile(file);
    rows.unshift({path: file, action: 'removed'});
  }
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
