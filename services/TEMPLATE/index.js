I.boot = async function boot(name, resid, query, headers, config) {
    let _docstr = null;
    let _doc = null; // This is the complete response object .. which is a constant
    // for a given instantiation of the service.

    async function getDocResponse() {
        if (!_doc) {
            // Do it only once and on demand so we don't do unnecessary network fetches
            // or keep around data tha tisn't required.
            if (!_docstr) {
                if (I.dom) {
                    // Handle it when used client side, which requires a network fetch.
                    // On the client side, I.dom provides a facade to the "dom" service
                    // and therefore checking for it is sufficient to detect browser-side
                    // environment. The URL based fetch does not expose the asset ID
                    // since it is an internal thing. Note that depending on your application
                    // mounting root, the "/_codebase" may need to be adjusted appropriately
                    // with a prefix.
                    _docstr = await (
                        await fetch(
                            "/_codebase/named/TEMPLATE/assets/README.md"
                        )
                    ).text();
                } else {
                    // On server side, it turns into a DB lookup via the "_codebase"
                    // service.
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
