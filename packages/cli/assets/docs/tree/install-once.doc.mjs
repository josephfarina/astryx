// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs global/install-once`: install the CLI for the computer with each
 * package manager; the cache of versions projects need; offline (spec AST-081).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'install-once',
  placement: {
    parent: 'namespace:global',
    slot: 'guides',
    order: 2,
  },
  title: 'Install Astryx globally',
  category: 'guide',
  keywords: [
    'pnpm add -g',
    'yarn global add',
    'bun add -g',
    'volta install',
    'npx',
    'offline',
    'cache',
    'per-user cache',
    'EACCES',
    'permission denied',
    'sudo',
    'npm prefix',
  ],
  description:
    'Install the Astryx CLI once for your computer with npm, pnpm, Yarn, Bun, or Volta, and what happens when you are offline.',
  sections: [
    {
      id: 'install',
      title: 'Install it',
      content: [
        {
          type: 'prose',
          text: 'Install the CLI package with your package manager. One astryx command then works in every folder.',
        },
        {
          type: 'code',
          lang: 'bash',
          code: 'npm i -g @astryxdesign/cli\n# or: pnpm add -g @astryxdesign/cli · yarn global add @astryxdesign/cli · bun add -g @astryxdesign/cli · volta install @astryxdesign/cli',
        },
        {
          type: 'prose',
          text: "Keep the CLI installed in each project too: that pins its version for teammates and CI ({@link generic:project-global-or-both}). Inside a project, whichever astryx command you type, the project's version answers. Outside a project, your global install answers with its own version, and a version you name, such as `npx @astryxdesign/cli@0.7.0`, answers as exactly that version.",
        },
      ],
    },
    {
      id: 'eacces',
      title: 'Permission denied (EACCES)',
      content: [
        {
          type: 'prose',
          text: 'If `npm i -g` fails with `EACCES`, do not use `sudo`. Give npm a global folder you own, then add its `bin` folder to your PATH, or use a Node version manager such as nvm, fnm, or Volta:',
        },
        {
          type: 'code',
          lang: 'bash',
          code: 'npm config set prefix ~/.npm-global\nexport PATH="$HOME/.npm-global/bin:$PATH"\nnpm i -g @astryxdesign/cli',
        },
        {
          type: 'prose',
          text: "Astryx's update notice then names that folder in its upgrade command.",
        },
      ],
    },
    {
      id: 'versions-for-projects',
      title: 'Versions for your projects',
      content: [
        {
          type: 'prose',
          text: 'When a project needs a version you do not have, such as a fresh clone or a project that installs only `@astryxdesign/core`, Astryx installs that version once into a cache in your home folder and reuses it. It uses npm for that, so your npm registry, proxy, and offline settings apply. Deleting the cache is safe: versions come back when a project needs them. Where it lives: {@link generic:reference}.',
        },
      ],
    },
    {
      id: 'offline',
      title: 'Offline',
      content: [
        {
          type: 'prose',
          text: "Outside a project, your global install works offline. In a project, the project's own CLI or a cached version also works offline. When the project's version is neither installed nor cached and cannot be fetched, the project's own CLI answers if it installs one, else your global install, with a one-line warning; install the project's dependencies, or run again online. {@link generic:problems} has the exact message.",
        },
      ],
    },
    {
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: 'This page is part of {@link namespace:global}, which explains what global mode is and how each part works. Next: {@link generic:who-answers}.',
        },
      ],
    },
  ],
};
