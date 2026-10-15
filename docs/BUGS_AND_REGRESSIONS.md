# Known limits and regression checks

- macOS only: `ps` columns and `lsof` path are platform-specific. Linux/Windows are not verified.
- RPC is PM2's internal API; monitor protocol compatibility when upgrading PM2.
- Only current-user-visible listeners and accessible PM2 sockets are discoverable. No UDP or offline application inventory.
- HTTP HEAD detects protocol reachability, not a working UI. APIs may return 401/403/404; HTTPS-only listeners remain ports without generated links.
- Non-PM2 resource values refresh every 15 seconds, while PM2 values refresh every 3 seconds.
- Field-name redaction does not guarantee logs, command arguments or exports are secret-free.
- History is approximately one hour in memory and resets on process restart.
- Login startup requires the macOS GUI user session and mounted project volume; it is not a privileged boot daemon.
- Dashboard names are distinguished by PM2 home; same names/IDs in separate daemons must never merge.
- Regression to avoid: an exact loopback listener must win over another process's wildcard address for URL attribution.
- Regression to avoid: non-PM2 details must not request PM2 logs or display a fictional restart count.
- Regression to avoid: beginning discovery before binding the dashboard socket misattributes the first port scan.

Automated checks: npm test. UI checks: services first, source filters, escaped names/paths, details/log selection, export, error recovery, 320/375/414/768/1440 px widths, no page exceptions.
