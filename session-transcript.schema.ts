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

export const SummaryLine = z.object({
  type: z.literal("summary"),
  summary: z.string(),
  leafUuid: z.string(),
});

// ---------------------------------------------------------------------------
// Type 2: file-history-snapshot
// ---------------------------------------------------------------------------

export const FileBackupEntry = z.object({
  backupFileName: z.string().nullable(),
  backupTime: z.string(),
  version: z.number(),
});

export const FileHistorySnapshot = z.object({
  messageId: z.string(),
  trackedFileBackups: z.record(z.string(), FileBackupEntry),
  timestamp: z.string(),
});

export const FileHistorySnapshotLine = z.object({
  type: z.literal("file-history-snapshot"),
  messageId: z.string(),
  snapshot: FileHistorySnapshot,
  isSnapshotUpdate: z.boolean(),
});

// ---------------------------------------------------------------------------
// Type 3: user (human prompts + tool results)
// ---------------------------------------------------------------------------

export const ThinkingTrigger = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

export const ThinkingMetadata = z.union([
  z.object({ maxThinkingTokens: z.number() }),
  z.object({
    level: z.string(),
    disabled: z.boolean(),
    triggers: z.array(ThinkingTrigger),
  }),
]);

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

export const UserTextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const UserImageBlock = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.string(),
    media_type: z.string(),
    data: z.string(),
  }),
});

/**
 * Tool result with structured array content — multi-block responses containing
 * text blocks (subagent output) and/or image blocks (visual tool results).
 */
export const ArrayToolResultBlock = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.array(z.union([UserTextBlock, UserImageBlock])),
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

export const UserContentBlock = z.union([
  ToolResultBlock,
  UserTextBlock,
  UserImageBlock,
]);

// -- toolUseResult shapes (built-in tools) --

export const BashToolUseResult = z.object({
  stdout: z.string(),
  stderr: z.string(),
  interrupted: z.boolean(),
  isImage: z.boolean(),
  returnCodeInterpretation: z.string().optional(),
  backgroundTaskId: z.string().optional(),
});

export const ReadTextToolUseResult = z.object({
  type: z.literal("text"),
  file: z.object({
    filePath: z.string(),
    content: z.string(),
    numLines: z.number(),
    startLine: z.number(),
    totalLines: z.number(),
  }),
});

export const ReadImageToolUseResult = z.object({
  type: z.literal("image"),
  file: z.object({
    base64: z.string(),
  }),
});

export const ReadToolUseResult = z.union([
  ReadTextToolUseResult,
  ReadImageToolUseResult,
]);

export const GlobToolUseResult = z.object({
  filenames: z.array(z.string()),
  durationMs: z.number(),
  numFiles: z.number(),
  truncated: z.boolean(),
});

export const GrepToolUseResult = z.object({
  filenames: z.array(z.string()),
  mode: z.string(),
  numFiles: z.number(),
  content: z.string().optional(),
  numLines: z.number().optional(),
  numMatches: z.number().optional(),
  appliedLimit: z.number().optional(),
});

export const PatchHunk = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(z.string()),
});

export const EditToolUseResult = z.object({
  filePath: z.string(),
  oldString: z.string(),
  newString: z.string(),
  originalFile: z.string(),
  replaceAll: z.boolean(),
  structuredPatch: z.array(PatchHunk),
  userModified: z.boolean(),
});

export const WriteToolUseResult = z.object({
  type: z.literal("create"),
  filePath: z.string(),
  content: z.string(),
  originalFile: z.string().nullable(),
  structuredPatch: z.array(PatchHunk),
});

export const TextBlock = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const CacheCreation = z.object({
  ephemeral_5m_input_tokens: z.number(),
  ephemeral_1h_input_tokens: z.number(),
});

export const ServerToolUse = z.object({
  web_search_requests: z.number(),
  web_fetch_requests: z.number(),
});

export const Usage = z.object({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number(),
  cache_read_input_tokens: z.number(),
  cache_creation: CacheCreation.optional(),
  output_tokens: z.number(),
  service_tier: z.string().nullable().optional(),
  inference_geo: z.string().optional(),
  server_tool_use: ServerToolUse.optional(),
});

