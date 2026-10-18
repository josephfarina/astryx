// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The computer-level agent text (spec AST-081 FR7, FR8): its rendering
 * from the project block's source, the two files it writes and removes, the
 * files it keeps, the search-path check behind its warning, and the rule that
 * only `init --user` writes it. Every test uses a temporary home folder.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  COMPUTER_AGENT_FILES,
  COMPUTER_AGENTS,
  allComputerAgentTextPaths,
  astryxOnSearchPath,
  computerAgentTextPaths,
  unknownComputerAgents,
  inspectComputerAgentText,
  removeComputerAgentText,
  renderComputerAgentText,
  writeComputerAgentText,
} from './computer-agent-text.mjs';
import {generateCompressedIndex, parseBlockVersion} from './agent-docs.mjs';
import {MARKER_END, MARKER_START} from './agent-doc-state.mjs';
import {runWithCliDoor} from '../env/cli-command.mjs';
import {runCli} from '../../test-utils/run-cli.mjs';
import {parse as parseYaml} from 'yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The hash line Astryx records right after the start marker. */
const HASH_LINE = /^<!-- astryx-managed sha256:[0-9a-f]{64} -->\n/mu;

/**
 * An Astryx file as some other release would write it: the given text with
 * its hash line recorded.
 * @param {string} text
 * @returns {string}
 */
function unedited(text) {
  const hash = createHash('sha256').update(text).digest('hex');
  return text.replace(
    `${MARKER_START}\n`,
    `${MARKER_START}\n<!-- astryx-managed sha256:${hash} -->\n`,
  );
}
const CLI_ROOT = path.resolve(HERE, '../..');
const CORE_ROOT = path.resolve(CLI_ROOT, '../core');

/** @type {string[]} */
const dirs = [];
/** @param {string} label */
function tmp(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `astryx-user-${label}-`));
  dirs.push(dir);
  return dir;
}

let home = '';
beforeEach(() => {
  home = tmp('home');
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  while (dirs.length) {
    fs.rmSync(/** @type {string} */ (dirs.pop()), {
      recursive: true,
      force: true,
    });
  }
});

const SKILLS = [
  path.join('.agents', 'skills', 'astryx', 'SKILL.md'),
  path.join('.claude', 'skills', 'astryx', 'SKILL.md'),
];

describe('generateCompressedIndex scope', () => {
  const integrations = [{package: 'acme-kit', append: ['Use AcmeButton.']}];

  it('computer: no version, no count, no integrations, the CSS line, and the lead line', () => {
    const text = generateCompressedIndex('9.9.9', {
      scope: 'computer',
      invocation: 'astryx',
      stylingSystem: 'stylex',
      agentDocs: integrations,
    });
    expect(text.startsWith(MARKER_START)).toBe(true);
    expect(text.endsWith(MARKER_END)).toBe(true);
    expect(parseBlockVersion(text)).toBeNull();
    expect(text).not.toContain('9.9.9');
    expect(text).not.toMatch(/\d+\+? components/);
    expect(text).not.toContain('INTEGRATIONS');
    expect(text).not.toContain('acme-kit');
    expect(text).toContain('No StyleX/Tailwind compiler here');
    expect(text).not.toContain('xstyle prop / StyleX tokens');
    expect(text.split('\n')[2]).toMatch(
      /^Inside a project with its own Astryx agent docs .*follow those instead: they match that project's release\.$/,
    );
  });

  it('project and computer differ only in the wrapper', () => {
    const project = generateCompressedIndex('1.2.3', {invocation: 'astryx'});
    const computer = generateCompressedIndex(null, {
      scope: 'computer',
      invocation: 'astryx',
    });
    const from = (/** @type {string} */ text) =>
      text.slice(text.indexOf('CLI: run every command'));
    expect(from(computer)).toBe(from(project));
    expect(parseBlockVersion(project)).toBe('1.2.3');
  });
});

describe('renderComputerAgentText', () => {
  it('is a skill named astryx with a when-to-use description, then the computer body', () => {
    const text = renderComputerAgentText({command: 'astryx'});
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('name: astryx');
    expect(lines[2]).toMatch(/^description: .*Use when /);
    expect(lines[3]).toBe('---');
    // Strict YAML: an agent tool with a strict parser drops a skill whose
    // frontmatter does not parse.
    const front = parseYaml(lines.slice(1, 3).join('\n'), {
      strict: true,
      uniqueKeys: true,
    });
    expect(front).toEqual({
      name: 'astryx',
      description: expect.stringContaining('Use when'),
    });
    expect(front.description).toContain(': ');
    expect(text.replace(HASH_LINE, '')).toContain(
      generateCompressedIndex(null, {scope: 'computer', invocation: 'astryx'}),
    );
    // The hash it records is of the file's text without that line.
    const [, recorded] = /sha256:([0-9a-f]{64})/u.exec(text) ?? [];
    expect(recorded).toBe(
      createHash('sha256').update(text.replace(HASH_LINE, '')).digest('hex'),
    );
    expect(text).toContain('run every command as `astryx <cmd>`');
  });

  it("uses the host's door when one is set", () => {
    const text = runWithCliDoor('acme astryx', () => renderComputerAgentText());
    expect(text).toContain('run every command as `acme astryx <cmd>`');
  });
});

