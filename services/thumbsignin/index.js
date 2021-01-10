const _doc = `
# ThumbSignIn service

This inserts the required code and elements into the DOM using which the user
will be able to authenticate to the server using [ThumbSignin][TSI] service.

A good amount of the setup work is completed once the widget is "booted".
So all you need to get this setup going is to identify the widget container
element, give it an \`id\` attribute that uniquely identifies it and an 
\`inai\` attribute that has \`thumbsignin\` as its value, indicating that this
widget will be managed by the \`thumbsignin\` client-side service.

TSI will then set things up so that you can then use the \`id\` you've given 
to the widget and make requests to it. One of the things you may want to
do is to add button at an appropriate place on the page which you setup to
post a click event to \`/<tsi-widget-id>/login\` like this -

\`\`\`
<button inai-target="/<tsi-widget-id>/login">
    Login with ThumbSignIn
</button>
\`\`\`

Same goes if you want a "register with ThumbSignIn" button, which you direct
it to \`/<tsi-widget-id>/register\` instead.

Inai will wire up such buttons with the appropriate event handlers.

[TSI]: https://thumbsignin.com
`;

function sleep(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms, true);
    });
}

async function ensure(test, poll_ms) {
    while (!test()) {
        await sleep(poll_ms || 100);
    }
    return true;
}

I.boot = async function bootFn(name, resid, query, headers, config) {
    // As per ref: https://app.thumbsignin.com/app/web
    if (!config.LOGIN_CONFIG || !config.REGISTER_CONFIG) {
        return { status: 400, body: "Need LOGIN_CONFIG and REGISTER_CONFIG" };
    }

    const element = document.querySelector('[inai-id="' + I._self + '"]');
    if (!element) {
        console.error("Unattached thumbsignin!");
        return { status: 500, body: "Invalid thumbsignin boot" };
    }

    const elementId = element.getAttribute("id");

    const AtomicQueue = I.require("./atomic_queue");
    const queue = new AtomicQueue();

    // Create the platform script element and insert it.
    I.dom("thumbsignin/platformScript", {
        op: "set",
        tag: "script",
        once: true,
        attrs: { src: "https://thumbsignin.com/thumbsign_widget.js" },
        childOf: "head",
    });

    await ensure(() => window.thumbSignIn);

    window.thumbSignIn.addConfig("REGISTER_CONFIG", config.REGISTER_CONFIG);
    window.thumbSignIn.addConfig("LOGIN_CONFIG", config.LOGIN_CONFIG);

    const docResponse = {
        status: 200,
        headers: { "content-type": "text/markdown" },
        body: _doc,
    };

    I.get = async function (name, resid, query, headers) {
        if (resid === "/_doc") {
            return docResponse;
        }

        return { status: 404 };
    };

    let resources = {
        registration: {
            id: "tsRegister",
            config: "REGISTER_CONFIG",
            widget: null,
        },
        login: {
            id: "tsLogin",
            config: "LOGIN_CONFIG",
            widget: null,
        },
    };

    let residRE = new RegExp(
        "^[/]?(" + Object.keys(resources).join("|") + ")$"
    );

    I.delete = async function (name, resid, query, headers) {
        let pat = resid.match(residRE);
        if (!pat) {
            return { status: 200, body: "All is well" };
        }

        let resName = pat[1];
        let res = resources[resName];
        await queue.atomic(async () => {
            if (res.widget) {
                let widget = res.widget;
                res.widget = null;
                await widget.close();
            }
        });

        return { status: 200, body: "Closed" };
    };

    I.post = async function (name, resid, query, headers, body) {
        let pat = resid.match(residRE);
        if (!pat) {
            return { status: 404, body: "Not found" };
        }

        let resName = pat[1];
        let res = resources[resName];

        return await queue.atomic(async () => {
            if (res.widget) {
                await res.widget.refresh();
                return {
                    status: 200,
                    body: { ref: resid, message: "TSI refreshed QR code" },
                };
            }

            res.id = (query && query.id) || res.id;

            await window.thumbSignIn.init({
                id: res.id,
                config: res.config,
                container: elementId,
            });

            res.widget = window[res.id];

            await res.widget.open();

            return {
                status: 200,
                body: { ref: resid, message: "TSI opened widget" },
            };
        });
    };

    I.shutdown = async function (name, resid, query, headers) {
        await I.network(name, "delete", "/registration", null, headers);
        await I.network(name, "delete", "/login", null, headers);

        I.boot = bootFn;
        I.get = null;
        I.post = null;
        I.shutdown = null;
        return { status: 200 };
    };

    // Can boot only once.
    I.boot = null;
    return { status: 200, body: "Booted" };
};
