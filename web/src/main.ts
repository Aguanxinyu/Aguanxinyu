import './styles.css';
import {
  addDays,
  allowDevLogin,
  ApiClientError,
  clearSession,
  completeTask,
  consumeWechatOAuthState,
  createList,
  createTask,
  deleteList,
  generateWeeklyReview,
  getCurrentWeeklyReview,
  getToken,
  listLists,
  listTasks,
  listTrash,
  loginWithCode,
  logout,
  restoreTask,
  saveSession,
  shanghaiDateKey,
  startAccountDeletion,
  trashTask,
  uncompleteTask,
  updateTask,
  wechatQrConnectUrl,
  type Task,
  type TodoList,
  type WeeklyReviewView
} from './api';

type Route =
  | { name: 'login' }
  | { name: 'todos' }
  | { name: 'lists' }
  | { name: 'me' }
  | { name: 'trash' }
  | { name: 'weekly' };

const appEl = document.querySelector('#app');
if (!(appEl instanceof HTMLElement)) {
  throw new Error('#app missing');
}
const app: HTMLElement = appEl;

let selectedDate = shanghaiDateKey();

function parseRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const path = hash.split('?')[0] ?? '';
  if (path === 'lists') return { name: 'lists' };
  if (path === 'me') return { name: 'me' };
  if (path === 'trash') return { name: 'trash' };
  if (path === 'weekly' || path === 'weekly-review') return { name: 'weekly' };
  if (path === 'login') return { name: 'login' };
  return { name: 'todos' };
}

function navigate(path: string): void {
  window.location.hash = `#/${path}`;
}

function requireAuth(route: Route): boolean {
  if (route.name === 'login') {
    return true;
  }
  if (getToken() === null) {
    navigate('login');
    return false;
  }
  return true;
}

function formString(data: FormData, key: string, fallback = ''): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function showError(target: HTMLElement, error: unknown): void {
  const message =
    error instanceof ApiClientError
      ? error.message
      : error instanceof Error
        ? error.message
        : '操作失败';
  target.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
}

function shell(active: Route['name'], body: string): string {
  return `
    <div class="shell">
      <header class="topnav">
        <div class="brand">今日待办</div>
        <nav class="nav-links">
          <a href="#/" class="${active === 'todos' ? 'active' : ''}">待办</a>
          <a href="#/lists" class="${active === 'lists' ? 'active' : ''}">清单</a>
          <a href="#/me" class="${active === 'me' || active === 'trash' || active === 'weekly' ? 'active' : ''}">我的</a>
        </nav>
      </header>
      ${body}
    </div>
  `;
}

function priorityLabel(priority: Task['priority']): string {
  return priority === 'HIGH' ? '高' : priority === 'LOW' ? '低' : '中';
}

function formatDue(task: Task): string {
  if (task.dueAt === undefined) {
    return '无日期';
  }
  const key = shanghaiDateKey(task.dueAt);
  if (!task.dueHasTime) {
    return key;
  }
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(task.dueAt));
  return `${key} ${time}`;
}

function weekStripHtml(center: string): string {
  const start = addDays(center, -3);
  const chips: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const key = addDays(start, i);
    const day = key.slice(8);
    const active = key === center ? 'active' : '';
    chips.push(
      `<button type="button" class="day-chip ${active}" data-date="${key}"><span>${key.slice(5, 7)}/${day}</span><strong>${day}</strong></button>`
    );
  }
  return `<div class="calendar-rail">${chips.join('')}</div>`;
}

async function renderLogin(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const hashQuery = window.location.hash.includes('?')
    ? new URLSearchParams(window.location.hash.split('?')[1])
    : null;
  const code = params.get('code') ?? hashQuery?.get('code') ?? null;

  if (code !== null && code.length > 0) {
    app.innerHTML = `<div class="hero-login"><div class="loading">正在登录…</div></div>`;
    try {
      const state = params.get('state') ?? hashQuery?.get('state') ?? null;
      if (!consumeWechatOAuthState(state)) {
        throw new ApiClientError(400, 'OAUTH_STATE_INVALID', '登录请求已失效，请重新扫码');
      }
      const auth = await loginWithCode(code, 'web');
      saveSession(auth);
      window.history.replaceState({}, '', `${window.location.pathname}#/`);
      navigate('');
      await render();
    } catch (error) {
      showError(app, error);
    }
    return;
  }

  const qrUrl = wechatQrConnectUrl();
  const dev = allowDevLogin();
  app.innerHTML = `
    <div class="hero-login">
      <div class="hero-panel">
        <h1 class="brand">今日待办</h1>
        <p>在浏览器里管理与小程序同步的待办。使用微信扫码登录后即可开始。</p>
        ${
          qrUrl === null
            ? `<p class="error">尚未配置网站应用 AppID。请设置 VITE_WECHAT_WEB_APP_ID，或开启开发登录。</p>`
            : `<a class="btn btn-primary" href="${qrUrl}">微信扫码登录</a>`
        }
        ${
          dev
            ? `<div style="margin-top:16px"><button type="button" class="btn btn-ghost" id="dev-login">开发登录</button></div>`
            : ''
        }
      </div>
    </div>
  `;
  document.querySelector('#dev-login')?.addEventListener('click', () => {
    void (async () => {
      try {
        const auth = await loginWithCode(`web-dev-${shanghaiDateKey()}`, 'web');
        saveSession(auth);
        navigate('');
      } catch (error) {
        showError(app, error);
      }
    })();
  });
}

