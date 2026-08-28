import { ApiClientError } from '../../services/api.js';
import { todoController } from '../../stores/todo-controller.js';
import type { ClientTask, TodoState } from '../../stores/todo-store.js';
import {
  applyTaskMarkers,
  buildMonthGrid,
  buildWeekStrip,
  collectDatesWithTasks,
  dayStartMs,
  formatDaySubtitle,
  formatDayTitle,
  formatScheduleLabel,
  monthKeyFromDateKey,
  monthTitle,
  shiftDateKey,
  taskBelongsToCalendarDay,
  todayKey,
  type DayCell
} from '../../utils/calendar.js';
import { getCustomNavInset } from '../../utils/layout.js';

interface DisplayTask extends ClientTask {
  readonly dueLabel: string;
  readonly done: boolean;
  readonly priorityLabel: string;
}

const PRIORITY_LABELS: Readonly<Record<ClientTask['priority'], string>> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低'
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;
const LIST_FILTER_KEY = 'today-todo:list-filter';

interface ListFilter {
  readonly listId: string;
  readonly listName: string;
}

function readListFilter(): ListFilter | null {
  const raw = wx.getStorageSync<unknown>(LIST_FILTER_KEY);
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Readonly<Record<string, unknown>>;
  if (typeof candidate.listId !== 'string' || typeof candidate.listName !== 'string') {
    return null;
  }
  return { listId: candidate.listId, listName: candidate.listName };
}

function displayTask(task: ClientTask): DisplayTask {
  const dueLabel = formatScheduleLabel({
    startHasTime: task.startHasTime,
    dueHasTime: task.dueHasTime,
    ...(task.startAt === undefined ? {} : { startAt: task.startAt }),
    ...(task.dueAt === undefined ? {} : { dueAt: task.dueAt })
  });
  return {
    ...task,
    dueLabel,
    done: task.status === 'DONE',
    priorityLabel: PRIORITY_LABELS[task.priority]
  };
}

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

function monthGridRange(monthCursor: string): { readonly from: string; readonly to: string } {
  const grid = buildMonthGrid(monthCursor);
  const first = grid[0]?.key;
  const last = grid[grid.length - 1]?.key;
  if (first === undefined || last === undefined) {
    const key = monthKeyFromDateKey(monthCursor);
    return { from: key, to: key };
  }
  return { from: first, to: last };
}

function calendarView(
  selectedDate: string,
  monthCursor: string,
  monthTasks: readonly ClientTask[],
  now = Date.now()
): {
  readonly weekDays: readonly DayCell[];
  readonly monthDays: readonly DayCell[];
  readonly monthTitle: string;
  readonly dayTitle: string;
  readonly daySubtitle: string;
  readonly isSelectedToday: boolean;
} {
  const range = monthGridRange(monthCursor);
  const datesWithTasks = collectDatesWithTasks(monthTasks, range.from, range.to, now);
  return {
    weekDays: buildWeekStrip(selectedDate, now),
    monthDays: applyTaskMarkers(buildMonthGrid(monthCursor, now), datesWithTasks),
    monthTitle: monthTitle(monthCursor),
    dayTitle: formatDayTitle(selectedDate, now),
    daySubtitle: formatDaySubtitle(selectedDate),
    isSelectedToday: selectedDate === todayKey(now)
  };
}

function tasksForDay(
  tasks: readonly ClientTask[],
  selectedDate: string,
  listFilter: ListFilter | null,
  now = Date.now()
): readonly DisplayTask[] {
  return tasks
    .filter(({ status }) => status !== 'TRASHED')
    .filter((task) => (listFilter === null ? true : task.listId === listFilter.listId))
    .filter((task) => taskBelongsToCalendarDay(task, selectedDate, now))
    .map(displayTask);
}

function emptyLabelFor(
  selectedDate: string,
  listFilter: ListFilter | null,
  now = Date.now()
): string {
  const dayLabel = selectedDate === todayKey(now) ? '今天' : formatDayTitle(selectedDate, now);
  if (listFilter !== null) {
    return `${dayLabel}在「${listFilter.listName}」没有待办`;
  }
  return selectedDate === todayKey(now)
    ? '今天还没有安排，先写下第一件事'
    : `${dayLabel}没有记录的安排`;
}

