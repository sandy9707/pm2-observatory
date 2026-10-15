# Security model

This tool is intended for one trusted macOS user inspecting their own machine. It binds only to 127.0.0.1. Host, Origin and Sec-Fetch-Site checks reduce browser cross-site access; they are not authentication against local applications or other users on the same host.

PM2 metadata and logs can contain sensitive information. JSON fields with credential-like names are masked, but logs and arbitrary strings are not comprehensively sanitized. Keep exports, screenshots, machine deployment records and backups private. The dashboard does not send telemetry or upload data.

Do not expose the listener through a public reverse proxy. Do not add remote shell commands, arbitrary log/file paths or write endpoints without a separate design and authorization model.

For vulnerability reports, prefer GitHub's private vulnerability reporting if enabled. Otherwise open a minimal issue requesting private coordination without credentials or exploit payloads. Never include real machine logs in a public report.
