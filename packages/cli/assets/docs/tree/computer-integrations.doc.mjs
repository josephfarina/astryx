// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/global/computer-integrations`: integrations
 * installed for the computer, where they apply, and how to see them (spec
 * AST-081 FR12).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'computer-integrations',
  placement: {parent: 'namespace:global', slot: 'guides', order: 5},
  title: 'Integrations installed for your computer',
  category: 'guide',
  keywords: [
    'global integration',
    'computer-level integration',
    'npm i -g integration',
    'install an integration globally',
    'integration outside a project',
    'installed for this computer',
  ],
  description:
    'Integrations installed beside the CLI installed for your computer apply in folders outside any project. Inside a project, only the integrations the project installs apply, and the others are listed as ones you could add.',
  sections: [
    {
      id: 'install',
      title: 'Install one for your computer',
      content: [
        {
          type: 'prose',
          text: 'Install an integration package the same way you installed the CLI, so the two sit side by side:',
        },
        {
          type: 'code',
          lang: 'bash',
          code: 'npm i -g @astryxdesign/cli @acme/widgets\n# or: pnpm add -g · yarn global add · bun add -g',
        },
        {
          type: 'prose',
          text: 'pnpm 11 and later install each global package in a folder of its own; all of them count. A tool that installs the CLI together with integrations in one folder, and runs the CLI from there, counts the same way: every integration it installs there applies. A package runner (`npx`) and the per-user release cache are not installs for your computer, so integrations there never count.',
        },
      ],
    },
    {
      id: 'outside-a-project',
      title: 'Outside a project, they apply',
      content: [
        {
          type: 'prose',
          text: 'In a folder outside any project, the CLI loads each integration installed beside it the way a project loads its own: its components, templates, docs, themes, codemods, and discover source show up, and a command name it declares (`cliCommand`) starts the commands the CLI prints. The same checks apply as in a project.',
        },
        {
          type: 'prose',
          text: "An integration whose `@astryxdesign/core` or `@astryxdesign/cli` peer range leaves out the CLI's release is skipped, and `astryx doctor` says which and why. Install a release of the integration that supports your CLI, or upgrade the CLI.",
        },
      ],
    },
    {
      id: 'inside-a-project',
      title: "Inside a project, only the project's integrations apply",
      content: [
        {
          type: 'prose',
          text: "A project's answers must match what the project installs: a component or import from a package it does not install would not build. So inside a project, only the integrations the project configures or installs apply, and one installed for your computer adds nothing there.",
        },
        {
          type: 'prose',
          text: "`astryx discover` still lists it, among the packages the project could add, with source `installed for this computer` and the command that adds it with the project's package manager, when its peer range admits the project's release and it loads. When the project installs the same integration, the project's copy is the only one used. A folder that is an integration's own source, outside a project, uses that copy too.",
        },
      ],
    },
    {
      id: 'check',
      title: 'See which ones apply',
      content: [
        {
          type: 'list',
          style: 'unordered',
          items: [
            'Outside a project, `astryx doctor` lists the integrations installed for your computer that it uses, and warns about each it skips or cannot load.',
            "Inside a project, `astryx doctor` lists the ones the project does not install, as available, with the project's install command.",
            '`astryx discover` lists them as installed outside a project, and as available inside one.',
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
          text: 'This page is part of {@link namespace:global}, which explains why to install the CLI for your computer and how each part works. Building an integration: {@link generic:global-integrations}.',
        },
      ],
    },
  ],
};
