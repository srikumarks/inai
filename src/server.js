
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
const port = +(process.env.PORT || 9090);
const bootFile = process.argv[2] || process.env.BOOTFILE || 'boot.json';

// See boot.json file.
async function boot(bootFile) {
    let bootSpec = JSON.parse(fs.readFileSync(bootFile, 'utf8'));
    await bootCodebaseService(null, 'redis_codebase', bootSpec.boot[0].config);
    await bootFromSpec(null, bootSpec);
    start(bootSpec.mount);
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
            spec = resolveEnvVar(spec.body);
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

function start(mountPoint) {
    let express = require('express');
    const app = express();
    let services = {};

    const router = express.Router();
    router.use(express.json({ type: 'application/json' }));
    router.use(express.text({ type: 'text/plain' }));
    router.post(mountPoint, onlyLocalhost(async (req, res) => {
        let body = req.body;
        if (!body) { return res.status(500).send('Provide {port:nnnn} in request body'); }

        let service = services[body.port];
        if (service) {
            console.log("Service on port " + body.port + " already running");
            res.status(200).json({ ref: '/' + body.port });
            return;
        }

        let result = await I.network('ingress', 'post', '/', null, null, {
            port: body.port,
            mount: body.mount
        });

        if (result.status !== 200) {
            res.status(result.status).json(result.body);
            return;   
        }

        services[body.port] = {
            ref: '/' + body.port,
            ingress_ref: result.body.ref
        };

        res.status(200).json({ ref: '/' + body.port });
    }));
    router.get(mountPoint, onlyLocalhost(async (req, res) => {
        res.status(200).json({services: Object.keys(services).map(s => '/' + s)});
    }));
    router.get(mountPoint + ':port', onlyLocalhost(async (req, res) => {
        if (services[req.params.port]) {
            res.status(200).json({port: +(req.params.port), active: true});
        } else {
            res.status(404).send('not found');
        }
    }));
    router.delete(mountPoint + ':port', onlyLocalhost(async (req, res) => {
        let port = +(req.params.port);
        if (!services[port]) {
            // The purpose of the 'delete' request is to ensure, at the end,
            // that the identified service ceases to exist. If there is no
            // such service, the request can simply succeed at the task of
            // ensuring that the non-existent service doesn't exist.
            res.status(200).send('deleted');
            return;
        }

        let serviceInfo = services[port];
        delete services[port];
        console.log(JSON.stringify(serviceInfo));

        let result = await I.network('ingress', 'delete', serviceInfo.ingress_ref, null, null);
        res.status(result.status).json(result.body);
    }));

    app.use(mountPoint, router);
    app.listen(port, () => {
        console.log("Admin started on port", port);
        console.log("Use the following curl command to start an ingress service on port 8080.");
        console.log("---");
        console.log('curl -X POST -H "Content-Type: application/json" -d \'{"port":8080,"mount":"/"}\' http://localhost:' + port + mountPoint);
        console.log("---");
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
    if (spec.boot_deps && spec.boot_deps.length > 0) {
        for (let dep of spec.boot_deps) {
            let present = await I.network('_dns', 'get', dep, null, null);
            if (present.status !== 200) {
                // The service that this service depends on at boot time
                // isn't present yet. So need to start that. Note that the
                // dependencies that need to be declared are only those
                // needed at BOOT TIME and not those required for RUNTIME.
                // This is usualy an empty list as most services don't require
                // other services to just boot, but only call on other services
                // when some API is invoked.
                //
                // So when something needed by this service at boot time is
                // absent, we assume that the boot sequence has these services
                // in the list and they will eventually be booted. So we just
                // postpone the booting of this service until then.
                //
                // Note: Boot time dependencies cannot be circular.
                //
                // WARNING: Due to the "dependencies are already listed" assumption,
                // it is possible that this ends up in an infinite loop. Should
                // have a fix for that sometime.
                console.log("Postponing " + name + " until " + dep + " is available.");
                I.atomic(() => {
                    return bootService(branch, spec);
                });

                // We've postponed the boot. Leave right away.
                return;
            }
        }
    }
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
    return ip === '127.0.0.1' || ip === 'localhost' || ip === '::1' || ip === '::ffff:127.0.0.1';
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
