// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs global/monorepos`: how a folder's project is found, in
 * workspaces and nested folders (spec AST-081 FR2).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'monorepos',
  placement: {
    parent: 'namespace:global',
    slot: 'guides',
    order: 7,
  },
  title: 'Monorepos and nested folders',
  category: 'guide',
  keywords: [
    'monorepo',
    'workspace',
    'nested folder',
    'nested project',
    'subfolder',
    'packages folder',
    'which project',
    'yarn pnp',
    'hoisting',
  ],
  description:
    'How Astryx finds the project a folder belongs to, and which version answers in a monorepo, a nested app, or a cloned repository inside another project.',
  sections: [
    {
      id: 'find',
      title: 'How a project is found',
      content: [
        {
          type: 'prose',
          text: 'Astryx looks from the folder you run in: `@astryxdesign/core` or `@astryxdesign/cli` installed there or a few folders above it, else the nearest `package.json` that declares either one, up to the repository root. A folder where none of these exist is outside a project.',
        },
      ],
    },
    {
      id: 'workspaces',
      title: 'Workspaces',
      content: [
        {
          type: 'list',
          style: 'unordered',
          items: [
            'A workspace member that declares Astryx is its own project, even when its packages are hoisted to the repository root. A CLI installed at the root answers it, as it always has; a member with only its own Core and no CLI anywhere gets the CLI version equal to its Core.',
            'A folder without its own `package.json`, such as `src/` or `scripts/`, belongs to the project above it.',
            'A repository that builds the CLI itself, with the CLI in `packages/cli` next to Core in `packages/core`, runs that CLI.',
          ],
        },
      ],
    },
    {
      id: 'nested',
      title: 'Nested folders',
      content: [
        {
          type: 'list',
          style: 'unordered',
          items: [
            "A folder inside another project, such as a nested app or a repository cloned into it, answers with the enclosing project's version.",
            'Folder names are compared the way your file system compares them, so a folder reached through a link, or typed in another letter case on macOS or Windows, answers as the folder does.',
            "In a Yarn Plug'n'Play project, Astryx cannot see the project's own CLI, so the CLI version equal to the project's Core answers from the cache. Run the project's CLI through Yarn (`yarn astryx`) to use it directly.",
          ],
        },
      ],
    },
    {
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: 'This page is part of {@link namespace:global}, which explains what global mode is and how each part works.',
        },
      ],
    },
  ],
};
