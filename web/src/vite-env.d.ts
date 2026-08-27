/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WECHAT_WEB_APP_ID?: string;
  readonly VITE_WECHAT_REDIRECT_URI?: string;
  readonly VITE_ALLOW_DEV_LOGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
