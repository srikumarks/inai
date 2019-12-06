
I.boot = function (name, resid, query, headers, config) {
    I.dom('bulma/stylesheet', {
        op: 'set',
        tag: 'link',
        attrs: { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/bulma@0.8.0/css/bulma.min.css' },
        childOf: 'head'
    });

    I.dom('bulma/fonts', {
        op: 'set',
        tag: 'script',
        attrs: { defer: true, src: 'https://cdn.jsdelivr.net/npm/bulma@0.8.0/css/bulma.min.css'},
        childOf: 'head'
    });

    I.boot = null;
    return { status: 200 };
};