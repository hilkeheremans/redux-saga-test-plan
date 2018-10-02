import * as is from '@redux-saga/is'
import { IO } from '@redux-saga/symbols'
import * as effectTypes from './keys'

export const effect = eff => eff && eff[IO]

export const isRaceEffect = eff => effect(eff) && eff.type === effectTypes.RACE
export const isTakeEffect = eff => effect(eff) && eff.type === effectTypes.TAKE
export const isPutEffect = eff => effect(eff) && eff.type === effectTypes.PUT
export const isCallEffect = eff => effect(eff) && eff.type === effectTypes.CALL
export const isCancelEffect = eff => effect(eff) && eff.type === effectTypes.CANCEL
export const isCancelledEffect = eff => effect(eff) && eff.type === effectTypes.CANCELLED
export const isCpsEffect = eff => effect(eff) && eff.type === effectTypes.CPS
export const isFlushEffect = eff => effect(eff) && eff.type === effectTypes.FLUSH
export const isForkEffect = eff => effect(eff) && eff.type === effectTypes.FORK
export const isGetContextEffect = eff => effect(eff) && eff.type === effectTypes.GET_CONTEXT
export const isJoinEffect = eff => effect(eff) && eff.type === effectTypes.JOIN
export const isSelectEffect = eff => effect(eff) && eff.type === effectTypes.SELECT
export const isSetContextEffect = eff => effect(eff) && eff.type === effectTypes.SET_CONTEXT
export const isActionChannelEffect = eff => effect(eff) && eff.type === effectTypes.ACTION_CHANNEL
export const isAllEffect = eff => effect(eff) && eff.type === effectTypes.ALL

export const effectCheckers = {
    [effectTypes.PUT]: isPutEffect,
    [effectTypes.CALL]: isCallEffect,
    [effectTypes.CANCEL]: isCancelEffect,
    [effectTypes.CANCELLED]: isCancelledEffect,
    [effectTypes.CPS]: isCpsEffect,
    [effectTypes.FLUSH]: isFlushEffect,
    [effectTypes.FORK]: isForkEffect,
    [effectTypes.GET_CONTEXT]: isGetContextEffect,
    [effectTypes.JOIN]: isJoinEffect,
    [effectTypes.SELECT]: isSelectEffect,
    [effectTypes.SET_CONTEXT]: isSetContextEffect,
    [effectTypes.ACTION_CHANNEL]: isActionChannelEffect,
    [effectTypes.ALL]: isAllEffect
}