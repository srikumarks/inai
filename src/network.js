const AtomicQueue = require("./atomic_queue");

const isNodeJS = new Function(
    "try {return this===global;}catch(e){return false;}"
)();
const isBrowser = new Function(
    "try {return this===window;}catch(e){return false;}"
)();

const inaiRequire = isNodeJS ? global.require : null;

console.log(
    "inai: env detected",
    "isNodeJS=" + isNodeJS,
    "isBrowser=" + isBrowser
);

/**
 * This models a "node" that has a local network made available for
 * various services that reside in it. It therefore provides two
 * basic end points - `_dns` and `_services` -  where `_dns` is
 * responsible for mapping names to service ids and `_services` is
 * responsible for loading code and booting services running on
 * this node.
 *
 * Note that both `_dns` and `_services` are themselves registered as
 * services so that the code loading mechanism can be used to replace
 * them too if so desired.
 *
 * The primary idea behind this service segregation is to delimit the
 * scope of live code loading (at least for the moment), but there are
 * plenty of nice side effects too, as noted in DESIGN.md. Overall, I
 * think the overhead of using a REST interface between substantial
 * modules is not a major performance hit I think and is useful for
 * the side benefits.
 */
function createNode(options) {
    options = options || {};
    options.log = options.log || { requests: true, responses: true };

    // You can pass in your own logger. The server side currently
    // passes a winston logger and the client side just uses console.log.
    const logger = options.logger || console;

    // The server side can use a crypto-secure random generator.
    const random =
        options.random ||
        function random(n) {
            return Math.random().toString().split(".")[1];
        };

    // The node is represented by this object which has one async
    // member function in it - `I.network` - which makes a request
    // out to services on this node.
    //
    // NOTE: I haven't quite made up my mind about whether to make this
    // general enough to let the services punch through to the external
    // network, or reserve that capability for a particular gateway
    // service on this node. We'll see as we go along.
    let I = {
        atomic: atomic,
        network: network,
        require: inaiRequire,
        route: basicRouter,
    };
    let I_base = I;

    // DNS is currently simply a map of user-friendly names to
    // service IDs ... which are hashes.
    //
    // OWNED BY `_dns` service
    let dns = new Map();

    // Orphan services are those that have no names mapping to them.
    // NOTE: They may not be really orphans, because some service
    // may have booted up some private services that are not mapped
    // using the DNS. Not entirely sure whether such service are useful
    // and should be permitted but making a note of the orphan services
    // seems to be a useful thing to do.
    //
    // OWNED BY `_dns` service
    let orphanServices = new Set();

    // The service map is used to lookup the service object given
    // the service id.
    let services = new Map();

    // Maps code ids to {serviceDef:Function, instances:Set<id>, bootConfig:Map<id,Obj>}
    let codeBase = new Map();

    let reqid = 1; // Increments for every request.

    // Maps service name to policy regexp for testing against
    // <verb> <resid> |group1|group2|...|
    let policyForService = new Map();

    // Atomic ensures that no other atomic block will
    // run alongside any other one.
    //
    // pfunc is a function that returns a promise, or, equivalently,
    // an async function that takes no arguments.
    let atomicQueue = new AtomicQueue();

    function atomic(pfunc) {
        return atomicQueue.atomic(pfunc);
    }

    /**
     * This is the core "telecom switch" between all the services, which
     * communicate with each other through this function. It also makes
     * use of a _dns service which maps names to service IDs which are the
     * analog of IP addresses .. only private to this node.
     *
     * @param {string} service The name of the service. This is as declared
     *                          in the service's `spec.json` file.
     * @param {string} verb One of the standard http verbs .. in lower case.
     * @param {string} resid  The resource path name.
     * @param {object} query Query key-value object if any or null.
     * @param {object} headers Headers as a key-value object, or null.
     * @param {string|object} body Usually null, or string or JSON object.
     */
    async function network(service, verb, resid, query, headers, body) {
        let address = null;

        // If the given service address is directly in the services list,
        // we don't need to go via the DNS.
        if (services.has(service)) {
            address = service;
        } else {
            let result = await network("_dns", "get", service);
            if (result.status === 200) {
                address = result.body;
            } else {
                return not_found();
            }
        }

        let node = services.get(address);
        if (!node) {
            return not_found();
        }

        try {
            let p = policyForService.get(service);
            if (
                p &&
                !(service === "auth" && verb === "post" && resid === "/check")
            ) {
                let auth = await network(
                    "auth",
                    "post",
                    "/check",
                    query,
                    headers
                );
                if (auth.status === 200) {
                    let pat =
                        service +
                        " " +
                        verb +
                        " " +
                        resid +
                        " " +
                        auth.body.groups_pat;
                    if (!p.test(pat)) {
                        return server_error("not_permitted");
                    }
                } else {
                    return server_error("not_permitted");
                }
            }
            let rid = reqid++;
            if (options.log.requests && canLog(service)) {
                logger.log(
                    "REQ[" + rid + "]",
                    "v:" + verb,
                    "srv:" + service,
                    "res:" + resid,
                    "q:" + JSON.stringify(query || null),
                    "h:" + JSON.stringify(headers || null)
                );
            }
            let result = await node.route(
                service,
                verb,
                resid,
                query,
                headers,
                body,
                this._self
            );
            if (options.log.responses && canLog(service)) {
                logger.log(
                    "RES[" + rid + "]",
                    "v:" + verb,
                    "srv:" + service,
                    "res:" + resid,
                    "resp:" + JSON.stringify(result)
                );
            }
            return result;
        } catch (e) {
            logger.error("network: " + e);
            return server_error(e.toString());
        }
    }

    // The policy service tells whether a particular service request is permissible.
    let policyObj = Object.create(I);
    services.set("_policy", policyObj);
    policyObj.put = function (name, service, query, headers, access) {
        policyForService.set(service, new RegExp(access));
        return { status: 200 };
    };
    policyObj.get = function (name, service, query, headers) {
        let p = policyForService.get(service);
        return { status: p ? 200 : 404, body: p };
    };

    // The DNS is its own REST service and supports getting an address given a
    // name and setting an address to a name. This is very basic, but we can
    // imagine the address fetch being a bit more sophisticated in the future
    // when we want to run multiple versions of a service on the same node,
    // or load balance between some CPU/GPU intensive services.
    //
    // The DNS server can also store meta information about a service.
    // To get and set this meta information, append '/_meta' to the
    // resource name and you'll get the metadata object associated with
    // the service name. This works for setting metadata as well, for which
    // you can use the 'put' verb.

    let dnsObj = Object.create(I);
    services.set("_dns", dnsObj);
    dns.set(
        "/_doc",
        `
# DNS service

## GET/PUT \`name\`

Resolves the given name and returns the address of the service that
maps to that name. PUT will change the mapping.

## GET/PUT \`name/_meta\`

Gets/sets the full metadata object form associated with the name.
    `
    );
    dnsObj._dns = dns;
    dnsObj.get = function (name, resid, query, headers) {
        let entry = dns.get(resid);
        if (!entry) {
            return not_found();
        }

        return ok(entry); // This can be the address or meta data.
    };
    dnsObj.put = function (name, resid, query, headers, body) {
        if (/[/]_meta$/.test(resid)) {
            dns.set(resid, body);
            return ok();
        }
        let prevAddress = dns.get(resid);
        if (prevAddress) {
            console.log(resid + "[" + prevAddress + "] is now orphaned");
            orphanServices.add(prevAddress);
            orphanServices.delete(body);
        }
        orphanServices.delete(body);
        dns.set(resid, body);
        return ok();
    };

    // spec is of the following structure.
    // {
    //      type: "proxy",
    //      baseurl: "https://somewhere.com/someroot/",
    //      methods: ["get", "post"],
    //      query: {},
    //      headers: {}
    // }
    //
    // All except type and baseurl are optional.
    // If methods is omitted, it will be assumed to be ["get"].
    // Only the listed methods will be permitted.
    // If query is included, it should be an object of key-value associations.
    // Both keys and values will need to be strings.
    // Same holds for headers. The headers will be used as default values,
    // but can be overridden by headers coming in at request time.
    // This is useful to set authorization keys, for example that
    // clients shouldn't need to be aware of.
    function createProxyService(spec) {
        if (!spec || spec.type !== "proxy") {
            return null;
        }

        let proxy = Object.create(I);
        proxy._permittedMethods = new Set(spec.methods || ["get"]);
        proxy._baseurl = spec.baseurl;
        if (!/[/]$/.test(proxy._baseurl)) {
            proxy._baseurl += "/";
        }

        let baseQuery = spec.query;
        proxy._baseQueryStr = "";
        if (baseQuery) {
            for (let k in baseQuery) {
                // k shouldn't need encoding.
                proxy._baseQueryStr +=
                    (proxy._baseQueryStr.length > 0 ? "&" : "?") +
                    k +
                    "=" +
                    encodeURIComponent(baseQuery[k]);
            }
        }

        proxy._baseHeaders = spec.headers;
        proxy.route = proxyRouter;
        return proxy;
    }

    async function proxyRouter(name, verb, resid, query, headers, body) {
        if (!this._permittedMethods.has(verb)) {
            return { status: 405, body: "Method not allowed" };
        }

        if (resid[0] === "/") {
            resid = resid.replace(/^[/]+/, "");
        }
        let url = this._baseurl + resid;

        // Collect and prepare headers. Force content type to be application/json
        let sentHeaders = {};
        if (this._baseHeaders) {
            for (let k in this._baseHeaders) {
                sentHeaders[k] = this._baseHeaders[k];
            }
        }
        if (headers) {
            for (let k in headers) {
                sentHeaders[k] = headers[k];
            }
        }
        sentHeaders["content-type"] = "application/json"; // ALWAYS application/json.

        // Format the query part of the URL if any.
        let queryStr = this._baseQueryStr;
        if (query) {
            for (let k in query) {
                // k should not need URI encoding.
                queryStr +=
                    (queryStr.length > 0 ? "&" : "?") +
                    k +
                    "=" +
                    encodeURIComponent("" + query[k]);
            }
        }
        if (queryStr.length > 0) {
            url += queryStr;
        }

        // Make the request.
        let response = await fetch(url, {
            method: verb.toUpperCase(),
            headers: sentHeaders,
            body: JSON.stringify(body),
        });

        // The result headers passed back to the application
        // will always have lower case keys. If a header
        // occurs more than once, then the value passed on
        // will be an array of those values.
        let status = response.status;
        let resultHeaders = {};
        for (let h of response.headers) {
            let key = h[0].toLowerCase(),
                val = h[1];
            if (key in resultHeaders) {
                let prev = resultHeaders[key];
                if (!(prev instanceof Array)) {
                    prev = [prev];
                    resultHeaders[key] = prev;
                }
                prev.push(val);
            } else {
                resultHeaders[key] = val;
            }
        }

        // We support only application/json in the response. If we
        // get some other content type, pass on the error, but keep
        // the status and headers intact in case they provide more
        // info.
        let contentType = resultHeaders["content-type"] || "application/json";
        if (contentType !== "application/json") {
            return {
                status: status,
                headers: headers,
                error: new Error("Unsupported content type in response body"),
            };
        }

        try {
            let body = await response.json();
            return { status: status, headers: resultHeaders, body: body };
        } catch (e) {
            // Handle condition when the body isn't well formatted JSON or other garbage.
            return { status: status, headers: resultHeaders, error: e };
        }
    }

    // Helps load code and launch services. When you put code to this service,
    // it will load the code as a service definition body - i.e. the body
    // of a function with signature function (I, window, document) {...} -
    // where I is the service's state object. The service definition is expected
    // to define I.get, I.post and such for use by other services via the
    // network.
    //
    // DESIGN NOTE: At the moment, the functionalities of loading code and
    // instantiating the service are both clubbed into a single `put`
    // operation. This is enough for now, though in the future we may want
    // to separate these two aspects - where we're getting into sophisticated
    // services that need multiple instances of the same module.
    let serviceObj = Object.create(I);
    services.set("_services", serviceObj);

    serviceObj._services = services;

    const pathCodeInstances = /^[/]?([^/]+)[/]instances$/;
    const pathProxies = /^[/]?proxy[/]instances$/;
    const pathCodeSpecificInstance = /^[/]?([^/]+)[/]instances[/]([^/]+)$/;

    serviceObj.get = function (name, resid, query, headers) {
        // Get all instances.
        if (resid === "/instances") {
            return ok([...services.keys()]);
        }

        // Get instances of a module with the given code ID.
        // GET <codeid>/instances
        let m = resid.match(pathCodeInstances);
        if (m) {
            return ok([...codeBase.get(m[1]).instances]);
        }

        return not_found();
    };

    /**
     * Instantiates a service whose code has been loaded already.
     *
     * post <codeid>/instances
     *
     * @param {*} name The name of the service using which it is being invoked.
     * @param {*} resid Of the form "<codeId>/instances".
     * @param {*} query Not used
     * @param {*} headers Not used
     * @param {*} body JSON object giving initialization parameters. OPTIONAL
     *
     * post /proxy/instances
     * Use to install proxy services. A "proxy" relays the request to a
     * possibly remote entity and responds with its response
     * as though it were the remote entity itself. (Such a proxy is useless
     * to proxy already local services.)
     *
     * body is expected to be -
     * {type: "proxy", baseurl: "https://somewhere.com/someroot/", methods: ["get", "post"], query: {}, headers: {}}
     * Responds with id as usual after creating proxy.
     * You can subsequently map a DNS name to the given id to create a virtual service.
     * This way, we no longer have to distinguish between whether a service resides
     * locally or remotely ... reaching Erlang nirvana.
     *
     * The proxy implementation uses `fetch` which is polyfilled on nodejs
     * and is available by default in browsers. So proxying should work
     * seamlessly from clients as well as servers.
     */
    serviceObj.post = async function (name, resid, query, headers, body) {
        let m = resid.match(pathCodeInstances);
        if (!m || !codeBase.has(m[1])) {
            m = resid.match(pathProxies);
            if (m) {
                // QUESTION: Should I use a regular service specification to introduce
                // proxies? Maybe that'll work too, but perhaps only after I'm able to
                // implement code that can work on both clients and servers using `fetch`
                // transparently. Maybe next step. The interface is identical, so it shouldn't
                // matter to other services if the code gets moved out .. as long as I stick
                // with the name "proxy". Currently proxies can't be queried.
                let id = random(8);
                services.set(id, createProxyService(body));
                return ok(id);
            } else {
                return { status: 404, body: "Not found" };
            }
        }

        let codeId = m[1];
        let codeInfo = codeBase.get(codeId);
        let serviceDef = codeInfo.serviceDef;

        let id = (query && query.id) || null;
        let I = I_base;

        if (id && services.has(id)) {
            // We're replacing an existing service. We'll have to shutdown the
            // existing one first.
            //
            // NOTE: This shutdown shouldn't in general be done in the middle
            // of other operations in order to be nice to other dependent
            // services. However, dependent services are expected to be able to
            // catch errors and handle them when they occur and such a
            // "shutdown in the middle" will result in such a handle-able
            // error. In such cases, the dependent services should retry the
            // request or take some other appropriate action depending on the
            // context. If we try to be too nice to dependent services about this,
            // we end up bloating up the complexity of the sytem and also end up
            // compromising its performance by introducing coordination mechanisms
            // that will not be used in the normal course of operations.
            //
            // All that assumes that upgrades happen relatively infrequently. If
            // that assumption is invalid - for example when a team updates code
            // every 15mins or so, you may not want any hanging requests to be
            // interrupted that frequently. Again, if requests are short lived, this
            // should usually not be a problem. But if they're longer, we may need
            // mechanisms in place that take care of the necessary waiting.
            let old_I = services.get(id);
            await serviceObj.network(
                name,
                "delete",
                codeId + "/instances/" + id,
                null,
                null,
                null
            );
            if (query && query.retain_state) {
                I = old_I;
            }
        } else {
            id = id || random(8);
        }

        // First boot the service at a temp id.
        // Then swap that id for the real id atomically.
        let tmpId = id.split("_")[0];
        while (services.has(tmpId)) {
            tmpId = id + "_" + random(8);
        }

        // Any existing service has shutdown now. We can safely create
        // the next one.
        //
        // NOTE: If we create everytime, then we risk growing the prototype
        // chain unboundedly.  So we need to create only when we're not
        // replacing an existing service.
        let I2 = I === I_base ? Object.create(I) : I;
        I2._self = id;
        I2._code = codeId;

        // The serviceDef constructor is permitted to replace I.route with
        // its own implementation. The default router parcels off calls to
        // I.get, I.post and such. This is enough for simple cases of single
        // resource management.
        //
        // Note that a refactoring of this as codeInfo.serviceDef(I, window, document)
        // will leak codeInfo into the serviceDef function. So don't do it.
        if (isBrowser) {
            serviceDef(I2, logger, window, document);
        } else {
            serviceDef(I2, logger);
        }

        services.set(tmpId, I2);
        codeInfo.instances.add(tmpId);
        codeInfo.bootConfig.set(tmpId, body);

        try {
            let result = await serviceObj.network(
                tmpId,
                "boot",
                "/",
                null,
                null,
                body
            );
            if (result.status !== 200) {
                return result;
            }
        } finally {
            services.delete(tmpId);
            codeInfo.instances.delete(tmpId);
            codeInfo.bootConfig.delete(tmpId);
        }

        // Introduce the new service atomically.
        services.set(id, I2);
        codeInfo.instances.add(id);
        codeInfo.bootConfig.set(id, body);
        return ok(id);
    };

    // Loads and compiles the given code and assigns it the given resid as the id.
    // The body is expected to be the full text of the code.
    serviceObj.put = async function (name, resid, query, headers, body) {
        try {
            let code =
                "(function " +
                (isNodeJS ? "(I, console)" : "(I, console, window, document)") +
                " {\n" +
                body +
                "\n})";
            let serviceDef = inaiEval(resid, code);
            if (typeof serviceDef !== "function") {
                return bad_request("Service must provide function body.");
            }

            // If the codeId already exists, then replace the code of any existing instances.
            if (query && query.mode === "update") {
                let info = codeBase.get(resid);
                if (info) {
                    info.serviceDef = serviceDef;
                    // We need to make a copy of which instances to update
                    // because the process of updating instances will itself
                    // edit this set.
                    let instances = [...info.instances];
                    for (let id of instances) {
                        console.log(
                            'Updating "' + resid + '" service with id=' + id
                        );
                        let config =
                            "config" in query
                                ? query.config
                                : info.bootConfig.get(id);
                        await I.network(
                            "_services",
                            "post",
                            resid + "/instances",
                            { id: id },
                            null,
                            config
                        );
                    }
                    return ok({ instances: [...info.instances] });
                }
            }

            // New codebase. Setup its info record.
            codeBase.set(resid, {
                serviceDef: serviceDef,
                instances: new Set(),
                bootConfig: new Map(),
            });
            return ok({ instances: [] });
        } catch (e) {
            return bad_request(e.toString());
        }
    };

    // Use DELETE <codeId>/instances/<id> to shut down a service.
    serviceObj.delete = async function (name, resid, query, headers, body) {
        let m = resid.match(pathCodeSpecificInstance);
        if (!m || !codeBase.has(m[1])) {
            return { status: 404, body: "Not found" };
        }

        let codeId = m[1];
        let id = m[2];
        let codeInfo = codeBase.get(codeId);
        if (codeInfo && codeInfo.instances.has(id)) {
            console.log("Shutting down " + id);
            orphanServices.delete(id);
            try {
                await I.network(id, "shutdown", "/", null, null, null);
            } catch (e) {
                // We ignore errors at shutdown and just report them.
                // We can't have errors propagate in a destructor.
                console.error(e);
            }
            codeInfo.instances.delete(id);
            services.delete(id);
            console.log("Deleted " + id);
            return ok();
        }

        return not_found();
    };

    return I;
}

