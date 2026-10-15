# AI Agent Handoff

## Source and destination

- Source agent: Codex.
- Destination agent: Codex, Claude Code, or a human maintainer.
- Source OS: macOS (Apple Silicon).
- Destination OS: macOS (Apple Silicon); machine-specific paths stay in local/DEPLOYMENT.md.
- Repository: https://github.com/sandy9707/pm2-observatory
- Branch/tag: main / v1.0.1.
- Last verified commit: the commit referenced by tag v1.0.1; resolve with `git rev-parse v1.0.1`. Deployment-specific exact hashes belong in local/DEPLOYMENT.md.

## Current project goal

Provide one local dashboard for all accessible PM2 daemons and TCP listening services, with useful links and diagnostics. No remote process control or public hosting.

## Current state

Native Node HTTP server with static browser UI; npm dependencies are PM2's MIT-licensed socket protocol libraries. No SQL database, frontend build or telemetry. Service snapshots stay in memory. Current supported OS is macOS.

## Recent changes

1. Built a multi-instance PM2 dashboard.
2. Moved processes above summaries, added HTTP links based on actual listener PIDs.
3. Included non-PM2 listeners such as application/internal services, clearly labeled by origin.
4. Prepared an open-source release: removed private dependency paths, introduced lockfile, license, self-starting tests, CI and an optional per-project LaunchAgent.
5. Start the HTTP socket before discovery so the first self-scan sees this dashboard rather than another wildcard-bound service.

## Known bugs and regressions

See BUGS_AND_REGRESSIONS.md. PM2 6 and 7 use an internal socket API; later protocol changes may require adaptation. Header-based redaction is not comprehensive secret scanning. HTTP listeners can be APIs without a browser homepage. Pure HTTPS and UDP discovery are outside current scope.

## Build, run, and test commands

```sh
npm ci
npm run check
npm test
npm start
# Or, with existing PM2:
pm2 start ecosystem.config.cjs
```

Tests launch a temporary server and a mock RPC daemon; no fixed PM2 process count is assumed. The integration test reads accessible local listeners but never manages them.

## High-risk files

- server.cjs: Host/Origin gates, RPC isolation, log allowlist, bounded tail reads, process ancestry and port ownership.
- public/app.js: HTML escaping, async selection/log guards and distinction between PM2/non-PM2 data.
- scripts/install-launchagent.cjs: only manages its own label; must not overwrite generic PM2 startup configuration.

## Do-not-do list

Do not bind to 0.0.0.0 without a separately designed authentication model. Do not add arbitrary filesystem read endpoints. Do not auto-run `pm2 connect` or start a new daemon just to monitor it. Do not include actual logs/environment dumps in screenshots, issues or commits.

## Next recommended task

Read project status, run checks, then inspect the requested change. Useful future improvements: optional per-user service aliases, an explicit HTTPS protocol detector and pagination for machines with many listeners. These are suggestions, not unfinished release requirements.

## Verification checklist

- Check git status and git log before editing.
- Confirm macOS/Node/npm and current source location.
- Run npm ci, npm run check, npm test.
- Verify PM2 and non-PM2 filtering; nonexistent services have no fabricated links.
- Verify service is bound only to 127.0.0.1 and existing PM2 services are untouched.
- Review diffs for private data before commit/push.

## Destination-agent next command

Run `cat AGENTS.md docs/AI_AGENT_HANDOFF.md docs/PROJECT_STATUS.md`, then `npm ci && npm run check && npm test` from the repository root.
