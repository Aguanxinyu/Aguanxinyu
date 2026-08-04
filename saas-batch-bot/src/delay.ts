import type { DelayRange } from "./types.js";

export function randomBetween(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sleepRange(range: DelayRange): Promise<number> {
  const ms = randomBetween(range.min, range.max);
  await sleep(ms);
  return ms;
}
