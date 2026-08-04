import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig, ClickScheme, SelectMode } from "./types.js";

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

export type SchemeOverrides = {
  schemeName?: string;
  mediaTab?: string;
  maxTasksPerAccount?: number;
  maxArticlesPerTask?: number;
  onlyUnpublishedTasks?: boolean;
  selectMode?: SelectMode;
};

type RawConfig = Omit<AppConfig, "scheme"> & {
  scheme?: ClickScheme;
  mediaTab?: string;
  maxTasksPerAccount?: number;
  maxArticlesPerTask?: number;
  onlyUnpublishedTasks?: boolean;
};

function resolveScheme(raw: RawConfig, overrides: SchemeOverrides = {}): ClickScheme {
  const schemeName = overrides.schemeName || raw.activeScheme;
  const fromFile = raw.schemes?.[schemeName];

  if (!fromFile && !raw.mediaTab) {
    const names = Object.keys(raw.schemes || {}).join(", ");
    throw new Error(`找不到点击方案 "${schemeName}"。可用方案: ${names || "(无)"}`);
  }

  const base: ClickScheme = fromFile || {
    label: "legacy",
    mediaTab: raw.mediaTab || "第三方新闻媒体训练",
    maxTasksPerAccount: raw.maxTasksPerAccount ?? 1,
    maxArticlesPerTask: raw.maxArticlesPerTask ?? 5,
    onlyUnpublishedTasks: raw.onlyUnpublishedTasks ?? true,
    selectMode: "first-n",
  };

  return {
    ...base,
    mediaTab: overrides.mediaTab || base.mediaTab,
    maxTasksPerAccount: overrides.maxTasksPerAccount ?? base.maxTasksPerAccount,
    maxArticlesPerTask: overrides.maxArticlesPerTask ?? base.maxArticlesPerTask,
    onlyUnpublishedTasks: overrides.onlyUnpublishedTasks ?? base.onlyUnpublishedTasks,
    selectMode: overrides.selectMode || base.selectMode || "first-n",
  };
}

export function loadConfig(
  configPath = path.join(rootDir, "config/default.json"),
  overrides: SchemeOverrides = {},
): AppConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;

  raw.baseUrl = process.env.SAAS_BASE_URL || raw.baseUrl;
  raw.headless = asBool(process.env.HEADLESS, raw.headless);
  raw.concurrency = Math.max(1, asInt(process.env.CONCURRENCY, raw.concurrency));

  if (overrides.schemeName) {
    raw.activeScheme = overrides.schemeName;
  }

  const scheme = resolveScheme(raw, overrides);
  raw.activeScheme = overrides.schemeName || raw.activeScheme;

  raw.paths.accountsCsv = path.resolve(rootDir, raw.paths.accountsCsv);
  raw.paths.authDir = path.resolve(rootDir, raw.paths.authDir);
  raw.paths.outputDir = path.resolve(rootDir, raw.paths.outputDir);

  return {
    ...raw,
    scheme,
  };
}

export function listSchemes(configPath = path.join(rootDir, "config/default.json")): Array<{
  name: string;
  scheme: ClickScheme;
}> {
  const raw = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;
  return Object.entries(raw.schemes || {}).map(([name, scheme]) => ({ name, scheme }));
}

export function getRootDir(): string {
  return rootDir;
}
