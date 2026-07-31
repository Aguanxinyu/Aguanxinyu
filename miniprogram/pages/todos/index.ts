import { ApiClientError } from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';
import type { ClientTask, TodoState } from '../../stores/todo-store.js';

interface DisplayTask extends ClientTask {
  readonly dueLabel: string;
  readonly done: boolean;
}

function dateLabel(): string {
  const date = new Date();
  const weekday = '日一二三四五六'.charAt(date.getDay());
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 · 星期${weekday}`;
}

function displayTask(task: ClientTask): DisplayTask {
  const dueLabel =
    task.dueAt === undefined
      ? '未设置时间'
      : new Date(task.dueAt).toLocaleString('zh-CN', {
          month: 'numeric',
          day: 'numeric',
          hour: task.dueHasTime ? '2-digit' : undefined,
          minute: task.dueHasTime ? '2-digit' : undefined
        });
  return {
    ...task,
    dueLabel,
    done: task.status === 'DONE'
  };
}

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

let unsubscribe: (() => void) | undefined;

Page({
  data: {
    dateLabel: dateLabel(),
    tasks: [] as readonly DisplayTask[],
    quickTitle: '',
    loading: false,
    pendingCount: 0
  },

  onLoad() {
    unsubscribe = todoController.subscribe((state: TodoState) => {
      this.setData({
        tasks: state.tasks.filter(({ status }) => status !== 'TRASHED').map(displayTask),
        pendingCount: state.pendingMutations.length
      });
    });
  },

  onUnload() {
    unsubscribe?.();
    unsubscribe = undefined;
  },

  async onPullDownRefresh() {
    try {
      await todoController.refresh();
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      void wx.stopPullDownRefresh();
    }
  },

  onQuickInput(event: WechatMiniprogram.Input) {
    this.setData({ quickTitle: event.detail.value });
  },

  async onQuickAdd() {
    const title = this.data.quickTitle.trim();
    if (title.length === 0 || this.data.loading) {
      return;
    }
    this.setData({ loading: true });
    try {
      await todoController.create({
        title,
        priority: 'MEDIUM',
        dueHasTime: false,
        tagIds: []
      });
      this.setData({ quickTitle: '' });
      void wx.showToast({ title: '已添加', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async onToggle(event: WechatMiniprogram.BaseEvent) {
    const taskId = String(event.currentTarget.dataset.id ?? '');
    if (taskId.length === 0) {
      return;
    }
    try {
      await todoController.toggleTask(taskId);
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    }
  },

  onTaskMenu(event: WechatMiniprogram.BaseEvent) {
    const taskId = String(event.currentTarget.dataset.id ?? '');
    if (taskId.length === 0) {
      return;
    }
    wx.showActionSheet({
      itemList: ['移入回收站'],
      success: () => {
        void todoController.trashTask(taskId).catch((error: unknown) => {
          void wx.showToast({ title: messageFor(error), icon: 'none' });
        });
      }
    });
  },

  onOpenEditor() {
    void wx.navigateTo({ url: '/pages/task-edit/index' });
  }
});
