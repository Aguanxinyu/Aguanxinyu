/** Active list workspace persisted while the user browses the todos tab. */

export const LIST_CONTEXT_KEY = 'today-todo:list-filter';

export interface ListContext {
  readonly listId: string;
  readonly listName: string;
}

export function readListContext(): ListContext | null {
  const raw = wx.getStorageSync<unknown>(LIST_CONTEXT_KEY);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Readonly<Record<string, unknown>>;
  if (typeof candidate.listId !== 'string' || typeof candidate.listName !== 'string') {
    return null;
  }
  return { listId: candidate.listId, listName: candidate.listName };
}

export function writeListContext(context: ListContext): void {
  wx.setStorageSync(LIST_CONTEXT_KEY, context);
}

export function clearListContext(): void {
  wx.removeStorageSync(LIST_CONTEXT_KEY);
}
