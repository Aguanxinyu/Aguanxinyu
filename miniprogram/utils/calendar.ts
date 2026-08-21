/** Asia/Shanghai calendar helpers for the mini program UI. */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export interface DayCell {
  readonly key: string;
  readonly label: string;
  readonly weekday: string;
  readonly dayNumber: number;
  readonly isToday: boolean;
  readonly isFuture: boolean;
  readonly inMonth: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function shanghaiParts(timestamp: number): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(new Date(timestamp));
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const weekdayToken = lookup('weekday');
  const weekdayMap: Readonly<Record<string, number>> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return {
    year: Number(lookup('year')),
    month: Number(lookup('month')),
    day: Number(lookup('day')),
    weekday: weekdayMap[weekdayToken] ?? 0
  };
}

export function dateKeyFromTimestamp(timestamp: number): string {
  const { year, month, day } = shanghaiParts(timestamp);
  return `${String(year)}-${pad(month)}-${pad(day)}`;
}

export function todayKey(now = Date.now()): string {
  return dateKeyFromTimestamp(now);
}

export function parseDateKey(key: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
} {
  const [yearText, monthText, dayText] = key.split('-');
  return {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText)
  };
}

export function formatDayTitle(key: string, now = Date.now()): string {
  const today = todayKey(now);
  if (key === today) {
    return '今天';
  }
  const { year, month, day } = parseDateKey(key);
  const todayParts = shanghaiParts(now);
  if (year === todayParts.year) {
    return `${String(month)}月${String(day)}日`;
  }
  return `${String(year)}年${String(month)}月${String(day)}日`;
}

export function formatDaySubtitle(key: string): string {
  const { year, month, day } = parseDateKey(key);
  const noon = Date.UTC(year, month - 1, day, 4);
  const weekday = WEEKDAY_LABELS[shanghaiParts(noon).weekday] ?? '';
  return `${String(month)}月${String(day)}日 · 星期${weekday}`;
}

/** Local midnight for a Shanghai calendar day, as epoch ms (UTC instant). */
export function dayStartMs(key: string): number {
  const { year, month, day } = parseDateKey(key);
  return Date.parse(`${String(year)}-${pad(month)}-${pad(day)}T00:00:00+08:00`);
}

export function dayEndMs(key: string): number {
  return dayStartMs(key) + 24 * 60 * 60 * 1000 - 1;
}

export function shiftDateKey(key: string, deltaDays: number): string {
  return dateKeyFromTimestamp(dayStartMs(key) + deltaDays * 24 * 60 * 60 * 1000);
}

export function buildWeekStrip(selectedKey: string, now = Date.now()): readonly DayCell[] {
  const selected = parseDateKey(selectedKey);
  const selectedNoon = Date.UTC(selected.year, selected.month - 1, selected.day, 4);
  const weekday = shanghaiParts(selectedNoon).weekday;
  const weekStart = shiftDateKey(selectedKey, -weekday);
  const today = todayKey(now);
  return Array.from({ length: 7 }, (_, index) => {
    const key = shiftDateKey(weekStart, index);
    const parts = parseDateKey(key);
    return {
      key,
      label: String(parts.day),
      weekday: WEEKDAY_LABELS[index] ?? '',
      dayNumber: parts.day,
      isToday: key === today,
      isFuture: key > today,
      inMonth: true
    };
  });
}

export function buildMonthGrid(monthKey: string, now = Date.now()): readonly DayCell[] {
  const { year, month } = parseDateKey(monthKey);
  const firstKey = `${String(year)}-${pad(month)}-01`;
  const firstWeekday = shanghaiParts(dayStartMs(firstKey)).weekday;
  const nextMonth =
    month === 12 ? `${String(year + 1)}-01-01` : `${String(year)}-${pad(month + 1)}-01`;
  const lastDay = parseDateKey(shiftDateKey(nextMonth, -1)).day;
  const today = todayKey(now);
  const leading = Array.from({ length: firstWeekday }, (_, index) => {
    const key = shiftDateKey(firstKey, index - firstWeekday);
    const parts = parseDateKey(key);
    return {
      key,
      label: String(parts.day),
      weekday: WEEKDAY_LABELS[index] ?? '',
      dayNumber: parts.day,
      isToday: key === today,
      isFuture: key > today,
      inMonth: false
    } satisfies DayCell;
  });
  const monthDays = Array.from({ length: lastDay }, (_, index) => {
    const key = shiftDateKey(firstKey, index);
    const parts = parseDateKey(key);
    const weekday = shanghaiParts(dayStartMs(key)).weekday;
    return {
      key,
      label: String(parts.day),
      weekday: WEEKDAY_LABELS[weekday] ?? '',
      dayNumber: parts.day,
      isToday: key === today,
      isFuture: key > today,
      inMonth: true
    } satisfies DayCell;
  });
  const cells = [...leading, ...monthDays];
  while (cells.length % 7 !== 0) {
    const lastKey = cells[cells.length - 1]?.key ?? firstKey;
    const key = shiftDateKey(lastKey, 1);
    const parts = parseDateKey(key);
    const weekday = shanghaiParts(dayStartMs(key)).weekday;
    cells.push({
      key,
      label: String(parts.day),
      weekday: WEEKDAY_LABELS[weekday] ?? '',
      dayNumber: parts.day,
      isToday: key === today,
      isFuture: key > today,
      inMonth: false
    });
  }
  return cells;
}

export function monthTitle(monthKey: string): string {
  const { year, month } = parseDateKey(monthKey);
  return `${String(year)}年${String(month)}月`;
}

export function monthKeyFromDateKey(key: string): string {
  const { year, month } = parseDateKey(key);
  return `${String(year)}-${pad(month)}-01`;
}
