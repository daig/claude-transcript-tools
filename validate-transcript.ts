#!/usr/bin/env npx tsx
/**
 * Validates real Claude Code JSONL session transcripts against the Zod schema.
 *
 * Usage:
 *   npx tsx validate-transcript.ts                    # all projects
 *   npx tsx validate-transcript.ts path/to/file.jsonl # specific file
 */

import { createReadStream, readdirSync } from "fs";
import { createInterface } from "readline";
import { join, resolve } from "path";
import { homedir } from "os";
import { validateLine } from "./session-transcript.schema";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_ERRORS_PER_TYPE = 3;
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// ---------------------------------------------------------------------------
// Collect JSONL files
// ---------------------------------------------------------------------------

function findJsonlFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findJsonlFiles(full));
      } else if (entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  } catch {
    // permission errors, etc.
  }
  return files;
}

// ---------------------------------------------------------------------------
// Stream-parse a single JSONL file
// ---------------------------------------------------------------------------

async function processFile(
  file: string,
  stats: {
    totalLines: number;
    totalPass: number;
    totalFail: number;
    failsByType: Record<string, { count: number; samples: string[] }>;
  }
) {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    lineNum++;
    stats.totalLines++;

    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      stats.totalFail++;
      const key = "JSON_PARSE_ERROR";
      stats.failsByType[key] ??= { count: 0, samples: [] };
      stats.failsByType[key].count++;
      if (stats.failsByType[key].samples.length < MAX_ERRORS_PER_TYPE) {
        stats.failsByType[key].samples.push(
          `  ${file}:${lineNum} — ${trimmed.slice(0, 120)}`
        );
      }
      continue;
    }

    const result = validateLine(obj);
    if (result.success) {
      stats.totalPass++;
    } else {
      stats.totalFail++;
      const key = result.type ?? "UNKNOWN";
      stats.failsByType[key] ??= { count: 0, samples: [] };
      stats.failsByType[key].count++;
      if (stats.failsByType[key].samples.length < MAX_ERRORS_PER_TYPE) {
        const issues = result.error!.issues
          .slice(0, 3)
          .map((iss) => `${iss.path.join(".")} — ${iss.message}`)
          .join("; ");
        stats.failsByType[key].samples.push(`  ${file}:${lineNum} → ${issues}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const files =
    args.length > 0 ? args.map((a) => resolve(a)) : findJsonlFiles(PROJECTS_DIR);

  if (files.length === 0) {
    console.error("No JSONL files found.");
    process.exit(1);
  }

  const stats = {
    totalLines: 0,
    totalPass: 0,
    totalFail: 0,
    failsByType: {} as Record<string, { count: number; samples: string[] }>,
  };

  for (const file of files) {
    await processFile(file, stats);
  }

  // -- Report --
  console.log("=== Claude Code JSONL Schema Validation ===\n");
  console.log(`Files scanned:  ${files.length}`);
  console.log(`Total lines:    ${stats.totalLines}`);
  console.log(`  Passed:       ${stats.totalPass}`);
  console.log(`  Failed:       ${stats.totalFail}`);
  console.log(
    `  Pass rate:    ${((stats.totalPass / stats.totalLines) * 100).toFixed(2)}%\n`
  );

  if (stats.totalFail > 0) {
    console.log("--- Failures by type ---\n");
    for (const [type, { count, samples }] of Object.entries(
      stats.failsByType
    ).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`${type}: ${count} failures`);
      for (const s of samples) console.log(s);
      if (count > samples.length)
        console.log(`  ... and ${count - samples.length} more`);
      console.log();
    }
  }

  process.exit(stats.totalFail > 0 ? 1 : 0);
}

main();
