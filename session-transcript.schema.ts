/**
 * Claude Code JSONL Session Transcript — Zod Schema
 *
 * Source-of-truth schema for validating `.jsonl` session transcript lines.
 * Run `npx tsx validate-transcript.ts` to check against real session data.
 *
 * See session-transcript-format.md for full documentation.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Type 1: summary
// ---------------------------------------------------------------------------

/** Session title for the UI session picker. Written at the top of the file; a new one is added after each compaction. */
export const SummaryLine = z.object({
  type: z.literal("summary"),
  /** Human-readable session title (e.g. "Lightweight TypeScript API Client Design"). */
  summary: z.string(),
  /** UUID of the most recent message when this summary was written. */
  leafUuid: z.string(),
});

// ---------------------------------------------------------------------------
// Type 2: file-history-snapshot
// ---------------------------------------------------------------------------

/** Backup record for a single tracked file in the undo system. */
export const FileBackupEntry = z.object({
  /** Filename of the backup copy, or `null` if the file didn't exist yet. */
  backupFileName: z.string().nullable(),
  /** ISO 8601 timestamp of when the backup was taken. */
  backupTime: z.string(),
  /** Monotonically increasing version counter for this file. */
  version: z.number(),
});

/** Point-in-time snapshot of all tracked file backups, used for undo. */
export const FileHistorySnapshot = z.object({
  /** UUID of the message this snapshot corresponds to. */
  messageId: z.string(),
  /** Map of absolute file paths to their backup entries. */
  trackedFileBackups: z.record(z.string(), FileBackupEntry),
  /** ISO 8601 timestamp of the snapshot. */
  timestamp: z.string(),
});

/**
 * Checkpoint for the file undo system. Written before each human turn so that
 * file changes can be reverted to any previous state.
 */
export const FileHistorySnapshotLine = z.object({
  type: z.literal("file-history-snapshot"),
  /** UUID of the message this snapshot corresponds to. */
  messageId: z.string(),
  /** The full snapshot of tracked file backups. */
  snapshot: FileHistorySnapshot,
  /** `true` if this updates an existing snapshot rather than creating a new one. */
  isSnapshotUpdate: z.boolean(),
});

// ---------------------------------------------------------------------------
// Type 3: user (human prompts + tool results)
// ---------------------------------------------------------------------------

/** Extended thinking configuration at the time of a user prompt. */
export const ThinkingMetadata = z.object({
  /** Maximum tokens allocated for extended thinking. */
  maxThinkingTokens: z.number(),
});

// -- Persisted output (large tool results stored externally) --

/**
 * Parsed representation of a `<persisted-output>` wrapper.
 *
 * When a tool result is too large for inline JSONL, `message.content` is replaced
 * with this XML-like wrapper. The full output is always available via:
 *   1. The `toolUseResult` field on the parent user line (never truncated)
 *   2. The `.txt` file at `filePath`
 *
 * All tool results are written to `<session>/tool-results/<tool-use-id>.txt`
 * regardless of size. Only large outputs receive the wrapper in `message.content`.
 */
export const PersistedOutput = z.object({
  sizeDescription: z.string(),
  filePath: z.string(),
  preview: z.string(),
});

export type PersistedOutputType = z.infer<typeof PersistedOutput>;

const PERSISTED_OUTPUT_RE =
  /^<persisted-output>\nOutput too large \(([^)]+)\)\. Full output saved to: (.+?)\n\nPreview \(first [^)]+\):\n([\s\S]*?)\n<\/persisted-output>$/;

/** Parse a `<persisted-output>` wrapper string into its components, or return null. */
export function parsePersistedOutput(
  content: string
): PersistedOutputType | null {
  const m = content.match(PERSISTED_OUTPUT_RE);
  if (!m) return null;
  return {
    sizeDescription: m[1],
    filePath: m[2],
    preview: m[3],
  };
}

/** Returns true if the content string is a `<persisted-output>` wrapper. */
export function isPersistedOutput(content: string): boolean {
  return content.startsWith("<persisted-output>\n");
}

// -- Content block types that can appear in user message.content arrays --

/**
 * Tool result whose content was replaced with a `<persisted-output>` wrapper
 * because the output was too large for inline JSONL (~2 KB preview kept).
 *
 * The `content` field is **transformed** by the schema: after parsing, it
 * contains a structured `PersistedOutputType` (`{ sizeDescription, filePath,
 * preview }`) rather than the raw wrapper string.
 */
export const PersistedToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z
    .string()
    .refine(isPersistedOutput)
    .transform((s) => parsePersistedOutput(s)!),
  is_error: z.boolean().optional(),
});

/**
 * Tool result with inline string content — the full output was small enough
 * to include directly in the JSONL line.
 */
export const InlineToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
});

/** Plain text content block in a user message. */
export const UserTextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/** Base64-encoded image content block in a user message (e.g. pasted screenshot). */
export const UserImageBlock = z.object({
  type: z.literal("image"),
  source: z.object({
    /** Source type (e.g. `"base64"`). */
    type: z.string(),
    /** MIME type (e.g. `"image/png"`). */
    media_type: z.string(),
    /** Base64-encoded image data. */
    data: z.string(),
  }),
});

/** Reference to a deferred tool, returned by the ToolSearch tool. */
export const ToolReferenceBlock = z.object({
  type: z.literal("tool_reference"),
  tool_name: z.string(),
});

/**
 * Tool result with structured array content — multi-block responses containing
 * text blocks (subagent output), image blocks (visual tool results), and/or
 * tool reference blocks (ToolSearch results).
 */
export const ArrayToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.array(z.union([UserTextBlock, UserImageBlock, ToolReferenceBlock])),
  is_error: z.boolean().optional(),
});

/**
 * Union of tool result content variants.
 *
 * Order matters: `PersistedToolResultBlock` is tried first (the refine rejects
 * non-wrapper strings), then `InlineToolResultBlock` (any string), then
 * `ArrayToolResultBlock`.
 */
export const ToolResultBlock = z.union([
  PersistedToolResultBlock,
  InlineToolResultBlock,
  ArrayToolResultBlock,
]);

/** Any content block that can appear in a user message's `content` array. */
export const UserContentBlock = z.union([
  ToolResultBlock,
  UserTextBlock,
  UserImageBlock,
]);

// -- toolUseResult shapes (built-in tools) --

export const BashToolUseResult = z.object({
  /** Standard output from the command. */
  stdout: z.string(),
  /** Standard error from the command. */
  stderr: z.string(),
  /** Whether the command was interrupted (e.g. timeout or user cancel). */
  interrupted: z.boolean(),
  /** Whether the output is an image (e.g. screenshot commands). */
  isImage: z.boolean(),
  /** How to interpret the return code (e.g. `"status"` for test commands). */
  returnCodeInterpretation: z.string().optional(),
  /** ID of the background task, if the command was run with `run_in_background`. */
  backgroundTaskId: z.string().optional(),
  /** `true` if the command type inherently produces no output (e.g. `mv`, `mkdir`). */
  noOutputExpected: z.boolean().optional(),
});

