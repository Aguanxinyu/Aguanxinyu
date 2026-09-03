import { getReminderTemplateId } from '../../config.js';
import {
  ApiClientError,
  apiClient,
  type ClientList,
  type CreateTaskInput,
  type UpdateTaskInput
} from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';
import { readListContext } from '../../utils/list-context.js';

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
const REPEATS = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
const INBOX_LIST_ID = 'inbox';
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

function listIndexFor(lists: readonly ClientList[], listId: string): number {
  const index = lists.findIndex(({ id }) => id === listId);
  return index === -1 ? 0 : index;
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
    lists: [] as readonly ClientList[],
    listNames: [] as readonly string[],
    listIndex: 0,
    selectedListId: INBOX_LIST_ID,
    startDate: today(),
    startTime: '09:00',
    hasStartDate: false,
    hasStartTime: false,
    dueDate: today(),
    dueTime: '18:00',
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

  onLoad(options: { id?: string; date?: string; listId?: string }) {
    const presetDate =
      typeof options.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
        ? options.date
        : today();
    const presetListId =
      typeof options.listId === 'string' && options.listId.length > 0
        ? options.listId
        : (readListContext()?.listId ?? INBOX_LIST_ID);
    if (options.id === undefined) {
      this.setData({
        startDate: presetDate,
        dueDate: presetDate,
        hasDueDate: typeof options.date === 'string',
        selectedListId: presetListId
      });
    }
    void this.loadLists(presetListId);
    const taskId = options.id;
    if (taskId !== undefined && taskId.length > 0) {
      this.setData({ id: taskId });
      void this.loadTask(taskId);
    }
  },

  async loadLists(preferredListId: string) {
    try {
      const lists = await apiClient.listLists();
      const listNames = lists.map(({ name }) => name);
      const listIndex = listIndexFor(lists, preferredListId);
      const selected = lists[listIndex];
      this.setData({
        lists,
        listNames,
        listIndex,
        selectedListId: selected?.id ?? INBOX_LIST_ID
      });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    }
  },

  async loadTask(taskId: string) {
    try {
      const [task, lists] = await Promise.all([apiClient.getTask(taskId), apiClient.listLists()]);
      const listNames = lists.map(({ name }) => name);
      const listIndex = listIndexFor(lists, task.listId);
      const priorityIndex = PRIORITIES.indexOf(task.priority);
      const dueParts =
        task.dueAt === undefined ? { date: today(), time: '18:00' } : formatDateTime(task.dueAt);
      const startParts =
        task.startAt === undefined
          ? { date: dueParts.date, time: '09:00' }
          : formatDateTime(task.startAt);
      this.setData({
        lists,
        listNames,
        listIndex,
        selectedListId: task.listId,
        pageTitle: '编辑待办',
        pageSubtitle: '修改后将同步到所有设备',
        version: task.version,
        title: task.title,
        notes: task.notes ?? '',
        priorityIndex: priorityIndex === -1 ? 1 : priorityIndex,
        startDate: startParts.date,
        startTime: startParts.time,
        hasStartDate: task.startAt !== undefined,
        hasStartTime: task.startHasTime,
        dueDate: dueParts.date,
        dueTime: dueParts.time,
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

  onListChange(event: WechatMiniprogram.PickerChange) {
    const listIndex = Number(event.detail.value);
    const list = this.data.lists[listIndex];
    if (list === undefined) {
      return;
    }
    this.setData({
      listIndex,
      selectedListId: list.id
    });
  },

  onRepeatChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ repeatIndex: Number(event.detail.value) });
  },

  onStartDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ startDate: String(event.detail.value), hasStartDate: true });
  },

  onStartTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({
      startTime: String(event.detail.value),
      hasStartDate: true,
      hasStartTime: true
    });
  },

  onDueDateChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ dueDate: String(event.detail.value), hasDueDate: true });
  },

  onDueTimeChange(event: WechatMiniprogram.PickerChange) {
    this.setData({
      dueTime: String(event.detail.value),
      hasDueDate: true,
      hasDueTime: true
    });
  },

  onStartDateSwitch(event: WechatMiniprogram.SwitchChange) {
    this.setData({
      hasStartDate: event.detail.value,
      hasStartTime: event.detail.value ? this.data.hasStartTime : false
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

  computeStartAt(): number | undefined {
    return this.data.hasStartDate
      ? new Date(
          `${this.data.startDate}T${this.data.hasStartTime ? this.data.startTime : '00:00'}:00+08:00`
        ).getTime()
      : undefined;
  },

  computeDueAt(): number | undefined {
    return this.data.hasDueDate
      ? new Date(
          `${this.data.dueDate}T${this.data.hasDueTime ? this.data.dueTime : '23:59'}:00+08:00`
        ).getTime()
      : undefined;
  },

  validateSchedule(startAt: number | undefined, dueAt: number | undefined): boolean {
    if (startAt !== undefined && dueAt !== undefined && startAt > dueAt) {
      void wx.showToast({ title: '开始时间不能晚于截止时间', icon: 'none' });
      return false;
    }
    return true;
  },

  async onSave() {
    const title = this.data.title.trim();
    if (title.length === 0 || this.data.saving) {
      void wx.showToast({ title: '请输入待办标题', icon: 'none' });
      return;
    }
    const startAt = this.computeStartAt();
    const dueAt = this.computeDueAt();
    if (!this.validateSchedule(startAt, dueAt)) {
      return;
    }
    if (this.data.reminderEnabled && (dueAt === undefined || dueAt - Date.now() < 10 * 60 * 1000)) {
      void wx.showToast({ title: '提醒时间至少需要提前 10 分钟', icon: 'none' });
      return;
    }
    if (this.data.id.length > 0 && this.data.repeatDisabled) {
      this.setData({ showScopeDialog: true });
      return;
    }
    await this.saveTask(title, startAt, dueAt);
  },

  onScopeOnlyThis() {
    this.setData({ showScopeDialog: false });
    void this.saveTask(this.data.title.trim(), this.computeStartAt(), this.computeDueAt());
  },

  onScopeCancel() {
    this.setData({ showScopeDialog: false });
  },

  async saveTask(title: string, startAt: number | undefined, dueAt: number | undefined) {
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
          listId: this.data.selectedListId,
          startHasTime: this.data.hasStartTime,
          dueHasTime: this.data.hasDueTime,
          reminderEnabled: reminderAccepted,
          notes: this.data.notes.trim().length === 0 ? null : this.data.notes.trim(),
          startAt: startAt ?? null,
          dueAt: dueAt ?? null,
          ...(this.data.locationName.trim().length === 0
            ? { location: null }
            : { location: { source: 'MANUAL' as const, name: this.data.locationName.trim() } })
        };
        await todoController.update(this.data.id, input, this.data.version);
      } else {
        const repeat = REPEATS[this.data.repeatIndex] ?? 'NONE';
        const baseInput: CreateTaskInput = {
          title,
          priority: PRIORITIES[this.data.priorityIndex] ?? 'MEDIUM',
          listId: this.data.selectedListId,
          startHasTime: this.data.hasStartTime,
          dueHasTime: this.data.hasDueTime,
          tagIds: [],
          reminderEnabled: reminderAccepted,
          ...(this.data.notes.trim().length === 0 ? {} : { notes: this.data.notes.trim() }),
          ...(startAt === undefined ? {} : { startAt }),
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
                        startDate: this.data.dueDate
                      }
                    : repeat === 'WEEKLY'
                      ? {
                          frequency: 'WEEKLY' as const,
                          startDate: this.data.dueDate,
                          weekdays: [new Date(`${this.data.dueDate}T00:00:00+08:00`).getDay() || 7]
                        }
                      : {
                          frequency: 'MONTHLY' as const,
                          startDate: this.data.dueDate,
                          monthDay: Number(this.data.dueDate.slice(-2))
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
