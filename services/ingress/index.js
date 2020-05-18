
I.boot = async function mainBoot(name, resid, query, headers, config) {

    let servers = {};
    let nextServerID = 1;

    debugger;

    I.post = async function (name, resid, query, headers, body) {

        let serverRefID = nextServerID++;

        const express = I.require('express');
        const router = express.Router();
        const port = +(body.port || 8080);

        router.use(express.json({ type: 'application/json' }));
        router.use(express.text({ type: 'text/plain' }));
        router.use('/static', express.static('static'));

        // Use the `auth` service to grab a token and check it for user permissions.
        function withAuth(fn) {
            return async function (req, res, next) {
                let auth = await I.network('auth', 'post', '/check', null, req.headers, null);
                if (auth.status !== 200) { return sendReply(res, auth); }
                req.auth = auth.body;
                if (req.auth.branch) {
                    req.headers['inai-branch'] = req.auth.branch;
                }
                return fn(req, res, next).catch((err) => { res.status(503).send(err.toString()); });
            };
        }

        // A modifier which will call the handler only when the request is
        // coming from the localhost. Trusts the IP address given, which is
        // probably ok since we'll be fronting this with nginx usually.
        function onlyLocalhost(fn) {
            return function (req, res, next) {
                if (!isLocalhost(req.ip)) {
                    return res.status(403).send('Forbidden from ' + req.ip);
                }
                return fn(req, res, next).catch((err) => { res.status(503).send(err.toString()); });
            };
        }

        function maybeBranch(req) {
            // WARNING: Only accept branches authorized for access.
            // Don't just take on any branch value specified in
            // the inai-branch HTTP header. The `.auth` property
            // is added by the authentication middleware.
            let br = (req.auth && req.auth.branch);
            return br ? { 'inai-branch': br } : null;
        }

        // Use to fetch code of a component given its name id.
        // The code text is returned in the body of the request, but
        // the initialization config is returned in the `inai-args`
        // header, where it is JSON encoded and URI-component encoded
        // so that it won't interfere with the HTTP protocol.
        router.get('/_codebase/:codeId', withAuth(async function (req, res) {
            let codeId = req.params.codeId;
            try {
                let result = await I.network('_codebase', 'get', '/named/' + codeId, null, maybeBranch(req));
                if (result.status !== 200) {
                    sendReply(res, result);
                    return;
                }
                let spec = result.body;
                if (isForProfile(spec, req.auth.profile)) {
                    let code = (await I.network('_codebase', 'get', '/code/' + spec.codeId, null, maybeBranch(req))).body;
                    res.set('content-type', 'text/plain');
                    if (spec.config) {
                        res.set('inai-args', encodeURIComponent(JSON.stringify(resolveEnvVar(spec.config, I.env))));
                    }
                    res.status(200).send(code);
                    return;
                }
            } catch (e) {
                console.error("Couldn't fetch codebase " + codeId + " (" + e.toString() + ")");
                // No need to do anything. Basically, code not found.
            }
            res.status(404).send('Not found');
        }));

        // See redis_codebase service.
        router.put(/[/]_codebase[/]code[/]([^/]+)$/, onlyLocalhost(async function (req, res) {
            await I.network('_codebase', 'put', '/code/' + req.params[0], null, maybeBranch(req), req.body);
            res.status(200).send('ok');
        }));

        router.put(/[/]_codebase[/]meta[/]([^/]+)$/, onlyLocalhost(async function (req, res) {
            await I.network('_codebase', 'put', '/meta/' + req.params[0], null, maybeBranch(req), req.body);
            res.status(200).send('ok');
        }));

        router.put(/[/]_codebase[/]assets[/]([^/]+)$/, onlyLocalhost(async function (req, res) {
            await I.network('_codebase', 'put', '/assets/' + req.params[0], null, maybeBranch(req), req.body);
            res.status(200).send('ok');
        }));

        router.put(/[/]_codebase[/]named[/](.+)$/, onlyLocalhost(async function (req, res) {
            await I.network('_codebase', 'put', '/named/' + req.params[0], null, maybeBranch(req), req.body);
            res.status(200).send('ok');
        }));

        // Localhosts can query the DNS.
        router.get('/_dns/:name', onlyLocalhost(async function (req, res) {
            let reply = await I.network('_dns', 'get', req.params.name, null, maybeBranch(req));
            sendReply(res, reply);
        }));

        // Localhosts can get component documentation.
        router.get('/_doc/:name', onlyLocalhost(async function (req, res) {
            sendReply(res, await I.network(req.params.name, 'get', '/_doc', null, maybeBranch(req)));
        }));

        // Localhosts can switch components.
        router.put('/_dns/:name', onlyLocalhost(async function (req, res) {
            try {
                let name = req.params.name;
                let reply = await I.network('_dns', 'put', name, null, maybeBranch(req), req.body);
                if (reply.status === 200) {
                    res.status(200).send();
                } else {
                    sendReply(res, reply);
                }
            } catch (err) {
                res.status(503).send("Error");
            }
        }));

        // Permit a custom boot sequence at any time from localhost.
        router.post('/_boot', onlyLocalhost(async function (req, res) {
            await bootFromSpec(branch, req.body);
            res.json(true);
        }));

        // Facility to dynamically configure services. You can use the
        // /_config end point to direct key-value type config information
        // at individual services. This end point is protected to be localhost
        // only so that random entities cannot modify configuration information.
        router.put('/:serviceId/_config/:key', onlyLocalhost(async function (req, res) {
            let serviceId = req.params.serviceId;
            let key = req.params.key;
            sendReply(res, await I.network(serviceId, 'put', '/_config/' + key, null, maybeBranch(req), req.body));
        }));

        // An end point which can proxy requests on behalf of clients.
        // This offers a point where we can check whether a client actually
        // has permissions to access the service references in the proxy
        // request before forwarding it to this node's internal "network".
        router.post('/:serviceId/_proxy', withAuth(async function (req, res) {
            let json = req.body;
            let perms = (req.params.serviceId === json.name); // It can access itself.
            if (!perms) {
                perms = (req.auth.services && req.auth.services[json.name]) || null; // It has permissions to access the service.
            }
            if (!perms) {
                let spec = (await I.network('_codebase', 'get', '/named/' + json.name, null, maybeBranch(req))).body;
                perms = spec.public; // The service is public.
            }

            if (perms) {
                // Pass on the branch in a header so that the services
                // will know that we're operating in a branch of the
                // system and they can choose to maintain separate state
                // per branch.
                if (!json.headers) {
                    json.headers = {};
                }
                for (let k in req.headers) {
                    json.headers[k] = req.headers[k];
                }
                if (req.auth.branch) {
                    json.headers['inai-branch'] = req.auth.branch;
                }

                let result = await I.network(json.name, json.verb, json.resid, json.query, json.headers, json.body);

                // This is a proxy call, so the entire response needs to be passed back as the body.
                if (result.headers) {
                    transferCookies(result.headers, res);
                    res.set(result.headers);
                }
                res.json(result);
            } else {
                res.status(200).json({status: 404, body: "Not found"}); // Don't reveal the _proxy URL as valid unnecessarily.
            }
        }));

        // Any other route end point encountered may be intended for
        // a service marked "public". So check that and pass on the request.
        function installPublicHandler() {
            router.use(async function (req, res, next) {
                let m = req.path.match(/^[/]?([^/]+)(.*)$/); //  /(<serviceid>)(/<resid>)
                if (!m) { return res.status(404).send("Not found"); }
                let serviceName = m[1];
                let resid = m[2];
                let method = req.method.toLowerCase();
                let spec = await I.network('_dns', 'get', serviceName + '/_meta', null, maybeBranch(req));
                if (spec.status !== 200) {
                    console.error("Failed to get meta data of " + serviceName);
                    sendReply(res, spec);
                    return;
                }
                spec = spec.body;
                if (spec && (!spec.public || (spec.env && spec.env.indexOf('server') < 0))) {
                    res.status(404).send('Not found');
                    console.error('Accessing forbidden service ' + serviceName);
                    return;
                }

                try {
                    let result = await I.network(serviceName, method, resid, req.query, req.headers, req.body);
                    if (result.status >= 200 && result.status < 300) {
                        sendReply(res, result);
                    } else {
                        next();
                    }
                } catch (err) {
                    next();
                }
            });
        }

        function start(mountPoint) {
            servers[serverRefID] = new Promise((resolve, reject) => {
                const app = express();
                let started = false;
                app.use(mountPoint, router);
                let server = app.listen(port, () => {
                    console.log("Started on port", port);
                    started = true;
                    resolve({id: serverRefID, app: app, server: server, port: port});
                });
                server.on('error', reject);
                setTimeout(function () {
                    if (!started) {
                        console.error("Server not started for 30 seconds. Aborting!");
                        reject(new Error("Server start failed"));
                    }
                }, 30000);
            });
        }

        function isLocalhost(ip) {
            return ip === '127.0.0.1' || ip === 'localhost' || ip === '::1';
        }

        function isForProfile(meta, profile) {
            // No metadata or environment list implies code usable in all profiles.
            return !meta || !(meta.env) || (meta.env.indexOf(profile) >= 0);
        }

        function transferCookies(headers, res) {
            if (headers && 'set-cookie' in headers) {
                let cookies = headers['set-cookie'];
                delete headers['set-cookie'];
                for (let cookie of cookies) {
                    res.cookie(cookie.name, cookie.value, cookie);
                }
            }
        }

        function sendReply(res, reply) {
            res.status(reply.status);
            if (reply.headers) {
                transferCookies(reply.headers, res);
                res.set(reply.headers);
            }
            res.send(reply.body);
            return reply;
        }

        installPublicHandler();
        start(body.mount || '/');

        return { status: 200, body: { ref: '/' + serverRefID } };
    };

    I.get = async function (name, resid, query, headers) {
        let residParse = resid.match(/^[/]?([^/]+)$/);
        if (!residParse) {
            return { status: 404, body: 'No such ingress' };
        }

        let serverRefID = +(residParse[1]);
        if (!servers[serverRefID]) {
            return { status: 404, body: 'No such ingress' };
        }

        let info = await servers[serverRefID];

        return { status: 200, body: { ref: '/' + info.id, port: info.port } };
    };

    // Shuts down an identified server.
    I.delete = async function (name, resid, query, headers) {
        let residParse = resid.match(/^[/]?([^/]+)$/);
        if (!residParse) {
            return { status: 404, body: 'No such server' };
        }

        let serverRefID = +(residParse[1]);
        if (!servers[serverRefID]) {
            return { status: 200, body: 'ceased' };
        }

        try {
            let serverRef = await servers[serverRefID];
            delete servers[serverRefID];
            await closeServer(serverRef);
        } catch (e) {
            // Ignore error.
        }

        return { status: 200, body: { id: serverRefID } };
    };

    function closeServer(serverRef) {
        return new Promise((resolve, reject) => {
            serverRef.server.close(() => {
                console.log("Server " + serverRef.id + " closed");
                resolve(true);
            });
        });
    }

    // Resolve environment variable references in config values.
    // You can refer to environment variables in the config files
    // of services that are expected to run on the server side.
    function resolveEnvVar(spec, env) {
        let json = JSON.stringify(spec);
        let pat = /[$]([A-Z_0-9]+)/g;
        json = json.replace(pat, function (match, varName) {
            if (!(varName in env)) {
                console.error("MISSING environment variable $" + varName);
                return match;
            }
            console.log("Picked up env var $" + varName);
            return env[varName];
        });
        return JSON.parse(json);
    }


    I.shutdown = async function (name, resid, query, headers) {
        I.boot = mainBoot;
        I.shutdown = null;
        I.post = null;

        let prevServers = servers;
        servers = {};

        // Close all the servers.
        for (let serverRef of prevServers) {
            await closeServer(await serverRef);
        }

        return { status: 200, body: 'shutdown' };
    };

    I.boot = null;
    return { status: 200, body: 'booted' };
};