export const ReadTextToolUseResult = z.object({
  type: z.literal("text"),
  file: z.object({
    filePath: z.string(),
    /** The file content (possibly truncated by offset/limit). */
    content: z.string(),
    /** Number of lines returned. */
    numLines: z.number(),
    /** 1-based line number where reading started. */
    startLine: z.number(),
    /** Total number of lines in the file. */
    totalLines: z.number(),
  }),
});

export const ReadImageToolUseResult = z.object({
  type: z.literal("image"),
  file: z.object({
    /** Base64-encoded image data. */
    base64: z.string(),
  }),
});

export const ReadToolUseResult = z.union([
  ReadTextToolUseResult,
  ReadImageToolUseResult,
]);

export const GlobToolUseResult = z.object({
  /** Matched file paths, sorted by modification time. */
  filenames: z.array(z.string()),
  /** How long the search took. */
  durationMs: z.number(),
  /** Number of files matched. */
  numFiles: z.number(),
  /** Whether results were truncated due to too many matches. */
  truncated: z.boolean(),
});

export const GrepToolUseResult = z.object({
  /** Matched file paths. */
  filenames: z.array(z.string()),
  /** Output mode used: `"content"`, `"files_with_matches"`, or `"count"`. */
  mode: z.string(),
  /** Number of files with matches. */
  numFiles: z.number(),
  /** Matching content lines (only in `"content"` mode). */
  content: z.string().optional(),
  /** Number of output lines (only in `"content"` mode). */
  numLines: z.number().optional(),
  /** Total number of matches found. */
  numMatches: z.number().optional(),
  /** The `head_limit` that was applied, if any. */
  appliedLimit: z.number().optional(),
});

/** A single hunk from a unified diff, used in Edit and Write results. */
export const PatchHunk = z.object({
  /** Starting line in the original file. */
  oldStart: z.number(),
  /** Number of lines from the original file. */
  oldLines: z.number(),
  /** Starting line in the modified file. */
  newStart: z.number(),
  /** Number of lines in the modified file. */
  newLines: z.number(),
  /** Diff lines prefixed with `" "` (context), `"+"` (added), or `"-"` (removed). */
  lines: z.array(z.string()),
});

export const EditToolUseResult = z.object({
  filePath: z.string(),
  /** The string that was replaced. */
  oldString: z.string(),
  /** The replacement string. */
  newString: z.string(),
  /** Full content of the file before the edit. */
  originalFile: z.string(),
  /** Whether all occurrences were replaced (vs. just the first). */
  replaceAll: z.boolean(),
  /** Unified diff of the change. */
  structuredPatch: z.array(PatchHunk),
  /** Whether the user manually modified the result after the edit. */
  userModified: z.boolean(),
});

export const WriteToolUseResult = z.object({
  type: z.literal("create"),
  filePath: z.string(),
  /** The content that was written. */
  content: z.string(),
  /** Full content of the file before the write, or `null` if the file was newly created. */
  originalFile: z.string().nullable(),
  /** Unified diff of the change. */
  structuredPatch: z.array(PatchHunk),
});

export const TextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});

/**
 * Breakdown of prompt-cache write tokens by TTL tier.
 * `cache_creation_input_tokens = ephemeral_5m_input_tokens + ephemeral_1h_input_tokens`.
 */
export const CacheCreation = z.object({
  /** Tokens written to the 5-minute ephemeral cache (write cost: 1.25x base input price). */
  ephemeral_5m_input_tokens: z.number(),
  /** Tokens written to the 1-hour ephemeral cache (write cost: 2x base input price). */
  ephemeral_1h_input_tokens: z.number(),
});

/** Counts of server-side tool invocations made during the API call. */
export const ServerToolUse = z.object({
  web_search_requests: z.number(),
  web_fetch_requests: z.number(),
});

/** Token usage and billing metadata from an Anthropic API response. */
export const Usage = z.object({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
  cache_creation: CacheCreation.optional(),
  output_tokens: z.number(),
  /** Billing tier: `"standard"`, `"priority"`, or `"batch"`. `null` on synthetic messages. */
  service_tier: z.string().nullable().optional(),
  /** Where inference ran geographically (e.g. `"us"`, `"global"`). `null` on synthetic messages. */
  inference_geo: z.string().nullable().optional(),
  server_tool_use: ServerToolUse.optional(),
  /**
   * Per-iteration token breakdown (compaction beta `compact-2026-01-12`).
   * Each item is `{ type: "message" | "compaction", input_tokens, output_tokens, ... }`.
   * Empty array or `null` when compaction was not triggered.
   */
  iterations: z.array(z.unknown()).nullable().optional(),
  /** Inference speed: `"standard"` or `"fast"` (fast mode beta). `null` on synthetic messages. */
  speed: z.string().nullable().optional(),
});

export const TaskSyncToolUseResult = z.object({
  status: z.literal("completed"),
  /** The prompt that was sent to the subagent. */
  prompt: z.string(),
  /** Unique identifier for the subagent. */
  agentId: z.string(),
  /** The subagent's final text response. */
  content: z.array(TextBlock),
  /** Wall-clock duration of the subagent execution. */
  totalDurationMs: z.number(),
  /** Total tokens consumed by the subagent. */
  totalTokens: z.number(),
  /** Number of tool calls made by the subagent. */
  totalToolUseCount: z.number(),
  /** Aggregated token usage for the subagent. */
  usage: Usage,
});

export const TaskAsyncToolUseResult = z.object({
  isAsync: z.literal(true),
  status: z.literal("async_launched"),
  agentId: z.string(),
  /** Short description of the background task. */
  description: z.string(),
  prompt: z.string(),
  /** Path to a file where the subagent's output will be written. */
  outputFile: z.string(),
});

export const TaskToolUseResult = z.union([
  TaskSyncToolUseResult,
  TaskAsyncToolUseResult,
]);

export const AgentTaskInfo = z.object({
  task_id: z.string(),
  /** Always `"agent"` for subagent tasks. */
  task_type: z.string(),
  /** e.g. `"completed"`, `"running"`, `"failed"`. */
  status: z.string(),
  description: z.string(),
  /** The subagent's accumulated output text. */
  output: z.string(),
  /** The prompt that was sent to the subagent. */
  prompt: z.string(),
  /** Final result summary from the subagent. */
  result: z.string(),
});

