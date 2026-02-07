# Claude Code Session Transcripts — Semantic Reference

This document explains the *meaning and behavior* of Claude Code's JSONL session transcripts. For the structural type definitions, see [`session-transcript.schema.ts`](./session-transcript.schema.ts).

**Minimum supported version**: v2.1.20+. The schema uses `.strict()` validation and will reject unknown fields. Earlier versions may have missing or differently-shaped fields.

Documented by analyzing ~155k lines across ~1,130 real transcript files.

---

## File Layout

```
~/.claude/
├── projects/
│   └── <encoded-project>/                    # e.g. -Users-David-Documents-myproject
│       ├── sessions-index.json               # index of all sessions for this project
│       ├── <session-uuid>.jsonl              # main transcript
│       └── <session-uuid>/
│           ├── subagents/
│           │   └── agent-<id>.jsonl          # subagent transcripts (same format)
│           ├── tool-results/
│           │   └── toolu_<id>.txt            # large tool outputs stored externally
│           └── session-memory/
│               └── summary.md                # auto-generated session memory
├── plans/
│   └── <slug>.md                             # plan mode artifacts
└── history.jsonl                             # global prompt history
```

**Project directory encoding**: absolute path with `/` → `-` and a leading `-`.

**Session cleanup**: sessions are deleted after 30 days by default. Set `"cleanupPeriodDays": 99999` in `~/.claude/settings.json` to retain indefinitely.

---

## How to Read a Transcript

A `.jsonl` transcript is a flat append-only log. Each line is one JSON object with a `type` field. Lines are written in real-time as the session progresses — you can `tail -f` a live session.

The 7 line types, in the order they typically appear:

| Type | Role | Frequency |
|------|------|-----------|
| `summary` | Session title for the UI session picker | Top of file; one per compaction/branch |
| `file-history-snapshot` | Checkpoint for undo | Before each human turn |
| `user` | Human prompts AND tool results | Every user input + every tool response |
| `assistant` | Claude's response (one line per content block) | Most frequent during tool use |
| `system` | Metadata events | Between turns |
| `progress` | Real-time status updates | During long-running tool execution |
| `queue-operation` | Background task lifecycle | When async tasks start/finish |

---

## Message Chain

Every line has a `uuid`. Lines link via `parentUuid` to form a singly-linked list representing the conversation history. A conversation always starts with a `user` line whose `parentUuid` is `null`.

```
user prompt        parentUuid: null
  └─ assistant     parentUuid → user          (thinking block)
       └─ assistant  parentUuid → thinking    (tool_use block)
            └─ user    parentUuid → tool_use  (tool_result)
                 └─ assistant                 (text response)
                      └─ system               (turn_duration)
```

### Why assistant messages produce multiple lines

A single API call to Claude generates multiple content blocks (thinking, text, tool_use). Each block is written as a **separate JSONL line** as it streams in. All lines from one API call share the same `message.id` and `requestId`, but each gets its own `uuid` and chains to the previous via `parentUuid`.

The `stop_reason` field is `null` on all lines except the very last one from that API call, where it becomes `"end_turn"` (conversation pause) or `"tool_use"` (Claude wants to call a tool).

### Linking tool calls to their results

When Claude calls a tool, the flow is:

1. **Assistant line** with a `tool_use` content block containing `id: "toolu_..."` and `name: "Bash"`
2. **User line** with `message.content` as an array of `tool_result` objects, where `tool_use_id` matches the `id` from step 1

The user/tool-result line also has:
- `sourceToolAssistantUUID`: points to the assistant line that made the call
- `toolUseResult`: a parsed, structured version of the tool output (shape varies by tool — see schema)

---

## User Line Variants

All three variants share `type: "user"`. Distinguish them by `message.content`:

### Human prompt (`message.content` is a string)

The actual text the user typed. Carries session metadata:
- `permissionMode`: the permission level at time of message (`"default"`, `"plan"`, `"acceptEdits"`, etc.)
- `thinkingMetadata`: controls extended thinking (`maxThinkingTokens` in v2.1.15+)
- `todos`: snapshot of the todo list at message time
- `planContent`: (v2.1.22+) present on "Implement the following plan:" messages, contains just the plan markdown
- `imagePasteIds`: numeric indices referencing image blocks. Rarely meaningful here — when images are present, `message.content` becomes an array, routing the line to `RichContentLine` instead. Retained in the schema as a safeguard.