// The core is the route function whose default edition parcels off
// the requests to appropriate "verb methods".
function basicRouter(name, verb, resid, query, headers, body) {
    let I = this;
    let handler = I[verb];
    if (!handler) {
        return { status: 400, body: "Verb [" + verb + "] not supported" };
    }

    try {
        return handler(name, resid, query, headers, body);
    } catch (err) {
        return { status: 503, body: "Internal error" };
    }
}

function canLog(service) {
    return service[0] !== "_";
}

function not_found() {
    return { status: 404 };
}

function not_implemented() {
    return { status: 501 };
}

function ok(body) {
    return { status: 200, body: body };
}

function bad_request(explanation) {
    return { status: 400, body: explanation };
}

function server_error(explanation) {
    return { status: 503, body: explanation };
}

function inaiEval(name, code) {
    if (isNodeJS) {
        // Make code execution in NodeJS environment a bit controlled
        // using the vm module and running in a restricted context.
        let inaiRequire = require;
        let vm = inaiRequire("vm");
        let context = vm.createContext({
            setTimeout: setTimeout,
        });
        let s = new vm.Script(code, { filename: name });
        return s.runInContext(context);
    }

    if (isBrowser) {
        return eval(code);
    }

    throw new Error("Unsupported environment");
}

module.exports.createNode = createNode;
