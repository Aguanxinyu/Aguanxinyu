export type AuthChannel = 'miniprogram' | 'web';

export interface WeChatIdentity {
  readonly channel: AuthChannel;
  readonly mpOpenId?: string;
  readonly webOpenId?: string;
  readonly unionId?: string;
}

export interface UserIdentitySnapshot {
  readonly id: string;
  readonly mpOpenId?: string;
  readonly webOpenId?: string;
  readonly unionId?: string;
}

export interface IdentityLookup {
  readonly byUnionId?: UserIdentitySnapshot;
  readonly byMpOpenId?: UserIdentitySnapshot;
  readonly byWebOpenId?: UserIdentitySnapshot;
}

export interface IdentityCreateDecision {
  readonly type: 'create';
  readonly mpOpenId?: string;
  readonly webOpenId?: string;
  readonly unionId?: string;
}

export interface IdentityUseDecision {
  readonly type: 'use';
  readonly userId: string;
  readonly patch: {
    readonly mpOpenId?: string;
    readonly webOpenId?: string;
    readonly unionId?: string;
  };
}

export interface IdentityConflictDecision {
  readonly type: 'conflict';
}

export type IdentityMergeDecision =
  IdentityCreateDecision | IdentityUseDecision | IdentityConflictDecision;

function channelUser(
  identity: WeChatIdentity,
  lookup: IdentityLookup
): UserIdentitySnapshot | undefined {
  return identity.channel === 'miniprogram' ? lookup.byMpOpenId : lookup.byWebOpenId;
}

function buildPatch(
  target: UserIdentitySnapshot,
  identity: WeChatIdentity
): IdentityUseDecision['patch'] {
  const patch: {
    mpOpenId?: string;
    webOpenId?: string;
    unionId?: string;
  } = {};
  if (identity.mpOpenId !== undefined && target.mpOpenId === undefined) {
    patch.mpOpenId = identity.mpOpenId;
  }
  if (identity.webOpenId !== undefined && target.webOpenId === undefined) {
    patch.webOpenId = identity.webOpenId;
  }
  if (identity.unionId !== undefined && target.unionId === undefined) {
    patch.unionId = identity.unionId;
  }
  return patch;
}

/**
 * Resolve how a WeChat login identity should map onto users.
 * Conflict when unionid and channel openid point at different users.
 */
export function resolveIdentityMerge(
  identity: WeChatIdentity,
  lookup: IdentityLookup
): IdentityMergeDecision {
  const byChannel = channelUser(identity, lookup);
  if (
    lookup.byUnionId !== undefined &&
    byChannel !== undefined &&
    lookup.byUnionId.id !== byChannel.id
  ) {
    return { type: 'conflict' };
  }

  const target = lookup.byUnionId ?? byChannel;
  if (target === undefined) {
    return {
      type: 'create',
      ...(identity.mpOpenId === undefined ? {} : { mpOpenId: identity.mpOpenId }),
      ...(identity.webOpenId === undefined ? {} : { webOpenId: identity.webOpenId }),
      ...(identity.unionId === undefined ? {} : { unionId: identity.unionId })
    };
  }

  return {
    type: 'use',
    userId: target.id,
    patch: buildPatch(target, identity)
  };
}
