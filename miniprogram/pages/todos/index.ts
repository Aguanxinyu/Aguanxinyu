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
import { clearListContext, readListContext, type ListContext } from '../../utils/list-context.js';
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

function filterTasksForList(
  tasks: readonly ClientTask[],
  listContext: ListContext | null
): readonly ClientTask[] {
  if (listContext === null) {
    return tasks.filter(({ status }) => status !== 'TRASHED');
  }
  return tasks.filter((task) => task.status !== 'TRASHED' && task.listId === listContext.listId);
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
  listContext: ListContext | null,
  now = Date.now()
): {
  readonly weekDays: readonly DayCell[];
  readonly monthDays: readonly DayCell[];
  readonly monthTitle: string;
  readonly dayTitle: string;
  readonly daySubtitle: string;
  readonly isSelectedToday: boolean;
} {
  const scopedTasks = filterTasksForList(monthTasks, listContext);
  const range = monthGridRange(monthCursor);
  const datesWithTasks = collectDatesWithTasks(scopedTasks, range.from, range.to, now);
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
  listContext: ListContext | null,
  now = Date.now()
): readonly DisplayTask[] {
  return filterTasksForList(tasks, listContext)
    .filter((task) => taskBelongsToCalendarDay(task, selectedDate, now))
    .map(displayTask);
}

function emptyLabelFor(
  selectedDate: string,
  listContext: ListContext | null,
  now = Date.now()
): string {
  const dayLabel = selectedDate === todayKey(now) ? '今天' : formatDayTitle(selectedDate, now);
  if (listContext !== null) {
    return `${dayLabel}在「${listContext.listName}」还没有安排`;
  }
  return selectedDate === todayKey(now)
    ? '今天还没有安排，先写下第一件事'
    : `${dayLabel}没有记录的安排`;
}

function quickPlaceholder(listContext: ListContext | null): string {
  if (listContext === null) {
    return '记到这一天…';
  }
  return `记到「${listContext.listName}」…`;
}

function pageHeadline(listContext: ListContext | null): string {
  return listContext === null ? '今日待办' : listContext.listName;
}

function pageContextLabel(listContext: ListContext | null): string {
  return listContext === null ? '全部待办 · 按日查看' : '场景清单 · 按日查看';
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
    inListWorkspace: false,
    listFilterId: '',
    listFilterName: '',
    pageHeadline: '今日待办',
    pageContextLabel: '全部待办 · 按日查看',
    quickPlaceholder: '记到这一天…',
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

  applyListContext(listContext: ListContext | null) {
    return {
      inListWorkspace: listContext !== null,
      listFilterId: listContext?.listId ?? '',
      listFilterName: listContext?.listName ?? '',
      pageHeadline: pageHeadline(listContext),
      pageContextLabel: pageContextLabel(listContext),
      quickPlaceholder: quickPlaceholder(listContext)
    };
  },

  refreshView(selectedDate: string, monthCursor: string, listContext: ListContext | null) {
    return {
      ...this.applyListContext(listContext),
      tasks: tasksForDay(cachedTasks, selectedDate, listContext),
      emptyLabel: emptyLabelFor(selectedDate, listContext),
      ...calendarView(selectedDate, monthCursor, monthTasks, listContext)
    };
  },

  onLoad() {
    const selectedDate = todayKey();
    const monthCursor = monthKeyFromDateKey(selectedDate);
    const navPaddingTop = getCustomNavInset();
    const listContext = readListContext();
    this.setData({
      selectedDate,
      monthCursor,
      navPaddingTop,
      ...this.refreshView(selectedDate, monthCursor, listContext)
    });
    unsubscribe = todoController.subscribe((state: TodoState) => {
      cachedTasks = state.tasks;
      const context = readListContext();
      this.setData({
        tasks: tasksForDay(state.tasks, this.data.selectedDate, context),
        pendingCount: state.pendingMutations.length,
        hasMore: state.hasMore,
        emptyLabel: emptyLabelFor(this.data.selectedDate, context),
        ...(this.data.calendarOpen
          ? calendarView(this.data.selectedDate, this.data.monthCursor, monthTasks, context)
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
    const listContext = readListContext();
    this.setData(this.refreshView(selectedDate, monthCursor, listContext));
    void this.loadSelectedDay(selectedDate);
    if (this.data.calendarOpen) {
      void this.loadMonthTasks(monthCursor);
    }
  },

  onExitListWorkspace() {
    clearListContext();
    const selectedDate = this.data.selectedDate;
    const monthCursor = this.data.monthCursor;
    this.setData(this.refreshView(selectedDate, monthCursor, null));
    void wx.switchTab({ url: '/pages/lists/index' });
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
      const listContext = readListContext();
      this.setData({
        tasks: tasksForDay(todoController.getState().tasks, selectedDate, listContext),
        emptyLabel: emptyLabelFor(selectedDate, listContext)
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
      const listContext = readListContext();
      this.setData(calendarView(this.data.selectedDate, monthCursor, monthTasks, listContext));
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
    const listContext = readListContext();
    this.setData({ loading: true });
    try {
      await todoController.create({
        title,
        priority: 'MEDIUM',
        startHasTime: false,
        dueAt: dayStartMs(this.data.selectedDate) + 18 * 60 * 60 * 1000,
        dueHasTime: false,
        tagIds: [],
        ...(listContext === null ? {} : { listId: listContext.listId })
      });
      this.setData({ quickTitle: '' });
      void wx.showToast({
        title: listContext === null ? '已添加到这一天' : `已加入「${listContext.listName}」`,
        icon: 'success'
      });
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
    const listContext = readListContext();
    const listQuery =
      listContext === null ? '' : `&listId=${encodeURIComponent(listContext.listId)}`;
    void wx.navigateTo({
      url: `/pages/task-edit/index?date=${encodeURIComponent(date)}${listQuery}`
    });
  },

  onToggleCalendar() {
    const opening = !this.data.calendarOpen;
    const monthCursor = monthKeyFromDateKey(this.data.selectedDate);
    const listContext = readListContext();
    this.setData({
      calendarOpen: opening,
      monthCursor,
      ...calendarView(this.data.selectedDate, monthCursor, monthTasks, listContext)
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
    const listContext = readListContext();
    this.setData({
      selectedDate: key,
      monthCursor,
      calendarOpen: false,
      ...this.refreshView(key, monthCursor, listContext)
    });
    void this.loadSelectedDay(key);
  },

  onShiftMonth(event: WechatMiniprogram.BaseEvent) {
    const delta = Number(event.currentTarget.dataset.delta ?? 0);
    const nextMonth = shiftDateKey(this.data.monthCursor, delta * 32);
    const monthCursor = monthKeyFromDateKey(nextMonth);
    const listContext = readListContext();
    this.setData({
      monthCursor,
      ...calendarView(this.data.selectedDate, monthCursor, monthTasks, listContext)
    });
    void this.loadMonthTasks(monthCursor);
  },

  onJumpToday() {
    const key = todayKey();
    const monthCursor = monthKeyFromDateKey(key);
    const listContext = readListContext();
    this.setData({
      selectedDate: key,
      monthCursor,
      calendarOpen: false,
      ...this.refreshView(key, monthCursor, listContext)
    });
    void this.loadSelectedDay(key);
  }
});