export const BackgroundTaskInfo = z.object({
  task_id: z.string(),
  /** Always `"bash"` for background shell tasks. */
  task_type: z.string(),
  status: z.string(),
  description: z.string(),
  /** The command's accumulated stdout/stderr. */
  output: z.string(),
  /** Process exit code, or `null` if still running. */
  exitCode: z.number().nullable(),
});

export const TaskInfo = z.union([AgentTaskInfo, BackgroundTaskInfo]);

export const TaskOutputToolUseResult = z.object({
  /** e.g. `"success"`, `"not_found"`. */
  retrieval_status: z.string(),
  task: TaskInfo,
});

export const TaskCreateToolUseResult = z.object({
  task: z.object({
    id: z.string(),
    subject: z.string(),
  }).strict(),
});

export const TaskUpdateToolUseResult = z.object({
  success: z.boolean(),
  taskId: z.string(),
  /** Names of fields that were changed. */
  updatedFields: z.array(z.string()),
  /** Present when the task's status was changed. */
  statusChange: z
    .object({ from: z.string(), to: z.string() })
    .optional(),
});

export const TaskListEntry = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.string(),
  /** IDs of tasks that must complete before this one can start. */
  blockedBy: z.array(z.string()),
});

export const TaskListToolUseResult = z.object({
  tasks: z.array(TaskListEntry),
});

export const TaskStopToolUseResult = z.object({
  message: z.string(),
  task_id: z.string(),
  task_type: z.string(),
});

export const WebFetchToolUseResult = z.object({
  /** Response body size in bytes. */
  bytes: z.number(),
  /** HTTP status code. */
  code: z.number(),
  /** HTTP status text (e.g. `"OK"`, `"Not Found"`). */
  codeText: z.string(),
  durationMs: z.number(),
  /** The fetched content (typically converted to markdown). */
  result: z.string(),
  url: z.string(),
});

export const WebSearchResultLink = z.object({
  title: z.string(),
  url: z.string(),
});

export const WebSearchStructuredResult = z.object({
  tool_use_id: z.string(),
  content: z.array(WebSearchResultLink),
});

export const WebSearchResultItem = z.union([
  z.string(),
  WebSearchStructuredResult,
]);

export const WebSearchToolUseResult = z.object({
  durationSeconds: z.number(),
  /** The search query that was executed. */
  query: z.string(),
  results: z.array(WebSearchResultItem),
});

export const QuestionOption = z.object({
  label: z.string(),
  description: z.string(),
});

export const QuestionSpec = z.object({
  question: z.string(),
  /** Header text displayed above the question. */
  header: z.string(),
  /** Whether the user can select multiple options. */
  multiSelect: z.boolean(),
  options: z.array(QuestionOption),
});

export const AskUserQuestionToolUseResult = z.object({
  questions: z.array(QuestionSpec),
  answers: z.record(z.string(), z.string()),
});

export const SkillToolUseResult = z.object({
  success: z.boolean(),
  /** The slash command name (e.g. `"commit"`, `"review-pr"`). */
  commandName: z.string(),
  /** Tools that the skill is allowed to use during execution. */
  allowedTools: z.array(z.string()).optional(),
});

export const ExitPlanModeToolUseResult = z.object({
  /** Path to the plan file (e.g. `~/.claude/plans/<slug>.md`). */
  filePath: z.string(),
  /** Whether this plan was created by a subagent. */
  isAgent: z.boolean(),
  /** The full plan markdown content. */
  plan: z.string(),
});


/** Result from an MCP server or plugin-provided tool (object shape). */
export const ExternalToolUseResult = z.record(z.string(), z.unknown());

// -- MCP content block types (per MCP spec 2025-11-25) --

/** Optional annotations on MCP content blocks and resources. */
export const McpAnnotations = z.object({
  audience: z.array(z.enum(["user", "assistant"])).optional(),
  priority: z.number().optional(),
  lastModified: z.string().optional(),
});

/** MCP text content block. */
export const McpTextContent = z.object({
  type: z.literal("text"),
  text: z.string(),
  annotations: McpAnnotations.optional(),
});

/** MCP image content block (base64-encoded). */
export const McpImageContent = z.object({
  type: z.literal("image"),
  /** Base64-encoded image data. */
  data: z.string(),
  mimeType: z.string(),
  annotations: McpAnnotations.optional(),
});

/** MCP audio content block (base64-encoded). */
export const McpAudioContent = z.object({
  type: z.literal("audio"),
  /** Base64-encoded audio data. */
  data: z.string(),
  mimeType: z.string(),
  annotations: McpAnnotations.optional(),
});

/** MCP resource link — a reference to an external resource by URI. */
export const McpResourceLink = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  annotations: McpAnnotations.optional(),
});

/** MCP embedded resource — inline text or blob content with a URI. */
export const McpEmbeddedResource = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    /** Text content (for text-based resources). */
    text: z.string().optional(),
    /** Base64-encoded binary content (for non-text resources). */
    blob: z.string().optional(),
    annotations: McpAnnotations.optional(),
  }),
  annotations: McpAnnotations.optional(),
});

/** Union of all MCP content block types (per MCP spec). */
export const McpContentBlock = z.discriminatedUnion("type", [
  McpTextContent,
  McpImageContent,
  McpAudioContent,
  McpResourceLink,
  McpEmbeddedResource,
]);

/** MCP tool result as a content-block array (raw MCP server response). */
export const McpToolUseResult = z.array(McpContentBlock);

/**
 * Union of all possible `toolUseResult` shapes on a tool result line.
 * The shape depends on which tool was called. MCP/plugin tools use the
 * catch-all `ExternalToolUseResult` (object) or `McpToolUseResult` (array).
 * Error results are plain strings.
 */
export const ToolUseResult = z.union([
  // Shell & filesystem
  BashToolUseResult,
  ReadToolUseResult,
  GlobToolUseResult,
  GrepToolUseResult,
  EditToolUseResult,
  WriteToolUseResult,
  // Task management
  TaskToolUseResult,
  TaskOutputToolUseResult,
  TaskCreateToolUseResult,
  TaskUpdateToolUseResult,
  TaskListToolUseResult,
  TaskStopToolUseResult,
  // Web
  WebFetchToolUseResult,
  WebSearchToolUseResult,
  // Interactive
  AskUserQuestionToolUseResult,
  SkillToolUseResult,
  ExitPlanModeToolUseResult,
  // Error (string)
  z.string(),
  // MCP / plugin tools — content-block array (raw MCP server response)
  McpToolUseResult,
  // MCP / plugin tools — object (must be last — catch-all)
  ExternalToolUseResult,
]);

// -- Shared user-line base --

/**
 * Fields shared by all three user line variants (HumanPromptLine, ToolResultLine, RichContentLine).
 * See session-transcript-format.md "Common Fields" for full semantics.
 */
