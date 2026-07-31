import { ApiClientError, apiClient } from '../../services/api.js';
import type { ClientTask } from '../../stores/todo-store.js';

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

Page({
  data: {
    tasks: [] as readonly ClientTask[],
    loading: false
  },

  onShow() {
    void this.loadTrash();
  },

  async loadTrash() {
    this.setData({ loading: true });
    try {
      this.setData({ tasks: await apiClient.listTrash() });
    } catch (error) {
      wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onRestore(event: WechatMiniprogram.BaseEvent) {
    const taskId = String(event.currentTarget.dataset.id ?? '');
    if (taskId.length === 0) {
      return;
    }
    try {
      await apiClient.restoreTask(taskId);
      this.setData({
        tasks: this.data.tasks.filter(({ id }) => id !== taskId)
      });
      wx.showToast({ title: '已恢复', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: messageFor(error), icon: 'none' });
    }
  }
});
