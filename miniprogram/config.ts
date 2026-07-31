interface ExternalConfig {
  readonly apiBaseUrl?: unknown;
  readonly reminderTemplateId?: unknown;
}

export function getApiBaseUrl(): string {
  const config = wx.getExtConfigSync() as ExternalConfig;
  if (typeof config.apiBaseUrl !== 'string' || !config.apiBaseUrl.startsWith('https://')) {
    throw new Error('API_BASE_URL_NOT_CONFIGURED');
  }
  return config.apiBaseUrl.replace(/\/$/, '');
}

export function getReminderTemplateId(): string | null {
  const config = wx.getExtConfigSync() as ExternalConfig;
  return typeof config.reminderTemplateId === 'string' && config.reminderTemplateId.length > 0
    ? config.reminderTemplateId
    : null;
}
