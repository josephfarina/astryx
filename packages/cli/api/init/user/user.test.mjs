// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `init({user})` and `astryx init --user`: the `init.user` receipt, the
 * install warning, the refused combinations, and that it touches nothing in
 * the folder it runs in. Every test uses a temporary home folder and search
 * path.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {init} from '../init.mjs';
import {user} from './user.mjs';
import {runWithCliDoor} from '../../../foundation/env/cli-command.mjs';
import {renderComputerAgentText} from '../../../foundation/agent-docs/computer-agent-text.mjs';
import {runCli} from '../../../test-utils/run-cli.mjs';
import {settingsFile} from '../../../foundation/env/user-settings.mjs';
import {readGlobalState} from '../../../foundation/release/global-state.mjs';
import {cliVersion} from '../../../foundation/release/run-context.mjs';

/** @type {string[]} */
const dirs = [];
/** @param {string} label */
function tmp(label) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `astryx-init-user-${label}-`),
  );
  dirs.push(dir);
  return dir;
}

let home = '';
let emptyPath = '';
beforeEach(() => {
  home = tmp('home');
  emptyPath = tmp('path');
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('PATH', emptyPath);
  // The settings file and the cache live under this home folder too.
  vi.stubEnv('XDG_CONFIG_HOME', path.join(home, '.config'));
  vi.stubEnv('XDG_CACHE_HOME', path.join(home, '.cache'));
  vi.stubEnv('APPDATA', path.join(home, 'AppData', 'Roaming'));
  vi.stubEnv('LOCALAPPDATA', path.join(home, 'AppData', 'Local'));
});

/** The settings file under the temporary home folder. */
const settings = () => {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return null;
  }
};
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

/** Put a linked Astryx CLI first on the search path. */
function installCliOnPath() {
  const prefix = tmp('prefix');
  const pkg = path.join(prefix, 'lib', 'node_modules', '@astryxdesign', 'cli');
  fs.mkdirSync(pkg, {recursive: true});
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    '{"name":"@astryxdesign/cli"}',
  );
  fs.writeFileSync(path.join(pkg, 'bin.mjs'), '#!/usr/bin/env node\n');
  fs.chmodSync(path.join(pkg, 'bin.mjs'), 0o755);
  fs.mkdirSync(path.join(prefix, 'bin'));
  fs.symlinkSync(path.join(pkg, 'bin.mjs'), path.join(prefix, 'bin', 'astryx'));
  vi.stubEnv('PATH', path.join(prefix, 'bin'));
}

