let count = 0;

const _doc = `
# Pub/Sub messaging within browser

Post a message to \`/_subs\` with body containing -
\`{service: "name", prefix: "/resprefix", key: "/key"}\`
and a message body posted to \`/key\` will be sent to the given
service at the resource path \`/resprefix/key\`.
The result will be \`{status: 200, body: {id: "subscription_id"}}\`.
You can remove your subscription by sending \`delete\` to \`/_subs/subscription_id\`.

To publish a message to a key, post a message to \`/key\`
and the body will be sent to any service registered for the \`key\`.
Keys may not begin with '_' as those are reserved for targeting
the pubsub service itself.

A key can be multi-part like \`/a/b/c\`. If a service subscribes to
the key \`/a/b/c\`, then they end up receiving messages posted to
\`/a\`, \`/a/b\` and \`/a/b/c\`. That way, message posters can 
target larger or smaller groups of receivers organized in a hierarchy.
`;

function keyParts(key) {
    key = key.replace(/[/]+/g, "/");
    key = key.replace(/^[/]/g, "").replace(/[/]$/, "");
    return key.split("/");
}

function normalizedKey(key) {
    return "/" + keyParts(key).join("/");
}

I.boot = async function boot(name, resid, query, headers, config) {
    let baseId = 1;
    function newId() {
        return "" + baseId++;
    }

    let bus = new Map();
    let id2keys = new Map();

    // POST /_subs
    // with body: {service, prefix, key}
    // Registers for pubsub.
    I.post = function (name, resid, query, headers, body) {
        if (resid === "/_subs") {
            // Register subscription.
            // If you register for a key like "/a/b/c", then
            // you'll get messages posted to "/a", "/a/b" and "/a/b/c".
            let { service, prefix, key } = body;
            let id = newId();
            let regRec = { service: service, prefix: prefix, key: key };
            let parts = keyParts(key);
            let pkey = "";
            for (let i = 0; i < parts.length; ++i) {
                pkey += "/" + parts[i];
                if (!bus.has(pkey)) {
                    bus.set(pkey, new Map());
                }
                bus.get(pkey).set(id, regRec);
                if (!id2keys.has(id)) {
                    id2keys.set(id, new Set());
                }
                id2keys.get(id).add(pkey);
            }
            return { status: 200, body: { id: id } };
        }

        // Received a request to post a message.
        let key = normalizedKey(resid);
        let targets = bus.get(key);
        if (!targets) {
            return { status: 200 };
        }

        for (let [id, target] of targets) {
            // Note: We shouldn't "await" this.
            I.network(
                target.service,
                "post",
                target.prefix + key,
                query,
                headers,
                body
            );
        }
        return { status: 200 };
    };

    // GET /_doc
    // returns the documentation in the body text.
    I.get = function (name, resid, query, headers) {
        if (resid === "/_doc") {
            return {
                status: 200,
                headers: { "content-type": "text/markdown" },
                body: _doc.replace("{{ref}}", name),
            };
        }
        return { status: 404, body: "Not found" };
    };

    // DELETE /_subs/id
    // Ensures that that subscription with the given id
    // no longer exists.
    I.delete = function (name, resid, query, headers) {
        let subs = resid.match(/^[/]_subs[/]([^/]+)$/);
        if (subs) {
            let id = subs[1];
            let keys = id2keys.get(id);
            if (!keys) {
                return { status: 200 };
            }
            for (let k of keys) {
                bus.get(k).delete(id);
            }
            id2keys.delete(id);
            return { status: 200 };
        }

        return { status: 404 };
    };

    I.shutdown = function (name, resid, query, headers) {
        I.post = null;
        I.get = null;
        I.delete = null;
        I.boot = boot;
        return { status: 200 };
    };

    I.boot = null;
    return { status: 200 };
};
