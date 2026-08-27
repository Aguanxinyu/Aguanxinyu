import { ApiClientError } from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';
import type { ClientTask, TodoState } from '../../stores/todo-store.js';
import {
  buildMonthGrid,
  buildWeekStrip,
  dateKeyFromTimestamp,
  dayStartMs,
  formatDaySubtitle,
  formatDayTitle,
  formatDueLabel,
  monthKeyFromDateKey,
  monthTitle,
  shiftDateKey,
  todayKey,
  type DayCell
} from '../../utils/calendar.js';
import { getCustomNavInset } from '../../utils/layout.js';

interface DisplayTask extends ClientTask {
  readonly dueLabel: string;
  readonly done: boolean;
  readonly priorityLabel: string;
  readonly dayKey: string | null;
}

const PRIORITY_LABELS: Readonly<Record<ClientTask['priority'], string>> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低'
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function displayTask(task: ClientTask): DisplayTask {
  const dayKey =
    task.occurrenceDate ?? (task.dueAt === undefined ? null : dateKeyFromTimestamp(task.dueAt));
  const dueLabel =
    task.dueAt === undefined ? '未设置时间' : formatDueLabel(task.dueAt, task.dueHasTime);
  return {
    ...task,
    dueLabel,
    done: task.status === 'DONE',
    priorityLabel: PRIORITY_LABELS[task.priority],
    dayKey
  };
}

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

function calendarView(
  selectedDate: string,
  monthCursor: string,
  now = Date.now()
): {
  readonly weekDays: readonly DayCell[];
  readonly monthDays: readonly DayCell[];
  readonly monthTitle: string;
  readonly dayTitle: string;
  readonly daySubtitle: string;
  readonly isSelectedToday: boolean;
} {
  return {
    weekDays: buildWeekStrip(selectedDate, now),
    monthDays: buildMonthGrid(monthCursor, now),
    monthTitle: monthTitle(monthCursor),
    dayTitle: formatDayTitle(selectedDate, now),
    daySubtitle: formatDaySubtitle(selectedDate),
    isSelectedToday: selectedDate === todayKey(now)
  };
}

function tasksForDay(
  tasks: readonly ClientTask[],
  selectedDate: string,
  now = Date.now()
): readonly DisplayTask[] {
  const today = todayKey(now);
  return tasks
    .filter(({ status }) => status !== 'TRASHED')
    .map(displayTask)
    .filter((task) => {
      if (task.dayKey === selectedDate) {
        return true;
      }
      return task.dayKey === null && selectedDate === today;
    });
}

function emptyLabelFor(selectedDate: string, now = Date.now()): string {
  return selectedDate === todayKey(now)
    ? '今天还没有安排，先写下第一件事'
    : `${formatDayTitle(selectedDate, now)}没有记录的安排`;
}

let unsubscribe: (() => void) | undefined;
let cachedTasks: readonly ClientTask[] = [];
let dayLoadToken = 0;

