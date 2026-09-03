import { ApiClientError, apiClient, type DailyReviewClientView } from '../../services/api.js';
import { formatDayTitle, shiftDateKey, todayKey } from '../../utils/calendar.js';
import { getCustomNavInset } from '../../utils/layout.js';

function emptyStats(): DailyReviewClientView['stats'] {
  return {
    total: 0,
    completed: 0,
    open: 0,
    overdueOpen: 0,
    highPriorityOpen: 0,
    completionRate: 0
  };
}

function messageFor(error: unknown): string {
  return error instanceof ApiClientError ? error.message : '每日总结加载失败';
}

Page({
  data: {
    navPaddingTop: 88,
    date: todayKey(),
    dateLabel: '',
    isToday: true,
    isCompleteDay: false,
    needsRefresh: false,
    stats: emptyStats(),
    completionRate: '0%',
    review: null as DailyReviewClientView['review'],
    sourceLabel: '',
    loading: false,
    generating: false
  },

  onLoad(options: { date?: string }) {
    const date =
      typeof options.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
        ? options.date
        : todayKey();
    this.setData({ navPaddingTop: getCustomNavInset(), date });
  },

  onShow() {
    void this.loadReview();
  },

  async loadReview(): Promise<void> {
    this.setData({ loading: true });
    try {
      const view = await apiClient.getDailyReview(this.data.date);
      this.applyView(view);
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyView(view: DailyReviewClientView): void {
    this.setData({
      date: view.date,
      dateLabel: formatDayTitle(view.date),
      isToday: view.date === todayKey(),
      isCompleteDay: view.isCompleteDay,
      needsRefresh: view.needsRefresh,
      stats: view.stats,
      completionRate: `${String(Math.round(view.stats.completionRate * 100))}%`,
      review: view.review,
      sourceLabel:
        view.review === null
          ? ''
          : view.review.source === 'model'
            ? `AI${view.review.model ? ` · ${view.review.model}` : ''}`
            : '规则总结'
    });
  },

  async onGenerate(): Promise<void> {
    if (this.data.generating || this.data.stats.total === 0) {
      return;
    }
    this.setData({ generating: true });
    try {
      const review = await apiClient.generateDailyReview(this.data.date, this.data.review !== null);
      this.setData({
        review,
        needsRefresh: false,
        sourceLabel:
          review.source === 'model' ? `AI${review.model ? ` · ${review.model}` : ''}` : '规则总结'
      });
      void wx.showToast({ title: '每日总结已生成', icon: 'success' });
    } catch (error) {
      void wx.showToast({ title: messageFor(error), icon: 'none' });
    } finally {
      this.setData({ generating: false });
    }
  },

  onShiftDate(event: WechatMiniprogram.BaseEvent): void {
    const delta = Number(event.currentTarget.dataset.delta ?? 0);
    const date = shiftDateKey(this.data.date, delta);
    if (date > todayKey()) {
      return;
    }
    this.setData({ date, review: null, stats: emptyStats() });
    void this.loadReview();
  },

  onOpenTask(event: WechatMiniprogram.BaseEvent): void {
    const raw: unknown = event.currentTarget.dataset['ids'];
    const first = Array.isArray(raw) ? raw[0] : raw;
    const taskId = typeof first === 'string' || typeof first === 'number' ? String(first) : '';
    if (taskId.length > 0) {
      void wx.navigateTo({
        url: `/pages/task-edit/index?id=${encodeURIComponent(taskId)}`
      });
    }
  }
});
