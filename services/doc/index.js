let showdown = require("showdown");
let md = new showdown.Converter({ headerLevelStart: 2 });

// POST /service to display the documentation associated with the
// given service.
I.boot = async function (name, resid, query, headers, body) {
    I.post = async function (name, resid, query, headers, body) {
        if (resid === "/close") {
            return I.dom(I._self, { op: "set", classes: "-is-active" });
        }
        let m = resid.match(/^[/]?([^/]+)$/);
        if (!m) {
            return { status: 404, body: "Not found" };
        }

        let service = m[1];
        let doc = await I.network(service, "get", "/_doc", null, null);
        if (doc.status >= 200 && doc.status < 300) {
            let html = md.makeHtml(doc.body);
            I.dom("doc/title", {
                sel: "doc/card-title",
                op: "set",
                body: "/doc/" + service,
            });
            I.dom("doc/body", { sel: "doc/card-body", op: "set", body: html });
            I.dom("doc/markdown/h", {
                sel: "#doc h2",
                op: "set",
                classes: "title is-2",
            });
            I.dom(I._self, { op: "set", classes: "is-active" });
            return { status: 200 };
        }

        return { status: doc.status };
    };

    // The `doc` service is a singleton service.
    // So when we boot it, create the necessary DOM elements
    // that it needs. For the moment, it requires Bulma as well
    // to work.
    /*
    <div id="doc" class="modal" inai="doc">
        <div class="modal-background"></div>
        <div class="modal-card">
            <header class="modal-card-head">
                <p class="modal-card-title" id="doc-title"></p>
                <button class="delete" aria-label="close"></button>
            </header>
            <section class="modal-card-body" id="doc-body">
            </section>
        </div>
    </div>
    */
    I.dom(I._self, { op: "set", sel: I._self, classes: "modal" });
    I.dom("doc/background", {
        op: "set",
        tag: "div",
        classes: "modal-background",
        childOf: I._self,
    });
    I.dom("doc/card", {
        op: "set",
        tag: "div",
        classes: "modal-card",
        childOf: I._self,
    });
    I.dom("doc/card-head", {
        op: "set",
        tag: "header",
        classes: "modal-card-head",
        childOf: "doc/card",
    });
    I.dom("doc/card-title", {
        op: "set",
        tag: "p",
        classes: "modal-card-title",
        attrs: { id: "doc-title" },
        childOf: "doc/card-head",
    });
    I.dom("doc/close", {
        op: "set",
        tag: "button",
        classes: "delete",
        attrs: { "aria-label": "close" },
        childOf: "doc/card-head",
    });
    I.dom("doc/card-body", {
        op: "set",
        tag: "section",
        classes: "modal-card-body",
        attrs: { id: "doc-body" },
        childOf: "doc/card",
    });
    I.dom("doc/close-event", {
        sel: "doc/close",
        op: "event",
        event: "click",
        service: "doc",
        verb: "post",
        resid: "/close",
    });

    return { status: 200 };
};
