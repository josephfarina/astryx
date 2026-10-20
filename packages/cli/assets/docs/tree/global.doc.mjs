// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/global`: use Astryx globally. Why install the CLI
 * once for the computer, what it gives you and your agents, and how it works,
 * step by step; the parent of every global-mode guide (spec AST-081).
 */

/** @type {import('@astryxdesign/cli/authoring').NamespaceDoc} */
export const docs = {
  type: 'namespace',
  name: 'global',
  placement: {parent: 'namespace:cli', slot: 'guides', order: 3},
  title: 'Use Astryx globally',
  summary:
    'Install the Astryx CLI once for your computer and use it in any folder: every project still gets the release that matches its Core, and agents anywhere know Astryx.',
  keywords: [
    'global',
    'global mode',
    'globally',
    'npm i -g',
    'install globally',
    'install once',
    'computer',
    'any folder',
    'outside a project',
    'which release',
    'answeredBy',
  ],
  slots: {
    guides: {
      title: 'How it works',
      accepts: {kinds: ['generic']},
    },
  },
  blocks: [
    {
      type: 'prose',
      text: 'Install the Astryx CLI once for your computer, and one astryx command works in every folder, for you and for any agent. Inside a project, the project still decides which release answers, so what you get always matches the Core it installs. Outside a project, the release you installed answers.',
    },
    {type: 'code', lang: 'bash', code: 'npm i -g @astryxdesign/cli'},
    {type: 'heading', level: 3, text: 'Why use it globally'},
    {
      type: 'list',
      style: 'unordered',
      items: [
        'Install once: no per-project install just to read docs, list components, or copy a template.',
        'Agents anywhere know Astryx: the CLI keeps a short agent guide where agent tools look on your computer, so an agent outside any project can still find components and docs.',
        "Every project gets its own matched release: inside a project, the release equal to the project's Core answers, whichever copy of the CLI you start, so code and docs never drift from the installed Core.",
        'No stale installs: the CLI tells you when a newer release is out, and never upgrades itself or a project behind your back.',
      ],
    },
    {type: 'heading', level: 3, text: 'How it works'},
    {
      type: 'list',
      style: 'ordered',
      items: [
        'Install the CLI for your computer with your package manager: {@link generic:install-once}.',
        "In a project, the release equal to the project's Core answers: the project's own CLI when it matches, else that release from your per-user cache. The copy you started hands the run over before reading anything of the project. Outside a project, the copy you started answers itself: {@link generic:who-answers}.",
        'After a successful command, a two-line notice says when a newer release is out, with the command that upgrades: {@link generic:updates}.',
        'The CLI keeps an agent guide for your computer, and `init --user` chooses where it goes or turns it off: {@link generic:computer-agent-guide}.',
        'Integrations you install beside the CLI apply outside projects; inside a project, only the integrations the project installs apply: {@link generic:computer-integrations}.',
        'Offline, a project whose release is not in your cache fails before writing anything, naming the release it needs: {@link generic:install-once}.',
      ],
    },
    {type: 'heading', level: 3, text: "What you'll see"},
    {
      type: 'prose',
      text: "In text mode, one line on standard error says which release answered, unless the project's own CLI answered directly. With `--json` nothing extra prints, and every result carries `meta.answeredBy`.",
    },
    {
      type: 'code',
      lang: 'text',
      code: "astryx: answered by this project's CLI 0.6.8, handed over from CLI 0.7.2\nastryx: answered by CLI 0.6.8 with Core 0.6.8, the release that matches this project's Core\nastryx: answered by CLI 0.7.2 with Core 0.7.2, outside a project\nA new release of Astryx is available: 0.7.2 → 0.7.3\nTo upgrade, run: npm i -g @astryxdesign/cli@latest",
    },
    {type: 'heading', level: 3, text: 'What changes in global mode'},
    {
      type: 'list',
      style: 'unordered',
      items: [
        'Which release answers: inside a project, the release equal to its Core, whichever copy you start; outside one, the copy you started. See {@link generic:who-answers}.',
        "Printed commands: commands the CLI prints start with a name that reaches the same release: the project's runner, the plain command of the CLI installed for your computer outside a project, or the CLI pinned to the release. See {@link generic:cli-command}.",
        'Commands that need a project: outside a project, `swizzle`, `theme use`, `theme remove`, and `integration add` write nothing and say what they need; `doctor`, `init`, `theme add`, and `upgrade` do something else, which each command doc states. See {@link namespace:commands}.',
        "Integrations: outside a project, integrations installed beside the CLI apply; inside one, only the project's own. See {@link generic:computer-integrations}.",
        'Updates: a notice after a successful command; nothing upgrades by itself. See {@link generic:updates}.',
        "Agent text: a guide for your computer, beside each project's own agent docs, which win inside that project. See {@link generic:computer-agent-guide}.",
        'Doctor: outside a project, it checks your computer instead of a folder. See {@link command:doctor}.',
        'Programmatic API: functions run in your process with the package you import, never handing off to another release; with `cwd` outside a project they answer as the commands do there, and each function doc says how. See {@link namespace:api}.',
      ],
    },

    {
      type: 'prose',
      text: 'Building an integration? {@link generic:global-integrations} covers how yours behaves when installed for the computer.',
    },
  ],
};
