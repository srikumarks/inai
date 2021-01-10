const _doc = `
# Vega graphing library

Loads up the [vega](https://vega.github.io/vega/) graphing library
and enables nodes to be targeted with graphing requests.

Once a node has been marked for use for displaying graphics,
you can \`post\` a request to it with a body giving the
vega-lite specification and get graphics drawn and widgets
enabled for that node. The body json is expected to have a
key named \`spec\` which actually has the Vega spec JSON.

> *Design note*: The \`.spec\` indirection is so that there
> is scope for adding variants for compatibility or extensions.
`;

function sleep(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms, true);
    });
}

function cleanup(I) {
    if (I.view) {
        I.view.finalize();
        I.view = null;
    }
}

async function requireVega(I, config) {
    if (window.inaiVegaScriptsAdded) {
        return true;
    }

    window.inaiVegaScriptsAdded = true;
    const scripts = {
        core: "https://cdn.jsdelivr.net/npm/vega@" + config.vega_core_version,
        lite:
            "https://cdn.jsdelivr.net/npm/vega-lite@" +
            config.vega_lite_version,
        embed:
            "https://cdn.jsdelivr.net/npm/vega-embed@" +
            config.vega_embed_version,
    };
    const symbols = {
        core: "vega",
        lite: "vegaLite",
        embed: "vegaEmbed",
    };

    let t0 = Date.now(),
        showT = t0 - 1000;

    // Create the platform script element and insert it.
    for (let script in scripts) {
        I.dom("vega/" + script, {
            op: "set",
            tag: "script",
            attrs: { src: scripts[script] },
            childOf: "head",
        });

        // It looks like we need to properly wait for symbols since
        // something async seems to be happening inside vegaEmbed.
        // So we wait for all dependencies in sequence as and when
        // we insert them.
        while (!window[symbols[script]]) {
            let now = Date.now();
            if (now - showT >= 1000) {
                console.log(
                    "Waiting for vega " +
                        script +
                        " to load ... (" +
                        (now - t0) +
                        "ms)"
                );
                showT = now;
            }
            await sleep(100);
        }

        console.log("Vega " + script + " is ready");
    }
}

I.boot = async function vegaBoot(name, resid, query, headers, config) {
    await requireVega(I, config);

    I.get = async function (name, resid, query, headers) {
        if (resid === "/_doc") {
            return {
                status: 200,
                headers: { "content-type": "text/markdown" },
                body: _doc,
            };
        }
        return { status: 404, body: "Not found" };
    };

    // Should the vega service be thought of as a global service
    // which can be used to address individual elements containing
    // graphics, or should a "vega" service be associated with
    // each of the graphics? Currently, I could go with either given
    // that the loading will end up happening on demand. However,
    // having vega associated with the node it is going to draw into
    // is valuable since inserting such a node will automatically
    // result in the vega code kicking in due to the client monitoring
    // the DOM. This will have to be setup manually if we take the global
    // approach.
    I.post = async function (name, resid, query, headers, body) {
        if (query && query.replace) {
            cleanup(I);
        }
        try {
            let result = await vegaEmbed(
                '[inai-id="' + I._self + '"]',
                body.spec
            );
            I.view = result.view; // Store it away for finalization.
        } catch (e) {
            return { status: 500, body: e.toString() };
        }

        return { status: 200 };
    };

    I.shutdown = async function (name, resid, query, headers) {
        cleanup(I);

        I.post = null;
        I.get = null;
        I.shutdown = null;
        I.boot = vegaBoot;

        return { status: 200 };
    };

    // Can boot only once.
    I.boot = null;

    // If the config already has a spec, use it to initialize the chart.
    if (config.spec) {
        I.network(name, "post", "/", null, null, { spec: config.spec });
    }

    return { status: 200, body: "Booted" };
};