### Tool result (`message.content` is array of `tool_result`)

The result of a tool execution. The `message.content` array follows the Anthropic API format (`tool_result` blocks with `tool_use_id`). The `toolUseResult` field contains the same information in a structured, tool-specific shape (see the Zod schema for all 20+ tool result types).

For **MCP/plugin tools**, `toolUseResult` is an array of MCP content blocks (per the [MCP spec](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)) rather than a structured object. The schema supports all 5 MCP content types: `text`, `image`, `audio`, `resource_link`, and `resource` (embedded). Each may carry optional `annotations` (`audience`, `priority`, `lastModified`). For non-MCP tools whose result shape isn't recognized, the catch-all `ExternalToolUseResult` (open-ended object) applies.

#### Tool result content variants

Each `tool_result` block's `content` field takes one of two forms, modeled as distinct Zod schemas:

| Schema | `content` type | When used |
|--------|---------------|-----------|
| `InlineToolResultBlock` | `string` | Output small enough to include directly |
| `PersistedToolResultBlock` | `PersistedOutputType` (transformed) | Output replaced with a `<persisted-output>` wrapper |

The `ToolResultBlock` union tries `PersistedToolResultBlock` first (checking for the wrapper prefix), then falls through to `InlineToolResultBlock` for plain strings.

After Zod parsing, a `PersistedToolResultBlock`'s `content` is automatically transformed from the raw wrapper string into a structured object:

```ts
{ sizeDescription: "105.1KB", filePath: "/absolute/path/to/tool-results/toolu_XXX.txt", preview: "..." }
```

The standalone helpers `isPersistedOutput(content)` and `parsePersistedOutput(content)` are also exported for use outside of Zod validation (e.g. working with raw JSON without parsing through the schema).

#### Large output handling and `tool-results/*.txt`

Every tool result is persisted to `<session-uuid>/tool-results/<tool-use-id>.txt` as plain text, regardless of size. This creates a durable record of all tool output for the session.

For large outputs, the `content` field inside the `tool_result` block (which is what Claude sees in its context window) is replaced with a `<persisted-output>` wrapper:

```
<persisted-output>
Output too large (105.1KB). Full output saved to: /absolute/path/to/tool-results/toolu_XXX.txt

Preview (first 2KB):
[first ~2KB of the actual output]
...
</persisted-output>
```

Key details:
- The **`toolUseResult` field is never truncated** — it always contains the full structured result (e.g. the complete `stdout` for Bash, complete `content` for Grep). This is the authoritative data.
- Only `message.content` (the string in the API conversation) gets the truncated preview. This means Claude sees a summary + preview, but the full data is available to any tool that reads the `.txt` file.
- The most common tools that trigger large output persistence are **Grep** (~50%), **Bash** (~46%), and **Read** (~2%).
- Of ~1,161 tool-result `.txt` files observed, only ~103 were large enough to trigger the `<persisted-output>` wrapper. The rest store normal-sized output and the JSONL `content` field contains the full text inline.

### Rich content (`message.content` is array of `text`/`image`)

Multipart messages containing pasted text or images. These look like API content block arrays but aren't tool results — they have no `toolUseResult`.

Rich content lines may optionally carry:
- `sourceToolAssistantUUID`: links to an assistant line for provenance. This appears on subagent-injected context lines that need to track which assistant turn they relate to, but aren't `ToolResultLine`s (they carry no `toolUseResult` — the structured result lives only on the actual tool result line).
- `thinkingMetadata`, `todos`, `permissionMode`: present when a human prompt includes pasted images (which makes `message.content` an array, routing it here instead of to `HumanPromptLine`)
- `imagePasteIds`: numeric indices referencing which image blocks were pasted

---

## Assistant Lines

Assistant lines contain Claude's response from a single API call. See [Why assistant messages produce multiple lines](#why-assistant-messages-produce-multiple-lines) for how streaming works.

When an API call fails, Claude Code may inject a **synthetic error message** as an assistant line instead of a real model response. These carry additional fields:
- `isApiErrorMessage`: `true` when the message is a synthetic error notification (the `message` content is a human-readable error description, not a real model output)
- `error`: categorized error type — `"rate_limit"`, `"unknown"`, `"invalid_request"`, or `"authentication_failed"`
- `apiError`: (v2.1.23+) more granular error classifier (e.g. `"max_output_tokens"`)

