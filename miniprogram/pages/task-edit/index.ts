import { getReminderTemplateId } from '../../config.js';
import {
  ApiClientError,
  apiClient,
  type CreateTaskInput,
  type UpdateTaskInput
} from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
const REPEATS = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
let navigationTimer: ReturnType<typeof setTimeout> | undefined;

function today(): string {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${String(date.getUTCFullYear())}-${month}-${day}`;
}

function formatDateTime(timestamp: number): { readonly date: string; readonly time: string } {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${String(date.getUTCFullYear())}-${month}-${day}`,
    time: `${hours}:${minutes}`
  };
}

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '保存失败，请稍后重试';
}

async function requestReminderPermission(): Promise<boolean> {
  const templateId = getReminderTemplateId();
  if (templateId === null) {
    throw new ApiClientError('REMINDER_NOT_CONFIGURED', '提醒模板尚未配置');
  }
  return new Promise<boolean>((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        resolve(result[templateId] === 'accept');
      },
      fail: () => {
        reject(new ApiClientError('REMINDER_PERMISSION_FAILED', '未能申请提醒权限'));
      }
    });
  });
}

Page({
  data: {
    pageTitle: '新建待办',
    pageSubtitle: '只填标题也可以立即保存',
    title: '',
    notes: '',
    priorityIndex: 1,
    priorities: ['高', '中', '低'],
    date: today(),
    time: '18:00',
    hasDueDate: false,
    hasDueTime: false,
    reminderEnabled: false,
    hadReminder: false,
    locationName: '',
    repeatIndex: 0,
    repeats: ['不重复', '每天', '每周', '每月'],
    repeatDisabled: false,
    showScopeDialog: false,
    id: '',
    version: 0,
    saving: false
  },

  onLoad(options: { id?: string; date?: string }) {
    const presetDate =
      typeof options.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
        ? options.date
        : today();
    if (options.id === undefined) {
      this.setData({
        date: presetDate,
        hasDueDate: typeof options.date === 'string'
      });
    }
    const taskId = options.id;
    if (taskId !== undefined && taskId.length > 0) {
      this.setData({ id: taskId });
      void this.loadTask(taskId);
    }
  },

  async loadTask(taskId: string) {
    try {
      const task = await apiClient.getTask(taskId);
      const priorityIndex = PRIORITIES.indexOf(task.priority);
      const { date, time } =
        task.dueAt === undefined ? { date: today(), time: '18:00' } : formatDateTime(task.dueAt);
      this.setData({
        pageTitle: '编辑待办',
        pageSubtitle: '修改后将同步到所有设备',
        version: task.version,
        title: task.title,
        notes: task.notes ?? '',
        priorityIndex: priorityIndex === -1 ? 1 : priorityIndex,
        date,
        time,
        hasDueDate: task.dueAt !== undefined,
        hasDueTime: task.dueHasTime,
        reminderEnabled: task.remindAt !== undefined,
        hadReminder: task.remindAt !== undefined,
        locationName: task.location?.name ?? '',
        repeatDisabled: task.seriesId !== undefined
      });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
      navigationTimer = setTimeout(() => void wx.navigateBack(), 400);
    }
  },

  onUnload() {
    if (navigationTimer !== undefined) {
      clearTimeout(navigationTimer);
      navigationTimer = undefined;
    }
  },

  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },

  onNotesInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ notes: event.detail.value });
  },

  onLocationInput(event: WechatMiniprogram.Input) {
    this.setData({ locationName: event.detail.value });
  },

  onPriorityChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ priorityIndex: Number(event.detail.value) });
  },

  onRepeatChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ repeatIndex: Number(event.detail.value) });
  },

  onDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ date: String(event.detail.value), hasDueDate: true });
  },

  onTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({
      time: String(event.detail.value),
      hasDueDate: true,
      hasDueTime: true
    });
  },

  onDueDateSwitch(event: WechatMiniprogram.SwitchChange) {
    this.setData({
      hasDueDate: event.detail.value,
      hasDueTime: event.detail.value ? this.data.hasDueTime : false,
      reminderEnabled: event.detail.value ? this.data.reminderEnabled : false
    });
  },

  onReminderSwitch(event: WechatMiniprogram.SwitchChange) {
    this.setData({
      reminderEnabled: event.detail.value,
      hasDueDate: event.detail.value ? true : this.data.hasDueDate,
      hasDueTime: event.detail.value ? true : this.data.hasDueTime
    });
  },

  computeDueAt(): number | undefined {
    return this.data.hasDueDate
      ? new Date(
          `${this.data.date}T${this.data.hasDueTime ? this.data.time : '23:59'}:00+08:00`
        ).getTime()
      : undefined;
  },

  async onSave() {
    const title = this.data.title.trim();
    if (title.length === 0 || this.data.saving) {
      void wx.showToast({ title: '请输入待办标题', icon: 'none' });
      return;
    }
    const dueAt = this.computeDueAt();
    if (this.data.reminderEnabled && (dueAt === undefined || dueAt - Date.now() < 10 * 60 * 1000)) {
      void wx.showToast({ title: '提醒时间至少需要提前 10 分钟', icon: 'none' });
      return;
    }
    if (this.data.id.length > 0 && this.data.repeatDisabled) {
      this.setData({ showScopeDialog: true });
      return;
    }
    await this.saveTask(title, dueAt);
  },

  onScopeOnlyThis() {
    this.setData({ showScopeDialog: false });
    void this.saveTask(this.data.title.trim(), this.computeDueAt());
  },

  onScopeCancel() {
    this.setData({ showScopeDialog: false });
  },

  async saveTask(title: string, dueAt: number | undefined) {
    this.setData({ saving: true });
    try {
      const isEdit = this.data.id.length > 0;
      let reminderAccepted = false;
      if (this.data.reminderEnabled) {
        if (isEdit && this.data.hadReminder) {
          reminderAccepted = true;
        } else {
          reminderAccepted = await requestReminderPermission();
          await apiClient.grantReminder(reminderAccepted);
        }
      }

      if (isEdit) {
        const input: UpdateTaskInput = {
          title,
          priority: PRIORITIES[this.data.priorityIndex] ?? 'MEDIUM',
          dueHasTime: this.data.hasDueTime,
          reminderEnabled: reminderAccepted,
          ...(this.data.notes.trim().length === 0 ? {} : { notes: this.data.notes.trim() }),
          ...(dueAt === undefined ? {} : { dueAt }),
          ...(this.data.locationName.trim().length === 0
            ? {}
            : { location: { source: 'MANUAL' as const, name: this.data.locationName.trim() } })
        };
        await todoController.update(this.data.id, input, this.data.version);
      } else {
        const repeat = REPEATS[this.data.repeatIndex] ?? 'NONE';
        const baseInput: CreateTaskInput = {
          title,
          priority: PRIORITIES[this.data.priorityIndex] ?? 'MEDIUM',
          dueHasTime: this.data.hasDueTime,
          tagIds: [],
          reminderEnabled: reminderAccepted,
          ...(this.data.notes.trim().length === 0 ? {} : { notes: this.data.notes.trim() }),
          ...(dueAt === undefined ? {} : { dueAt }),
          ...(this.data.locationName.trim().length === 0
            ? {}
            : {
                location: {
                  source: 'MANUAL' as const,
                  name: this.data.locationName.trim()
                }
              }),
          ...(repeat === 'NONE'
            ? {}
            : {
                recurrence:
                  repeat === 'DAILY'
                    ? {
                        frequency: 'DAILY' as const,
                        startDate: this.data.date
                      }
                    : repeat === 'WEEKLY'
                      ? {
                          frequency: 'WEEKLY' as const,
                          startDate: this.data.date,
                          weekdays: [new Date(`${this.data.date}T00:00:00+08:00`).getDay() || 7]
                        }
                      : {
                          frequency: 'MONTHLY' as const,
                          startDate: this.data.date,
                          monthDay: Number(this.data.date.slice(-2))
                        }
              })
        };
        await todoController.create(baseInput);
      }
      void wx.showToast({ title: '已保存', icon: 'success' });
      navigationTimer = setTimeout(() => {
        void wx.navigateBack();
      }, 400);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'VERSION_CONFLICT') {
        void wx.showToast({ title: '任务已被修改，请下拉刷新', icon: 'none' });
        navigationTimer = setTimeout(() => void wx.navigateBack(), 400);
        return;
      }
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
