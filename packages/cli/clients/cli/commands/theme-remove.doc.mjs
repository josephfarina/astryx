// Copyright (c) Meta Platforms, Inc. and affiliates.

/** @file CommandDoc for `astryx theme remove`. */

/** @type {import('@astryxdesign/cli/authoring').CommandDoc} */
export const doc = {
  type: 'command',
  name: 'theme remove',
  displayName: 'astryx theme remove',
  namespace: 'cli/commands',
  summary: 'Remove a non-default theme from the app',
  description:
    'Removes one added theme from the generated module and regenerates the whole module. Choose another default with theme use before removing the current default.',
  fn: 'themeRemove',
  args: [{name: 'slug', param: 'slug', required: true}],
  examples: [{label: 'Remove an added theme', cli: 'astryx theme remove ocean'}],
  outsideProject: 'refuse',
  exitCodes: [
    {code: 0, when: 'the module is regenerated without the theme'},
    {code: 1, when: 'the theme is not added, is the default, or state is invalid'},
  ],
  related: ['theme add', 'theme use', 'theme list'],
  notes: [
    {
      type: 'prose',
      text: "In global mode: outside a project, theme remove writes nothing and fails before doing any work, naming the app project it needs. Inside a project, the release equal to the project's Core runs it, whichever copy of the CLI you start. See {@link namespace:global} and {@link generic:who-answers}.",
    },
  ],
};