---

## System Line Subtypes

System lines carry metadata events. The `subtype` field determines the shape:

| Subtype | Meaning |
|---------|---------|
| `turn_duration` | Marks the end of a turn. `durationMs` is wall-clock time for the entire turn. |
| `api_error` | An API call failed. Contains `error`/`cause` details and retry info (`retryInMs`, `retryAttempt`, `maxRetries`). |
| `compact_boundary` | The conversation was compacted (context window management). `compactMetadata` has token counts. Subsequent messages may reference a `logicalParentUuid` bridging the gap. |
| `microcompact_boundary` | A lighter compaction pass. `microcompactMetadata` contains `trigger` (e.g. `"auto"`) and token counts. |
| `local_command` | A slash command was invoked (e.g. `/skills`). The `content` field has the command name and args in XML format. |

---

## Progress Line Subtypes

Progress lines provide real-time feedback during tool execution. They are **not part of the conversation chain** — they exist for UI display only. Each progress line carries the same envelope fields as other line types (`cwd`, `gitBranch`, `sessionId`, `version`, `userType`, `slug`, `agentId`) in addition to the progress-specific fields (`data`, `toolUseID`, `parentToolUseID`). The `data.type` field determines the shape:

| `data.type` | When it appears |
|-------------|-----------------|
| `bash_progress` | Streaming output from a running Bash command (`output`, `elapsedTimeSeconds`) |
| `hook_progress` | A hook (pre/post tool use) is executing |
| `mcp_progress` | An MCP server tool is running (`serverName`, `toolName`, `status`) |
| `waiting_for_task` | Waiting for a background Task agent to complete |
| `query_update` | WebSearch is refining its query |
| `search_results_received` | WebSearch results arrived (`resultCount`) |
| `agent_progress` | A Task subagent is reporting intermediate state |

---

## Queue Operations

Background tasks (launched via `Task` tool with `run_in_background: true`) produce lifecycle events:

- `operation: "enqueue"` with `content` containing an XML `<task-notification>` (task-id, output-file, status, summary)
- `operation: "dequeue"` with no `content` — the task was picked up

---

## Plan Mode

Plan mode is a restricted execution mode where Claude can only write to a designated plan file. It has two distinct flows in the logs:

### Flow 1: Plan and implement in the same session

```
user   permissionMode: "plan"          ← user enters plan mode
         "let's write a plan for..."
assistant                               ← Claude writes to ~/.claude/plans/<slug>.md
         tool_use: Write
assistant
         tool_use: ExitPlanMode { plan: "# My Plan...", allowedPrompts: [...] }
user   tool_result                      ← user approves
         "User has approved your plan. You can now start coding."
         toolUseResult: { filePath: "~/.claude/plans/<slug>.md", isAgent: false, plan: "..." }
assistant                               ← implementation begins immediately
         "Plan approved. Let me start..."
```

### Flow 2: Plan in one session, implement in a new one

When the user exits plan mode and starts a fresh session, Claude Code synthesizes the first user message:

```
user   parentUuid: null, permissionMode: ""
         message.content: "Implement the following plan:\n\n<full plan markdown>\n\n
           If you need specific details... read the full transcript at:
           ~/.claude/projects/.../<planning-session-uuid>.jsonl"
         planContent?: "<full plan markdown>"    ← v2.1.22+
```

Key observations:
- The **entire plan text** is pasted inline into the user message — no file reference is used at runtime
- A **transcript path** to the planning session is appended, giving Claude a way to look up detailed context
- The `planContent` field (v2.1.22+) contains just the plan markdown, separate from the wrapper text
- The implementation session has **no special type or flag** — it looks like a normal session whose first message starts with "Implement the following plan:"

### Plan files on disk

Plan files live at `~/.claude/plans/<slug>.md` where `<slug>` matches the session slug (e.g. `elegant-snuggling-phoenix`). These are the markdown files Claude writes during plan mode. They persist on disk independently of the session transcript.

### ExitPlanMode rejection

If the user rejects the plan, the tool result contains `"User rejected tool use"` and no `filePath`/`plan` fields. The session typically ends or the user provides new instructions.

---

## Subagent Transcripts

When Claude uses the `Task` tool, it spawns a subagent that runs in a child process. The subagent's conversation is logged to a separate file:

