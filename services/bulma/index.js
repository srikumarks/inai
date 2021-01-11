I.boot = function (name, resid, query, headers, config) {
    I.dom("bulma/stylesheet", {
        op: "set",
        tag: "link",
        attrs: { rel: "stylesheet", href: "/static/css/bulma.css" },
        childOf: "head",
    });

    I.dom("bulma/fonts", {
        op: "set",
        tag: "script",
        attrs: {
            defer: true,
            src: "https://use.fontawesome.com/releases/v5.3.1/js/all.js",
        },
        childOf: "head",
    });

    I.boot = null;
    return { status: 200 };
};
