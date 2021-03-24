I.boot = function (name, resid, query, headers, config) {
    I.dom("materialize/icon", {
        op: "set",
        tag: "link",
        attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/icon?family=Material+Icons",
        },
        childOf: "head",
    });

    I.dom("materialize/css", {
        op: "set",
        tag: "link",
        attrs: {
            rel: "stylesheet",
            href: "/_codebase/named/materialize/assets/styles.css",
        },
        childOf: "head",
    });

    I.dom("meta/viewport", {
        op: "set",
        tag: "meta",
        attrs: {
            name: "viewport",
            content: "width=device-width, initial-scale=1.0",
        },
        childOf: "head",
    });

    I.dom("materialize/script", {
        op: "set",
        tag: "script",
        attrs: {
            type: "text/javascript",
            defer: "true",
            src: "/_codebase/named/materialize/assets/script.js",
        },
        childOf: "body",
    });

    I.boot = null;
    return { status: 200 };
};
