// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file The global copy's background step that keeps the computer-level
 * agent text installed (spec AST-081 FR8), as its own detached process.
 *
 * Started by `maybeKeepAgentText` (global-state.mjs) from the release the
 * global copy answers with outside a project, with one argument, the cache
 * directory. It writes the files the person's settings choose, with this
 * release's text and the plain `astryx` command, and keeps every file a
 * person edited, every file without the Astryx markers, and every link, as
 * `astryx init --user` does. It then records this release as the one that
 * wrote the text. It writes nothing to any stream and never reaches a
 * person: it is not a command and takes no options.
 *
 * @input  argv[2]: the cache directory; the settings file
 * @output the computer-level agent text and the updated global state on disk
 * @position foundation/release — one of the two detached processes the CLI
 *   starts; the other is refresh-worker.mjs.
 */

import {fileURLToPath} from 'node:url';
import {
  COMPUTER_COMMAND,
  writeComputerAgentText,
} from '../agent-docs/computer-agent-text.mjs';
import {computerAgentTextSettings} from '../env/user-settings.mjs';
import {recordAgentTextWritten} from './global-state.mjs';
import {readJson} from './project.mjs';

const cacheDir = process.argv[2];
if (cacheDir) {
  try {
    const settings = computerAgentTextSettings();
    if (settings.install) {
      writeComputerAgentText({
        command: COMPUTER_COMMAND,
        agents: settings.agents,
      });
      const pkg = readJson(
        fileURLToPath(new URL('../../package.json', import.meta.url)),
      );
      recordAgentTextWritten(pkg?.version ?? null, cacheDir);
    }
  } catch {
    // A home folder that cannot be written is tried again later.
  }
}
