// @flow
/* eslint-disable no-cond-assign */
import { effectTypes } from 'redux-saga';

import {
  ACTION_CHANNEL,
  ALL,
  CALL,
  CANCEL,
  CANCELLED,
  CPS,
  FLUSH,
  FORK,
  GET_CONTEXT,
  JOIN,
  NONE,
  PUT,
  RACE,
  SELECT,
  SET_CONTEXT,
  TAKE,
} from '../shared/keys';

import * as effectCheckers from '../shared/checkers'

import { mapValues } from '../utils/object';
import * as is from '@redux-saga/is'

const createEffectWithNestedEffects = type => (effect, extra) => ({
  type,
  effect,
  ...extra,
  mapEffects: Array.isArray(effect)
    ? f => effect.map(f)
    : f => mapValues(effect, f),
});

const createAll = createEffectWithNestedEffects(ALL);
const createRace = createEffectWithNestedEffects(RACE);

export default function parseEffect(effect: Object): Object {
  let parsedEffect;
  switch (true) {
    case is.notUndef((parsedEffect = effectCheckers.isTakeEffect(effect))):
      return {
        type: TAKE,
        effect: parsedEffect,
        providerKey: 'take',
      };

    case is.notUndef((parsedEffect = effectCheckers.isPutEffect(effect))):
      return {
        type: PUT,
        effect: parsedEffect,
        providerKey: 'put',
      };

    case is.notUndef((parsedEffect = effectCheckers.isRaceEffect(effect))):
      return createRace(parsedEffect, { providerKey: 'race' });

    case is.notUndef((parsedEffect = effectCheckers.isCallEffect(effect))):
      return {
        type: CALL,
        effect: parsedEffect,
        providerKey: 'call',
      };

    case is.notUndef((parsedEffect = effectCheckers.isCancelEffect(effect))):
      return {
        type: CANCEL,
        effect: parsedEffect,
        providerKey: 'cancel',
      };

    case is.notUndef((parsedEffect = effectCheckers.isCancelledEffect(effect))):
      return {
        type: CANCELLED,
        effect: parsedEffect,
        providerKey: 'cancelled',
      };

    case is.notUndef((parsedEffect = effectCheckers.isCpsEffect(effect))):
      return {
        type: CPS,
        effect: parsedEffect,
        providerKey: 'cps',
      };

    case is.notUndef((parsedEffect = effectCheckers.isFlushEffect(effect))):
      return {
        type: FLUSH,
        effect: parsedEffect,
        providerKey: 'flush',
      };

    case is.notUndef((parsedEffect = effectCheckers.isForkEffect(effect))):
      return {
        type: FORK,
        effect: parsedEffect,
        providerKey: parsedEffect.detached ? 'spawn' : 'fork',
      };

    case is.notUndef((parsedEffect = effectCheckers.isGetContextEffect(effect))):
      return {
        type: GET_CONTEXT,
        effect: parsedEffect,
        providerKey: 'getContext',
      };

    case is.notUndef((parsedEffect = effectCheckers.isJoinEffect(effect))):
      return {
        type: JOIN,
        effect: parsedEffect,
        providerKey: 'join',
      };

    case is.notUndef((parsedEffect = effectCheckers.isSelectEffect(effect))):
      return {
        type: SELECT,
        effect: parsedEffect,
        providerKey: 'select',
      };

    case is.notUndef((parsedEffect = effectCheckers.isGetContextEffect(effect))):
      return {
        type: SET_CONTEXT,
        effect: parsedEffect,
        providerKey: 'setContext',
      };

    case is.notUndef((parsedEffect = effectCheckers.isActionChannelEffect(effect))):
      return {
        type: ACTION_CHANNEL,
        effect: parsedEffect,
        providerKey: 'actionChannel',
      };

    case is.notUndef((parsedEffect = effectCheckers.isAllEffect(effect))):
      return createAll(parsedEffect);

    default:
      return { type: NONE };
  }
}
