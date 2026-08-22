/** Custom-nav insets so page chrome sits below the WeChat capsule. */

export interface MenuButtonBox {
  readonly top: number;
  readonly height: number;
  readonly width: number;
  readonly bottom?: number;
}

const FALLBACK_PADDING_TOP_PX = 88;

type WechatRuntime = {
  readonly getWindowInfo?: () => {
    readonly statusBarHeight: number;
  };
  readonly getMenuButtonBoundingClientRect?: () => MenuButtonBox;
};

export function computeCustomNavInset(
  statusBarHeight: number,
  menuButton: MenuButtonBox
): number {
  const menuBottom = menuButton.bottom ?? menuButton.top + menuButton.height;
  return Math.max(menuBottom + 8, statusBarHeight + 12, 44);
}

export function getCustomNavInset(): number {
  const wechat = (globalThis as { wx?: WechatRuntime }).wx;
  if (wechat?.getWindowInfo === undefined || wechat.getMenuButtonBoundingClientRect === undefined) {
    return FALLBACK_PADDING_TOP_PX;
  }
  try {
    const windowInfo = wechat.getWindowInfo();
    const menuButton = wechat.getMenuButtonBoundingClientRect();
    if (menuButton.width === 0) {
      return Math.max(windowInfo.statusBarHeight + 44, FALLBACK_PADDING_TOP_PX);
    }
    return computeCustomNavInset(windowInfo.statusBarHeight, menuButton);
  } catch {
    return FALLBACK_PADDING_TOP_PX;
  }
}