const UserBase = {
  type: z.literal("user") as z.ZodLiteral<"user">,
  /** UUID of the previous line in the conversation chain, or `null` for the first message. */
  parentUuid: z.string().nullable(),
  /** `false` for main sessions, `true` for subagent transcripts. */
  isSidechain: z.boolean(),
  /** Always `"external"`. */
  userType: z.literal("external"),
  /** Working directory at the time of the message. */
  cwd: z.string(),
  /** Session UUID (matches the `.jsonl` filename). */
  sessionId: z.string(),
  /** Claude Code version (e.g. `"2.1.76"`). */
  version: z.string(),
  /** Current git branch (e.g. `"main"`). */
  gitBranch: z.string(),
  /** Unique ID for this JSONL line. */
  uuid: z.string(),
  /** ISO 8601 timestamp of when the line was written. */
  timestamp: z.string(),
  /** Human-readable session name (main sessions only, e.g. `"elegant-snuggling-phoenix"`). */
  slug: z.string().optional(),
  /** Short identifier for subagents (e.g. `"a49cb76"`). */
  agentId: z.string().optional(),
  /** `true` for system-injected user messages (not typed by the human). */
  isMeta: z.boolean().optional(),
  /** Tool use ID that triggered this user message. */
  sourceToolUseID: z.string().optional(),
  /** `true` for compaction continuation summaries (not sent to the API). */
  isVisibleInTranscriptOnly: z.boolean().optional(),
  /** `true` for compaction continuation summaries (co-occurs with `isVisibleInTranscriptOnly`). */
  isCompactSummary: z.boolean().optional(),
  /** Stable identifier for the user prompt that triggered this line. Absent on session-start local command lines. */
  promptId: z.string().uuid().optional(),
};

/**
 * A user-typed prompt. `message.content` is a plain string.
 * Carries session metadata like permission mode and thinking configuration.
 */
export const HumanPromptLine = z
  .object({
    ...UserBase,
    message: z.object({
      role: z.literal("user"),
      content: z.string(),
    }),
    /** Extended thinking configuration at the time of the prompt. */
    thinkingMetadata: ThinkingMetadata.optional(),
    /** Permission level: `"default"`, `"plan"`, `"acceptEdits"`, etc. */
    permissionMode: z.string().optional(),
    /** Plan markdown content (on "Implement the following plan:" messages, v2.1.22+). */
    planContent: z.string().optional(),
  })
  .strict();

/**
 * Structured content from MCP tool responses that declare an `outputSchema`.
 * The shape of `structuredContent` is defined by the MCP tool's output schema
 * and cannot be validated without querying the MCP server's `tools/list` endpoint.
 */
export const McpMeta = z.object({
  /** Arbitrary structured output from the MCP tool, conforming to its declared `outputSchema`. */
  structuredContent: z.record(z.string(), z.unknown()),
});

/**
 * Result of a tool execution. `message.content` is an array of `tool_result` blocks
 * following the Anthropic API format. `toolUseResult` contains the same data in a
 * structured, tool-specific shape.
 */
export const ToolResultLine = z
  .object({
    ...UserBase,
    message: z.object({
      role: z.literal("user"),
      content: z.array(ToolResultBlock),
    }),
    /** Structured tool output — shape varies by tool (see individual `*ToolUseResult` schemas). Never truncated. */
    toolUseResult: ToolUseResult,
    /** UUID of the assistant line that initiated the tool call. */
    sourceToolAssistantUUID: z.string(),
    /** Present only on MCP tool results that include structured content. */
    mcpMeta: McpMeta.optional(),
  })
  .strict();

/** User message with array content that isn't tool results (text blocks, images). */
export const RichContentLine = z
  .object({
    ...UserBase,
    message: z.object({
      role: z.literal("user"),
      content: z.array(UserContentBlock),
    }),
    sourceToolAssistantUUID: z.string().optional(),
    thinkingMetadata: ThinkingMetadata.optional(),
    permissionMode: z.string().optional(),
    imagePasteIds: z.array(z.number()).optional(),
  })
  .strict();

/**
 * Union of all user line variants. Distinguished by `message.content` shape:
 * - `string` → `HumanPromptLine`
 * - `tool_result[]` with `toolUseResult` → `ToolResultLine`
 * - `(text|image|tool_result)[]` → `RichContentLine`
 */
export const UserLine = z.union([HumanPromptLine, ToolResultLine, RichContentLine]);

// ---------------------------------------------------------------------------
// Type 4: assistant
// ---------------------------------------------------------------------------

/**
 * Extended thinking content block. Contains Claude's chain-of-thought reasoning.
 * The `signature` field is a cryptographic signature for tamper detection.
 */
export const ThinkingBlock = z.object({
  type: z.literal("thinking"),
  /** The model's chain-of-thought reasoning text. */
  thinking: z.string(),
  /** Cryptographic signature to verify the thinking block hasn't been modified. */
  signature: z.string(),
});

// -- Tool use input schemas (built-in tools) --

export const BashToolInput = z.object({
  /** The shell command to execute. */
  command: z.string(),
  /** Human-readable description of what the command does. */
  description: z.string().optional(),
  /** Timeout in milliseconds (max 600000). */
  timeout: z.number().optional(),
  /** Run the command in the background, returning a task ID for later retrieval. */
  run_in_background: z.boolean().optional(),
  /** Override sandbox mode to run without sandboxing. */
  dangerouslyDisableSandbox: z.boolean().optional(),
  /** Internal: tracks sed-like edits for file change detection. */
  _simulatedSedEdit: z
    .object({
      filePath: z.string(),
      newContent: z.string(),
    })
    .optional(),
});

export const ReadToolInput = z.object({
  /** Absolute path to the file to read. */
  file_path: z.string(),
  /** 1-based line number to start reading from. */
  offset: z.number().optional(),
  /** Maximum number of lines to read. */
  limit: z.number().optional(),
  /** Page range for PDF files (e.g. `"1-5"`). */
  pages: z.string().optional(),
});

export const WriteToolInput = z.object({
  file_path: z.string(),
  content: z.string(),
});

export const EditToolInput = z.object({
  file_path: z.string(),
  /** The exact text to find and replace. Must be unique in the file unless `replace_all` is set. */
  old_string: z.string(),
  /** The replacement text. */
  new_string: z.string(),
  /** Replace all occurrences (default: first only). */
  replace_all: z.boolean().optional(),
});

export const NotebookEditToolInput = z.object({
  notebook_path: z.string(),
  /** New cell source code or markdown. */
  new_source: z.string(),
  /** 1-based cell number to edit (for replace/delete). */
  cell_number: z.number().optional(),
  cell_type: z.enum(["code", "markdown"]).optional(),
  edit_mode: z.enum(["replace", "insert", "delete"]).optional(),
  /** Cell ID for precise targeting. */
  cell_id: z.string().optional(),
});

