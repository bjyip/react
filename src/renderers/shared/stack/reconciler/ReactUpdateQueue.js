/**
 * Copyright 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ReactUpdateQueue
 */

'use strict';

var ReactCurrentOwner = require('ReactCurrentOwner');
var ReactInstanceMap = require('ReactInstanceMap');
var ReactInstrumentation = require('ReactInstrumentation');
var ReactUpdates = require('ReactUpdates');

var warning = require('warning');
var validateCallback = require('validateCallback');

function enqueueUpdate(internalInstance) {
  ReactUpdates.enqueueUpdate(internalInstance);
}

function getInternalInstanceReadyForUpdate(publicInstance, callerName) {
  // 从map取出ReactComponent组件,
  // 还记得mountComponent时把ReactElement作为key，将ReactComponent存入了map中了吧，
  // ReactComponent是React组件的核心，包含各种状态，数据和操作方法。而ReactElement则仅仅是一个数据类。
  var internalInstance = ReactInstanceMap.get(publicInstance);
  if (!internalInstance) {
    if (__DEV__) {
      var ctor = publicInstance.constructor;
      // Only warn when we have a callerName. Otherwise we should be silent.
      // We're probably calling from enqueueCallback. We don't want to warn
      // there because we already warned for the corresponding lifecycle method.
      warning(
        !callerName,
        '%s(...): Can only update a mounted or mounting component. ' +
        'This usually means you called %s() on an unmounted component. ' +
        'This is a no-op. Please check the code for the %s component.',
        callerName,
        callerName,
        ctor && (ctor.displayName || ctor.name) || 'ReactClass'
      );
    }
    return null;
  }

  if (__DEV__) {
    warning(
      ReactCurrentOwner.current == null,
      '%s(...): Cannot update during an existing state transition (such as ' +
      'within `render` or another component\'s constructor). Render methods ' +
      'should be a pure function of props and state; constructor ' +
      'side-effects are an anti-pattern, but can be moved to ' +
      '`componentWillMount`.',
      callerName
    );
  }

  return internalInstance;
}

/**
 * ReactUpdateQueue allows for state updates to be scheduled into a later
 * reconciliation step.
 */
var ReactUpdateQueue = {

  /**
   * Checks whether or not this composite component is mounted.
   * @param {ReactClass} publicInstance The instance we want to test.
   * @return {boolean} True if mounted, false otherwise.
   * @protected
   * @final
   */
  isMounted: function(publicInstance) {
    if (__DEV__) {
      var owner = ReactCurrentOwner.current;
      if (owner !== null) {
        warning(
          owner._warnedAboutRefsInRender,
          '%s is accessing isMounted inside its render() function. ' +
          'render() should be a pure function of props and state. It should ' +
          'never access something that requires stale data from the previous ' +
          'render, such as refs. Move this logic to componentDidMount and ' +
          'componentDidUpdate instead.',
          owner.getName() || 'A component'
        );
        owner._warnedAboutRefsInRender = true;
      }
    }
    var internalInstance = ReactInstanceMap.get(publicInstance);
    if (internalInstance) {
      // During componentWillMount and render this will still be null but after
      // that will always render to something. At least for now. So we can use
      // this hack.
      return !!internalInstance._renderedComponent;
    } else {
      return false;
    }
  },

  enqueueCallbackInternal: function(internalInstance, callback) {
    if (internalInstance._pendingCallbacks) {
      internalInstance._pendingCallbacks.push(callback);
    } else {
      internalInstance._pendingCallbacks = [callback];
    }
    enqueueUpdate(internalInstance);
  },

  /**
   * Forces an update. This should only be invoked when it is known with
   * certainty that we are **not** in a DOM transaction.
   *
   * You may want to call this when you know that some deeper aspect of the
   * component's state has changed but `setState` was not called.
   *
   * This will not invoke `shouldComponentUpdate`, but it will invoke
   * `componentWillUpdate` and `componentDidUpdate`.
   *
   * @param {ReactClass} publicInstance The instance that should rerender.
   * @param {?function} callback Called after component is updated.
   * @param {?string} Name of the calling function in the public API.
   * @internal
   */
  enqueueForceUpdate: function(publicInstance, callback, callerName) {
    var internalInstance = getInternalInstanceReadyForUpdate(
      publicInstance,
      'forceUpdate'
    );

    if (!internalInstance) {
      return;
    }

    if (callback) {
      validateCallback(callback, callerName);
      if (internalInstance._pendingCallbacks) {
        internalInstance._pendingCallbacks.push(callback);
      } else {
        internalInstance._pendingCallbacks = [callback];
      }
    }

    internalInstance._pendingForceUpdate = true;

    enqueueUpdate(internalInstance);
  },

  /**
   * Replaces all of the state. Always use this or `setState` to mutate state.
   * You should treat `this.state` as immutable.
   *
   * There is no guarantee that `this.state` will be immediately updated, so
   * accessing `this.state` after calling this method may return the old value.
   *
   * @param {ReactClass} publicInstance The instance that should rerender.
   * @param {object} completeState Next state.
   * @param {?function} callback Called after state is updated.
   * @param {?string} Name of the calling function in the public API.
   * @internal
   */
  enqueueReplaceState: function(publicInstance, completeState, callback, callerName) {
    var internalInstance = getInternalInstanceReadyForUpdate(
      publicInstance,
      'replaceState'
    );

    if (!internalInstance) {
      return;
    }

    internalInstance._pendingStateQueue = [completeState];
    internalInstance._pendingReplaceState = true;

    if (callback) {
      validateCallback(callback, callerName);
      if (internalInstance._pendingCallbacks) {
        internalInstance._pendingCallbacks.push(callback);
      } else {
        internalInstance._pendingCallbacks = [callback];
      }
    }

    enqueueUpdate(internalInstance);
  },

  /**
   * Sets a subset of the state. This only exists because _pendingState is
   * internal. This provides a merging strategy that is not available to deep
   * properties which is confusing. TODO: Expose pendingState or don't use it
   * during the merge.
   *
   * @param {ReactClass} publicInstance The instance that should rerender.
   * @param {object} partialState Next partial state to be merged with state.
   * @param {?function} callback Called after state is updated.
   * @param {?string} Name of the calling function in the public API.
   * @internal
   */
  enqueueSetState: function(publicInstance, partialState, callback, callerName) {
    if (__DEV__) {
      ReactInstrumentation.debugTool.onSetState();
      warning(
        partialState != null,
        'setState(...): You passed an undefined or null state object; ' +
        'instead, use forceUpdate().'
      );
    }
    // 根据 this.setState 中的 this 拿到内部实例, 也就是组件实例
    var internalInstance = getInternalInstanceReadyForUpdate(
      publicInstance,
      'setState'
    );

    if (!internalInstance) {
      return;
    }

    var queue =
      internalInstance._pendingStateQueue ||
      (internalInstance._pendingStateQueue = []);
    // 将partial state存到_pendingStateQueue
    queue.push(partialState);

    if (callback) {
      validateCallback(callback, callerName);
      if (internalInstance._pendingCallbacks) {
        internalInstance._pendingCallbacks.push(callback);
      } else {
        internalInstance._pendingCallbacks = [callback];
      }
    }
    // 调用enqueueUpdate，将要更新的ReactComponent放入数组中
    enqueueUpdate(internalInstance);
  },

  enqueueElementInternal: function(internalInstance, nextElement, nextContext) {
    internalInstance._pendingElement = nextElement;
    // TODO: introduce _pendingContext instead of setting it directly.
    internalInstance._context = nextContext;
    enqueueUpdate(internalInstance);
  },

};

module.exports = ReactUpdateQueue;