export const TaskSyncToolUseResult = z.object({
  status: z.literal("completed"),
  prompt: z.string(),
  agentId: z.string(),
  content: z.array(TextBlock),
  totalDurationMs: z.number(),
  totalTokens: z.number(),
  totalToolUseCount: z.number(),
  usage: Usage,
});

export const TaskAsyncToolUseResult = z.object({
  isAsync: z.literal(true),
  status: z.literal("async_launched"),
  agentId: z.string(),
  description: z.string(),
  prompt: z.string(),
  outputFile: z.string(),
});

export const TaskToolUseResult = z.union([
  TaskSyncToolUseResult,
  TaskAsyncToolUseResult,
]);

export const AgentTaskInfo = z.object({
  task_id: z.string(),
  task_type: z.string(),
  status: z.string(),
  description: z.string(),
  output: z.string(),
  prompt: z.string(),
  result: z.string(),
});

export const BackgroundTaskInfo = z.object({
  task_id: z.string(),
  task_type: z.string(),
  status: z.string(),
  description: z.string(),
  output: z.string(),
  exitCode: z.number().nullable(),
});

export const TaskInfo = z.union([AgentTaskInfo, BackgroundTaskInfo]);

export const TaskOutputToolUseResult = z.object({
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
  updatedFields: z.array(z.string()),
  statusChange: z
    .object({ from: z.string(), to: z.string() })
    .optional(),
});

export const TaskListEntry = z.object({
  id: z.string(),
  subject: z.string(),
  status: z.string(),
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
  bytes: z.number(),
  code: z.number(),
  codeText: z.string(),
  durationMs: z.number(),
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
  query: z.string(),
  results: z.array(WebSearchResultItem),
});

export const QuestionOption = z.object({
  label: z.string(),
  description: z.string(),
});

export const QuestionSpec = z.object({
  question: z.string(),
  header: z.string(),
  multiSelect: z.boolean(),
  options: z.array(QuestionOption),
});

export const AskUserQuestionToolUseResult = z.object({
  questions: z.array(QuestionSpec),
  answers: z.record(z.string(), z.string()),
});

export const SkillToolUseResult = z.object({
  success: z.boolean(),
  commandName: z.string(),
  allowedTools: z.array(z.string()).optional(),
});

export const ExitPlanModeToolUseResult = z.object({
  filePath: z.string(),
  isAgent: z.boolean(),
  plan: z.string(),
});

export const TodoItem = z.object({
  content: z.string(),
  status: z.string(),
  activeForm: z.string(),
});

/** @deprecated Legacy tool, replaced by TaskCreate/TaskUpdate/TaskList. */
export const TodoWriteToolUseResult = z.object({
  oldTodos: z.array(TodoItem),
  newTodos: z.array(TodoItem),
});

/** @deprecated Legacy tool, replaced by TaskStop. */
export const KillShellToolUseResult = z.object({
  message: z.string(),
  shell_id: z.string(),
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

export const McpTextContent = z.object({
  type: z.literal("text"),
  text: z.string(),
  annotations: McpAnnotations.optional(),
});

export const McpImageContent = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
  annotations: McpAnnotations.optional(),
});

export const McpAudioContent = z.object({
  type: z.literal("audio"),
  data: z.string(),
  mimeType: z.string(),
  annotations: McpAnnotations.optional(),
});

export const McpResourceLink = z.object({
  type: z.literal("resource_link"),
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  annotations: McpAnnotations.optional(),
});

export const McpEmbeddedResource = z.object({
  type: z.literal("resource"),
  resource: z.object({
    uri: z.string(),
    mimeType: z.string().optional(),
    text: z.string().optional(),
    blob: z.string().optional(),
    annotations: McpAnnotations.optional(),
  }),
  annotations: McpAnnotations.optional(),
});

export const McpContentBlock = z.discriminatedUnion("type", [
  McpTextContent,
  McpImageContent,
  McpAudioContent,
  McpResourceLink,
  McpEmbeddedResource,
]);