describe('write, refresh, keep, remove', () => {
  it('writes both files, creating their folders, then reports them unchanged', () => {
    const first = writeComputerAgentText({home, command: 'astryx'});
    expect(first).toEqual(
      SKILLS.map(rel => ({path: path.join(home, rel), action: 'written'})),
    );
    for (const rel of SKILLS) {
      expect(fs.readFileSync(path.join(home, rel), 'utf8')).toBe(
        renderComputerAgentText({command: 'astryx'}),
      );
    }
    expect(
      writeComputerAgentText({home, command: 'astryx'}).map(f => f.action),
    ).toEqual(['unchanged', 'unchanged']);
    expect(
      inspectComputerAgentText({home, command: 'astryx'}).map(f => f.state),
    ).toEqual(['current', 'current']);
  });

  it('refreshes an unedited Astryx file whose text differs', () => {
    writeComputerAgentText({home, command: 'astryx'});
    const file = path.join(home, SKILLS[1]);
    fs.writeFileSync(
      file,
      unedited(`---\nname: astryx\n---\n${MARKER_START}\nold\n${MARKER_END}\n`),
    );
    expect(
      inspectComputerAgentText({home, command: 'astryx'}).map(f => f.state),
    ).toEqual(['current', 'differs']);
    expect(
      writeComputerAgentText({home, command: 'astryx'}).map(f => f.action),
    ).toEqual(['unchanged', 'written']);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      renderComputerAgentText({command: 'astryx'}),
    );
  });

  it.each([
    [
      'a line a person added',
      (/** @type {string} */ t) => t.replace('RULES', 'RULES\nmy rule'),
    ],
    [
      'an older file that records no hash',
      (/** @type {string} */ t) =>
        t.replace(HASH_LINE, '').replace('RULES', 'OLD'),
    ],
  ])('keeps an Astryx file with %s, on write and on remove', (_, edit) => {
    writeComputerAgentText({home, command: 'astryx'});
    const file = path.join(home, SKILLS[1]);
    const mine = edit(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, mine);
    expect(
      inspectComputerAgentText({home, command: 'astryx'}).map(f => f.state),
    ).toEqual(['current', 'edited']);
    expect(writeComputerAgentText({home, command: 'astryx'})).toEqual([
      {path: path.join(home, SKILLS[0]), action: 'unchanged'},
      {path: file, action: 'kept', reason: 'edited'},
    ]);
    expect(removeComputerAgentText({home})).toEqual([
      {path: path.join(home, SKILLS[0]), action: 'removed'},
      {path: file, action: 'kept', reason: 'edited'},
    ]);
    expect(fs.readFileSync(file, 'utf8')).toBe(mine);
  });

  it('writes only the files the chosen agents read, and removes the unedited one no chosen agent reads', () => {
    writeComputerAgentText({home, command: 'astryx'});
    expect(
      writeComputerAgentText({home, command: 'astryx', agents: ['claude']}),
    ).toEqual([
      {path: path.join(home, SKILLS[0]), action: 'removed'},
      {path: path.join(home, SKILLS[1]), action: 'unchanged'},
    ]);
    expect(fs.existsSync(path.join(home, SKILLS[0]))).toBe(false);
    expect(
      writeComputerAgentText({
        home,
        command: 'astryx',
        agents: ['codex', 'gemini'],
      }),
    ).toEqual([
      {path: path.join(home, SKILLS[0]), action: 'written'},
      {path: path.join(home, SKILLS[1]), action: 'removed'},
    ]);
    expect(
      inspectComputerAgentText({home, command: 'astryx', agents: ['copilot']}),
    ).toEqual([{path: path.join(home, SKILLS[0]), state: 'current'}]);
  });

  it('maps every agent name to a file it names, and reports unknown names', () => {
    const all = allComputerAgentTextPaths(home);
    for (const name of COMPUTER_AGENTS) {
      expect(all).toContain(path.join(home, COMPUTER_AGENT_FILES[name]));
    }
    expect(unknownComputerAgents(['claude', 'aider', 'codex'])).toEqual([
      'aider',
    ]);
  });

  it('writes every file as a skill whose name matches its folder and whose frontmatter is strict YAML', () => {
    writeComputerAgentText({
      home,
      command: 'astryx',
      agents: [...COMPUTER_AGENTS],
    });
    for (const file of allComputerAgentTextPaths(home)) {
      expect(fs.lstatSync(file).isFile()).toBe(true);
      const text = fs.readFileSync(file, 'utf8');
      const [, front] = /^---\n([\s\S]*?)\n---\n/u.exec(text) ?? [];
      const parsed = parseYaml(front ?? '', {strict: true, uniqueKeys: true});
      expect(parsed.name).toBe(path.basename(path.dirname(file)));
      expect(parsed.name).toMatch(/^[a-z0-9-]{1,64}$/u);
      expect(typeof parsed.description).toBe('string');
    }
  });

  it("writes a single-tool file for every agent only when that tool's folder exists, and always when chosen", () => {
    const kiro = path.join(home, '.kiro', 'skills', 'astryx', 'SKILL.md');
    const cont = path.join(home, '.continue', 'skills', 'astryx', 'SKILL.md');
    writeComputerAgentText({home, command: 'astryx'});
    expect(fs.existsSync(kiro)).toBe(false);
    fs.mkdirSync(path.join(home, '.kiro'));
    expect(
      writeComputerAgentText({home, command: 'astryx'}).map(f => f.action),
    ).toEqual(['unchanged', 'unchanged', 'written']);
    expect(fs.readFileSync(kiro, 'utf8')).toBe(
      renderComputerAgentText({command: 'astryx'}),
    );
    expect(
      writeComputerAgentText({home, command: 'astryx', agents: ['continue']}),
    ).toEqual([
      {path: path.join(home, SKILLS[0]), action: 'removed'},
      {path: path.join(home, SKILLS[1]), action: 'removed'},
      {path: cont, action: 'written'},
      {path: kiro, action: 'removed'},
    ]);
    expect(removeComputerAgentText({home})).toEqual([
      {path: path.join(home, SKILLS[0]), action: 'absent'},
      {path: path.join(home, SKILLS[1]), action: 'absent'},
      {path: cont, action: 'removed'},
    ]);
  });

  it('keeps a file without the Astryx markers, on write and on remove', () => {
    const file = path.join(home, SKILLS[0]);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, '---\nname: astryx\n---\nmy own notes\n');
    expect(
      writeComputerAgentText({home, command: 'astryx'}).map(f => f.action),
    ).toEqual(['kept', 'written']);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '---\nname: astryx\n---\nmy own notes\n',
    );
    expect(removeComputerAgentText({home}).map(f => f.action)).toEqual([
      'kept',
      'removed',
    ]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')(
    'never follows a symlinked file, even one that points at an Astryx file',
    () => {
      const elsewhere = path.join(tmp('elsewhere'), 'SKILL.md');
      const ours = renderComputerAgentText({command: 'astryx'}).replace(
        'RULES',
        'OLD',
      );
      fs.writeFileSync(elsewhere, ours);
      const file = path.join(home, SKILLS[1]);
      fs.mkdirSync(path.dirname(file), {recursive: true});
      fs.symlinkSync(elsewhere, file);
      expect(
        writeComputerAgentText({home, command: 'astryx'}).map(f => f.action),
      ).toEqual(['written', 'kept']);
      expect(fs.readFileSync(elsewhere, 'utf8')).toBe(ours);
      expect(removeComputerAgentText({home}).map(f => f.action)).toEqual([
        'removed',
        'kept',
      ]);
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(elsewhere, 'utf8')).toBe(ours);
    },
  );

  it('removes both files and their emptied folders; then reports them absent', () => {
    writeComputerAgentText({home, command: 'astryx'});
    expect(removeComputerAgentText({home}).map(f => f.action)).toEqual([
      'removed',
      'removed',
    ]);
    for (const rel of SKILLS) {
      expect(fs.existsSync(path.dirname(path.join(home, rel)))).toBe(false);
    }
    expect(removeComputerAgentText({home}).map(f => f.action)).toEqual([
      'absent',
      'absent',
    ]);
  });

  it('keeps a skill folder that holds other files', () => {
    writeComputerAgentText({home, command: 'astryx'});
    const extra = path.join(home, '.claude', 'skills', 'astryx', 'notes.md');
    fs.writeFileSync(extra, 'mine');
    removeComputerAgentText({home});
    expect(fs.readFileSync(extra, 'utf8')).toBe('mine');
  });

  it('names exactly the two files in the home folder', () => {
    expect(computerAgentTextPaths(home)).toEqual(
      SKILLS.map(rel => path.join(home, rel)),
    );
  });
});

