// Copyright (c) Meta Platforms, Inc. and affiliates.

/**
 * @file `astryx docs global/ci-and-containers`: Astryx in CI and containers: no
 * update checks, caching versions, read-only home folders (spec AST-081 FR6,
 * FR7, FR10).
 */

/** @type {import('@astryxdesign/cli/authoring').ReferenceDoc} */
export const docs = {
  type: 'generic',
  name: 'ci-and-containers',
  placement: {
    parent: 'namespace:global',
    slot: 'guides',
    order: 8,
  },
  title: 'CI and containers',
  category: 'guide',
  keywords: [
    'ci',
    'github actions',
    'container',
    'docker',
    'read-only home',
    'cache the release cache',
  ],
  description:
    "What Astryx does in CI and containers: no update checks or notices, the project's version as always, and how to cache versions or work with a read-only home folder.",
  sections: [
    {
      id: 'in-ci',
      title: 'In CI',
      content: [
        {
          type: 'list',
          style: 'unordered',
          items: [
            'Most CI services set `CI=true`. When `CI` is set to anything but empty, `0`, or `false`, Astryx never checks for updates and never prints a notice; `CI=false`, `CI=0`, and an empty `CI` do not count. `NO_UPDATE_NOTIFIER`, set to anything, does the same anywhere.',
            "Run the project's own CLI, such as `npx astryx`, so CI uses the version pinned in the repo. A global install in a CI image also works: in a project, it runs the project's version.",
            'Use `--json` for output a script reads; it never carries the answered-by line or a notice.',
          ],
        },
      ],
    },
    {
      id: 'cache',
      title: 'Cache project versions',
      content: [
        {
          type: 'prose',
          text: "When the project installs its matching CLI and you install the project's dependencies first, there is nothing to cache: the project's own CLI answers. Otherwise Astryx installs the project's version into its cache once; to skip that download on every run, cache the folder between runs: `~/.cache/astryx` on Linux, or wherever `XDG_CACHE_HOME` points ({@link generic:reference}).",
        },
      ],
    },
    {
      id: 'read-only',
      title: 'Read-only home folders',
      content: [
        {
          type: 'prose',
          text: "When the cache cannot be written, a project whose version is not installed is answered by its own CLI, or by the global install, with a warning naming the folder. Point `XDG_CACHE_HOME` at a writable absolute path, or install the project's dependencies so its own matching CLI answers. The global install's daily check and agent guide are skipped quietly when they cannot be written.",
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