export const GlobToolInput = z.object({
  /** Glob pattern (e.g. `"**\/*.ts"`, `"src/**\/*.tsx"`). */
  pattern: z.string(),
  /** Directory to search in (defaults to cwd). */
  path: z.string().optional(),
});

export const GrepToolInput = z.object({
  /** Regular expression pattern to search for. */
  pattern: z.string(),
  /** File or directory to search in (defaults to cwd). */
  path: z.string().optional(),
  /** Glob pattern to filter files (e.g. `"*.js"`). Maps to `rg --glob`. */
  glob: z.string().optional(),
  /** File type filter (e.g. `"js"`, `"py"`). Maps to `rg --type`. */
  type: z.string().optional(),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
  /** Enable multiline mode where `.` matches newlines. */
  multiline: z.boolean().optional(),
  /** Limit output to first N lines/entries. */
  head_limit: z.number().optional(),
  /** Skip first N lines/entries before applying head_limit. */
  offset: z.number().optional(),
  /** Lines of context around each match (rg -C). */
  context: z.number().optional(),
  /** Lines to show after each match (rg -A). */
  "-A": z.number().optional(),
  /** Lines to show before each match (rg -B). */
  "-B": z.number().optional(),
  /** Alias for context (rg -C). */
  "-C": z.number().optional(),
  /** Case-insensitive search. */
  "-i": z.boolean().optional(),
  /** Show line numbers. */
  "-n": z.boolean().optional(),
});

export const TaskToolInput = z.object({
  /** The task description/prompt for the subagent. */
  prompt: z.string(),
  /** Agent type (e.g. `"general-purpose"`, `"Explore"`, `"Plan"`). */
  subagent_type: z.string(),
  /** Short (3-5 word) description for display. */
  description: z.string(),
  /** Model override for the subagent. */
  model: z.enum(["sonnet", "opus", "haiku"]).optional(),
  /** Launch the subagent in the background. */
  run_in_background: z.boolean().optional(),
  /** Agent ID to resume from a previous invocation. */
  resume: z.string().optional(),
  /** Maximum number of conversation turns for the subagent. */
  max_turns: z.number().optional(),
});

export const TaskOutputToolInput = z.object({
  task_id: z.string(),
  /** Block until the task completes. */
  block: z.boolean().optional(),
  /** Timeout in milliseconds when blocking. */
  timeout: z.number().optional(),
});

export const TaskCreateToolInput = z.object({
  subject: z.string(),
  description: z.string(),
  /** Display form of the task status. */
  activeForm: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const TaskGetToolInput = z.object({
  taskId: z.string(),
});

export const TaskUpdateToolInput = z.object({
  taskId: z.string(),
  status: z.string().optional(),
  subject: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Task IDs that this task blocks. */
  addBlocks: z.array(z.string()).optional(),
  /** Task IDs that must complete before this task can start. */
  addBlockedBy: z.array(z.string()).optional(),
});

export const TaskListToolInput = z.object({});

export const TaskStopToolInput = z.object({
  task_id: z.string().optional(),
  /** Legacy: shell ID for background Bash commands. */
  shell_id: z.string().optional(),
});

export const WebFetchToolInput = z.object({
  url: z.string(),
  /** Instructions for how to process the fetched content. */
  prompt: z.string(),
});

export const WebSearchToolInput = z.object({
  query: z.string(),
  /** Only return results from these domains. */
  allowed_domains: z.array(z.string()).optional(),
  /** Exclude results from these domains. */
  blocked_domains: z.array(z.string()).optional(),
});

export const AskUserQuestionInputOption = z.object({
  label: z.string(),
  description: z.string().optional(),
});

export const AskUserQuestionInputItem = z.object({
  question: z.string(),
  /** Header text displayed above the question. */
  header: z.string().optional(),
  options: z.array(AskUserQuestionInputOption),
  multiSelect: z.boolean().optional(),
});

export const AskUserQuestionToolInput = z.object({
  questions: z.array(AskUserQuestionInputItem),
  /** Pre-filled answers (for programmatic use). */
  answers: z.record(z.string(), z.string()).optional(),
  metadata: z
    .object({
      /** Where the question originated from. */
      source: z.string().optional(),
    })
    .optional(),
});

export const SkillToolInput = z.object({
  /** Skill name (e.g. `"commit"`, `"review-pr"`). */
  skill: z.string(),
  /** Arguments to pass to the skill. */
  args: z.string().optional(),
});

/** A tool+prompt pair allowed during plan implementation. */
export const ExitPlanModeAllowedPrompt = z.object({
  /** Tool name that is allowed. */
  tool: z.string(),
  /** Prompt describing the allowed action. */
  prompt: z.string(),
});

export const ExitPlanModeToolInput = z.object({
  /** The full plan markdown content. */
  plan: z.string().optional(),
  /** Tool+prompt pairs allowed during plan implementation. */
  allowedPrompts: z.array(ExitPlanModeAllowedPrompt).optional(),
  /** Push the plan to a remote session. */
  pushToRemote: z.boolean().optional(),
  remoteSessionId: z.string().optional(),
  remoteSessionUrl: z.string().optional(),
  remoteSessionTitle: z.string().optional(),
});

export const EnterPlanModeToolInput = z.object({});

// -- Fallback for MCP / plugin tools --

/** Input from an MCP server or plugin-provided tool (object shape). */
export const ExternalToolInput = z.record(z.string(), z.unknown());

// -- Tool name → input schema map --

/** Map of built-in tool names to their input Zod schemas, used by `ToolUseBlock.superRefine()`. */
export const toolInputSchemas: Record<string, z.ZodTypeAny> = {
  Bash: BashToolInput,
  Read: ReadToolInput,
  Write: WriteToolInput,
  Edit: EditToolInput,
  NotebookEdit: NotebookEditToolInput,
  Glob: GlobToolInput,
  Grep: GrepToolInput,
  Task: TaskToolInput,
  TaskOutput: TaskOutputToolInput,
  TaskCreate: TaskCreateToolInput,
  TaskGet: TaskGetToolInput,
  TaskUpdate: TaskUpdateToolInput,
  TaskList: TaskListToolInput,
  TaskStop: TaskStopToolInput,
  WebFetch: WebFetchToolInput,
  WebSearch: WebSearchToolInput,
  AskUserQuestion: AskUserQuestionToolInput,
  Skill: SkillToolInput,
  ExitPlanMode: ExitPlanModeToolInput,
  EnterPlanMode: EnterPlanModeToolInput,
};

// -- ToolUseBlock with name↔input correlation via .superRefine() --

/**
 * A tool call content block in an assistant message.
 * Uses `.superRefine()` to validate that `input` matches the schema
 * for the named tool (built-in tools only; MCP/external tools pass through).
 */
export const ToolUseBlock = z
  .object({
    type: z.literal("tool_use"),
    /** Unique ID for this tool call (e.g. `"toolu_01ABC..."`). Referenced by `tool_result.tool_use_id`. */
    id: z.string(),
    /** Tool name (e.g. `"Bash"`, `"Read"`, `"mcp__xcode__BuildProject"`). */
    name: z.string(),
    /** Tool-specific input parameters. Shape validated against `toolInputSchemas` for built-in tools. */
    input: z.record(z.string(), z.unknown()),
  })
  .superRefine((val, ctx) => {
    const schema = toolInputSchemas[val.name];
    if (schema) {
      const result = schema.safeParse(val.input);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            ...issue,
            path: ["input", ...issue.path],
          });
        }
      }
    }
    // Unknown tool names (MCP/external) pass through — no schema to check against
  });

