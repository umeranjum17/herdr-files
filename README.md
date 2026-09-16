# herdr-files

The repository you are working in, on your phone: a file tree with bounded,
syntax-highlighted previews, and the git history of the repo your agent sits
in. Read-only, dependency-free, one small plugin.

It is a [Herdr](https://herdr.dev) plugin with declarative
[muxr](https://github.com/umeranjum17) UI contributions: muxr renders the
Files tab and the history screens, and the plugin serves the data through
one public, read-only RPC contract. It is useful in muxr but contains no muxr-specific code: it speaks only the
public Herdr plugin manifest and muxr declarative-UI contracts.

## What it does

- **Files tab** — a lazy tree of every git repository open in your session
  (drawn from the host's sanitized session snapshot), with folders-first
  browsing and text previews capped at 240 lines / 24 KiB so a stray
  `cat`-sized file never floods your phone.
- **Git history** — the 25 most recent commits of the session repository,
  and the unified diff of any one of them.
- **Nothing else.** Two surfaces, both reads.

## What it will not do

- **Never writes.** No git commands that mutate anything, no file edits, no
  commands in your terminal. Every RPC is declared `mode: "read"` and the
  manifest test in this repo fails if that drifts.
- **Never opens what the session did not open.** A repository must come from
  the host's session context; a preview must resolve inside that repository.
  Paths outside it — including `..` traversal and symlink escapes — are
  refused.
- **No review of working-tree changes.** Seeing what your agent changed is
  part of muxr itself (the session Changes surface); this plugin only
  browses the tree and history.
- **No file bytes leave your machine.** Previews are pulled to your phone
  when you open them and nothing is uploaded anywhere else.

## Install

Requires [Herdr](https://herdr.dev) ≥ 0.8.0, `node` ≥ 20 on `PATH`, `git` on
`PATH`, and a muxr build with declarative UI schema 11 or newer (any current
self-host build; the app checks and will list the plugin as unavailable
otherwise). Linux and macOS.

```sh
muxr plugin install umeranjum17/herdr-files
muxr plugin list        # muxr.code should appear, enabled
```

The Files tab appears in muxr's side navigation; the history button appears
in a session's header when the session has a working directory.

Toggle without uninstalling:

```sh
herdr plugin disable muxr.code
herdr plugin enable muxr.code
```

## Uninstall

```sh
muxr plugin remove muxr.code    # or: herdr plugin uninstall muxr.code
```

No residue: the plugin keeps no state, writes no config, and holds no
secrets. Everything it shows was already on the machine.

## Develop

```sh
npm test   # node built-in runner, zero dependencies; also runs in CI on every PR
```

The tests drive the real scripts the way the host does: a fixture repository,
real `git`, real process spawns — not mocks of the plugin's own output.

## License

MIT — see [LICENSE](LICENSE).
