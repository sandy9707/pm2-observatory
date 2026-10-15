# Project status

Release: v1.0.1, prepared 2026-10-15 (Asia/Shanghai).

Implemented: multi-daemon PM2 monitoring; non-PM2 TCP listeners; top-of-page services table; per-service links; filtering and ordering; process details; bounded logs; PM2 resource history; JSON export; loopback-only read-only HTTP; portable dependencies; macOS login-start installer; handoff and recovery documentation.

Local verification: syntax checks and 5 automated tests pass on macOS. Earlier browser verification covered filtering, details, links, pause, export, failure recovery and responsive widths; release verification is recorded in local deployment notes. GitHub CI configuration runs the automated suite on macOS / Node 22 and 24.

No frontend build step or database migration. In-memory history is intentionally not backed up. Deployment-specific versions, commit checksums, service counts and path verification belong in ignored local/DEPLOYMENT.md, not this public document.
