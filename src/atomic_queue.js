// A very simple non-failing channel implementation
// that is used to carve out independent async blocks of
// code that must not interfere with each other.
function channel() {
    let queue = [],     // We'll post a queue of values to the channel.
        callbacks = []; // .. which will be consumed by being pushed
    //    to callbacks.

    // Check if we have to push values to callbacks.
    function pump() {
        while (queue.length > 0 && callbacks.length > 0) {
            setImmediate(callbacks.shift(), queue.shift());
        }
    }

    return {
        post: function (val) {
            queue.push(val);
            pump();
        },
        then: function (onSuccess, onFailure) {
            // onSuccess and onFailure are continuations
            // passed to us in `await` situations.
            callbacks.push(onSuccess);
            pump();
        }
    };
}

// The sole "atomic" channel and its processor.
function AtomicQueue() {
    let queue = channel();
    let closed = false;

    (async () => {
        while (!closed) {
            let func = await queue;
            if (!func) {
                closed = true;
                return;
            }
            try {
                await func();
            } catch (e) {
                logger.error("atomicQueue: " + e);
            }
        }
    })();

    this.atomic = function (pfunc) {
        return new Promise((resolve, reject) => {
            if (closed) { return reject('closed'); }
            queue.post(() => {
                let p = pfunc();
                if (p && p.then) {
                    // Note that other continuations depending on p
                    // will need to be fired off independent of the
                    // qtomic queue itself.
                    p.then(resolve).catch(reject);
                }
                return p;
            });
        });
    };

    this.close = function () {
        if (!closed) {
            queue.post(null);
        }
    };

    return this;
}

module.exports = AtomicQueue;