/**
 * Redacted thinking block. Contains encrypted thinking content that cannot be read.
 * Appears when the API redacts safety-sensitive reasoning.
 */
export const RedactedThinkingBlock = z.object({
  type: z.literal("redacted_thinking"),
  /** Opaque encrypted data representing the redacted thinking. */
  data: z.string(),
});

/** Union of all content block types in an assistant message. */
export const ContentBlock = z.discriminatedUnion("type", [
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  RedactedThinkingBlock,
]);

/**
 * The Anthropic API message object inside an assistant line.
 * Multiple assistant JSONL lines may share the same `id` (one per streaming content block).
 */
export const AssistantMessage = z.object({
  /** Model identifier (e.g. `"claude-opus-4-6"`) or `"<synthetic>"` for client-generated messages. */
  model: z.string(),
  /** API message ID. Shared across all JSONL lines from the same API call. */
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  /** Content blocks produced by this API call (typically one per JSONL line). */
  content: z.array(ContentBlock),
  /** `null` on all lines except the last from an API call; then `"end_turn"` or `"tool_use"`. */
  stop_reason: z.string().nullable(),
  /** The stop sequence that was matched, or `null`. */
  stop_sequence: z.string().nullable(),
  usage: Usage,
});

/**
 * Claude's response from a single API call. Each streamed content block is written
 * as a separate JSONL line — all lines from one call share the same `message.id`.
 */
export const AssistantLine = z
  .object({
    type: z.literal("assistant"),
    parentUuid: z.string().nullable(),
    isSidechain: z.boolean(),
    userType: z.literal("external"),
    cwd: z.string(),
    sessionId: z.string(),
    version: z.string(),
    gitBranch: z.string(),
    uuid: z.string(),
    timestamp: z.string(),
    slug: z.string().optional(),
    agentId: z.string().optional(),
    message: AssistantMessage,
    /** Anthropic API request ID for tracing. */
    requestId: z.string().optional(),
    /** Error category on synthetic error messages: `"rate_limit"`, `"unknown"`, `"invalid_request"`, `"authentication_failed"`. */
    error: z.string().optional(),
    /** `true` when the message is a synthetic error notification, not a real model output. */
    isApiErrorMessage: z.boolean().optional(),
    /** Granular error classifier (e.g. `"max_output_tokens"`). v2.1.23+. */
    apiError: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Type 5: system
// ---------------------------------------------------------------------------

/** Base fields shared across all system subtypes. */
const SystemBase = {
  type: z.literal("system") as z.ZodLiteral<"system">,
  /** Discriminator for the system line shape (e.g. `"turn_duration"`, `"api_error"`). */
  subtype: z.string(),
  parentUuid: z.string().nullable(),
  isSidechain: z.boolean(),
  userType: z.literal("external"),
  cwd: z.string(),
  sessionId: z.string(),
  version: z.string(),
  gitBranch: z.string(),
  uuid: z.string(),
  timestamp: z.string(),
  slug: z.string().optional(),
  agentId: z.string().optional(),
  /** Log level (e.g. `"info"`, `"error"`). */
  level: z.string().optional(),
  isMeta: z.boolean().optional(),
  /** Content payload (e.g. slash command XML for `local_command` subtype). */
  content: z.string().optional(),
};

/** Marks the end of a turn. Written after each assistant response completes. */
export const TurnDurationSystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("turn_duration"),
    /** Wall-clock time for the entire turn in milliseconds. */
    durationMs: z.number(),
    isMeta: z.boolean(),
  })
  .strict();

// -- Undici / Node.js network error inner causes --

/** Undici `SocketError` — connection-level failure with a frozen snapshot of socket state. */
export const SocketErrorCause = z.object({
  /** Error name, typically `"SocketError"`. */
  name: z.string(),
  /** Undici error code, typically `"UND_ERR_SOCKET"`. */
  code: z.string(),
  socket: z.object({
    localAddress: z.string(),
    localPort: z.number(),
    bytesWritten: z.number(),
    bytesRead: z.number(),
  }).passthrough(),
});

/** Node.js/libuv system call error (e.g. DNS resolution or connection failure). */
export const SyscallErrorCause = z.object({
  /** POSIX error code (e.g. `"ECONNREFUSED"`, `"ENOTFOUND"`, `"ETIMEDOUT"`). */
  code: z.string(),
  /** Numeric errno from libuv (negative integer). */
  errno: z.number(),
  /** System call that failed (e.g. `"getaddrinfo"`, `"connect"`, `"read"`). */
  syscall: z.string(),
});

/** OpenSSL/TLS error during the SSL handshake. */
export const TlsErrorCause = z.object({
  code: z.string(),
  /** OpenSSL library name (e.g. `"SSL routines"`). */
  library: z.string(),
  /** Human-readable reason string. */
  reason: z.string(),
});

/** Union of low-level network error causes (socket, syscall, or TLS). */
export const NetworkErrorCause = z.union([
  SocketErrorCause,
  SyscallErrorCause,
  TlsErrorCause,
]);

// -- API error shapes --

/**
 * Anthropic API error response body.
 * Error types: `"invalid_request_error"` (400), `"authentication_error"` (401),
 * `"permission_error"` (403), `"rate_limit_error"` (429), `"api_error"` (500),
 * `"overloaded_error"` (529).
 */
export const AnthropicApiErrorDetail = z.object({
  type: z.literal("error"),
  error: z.object({
    /** Machine-readable error category (e.g. `"overloaded_error"`, `"rate_limit_error"`). */
    type: z.string(),
    message: z.string(),
  }),
  request_id: z.string(),
});

/** A network-level failure (no HTTP response received). Wraps the underlying Node.js error cause. */
export const NetworkApiError = z.object({
  cause: z.object({
    cause: NetworkErrorCause.optional(),
  }),
});

/** A full HTTP-level Anthropic API error (response received with error status). */
export const AnthropicApiError = z.object({
  /** HTTP status code (e.g. 429, 500, 529). */
  status: z.number(),
  /** Response headers. */
  headers: z.record(z.string(), z.unknown()),
  /** Anthropic request ID for support tracing. */
  requestID: z.string(),
  error: AnthropicApiErrorDetail,
});

