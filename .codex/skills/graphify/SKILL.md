---
name: graphify
description: "Use for Lectio codebase questions about architecture, file relationships, impact analysis, or unfamiliar subsystems. Query the local graph before broad source discovery."
---

# Lectio Graphify

Use Graphify to retrieve the smallest useful code context. It indexes code locally through AST parsing and must not require an API key for ordinary Lectio work.

## Fast path

1. If the task names one known file and is a mechanical local edit, read that file directly; do not query the graph.
2. Otherwise, when `graphify-out/graph.json` exists, start with:

   ```powershell
   graphify query "<precise task question>" --budget 1200
   ```

3. Use `graphify explain "<symbol>"` for one symbol or `graphify path "<A>" "<B>"` for a relationship.
4. Read only the returned source files/lines and direct callers needed to perform the task.

## Keep it cheap

- Do not read `GRAPH_REPORT.md` unless the user asks for a broad architecture review.
- Do not generate HTML, wiki, PDF/image extraction, semantic extraction, MCP servers, or external graph backends unless explicitly requested.
- Do not pass documents, images, audio or credentials to Graphify. The project graph is code-only.
- Update the graph once after a cohesive code task, not after each edit:

  ```powershell
  pnpm graph:refresh
  ```

## If the graph is missing or stale

Run `pnpm graph:refresh`. If it cannot answer the question after one scoped query, fall back to `rg` and targeted file reads; do not rebuild or scan the entire repository by default.
