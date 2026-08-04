export type DelayRange = {
  min: number;
  max: number;
};

export type Selectors = {
  openLoginTrigger: string;
  loginForm: string;
  usernameInput: string;
  passwordInput: string;
  agreeCheckbox: string;
  agreeChecked: string;
  loginButton: string;
  loggedInMarker: string;
  taskCheckbox: string;
  taskRow: string;
  nextButton: string;
  publishButton: string;
  successToast: string;
};

export type AppConfig = {
  baseUrl: string;
  loginPath: string;
  tasksPath: string;
  headless: boolean;
  concurrency: number;
  slowMoMs: number;
  navigationTimeoutMs: number;
  actionTimeoutMs: number;
  delayBetweenAccountsMs: DelayRange;
  delayBetweenActionsMs: DelayRange;
  maxTasksPerAccount: number;
  reuseStorageState: boolean;
  selectors: Selectors;
  paths: {
    accountsCsv: string;
    authDir: string;
    outputDir: string;
  };
};

export type Account = {
  id: string;
  username: string;
  password: string;
  note?: string;
  enabled: boolean;
};

export type RunStatus = "success" | "failed" | "skipped" | "dry-run";

export type AccountResult = {
  accountId: string;
  username: string;
  status: RunStatus;
  selectedCount: number;
  message: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};
