// Copyright (c) Meta Platforms, Inc. and affiliates.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {
  computerAgentTextSettings,
  readSettings,
  recordComputerAgentTextSettings,
  settingsFile,
} from './user-settings.mjs';

/** @type {string[]} */
const dirs = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astryx-settings-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

describe('the settings file (spec AST-081 FR8)', () => {
  it('means install for every agent when missing or unreadable', () => {
    const dir = tmp();
    expect(computerAgentTextSettings(dir)).toEqual({
      install: true,
      agents: null,
    });
    fs.writeFileSync(settingsFile(dir), 'not json');
    expect(readSettings(dir)).toEqual({});
    expect(computerAgentTextSettings(dir)).toEqual({
      install: true,
      agents: null,
    });
  });

  it('records and reads the choice, keeping other settings', () => {
    const dir = tmp();
    fs.writeFileSync(settingsFile(dir), '{"other":true}');
    expect(
      recordComputerAgentTextSettings({install: true, agents: ['claude']}, dir),
    ).toBe(true);
    expect(JSON.parse(fs.readFileSync(settingsFile(dir), 'utf8'))).toEqual({
      other: true,
      computerAgentText: {install: true, agents: ['claude']},
    });
    expect(computerAgentTextSettings(dir)).toEqual({
      install: true,
      agents: ['claude'],
    });
    recordComputerAgentTextSettings({install: false, agents: null}, dir);
    expect(computerAgentTextSettings(dir)).toEqual({
      install: false,
      agents: null,
    });
  });

  it('never fails when the folder cannot be written', () => {
    const file = path.join(tmp(), 'file');
    fs.writeFileSync(file, '');
    expect(
      recordComputerAgentTextSettings({install: false, agents: null}, file),
    ).toBe(false);
  });
});
