// The "IO friendly scheduler" uses setImmediate so that
// other IO operations can sneak in between channel sends.
//
// You can get about 100k messages per second through with
// this one.
function friendlyScheduler(fn, val) {
    setImmediate(fn, val);
}

// The fast scheduler prioritizes channel sends over other
// IO operations. This works because the continuations we
// receive at `await` points are one shot, already async
// continuations. We won't blow the stack if you invoke
// those continuations synchronously!
//
// You can get something like 500k messages through
// per second with this one.
function fastScheduler(fn, val) {
    fn(val);
}

// For storing the two continuation paths accessible
// at an `await` point.
function Continuation(onSuccess, onFailure) {
    this.onSuccess = onSuccess || Continuation.noop;
    this.onFailure = onFailure || Continuation.noop;
}

Continuation.noop = function (val) {};

// A channel has only one main method - `chan.post(val)` -
// which needs to be awaited upon like `await chan.post(val)`
// to continue when the post actually gets serviced.
// To receive values from the channel, you simply `await chan`.
function Channel(schedulerFn) {
    // Default to the fast scheduler.
    let schedule = schedulerFn || fastScheduler;

    // Once a channel enters an error state, it always remains in it.
    let error = null;

    let queue = [],      // We'll post a queue of values to the channel.
        callbacks = [],  // .. which will be consumed by being pushed
                         //    to callbacks or errors.
        callfronts = []; // These get called when `post` is used with `await`.

    // We use a "back channel" to hook into the producers waiting for
    // their channel postings to go through.
    let backChan = {
        now: function () {
            return backChan.then(Continuation.noop, Continuation.noop);
        },
        then: function (onSuccess, onFailure) {
            // We'll get these continuations from the `await chan.push(val)`.
            callfronts.push(new Continuation(onSuccess, onFailure));

            // Compared to the previous implementation, this one moves
            // the `pump()` call from the `post()` method to here, so that
            // the maximum length of the queue is the maximum number of
            // producers waiting for their data to go through.
            pump();
        }
    };

    // Check if we have to push values to callbacks.
    function pump() {
        if (error) {
            let localCallbacks = callbacks,
                localCallfronts = callfronts;
            callbacks = [];
            callfronts = [];

            // Send the error to all the waiters.
            while (localCallbacks.length > 0) {
                schedule(localCallbacks.shift().onFailure, error);
            }

            // Release all the producers when one of them posts
            // an error.
            while (localCallfronts.length > 0) {
                schedule(localCallfronts.shift().onFailure, error);
            }

            return;
        }

        while (queue.length > 0 && callbacks.length > 0 && callfronts.length > 0) {
            let val = queue.shift();
            if (val instanceof Error) {
                error = val;
                queue = [];
                pump();
                return;
            }

            let successCallback = callbacks.shift().onSuccess,
                successCallfront = callfronts.shift().onSuccess;
            schedule(successCallback, val);
            schedule(successCallfront, val);
        }
    }

    let chan = {
        // This is the main interface that lets you post
        // values to a channel. It returns a pseudo-promise
        // so that you can use it with await like `await chan.post(val)`.
        // If you want to make a sync post and continue, you can
        // do `chan.post(val).now()`.
        post: function (val) {
            // Don't accumulate values once we've reached error.
            if (!error) {
                queue.push(val);
            }

            // Returning backChan here without a `pump()` ensures that
            // we capture the continuation at the `post` before launching forward.
            return backChan;
        },

        // If you want to post an error, you may want to use this
        // one instead of `await chan.post(new Error(...))` so that the post
        // operation itself doesn't fail.
        //
        // Usage: await chan.error(new Error(...))
        error: async function (e) {
            try {
                return (await this.post(e));
            } catch (e) {
                return e;
            }
        },

        // This is for the async/await mechanism to use.
        then: function (onSuccess, onFailure) {
            // onSuccess and onFailure are continuations
            // passed to us in `await` situations.
            callbacks.push(new Continuation(onSuccess, onFailure));
            pump();
        }
    };

    return chan;
}

Channel.friendly = function () {
    return new Channel(friendlyScheduler);
};

Channel.fast = function () {
    return new Channel(fastScheduler);
};

function WrappedValue(val) {
    this.value = val;
}

WrappedValue.prototype.unwrap = function () {
    return this.value;
};

// If you want the value passed to not be affected by the
// mechanism using which channels are implemented - for
// example, promises that you don't want to be resolved,
// other channels, deferred objects, and such, then you
// will need to wrap them before posting, and `Channel.unwrap()` them
// on reception.
Channel.wrap = function (val) {
    return new WrappedValue(val);
};

// Unwrapping checks for wrapped values and so if you want
// safe passage for values through a channel, you can do -
//
// await chan.post(Channel.wrap(val))
//
// and get these values using -
//
// Channel.unwrap(await chan)
//
// Calling unwrap on values not wrapped is also safe - i.e.
// if you did `Channel.unwrap(await chan)` everywhere you 
// needed to get a value out of a channel, that would be ok
// whether or not posters used wrapped values.
Channel.unwrap = function (val) {
    return val instanceof WrappedValue ? val.unwrap() : val;
};

Channel.isWrapped = function (val) {
    return val instanceof WrappedValue;
};

module.exports = Channel;

