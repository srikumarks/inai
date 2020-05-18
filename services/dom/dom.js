// Abstracting the main interface on `document` lets us mock the
// DOM if we want to.
module.exports = function (document, I) {
    let svgNS = 'http://www.w3.org/2000/svg';
    let namespacedTags = {'svg':svgNS, 'rect':svgNS, 'g':svgNS, 'circle':svgNS, 'line':svgNS, 'arc':svgNS};

    function isFunction(f) {
        return typeof(f) === 'function';
    }

    function maybeFnVal(val, el) {
        return typeof(val) === 'function' ? val(el) : val;
    }

    function px(num) {
        return '' + Math.round(num) + 'px';
    }

    function pt(num) {
        return '' + num + 'pt';
    }

    function rgba(r,g,b,a) {
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    // Creates an element with given tag name and settings in other arguments.
    // If an argument is a string, it is used to set the `.textContent` of the
    // element. If it is a function, the function is called on the element ...
    // this is the same type as other combinators like attrs and styles. If it
    // is an array, then the contents of the array are inserted as children to
    // the created tag. Any functions within such an array are called on the
    // element just like functions outside the array. Other elements in the
    // argument list are just added as children as well.
    function e(tag, ...argv) {
        let ns = namespacedTags[tag];
        let el = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
        for (let i = 0; i < argv.length; ++i) {
            let arg = argv[i];
            switch (typeof (arg)) {
                case 'function':
                    el = arg(el) || el;
                    break;
                case 'string':
                    el.textContent += arg;
                    break;
                default:
                    if (arg instanceof Array) {
                        for (let j = 0; j < arg.length; ++j) {
                            let charg = arg[j];
                            if (isFunction(charg)) {
                                el = charg(el) || el;
                            } else {
                                el.appendChild(charg);
                            }
                        }
                    } else {
                        el.appendChild(arg);
                    }
                    break;
            }
        }
        return el;
    }

    function text(val) {
        return function (el) {
            let node = document.createTextNode(val);
            el.appendChild(node);
            return el;
        };
    }

    // html replaces contents with the given html text value.
    function html(val) {
        return function (el) {
            el.innerHTML = val;
            return el;
        };
    }

    // let a1 = attrs('key1', 'val1', 'key2', 'val2');
    // let a2 = attrs('key3', 'val3', a1, 'key4', 'val4');
    // let a3 = attrs(a2, 'key5', function (eL) { return ...; });
    function attrs(...kvpairs) {
        return function (el) {
            for (let i = 0; i < kvpairs.length;) {
                if (isFunction(kvpairs[i])) {
                    // Permits composition of sets of attributes.
                    el = kvpairs[i](el) || el;
                    ++i;
                } else {
                    let val = kvpairs[i + 1];
                    el.setAttribute(kvpairs[i], maybeFnVal(val, el));
                    i += 2;
                }
            }
            return el;
        };
    }

    // Very similar to attrs, except sets the properties directly on the element itself
    // instead of as an attribute.
    function props(...propsAndValues) {
        return function (el) {
            for (let i = 0; i < propsAndValues.length;) {
                if (isFunction(propsAndValues[i])) {
                    // Permits composition of sets of properties.
                    el = propsAndValues[i](el) || el;
                    ++i;
                } else {
                    let val = propsAndValues[i + 1];
                    el[propsAndValues[i]] = maybeFnVal(val, el);
                    i += 2;
                }
            }
            return el;
        };
    }

    function asHandler(fn) {
        return function (e) {
            // If we use e.target instead of e.currentTarget, then
            // we will find the handler being applied to any child that
            // generates the event rather than the one we're declaring
            // the handler as being attached to.
            return fn(e.currentTarget);
        };
    }

    // Sets an elements CSS classes. Also
    // accepts compositional combinators.
    function classes(...clist) {
        return function (el) {
            for (let i = 0; i < clist.length; ++i) {
                if (isFunction(clist[i])) {
                    el = clist[i](el) || el;
                } else {
                    let cls = clist[i];
                    let instr = cls[0];
                    switch (instr) {
                        case '+': el.classList.add(cls.substring(1)); break;
                        case '-': el.classList.remove(cls.substring(1)); break;
                        case '~': el.classList.toggle(cls.substring(1)); break;
                        default: el.classList.add(cls); break;
                    }
                }
            }
            return el;
        };
    }

    // Sets an element's style. Also accepts compositional
    // combinators like attrs() and handlers() within the
    // argument list.
    function styles(...kvpairs) {
        return function (el) {
            for (let i = 0; i < kvpairs.length;) {
                if (isFunction(kvpairs[i])) {
                    el = kvpairs[i](el) || el;
                    ++i;
                } else {
                    el.style[kvpairs[i]] = kvpairs[i + 1];
                    i += 2;
                }
            }
            return el;
        };
    }

    // Adds children to the element.
    function children(...els) {
        return function (el) {
            for (let i = 0; i < els.length; ++i) {
                let ch = els[i];
                if (isFunction(ch)) {
                    el = ch(el) || el;
                } else {
                    el.appendChild(ch);
                }
            }
            return el;
        };
    }

    // In pairs. For example,
    // let h = handlers(
    //      'click', function () {},
    //      'mouseover', function () {},
    //      ...)
    // The returned function `h` has a `remove` method that
    // can be called on an element to remove these handlers.
    // handlers() doesn't accept compositional combinators.
    function handlers(...eventHandlers) {
        function setHandlers(el) {
            for (let i = 0; i < eventHandlers.length; i += 2) {
                el.addEventListener(eventHandlers[i], eventHandlers[i+1]);
            }
            return el;
        }

        setHandlers.remove = function (el) {
            for (let i = 0; i < eventHandlers.length; i += 2) {
                el.removeEventHandler(eventHandlers[i], eventHandlers[i+1]);
            }
            return el;
        };

        return setHandlers;
    }

    function tree(el, ...argv) {
        for (let i = 0; i < argv.length; ++i) {
            let els = argv[i];
            if (els instanceof Array) {
                for (let j = 0; j < els.length; ++j) {
                    el.appendChild(els[j]);
                }
            } else if (isFunction(els)) {
                el = els(el) || el;
            } else if (els) {
                el.appendChild(els);
            }
        }
        return el;
    }

    const kUrlPat = /^[/]?[/]?([^/]+)(.+)$/;
    
    function post(url) {
        let match = url.match(kUrlPat);
        if (!match) { return function (event) { }; }
        
        let service = match[1];
        let resid = match[2];

        return function (event) {
            I.network(service, 'post', resid, {event: event.name}, null, event);
        };
    }

    function hooks(...eventHandlers) {
        let ehs = eventHandlers.slice(0);

        for (let i = 1; i < ehs.length; i += 2) {
            ehs[i] = post(ehs[i]);
        }

        function setHandlers(el) {
            for (let i = 0; i < ehs.length; i += 2) {
                el.addEventListener(ehs[i], ehs[i+1]);
            }
            return el;
        }

        setHandlers.remove = function (el) {
            for (let i = 0; i < ehs.length; i += 2) {
                el.removeEventHandler(ehs[i], ehs[i+1]);
            }
            return el;
        };

        return setHandlers;
    }

    function clear() {
        return function (el) {
            el.innerHTML = '';
            return el;
        };
    }

    // Makes a tag whose innerHTML is the body fetched from the
    // given service URL of the form "//service/resid". If tag
    // argument is left out, it is assumed to be a span.
    // If the result body is a spec object suitable for compile,
    // it will be called. Otherwise, it will be treated as innerHTML
    // and appended.
    function get(url) {
        tag = tag || 'span';
        let pat = url.match(kUrlPat);
        if (!pat) { return noop; }

        let service = pat[1];
        let resid = pat[2];
        
        let val = Promise.resolve(I.network(service, 'get', resid, null, null));
        let fn = val.then(result => {
            if (result.status === 200) {
                return compile(result.body);
            }
            return noop;
        });

        return function (el) {
            // There is some non-determinism here. So currently
            // get is safest to use as the sole content provider
            // of a tag.
            fn.then(f => {
                if (typeof(f) === 'function') {
                    f(el);
                } else {
                    el.innerHTML += f;
                }
            });
            return el;
        };
    }

    const endPoints = new Map();
    
    // Exposes the element operation as an end point to
    // which you can subsequently post content.
    //
    // The promise jugglery here is so that the end point
    // becomes available as soon as you call 'serve'.
    function serve(resid) {
        let resolveElement = null;
        let theElement = new Promise((resolve, reject) => { resolveElement = resolve; });
        console.assert(resolveElement);
        endPoints.set(resid, function (method, resid, query, headers, body) {
            if (method === 'delete') {
                endPoints.delete(resid);
                return { status: 200 };
            }

            if (method === 'get') {
                return { status: 200, body: theElement };
            }
            
            return theElement.then(el => {
                let c = compile(body);
                if (typeof(c) === 'function') {
                    c(el);
                } else {
                    if (method === 'post') {
                        el.innerHTML += body;
                    } else if (method === 'put') {
                        el.innerHTML = body;
                    }
                }
                return { status: 200 };
            });
        });
        return function (el) {
            resolveElement && resolveElement(el);
            resolveElement = null;
            return el;
        };
    }

    function handleServeRequest(method, resid, query, headers, body) {
        if (endPoints.has(resid)) {
            return endPoints.get(resid)(method, resid, query, headers, body);
        }
        return { status: 404 };
    }
    
    const kInstrs = {
        attrs: attrs,
        props: props,
        styles: styles,
        text: text,
        html: html,
        classes: classes,
        cls: classes,
        events: hooks,
        children: children,
        get: get,
        serve: serve,
        clear: clear
    };

    ['div', 'span', 'a', 'p', 'img', 'article', 'section', 'header', 'footer', 'b', 'em', 'strong',
     'form', 'label', 'input', 'textarea', 'button', 'select', 'option', 
     'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nav',
     'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'pre', 'code', 'em',
     'small', 'u', 'sup', 'audio', 'video', 'track', 'figure', 'figcaption',
     'table', 'caption', 'col', 'colgroup', 'tbody', 'td', 'tfoot', 'th',
     'thead', 'tr'].forEach(
         function (tag) {
             kInstrs[tag] = function (...argv) {
                argv.unshift(tag);
                return function (el) {
                    el.appendChild(e.apply(null, argv));
                };
            }
         }
    );

    function operator(obj) {
        for (let k in obj) { return k; }
    }

    function noop(el) { return el; }

    /**
     * The 'spec' is a JSON-serializable object from which a DOM
     * representation can be constructed. Here is a sample -
     *
     * {div: [{classes: 'container'}, {attrs: ['id', 'd123']},
     *        {ul: [{styles: ['font-family', 'sans-serif']}, 
     *              {li: "Item one"},
     *              {li: "Item two"}
     *              ]}]}
     *
     * That maps to -
     *
     * <div class="container" id="d123">
     *     <ul style="font-family: sans-serif;">
     *        <li>Item one</li>
     *        <li>Item two</li>
     *     </ul>
     * </div>
     */
    function compile(spec) {
        if (typeof(spec) === 'object') {
            let op = operator(spec);
            let fn = kInstrs[op];
            if (!fn) { return noop; }
            let val = spec[op];
            if (!(val instanceof Array)) { val = [val]; }
            return fn.apply(null, val.map(compile));
        }
        return spec;
    }

    return {
        px: px,
        pt: pt,
        rgba: rgba,
        e: e,
        text: text,
        attrs: attrs,
        classes: classes,
        styles: styles,
        children: children,
        handlers: handlers,
        asHandler: asHandler,
        props: props,
        tree: tree,
        compile: compile,
        handleServeRequest: handleServeRequest
    };
};
