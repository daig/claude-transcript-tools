/**
 * Generate JSON Schema from Zod (source of truth)
 *
 * Uses Zod v4's built-in `z.toJSONSchema()` to produce a standalone JSON Schema
 * file from the Zod schemas in `session-transcript.schema.ts`.
 *
 * Usage: npx tsx generate-json-schema.ts
 */

import { z } from "zod";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  // Type 1: summary
  SummaryLine,

  // Type 2: file-history-snapshot
  FileBackupEntry,
  FileHistorySnapshot,
  FileHistorySnapshotLine,

  // Type 3: user
  ThinkingTrigger,
  ThinkingMetadata,
  PersistedOutput,
  PersistedToolResultBlock,
  InlineToolResultBlock,
  ArrayToolResultBlock,
  ToolResultBlock,
  UserTextBlock,
  UserImageBlock,
  UserContentBlock,
  HumanPromptLine,
  ToolResultLine,
  RichContentLine,
  UserLine,

  // Tool use results
  BashToolUseResult,
  ReadTextToolUseResult,
  ReadImageToolUseResult,
  ReadToolUseResult,
  GlobToolUseResult,
  GrepToolUseResult,
  PatchHunk,
  EditToolUseResult,
  WriteToolUseResult,
  TextBlock,
  CacheCreation,
  ServerToolUse,
  Usage,
  TaskSyncToolUseResult,
  TaskAsyncToolUseResult,
  TaskToolUseResult,
  AgentTaskInfo,
  BackgroundTaskInfo,
  TaskInfo,
  TaskOutputToolUseResult,
  TaskCreateToolUseResult,
  TaskUpdateToolUseResult,
  TaskListEntry,
  TaskListToolUseResult,
  TaskStopToolUseResult,
  WebFetchToolUseResult,
  WebSearchResultLink,
  WebSearchStructuredResult,
  WebSearchResultItem,
  WebSearchToolUseResult,
  QuestionOption,
  QuestionSpec,
  AskUserQuestionToolUseResult,
  SkillToolUseResult,
  ExitPlanModeToolUseResult,
  TodoItem,
  TodoWriteToolUseResult,
  KillShellToolUseResult,
  ExternalToolUseResult,
  McpAnnotations,
  McpTextContent,
  McpImageContent,
  McpAudioContent,
  McpResourceLink,
  McpEmbeddedResource,
  McpContentBlock,
  McpToolUseResult,
  ToolUseResult,

  // Tool use inputs
  BashToolInput,
  ReadToolInput,
  WriteToolInput,
  EditToolInput,
  NotebookEditToolInput,
  GlobToolInput,
  GrepToolInput,
  TaskToolInput,
  TaskOutputToolInput,
  TaskCreateToolInput,
  TaskGetToolInput,
  TaskUpdateToolInput,
  TaskListToolInput,
  TaskStopToolInput,
  WebFetchToolInput,
  WebSearchToolInput,
  AskUserQuestionInputOption,
  AskUserQuestionInputItem,
  AskUserQuestionToolInput,
  SkillToolInput,
  ExitPlanModeAllowedPrompt,
  ExitPlanModeToolInput,
  EnterPlanModeToolInput,
  TodoWriteToolInput,
  KillShellToolInput,
  ExternalToolInput,

  // Type 4: assistant
  ThinkingBlock,
  ToolUseBlock,
  RedactedThinkingBlock,
  ContentBlock,
  AssistantMessage,
  AssistantLine,

  // Type 5: system
  SocketErrorCause,
  SyscallErrorCause,
  TlsErrorCause,
  NetworkErrorCause,
  AnthropicApiErrorDetail,
  NetworkApiError,
  AnthropicApiError,
  EmptyError,
  ApiError,
  ApiErrorCause,
  TurnDurationSystem,
  ApiErrorSystem,
  CompactMetadata,
  MicrocompactMetadata,
  CompactBoundarySystem,
  MicrocompactBoundarySystem,
  LocalCommandSystem,
  GenericSystem,
  SystemLine,

  // Type 6: progress
  HookProgressData,
  WaitingForTaskData,
  QueryUpdateData,
  BashProgressData,
  AgentProgressData,
  SearchResultsReceivedData,
  McpProgressData,
  ProgressData,
  ProgressLine,

  // Type 7: queue-operation
  QueueOperationLine,

  // Auxiliary
  SessionIndexEntry,
  SessionIndex,
  InlinePastedContent,
  HashedPastedContent,
  PastedContent,
  HistoryEntry,
} from "./session-transcript.schema.js";