/** MCP tool result as a content-block array (raw MCP server response). */
export const McpToolUseResult = z.array(McpContentBlock);

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
  TodoWriteToolUseResult,
  // Web
  WebFetchToolUseResult,
  WebSearchToolUseResult,
  // Interactive
  AskUserQuestionToolUseResult,
  SkillToolUseResult,
  ExitPlanModeToolUseResult,
  // Legacy
  KillShellToolUseResult,
  // Error (string)
  z.string(),
  // MCP / plugin tools — content-block array (raw MCP server response)
  McpToolUseResult,
  // MCP / plugin tools — object (must be last — catch-all)
  ExternalToolUseResult,
]);

// -- Shared user-line base --

const UserBase = {
  type: z.literal("user") as z.ZodLiteral<"user">,
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
  isMeta: z.boolean().optional(),
  sourceToolUseID: z.string().optional(),
  isVisibleInTranscriptOnly: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
};

export const HumanPromptLine = z
  .object({
    ...UserBase,
    message: z.object({
      role: z.literal("user"),
      content: z.string(),
    }),
    thinkingMetadata: ThinkingMetadata.optional(),
    todos: z.array(TodoItem).optional(),
    permissionMode: z.string().optional(),
    planContent: z.string().optional(),
  })
  .strict();

export const ToolResultLine = z
  .object({
    ...UserBase,
    message: z.object({
      role: z.literal("user"),
      content: z.array(ToolResultBlock),
    }),
    toolUseResult: ToolUseResult,
    sourceToolAssistantUUID: z.string(),
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
    todos: z.array(TodoItem).optional(),
    permissionMode: z.string().optional(),
    imagePasteIds: z.array(z.number()).optional(),
  })
  .strict();

export const UserLine = z.union([HumanPromptLine, ToolResultLine, RichContentLine]);

// ---------------------------------------------------------------------------
// Type 4: assistant
// ---------------------------------------------------------------------------

export const ThinkingBlock = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string(),
});

// -- Tool use input schemas (built-in tools) --

export const BashToolInput = z.object({
  command: z.string(),
  description: z.string().optional(),
  timeout: z.number().optional(),
  run_in_background: z.boolean().optional(),
  dangerouslyDisableSandbox: z.boolean().optional(),
  _simulatedSedEdit: z
    .object({
      filePath: z.string(),
      newContent: z.string(),
    })
    .optional(),
});

export const ReadToolInput = z.object({
  file_path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
  pages: z.string().optional(),
});

export const WriteToolInput = z.object({
  file_path: z.string(),
  content: z.string(),
});

export const EditToolInput = z.object({
  file_path: z.string(),
  old_string: z.string(),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

export const NotebookEditToolInput = z.object({
  notebook_path: z.string(),
  new_source: z.string(),
  cell_number: z.number().optional(),
  cell_type: z.enum(["code", "markdown"]).optional(),
  edit_mode: z.enum(["replace", "insert", "delete"]).optional(),
  cell_id: z.string().optional(),
});

export const GlobToolInput = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

export const GrepToolInput = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  type: z.string().optional(),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
  multiline: z.boolean().optional(),
  head_limit: z.number().optional(),
  offset: z.number().optional(),
  context: z.number().optional(),
  "-A": z.number().optional(),
  "-B": z.number().optional(),
  "-C": z.number().optional(),
  "-i": z.boolean().optional(),
  "-n": z.boolean().optional(),
});

export const TaskToolInput = z.object({
  prompt: z.string(),
  subagent_type: z.string(),
  description: z.string(),
  model: z.enum(["sonnet", "opus", "haiku"]).optional(),
  run_in_background: z.boolean().optional(),
  resume: z.string().optional(),
  max_turns: z.number().optional(),
});

export const TaskOutputToolInput = z.object({
  task_id: z.string(),
  block: z.boolean().optional(),
  timeout: z.number().optional(),
});

export const TaskCreateToolInput = z.object({
  subject: z.string(),
  description: z.string(),
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
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional(),
});

export const TaskListToolInput = z.object({});

export const TaskStopToolInput = z.object({
  task_id: z.string().optional(),
  shell_id: z.string().optional(),
});

export const WebFetchToolInput = z.object({
  url: z.string(),
  prompt: z.string(),
});

export const WebSearchToolInput = z.object({
  query: z.string(),
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
});

export const AskUserQuestionInputOption = z.object({
  label: z.string(),
  description: z.string().optional(),
});

export const AskUserQuestionInputItem = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(AskUserQuestionInputOption),
  multiSelect: z.boolean().optional(),
});

