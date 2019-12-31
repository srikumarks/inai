
// Kill the server upon unhandled rejection.
// This is so we're ahead of the deprecation curve.
process.on('unhandledRejection', up => { throw up })

/**
 * This module provides a facade between the server side components
 * and the external world that wants to access them. It places some
 * minimal protection via a simple token mechanism and by restricting
 * some calls to only the localhost.
 */
let network = require('./network');

let I = network.createNode({
    log: {
        requests: (process.env.LOG || "requests").indexOf('requests') >= 0,
        responses: (process.env.LOG || "responses").indexOf('responses') >= 0
    },
    random: random
});

I.env = process.env;

const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const app = express();
const port = +(process.env.PORT || 8080);
const bootFile = process.argv[2] || process.env.BOOTFILE || 'boot.json';

app.use(express.json({type:'application/json'}));
app.use(express.text({type:'text/plain'}));
app.use('/static', express.static('static'));

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
app.get('/_codebase/:codeId', withAuth(async function (req, res) {
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
                res.set('inai-args', encodeURIComponent(JSON.stringify(spec.config)));
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
app.put(/[/]_codebase[/]code[/]([^/]+)$/, onlyLocalhost(async function (req, res) {
    await I.network('_codebase', 'put', '/code/' + req.params[0], null, maybeBranch(req), req.body);
    res.status(200).send('ok');
}));

app.put(/[/]_codebase[/]meta[/]([^/]+)$/, onlyLocalhost(async function (req, res) {
    await I.network('_codebase', 'put', '/meta/' + req.params[0], null, maybeBranch(req), req.body);
    res.status(200).send('ok');
}));

app.put(/[/]_codebase[/]assets[/]([^/]+)$/, onlyLocalhost(async function (req, res) {
    await I.network('_codebase', 'put', '/assets/' + req.params[0], null, maybeBranch(req), req.body);
    res.status(200).send('ok');
}));

app.put(/[/]_codebase[/]named[/](.+)$/, onlyLocalhost(async function (req, res) {
    await I.network('_codebase', 'put', '/named/' + req.params[0], null, maybeBranch(req), req.body);
    res.status(200).send('ok');
}));

// Localhosts can query the DNS.
app.get('/_dns/:name', onlyLocalhost(async function (req, res) {
    let reply = await I.network('_dns', 'get', req.params.name, null, maybeBranch(req));
    sendReply(res, reply);
}));

// Localhosts can get component documentation.
app.get('/_doc/:name', onlyLocalhost(async function (req, res) {
    sendReply(res, await I.network(req.params.name, 'get', '/_doc', null, maybeBranch(req)));
}));

// Localhosts can switch components.
app.put('/_dns/:name', onlyLocalhost(async function (req, res) {
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
app.post('/_boot', onlyLocalhost(async function (req, res) {
    await bootFromSpec(branch, req.body);
    res.json(true);
}));

// Facility to dynamically configure services. You can use the
// /_config end point to direct key-value type config information
// at individual services. This end point is protected to be localhost
// only so that random entities cannot modify configuration information.
app.put('/:serviceId/_config/:key', onlyLocalhost(async function (req, res) {
    sendReply(res, await I.network(serviceId, 'put', '/_config/' + key, null, maybeBranch(req), req.body));
}));

// An end point which can proxy requests on behalf of clients.
// This offers a point where we can check whether a client actually
// has permissions to access the service references in the proxy
// request before forwarding it to this node's internal "network".
app.post('/:serviceId/_proxy', withAuth(async function (req, res) {
    let json = req.body;
    let perms = (req.params.serviceId === json.name); // It can access itself.
    if (!perms) {
        perms = (req.auth.services && req.auth.services[json.name]); // It has permissions to access the service.
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
        if (req.auth.branch) {
            json.headers['inai-branch'] = req.auth.branch;
        }
        let reply = await I.network(json.name, json.verb, json.resid, json.query, json.headers, json.body);
        res.json(reply);
    } else {
        res.status(404).send("Not found"); // Don't reveal the _proxy URL as valid unnecessarily.
    }
}));

// See boot.json file.
async function boot(bootFile) {
    let bootSpec = JSON.parse(fs.readFileSync(bootFile, 'utf8'));
    await bootCodebaseService(null, 'redis_codebase', bootSpec.boot[0].config);
    await bootFromSpec(null, bootSpec);
    installPublicHandler();
    start();
}

function bootFromSpec(branch, bootSpec) {
    let brh = br_header(branch);

    return new Promise(async (resolve, reject) => {
        for (let service of bootSpec.start) {
            let spec = await I.network('_codebase', 'get', '/named/'+service, null, brh);
            if (spec.status !== 200) {
                console.error("Failed to boot service " + service);
                continue;
            }
            spec = spec.body;
            if (spec.disabled || spec.env.indexOf('server') < 0) {
                console.log("Skipping", spec.name);
            } else {
                I.atomic(() => {
                    return bootService(branch, spec);
                });
            }
        }
        I.atomic(() => { resolve(true); });
    });
}

// Any other route end point encountered may be intended for
// a service marked "public". So check that and pass on the request.
function installPublicHandler() {
    app.use(async function (req, res, next) {
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

function start() {
    app.listen(port, () => {
        console.log("Started on port", port);
    });
}

function br_header(branch) {
    return branch ? { 'inai-branch': branch } : null;
}

async function ensureCodeLoaded(branch, codeId) {
    // WARNING: This is currently very inefficient. The code being
    // referred to will be loaded every time. That means a fetch from
    // the DB and a compilation. This is unnecessary and ideally if the
    // code isn't changed, there should be no fetch or compilation.
    //
    // This is alleviated by the fact that we watch for REDIS keyspace
    // events and load code when changes occur.
    let result = await I.network('_codebase', 'get', '/code/' + codeId, null, br_header(branch));
    if (result.status !== 200) { throw result; }
    let code = result.body;
    await I.network('_services', 'put', codeId, null, br_header(branch), code);
    return true;
}

// Resolve environment variable references in config values.
// You can refer to environment variables in the config files
// of services that are expected to run on the server side.
function resolveEnvVar(spec) {
    let json = JSON.stringify(spec);
    let pat = /[$]([A-Z_0-9]+)/g;
    json = json.replace(pat, function (match, varName) {
        if (!(varName in process.env)) {
            console.error("MISSING environment variable $" + varName);
            return match;
        }
        console.log("Picked up env var $" + varName);
        return process.env[varName];
    });
    return JSON.parse(json);
}

// Boots a service and maps its name to the booted service id.
async function bootService(branch, spec) {
    let brh = br_header(branch);
    spec = resolveEnvVar(spec);
    let name = spec.name;
    let codeId = spec.codeId;
    let args = spec.config;
    console.log("Booting " + (name || codeId) + " ... ");
    await ensureCodeLoaded(branch, codeId);
    let result = await I.network('_services', 'post', codeId + '/instances', null, brh, args);
    if (result.status !== 200) {
        console.error("bootService: Couldn't do it - " + JSON.stringify(result));
        return null;
    }
    let serviceId = result.body;
    if (name) {
        await I.network('_dns', 'put', name + '/_meta', null, brh, spec);
        await I.network('_dns', 'put', serviceId + '/_meta', null, brh, spec);
        await I.network('_dns', 'put', name, null, brh, serviceId);
    }
    console.log("... booted " + name + " [" + serviceId + "]");
    return serviceId;
}

// The redis_codebase service is currently special. I want to make it
// generic, but I can't work that in because I need the codebase
// server to load its own codebase then!
async function bootCodebaseService(branch, codeId, config) {
    let brh = br_header(branch);
    let src = fs.readFileSync('./services/' + codeId + '/index.js', 'utf8');
    let name = '_codebase';
    await I.network('_services', 'put', name, null, brh, src);
    let result = await I.network('_services', 'post', name + '/instances', null, brh, config);
    if (result.status !== 200) { throw result; }
    let serviceId = result.body;
    await I.network('_dns', 'put', '_codebase', null, brh, serviceId);
    return '_codebase';
}

function hash(str) {
    let h = crypto.createHash('sha1');
    h.update(str);
    return h.digest('hex');
}

function random(n) {
    return crypto.randomBytes(n).toString('hex');
}

function isLocalhost(ip) {
    return ip === '127.0.0.1' || ip === 'localhost' || ip === '::1';
}

function isForProfile(meta, profile) {
    // No metadata or environment list implies code usable in all profiles.
    return !meta || !(meta.env) || (meta.env.indexOf(profile) >= 0);
}

function delay(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms, true);
    });
}

function sendReply(res, reply) {
    res.status(reply.status);
    if (reply.headers) {
        res.set(reply.headers);
    }
    res.send(reply.body);
    return reply;
}

boot(bootFile);