// ---------------------------------------------------------------------------
// Register schemas with descriptive IDs for readable $defs
// ---------------------------------------------------------------------------

const registry: Array<[z.ZodTypeAny, string, string?]> = [
  // Line types (top-level)
  [SummaryLine, "SummaryLine"],
  [FileHistorySnapshotLine, "FileHistorySnapshotLine"],
  [HumanPromptLine, "HumanPromptLine"],
  [ToolResultLine, "ToolResultLine"],
  [RichContentLine, "RichContentLine"],
  [UserLine, "UserLine"],
  [AssistantLine, "AssistantLine"],
  [TurnDurationSystem, "TurnDurationSystem"],
  [ApiErrorSystem, "ApiErrorSystem"],
  [CompactBoundarySystem, "CompactBoundarySystem"],
  [MicrocompactBoundarySystem, "MicrocompactBoundarySystem"],
  [LocalCommandSystem, "LocalCommandSystem"],
  [GenericSystem, "GenericSystem"],
  [SystemLine, "SystemLine"],
  [ProgressLine, "ProgressLine"],
  [QueueOperationLine, "QueueOperationLine"],

  // Content blocks
  [TextBlock, "TextBlock"],
  [ThinkingBlock, "ThinkingBlock"],
  [ToolUseBlock, "ToolUseBlock"],
  [RedactedThinkingBlock, "RedactedThinkingBlock"],
  [ContentBlock, "ContentBlock"],
  [UserTextBlock, "UserTextBlock"],
  [UserImageBlock, "UserImageBlock"],
  [PersistedToolResultBlock, "PersistedToolResultBlock"],
  [InlineToolResultBlock, "InlineToolResultBlock"],
  [ArrayToolResultBlock, "ArrayToolResultBlock"],
  [ToolResultBlock, "ToolResultBlock"],
  [UserContentBlock, "UserContentBlock"],
  [AssistantMessage, "AssistantMessage"],

  // Tool use results
  [BashToolUseResult, "BashToolUseResult"],
  [ReadTextToolUseResult, "ReadTextToolUseResult"],
  [ReadImageToolUseResult, "ReadImageToolUseResult"],
  [ReadToolUseResult, "ReadToolUseResult"],
  [GlobToolUseResult, "GlobToolUseResult"],
  [GrepToolUseResult, "GrepToolUseResult"],
  [EditToolUseResult, "EditToolUseResult"],
  [WriteToolUseResult, "WriteToolUseResult"],
  [TaskSyncToolUseResult, "TaskSyncToolUseResult"],
  [TaskAsyncToolUseResult, "TaskAsyncToolUseResult"],
  [TaskToolUseResult, "TaskToolUseResult"],
  [TaskOutputToolUseResult, "TaskOutputToolUseResult"],
  [TaskCreateToolUseResult, "TaskCreateToolUseResult"],
  [TaskUpdateToolUseResult, "TaskUpdateToolUseResult"],
  [TaskListToolUseResult, "TaskListToolUseResult"],
  [TaskStopToolUseResult, "TaskStopToolUseResult"],
  [WebFetchToolUseResult, "WebFetchToolUseResult"],
  [WebSearchToolUseResult, "WebSearchToolUseResult"],
  [AskUserQuestionToolUseResult, "AskUserQuestionToolUseResult"],
  [SkillToolUseResult, "SkillToolUseResult"],
  [ExitPlanModeToolUseResult, "ExitPlanModeToolUseResult"],
  [TodoWriteToolUseResult, "TodoWriteToolUseResult", "Legacy: replaced by TaskCreate/TaskUpdate/TaskList."],
  [KillShellToolUseResult, "KillShellToolUseResult", "Legacy: replaced by TaskStop."],
  [ExternalToolUseResult, "ExternalToolUseResult"],
  [McpAnnotations, "McpAnnotations"],
  [McpTextContent, "McpTextContent"],
  [McpImageContent, "McpImageContent"],
  [McpAudioContent, "McpAudioContent"],
  [McpResourceLink, "McpResourceLink"],
  [McpEmbeddedResource, "McpEmbeddedResource"],
  [McpContentBlock, "McpContentBlock"],
  [McpToolUseResult, "McpToolUseResult"],
  [ToolUseResult, "ToolUseResult"],

  // Tool use inputs
  [BashToolInput, "BashToolInput"],
  [ReadToolInput, "ReadToolInput"],
  [WriteToolInput, "WriteToolInput"],
  [EditToolInput, "EditToolInput"],
  [NotebookEditToolInput, "NotebookEditToolInput"],
  [GlobToolInput, "GlobToolInput"],
  [GrepToolInput, "GrepToolInput"],
  [TaskToolInput, "TaskToolInput"],
  [TaskOutputToolInput, "TaskOutputToolInput"],
  [TaskCreateToolInput, "TaskCreateToolInput"],
  [TaskGetToolInput, "TaskGetToolInput"],
  [TaskUpdateToolInput, "TaskUpdateToolInput"],
  [TaskListToolInput, "TaskListToolInput"],
  [TaskStopToolInput, "TaskStopToolInput"],
  [WebFetchToolInput, "WebFetchToolInput"],
  [WebSearchToolInput, "WebSearchToolInput"],
  [AskUserQuestionInputOption, "AskUserQuestionInputOption"],
  [AskUserQuestionInputItem, "AskUserQuestionInputItem"],
  [AskUserQuestionToolInput, "AskUserQuestionToolInput"],
  [SkillToolInput, "SkillToolInput"],
  [ExitPlanModeAllowedPrompt, "ExitPlanModeAllowedPrompt"],
  [ExitPlanModeToolInput, "ExitPlanModeToolInput"],
  [EnterPlanModeToolInput, "EnterPlanModeToolInput"],
  [TodoWriteToolInput, "TodoWriteToolInput", "Legacy: replaced by TaskCreate/TaskUpdate/TaskList."],
  [KillShellToolInput, "KillShellToolInput", "Legacy: replaced by TaskStop."],
  [ExternalToolInput, "ExternalToolInput"],

  // Shared / auxiliary schemas
  [FileBackupEntry, "FileBackupEntry"],
  [FileHistorySnapshot, "FileHistorySnapshot"],
  [ThinkingTrigger, "ThinkingTrigger"],
  [ThinkingMetadata, "ThinkingMetadata"],
  [PersistedOutput, "PersistedOutput"],
  [PatchHunk, "PatchHunk"],
  [CacheCreation, "CacheCreation"],
  [ServerToolUse, "ServerToolUse"],
  [Usage, "Usage"],
  [AgentTaskInfo, "AgentTaskInfo"],
  [BackgroundTaskInfo, "BackgroundTaskInfo"],
  [TaskInfo, "TaskInfo"],
  [TaskListEntry, "TaskListEntry"],
  [WebSearchResultLink, "WebSearchResultLink"],
  [WebSearchStructuredResult, "WebSearchStructuredResult"],
  [WebSearchResultItem, "WebSearchResultItem"],
  [QuestionOption, "QuestionOption"],
  [QuestionSpec, "QuestionSpec"],
  [TodoItem, "TodoItem"],

  // System subtypes
  [SocketErrorCause, "SocketErrorCause"],
  [SyscallErrorCause, "SyscallErrorCause"],
  [TlsErrorCause, "TlsErrorCause"],
  [NetworkErrorCause, "NetworkErrorCause"],
  [AnthropicApiErrorDetail, "AnthropicApiErrorDetail"],
  [NetworkApiError, "NetworkApiError"],
  [AnthropicApiError, "AnthropicApiError"],
  [EmptyError, "EmptyError"],
  [ApiError, "ApiError"],
  [ApiErrorCause, "ApiErrorCause"],
  [CompactMetadata, "CompactMetadata"],
  [MicrocompactMetadata, "MicrocompactMetadata"],

  // Progress subtypes
  [HookProgressData, "HookProgressData"],
  [WaitingForTaskData, "WaitingForTaskData"],
  [QueryUpdateData, "QueryUpdateData"],
  [BashProgressData, "BashProgressData"],
  [AgentProgressData, "AgentProgressData"],
  [SearchResultsReceivedData, "SearchResultsReceivedData"],
  [McpProgressData, "McpProgressData"],
  [ProgressData, "ProgressData"],

  // Auxiliary file types
  [SessionIndexEntry, "SessionIndexEntry"],
  [SessionIndex, "SessionIndex"],
  [InlinePastedContent, "InlinePastedContent"],
  [HashedPastedContent, "HashedPastedContent"],
  [PastedContent, "PastedContent"],
  [HistoryEntry, "HistoryEntry"],
];

