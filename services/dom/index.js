
// I'd like this to be the only service to talk to the DOM.
// Not sure of the performance implications, but would like
// to see.

I.boot = function (name, resid, query, headers, body) {

    let updateQueue = [];
    let ok = { status: 200 };
    let scheduledRender = null;
    let elcache = new Map();

    function elem(k) {
        let el = elcache.get(k);
        if (!el) {
            switch (k) {
                case 'head': el = document.head; break;
                case 'body': el = document.body; break;
                default:
                    try { el = document.querySelector('[inai-id="' + k + '"]'); } catch (e) {}
            }
            if(el) { elcache.set(k, el); }
        }
        return el;
    }

    function sel(id, k) {
        if (id) {
            let el = elem(id);
            if (!el) {
                try { el = document.querySelector(id); } catch (e) {}
                if (el) {
                    elcache.set(id, el);
                }
            }
            return el;
        } else {
            return elem(k);
        }
    }

    let ophandlers = {
        setattr: function (k, q, mountQueue) {
            sel(q.sel, k).setAttribute(q.name, q.val);
        },
        set: function (k, q, mountQueue) {
            let el = sel(q.sel, k) || document.createElement(q.tag);
            elcache.set(k, el);
            if (q.attrs) {
                for (let k in q.attrs) {
                    let v = q.attrs[k];
                    el.setAttribute(k,v);
                }
            }
            if (q.body) {
                el.innerHTML = q.body;
            }
            if (q.style) {
                for (let k in q.style) {
                    let v = q.style[k];
                    el.style[k] = v;
                }
            }
            if (q.childOf) {
                mountQueue.push({ el: el, p: elem(q.childOf) });
            } else if (q.before) {
                mountQueue.push({ el: el, b: elem(q.before) });
            } else if (q.after) {
                mountQueue.push({ el: el, a: elem(q.after) });
            } else if (!el.parentNode) {
                mountQueue.push({ el: el, p: document.body });
            }
        },
        remove: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            mountQueue.push({ el: el, p: null });
            elcache.delete(k);
        },
        event: function (k, q, mountQueue) {
            let el = sel(q.sel, k);
            el.addEventListener(q.event, function (event) {
                I.network(q.service, q.verb, q.resid, null, null, event);
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