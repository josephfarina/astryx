// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/global/updates`: how the CLI installed for the computer
 * learns of newer releases and the notice it prints (spec AST-081 FR6, FR10).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'updates',
  placement: {parent: 'namespace:global', slot: 'guides', order: 3},
  title: 'Updates and notices',
  category: 'guide',
  keywords: [
    'update',
    'upgrade the CLI',
    'update notice',
    'new release',
    'NO_UPDATE_NOTIFIER',
    'CI',
    'latest',
    'state.json',
  ],
  description:
    'The CLI installed for your computer checks for a newer release once a day and prints a two-line notice after a successful command. It never upgrades itself or a project.',
  sections: [
    {
      id: 'update-notices',
      title: 'Update notices',
      content: [
        {
          type: 'prose',
          text: "Once a day, never in the first day after its first run, the CLI installed for your computer checks the registry's `latest` release in the background, without delaying the command, and remembers the answer. When a newer release exists, a command that finishes successfully prints two lines on standard error, at most once a day:",
        },
        {
          type: 'code',
          lang: 'text',
          code: 'A new release of Astryx is available: 0.7.2 → 0.7.3\nTo upgrade, run: npm i -g @astryxdesign/cli@latest',
        },
        {
          type: 'list',
          style: 'unordered',
          items: [
            'Outside a project, the command is that of the package manager that installed the CLI: `npm i -g`, `pnpm add -g`, `yarn global add`, `bun add -g`, or `volta install`. When the newest release needs a newer Node than your computer runs, the second line says so first.',
            "Inside a project, the notice is about the project's release, and the second line names the install command for the project's package manager and the `upgrade` command that migrates the code.",
            'When the first `astryx` on your search path is a release from before projects were handed to their own release, it answers every folder itself; a notice names that release and the command that upgrades it.',
            'No notice prints with `--json`, after a failed command, when the `CI` environment variable is set, or when `NO_UPDATE_NOTIFIER` is set; with either variable set, the CLI does not check the registry either. Unlike `gh`, a notice prints when standard error is not a terminal, because agents run the CLI without one.',
          ],
        },
        {
          type: 'code',
          lang: 'text',
          code: 'A new release of Astryx is available: 0.7.1 → 0.7.3\nTo upgrade, run: npm install @astryxdesign/core@0.7.3 @astryxdesign/cli@0.7.3, then npx astryx upgrade --from 0.7.1 --apply',
        },
        {
          type: 'prose',
          text: "`astryx doctor` reports the same things: in a project, its release beside the newest with the commands; outside one, the release of the CLI installed for your computer beside the newest; and, everywhere, every `astryx` on your search path in the order your shell tries them. What the check found, and when each notice last printed, live in `astryx/state.json` in your platform's configuration folder.",
        },
      ],
    },
    {
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: 'This page is part of {@link namespace:global}, which explains why to install the CLI for your computer and how each part works. Upgrading a project to a newer Core: {@link command:upgrade}.',
        },
      ],
    },
  ],
};
