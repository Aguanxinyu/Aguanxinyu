import { ApiClientError, apiClient, type WeeklyReviewClientView } from '../../services/api.js';
import { getCustomNavInset } from '../../utils/layout.js';
import { shiftDateKey } from '../../utils/calendar.js';

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

function formatRange(weekStart: string, weekEnd: string): string {
  const start = `${weekStart.slice(5, 7)}月${weekStart.slice(8, 10)}日`;
  const end = `${weekEnd.slice(5, 7)}月${weekEnd.slice(8, 10)}日`;
  return `${weekStart.slice(0, 4)}年${start} – ${end}`;
}

function shiftWeek(weekStart: string, deltaDays: number): string {
  return shiftDateKey(weekStart, deltaDays);
}

function emptyStats(): WeeklyReviewClientView['stats'] {
  return {
    total: 0,
    completed: 0,
    open: 0,
    overdueOpen: 0,
    highPriorityCompletionRate: 1,
    busiestDay: null,
    busiestDayCount: 0
  };
}

Page({
  data: {
    navPaddingTop: 88,
    activeTab: 'current',
    weekStart: '',
    weekEnd: '',
    weekRangeLabel: '',
    weekTag: '本周迄今',
    aiAllowed: false,
    stats: emptyStats(),
    highPriorityRate: '100%',
    busiestLabel: '暂无',
    review: null as WeeklyReviewClientView['review'],
    sourceLabel: '',
    generating: false,
    currentWeekStart: '',
    previousWeekStart: ''
  },

  onLoad() {
    this.setData({ navPaddingTop: getCustomNavInset() });
  },

  onShow() {
    void this.bootstrap();
  },

  async bootstrap(): Promise<void> {
    try {
      const view = await apiClient.getWeeklyReviewCurrent();
      const currentWeekStart =
        view.label === 'current' ? view.weekStart : shiftWeek(view.weekStart, 7);
      const previousWeekStart =
        view.label === 'previous' ? view.weekStart : shiftWeek(view.weekStart, -7);
      this.setData({
        currentWeekStart,
        previousWeekStart,
        activeTab: view.label === 'current' ? 'current' : 'previous'
      });
      this.applyView(view);
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    }
  },

  applyView(view: WeeklyReviewClientView): void {
    const rate = `${String(Math.round(view.stats.highPriorityCompletionRate * 100))}%`;
    const busiest =
      view.stats.busiestDay === null
        ? '暂无'
        : `${view.stats.busiestDay}（${String(view.stats.busiestDayCount)}）`;
    this.setData({
      weekStart: view.weekStart,
      weekEnd: view.weekEnd,
      weekRangeLabel: formatRange(view.weekStart, view.weekEnd),
      weekTag: view.isCompleteWeek ? '完整周' : '本周迄今',
      aiAllowed: view.aiAllowed,
      stats: view.stats,
      highPriorityRate: rate,
      busiestLabel: busiest,
      review: view.review,
      sourceLabel:
        view.review === null
          ? ''
          : view.review.source === 'model'
            ? `模型${view.review.model ? ` · ${view.review.model}` : ''}`
            : '规则分析'
    });
  },

  async onSwitchTab(event: WechatMiniprogram.BaseEvent): Promise<void> {
    const tab = String(event.currentTarget.dataset.tab ?? '');
    if (tab !== 'current' && tab !== 'previous') {
      return;
    }
    const weekStart = tab === 'current' ? this.data.currentWeekStart : this.data.previousWeekStart;
    if (weekStart.length === 0) {
      return;
    }
    this.setData({ activeTab: tab });
    try {
      const view = await apiClient.getWeeklyReview(weekStart);
      this.applyView(view);
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    }
  },

  async onGenerate(): Promise<void> {
    if (this.data.generating || !this.data.aiAllowed) {
      return;
    }
    this.setData({ generating: true });
    try {
      const review = await apiClient.generateWeeklyReview(this.data.weekStart);
      this.setData({
        review,
        sourceLabel:
          review.source === 'model' ? `模型${review.model ? ` · ${review.model}` : ''}` : '规则分析'
      });
      void wx.showToast({ title: '周报已生成', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ generating: false });
    }
  },

  onOpenImprovement(event: WechatMiniprogram.BaseEvent): void {
    const raw: unknown = event.currentTarget.dataset['ids'];
    let taskId = '';
    if (Array.isArray(raw) && raw.length > 0) {
      taskId = String(raw[0]);
    } else if (typeof raw === 'string') {
      taskId = raw;
    }
    if (taskId.length === 0) {
      void wx.showToast({ title: '相关任务已不存在', icon: 'none' });
      return;
    }
    void wx.navigateTo({
      url: `/pages/task-edit/index?id=${encodeURIComponent(taskId)}`
    });
  }
});