export const AskUserQuestionToolInput = z.object({
  questions: z.array(AskUserQuestionInputItem),
  answers: z.record(z.string(), z.string()).optional(),
  metadata: z
    .object({
      source: z.string().optional(),
    })
    .optional(),
});

export const SkillToolInput = z.object({
  skill: z.string(),
  args: z.string().optional(),
});

export const ExitPlanModeAllowedPrompt = z.object({
  tool: z.string(),
  prompt: z.string(),
});

export const ExitPlanModeToolInput = z.object({
  allowedPrompts: z.array(ExitPlanModeAllowedPrompt).optional(),
  pushToRemote: z.boolean().optional(),
  remoteSessionId: z.string().optional(),
  remoteSessionUrl: z.string().optional(),
  remoteSessionTitle: z.string().optional(),
});

export const EnterPlanModeToolInput = z.object({});

// -- Legacy tool inputs --

/** @deprecated Legacy tool, replaced by TaskCreate/TaskUpdate/TaskList. */
export const TodoWriteToolInput = z.object({
  todos: z.array(TodoItem),
});

/** @deprecated Legacy tool, replaced by TaskStop. */
export const KillShellToolInput = z.object({
  shell_id: z.string().optional(),
});

// -- Fallback for MCP / plugin tools --

/** Input from an MCP server or plugin-provided tool (object shape). */
export const ExternalToolInput = z.record(z.string(), z.unknown());

// -- Tool name → input schema map --

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
  TodoWrite: TodoWriteToolInput,
  KillShell: KillShellToolInput,
};

// -- ToolUseBlock with name↔input correlation via .superRefine() --

export const ToolUseBlock = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
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

export const RedactedThinkingBlock = z.object({
  type: z.literal("redacted_thinking"),
  data: z.string(),
});

export const ContentBlock = z.discriminatedUnion("type", [
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  RedactedThinkingBlock,
]);

export const AssistantMessage = z.object({
  model: z.string(),
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(ContentBlock),
  stop_reason: z.string().nullable(),
  stop_sequence: z.string().nullable(),
  usage: Usage,
});

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
    requestId: z.string().optional(),
    error: z.string().optional(),
    isApiErrorMessage: z.boolean().optional(),
    apiError: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Type 5: system
// ---------------------------------------------------------------------------

/** Base fields shared across all system subtypes. */
const SystemBase = {
  type: z.literal("system") as z.ZodLiteral<"system">,
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
  level: z.string().optional(),
  isMeta: z.boolean().optional(),
  content: z.string().optional(),
};

export const TurnDurationSystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("turn_duration"),
    durationMs: z.number(),
    isMeta: z.boolean(),
  })
  .strict();

// -- Undici / Node.js network error inner causes --

export const SocketErrorCause = z.object({
  name: z.string(),
  code: z.string(),
  socket: z.object({
    localAddress: z.string(),
    localPort: z.number(),
    bytesWritten: z.number(),
    bytesRead: z.number(),
  }).passthrough(),
});

export const SyscallErrorCause = z.object({
  code: z.string(),
  errno: z.number(),
  syscall: z.string(),
});

export const TlsErrorCause = z.object({
  code: z.string(),
  library: z.string(),
  reason: z.string(),
});

export const NetworkErrorCause = z.union([
  SocketErrorCause,
  SyscallErrorCause,
  TlsErrorCause,
]);

// -- API error shapes --

export const AnthropicApiErrorDetail = z.object({
  type: z.literal("error"),
  error: z.object({
    type: z.string(),
    message: z.string(),
  }),
  request_id: z.string(),
});

export const NetworkApiError = z.object({
  cause: z.object({
    cause: NetworkErrorCause.optional(),
  }),
});

export const AnthropicApiError = z.object({
  status: z.number(),
  headers: z.record(z.string(), z.unknown()),
  requestID: z.string(),
  error: AnthropicApiErrorDetail,
});

export const EmptyError = z.object({}).strict();

export const ApiError = z.union([
  NetworkApiError,
  AnthropicApiError,
  EmptyError,
]);

export const ApiErrorCause = z.union([
  z.object({ cause: NetworkErrorCause }),
  EmptyError,
]);