for (const [schema, id, description] of registry) {
  z.globalRegistry.add(schema, description ? { id, description } : { id });
}

// ---------------------------------------------------------------------------
// Top-level union of all 7 line types
// ---------------------------------------------------------------------------

const TranscriptLine = z.union([
  SummaryLine,
  FileHistorySnapshotLine,
  UserLine,
  AssistantLine,
  SystemLine,
  ProgressLine,
  QueueOperationLine,
]);

// ---------------------------------------------------------------------------
// Generate the JSON Schema
// ---------------------------------------------------------------------------

const jsonSchema = z.toJSONSchema(TranscriptLine, {
  io: "input",
}) as Record<string, unknown>;

// Add top-level metadata
jsonSchema["$schema"] = "https://json-schema.org/draft/2020-12/schema";
jsonSchema["title"] = "Claude Code Session Transcript Line";
jsonSchema["description"] =
  "Schema for a single JSONL line in a Claude Code session transcript. Each line is one of 7 types: summary, file-history-snapshot, user, assistant, system, progress, or queue-operation.";

// ---------------------------------------------------------------------------
// Add auxiliary schemas (SessionIndex, HistoryEntry) to $defs
// ---------------------------------------------------------------------------

const auxiliarySchemas: Array<[z.ZodTypeAny, string]> = [
  [SessionIndex, "SessionIndex"],
  [HistoryEntry, "HistoryEntry"],
];

const defs = (jsonSchema["$defs"] ?? {}) as Record<string, unknown>;

for (const [schema, id] of auxiliarySchemas) {
  if (!defs[id]) {
    const auxSchema = z.toJSONSchema(schema, { io: "input" }) as Record<
      string,
      unknown
    >;
    // Merge any new $defs from auxiliary schemas
    const auxDefs = auxSchema["$defs"] as Record<string, unknown> | undefined;
    if (auxDefs) {
      for (const [key, val] of Object.entries(auxDefs)) {
        if (!defs[key]) {
          defs[key] = val;
        }
      }
      delete auxSchema["$defs"];
    }
    defs[id] = auxSchema;
  }
}

jsonSchema["$defs"] = defs;

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "session-transcript.schema.json");

writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");
console.log(`Wrote ${outPath}`);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

z.globalRegistry.clear();
