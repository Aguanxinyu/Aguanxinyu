import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./types.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function asInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(configPath = path.join(rootDir, "config/default.json")): AppConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as AppConfig;

  raw.baseUrl = process.env.SAAS_BASE_URL || raw.baseUrl;
  raw.headless = asBool(process.env.HEADLESS, raw.headless);
  raw.concurrency = Math.max(1, asInt(process.env.CONCURRENCY, raw.concurrency));

  raw.paths.accountsCsv = path.resolve(rootDir, raw.paths.accountsCsv);
  raw.paths.authDir = path.resolve(rootDir, raw.paths.authDir);
  raw.paths.outputDir = path.resolve(rootDir, raw.paths.outputDir);

  return raw;
}

export function getRootDir(): string {
  return rootDir;
}
