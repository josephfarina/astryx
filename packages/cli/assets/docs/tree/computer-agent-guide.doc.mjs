// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs cli/global/computer-agent-guide`: the agent guide the CLI
 * keeps for the whole computer, and `init --user` (spec AST-081 FR8).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'computer-agent-guide',
  placement: {parent: 'namespace:global', slot: 'guides', order: 4},
  title: 'The agent guide for your computer',
  category: 'guide',
  keywords: [
    'init --user',
    'SKILL.md',
    'skills',
    'agent guide',
    'agent text',
    'remove-agents',
    'settings.json',
    'claude',
    'codex',
  ],
  description:
    'The CLI installed for your computer keeps a short Astryx guide where agent tools look in your home folder, so agents anywhere know Astryx; `init --user` chooses where it goes or turns it off.',
  sections: [
    {
      id: 'agent-text',
      title: 'Agent text for the whole computer',
      content: [
        {
          type: 'prose',
          text: "A project's agent docs reach only agents working in that project. The CLI you install for your computer also keeps a short guide where agent tools look on your computer, so agents anywhere know how to use Astryx. It writes the guide on its first run and again after you upgrade it, in the background, so no command waits for it. Installing the package does not write it: some package managers skip install scripts.",
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
      id: 'more',
      title: 'More on global mode',
      content: [
        {
          type: 'prose',
          text: "This page is part of {@link namespace:global}, which explains why to install the CLI for your computer and how each part works. A project's own agent docs: {@link command:init}.",
        },
      ],
    },
  ],
};
