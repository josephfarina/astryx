// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/commands`: every command the CLI ships.
 *
 * Adopts each command doc whose `namespace` is `cli/commands`, so a new
 * command appears here with no edit to this file.
 */

/** @type {import('@astryxdesign/cli/authoring').NamespaceDoc} */
export const docs = {
  type: 'namespace',
  name: 'commands',
  title: 'Commands',
  summary:
    'Every command and subcommand: usage, options, examples, exit codes, and what it does outside a project.',
  keywords: ['commands', 'usage', 'options', 'flags'],
  placement: {parent: 'namespace:cli', slot: 'reference', order: 10},
  slots: {
    commands: {title: 'Commands', accepts: {kinds: ['command']}},
  },
  adopts: [
    {source: {group: 'cli/commands', kinds: ['command']}, into: 'commands'},
  ],
  blocks: [
    {
      type: 'prose',
      text: "In global mode: every command declares what it does outside a project (`outsideProject`). Most answer as in a new project; some write nothing and name the project they need; a few, such as `doctor`, `init`, and `upgrade`, do something else. A command that does not answer as in a new project says exactly what it does in its `In global mode:` note, and the CLI's tests run every command in an empty folder to check it. In a project, the project's version of Astryx runs every command, whichever astryx command you type. See {@link namespace:global}.",
    },
  ],
};
