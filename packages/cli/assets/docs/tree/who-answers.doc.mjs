// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs global/who-answers`: which version answers in each folder, the
 * hand-off, and how to see who answered (spec AST-081 FR2, FR3, FR5, FR9).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'who-answers',
  placement: {
    parent: 'namespace:global',
    slot: 'guides',
    order: 3,
  },
  title: 'Which version runs, and why',
  category: 'guide',
  keywords: [
    'which release',
    'wrong version',
    'different version',
    'answered by',
    'answeredBy',
    'hand-off',
    'handed over',
    'project version',
  ],
  description:
    'Inside a project, Astryx runs the version that matches the project, whichever astryx command you start. Outside a project, your global install answers. How to see which one did.',
  sections: [
    {
      id: 'in-a-project',
      title: "In a project, the project's version",
      content: [
        {
          type: 'prose',
          text: "Components come from `@astryxdesign/core`, and templates, docs, and agent guides come from the CLI. When the two versions differ, an agent can get code the project's Core rejects. So in a project, Astryx always runs the CLI version that matches the project's Core:",
        },
        {
          type: 'list',
          style: 'unordered',
          items: [
            "The project installs the CLI at that version, as recommended: that CLI runs. When you type the global astryx command instead, it passes the run to the project's CLI, with the same arguments, input, output, and exit status, so either command gives the same answer.",
            'The project installs another CLI version, or only Core: Astryx runs the matching version from its cache, installing it there the first time. Installing the matching CLI in the project avoids that download.',
            'Nothing is installed yet, as in a fresh clone: the version comes from the Core version in the lockfile, else the newest one the declared range allows.',
            '`astryx upgrade` follows the same rule, so it runs the codemods of the version that matches the Core you installed.',
          ],
        },
      ],
    },
    {
      id: 'outside',
      title: 'Outside a project, your global install',
      content: [
        {
          type: 'prose',
          text: 'In a folder that belongs to no project, your global install answers as a brand-new project on its version would, so you and your agents can read every component and doc. It never installs a newer version by itself.',
        },
        {
          type: 'prose',
          text: 'A few commands work on your computer rather than a folder, such as `astryx init --user`: your global install answers them in any folder.',
        },
      ],
    },
    {
      id: 'see-it',
      title: 'See which version answered',
      content: [
        {
          type: 'prose',
          text: "In text mode, one line on standard error names the version, unless the project's own CLI answered directly:",
        },
        {
          type: 'code',
          lang: 'text',
          code: "astryx: answered by this project's CLI 0.6.8, handed over from CLI 0.7.2\nastryx: answered by CLI 0.6.8 with Core 0.6.8, the release that matches this project's Core\nastryx: answered by CLI 0.7.2 with Core 0.7.2, outside a project\nastryx: answered by CLI 0.7.2 with Core 0.7.2, for this computer",
        },
        {
          type: 'prose',
          text: 'With `--json` nothing extra prints; every result carries `meta.answeredBy` instead ({@link generic:reference}):',
        },
        {
          type: 'code',
          lang: 'json',
          code: '{"meta": {"answeredBy": {"cli": "0.6.8", "core": "0.6.8", "copy": "matched"}}}',
        },
      ],
    },
    {
      id: 'printed-commands',
      title: 'Commands Astryx prints',
      content: [
        {
          type: 'prose',
          text: "Commands the CLI prints for you to run start with a name that reaches the same version: the project's runner (`npx astryx`) in a project, `astryx` outside a project when your global install answered, and otherwise the CLI pinned to the version, such as `npx @astryxdesign/cli@0.6.8`. An integration can name its own command: {@link generic:cli-command}.",
        },
      ],
    },
    {
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: 'This page is part of {@link namespace:global}, which explains what global mode is and how each part works. To check your computer, run `astryx doctor` outside any project ({@link command:doctor}). Monorepos: {@link generic:monorepos}.',
        },
      ],
    },
  ],
};
