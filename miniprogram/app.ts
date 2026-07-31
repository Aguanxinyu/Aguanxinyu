import { ApiClientError } from './services/api.js';
import { todoController } from './stores/todo-controller.js';

App<IAppOption>({
  globalData: {
    token: null,
    userId: null
  },
  onLaunch() {
    todoController.hydrate();
    void todoController.refresh().catch((error: unknown) => {
      const message = error instanceof ApiClientError ? error.message : '待办同步失败，请稍后重试';
      wx.showToast({
        title: message,
        icon: 'none'
      });
    });
  }
});
