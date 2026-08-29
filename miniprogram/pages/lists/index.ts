import { ApiClientError, apiClient, type ClientList } from '../../services/api.js';
import type { ClientTask } from '../../stores/todo-store.js';
import { clearListContext, readListContext, writeListContext } from '../../utils/list-context.js';
import { getCustomNavInset } from '../../utils/layout.js';

interface ListRow extends ClientList {
  readonly openCount: number;
  readonly totalCount: number;
}

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

function buildListRows(
  lists: readonly ClientList[],
  tasks: readonly ClientTask[]
): readonly ListRow[] {
  const counts = new Map<string, { open: number; total: number }>();
  for (const list of lists) {
    counts.set(list.id, { open: 0, total: 0 });
  }
  for (const task of tasks) {
    if (task.status === 'TRASHED') {
      continue;
    }
    const bucket = counts.get(task.listId);
    if (bucket === undefined) {
      continue;
    }
    bucket.total += 1;
    if (task.status === 'TODO') {
      bucket.open += 1;
    }
  }
  return lists.map((list) => {
    const bucket = counts.get(list.id) ?? { open: 0, total: 0 };
    return {
      ...list,
      openCount: bucket.open,
      totalCount: bucket.total
    };
  });
}

Page({
  data: {
    lists: [] as readonly ListRow[],
    newName: '',
    loading: false,
    navPaddingTop: 88
  },

  onLoad() {
    this.setData({ navPaddingTop: getCustomNavInset() });
  },

  onShow() {
    void this.loadLists();
  },

  async loadLists() {
    this.setData({ loading: true });
    try {
      const [lists, taskPage] = await Promise.all([apiClient.listLists(), apiClient.listTasks()]);
      this.setData({ lists: buildListRows(lists, taskPage.tasks) });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ newName: event.detail.value });
  },

  async onCreate() {
    const name = this.data.newName.trim();
    if (name.length === 0) {
      return;
    }
    try {
      const list = await apiClient.createList(name);
      this.setData({
        lists: [...this.data.lists, { ...list, openCount: 0, totalCount: 0 }],
        newName: ''
      });
      void wx.showToast({ title: '清单已创建', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    }
  },

  onOpenList(event: WechatMiniprogram.BaseEvent) {
    const listId = String(event.currentTarget.dataset.id ?? '');
    const list = this.data.lists.find(({ id }) => id === listId);
    if (list === undefined) {
      return;
    }
    writeListContext({
      listId: list.id,
      listName: list.name
    });
    void wx.switchTab({ url: '/pages/todos/index' });
  },

  onListMenu(event: WechatMiniprogram.BaseEvent) {
    const listId = String(event.currentTarget.dataset.id ?? '');
    const list = this.data.lists.find(({ id }) => id === listId);
    if (list === undefined || list.isInbox) {
      return;
    }
    wx.showActionSheet({
      itemList: ['删除清单'],
      success: () => {
        void apiClient
          .deleteList(listId)
          .then(() => {
            this.setData({
              lists: this.data.lists.filter(({ id }) => id !== listId)
            });
            if (readListContext()?.listId === listId) {
              clearListContext();
            }
          })
          .catch((error: unknown) => {
            void wx.showToast({ title: messageFor(error), icon: 'none' });
          });
      }
    });
  }
});
