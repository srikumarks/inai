
let Dom = require('./dom.js');

// I'd like this to be the only service to talk to the DOM.
// Not sure of the performance implications, but would like
// to see.

I.boot = function (name, resid, query, headers, config) {

    let updateQueue = [];
    let ok = { status: 200 };
    let scheduledRender = null;

    // elcache stores a map from a name to a function that helps process
    // elements. When that function is called with a function, then that
    // function is applied to all the elements that the value stands for.
    //
    // That's confusing. So here's another attempt -
    // elcache :: String -> ((Element -> int -> int -> Result) -> Result)
    //
    // That way, we can capture a "selection" to be acted upon.
    let elcache = new Map();
    let docHead = (f => f(document.head, 0, 1));
    let docBody = (f => f(document.body, 0, 1));
    let D = Dom(document, I);

    function elem(k) {
        let el = elcache.get(k);
        if (!el) {
            switch (k) {
                case 'head': el = docHead; break;
                case 'body': el = docBody; break;
                default: {
                    let eli = '[inai-id="' + k + '"]';
                    try {
                        let q = document.querySelector(eli);
                        if (q) {
                            el = (f => f(document.querySelector(eli), 0, 1));
                        }
                    } catch (e) { }
                }
            }
            if (el) {
                elcache.set(k, el);
            }
        }
        return el;
    }

    function sel(id, k) {
        if (id) {
            let el = elem(id);
            if (!el) {
                try {
                    let q = document.querySelector(id);
                    if (q) {
                        el = (f => {
                            let eli = document.querySelectorAll(id);
                            for (let i = 0; i < eli.length; ++i) {
                                f(eli[i], i, eli.length);
                            }
                        });
                        elcache.set(id, el);
                    }
                } catch (e) {
                    return elem(k);
                }
            }
            return el;
        } else {
            return elem(k);
        }
    }

    function setProperties(el, q, mountQueue) {
        if (!el || !q) { return; }
        if (q.attrs) {
            el(e => {
                for (let k in q.attrs) {
                    let v = q.attrs[k];
                    if (v === false) {
                        e.removeAttribute(k);
                    } else {
                        e.setAttribute(k, v);
                    }
                }
            });
        }
        if (q.classes) {
            // The classes is a string consisting of
            // space separated CSS class names. If a class
            // name starts with an optional +, it is added
            // to the list of classes. If it starts with
            // a -, it is removed from the class list.
            el(e => {
                let parts = q.classes.trim().split(/\s+/);
                for (let c of parts) {
                    if (c[0] === '-') {
                        e.classList.remove(c.substring(1));
                    } else if (c[0] === '+') {
                        e.classList.add(c.substring(1));
                    } else {
                        e.classList.add(c);
                    }
                }
            });
        }
        if (q.body) {
            if (typeof(q.body) === 'object') {
                if (!q.append) {
                    el
                }
                let f = D.compile(q.body);
                el(e => {
                    if (!q.append) { e.innerHTML = ''; }
                    f(e);
                });
            } else {
                el(e => {
                    if (q.append) { e.innerHTML += q.body; }
                    else { e.innerHTML = q.body; }
                });
            }
        }
        if (q.style) {
            el(e => {
                for (let k in q.style) {
                    let v = q.style[k];
                    e.style[k] = v;
                }
            });
        }
        if (q.childOf) {
            el(e => {
                elem(q.childOf)(pi => mountQueue.push({ el: e, p: pi }));
            });
        } else if (q.before) {
            el(e => {
                elem(q.before(bi => mountQueue.push({ el: e, b: bi })));
            });
        } else if (q.after) {
            el(e => {
                elem(q.after)(ai => mountQueue.push({ el: e, a: ai }));
            });
        } else {
            el(e => {
                if (!e.parentNode) {
                    mountQueue.push({ el: e, p: document.body });
                }
            });
        }
    }

    let ophandlers = {
        setattr: function (k, q, mountQueue) {
            sel(q.sel, k)(e => e.setAttribute(q.name, q.val));
        },
        set: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            if (!el) {
                let t = q.tag && document.createElement(q.tag);
                if (t) {
                    // Set can create an element if necessary.
                    // To ensure it only creates the element once,
                    // you can set the 'once' boolean in the query
                    // to true.
                    if (q.once) {
                        let done = null;
                        el = (f => {
                            if (!done) {
                                done = f(t, 0, 1);
                            }
                            return done;
                        });
                    } else {
                        el = (f => f(t, 0, 1));
                    }
                }
            }
            if (!el) {
                console.error("Invalid DOM set operation " + k + ' => ' + JSON.stringify(q));
                return;
            }
            elcache.set(k, el);
            setProperties(el, q, mountQueue);
        },
        append: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            if (!el) {
                console.error('dom/append: No parent to insert child into.');
                return;
            }
            // This el stands for the parent. We should
            // now append a new element to this identified
            // parent.
            el(e => {
                let t = q.tag && document.createElement(q.tag);
                if (!t) {
                    console.error("dom/append: Don't know tag name to append.");
                    return;
                }
                setProperties(f => f(t, 0, 1), q, mountQueue);
            });
        },
        remove: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            mountQueue.push({ el: el, p: null });
            elcache.delete(k);
        },
        event: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            el(e => {
                e.addEventListener(q.event, function (event) {
                    I.network(q.service, q.verb, q.resid, null, null, event);
                });
            });
        }
    };

    function render(t) {
        scheduledRender = null;
        let curr = updateQueue;
        updateQueue = [];

        let mountQueue = [];
        for (let [k,q] of curr) {
            // If the 'op' key is left out, it defaults to 'set'.
            let h = q.op ? ophandlers[q.op] : ophandlers.set;
            if (h) { h(k, q, mountQueue); }
        }

        for (let i of mountQueue) {
            if (i.p === null) {
                // Remove element.
                i.el.parentNode.removeChild(i.el);
            } else if (i.p) {
                i.p.appendChild(i.el);
            } else if (i.b) {
                i.b.insertAdjacentElement('beforebegin', i.el);
            } else if (i.a) {
                i.a.insertAdjacentElement('afterend', i.el);
            }
        }
    }

    function schedule() {
        if (!scheduledRender) {
            scheduledRender = window.requestAnimationFrame(render);
        }
    }

    I.post = function (name, resid, query, headers, body) {
        updateQueue.push([resid, body]);
        schedule();
        return ok;
    };

    I.boot = null;
    return { status: 200 };
};