async function renderTodos(): Promise<void> {
  app.innerHTML = shell('todos', `<div class="loading">加载中…</div>`);
  try {
    const tasks = await listTasks(selectedDate);
    const open = tasks.filter((task) => task.status !== 'TRASHED');
    app.innerHTML = shell(
      'todos',
      `
      <section class="masthead">
        <div>
          <h1>${selectedDate === shanghaiDateKey() ? '今天' : selectedDate}</h1>
          <div class="subtitle">${String(open.length)} 项安排 · 网页版</div>
        </div>
        <button type="button" class="btn btn-primary" id="open-editor">写</button>
      </section>
      ${weekStripHtml(selectedDate)}
      <form class="quick-add" id="quick-add">
        <input name="title" placeholder="快速添加待办，回车保存" maxlength="100" required />
        <button class="btn btn-primary" type="submit">添加</button>
      </form>
      <div class="task-list" id="task-list">
        ${
          open.length === 0
            ? `<div class="empty">这一天还没有安排。写一条吧。</div>`
            : open
                .map(
                  (task) => `
            <div class="task-row ${task.status === 'DONE' ? 'done' : ''}" data-id="${task.id}">
              <button type="button" class="task-toggle" data-action="toggle" data-id="${task.id}" aria-label="完成切换"></button>
              <div>
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">
                  <span class="priority priority-${task.priority}">${priorityLabel(task.priority)}</span>
                  ${escapeHtml(formatDue(task))}
                  ${task.notes !== undefined && task.notes.length > 0 ? ` · ${escapeHtml(task.notes.slice(0, 40))}` : ''}
                </div>
              </div>
              <div class="task-actions">
                <button type="button" data-action="edit" data-id="${task.id}">编辑</button>
                <button type="button" data-action="trash" data-id="${task.id}">删除</button>
              </div>
            </div>`
                )
                .join('')
        }
      </div>
      <div id="modal-root"></div>
    `
    );

    document.querySelectorAll<HTMLButtonElement>('.day-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedDate = chip.dataset.date ?? selectedDate;
        void renderTodos();
      });
    });

    document.querySelector('#quick-add')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      const title = new FormData(form).get('title');
      if (typeof title !== 'string' || title.trim().length === 0) {
        return;
      }
      void (async () => {
        const dueAt = Date.parse(`${selectedDate}T04:00:00+08:00`);
        await createTask({
          title: title.trim(),
          dueAt,
          dueHasTime: false
        });
        form.reset();
        await renderTodos();
      })().catch((error: unknown) => {
        showError(app, error);
      });
    });

    document.querySelector('#open-editor')?.addEventListener('click', () => {
      openTaskEditor();
    });

    document.querySelector('#task-list')?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest('button[data-action]');
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const taskId = button.dataset.id;
      const action = button.dataset.action;
      if (taskId === undefined || action === undefined) {
        return;
      }
      const task = open.find((item) => item.id === taskId);
      void (async () => {
        if (action === 'toggle' && task !== undefined) {
          if (task.status === 'DONE') {
            await uncompleteTask(taskId);
          } else {
            await completeTask(taskId);
          }
          await renderTodos();
        }
        if (action === 'trash') {
          await trashTask(taskId);
          await renderTodos();
        }
        if (action === 'edit' && task !== undefined) {
          openTaskEditor(task);
        }
      })().catch((error: unknown) => {
        showError(app, error);
      });
    });
  } catch (error) {
    showError(app, error);
  }
}

