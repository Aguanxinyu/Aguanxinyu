import { getReminderTemplateId } from '../../config.js';
import { ApiClientError, apiClient, type CreateTaskInput } from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
const REPEATS = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;

function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
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
    title: '',
    notes: '',
    priorityIndex: 1,
    priorities: ['高', '中', '低'],
    date: today(),
    time: '18:00',
    hasDueDate: false,
    hasDueTime: false,
    reminderEnabled: false,
    locationName: '',
    repeatIndex: 0,
    repeats: ['不重复', '每天', '每周', '每月'],
    saving: false
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

  async onSave() {
    const title = this.data.title.trim();
    if (title.length === 0 || this.data.saving) {
      void wx.showToast({ title: '请输入待办标题', icon: 'none' });
      return;
    }

    const dueAt = this.data.hasDueDate
      ? new Date(
          `${this.data.date}T${this.data.hasDueTime ? this.data.time : '23:59'}:00+08:00`
        ).getTime()
      : undefined;
    if (this.data.reminderEnabled && (dueAt === undefined || dueAt - Date.now() < 10 * 60 * 1000)) {
      void wx.showToast({ title: '提醒时间至少需要提前 10 分钟', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      let reminderAccepted = false;
      if (this.data.reminderEnabled) {
        reminderAccepted = await requestReminderPermission();
        await apiClient.grantReminder(reminderAccepted);
      }

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
      void wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        void wx.navigateBack();
      }, 400);
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
