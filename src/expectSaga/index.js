// @flow
/* eslint-disable no-underscore-dangle */
import { runSaga, stdChannel, utils } from 'redux-saga';
import { all, call, fork, race, spawn } from 'redux-saga/effects';
import * as effects from 'redux-saga/effects'
// import {
//   takeEveryHelper,
//   takeLatestHelper,
//   takeLeadingHelper,
// } from 'redux-saga/lib/internal/sagaHelpers';
import assign from 'object-assign';
import { splitAt } from '../utils/array';
import Map from '../utils/Map';
import ArraySet from '../utils/ArraySet';
import { warn } from '../utils/logging';
import { delay, schedule } from '../utils/async';
import identity from '../utils/identity';
import parseEffect from './parseEffect';
import { NEXT, provideValue } from './provideValue';
import { mapValues } from '../utils/object';
import findDispatchableActionIndex from './findDispatchableActionIndex';
import createSagaWrapper, { isSagaWrapper } from './sagaWrapper';
import sagaIdFactory from './sagaIdFactory';
import { coalesceProviders } from './providers/helpers';

import type { Expectation } from './expectations';

import {
  createEffectExpectation,
  createReturnExpectation,
  createStoreStateExpectation,
} from './expectations';

import {
  ACTION_CHANNEL,
  ALL,
  CALL,
  CPS,
  FORK,
  GET_CONTEXT,
  PUT,
  RACE,
  SELECT,
  SET_CONTEXT,
  TAKE,
} from '../shared/keys';

import * as effectCheckers from '../shared/checkers'
import * as is from '@redux-saga/is'

const INIT_ACTION = { type: '@@redux-saga-test-plan/INIT' };
const defaultSagaWrapper = createSagaWrapper();

function extractState(reducer: Reducer, initialState?: any): any {
  return initialState || reducer(undefined, INIT_ACTION);
}

function isHelper(fn: Function): boolean {
  if (!fn) return false
  return (
      fn.name === 'takeEveryHelper' ||
    fn.name === 'takeLatestHelper' ||
    fn.name === 'takeLeadingHelper'
);
}

function toJSON(object: mixed): mixed {
  if (Array.isArray(object)) {
    return object.map(toJSON);
  }

  if (typeof object === 'function') {
    return `@@redux-saga-test-plan/json/function/${object.name ||
      '<anonymous>'}`;
  }

  if (typeof object === 'object' && object !== null) {
    return mapValues(object, toJSON);
  }

  return object;
}

function lacksSagaWrapper(value: Object): boolean {
  const { type, effect } = parseEffect(value);
  return type !== 'FORK' || !isSagaWrapper(effect.fn);
}

const exposableEffects = {
  [TAKE]: 'take',
  [PUT]: 'put',
  [RACE]: 'race',
  [CALL]: 'call',
  [CPS]: 'cps',
  [FORK]: 'fork',
  [GET_CONTEXT]: 'getContext',
  [SELECT]: 'select',
  [SET_CONTEXT]: 'setContext',
  [ACTION_CHANNEL]: 'actionChannel',
};

