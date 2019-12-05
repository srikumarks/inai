
I.boot = function (name, resid, query, headers, config) {

    I.dom('uikit/stylesheet', {
        op: 'set',
        tag: 'link',
        attrs: { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/uikit@3.2.4/dist/css/uikit.min.css' },
        childOf: 'head'
    });

    I.dom('uikit/js', {
        op: 'set',
        tag: 'script',
        attrs: { src: 'https://cdn.jsdelivr.net/npm/uikit@3.2.4/dist/js/uikit.min.js' },
        childOf: 'head'
    });

    I.dom('uikit/fonts', {
        op: 'set',
        tag: 'script',
        attrs: { src: 'https://cdn.jsdelivr.net/npm/uikit@3.2.4/dist/js/uikit-icons.min.js' },
        childOf: 'head'
    });

    I.boot = null;
    return { status: 200 };
};