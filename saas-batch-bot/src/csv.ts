import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import type { Account } from "./types.js";

function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function isEnabled(value: string): boolean {
  if (!value) return true;
  return !["0", "false", "no", "n", "off", "禁用", "否"].includes(value.toLowerCase());
}

export async function loadAccounts(csvPath: string): Promise<Account[]> {
  const rows: Account[] = [];

  await new Promise<void>((resolve, reject) => {
    createReadStream(csvPath)
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true,
        }),
      )
      .on("data", (row: Record<string, string>) => {
        const username = pick(row, ["username", "account", "email", "user", "账号", "用户名"]);
        const password = pick(row, ["password", "pass", "pwd", "密码"]);
        const id = pick(row, ["id", "account_id", "账号ID"]) || username;
        const note = pick(row, ["note", "备注", "remark"]);
        const enabledRaw = pick(row, ["enabled", "enable", "启用"]);

        if (!username || !password) {
          return;
        }

        rows.push({
          id,
          username,
          password,
          note: note || undefined,
          enabled: isEnabled(enabledRaw),
        });
      })
      .on("error", reject)
      .on("end", () => resolve());
  });

  return rows;
}
