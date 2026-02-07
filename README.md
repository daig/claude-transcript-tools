# claude-code-transcripts

Zod schema, JSON Schema, and semantic documentation for Claude Code's JSONL session transcripts.

## What's in the box

| File | Purpose |
|------|---------|
| `session-transcript.schema.ts` | Source-of-truth Zod schema with `validateLine()` and persisted-output helpers |
| `session-transcript.schema.json` | JSON Schema (generated from Zod) for non-TypeScript consumers |
| `session-transcript-format.md` | Semantic reference — what each field means, how lines link together |

## Install

```bash
npm install claude-code-transcripts
```

Or reference it locally in a monorepo:

```json
{ "dependencies": { "claude-code-transcripts": "file:../claude-code/docs" } }
```

## Usage

### TypeScript — validate a transcript line

```ts
import { validateLine } from "claude-code-transcripts";

const obj = JSON.parse(jsonlLine);
const result = validateLine(obj);

if (result.success) {
  console.log(`Valid ${result.type} line`);
} else {
  console.error(result.error.issues);
}
```

### TypeScript — use individual schemas

```ts
import {
  AssistantLine,
  HumanPromptLine,
  ToolResultLine,
  BashToolUseResult,
} from "claude-code-transcripts";

// Parse and get full type inference
const assistant = AssistantLine.parse(obj);
console.log(assistant.message.content[0]);
```

### TypeScript — detect persisted output

```ts
import { isPersistedOutput, parsePersistedOutput } from "claude-code-transcripts";

if (isPersistedOutput(toolResultContent)) {
  const { filePath, sizeDescription, preview } = parsePersistedOutput(toolResultContent)!;
  // Read full output from filePath
}
```

### JSON Schema — non-TypeScript consumers

```python
import json

with open("node_modules/claude-code-transcripts/session-transcript.schema.json") as f:
    schema = json.load(f)

# Use with any JSON Schema validator (jsonschema, fastjsonschema, etc.)
```

Or import the subpath directly:

```ts
import schema from "claude-code-transcripts/schema.json" with { type: "json" };
```

### Stream a live session

```ts
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { validateLine } from "claude-code-transcripts";

const rl = createInterface({
  input: createReadStream(sessionPath, { encoding: "utf-8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  const obj = JSON.parse(line);
  const result = validateLine(obj);
  if (result.success && result.type === "assistant") {
    // Process assistant response...
  }
}
```

## Dev scripts

```bash
npm run build              # compile TypeScript → dist/
npm run validate           # validate schema against real ~/.claude transcripts
npm run generate:schema    # regenerate session-transcript.schema.json from Zod
```

## Minimum supported version

The schema targets Claude Code **v2.1.20+**. Earlier versions may have missing or differently-shaped fields and will fail `.strict()` validation.

## Schema design

- **`.strict()` on all line types** — unknown fields are rejected, not silently dropped
- **Manual dispatch in `validateLine()`** — user and system lines are routed to their specific schema directly (not via `z.union()` fallthrough) so `.strict()` violations surface immediately
- **`z.unknown()` only for truly open-ended content** — tool `input` objects and MCP/plugin results use `z.unknown()` or `.passthrough()`. All Anthropic-defined fields use specific types.

See [session-transcript-format.md](./session-transcript-format.md) for full semantic documentation.