export default function expectSaga(
  generator: Function,
  ...sagaArgs: mixed[]
): ExpectApi {
  const allEffects = [];
  const effectStores = {
    [TAKE]: new ArraySet(),
    [PUT]: new ArraySet(),
    [RACE]: new ArraySet(),
    [CALL]: new ArraySet(),
    [CPS]: new ArraySet(),
    [FORK]: new ArraySet(),
    [GET_CONTEXT]: new ArraySet(),
    [SET_CONTEXT]: new ArraySet(),
    [SELECT]: new ArraySet(),
    [ACTION_CHANNEL]: new ArraySet(),
  };

  const expectations: Array<Expectation> = [];
  const ioChannel = stdChannel();
  const queuedActions = [];
  const forkedTasks = [];
  const outstandingForkEffects = new Map();
  const outstandingActionChannelEffects = new Map();
  const channelsToPatterns = new Map();
  const dispatchPromise = Promise.resolve();
  const nextSagaId = sagaIdFactory();

  let stopDirty = false;
  let negateNextAssertion = false;
  let isRunning = false;
  let delayTime = null;

  let iterator;
  let mainTask;
  let mainTaskPromise;
  let providers;

  let returnValue;

  let storeState: any;

  function setReturnValue(value: any): void {
    returnValue = value;
  }

  function useProvidedValue(value) {
    function addEffect() {
      // Because we are providing a return value and not hitting redux-saga, we
      // need to manually store the effect so assertions on the effect work.
      processEffect({
        effectId: nextSagaId(),
        effect: value,
      });
    }

    try {
      const providedValue = provideValue(providers, value);

      if (providedValue === NEXT) {
        return value;
      }

      addEffect();
      return providedValue;
    } catch (e) {
      addEffect();
      throw e;
    }
  }

  function refineYieldedValue(value) {
    const parsedEffect = parseEffect(value);
    const localProviders = providers || {};
    const { type, effect } = parsedEffect;
    switch (true) {
      case type === RACE && !localProviders.race:
        processEffect({
          effectId: nextSagaId(),
          effect: value,
        });

        return race(parsedEffect.mapEffects(refineYieldedValue));

      case type === ALL && !localProviders.all:
        return all(parsedEffect.mapEffects(refineYieldedValue));

      case type === FORK: {
        const { args, detached, context, fn } = effect;
        const yieldedHelperEffect = isHelper(fn);

        const providedValue = useProvidedValue(value);
        const isProvided = providedValue !== value;

        if (!detached && !isProvided) {
          // Because we wrap the `fork`, we need to manually store the effect,
          // so assertions on the `fork` work.
          processEffect({
            effectId: nextSagaId(),
            effect: value,
          });

          let finalArgs = args;

          if (yieldedHelperEffect) {
            const [patternOrChannel, worker, ...restArgs] = args;

            finalArgs = [
              patternOrChannel,
              action =>
                defaultSagaWrapper(
                  worker(...restArgs, action),
                  refineYieldedValue,
                ),
            ];
          }

          return fork(
            createSagaWrapper(fn.name),
            fn.apply(context, finalArgs),
            refineYieldedValue,
          );
        }

        if (detached && !isProvided) {
          // Because we wrap the `spawn`, we need to manually store the effect,
          // so assertions on the `spawn` work.
          processEffect({
            effectId: nextSagaId(),
            effect: value,
          });

          return spawn(
            createSagaWrapper(fn.name),
            fn.apply(context, args),
            refineYieldedValue,
          );
        }

        return providedValue;
      }

      case type === CALL: {
        const providedValue = useProvidedValue(value);

        if (providedValue !== value) {
          return providedValue;
        }

        // Because we manually consume the `call`, we need to manually store
        // the effect, so assertions on the `call` work.
        processEffect({
          effectId: nextSagaId(),
          effect: value,
        });

        const { context, fn, args } = effect;
        const result = fn.apply(context, args);

        if (is.iterator(result)) {
          return call(defaultSagaWrapper, result, refineYieldedValue);
        }

        return result;
      }

      // Ensure we wrap yielded iterators (i.e. `yield someInnerSaga()`) for
      // providers to work.
      case is.iterator(value):
        return useProvidedValue(defaultSagaWrapper(value, refineYieldedValue));

      default:
        return useProvidedValue(value);
    }
  }

  function defaultReducer(state = storeState) {
    return state;
  }

  let reducer: Reducer = defaultReducer;

  function getAllPromises(): Promise<*> {
    return new Promise(resolve => {
      Promise.all([...forkedTasks.map(taskPromise), mainTaskPromise]).then(
        () => {
          if (stopDirty) {
            stopDirty = false;
            resolve(getAllPromises());
          }
          resolve();
        },
      );
    });
  }

  function addForkedTask(task: Task): void {
    stopDirty = true;
    forkedTasks.push(task);
  }

  function cancelMainTask(
    timeout: number,
    silenceTimeout: boolean,
    timedOut: boolean,
  ): Promise<*> {
    if (!silenceTimeout && timedOut) {
      warn(`Saga exceeded async timeout of ${timeout}ms`);
    }

    mainTask.cancel();

    return mainTaskPromise;
  }

  function scheduleStop(timeout: Timeout | TimeoutConfig): Promise<*> {
    let promise = schedule(getAllPromises).then(() => false);
    let silenceTimeout = false;
    let timeoutLength: ?Timeout;

    if (typeof timeout === 'number') {
      timeoutLength = timeout;
    } else if (typeof timeout === 'object') {
      silenceTimeout = timeout.silenceTimeout === true;

      if ('timeout' in timeout) {
        timeoutLength = timeout.timeout;
      } else {
        timeoutLength = expectSaga.DEFAULT_TIMEOUT;
      }
    }

    if (typeof timeoutLength === 'number') {
      promise = Promise.race([promise, delay(timeoutLength).then(() => true)]);
    }

    return promise.then(timedOut =>
      schedule(cancelMainTask, [timeoutLength, silenceTimeout, timedOut]),
    );
  }

  function queueAction(action: Action): void {
    queuedActions.push(action);
  }

  function notifyListeners(action: Action): void {
    console.log('notifying listeners', action)
    ioChannel.put(action);
  }

  function dispatch(action: Action): any {
    console.log('dispatching', action)
    if (typeof action._delayTime === 'number') {
      const { _delayTime } = action;

      dispatchPromise.then(() => delay(_delayTime)).then(() => {
        storeState = reducer(storeState, action);
        notifyListeners(action);
      });
    } else {
      storeState = reducer(storeState, action);
      dispatchPromise.then(() => notifyListeners(action));
    }
  }

  function associateChannelWithPattern(channel: Object, pattern: any): void {
    channelsToPatterns.set(channel, pattern);
  }

  function getDispatchableActions(effect: Object): Array<Action> {
    console.log('channel!!', effect)
    const pattern = effect.pattern || channelsToPatterns.get(effect.channel);
    console.log('HELLOOOO', effect)
    const index = findDispatchableActionIndex(queuedActions, pattern);
    console.log('queued', queuedActions, pattern)
    if (index > -1) {
      const actions = queuedActions.splice(0, index + 1);
      return actions;
    }

    return [];
  }

  function processEffect(event: Object): void {
    const parsedEffect = parseEffect(event.effect);

    // Using string literal for flow
    if (parsedEffect.type === 'NONE') {
      return;
    }

    const effectStore = effectStores[parsedEffect.type];
    if (!effectStore) {
      return;
    }

    allEffects.push(event.effect);
    effectStore.add(event.effect);

    switch (parsedEffect.type) {
      case FORK: {
        outstandingForkEffects.set(event.effectId, parsedEffect.effect);
        break;
      }

      case TAKE: {
        const actions = getDispatchableActions(parsedEffect.effect);
        const [reducerActions, [sagaAction]] = splitAt(actions, -1);
        console.log('actions found for take', parsedEffect, actions, reducerActions, sagaAction)

        reducerActions.forEach(action => {
          dispatch(action);
        });

        if (sagaAction) {
          dispatch(sagaAction);
        }

        break;
      }

      case ACTION_CHANNEL: {
        outstandingActionChannelEffects.set(
          event.effectId,
          parsedEffect.effect,
        );
        break;
      }

      // no default
    }
  }

  function addExpectation(expectation: Function): void {
    expectations.push(expectation);
  }

  const io = {
    dispatch,

    channel: ioChannel,

    getState(): any {
      return storeState;
    },

    sagaMonitor: {
      effectTriggered(event: Object): void {
        processEffect(event);
      },

      effectResolved(effectId: number, value: any): void {
        const forkEffect = outstandingForkEffects.get(effectId);

        if (forkEffect) {
          addForkedTask(value);
          return;
        }

        const actionChannelEffect = outstandingActionChannelEffects.get(
          effectId,
        );

        if (actionChannelEffect) {
          associateChannelWithPattern(value, actionChannelEffect.pattern);
        }
      },

      effectRejected() {},
      effectCancelled() {},
    },
  };

  const api = {
    run,
    silentRun,
    withState,
    withReducer,
    provide,
    returns,
    hasFinalState,
    dispatch: apiDispatch,
    delay: apiDelay,

    // $FlowFixMe
    get not() {
      negateNextAssertion = true;
      return api;
    },

    actionChannel: createEffectTesterFromEffects(
      'actionChannel',
      ACTION_CHANNEL,
      effectCheckers.isActionChannelEffect
    ),
    apply: createEffectTesterFromEffects('apply', CALL, effectCheckers.isCallEffect),
    call: createEffectTesterFromEffects('call', CALL, effectCheckers.isCallEffect),
    cps: createEffectTesterFromEffects('cps', CPS, effectCheckers.isCpsEffect),
    fork: createEffectTesterFromEffects('fork', FORK, effectCheckers.isForkEffect),
    getContext: createEffectTesterFromEffects(
      'getContext',
      GET_CONTEXT,
      effectCheckers.isGetContextEffect,
    ),
    put: createEffectTesterFromEffects('put', PUT, effectCheckers.isPutEffect),
    putResolve: createEffectTesterFromEffects('putResolve', PUT, effectCheckers.isPutEffect),
    race: createEffectTesterFromEffects('race', RACE, effectCheckers.isRaceEffect),
    select: createEffectTesterFromEffects('select', SELECT, effectCheckers.isSelectEffect),
    spawn: createEffectTesterFromEffects('spawn', FORK, effectCheckers.isForkEffect),
    setContext: createEffectTesterFromEffects(
      'setContext',
      SET_CONTEXT,
      effectCheckers.isSetContextEffect,
    ),
    take: createEffectTesterFromEffects('take', TAKE, effectCheckers.isTakeEffect),
    takeMaybe: createEffectTesterFromEffects('takeMaybe', TAKE, effectCheckers.isTakeEffect),
  };

  api.actionChannel.like = createEffectTester(
    'actionChannel',
    ACTION_CHANNEL,
    effects.actionChannel,
    effectCheckers.isActionChannelEffect,
    true,
  );
  api.actionChannel.pattern = pattern => api.actionChannel.like({ pattern });

  api.apply.like = createEffectTester(
    'apply',
    CALL,
    effects.apply,
    effectCheckers.isCallEffect,
    true,
  );
  api.apply.fn = fn => api.apply.like({ fn });

  api.call.like = createEffectTester(
    'call',
    CALL,
    effects.call,
    effectCheckers.isCallEffect,
    true,
  );
  api.call.fn = fn => api.call.like({ fn });

  api.cps.like = createEffectTester(
    'cps',
    CPS,
    effects.cps,
    effectCheckers.isCpsEffect,
    true,
  );
  api.cps.fn = fn => api.cps.like({ fn });

  api.fork.like = createEffectTester(
    'fork',
    FORK,
    effects.fork,
    effectCheckers.isForkEffect,
    true,
  );
  api.fork.fn = fn => api.fork.like({ fn });

  api.put.like = createEffectTester(
    'put',
    PUT,
    effects.put,
    effectCheckers.isPutEffect,
    true,
  );
  api.put.actionType = type => api.put.like({ action: { type } });

  api.putResolve.like = createEffectTester(
    'putResolve',
    PUT,
    effects.putResolve,
    effectCheckers.isPutEffect,
    true,
  );
  api.putResolve.actionType = type => api.putResolve.like({ action: { type } });

  api.select.like = createEffectTester(
    'select',
    SELECT,
    effects.select,
    effectCheckers.isSelectEffect,
    true,
  );
  api.select.selector = selector => api.select.like({ selector });

  api.spawn.like = createEffectTester(
    'spawn',
    FORK,
    effects.spawn,
    effectCheckers.isForkEffect,
    true,
  );
  api.spawn.fn = fn => api.spawn.like({ fn });

  function checkExpectations(): void {
    expectations.forEach(expectation => {
      expectation({ storeState, returnValue });
    });
  }

  function apiDispatch(action: Action): ExpectApi {
    let dispatchableAction;
    console.log('dispatch', action, isRunning)

    if (typeof delayTime === 'number') {
      dispatchableAction = assign({}, action, {
        _delayTime: delayTime,
      });

      delayTime = null;
    } else {
      dispatchableAction = action;
    }

    if (isRunning) {
      dispatch(dispatchableAction);
    } else {
      queueAction(dispatchableAction);
    }

    return api;
  }

  function taskPromise(task: Task): Promise<*> {
    return task.toPromise();
  }

  function start(): ExpectApi {
    const sagaWrapper = createSagaWrapper(generator.name);
    isRunning = true;
    iterator = generator(...sagaArgs);
    mainTask = runSaga(
      io,
      sagaWrapper,
      iterator,
      refineYieldedValue,
      setReturnValue,
    );
    mainTaskPromise = taskPromise(mainTask)
      .then(checkExpectations)
      // Pass along the error instead of rethrowing or allowing to
      // bubble up to avoid PromiseRejectionHandledWarning
      .catch(identity);
    return api;
  }

  function stop(timeout: Timeout | TimeoutConfig): Promise<*> {
    return scheduleStop(timeout).then(err => {
      if (err) {
        throw err;
      }
    });
  }

  function exposeResults(): Object {
    const finalEffects = Object.keys(exposableEffects).reduce((memo, key) => {
      const effectName = exposableEffects[key];
      const values = effectStores[key].values().filter(lacksSagaWrapper);

      if (values.length > 0) {
        // eslint-disable-next-line no-param-reassign
        memo[effectName] = effectStores[key].values().filter(lacksSagaWrapper);
      }

      return memo;
    }, {});

    return {
      storeState,
      returnValue,
      effects: finalEffects,
      allEffects,
      toJSON: () => toJSON(finalEffects),
    };
  }

  function run(
    timeout?: Timeout | TimeoutConfig = expectSaga.DEFAULT_TIMEOUT,
  ): Promise<*> {
    start();
    return stop(timeout).then(exposeResults);
  }

  function silentRun(
    timeout?: Timeout = expectSaga.DEFAULT_TIMEOUT,
  ): Promise<*> {
    return run({
      timeout,
      silenceTimeout: true,
    });
  }

  function withState(state: any): ExpectApi {
    storeState = state;
    return api;
  }

  function withReducer(newReducer: Reducer, initialState?: any): ExpectApi {
    reducer = newReducer;

    storeState = extractState(newReducer, initialState);

    return api;
  }

  function provide(newProviders: Providers | Array<Providers | [Object, any]>) {
    providers = Array.isArray(newProviders)
      ? coalesceProviders(newProviders)
      : newProviders;

    return api;
  }

  function returns(value: any): ExpectApi {
    addExpectation(
      createReturnExpectation({
        value,
        expected: !negateNextAssertion,
      }),
    );

    return api;
  }

  function hasFinalState(state: mixed): ExpectApi {
    addExpectation(
      createStoreStateExpectation({
        state,
        expected: !negateNextAssertion,
      }),
    );

    return api;
  }

  function apiDelay(time: number): ExpectApi {
    delayTime = time;
    return api;
  }

  function createEffectTester(
    effectName: string,
    storeKey: string,
    effectCreator: Function,
    extractEffect: Function,
    like: boolean = false,
  ): Function {
    return (...args: mixed[]) => {
      console.log('storekey', storeKey, like, effectStores)
      const expectedEffect = like ? args[0] : effectCreator(...args);
      addExpectation(
        createEffectExpectation({
          effectName,
          expectedEffect,
          storeKey,
          like,
          extractEffect,
          store: effectStores[storeKey],
          expected: !negateNextAssertion,
        }),
      );

      negateNextAssertion = false;

      return api;
    };
  }

  function createEffectTesterFromEffects(
    effectName: string,
    storeKey: string,
    extractEffect: Function,
  ): Function {
    return createEffectTester(
      effectName,
      storeKey,
      effects[effectName],
      extractEffect,
    );
  }

  return api;
}

expectSaga.DEFAULT_TIMEOUT = 250;
