// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/integrations/global-integrations`: how an
 * integration behaves when its users install it for their computer, beside
 * the global CLI, and what to test (spec AST-081 FR12).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'global-integrations',
  placement: {parent: 'namespace:integrations', slot: 'guides', order: 25},
  title: 'How integrations work globally',
  category: 'guide',
  keywords: [
    'global integration',
    'computer-level integration',
    'npm i -g',
    'installed for this computer',
    'outside a project',
    'peer range',
    'peerDependencies',
    'cliCommand conflict',
  ],
  description:
    "When users install your integration for their computer, beside the global CLI, it applies in folders outside any project; inside a project, only the project's own integrations apply. What that means for your manifest, peer ranges, `cliCommand`, and tests.",
  sections: [
    {
      id: 'where-it-applies',
      title: 'Where your integration applies',
      content: [
        {
          type: 'list',
          style: 'unordered',
          items: [
            "Installed in an app: it applies in that app, as always, whichever copy of the CLI the user starts, because the app's release answers there.",
            'Installed for the computer, beside the CLI (`npm i -g @astryxdesign/cli your-package`), or in the same folder as the CLI by a tool that installs them together: it applies in every folder outside a project. Users and agents there see its components, templates, docs, themes, codemods, and discover source.',
            "Installed for the computer, inside an app that does not install it: it adds nothing. When its peer range admits the app's release and it loads, `astryx discover` lists it as available, with source `installed for this computer` and the app's install command, and `astryx doctor` names it.",
            "Installed both ways: the app's copy is the only one used in that app. In your own source folder, outside a project, your working copy is used, and `astryx doctor` says the computer's copy is not used there.",
          ],
        },
        {
          type: 'prose',
          text: "The CLI loads a computer-level integration with the same loader and checks as an app's, so a manifest that loads in an app loads the same way here. Nothing extra goes in the manifest.",
        },
      ],
    },
    {
      id: 'peer-ranges',
      title: 'Peer ranges decide whether it loads',
      content: [
        {
          type: 'prose',
          text: "Outside a project, the release that answers is the global CLI's own, with the Core equal to it. When your package's `peerDependencies` range for `@astryxdesign/core` or `@astryxdesign/cli` leaves that release out, the CLI skips your package there, and `astryx doctor` warns, naming your range and the CLI's release. Declare the range of releases your package really supports: too narrow, and global users lose it after every CLI upgrade; too wide, and it loads against a Core it may not build with.",
        },
      ],
    },
    {
      id: 'cli-command',
      title: 'Your cliCommand',
      content: [
        {
          type: 'prose',
          text: "Outside a project, a `cliCommand` your package declares starts every command the CLI prints, as it does in an app ({@link generic:cli-command}). When two computer-level integrations declare different commands, the CLI uses neither and prints the plain command of the CLI installed for the computer, and `astryx doctor` names both. Inside an app, only the app's integrations count, so a computer-level `cliCommand` never changes an app's printed commands.",
        },
      ],
    },
    {
      id: 'test',
      title: 'What to test',
      content: [
        {
          type: 'list',
          style: 'ordered',
          items: [
            'Install the CLI and your package for your computer, then run `astryx discover` and `astryx docs` in an empty folder: your package and its items appear.',
            'Run `astryx doctor` in the same folder: its `computer-integrations` check lists your package as used, with no warning.',
            'In an app that does not install your package, run `astryx discover`: your package is listed as available with the install command, and none of its items appear in `astryx component --list` or `astryx docs`.',
            'Install a CLI release outside your peer range: `astryx doctor` in an empty folder warns that your package is skipped.',
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
          text: 'How the global CLI works for your users: {@link namespace:global}. Their side of computer-level integrations: {@link generic:computer-integrations}.',
        },
      ],
    },
  ],
};
