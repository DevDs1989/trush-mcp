<div align="center">

# t-rush-mcp

**An MCP Server for AI agents to scan, triage, and speedrun your codebase technical debt.**

[![npm version](https://img.shields.io/npm/v/@devds1989/t-rush-mcp?color=black&style=flat-square)](https://www.npmjs.com/package/@devds1989/t-rush-mcp)

</div>

---

## Lineage & Core Concept

This project is a direct extension of the `t-rush` ecosystem. Rather than rewriting TODO-scanning logic from scratch, it shares the exact same core engine ([`@devds1989/trush-core`](https://github.com/DevDs1989/trush-core)) as the original [`t-rush` CLI](https://github.com/DevDs1989/trush).

This guarantees that humans and AI agents stay in perfect sync:
- **Shared Scanner:** A new regex or language feature added to `trush-core` instantly works for both the CLI and the MCP server.
- **Shared State:** When an agent resolves a TODO via this MCP server, it updates the same `~/.t-rush/data.json` file used by the CLI. If an agent fixes a bug, your personal streak goes up.

While comparable TODO-scanning MCP servers exist (e.g., Startr's GitHub TODO Scanner, TechDebtMCP), `t-rush-mcp` differentiates itself by acting as a secondary interface to an established human-first tool, rather than an isolated silo. It also introduces cross-repo debt aggregation and gamified momentum (streaks) that existing alternatives lack.

---

## Features for Agents

- **scan_todos**: Recursively scan a project for `TODO`, `FIXME`, `BUG`, `HACK`, and `XXX` markers, complete with `git blame` author attribution.
- **search_todos**: Fuzzy search capabilities letting agents query by intent (e.g. "auth race condition") rather than exact string matches.
- **triage_todos**: Categorizes comments into High, Medium, and Low severity based on keyword heuristics.
- **suggest_resolution**: Analyzes the surrounding code context of a TODO to help an agent formulate an implementation plan.
- **aggregate_debt**: Scans multiple repositories simultaneously to provide a unified overview of all accumulated debt.
- **resolve_todo**: Marks a TODO as resolved and immediately bumps the user's streak.

---

## Quick Start (for Claude Desktop / MCP Clients)

You do not need to install this globally. You can run it seamlessly using `npx`:

```json
{
  "mcpServers": {
    "trush": {
      "command": "npx",
      "args": [
        "-y",
        "@devds1989/t-rush-mcp"
      ]
    }
  }
}
```

Since the server runs entirely on your local machine using standard `git` and file I/O, **no API keys or external authentication are required**.

---

## Usage Scenarios

The server provides built-in MCP prompts for common AI workflows:

1. **Daily Cleanup (`daily_cleanup`)**: Automates the "keep the streak alive" loop. Instructs the AI to scan the repo, triage the debt, pick a high-priority issue, suggest a fix, and increment your streak upon confirmation.
2. **Pre-Refactor Audit (`pre_refactor_audit`)**: Scopes a scan and triage to a specific module folder before touching it, allowing the AI to map out known "landmines" (bugs or hacks) before rewriting code.

---

## License

[MIT](./LICENSE) © Dev
