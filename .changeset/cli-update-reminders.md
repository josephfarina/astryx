---
'@astryxdesign/cli': patch
---

[feat] A text-mode run prints one reminder line on standard error, at most once a day for each reason and never with `--json`, when a release is behind: the project is on an older release than the newest one the computer knows of (the line names the install command for the project's package manager and the `upgrade` command); the CLI installed for the computer cannot move to the newest release because it needs a newer Node, the per-user cache cannot be written, or the registry has not been reached for 7 days (the line points at `astryx doctor`); or the first `astryx` on the search path is a release that predates the hand-off (the line names `npm i -g @astryxdesign/cli@latest`). Reminder times live in `astryx/reminders.json` in the per-user configuration folder. `astryx doctor` reports the same: the `newest-release` check names the upgrade commands in a project and warns with the cause and fix outside one, and a new `cli-on-path` check lists every `astryx` command on the search path. A kept release answers outside a project only on a Node it supports.

@josephfarina
