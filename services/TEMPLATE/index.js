var _docstr = null;

I.boot = async function boot(name, resid, query, headers, config) {
    let _doc = null;

    async function getDocResponse() {
        if (!_doc) {
            // Do it only once. Can't do it at boot time because the boot time
            // id will be temporary.
            if (!_docstr) {
                let docId = (
                    await I.network(
                        "_codebase",
                        "get",
                        "/named/TEMPLATE/assets/README.md",
                        null,
                        null
                    )
                ).body;

                _docstr = (
                    await I.network(
                        "_codebase",
                        "get",
                        "/assets/" + docId,
                        null,
                        null
                    )
                ).body;
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

    I.post = async function (name, resid, query, headers, body) {
        // POST APIs

        return { status: 404 };
    };

    I.shutdown = async function (name, resid, query, headers, body) {
        I.boot = boot;
        I.shutdown = null;

        // Do custom cleanup required.

        return { status: 200 };
    };

    // Any additional boot steps go here.

    I.boot = null;
    return { status: 200 };
};