let unsubscribe: (() => void) | undefined;
let cachedTasks: readonly ClientTask[] = [];
let monthTasks: readonly ClientTask[] = [];
let dayLoadToken = 0;
let monthLoadToken = 0;

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
    listFilterName: '',
    tasks: [] as readonly DisplayTask[],
    quickTitle: '',
    loading: false,
    loadingDay: false,
    loadingMonth: false,
    loadingMore: false,
    hasMore: false,
    pendingCount: 0,
    navPaddingTop: 88
  },

  onLoad() {
    const selectedDate = todayKey();
    const monthCursor = monthKeyFromDateKey(selectedDate);
    const navPaddingTop = getCustomNavInset();
    const listFilter = readListFilter();
    this.setData({
      selectedDate,
      monthCursor,
      navPaddingTop,
      listFilterName: listFilter?.listName ?? '',
      ...calendarView(selectedDate, monthCursor, monthTasks),
      emptyLabel: emptyLabelFor(selectedDate, listFilter)
    });
    unsubscribe = todoController.subscribe((state: TodoState) => {
      cachedTasks = state.tasks;
      const filter = readListFilter();
      this.setData({
        tasks: tasksForDay(state.tasks, this.data.selectedDate, filter),
        pendingCount: state.pendingMutations.length,
        hasMore: state.hasMore,
        emptyLabel: emptyLabelFor(this.data.selectedDate, filter),
        ...(this.data.calendarOpen
          ? calendarView(this.data.selectedDate, this.data.monthCursor, monthTasks)
          : {})
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
    const listFilter = readListFilter();
    this.setData({
      listFilterName: listFilter?.listName ?? '',
      ...calendarView(selectedDate, monthCursor, monthTasks),
      tasks: tasksForDay(cachedTasks, selectedDate, listFilter),
      emptyLabel: emptyLabelFor(selectedDate, listFilter)
    });
    void this.loadSelectedDay(selectedDate);
    if (this.data.calendarOpen) {
      void this.loadMonthTasks(monthCursor);
    }
  },

  onClearListFilter() {
    wx.removeStorageSync(LIST_FILTER_KEY);
    const selectedDate = this.data.selectedDate;
    this.setData({
      listFilterName: '',
      tasks: tasksForDay(cachedTasks, selectedDate, null),
      emptyLabel: emptyLabelFor(selectedDate, null)
    });
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
      const listFilter = readListFilter();
      this.setData({
        tasks: tasksForDay(todoController.getState().tasks, selectedDate, listFilter),
        emptyLabel: emptyLabelFor(selectedDate, listFilter)
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

  async loadMonthTasks(monthCursor: string): Promise<void> {
    const token = ++monthLoadToken;
    this.setData({ loadingMonth: true });
    try {
      const { from, to } = monthGridRange(monthCursor);
      monthTasks = await todoController.refreshRange(from, to);
      if (token !== monthLoadToken) {
        return;
      }
      this.setData(calendarView(this.data.selectedDate, monthCursor, monthTasks));
    } catch (error) {
      if (token === monthLoadToken) {
        void wx.showToast({ title: messageFor(error), icon: 'none' });
      }
    } finally {
      if (token === monthLoadToken) {
        this.setData({ loadingMonth: false });
      }
    }
  },

  async onPullDownRefresh() {
    try {
      await this.loadSelectedDay(this.data.selectedDate);
      if (this.data.calendarOpen) {
        await this.loadMonthTasks(this.data.monthCursor);
      }
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
    const listFilter = readListFilter();
    this.setData({ loading: true });
    try {
      await todoController.create({
        title,
        priority: 'MEDIUM',
        startHasTime: false,
        dueAt: dayStartMs(this.data.selectedDate) + 18 * 60 * 60 * 1000,
        dueHasTime: false,
        tagIds: [],
        ...(listFilter === null ? {} : { listId: listFilter.listId })
      });
      this.setData({ quickTitle: '' });
      void wx.showToast({ title: '已添加到这一天', icon: 'success' });
      if (this.data.calendarOpen) {
        void this.loadMonthTasks(this.data.monthCursor);
      }
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
    const opening = !this.data.calendarOpen;
    const monthCursor = monthKeyFromDateKey(this.data.selectedDate);
    this.setData({
      calendarOpen: opening,
      monthCursor,
      ...calendarView(this.data.selectedDate, monthCursor, monthTasks)
    });
    if (opening) {
      void this.loadMonthTasks(monthCursor);
    }
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
    const listFilter = readListFilter();
    this.setData({
      selectedDate: key,
      monthCursor,
      calendarOpen: false,
      tasks: tasksForDay(cachedTasks, key, listFilter),
      emptyLabel: emptyLabelFor(key, listFilter),
      ...calendarView(key, monthCursor, monthTasks)
    });
    void this.loadSelectedDay(key);
  },

  onShiftMonth(event: WechatMiniprogram.BaseEvent) {
    const delta = Number(event.currentTarget.dataset.delta ?? 0);
    const nextMonth = shiftDateKey(this.data.monthCursor, delta * 32);
    const monthCursor = monthKeyFromDateKey(nextMonth);
    this.setData({
      monthCursor,
      ...calendarView(this.data.selectedDate, monthCursor, monthTasks)
    });
    void this.loadMonthTasks(monthCursor);
  },

  onJumpToday() {
    const key = todayKey();
    const monthCursor = monthKeyFromDateKey(key);
    const listFilter = readListFilter();
    this.setData({
      selectedDate: key,
      monthCursor,
      calendarOpen: false,
      tasks: tasksForDay(cachedTasks, key, listFilter),
      emptyLabel: emptyLabelFor(key, listFilter),
      ...calendarView(key, monthCursor, monthTasks)
    });
    void this.loadSelectedDay(key);
  }
});
