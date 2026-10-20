// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/global/install-once`: install the CLI for the computer,
 * the copies that can start a run, the per-user release cache, and working
 * offline (spec AST-081).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'install-once',
  placement: {parent: 'namespace:global', slot: 'guides', order: 1},
  title: 'Install the CLI for your computer',
  category: 'guide',
  keywords: [
    'npm i -g',
    'pnpm add -g',
    'yarn global add',
    'bun add -g',
    'install globally',
    'global install',
    'cache',
    'offline',
    'ERR_VERSIONS_UNAVAILABLE',
    'per-user cache',
  ],
  description:
    'Install the CLI once for your computer with npm, pnpm, Yarn, or Bun; where the releases projects need are kept, and what happens offline.',
  sections: [
    {
      id: 'install',
      title: 'Install it once',
      content: [
        {
          type: 'prose',
          text: 'Install the CLI package for your computer with your package manager. That one `astryx` command then works in every folder, inside projects and outside them.',
        },
        {
          type: 'code',
          lang: 'bash',
          code: 'npm i -g @astryxdesign/cli\n# or: pnpm add -g @astryxdesign/cli · yarn global add @astryxdesign/cli · bun add -g @astryxdesign/cli',
        },
        {
          type: 'prose',
          text: "A project can still install the CLI as a dev dependency, and a package runner (`npx @astryxdesign/cli`) still works. Inside a project, every copy follows the same rules, so the project's release answers whichever one you start ({@link generic:who-answers}). Outside a project, the copy you installed for your computer answers with its own release, while a package runner's copy, or a version you type such as `npx @astryxdesign/cli@0.7.0`, answers as exactly that release.",
        },
      ],
    },
    {
      id: 'cache-and-offline',
      title: 'The cache, and working offline',
      content: [
        {
          type: 'prose',
          text: "Releases live in your platform's per-user cache directory, under `astryx/releases/<version>`: `~/.cache/astryx` on Linux (or `$XDG_CACHE_HOME/astryx`), `~/Library/Caches/astryx` on macOS, and `%LOCALAPPDATA%\\astryx\\Cache` on Windows. The CLI installs them with npm, so your npm registry, proxy, and offline settings apply. Deleting the folder is safe; releases come back when a run needs them.",
        },
        {
          type: 'prose',
          text: "When the release a run needs is not in the cache and cannot be installed, the run fails before writing anything, with `ERR_VERSIONS_UNAVAILABLE` and the release it needs. Installing the project's dependencies, or running again when the registry can be reached, fixes it. No other release answers in its place.",
        },
        {
          type: 'prose',
          text: 'The first run that needs a release prints one line while it installs (`astryx: installing CLI release 0.6.8 into the per-user cache (once)...`), and a run that finds another run installing it waits and says so. A slow download is waited for, up to 15 minutes. A run stopped mid-install leaves nothing behind that blocks the next one, and a cached release whose files were damaged is installed again the next time a run needs it. When several computers share one cache folder, a run installing a release renews its claim every 10 seconds, and a claim from another computer that goes a minute without renewal is taken over.',
        },
        {
          type: 'prose',
          text: "In a Yarn Plug'n'Play project, the CLI cannot see the project's own CLI without running the project's loader, so the release equal to the project's Core answers from the cache. That is the same release whenever the project's CLI matches its Core.",
        },
        {
          type: 'code',
          lang: 'text',
          code: "Error: This project needs CLI release 0.6.8, which is not available: the registry could not be reached. Install the project's dependencies, or run again when the package registry can be reached.",
        },
      ],
    },
    {
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: 'This page is part of {@link namespace:global}, which explains why to install the CLI for your computer and how each part works. Next: {@link generic:who-answers}.',
        },
      ],
    },
  ],
};