/** An error with no details (empty object). */
export const EmptyError = z.object({}).strict();

/** Union of API error shapes: network failure, HTTP error, or empty. */
export const ApiError = z.union([
  NetworkApiError,
  AnthropicApiError,
  EmptyError,
]);

/** The inner cause of an API error — either a network error or empty. */
export const ApiErrorCause = z.union([
  z.object({ cause: NetworkErrorCause }),
  EmptyError,
]);

/** An API call failed. Contains error details and retry information. */
export const ApiErrorSystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("api_error"),
    /** The error response (HTTP error, network failure, or empty). */
    error: ApiError.optional(),
    /** The underlying cause of a network-level error. */
    cause: ApiErrorCause.optional(),
    /** Milliseconds until the next retry attempt. */
    retryInMs: z.number().optional(),
    /** Current retry attempt number (0-based). */
    retryAttempt: z.number().optional(),
    /** Maximum number of retries configured. */
    maxRetries: z.number().optional(),
  })
  .strict();

/** Metadata about a full context compaction event. */
export const CompactMetadata = z.object({
  /** What triggered compaction (e.g. `"auto"`, `"manual"`). */
  trigger: z.string(),
  /** Token count before compaction. */
  preTokens: z.number(),
});

/** Metadata about a lightweight microcompaction event. */
export const MicrocompactMetadata = z.object({
  /** What triggered microcompaction (e.g. `"auto"`). */
  trigger: z.string(),
  /** Token count before microcompaction. */
  preTokens: z.number(),
  /** Number of tokens saved by the microcompaction. */
  tokensSaved: z.number(),
  /** Tool use IDs whose results were compacted. */
  compactedToolIds: z.array(z.string()),
  /** UUIDs of attachments that were cleared. */
  clearedAttachmentUUIDs: z.array(z.string()),
});

/** The conversation was fully compacted (context window management). */
export const CompactBoundarySystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("compact_boundary"),
    compactMetadata: CompactMetadata.optional(),
    /** UUID bridging the gap to the pre-compaction conversation. */
    logicalParentUuid: z.string().optional(),
  })
  .strict();

/** A lightweight compaction pass that removes individual tool results. */
export const MicrocompactBoundarySystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("microcompact_boundary"),
    microcompactMetadata: MicrocompactMetadata.optional(),
  })
  .strict();

/** A slash command was invoked locally (e.g. `/skills`). The `content` field has the command in XML format. */
export const LocalCommandSystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("local_command"),
  })
  .strict();

/** Catch-all for unrecognized system subtypes. */
export const GenericSystem = z.object(SystemBase).passthrough();

/** Union of all system line variants, dispatched by `subtype`. */
export const SystemLine = z.union([
  TurnDurationSystem,
  ApiErrorSystem,
  CompactBoundarySystem,
  MicrocompactBoundarySystem,
  LocalCommandSystem,
  GenericSystem,
]);

// ---------------------------------------------------------------------------
// Type 6: progress
// ---------------------------------------------------------------------------

/** A user-configured hook (pre/post tool use) is executing. */
export const HookProgressData = z.object({
  type: z.literal("hook_progress"),
  /** The event that triggered the hook (e.g. `"PreToolUse"`, `"PostToolUse"`). */
  hookEvent: z.string(),
  hookName: z.string(),
  /** The shell command being run by the hook. */
  command: z.string(),
});

/** Waiting for a background task (subagent or bash) to complete. */
export const WaitingForTaskData = z.object({
  type: z.literal("waiting_for_task"),
  taskDescription: z.string(),
  /** e.g. `"agent"`, `"bash"`. */
  taskType: z.string(),
});

/** WebSearch is refining or updating its query. */
export const QueryUpdateData = z.object({
  type: z.literal("query_update"),
  /** The refined search query. */
  query: z.string(),
});

/** Streaming output from a running Bash command. */
export const BashProgressData = z.object({
  type: z.literal("bash_progress"),
  /** Recent output (tail of the full output). */
  output: z.string(),
  /** Complete accumulated output so far. */
  fullOutput: z.string(),
  elapsedTimeSeconds: z.number(),
  /** Total number of output lines so far. */
  totalLines: z.number(),
});

/** A subagent is reporting intermediate progress. Shape is open-ended. */
export const AgentProgressData = z
  .object({
    type: z.literal("agent_progress"),
  })
  .passthrough();

/** WebSearch results have arrived. */
export const SearchResultsReceivedData = z.object({
  type: z.literal("search_results_received"),
  resultCount: z.number(),
  query: z.string(),
});

/** An MCP server tool is executing. */
export const McpProgressData = z
  .object({
    type: z.literal("mcp_progress"),
    /** Name of the MCP server (e.g. `"xcode"`). */
    serverName: z.string(),
    /** MCP tool being called (e.g. `"BuildProject"`). */
    toolName: z.string(),
    /** Execution status (e.g. `"running"`, `"completed"`). */
    status: z.string(),
    elapsedTimeMs: z.number().optional(),
  })
  .strict();

/** Union of all progress data types, discriminated by `data.type`. */
export const ProgressData = z.discriminatedUnion("type", [
  HookProgressData,
  WaitingForTaskData,
  QueryUpdateData,
  BashProgressData,
  AgentProgressData,
  SearchResultsReceivedData,
  McpProgressData,
]);

/**
 * Real-time status update during tool execution. Not part of the conversation
 * chain — exists for UI display only.
 */
