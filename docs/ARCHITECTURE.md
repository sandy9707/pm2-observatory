# Architecture and API

## Runtime

`server.cjs` owns discovery, in-memory snapshots and an HTTP server. `public/app.js` fetches JSON every 3 seconds while visible and unpaused. HTML and CSS are static; tokens.css contains colors and fonts. No frontend build or cloud components.

## Data flow

1. Scan `ps` for PM2 daemon process titles and probe the current user's default, PM2_HOME and configured extra homes.
2. Connect directly to each Unix RPC socket with pm2-axon / pm2-axon-rpc. Read getMonitorData with a timeout. This does not launch daemons.
3. Every 15 seconds, scan TCP listeners with lsof and process ancestry/resource snapshots with ps. Attribute descendants to their PM2 parent, group other listeners by PID.
4. Issue bounded HTTP HEAD probes to discovered local interfaces without following redirects. Suppress wildcard listener links if another process owns the corresponding exact loopback address.
5. Keep 1200 samples of PM2 CPU/RSS aggregates and per-process measurements. Render PM2 summary separately from local listener snapshots.

## Read-only endpoints

| GET path                             | Result                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `/api/snapshot`                      | Host metrics, summary, PM2 instances/processes, localProcesses, history, timestamps and collection errors |
| `/api/process?key=…`                 | Redacted raw PM2 data for a key in the current snapshot                                                   |
| `/api/logs?kind=out&key=…&lines=200` | Standard output tail                                                                                      |
| `/api/logs?kind=error&key=…`         | Error log tail                                                                                            |
| `/api/logs?kind=daemon&instance=…`   | Known daemon log tail                                                                                     |
| `/api/export`                        | Snapshot, redacted raw process data and history                                                           |

No arbitrary file parameter is accepted. Log paths come only from discovered PM2 records. Log reads are bounded to 128 KiB and 50–1000 lines. All write HTTP methods return 405. Cross-site origins/Host mismatches are rejected. API data is untrusted when rendered; browser code escapes markup.

## Identity and lifecycle

PM2 keys combine a hash of the PM2 home and PM2 id. Non-PM2 keys are `local:<PID>` and are valid only for the latest scan; PID reuse and exited services must be treated as transient. Collector errors do not create processes. Endpoint discovery is best effort and may temporarily lag by 15 seconds.

## Dependency choices

Only PM2's socket protocol libraries are runtime dependencies. PM2 itself is optional for discovery and is installed/managed by the machine owner. Node built-ins handle HTTP, files, process inspection, hashing and tests. Third-party packages retain their individual licenses.