describe('init({user: true})', () => {
  it('writes both files and returns the init.user receipt, warning when no astryx runs the CLI', async () => {
    const r = await init({user: true}, {cwd: tmp('cwd')});
    expect(r.type).toBe('init.user');
    if (r.type !== 'init.user') return;
    expect(r.data.files).toEqual(
      SKILLS.map(rel => ({path: path.join(home, rel), action: 'written'})),
    );
    expect(r.data.command).toBe('astryx');
    expect(r.data.warnings).toHaveLength(1);
    expect(r.data.warnings[0]).toContain('npm i -g @astryxdesign/cli');
    for (const rel of SKILLS) {
      expect(fs.readFileSync(path.join(home, rel), 'utf8')).toBe(
        renderComputerAgentText({command: 'astryx'}),
      );
    }
  });

  it.skipIf(process.platform === 'win32')(
    'does not warn when the astryx on the search path is the Astryx CLI',
    async () => {
      installCliOnPath();
      const r = await user();
      expect(r.data.warnings).toEqual([]);
    },
  );

  it("names the host's door and does not ask for a global install", async () => {
    const r = await runWithCliDoor('acme astryx', () => user());
    expect(r.data.command).toBe('acme astryx');
    expect(r.data.warnings).toEqual([]);
    expect(fs.readFileSync(path.join(home, SKILLS[0]), 'utf8')).toContain(
      'run every command as `acme astryx <cmd>`',
    );
  });

  it('works inside a project and writes nothing in it', async () => {
    const dir = tmp('project');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      '{"name":"app","dependencies":{"@astryxdesign/core":"*"}}',
    );
    const before = fs.readdirSync(dir).sort();
    const r = await init({user: true}, {cwd: dir});
    expect(r.type).toBe('init.user');
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });

  it('records the choice: every agent, and the release that wrote the text', async () => {
    await init({user: true});
    expect(settings()).toEqual({computerAgentText: {install: true}});
    expect(readGlobalState().agentText).toEqual({writtenBy: cliVersion()});
  });

  it("with agent writes only those agents' files and records them", async () => {
    const r = await init({user: true, agent: 'claude, claude'});
    if (r.type !== 'init.user') throw new Error(r.type);
    expect(r.data.agents).toEqual(['claude']);
    expect(r.data.files).toEqual([
      {path: path.join(home, SKILLS[1]), action: 'written'},
    ]);
    expect(fs.existsSync(path.join(home, SKILLS[0]))).toBe(false);
    expect(settings()).toEqual({
      computerAgentText: {install: true, agents: ['claude']},
    });
    const all = await init({user: true});
    if (all.type !== 'init.user') throw new Error(all.type);
    expect(all.data.agents).toBeNull();
    expect(settings()).toEqual({computerAgentText: {install: true}});
  });

  it('refuses an unknown agent name with ERR_UNKNOWN_AGENT and writes nothing', async () => {
    await expect(
      init({user: true, agent: 'claude,aider'}),
    ).rejects.toMatchObject({
      code: 'ERR_UNKNOWN_AGENT',
      message: expect.stringContaining('`aider`'),
    });
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
    expect(settings()).toBeNull();
  });

  it('keeps every other setting when it records the choice', async () => {
    fs.mkdirSync(path.dirname(settingsFile()), {recursive: true});
    fs.writeFileSync(settingsFile(), '{"other": 1}');
    await init({user: true, removeAgents: true});
    expect(settings()).toEqual({other: 1, computerAgentText: {install: false}});
  });

  it('with removeAgents removes both files and records that the text is not wanted', async () => {
    await init({user: true, removeAgents: true});
    expect(settings()).toEqual({computerAgentText: {install: false}});
  });

  it('with removeAgents removes both files', async () => {
    await init({user: true});
    const r = await init({user: true, removeAgents: true});
    expect(r.type).toBe('init.user');
    if (r.type !== 'init.user') return;
    expect(r.data.files.map(f => f.action)).toEqual(['removed', 'removed']);
    expect(r.data.warnings).toEqual([]);
    for (const rel of SKILLS)
      expect(fs.existsSync(path.join(home, rel))).toBe(false);
  });

  it.each([
    [{features: 'agents'}, '--features'],
    [{all: true}, '--all'],
    [{agentDocsPath: 'X.md'}, '--agent-docs-path'],
    [{removeAgents: true, agent: 'claude'}, '--agent'],
  ])(
    'refuses %o with ERR_INVALID_ARGUMENT and writes nothing',
    async (extra, flag) => {
      await expect(init({user: true, ...extra})).rejects.toMatchObject({
        code: 'ERR_INVALID_ARGUMENT',
        message: expect.stringContaining(flag),
      });
      expect(fs.existsSync(path.join(home, '.agents'))).toBe(false);
      expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
    },
  );
});

describe('astryx init --user', () => {
  it('prints each file and the install warning in text mode', async () => {
    const r = await runCli(['init', '--user'], tmp('cwd'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`Wrote ~${path.sep}${SKILLS[0]}`);
    expect(r.stdout).toContain(`Wrote ~${path.sep}${SKILLS[1]}`);
    expect(r.stderr).toContain('npm i -g @astryxdesign/cli');
  });

  it('emits the init.user envelope under --json', async () => {
    const r = await runCli(['--json', 'init', '--user'], tmp('cwd'));
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.type).toBe('init.user');
    expect(
      env.data.files.map((/** @type {{action: string}} */ f) => f.action),
    ).toEqual(['written', 'written']);
    expect(env.data.command).toBe('astryx');
  });

  it('takes a comma-separated --agent list', async () => {
    const r = await runCli(
      ['--json', 'init', '--user', '--agent', 'codex,claude'],
      tmp('cwd'),
    );
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.data.agents).toEqual(['codex', 'claude']);
    expect(
      env.data.files.map((/** @type {{action: string}} */ f) => f.action),
    ).toEqual(['written', 'written']);
  });

  it('names a file a person edited as kept, and why', async () => {
    await runCli(['init', '--user'], tmp('cwd'));
    const file = path.join(home, SKILLS[1]);
    fs.appendFileSync(file, 'my note\n');
    const r = await runCli(['init', '--user'], tmp('cwd'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `Kept (edited since Astryx wrote it; delete it to get the current text): ~${path.sep}${SKILLS[1]}`,
    );
    expect(fs.readFileSync(file, 'utf8')).toMatch(/my note\n$/u);
  });

  it('exits 1 with ERR_INVALID_ARGUMENT when combined with --all', async () => {
    const r = await runCli(['--json', 'init', '--user', '--all'], tmp('cwd'));
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).code).toBe('ERR_INVALID_ARGUMENT');
  });
});
