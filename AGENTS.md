# Project instructions

- Read README.md and docs/AI_AGENT_HANDOFF.md before changing behavior.
- This is a local-only, read-only macOS dashboard. Preserve loopback binding, Host/Origin checks, finite log reads, and HTML escaping.
- Monitoring must never spawn, stop, restart or reconfigure another PM2 daemon or application. Lifecycle commands are for this dashboard only.
- Do not assume a username, home path, Node location, PM2 version, daemon count or application list. Use os.homedir(), process.execPath and environment configuration.
- Keep PM2 metrics separate from system listener metrics; never invent missing restart counts or logs.
- No log files, environment dumps, credentials, real snapshots, machine-specific deployment records or node_modules in Git. Put private deployment notes in ignored local/ and archives in ignored backups/.
- Main source is server.cjs and public/{index.html,app.js,style.css}; tokens.css defines shared visual values. No frontend compilation.
- Run npm ci, npm run check and npm test. Verify browser search, links, details, pause, errors and 320/375/414/768/1440 widths after UI edits.
- For deployment use the project's own PM2 process and optional user LaunchAgent. Do not run pm2 save, kill all, delete all or change existing startup jobs as a convenience.
- Keep docs synchronized with supported platforms and limitations. Existing runtime library dependencies use their own licenses.
