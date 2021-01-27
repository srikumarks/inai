let _docstr = null;
const SwaggerUI = require("swagger-ui");

async function loadTheme(name = "material") {
    I.dom("swagger_ui_theme", {
        op: "set",
        tag: "link",
        once: true,
        attrs: {
            rel: "stylesheet",
            href: "/_codebase/named/swagger_ui/assets/theme-" + name + ".css",
        },
        childOf: "head",
    });
}

I.boot = async function boot(name, resid, query, headers, config) {
    let _doc = null;

    let element = document.querySelector("[inai-id='" + name + "']");

    async function getDocResponse() {
        if (!_doc) {
            // Do it only once. Can't do it at boot time because the boot time
            // id will be temporary.
            if (!_docstr) {
                _docstr = await (
                    await fetch("/_codebase/named/swagger_ui/assets/README.md")
                ).text();
            }

            _doc = {
                status: 200,
                headers: { "content-type": "text/markdown" },
                body: _docstr.replaceAll("{{ref}}", name),
            };
        }
        return _doc;
    }

    // GET /_doc
    // returns the documentation in the body text.
    I.get = async function (name, resid, query, headers) {
        if (resid === "/_doc") {
            return getDocResponse();
        }

        // Other GET APIs.

        return { status: 404 };
    };

    I.post = async function (name, resid, query, headers, spec) {
        // POST APIs
        if (resid === "/") {
            await loadTheme(config.theme);
            SwaggerUI({ ...spec, domNode: element });
            return { status: 200 };
        }

        return { status: 404 };
    };

    I.shutdown = async function (name, resid, query, headers, body) {
        I.boot = boot;
        I.shutdown = null;

        // Do custom cleanup required.

        return { status: 200 };
    };

    // Any additional boot steps go here.
    if (config.spec) {
        I.post(name, "/", null, null, config.spec);
    }

    I.boot = null;
    return { status: 200 };
};