export const ProgressLine = z
  .object({
    type: z.literal("progress"),
    parentUuid: z.string().nullable().optional(),
    isSidechain: z.boolean().optional(),
    /** Progress payload — shape depends on `data.type`. */
    data: ProgressData,
    /** ID of the tool call this progress relates to. */
    toolUseID: z.string(),
    /** ID of the parent tool call (for nested tool use). */
    parentToolUseID: z.string(),
    timestamp: z.string(),
    uuid: z.string(),
    cwd: z.string(),
    gitBranch: z.string(),
    sessionId: z.string(),
    slug: z.string().optional(),
    userType: z.literal("external"),
    version: z.string(),
    agentId: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Type 7: queue-operation
// ---------------------------------------------------------------------------

/**
 * Background task lifecycle event. Written when async tasks (launched via
 * `Task` tool with `run_in_background: true`) start or finish.
 */
export const QueueOperationLine = z.object({
  type: z.literal("queue-operation"),
  /** `"enqueue"` (task started) or `"dequeue"` (task picked up). */
  operation: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
  /** XML `<task-notification>` with task-id, output-file, status, summary (on `enqueue`). */
  content: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Type 8: last-prompt
// ---------------------------------------------------------------------------

/**
 * Written at the tail of a session JSONL file to record the last user prompt.
 * Enables efficient session indexing without parsing the entire file from the beginning.
 */
export const LastPromptLine = z.object({
  type: z.literal("last-prompt"),
  /** The text of the last user prompt in the session. */
  lastPrompt: z.string(),
  sessionId: z.string(),
});

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Dispatch a user line to the correct schema without using z.union() at
 * runtime (which would let .strict() failures fall through to the next
 * variant).
 */
function dispatchUserLine(obj: Record<string, unknown>): z.ZodTypeAny {
  if ("toolUseResult" in obj) return ToolResultLine;
  const msg = obj.message as { content?: unknown } | undefined;
  if (msg && typeof msg.content === "string") return HumanPromptLine;
  return RichContentLine;
}

/** Map of known system subtypes → their strict schemas. */
const systemSubtypeSchemas: Record<string, z.ZodTypeAny> = {
  turn_duration: TurnDurationSystem,
  api_error: ApiErrorSystem,
  compact_boundary: CompactBoundarySystem,
  microcompact_boundary: MicrocompactBoundarySystem,
  local_command: LocalCommandSystem,
};

/**
 * Validate a parsed JSON object as a transcript line.
 * Dispatches to the specific schema based on the `type` field.
 *
 * User and system lines are dispatched manually (not via z.union()) so that
 * `.strict()` rejections surface immediately instead of falling through to
 * a permissive catch-all variant.
 */
export function validateLine(obj: unknown): {
  success: boolean;
  type?: string;
  error?: z.ZodError;
} {
  if (typeof obj !== "object" || obj === null || !("type" in obj)) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: ["type"],
          message: "Missing type field",
        },
      ]),
    };
  }

  const t = (obj as { type: string }).type;

  // Direct-dispatch types (no union fallthrough concerns)
  const simpleSchemas: Record<string, z.ZodTypeAny> = {
    summary: SummaryLine,
    "file-history-snapshot": FileHistorySnapshotLine,
    assistant: AssistantLine,
    progress: ProgressLine,
    "queue-operation": QueueOperationLine,
    "last-prompt": LastPromptLine,
  };

  let schema: z.ZodTypeAny | undefined = simpleSchemas[t];

  if (t === "user") {
    schema = dispatchUserLine(obj as Record<string, unknown>);
  } else if (t === "system") {
    const subtype = (obj as { subtype?: string }).subtype;
    schema =
      (subtype && systemSubtypeSchemas[subtype]) || GenericSystem;
  }

  if (!schema) {
    return {
      success: false,
      type: t,
      error: new z.ZodError([
        {
          code: "custom",
          path: ["type"],
          message: `Unknown type: ${t}`,
        },
      ]),
    };
  }

  const result = schema.safeParse(obj);
  if (result.success) {
    return { success: true, type: t };
  }
  return { success: false, type: t, error: result.error };
}

// ---------------------------------------------------------------------------
// Auxiliary file types
// ---------------------------------------------------------------------------

/** A single session entry in the `sessions-index.json` file. */
export const SessionIndexEntry = z.object({
  sessionId: z.string(),
  /** Absolute path to the `.jsonl` transcript file. */
  fullPath: z.string(),
  /** File modification time (Unix epoch ms). */
  fileMtime: z.number(),
  /** The first user prompt in the session. */
  firstPrompt: z.string(),
  /** Session title/summary. */
  summary: z.string(),
  messageCount: z.number(),
  /** ISO 8601 timestamp of session creation. */
  created: z.string(),
  /** ISO 8601 timestamp of last modification. */
  modified: z.string(),
  gitBranch: z.string(),
  /** Absolute path to the project directory. */
  projectPath: z.string(),
  isSidechain: z.boolean(),
});

/**
 * Schema for `sessions-index.json` — powers `claude --resume` and the session picker.
 * One file per project directory.
 */
export const SessionIndex = z.object({
  version: z.number(),
  entries: z.array(SessionIndexEntry),
  /** Absolute path to the project directory. */
  originalPath: z.string(),
});

/** Pasted content stored inline in the global history. */
export const InlinePastedContent = z.object({
  id: z.number(),
  /** Content type (e.g. `"file"`, `"text"`). */
  type: z.string(),
  /** The full pasted content. */
  content: z.string(),
});

/** Pasted content stored as a hash reference (for deduplication of large pastes). */
export const HashedPastedContent = z.object({
  id: z.number(),
  type: z.string(),
  /** Hash of the pasted content for deduplication. */
  contentHash: z.string(),
});

/** Pasted content — either stored inline or as a hash reference. */
export const PastedContent = z.union([InlinePastedContent, HashedPastedContent]);

/**
 * A single entry in `~/.claude/history.jsonl` — one line per prompt across all projects.
 * Powers the prompt history / autocomplete in the CLI.
 */
export const HistoryEntry = z.object({
  /** The prompt text as displayed in history. */
  display: z.string(),
  /** Map of pasted file contents (usually empty). */
  pastedContents: z.record(z.string(), PastedContent),
  /** Unix epoch milliseconds. */
  timestamp: z.number(),
  /** Absolute path to the project directory. */
  project: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type TranscriptLineType =
  | z.infer<typeof SummaryLine>
  | z.infer<typeof FileHistorySnapshotLine>
  | z.infer<typeof UserLine>
  | z.infer<typeof AssistantLine>
  | z.infer<typeof SystemLine>
  | z.infer<typeof ProgressLine>
  | z.infer<typeof QueueOperationLine>
  | z.infer<typeof LastPromptLine>;

export type SummaryLineType = z.infer<typeof SummaryLine>;
export type FileHistorySnapshotLineType = z.infer<typeof FileHistorySnapshotLine>;
export type UserLineType = z.infer<typeof UserLine>;
export type HumanPromptLineType = z.infer<typeof HumanPromptLine>;
export type ToolResultLineType = z.infer<typeof ToolResultLine>;
export type PersistedToolResultBlockType = z.infer<typeof PersistedToolResultBlock>;
export type InlineToolResultBlockType = z.infer<typeof InlineToolResultBlock>;
export type ToolResultBlockType = z.infer<typeof ToolResultBlock>;
export type AssistantLineType = z.infer<typeof AssistantLine>;
export type SystemLineType = z.infer<typeof SystemLine>;
export type ProgressLineType = z.infer<typeof ProgressLine>;
export type QueueOperationLineType = z.infer<typeof QueueOperationLine>;
export type LastPromptLineType = z.infer<typeof LastPromptLine>;
export type ContentBlockType = z.infer<typeof ContentBlock>;
export type UsageType = z.infer<typeof Usage>;
export type SessionIndexType = z.infer<typeof SessionIndex>;
export type HistoryEntryType = z.infer<typeof HistoryEntry>;