describe.skipIf(process.platform === 'win32')('astryxOnSearchPath', () => {
  /** @param {string} file @param {string} content */
  function executable(file, content) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content);
    fs.chmodSync(file, 0o755);
  }

  /** A global prefix with the CLI package linked into its bin folder. */
  function linkedCli() {
    const prefix = tmp('prefix');
    const pkg = path.join(
      prefix,
      'lib',
      'node_modules',
      '@astryxdesign',
      'cli',
    );
    fs.mkdirSync(pkg, {recursive: true});
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      '{"name":"@astryxdesign/cli","version":"0.0.0"}',
    );
    executable(path.join(pkg, 'bin.mjs'), '#!/usr/bin/env node\n');
    fs.mkdirSync(path.join(prefix, 'bin'));
    fs.symlinkSync(
      path.join(pkg, 'bin.mjs'),
      path.join(prefix, 'bin', 'astryx'),
    );
    return path.join(prefix, 'bin');
  }

  it('finds a linked CLI', () => {
    expect(
      astryxOnSearchPath({searchPath: linkedCli(), platform: 'linux'}),
    ).toBe(true);
  });

  it("finds a package manager's shim that starts the CLI", () => {
    const bin = tmp('shim');
    executable(
      path.join(bin, 'astryx'),
      '#!/bin/sh\nexec node "$basedir/global/5/node_modules/@astryxdesign/cli/clients/cli/bin/astryx.mjs" "$@"\n',
    );
    expect(astryxOnSearchPath({searchPath: bin, platform: 'linux'})).toBe(true);
  });

  it('is false with no astryx, or when the first astryx is another program', () => {
    expect(
      astryxOnSearchPath({searchPath: tmp('empty'), platform: 'linux'}),
    ).toBe(false);
    const other = tmp('other');
    executable(path.join(other, 'astryx'), '#!/bin/sh\necho other\n');
    expect(
      astryxOnSearchPath({
        searchPath: [other, linkedCli()].join(path.delimiter),
        platform: 'linux',
      }),
    ).toBe(false);
  });

  it('skips a file that cannot run', () => {
    const bin = tmp('noexec');
    fs.writeFileSync(path.join(bin, 'astryx'), 'not a program');
    expect(
      astryxOnSearchPath({
        searchPath: [bin, linkedCli()].join(path.delimiter),
        platform: 'linux',
      }),
    ).toBe(true);
  });
});

