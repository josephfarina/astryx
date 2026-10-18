// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file doctor's release checks (spec AST-081 FR10, FR11): the newest
 * release beside a project's or the global copy's, with the fix, and the
 * `astryx` commands on the search path.
 */

import {describe, expect, it} from 'vitest';
import {checkCliOnPath, checkNewestRelease} from './doctor.mjs';

const answeredBy = {cli: '0.7.1', core: '0.7.1', copy: 'project'};

/** @param {Partial<import('../../foundation/env/search-path.mjs').SearchPathCommand>} row */
const row = row => ({
  file: '/bin/astryx',
  astryx: true,
  cliRoot: '/lib/cli',
  version: '0.8.0',
  handsOff: true,
  ...row,
});

describe('checkNewestRelease', () => {
  it("names a project's install and upgrade commands", () => {
    const check = checkNewestRelease({
      nodeVersion: '24.0.0',
      answeredBy,
      latest: '0.7.3',
      projectLag: {
        root: '/app',
        current: '0.7.1',
        newest: '0.7.3',
        install: 'npm install @astryxdesign/core@0.7.3',
        upgrade: 'npx @astryxdesign/cli@0.7.3 upgrade --from 0.7.1 --apply',
      },
    });
    expect(check).toEqual({
      id: 'newest-release',
      label: 'Newest release',
      status: 'info',
      message: 'This project uses Astryx 0.7.1; 0.7.3 is the newest.',
      fix: 'Run `npm install @astryxdesign/core@0.7.3`, then `npx @astryxdesign/cli@0.7.3 upgrade --from 0.7.1 --apply`.',
    });
  });

  it('warns when the global copy cannot move, with the cause and fix', () => {
    const check = checkNewestRelease({
      nodeVersion: '22.13.0',
      answeredBy: {...answeredBy, copy: 'carried'},
      latest: '0.8.0',
      globalLag: {
        cause: 'node',
        newest: '0.8.0',
        message: 'it needs Node >=24, and this computer runs Node 22.13.0',
        fix: 'Install a Node version that 0.8.0 supports, then run `astryx --version`.',
      },
    });
    expect(check).toMatchObject({
      status: 'warn',
      message:
        'The CLI installed for the computer cannot move to 0.8.0: it needs Node >=24, and this computer runs Node 22.13.0.',
      fix: 'Install a Node version that 0.8.0 supports, then run `astryx --version`.',
    });
  });
});

describe('checkCliOnPath', () => {
  const base = {nodeVersion: '24.0.0', answeredBy, latest: null};

  it('passes for a release that hands off, and lists the later ones', () => {
    const check = checkCliOnPath({
      ...base,
      searchPathCommands: [
        row({}),
        row({file: '/other/astryx', version: '0.7.1', handsOff: false}),
      ],
    });
    expect(check).toMatchObject({
      status: 'pass',
      message:
        '`astryx` runs /bin/astryx (CLI 0.8.0). Later on the search path: /other/astryx (CLI 0.7.1).',
    });
  });

  it('warns about a first release that predates the hand-off, naming the replacement', () => {
    expect(
      checkCliOnPath({
        ...base,
        searchPathCommands: [row({version: '0.7.1', handsOff: false})],
      }),
    ).toMatchObject({
      status: 'warn',
      fix: 'Replace it: `npm i -g @astryxdesign/cli@latest`.',
    });
  });

  it('warns about another program first, and informs when there is none', () => {
    expect(
      checkCliOnPath({
        ...base,
        searchPathCommands: [
          row({astryx: false, cliRoot: null, version: null, handsOff: null}),
        ],
      }),
    ).toMatchObject({status: 'warn'});
    expect(checkCliOnPath({...base, searchPathCommands: []})).toMatchObject({
      status: 'info',
      fix: 'To run the CLI in any folder, install it for the computer: `npm i -g @astryxdesign/cli`.',
    });
  });
});