function openTaskEditor(task?: Task): void {
  const root = document.querySelector('#modal-root');
  if (!(root instanceof HTMLElement)) {
    return;
  }
  const dueKey = task?.dueAt !== undefined ? shanghaiDateKey(task.dueAt) : selectedDate;
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal" id="task-editor">
        <h3>${task === undefined ? '写一条待办' : '编辑待办'}</h3>
        <div class="stack">
          <label class="field">标题
            <input name="title" maxlength="100" required value="${escapeHtml(task?.title ?? '')}" />
          </label>
          <label class="field">备注
            <textarea name="notes" rows="3" maxlength="1000">${escapeHtml(task?.notes ?? '')}</textarea>
          </label>
          <label class="field">日期
            <input name="dueOn" type="date" value="${dueKey}" />
          </label>
          <label class="field">优先级
            <select name="priority">
              <option value="HIGH" ${task?.priority === 'HIGH' ? 'selected' : ''}>高</option>
              <option value="MEDIUM" ${task?.priority === 'MEDIUM' || task === undefined ? 'selected' : ''}>中</option>
              <option value="LOW" ${task?.priority === 'LOW' ? 'selected' : ''}>低</option>
            </select>
          </label>
          <label class="field">地点（手动）
            <input name="location" maxlength="100" value="${escapeHtml(task?.location?.name ?? '')}" />
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="cancel-editor">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    </div>
  `;
  document.querySelector('#cancel-editor')?.addEventListener('click', () => {
    root.innerHTML = '';
  });
  document.querySelector('#task-editor')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const title = formString(data, 'title').trim();
    const notes = formString(data, 'notes').trim();
    const dueOn = formString(data, 'dueOn', selectedDate);
    const priority = formString(data, 'priority', 'MEDIUM') as Task['priority'];
    const locationName = formString(data, 'location').trim();
    void (async () => {
      const dueAt = Date.parse(`${dueOn}T04:00:00+08:00`);
      if (task === undefined) {
        await createTask({
          title,
          ...(notes.length > 0 ? { notes } : {}),
          priority,
          dueAt,
          dueHasTime: false,
          ...(locationName.length > 0 ? { locationName } : {})
        });
      } else {
        await updateTask(task.id, {
          version: task.version,
          title,
          notes: notes.length > 0 ? notes : null,
          priority,
          dueAt,
          dueHasTime: false,
          location:
            locationName.length > 0 ? { source: 'MANUAL', name: locationName } : null
        });
      }
      root.innerHTML = '';
      selectedDate = dueOn;
      await renderTodos();
    })().catch((error: unknown) => {
      showError(root, error);
    });
  });
}

async function renderLists(): Promise<void> {
  app.innerHTML = shell('lists', `<div class="loading">加载中…</div>`);
  try {
    const lists = await listLists();
    app.innerHTML = shell(
      'lists',
      `
      <section class="masthead">
        <div>
          <h1>清单</h1>
          <div class="subtitle">整理任务的分组</div>
        </div>
      </section>
      <form class="quick-add" id="create-list">
        <input name="name" placeholder="新建清单名称" maxlength="20" required />
        <button class="btn btn-primary" type="submit">创建</button>
      </form>
      <div id="lists">
        ${lists
          .map(
            (list: TodoList) => `
          <div class="list-row" data-id="${list.id}">
            <div>${escapeHtml(list.name)}${list.isInbox ? ' · 收件箱' : ''}</div>
            ${
              list.isInbox
                ? ''
                : `<button type="button" class="btn btn-ghost" data-action="delete" data-id="${list.id}">删除</button>`
            }
          </div>`
          )
          .join('')}
      </div>
    `
    );
    document.querySelector('#create-list')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = new FormData(event.target as HTMLFormElement).get('name');
      if (typeof name !== 'string' || name.trim().length === 0) {
        return;
      }
      void createList(name.trim())
        .then(() => renderLists())
        .catch((error: unknown) => {
          showError(app, error);
        });
    });
    document.querySelector('#lists')?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const button = target.closest('button[data-action="delete"]');
      if (!(button instanceof HTMLButtonElement) || button.dataset.id === undefined) {
        return;
      }
      void deleteList(button.dataset.id)
        .then(() => renderLists())
        .catch((error: unknown) => {
          showError(app, error);
        });
    });
  } catch (error) {
    showError(app, error);
  }
}

function renderMe(): void {
  app.innerHTML = shell(
    'me',
    `
    <section class="masthead">
      <div>
        <h1>我的</h1>
        <div class="subtitle">账号与更多</div>
      </div>
    </section>
    <div class="panel">
      <h2>本周回顾</h2>
      <p>查看自然周统计与 AI 摘要（与小程序共用）。</p>
      <a class="btn btn-primary" href="#/weekly">打开本周回顾</a>
    </div>
    <div class="panel">
      <h2>回收站</h2>
      <p>30 天内可恢复已删除待办。</p>
      <a class="btn btn-ghost" href="#/trash">打开回收站</a>
    </div>
    <div class="panel">
      <h2>提醒</h2>
      <p>网页版不发送订阅消息。请在微信小程序中开启提醒。</p>
    </div>
    <div class="panel">
      <h2>会话</h2>
      <div class="stack">
        <button type="button" class="btn btn-ghost" id="logout">退出登录</button>
        <button type="button" class="btn btn-danger" id="delete-account">注销账号</button>
      </div>
    </div>
  `
  );
  document.querySelector('#logout')?.addEventListener('click', () => {
    void (async () => {
      try {
        await logout();
      } catch {
        // still clear local session
      }
      clearSession();
      navigate('login');
    })();
  });
  document.querySelector('#delete-account')?.addEventListener('click', () => {
    if (!window.confirm('确定注销？所有会话将立即失效，业务数据将在 7 天内删除。')) {
      return;
    }
    void startAccountDeletion()
      .then(() => {
        clearSession();
        navigate('login');
      })
      .catch((error: unknown) => {
        showError(app, error);
      });
  });
}

async function renderTrash(): Promise<void> {
  app.innerHTML = shell('trash', `<div class="loading">加载中…</div>`);
  try {
    const tasks = await listTrash();
    app.innerHTML = shell(
      'trash',
      `
      <section class="masthead">
        <div>
          <h1>回收站</h1>
          <div class="subtitle">${String(tasks.length)} 项</div>
        </div>
        <a class="btn btn-ghost" href="#/me">返回</a>
      </section>
      <div class="task-list">
        ${
          tasks.length === 0
            ? `<div class="empty">回收站是空的。</div>`
            : tasks
                .map(
                  (task) => `
            <div class="task-row">
              <div></div>
              <div>
                <div class="task-title">${escapeHtml(task.title)}</div>
                <div class="task-meta">${escapeHtml(formatDue(task))}</div>
              </div>
              <div class="task-actions">
                <button type="button" data-restore="${task.id}">恢复</button>
              </div>
            </div>`
                )
                .join('')
        }
      </div>
    `
    );
    document.querySelectorAll<HTMLButtonElement>('[data-restore]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.restore;
        if (id === undefined) return;
        void restoreTask(id)
          .then(() => renderTrash())
          .catch((error: unknown) => {
            showError(app, error);
          });
      });
    });
  } catch (error) {
    showError(app, error);
  }
}

async function renderWeekly(): Promise<void> {
  app.innerHTML = shell('weekly', `<div class="loading">加载中…</div>`);
  try {
    const view: WeeklyReviewView = await getCurrentWeeklyReview();
    app.innerHTML = shell(
      'weekly',
      `
      <section class="masthead">
        <div>
          <h1>本周回顾</h1>
          <div class="subtitle">${view.weekStart} → ${view.weekEnd}</div>
        </div>
        <a class="btn btn-ghost" href="#/me">返回</a>
      </section>
      <div class="panel">
        <h2>本周统计</h2>
        <p>创建 ${String(view.stats.total)} · 完成 ${String(view.stats.completed)} · 逾期 ${String(view.stats.overdueOpen)} · 完成率 ${String(view.stats.total === 0 ? 0 : Math.round((view.stats.completed / view.stats.total) * 100))}%</p>
        ${
          view.aiAllowed
            ? `<button type="button" class="btn btn-primary" id="generate-review">生成周报</button>`
            : `<p>当前周尚未到可生成 AI 周报的时间（周日 19:00 上海时区起）。</p>`
        }
      </div>
      ${
        view.review === null
          ? `<div class="empty">还没有生成周报。</div>`
          : `<div class="panel">
              <h2>${view.review.source === 'model' ? 'AI 摘要' : '规则摘要'}</h2>
              <p>${escapeHtml(view.review.summary)}</p>
              ${view.review.improvements
                .map(
                  (item) => `
                <div class="list-row">
                  <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <div class="task-meta">${escapeHtml(item.rationale)}</div>
                    <div class="task-meta">建议：${escapeHtml(item.suggestion)}</div>
                  </div>
                </div>`
                )
                .join('')}
            </div>`
      }
    `
    );
    document.querySelector('#generate-review')?.addEventListener('click', () => {
      void generateWeeklyReview(view.weekStart)
        .then(() => renderWeekly())
        .catch((error: unknown) => {
          showError(app, error);
        });
    });
  } catch (error) {
    showError(app, error);
  }
}

async function render(): Promise<void> {
  const route = parseRoute();
  if (!requireAuth(route)) {
    return;
  }
  if (route.name === 'login') {
    if (getToken() !== null) {
      navigate('');
      return;
    }
    await renderLogin();
    return;
  }
  if (route.name === 'lists') {
    await renderLists();
    return;
  }
  if (route.name === 'me') {
    renderMe();
    return;
  }
  if (route.name === 'trash') {
    await renderTrash();
    return;
  }
  if (route.name === 'weekly') {
    await renderWeekly();
    return;
  }
  await renderTodos();
}

window.addEventListener('hashchange', () => {
  void render();
});

void render();
