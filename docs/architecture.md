# Architecture

`agent-skill-bridge` is organized around a shared core runtime and multiple delivery surfaces.

- `packages/core` contains parsing, indexing, routing, context building, resource access, execution, state, and trace primitives.
- `packages/cli` offers local inspection and orchestration commands.
- `packages/mcp-server` exposes skills through the MCP transport.
- `packages/openai-proxy` provides an OpenAI-compatible gateway.
- `packages/adapters` contains integration helpers for different agent runtimes.
- `packages/sandbox` isolates local execution concerns.
