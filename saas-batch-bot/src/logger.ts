type Level = "info" | "warn" | "error" | "debug";

function stamp(): string {
  return new Date().toISOString();
}

function write(level: Level, message: string, extra?: unknown): void {
  const line = `[${stamp()}] [${level.toUpperCase()}] ${message}`;
  if (extra !== undefined) {
    console.log(line, extra);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (message: string, extra?: unknown) => write("info", message, extra),
  warn: (message: string, extra?: unknown) => write("warn", message, extra),
  error: (message: string, extra?: unknown) => write("error", message, extra),
  debug: (message: string, extra?: unknown) => write("debug", message, extra),
};
