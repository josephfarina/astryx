// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/install-once`: install the CLI once for the
 * computer and run it in any folder; which release answers each folder, and
 * what the CLI keeps in the per-user cache, and the agent text for the whole
 * computer (spec AST-081).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'install-once',
  placement: {parent: 'namespace:cli', slot: 'guides', order: 3},
  title: 'Install once, run anywhere',
  category: 'guide',
  keywords: [
    'global',
    'npm i -g',
    'install globally',
    'which version',
    'release',
    'answeredBy',
    'ERR_VERSIONS_UNAVAILABLE',
    'cache',
    'offline',
    'update',
    'init --user',
    'SKILL.md',
    'skills',
  ],
  description:
    'Install the CLI once for your computer and run it in any folder: each project is answered by the release that matches its Core, and folders outside a project by the newest release.',
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
          text: "A project can still install the CLI as a dev dependency, and a package runner (`npx @astryxdesign/cli`) still works. Inside a project, every copy follows the rules below, so the project's release answers whichever one you start. Outside a project, the copy you installed for your computer answers with the newest release it keeps, while a package runner's copy, or a version you type such as `npx @astryxdesign/cli@0.7.0`, answers as exactly that release.",
        },
      ],
    },
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
      title: 'Outside a project, the newest release answers',
      content: [
        {
          type: 'prose',
          text: 'In a folder that belongs to no project, the CLI answers as a new project on its release would, so an agent with no project files can still read every component and doc. Commands that read Core use the Core of the answering release, installed into the per-user cache the first time one needs it. `doctor`, `swizzle`, and `upgrade` judge or change a project and never use it.',
        },
        {
          type: 'prose',
          text: "The CLI you installed for your computer stays on the newest release. At most once an hour, never in the first hour after you install it, a run starts a background check of the registry's `latest` release, installs a newer one into the cache, and verifies that it starts. The next run outside a project uses it and says so once. A failed check changes nothing, and the release it switched from stays in the cache. Projects are never updated: a reminder and `astryx doctor` name the commands instead (see below).",
        },
        {
          type: 'code',
          lang: 'text',
          code: 'astryx: now using 0.7.3 (was 0.7.2). What changed: https://github.com/facebook/astryx/releases/tag/v0.7.3',
        },
      ],
    },
    {
      id: 'reminders',
      title: 'Reminders to update',
      content: [
        {
          type: 'prose',
          text: "A text-mode run prints one reminder line on standard error, at most once a day for each reason, and never with `--json`. Reminders never change a command's output or exit status. The reminders about a newer release need one that the CLI installed for your computer has found, so a fresh home folder, such as a CI run's, never prints them. The reminder about an old `astryx` command needs no check.",
        },
        {
          type: 'list',
          style: 'unordered',
          items: [
            'The project is on an older release than the newest. The line names the install command for your package manager and the `upgrade` command that migrates the code.',
            'The CLI installed for your computer cannot move to the newest release: it needs a newer Node, the per-user cache cannot be written, or the registry has not been reached for 7 days. The line points at `astryx doctor`, which names the fix for your computer.',
            'The first `astryx` on your search path is a release from before projects were handed to their own release, so it answers every folder itself. The line names the command that replaces it.',
          ],
        },
        {
          type: 'code',
          lang: 'text',
          code: 'astryx: this project uses Astryx 0.7.1; 0.7.3 is the newest. To upgrade: npm install @astryxdesign/core@0.7.3 @astryxdesign/cli@0.7.3, then npx astryx upgrade --from 0.7.1 --apply.\nastryx: cannot move to Astryx 0.8.0: it needs Node >=24, and this computer runs Node 22.13.0. Run astryx doctor for the fix.\nastryx: the astryx command on this computer runs CLI 0.7.1, which answers every folder itself. Replace it: npm i -g @astryxdesign/cli@latest.',
        },
        {
          type: 'prose',
          text: "`astryx doctor` reports the same things: in a project, its release beside the newest with the commands; outside one, whether the CLI installed for your computer can move to the newest release; and, everywhere, every `astryx` on your search path in the order your shell tries them. The times of the reminders live in `astryx/reminders.json` in your platform's configuration folder.",
        },
      ],
    },
    {
      id: 'agent-text',
      title: 'Agent text for the whole computer',
      content: [
        {
          type: 'prose',
          text: "A project's agent docs reach only agents working in that project. The CLI you install for your computer also keeps a short guide where agent tools look on your computer, so agents anywhere know how to use Astryx. It writes the guide on its first run and again after each switch to a newer release, in the background, so no command waits for it. Installing the package does not write it: some package managers skip install scripts.",
        },
        {
          type: 'prose',
          text: "The guide is one skill file, written to each folder an agent tool reads skills from in your home folder. It is the same guide `init` writes into a project, without a version, and it tells agents to follow a project's own agent docs inside that project, because those match the project's release. Its commands start with `astryx`.",
        },
        {
          type: 'table',
          headers: ['Agent name', 'File'],
          rows: [
            ['`claude`', '`~/.claude/skills/astryx/SKILL.md`'],
            [
              '`codex`, `gemini`, `copilot`, `cursor`, `opencode`, `crush`, `qwen`, `cline`, `amp`, `goose`, `roo`, `zed`',
              '`~/.agents/skills/astryx/SKILL.md`',
            ],
            ['`continue`', '`~/.continue/skills/astryx/SKILL.md`'],
            ['`kiro`', '`~/.kiro/skills/astryx/SKILL.md`'],
            ['`windsurf`', '`~/.codeium/windsurf/skills/astryx/SKILL.md`'],
          ],
        },
        {
          type: 'prose',
          text: "Tools that read both the shared folder and Claude Code's list the guide once. Continue, Kiro, and Windsurf read only their own folder, so the CLI writes theirs only when that tool's folder exists in your home folder, or when you choose the tool with `--agent`. Aider reads no skill folder: to give it the guide, add the shared file to the `read:` list in your Aider configuration yourself. The CLI never edits an agent tool's own configuration.",
        },
        {
          type: 'prose',
          text: 'To write it now, or to keep it only where some agent tools look, run `init --user`, with `--agent` and a comma-separated list of agent names to choose:',
        },
        {
          type: 'code',
          lang: 'bash',
          code: 'astryx init --user\nastryx init --user --agent claude,codex',
        },
        {
          type: 'list',
          style: 'unordered',
          items: [
            '`astryx init --user --remove-agents` removes the guide and turns it off: the CLI installed for your computer writes nothing until you run `astryx init --user` again.',
            "Your choices live in `astryx/settings.json` in your platform's configuration folder: `~/.config/astryx` on Linux (or `$XDG_CONFIG_HOME/astryx`), `~/Library/Application Support/astryx` on macOS, and `%APPDATA%\\astryx` on Windows. `computerAgentText.install` is `false` after `--remove-agents`, and `computerAgentText.agents` lists the agents you chose.",
            'Each file records a hash of its text. A file you edited is never overwritten or removed; delete it to get the current guide. A file Astryx did not write, or a symlink, is left as it is.',
            "`init --user` works in any folder. Inside a project it is never handed to the project's own CLI, because it writes to your computer, not the project.",
            'When no `astryx` command runs the Astryx CLI, `init --user` still writes the guide and warns. Outside a project, `astryx doctor` says whether the guide is there, matches the release that answered, or is turned off.',
          ],
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
  ],
};
