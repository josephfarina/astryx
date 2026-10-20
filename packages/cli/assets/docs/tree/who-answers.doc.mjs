// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/global/who-answers`: which release answers in each
 * folder, how a run is handed to it, and how to see which one did (spec
 * AST-081 FR2, FR3, FR5, FR9, FR11).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'who-answers',
  placement: {parent: 'namespace:global', slot: 'guides', order: 2},
  title: 'Which release answers, and why',
  category: 'guide',
  keywords: [
    'which version',
    'which release',
    'hand-off',
    'handed over',
    'answeredBy',
    'matched release',
    'project CLI',
    'outside a project',
    'nested project',
    'wrong version',
    'different release',
  ],
  description:
    "Inside a project, the release equal to the project's Core answers every command, whichever copy you start; outside a project, the copy you started answers. How a run is handed over, and how to see who answered.",
  sections: [
    {
      id: 'in-a-project',
      title: "In a project, the project's Core decides",
      content: [
        {
          type: 'prose',
          text: "Templates, docs, and agent text come from a CLI release, and components from a Core release. When the two differ, an agent gets code the project's Core may reject, with no error to say so. So in a project, the release equal to the project's Core answers every command:",
        },
        {
          type: 'list',
          style: 'unordered',
          items: [
            'The project installs the CLI at the same version as its Core: that CLI answers. Any other copy hands the run to it.',
            "The project's CLI is another version, or the project installs only Core: the CLI release equal to the Core answers. The CLI installs it once into your per-user cache and reuses it.",
            'Nothing is installed yet, as in a fresh clone: the release comes from the Core version the lockfile records, else the newest release the declared Core range allows.',
            '`astryx upgrade` follows the same rule, so it runs the codemods of the release equal to the Core you installed.',
          ],
        },
        {
          type: 'prose',
          text: "A copy hands a run over before it reads anything of the project, with the same arguments, folder, input, and output, and ends with that release's exit status. A version you type, such as `npx @astryxdesign/cli@0.7.0`, does not change the release that answers inside a project.",
        },
        {
          type: 'prose',
          text: "A project is found from the folder you run in: the Core or the CLI installed there or a few folders above it, else the nearest `package.json` that declares either one, up to the repository root. A folder inside another project, such as a nested app or a cloned repository, answers with that project's release. A repository that builds the CLI itself, with the CLI package in `packages/cli` beside Core in `packages/core`, answers with that CLI. Folder names are compared the way your file system compares them, so a folder typed in another letter case on macOS or Windows, or reached through a link, answers as the folder does.",
        },
      ],
    },
    {
      id: 'outside-a-project',
      title: 'Outside a project, your installed release answers',
      content: [
        {
          type: 'prose',
          text: 'In a folder that belongs to no project, the CLI answers as a new project on its release would, so an agent with no project files can still read every component and doc. Commands that read Core use the Core of the answering release, installed into the per-user cache the first time one needs it. `doctor`, `swizzle`, and `upgrade` judge or change a project and never use it.',
        },
        {
          type: 'prose',
          text: 'The CLI you installed for your computer answers with its own release. It never installs a newer one by itself: it tells you when one exists, the way `gh` and the Vercel CLI do, and you upgrade it with your package manager.',
        },
      ],
    },
    {
      id: 'who-answered',
      title: 'See which release answered',
      content: [
        {
          type: 'prose',
          text: "In text mode, a run prints one line on standard error when a copy hands it to the project's own CLI, when the release matching the project's Core answers, or outside a project. A run you start in the project's own CLI, which answers it directly, prints none, except `astryx init --user`, which always answers for your computer and says so:",
        },
        {
          type: 'code',
          lang: 'text',
          code: "astryx: answered by this project's CLI 0.6.8, handed over from CLI 0.7.2\nastryx: answered by CLI 0.6.8 with Core 0.6.8, the release that matches this project's Core\nastryx: answered by CLI 0.7.2 with Core 0.7.2, outside a project\nastryx: answered by CLI 0.7.2 with Core 0.7.2, for this computer",
        },
        {
          type: 'prose',
          text: 'With `--json` nothing extra is printed. Every successful result carries `meta.answeredBy`: `cli` (the version that answered), `core` (the Core it paired with, or `null`), and `copy` (`project`, `matched`, or `carried`).',
        },
        {
          type: 'code',
          lang: 'json',
          code: '{"meta": {"answeredBy": {"cli": "0.6.8", "core": "0.6.8", "copy": "matched"}}}',
        },
        {
          type: 'prose',
          text: "Commands the CLI prints for you to run start with a name that reaches the same release: the project's runner (`npx astryx`) when its own CLI answered, `astryx` outside a project when the CLI installed for your computer answered, and otherwise the CLI package pinned to the release, such as `npx @astryxdesign/cli@0.6.8`.",
        },
      ],
    },
    {
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: 'This page is part of {@link namespace:global}, which explains why to install the CLI for your computer and how each part works. To check your computer, run `astryx doctor` in a folder outside any project: it reports the release that answered, the newest release it knows of, and every `astryx` on your search path ({@link command:doctor}).',
        },
      ],
    },
  ],
};
