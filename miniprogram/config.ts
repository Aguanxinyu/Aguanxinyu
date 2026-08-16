const API_BASE_URL = 'https://todo.guanxinyu.com';
const REMINDER_TEMPLATE_ID = 'bEzUbq1ltmfsqWQuTES6mSrB6iFrjU9JyobcG57Cv8s';

export function getApiBaseUrl(): string {
  return API_BASE_URL.replace(/\/$/, '');
}

export function getReminderTemplateId(): string | null {
  return REMINDER_TEMPLATE_ID;
}
