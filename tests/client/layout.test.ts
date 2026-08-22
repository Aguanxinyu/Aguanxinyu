import { describe, expect, it } from 'vitest';

import { computeCustomNavInset } from '../../miniprogram/utils/layout.js';

describe('custom navigation inset', () => {
  it('places content below the iPhone capsule', () => {
    expect(
      computeCustomNavInset(54, {
        top: 54,
        height: 32,
        width: 87,
        bottom: 86
      })
    ).toBe(94);
  });

  it('places content below the Android capsule', () => {
    expect(
      computeCustomNavInset(27, {
        top: 32,
        height: 32,
        width: 87,
        bottom: 64
      })
    ).toBe(72);
  });

  it('keeps a minimum gap when the capsule is missing', () => {
    expect(
      computeCustomNavInset(20, {
        top: 0,
        height: 0,
        width: 0
      })
    ).toBe(44);
  });
});
