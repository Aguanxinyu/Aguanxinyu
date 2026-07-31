import { ApiClientError, apiClient, type ClientList } from '../../services/api.js';

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

Page({
  data: {
    lists: [] as readonly ClientList[],
    newName: '',
    loading: false
  },

  onShow() {
    void this.loadLists();
  },

  async loadLists() {
    this.setData({ loading: true });
    try {
      this.setData({ lists: await apiClient.listLists() });
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
        lists: [...this.data.lists, list],
        newName: ''
      });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    }
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
          })
          .catch((error: unknown) => {
            void wx.showToast({ title: messageFor(error), icon: 'none' });
          });
      }
    });
  }
});