Page({
  data: {
    selectedDate: todayKey(),
    monthCursor: monthKeyFromDateKey(todayKey()),
    calendarOpen: false,
    weekdayLabels: WEEKDAY_LABELS,
    weekDays: [] as readonly DayCell[],
    monthDays: [] as readonly DayCell[],
    monthTitle: '',
    dayTitle: '今天',
    daySubtitle: '',
    isSelectedToday: true,
    emptyLabel: '今天还没有安排，先写下第一件事',
    tasks: [] as readonly DisplayTask[],
    quickTitle: '',
    loading: false,
    loadingDay: false,
    loadingMore: false,
    hasMore: false,
    pendingCount: 0,
    navPaddingTop: 88
  },

  onLoad() {
    const selectedDate = todayKey();
    const monthCursor = monthKeyFromDateKey(selectedDate);
    const navPaddingTop = getCustomNavInset();
    this.setData({
      selectedDate,
      monthCursor,
      navPaddingTop,
      ...calendarView(selectedDate, monthCursor),
      emptyLabel: emptyLabelFor(selectedDate)
    });
    unsubscribe = todoController.subscribe((state: TodoState) => {
      cachedTasks = state.tasks;
      this.setData({
        tasks: tasksForDay(state.tasks, this.data.selectedDate),
        pendingCount: state.pendingMutations.length,
        hasMore: state.hasMore,
        emptyLabel: emptyLabelFor(this.data.selectedDate)
      });
    });
  },

  onUnload() {
    unsubscribe?.();
    unsubscribe = undefined;
  },

  onShow() {
    const selectedDate = this.data.selectedDate;
    const monthCursor = this.data.monthCursor;
    this.setData(calendarView(selectedDate, monthCursor));
    void this.loadSelectedDay(selectedDate);
  },

  async loadSelectedDay(selectedDate: string): Promise<void> {
    const token = ++dayLoadToken;
    this.setData({ loadingDay: true });
    try {
      if (selectedDate === todayKey()) {
        await todoController.refresh();
      } else {
        await todoController.refreshDay(selectedDate);
      }
      if (token !== dayLoadToken) {
        return;
      }
      this.setData({
        tasks: tasksForDay(todoController.getState().tasks, selectedDate),
        emptyLabel: emptyLabelFor(selectedDate)
      });
    } catch (error) {
      if (token === dayLoadToken) {
        void wx.showToast({ title: messageFor(error), icon: 'none' });
      }
    } finally {
      if (token === dayLoadToken) {
        this.setData({ loadingDay: false });
      }
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadSelectedDay(this.data.selectedDate);
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
        dueAt: dayStartMs(this.data.selectedDate) + 18 * 60 * 60 * 1000,
        dueHasTime: false,
        tagIds: []
      });
      this.setData({ quickTitle: '' });
      void wx.showToast({ title: '已添加到这一天', icon: 'success' });
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

  onOpenTask(event: WechatMiniprogram.BaseEvent) {
    const taskId = String(event.currentTarget.dataset.id ?? '');
    if (taskId.length === 0) {
      return;
    }
    void wx.navigateTo({
      url: `/pages/task-edit/index?id=${encodeURIComponent(taskId)}`
    });
  },

  async onReachBottom() {
    if (this.data.loadingMore || this.data.selectedDate !== todayKey()) {
      return;
    }
    this.setData({ loadingMore: true });
    try {
      await todoController.loadMore();
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ loadingMore: false });
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
    const date = this.data.selectedDate;
    void wx.navigateTo({
      url: `/pages/task-edit/index?date=${encodeURIComponent(date)}`
    });
  },

  onToggleCalendar() {
    this.setData({
      calendarOpen: !this.data.calendarOpen,
      monthCursor: monthKeyFromDateKey(this.data.selectedDate),
      ...calendarView(this.data.selectedDate, monthKeyFromDateKey(this.data.selectedDate))
    });
  },

  onCloseCalendar() {
    this.setData({ calendarOpen: false });
  },

  noop() {},

  onSelectDay(event: WechatMiniprogram.BaseEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    if (key.length === 0 || key === this.data.selectedDate) {
      this.setData({ calendarOpen: false });
      return;
    }
    const monthCursor = monthKeyFromDateKey(key);
    this.setData({
      selectedDate: key,
      monthCursor,
      calendarOpen: false,
      tasks: tasksForDay(cachedTasks, key),
      emptyLabel: emptyLabelFor(key),
      ...calendarView(key, monthCursor)
    });
    void this.loadSelectedDay(key);
  },

  onShiftMonth(event: WechatMiniprogram.BaseEvent) {
    const delta = Number(event.currentTarget.dataset.delta ?? 0);
    const nextMonth = shiftDateKey(this.data.monthCursor, delta * 32);
    const monthCursor = monthKeyFromDateKey(nextMonth);
    this.setData({
      monthCursor,
      monthDays: buildMonthGrid(monthCursor),
      monthTitle: monthTitle(monthCursor)
    });
  },

  onJumpToday() {
    const key = todayKey();
    const monthCursor = monthKeyFromDateKey(key);
    this.setData({
      selectedDate: key,
      monthCursor,
      calendarOpen: false,
      tasks: tasksForDay(cachedTasks, key),
      emptyLabel: emptyLabelFor(key),
      ...calendarView(key, monthCursor)
    });
    void this.loadSelectedDay(key);
  }
});
