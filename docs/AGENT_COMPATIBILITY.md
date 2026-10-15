# Agent compatibility

AGENTS.md is the canonical project instruction file for Codex, Claude Code and human maintainers. CLAUDE.md imports it rather than duplicating policies. docs/AI_AGENT_HANDOFF.md gives the continuation context and commands.

No agent-specific plugin, private memory, credentials, local skills or conversation history is required. The project uses regular Node/npm/Git commands. Do not infer access to a production machine from this repository; obtain the user's task scope and connection separately.

Local deployment records are ignored under local/, backups under backups/. These may describe machine-specific directories but must not contain authentication secrets.
