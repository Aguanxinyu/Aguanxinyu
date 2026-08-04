import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import type { AccountResult } from "./types.js";

export function writeResults(outputDir: string, results: AccountResult[]): string {
  mkdirSync(outputDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = path.join(outputDir, `results-${stamp}.csv`);
  const jsonPath = path.join(outputDir, `results-${stamp}.json`);
  const latestCsv = path.join(outputDir, "results-latest.csv");
  const latestJson = path.join(outputDir, "results-latest.json");
  const failedCsv = path.join(outputDir, "failed-latest.csv");

  const csv = stringify(results, {
    header: true,
    columns: [
      "accountId",
      "username",
      "status",
      "selectedCount",
      "message",
      "startedAt",
      "finishedAt",
      "durationMs",
    ],
  });

  writeFileSync(csvPath, csv, "utf8");
  writeFileSync(latestCsv, csv, "utf8");
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf8");
  writeFileSync(latestJson, JSON.stringify(results, null, 2), "utf8");

  const failed = results.filter((r) => r.status === "failed");
  const failedCsvBody = stringify(failed, {
    header: true,
    columns: ["accountId", "username", "status", "message", "startedAt", "finishedAt"],
  });
  writeFileSync(failedCsv, failedCsvBody, "utf8");

  return csvPath;
}
