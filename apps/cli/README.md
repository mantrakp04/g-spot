# g-spot-cli

CLI launcher for g-spot on macOS Apple Silicon.

```sh
bunx g-spot-cli
```

Starts the bundled local server, serves the bundled web app, runs SQLite
migrations, and opens the browser.

```sh
bunx g-spot-cli --port 3999
bunx g-spot-cli --host 127.0.0.1 --port 3999
bunx g-spot-cli --port 3999 --kill
```

Requires Bun `>=1.3.10`.

The package exposes both `g-spot` and `g-spot-cli` executables.
