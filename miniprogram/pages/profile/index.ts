import { ApiClientError, apiClient } from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';
import { formatShanghaiDate } from '../../utils/calendar.js';
import { getCustomNavInset } from '../../utils/layout.js';

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

Page({
  data: {
    syncing: false,
    navPaddingTop: 88
  },

  onLoad() {
    this.setData({ navPaddingTop: getCustomNavInset() });
  },

  onOpenTrash() {
    void wx.navigateTo({ url: '/pages/trash/index' });
  },

  onOpenWeeklyReview() {
    void wx.navigateTo({ url: '/pages/weekly-review/index' });
  },

  async onSync() {
    this.setData({ syncing: true });
    try {
      await todoController.refresh();
      void wx.showToast({ title: '同步完成', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ syncing: false });
    }
  },

  onDeleteAccount() {
    wx.showModal({
      title: '申请注销账号',
      content: '所有会话会立即退出，数据将在 7 天后永久删除。该操作提交后不可在小程序内撤销。',
      confirmText: '确认注销',
      confirmColor: '#DC2626',
      success: ({ confirm }) => {
        if (!confirm) {
          return;
        }
        void apiClient
          .startAccountDeletion()
          .then(({ purgeAfterAt }) => {
            apiClient.clearSession();
            const date = formatShanghaiDate(purgeAfterAt);
            void wx.showModal({
              title: '注销申请已提交',
              content: `账号数据预计在 ${date} 后永久删除。`,
              showCancel: false
            });
          })
          .catch((error: unknown) => {
            void wx.showToast({ title: messageFor(error), icon: 'none' });
          });
      }
    });
  }
});