```
<session-uuid>/subagents/agent-<id>.jsonl
```

Subagent transcripts use the **same JSONL format** as main sessions, with these differences:
- `isSidechain: true` on all lines
- `agentId` field is present instead of `slug`
- The first lines may include orphaned tool results from the parent context (with `parentUuid` pointing to UUIDs in the parent transcript)

The parent session sees the subagent's final output as a `TaskToolUseResult` (sync) or `TaskAsyncToolUseResult` (async) on the tool result line.

---

## Context Compaction

When the conversation approaches the context window limit, Claude Code compacts the history. This is visible in the logs as:

1. A `system` line with `subtype: "microcompact_boundary"` or `"compact_boundary"`
2. The metadata includes pre/post token counts and the trigger reason
3. For full compaction, a `logicalParentUuid` field bridges the gap to the pre-compaction conversation
4. A new `summary` line may be written at the top of the file

After compaction, earlier messages are summarized and compressed. The JSONL file retains the full history (nothing is deleted), but Claude only sees the compacted version in its context window.

When a session is continued after running out of context, Claude Code injects a **continuation summary** as a `user` line with `isVisibleInTranscriptOnly: true` and `isCompactSummary: true`. The `message.content` starts with "This session is being continued from a previous conversation that ran out of context." followed by a detailed summary of the prior conversation.

---

## Session Index

Each project directory contains a `sessions-index.json` that catalogs all sessions:

```json
{
  "version": 1,
  "entries": [{
    "sessionId": "a0440012-...",
    "summary": "Lightweight TypeScript API Client Design",
    "firstPrompt": "in this new project, we will use axios...",
    "messageCount": 8,
    "created": "2026-01-22T07:12:06.891Z",
    "modified": "2026-01-22T07:19:58.498Z",
    "gitBranch": "",
    "projectPath": "/Users/David/Documents/project"
  }],
  "originalPath": "/Users/David/Documents/project"
}
```

This powers the `claude --resume` session picker and the `/sessions` command.

---

## Global History

`~/.claude/history.jsonl` contains one line per prompt across all projects. Each entry has:
- `display`: the prompt text
- `timestamp`: Unix epoch milliseconds
- `project`: absolute path to the project directory
- `pastedContents`: map of pasted file contents (usually `{}`)

This powers the prompt history / autocomplete in the CLI.

---

## Common Fields

Most lines (user, assistant, system, progress) share these fields:

| Field | Meaning |
|-------|---------|
| `uuid` | Unique ID for this JSONL line |
| `parentUuid` | Links to the previous line in the conversation chain. `null` for the first message. |
| `sessionId` | Session UUID (matches the `.jsonl` filename) |
| `timestamp` | ISO 8601 timestamp of when the line was written |
| `cwd` | Working directory at time of message |
| `gitBranch` | Current git branch |
| `version` | Claude Code version (e.g. `"2.1.34"`) |
| `isSidechain` | `false` for main session, `true` for subagent transcripts |
| `userType` | Always `"external"` |
| `slug` | Human-readable session name (main sessions, v2.1.17+) |
| `agentId` | Short identifier (subagents only, e.g. `"a49cb76"`) |

User lines additionally have:

| Field | Meaning |
|-------|---------|
| `isMeta` | `true` for system-injected user messages (not typed by the human) |
| `sourceToolUseID` | Tool use ID that triggered this user message |
| `isVisibleInTranscriptOnly` | `true` for compaction continuation summaries (not sent to the API) |
| `isCompactSummary` | `true` for compaction continuation summaries (co-occurs with `isVisibleInTranscriptOnly`) |

---

## Version History

| Version | Changes |
|---------|---------|
| 2.1.2 | `thinkingMetadata` uses `{ level, disabled, triggers }` format |
| 2.1.15+ | `thinkingMetadata` switches to `{ maxThinkingTokens }` format |
| 2.1.17+ | `slug` field appears on most messages |
| 2.1.20+ | **Minimum supported version for this schema.** `sourceToolAssistantUUID` reliably present on all tool result lines. |
| 2.1.22+ | `planContent` field on plan implementation messages |
| 2.1.23+ | `apiError` field on synthetic error assistant lines |
| 2.1.34 | `permissionMode` on user messages; `inference_geo` and `server_tool_use` in usage |
