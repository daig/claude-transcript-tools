# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Zod schema, JSON Schema, and documentation for Claude Code's JSONL session transcripts. Published as the `claude-code-transcripts` npm package. Targets Claude Code v2.1.20+.

## Commands

```bash
npm run build              # tsc → dist/
npm run generate:schema    # regenerate session-transcript.schema.json from Zod
npm run validate           # validate schema against real ~/.claude transcripts
npm run validate -- path/to/file.jsonl  # validate a specific file
```

## Architecture

The Zod schema in `session-transcript.schema.ts` is the single source of truth. Everything else is derived from it:

- `generate-json-schema.ts` converts Zod → `session-transcript.schema.json` using Zod v4's `z.toJSONSchema()`. It registers all schemas in `z.globalRegistry` with descriptive IDs so the JSON Schema output has readable `$defs`.
- `validate-transcript.ts` streams real JSONL files and validates each line via `validateLine()`.
- `dist/` is the compiled TypeScript output (declaration files + source maps).

## Schema Design

Seven JSONL line types: `summary`, `file-history-snapshot`, `user`, `assistant`, `system`, `progress`, `queue-operation`.

Key design decisions:
- `.strict()` on all line types — unknown fields are rejected, not silently dropped.
- `validateLine()` uses manual dispatch (not `z.union()` fallthrough) so `.strict()` violations surface immediately. User lines dispatch on `toolUseResult` presence and `message.content` type. System lines dispatch on `subtype`.
- `z.unknown()` only for MCP/plugin tool inputs and results. All Anthropic-defined fields use specific types.
- `ToolUseBlock` uses `.superRefine()` to correlate tool `name` with the correct input schema from `toolInputSchemas`.
- `PersistedToolResultBlock` uses `.refine()` + `.transform()` to parse `<persisted-output>` XML wrappers into structured objects. Union ordering matters: persisted is tried before inline.

## Dependencies

- **zod** v4 (runtime) — schema definitions and `z.toJSONSchema()`
- **tsx** (dev) — runs TypeScript directly for generate/validate scripts
- **typescript** (dev) — compilation