describe('only `init --user` writes the computer-level text (FR7)', () => {
  /** @returns {string[]} the skill files present in the temp home */
  const present = () =>
    SKILLS.filter(rel => fs.existsSync(path.join(home, rel)));

  /** A project that installs this release's Core. */
  function project() {
    const dir = tmp('project');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: 'app',
        private: true,
        dependencies: {'@astryxdesign/core': '*'},
      }),
    );
    fs.mkdirSync(path.join(dir, 'node_modules', '@astryxdesign'), {
      recursive: true,
    });
    fs.symlinkSync(
      CORE_ROOT,
      path.join(dir, 'node_modules', '@astryxdesign', 'core'),
      'dir',
    );
    return dir;
  }

  it('no source outside init --user and the background step imports the write or remove functions', () => {
    /** @type {string[]} */
    const importers = [];
    /** @param {string} dir */
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.'))
          continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (
          /\.m?[jt]s$/.test(entry.name) &&
          !/\.test\.m?[jt]s$/.test(entry.name)
        ) {
          const text = fs.readFileSync(file, 'utf8');
          if (
            /\b(writeComputerAgentText|removeComputerAgentText)\b/.test(text)
          ) {
            importers.push(path.relative(CLI_ROOT, file));
          }
        }
      }
    };
    for (const top of [
      'api',
      'clients',
      'foundation',
      'scripts',
      'authoring',
    ]) {
      walk(path.join(CLI_ROOT, top));
    }
    expect(importers.sort()).toEqual(
      [
        path.join('api', 'init', 'user', 'user.mjs'),
        path.join('foundation', 'agent-docs', 'computer-agent-text.mjs'),
        path.join('foundation', 'release', 'agent-text-worker.mjs'),
      ].sort(),
    );
  });

  it('install (postinstall), project init, and upgrade write none of it', async () => {
    const dir = project();
    const postinstall = spawnSync(
      process.execPath,
      [path.join(CLI_ROOT, 'scripts', 'postinstall.mjs')],
      {
        env: {...process.env, HOME: home, USERPROFILE: home, INIT_CWD: dir},
        encoding: 'utf8',
      },
    );
    expect(postinstall.status).toBe(0);
    expect((await runCli(['--json', 'init'], dir)).status).toBe(0);
    expect((await runCli(['--json', 'init', '--all'], dir)).status).toBe(0);
    await runCli(['--json', 'upgrade'], dir);
    await runCli(['--json', 'init'], tmp('outside'));
    expect(present()).toEqual([]);
    expect(fs.existsSync(path.join(home, '.agents'))).toBe(false);
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
  }, 60_000);
});