export const ApiErrorSystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("api_error"),
    error: ApiError.optional(),
    cause: ApiErrorCause.optional(),
    retryInMs: z.number().optional(),
    retryAttempt: z.number().optional(),
    maxRetries: z.number().optional(),
  })
  .strict();

export const CompactMetadata = z.object({
  trigger: z.string(),
  preTokens: z.number(),
});

export const MicrocompactMetadata = z.object({
  trigger: z.string(),
  preTokens: z.number(),
  tokensSaved: z.number(),
  compactedToolIds: z.array(z.string()),
  clearedAttachmentUUIDs: z.array(z.string()),
});

export const CompactBoundarySystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("compact_boundary"),
    compactMetadata: CompactMetadata.optional(),
    logicalParentUuid: z.string().optional(),
  })
  .strict();

export const MicrocompactBoundarySystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("microcompact_boundary"),
    microcompactMetadata: MicrocompactMetadata.optional(),
  })
  .strict();

export const LocalCommandSystem = z
  .object({
    ...SystemBase,
    subtype: z.literal("local_command"),
  })
  .strict();

/** Catch-all for unrecognized system subtypes. */
export const GenericSystem = z.object(SystemBase).passthrough();

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

export const HookProgressData = z.object({
  type: z.literal("hook_progress"),
  hookEvent: z.string(),
  hookName: z.string(),
  command: z.string(),
});

export const WaitingForTaskData = z.object({
  type: z.literal("waiting_for_task"),
  taskDescription: z.string(),
  taskType: z.string(),
});

export const QueryUpdateData = z.object({
  type: z.literal("query_update"),
  query: z.string(),
});

export const BashProgressData = z.object({
  type: z.literal("bash_progress"),
  output: z.string(),
  fullOutput: z.string(),
  elapsedTimeSeconds: z.number(),
  totalLines: z.number(),
});

export const AgentProgressData = z
  .object({
    type: z.literal("agent_progress"),
  })
  .passthrough();

export const SearchResultsReceivedData = z.object({
  type: z.literal("search_results_received"),
  resultCount: z.number(),
  query: z.string(),
});

export const McpProgressData = z
  .object({
    type: z.literal("mcp_progress"),
    serverName: z.string(),
    toolName: z.string(),
    status: z.string(),
    elapsedTimeMs: z.number().optional(),
  })
  .strict();

export const ProgressData = z.discriminatedUnion("type", [
  HookProgressData,
  WaitingForTaskData,
  QueryUpdateData,
  BashProgressData,
  AgentProgressData,
  SearchResultsReceivedData,
  McpProgressData,
]);

export const ProgressLine = z
  .object({
    type: z.literal("progress"),
    parentUuid: z.string().nullable().optional(),
    isSidechain: z.boolean().optional(),
    data: ProgressData,
    toolUseID: z.string(),
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

export const QueueOperationLine = z.object({
  type: z.literal("queue-operation"),
  operation: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
  content: z.string().optional(),
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

export const SessionIndexEntry = z.object({
  sessionId: z.string(),
  fullPath: z.string(),
  fileMtime: z.number(),
  firstPrompt: z.string(),
  summary: z.string(),
  messageCount: z.number(),
  created: z.string(),
  modified: z.string(),
  gitBranch: z.string(),
  projectPath: z.string(),
  isSidechain: z.boolean(),
});

export const SessionIndex = z.object({
  version: z.number(),
  entries: z.array(SessionIndexEntry),
  originalPath: z.string(),
});

export const InlinePastedContent = z.object({
  id: z.number(),
  type: z.string(),
  content: z.string(),
});

export const HashedPastedContent = z.object({
  id: z.number(),
  type: z.string(),
  contentHash: z.string(),
});

export const PastedContent = z.union([InlinePastedContent, HashedPastedContent]);

export const HistoryEntry = z.object({
  display: z.string(),
  pastedContents: z.record(z.string(), PastedContent),
  timestamp: z.number(),
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
  | z.infer<typeof QueueOperationLine>;

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
export type ContentBlockType = z.infer<typeof ContentBlock>;
export type UsageType = z.infer<typeof Usage>;
export type SessionIndexType = z.infer<typeof SessionIndex>;
export type HistoryEntryType = z.infer<typeof HistoryEntry>;
