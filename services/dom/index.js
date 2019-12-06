
// I'd like this to be the only service to talk to the DOM.
// Not sure of the performance implications, but would like
// to see.

I.boot = function (name, resid, query, headers, body) {

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

    let ophandlers = {
        setattr: function (k, q, mountQueue) {
            sel(q.sel, k)(e => e.setAttribute(q.name, q.val));
        },
        set: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            if (!el) {
                let t = q.tag && document.createElement(q.tag);
                if (t) {
                    el = (f => f(t, 0, 1));
                }
            }
            if (!el) {
                console.error("Invalid DOM set operation " + k + ' => ' + JSON.stringify(q));
                return;
            }
            elcache.set(k, el);
            if (q.attrs) {
                el(e => {
                    for (let k in q.attrs) {
                        let v = q.attrs[k];
                        e.setAttribute(k, v);
                    }
                });
            }
            if (q.body) {
                el(e => { e.innerHTML = q.body; });
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
            let h = ophandlers[q.op];
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