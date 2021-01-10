const _doc = `
# Notifications service

This inserts a limited number of notifications upon
post requests. It saves the notifications in localstorage
until they're all dismissed by the user. 

\`\`\`
I.network('notifier', 'post', '/', null, null, {
    id: 'explicit-id',
    type: "error|warning|success|info",
    html: "some html content",
    expiry_secs: 15,
    light: true
});

If you post to an id that already exists and is visible, then
the notification gets updated with new content. The id must
conform to the regex "[-._A-Za-z0-9]+" or the post will fail.

> TODO: The "posting to id" feature is not implemented yet. So
> the id itself is dummy and unused right now.

You create a div under which notifications will be displayed
and assign this service to that. Then you can post notifications
using the id of that div.

If you set the 'data-context' attribute on the element to an
identifier string, then the notifications posted to this service
instance will be considered to be part of that context. This way,
notifiers with the same id across multiple pages can show
different sets of notifications - in a context dependent manner -
which being referred to using the same name. If you don't want
such a context dependence, you can omit the 'data-context' attribute
which will then use the context named 'global'.

\`\`\`
<div id="notifier" inai="notifications" data-context="dashboard"></div>
\`\`\`

The above will collect and show notifications pertaining to the
"dashboard" context, though you can post to it using a common id
"notifier".
`;

I.boot = async function main(name, resid, query, headers, config) {
    const context =
        document
            .querySelector('[inai-id="' + I._self + '"]')
            .getAttribute("data-context") || "global";
    const storageId =
        (config.storageId || "inai-notifications") + "-" + context;
    const idPat = /^[-._A-Za-z0-9]+$/;
    const expiry_secs = config.expiry_secs || 3600;
    const maxShown = config.maxShown || 2;
    const isLight = config.isLight;
    const classFromType = {
        error: "is-danger",
        warning: "is-warning",
        success: "is-success",
        info: "is-info",
    };

    let pendingRefresh = null;
    let idnum = 1;

    function refresh() {
        let now = Date.now();
        pending = pending.filter((n) => n.expires_at > now);
        pending.sort((a, b) => b.time - a.time);

        for (
            let i = 0, N = Math.min(maxShown, pending.length);
            i < pending.length;
            ++i
        ) {
            pending[i].shown = i < N;
        }

        window.localStorage[storageId] = JSON.stringify(pending);

        I.dom(I._self, {
            op: "set",
            body: {
                children: [
                    { clear: "" },
                    ...pending
                        .filter((n) => n.shown)
                        .map((n) => {
                            return {
                                div: [
                                    {
                                        cls: [
                                            "notification",
                                            classFromType[n.type],
                                            ...(n.light ? ["is-light"] : []),
                                        ],
                                    },
                                    {
                                        button: [
                                            { cls: "delete" },
                                            {
                                                attrs: [
                                                    "inai-target",
                                                    "//" +
                                                        I._self +
                                                        "/_delete/" +
                                                        n.idnum,
                                                ],
                                            },
                                        ],
                                    },
                                    { div: { html: n.html } },
                                    {
                                        serve:
                                            "/notifications/" +
                                            storageId +
                                            "/" +
                                            n.idnum,
                                    },
                                ],
                            };
                        }),
                ],
            },
        });

        let expiries = pending.map((n) => n.expires_at);
        expiries.sort((a, b) => a - b);
        if (expiries.length > 0) {
            if (pendingRefresh) {
                clearTimeout(pendingRefresh);
            }
            pendingRefresh = setTimeout(
                refresh,
                expiries[0] + 500 - Date.now()
            );
        }

        return pendingRefresh;
    }

    let pending = [];

    const delPat = /^[/]?_delete[/]([0-9]+)$/;

    I.post = async function (name, resid, query, headers, body) {
        let m = resid.match(delPat);
        if (m) {
            let idnum = +m[1];
            pending = pending.filter((n) => n.idnum !== idnum);
            await I.network(
                "dom",
                "delete",
                "/notifications/" + storageId + "/" + idnum,
                null,
                null
            );
            refresh();
            return { status: 200 };
        }

        let now = Date.now();

        pending.push({
            id: body.id || undefined,
            idnum: idnum++,
            type: body.type,
            html: body.html,
            time: now,
            light: "light" in body ? body.light : isLight,
            expires_at:
                now +
                Math.min(expiry_secs, body.expiry_secs || expiry_secs) * 1000,
            shown: false,
        });

        refresh();

        return { status: 200 };
    };

    I.shutdown = function (name, resid, query, headers) {
        I.boot = main;
        I.post = null;
        I.shutdown = null;
        return { status: 200 };
    };

    I.boot = null;

    if (!(storageId in window.localStorage)) {
        window.localStorage[storageId] = "[]";
    }

    pending = JSON.parse(window.localStorage[storageId]);
    refresh();

    return { status: 200 };
};
