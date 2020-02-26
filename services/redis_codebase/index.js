/** 
 * A simple REDIS based key-value store used as the codebase. This can be made
 * to support larger-than-memory data using ARDB or SSDB, but am not expecting
 * that for source code.
 */


async function bootEndPoint(name, resid, query, headers, body) {
    return await boot(body);
};

I.boot = bootEndPoint;

function txnExec(txn) {
    return new Promise((resolve, reject) => {
        txn.exec((err, result) => {
            if (err) { return reject(err); }
            resolve(result);
        });
    });
}

function redisop(redis, opname, args) {
    return new Promise((resolve, reject) => {
        redis[opname].apply(redis, args.concat((err, result) => {
            if (err) { return reject(err); }
            resolve(result);
        }))
    });
}

// WARNING: Code duplication from server.js
//
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

async function boot(args) {
    let host = (args && args.host) || '127.0.0.1';
    let port = (args && args.port) || 6380;
    let keyspace = (args && args.keyspace) || '/inai/codebase/';
    
    // Must have one '*' which will be replaced with the branch name.
    let branchKeyspace = (args && args.branchKeyspace) || keyspace.replace(/^[/]([^/]+)/, '/$1/b/*');
    if (!/[*]/.test(branchKeyspace)) {
        return { status: 400, body: 'Invalid branch keyspace' };
    }
    let branchKeyspacePat = new RegExp(branchKeyspace.replace('*','([^/]+)') + '(.*)$');

    let master_host = (args && args.master_host) || host;
    let master_port = (args && args.master_port) || port;

    let dbkey = (...args) => {
        return keyspace + args.join('/');
    };

    let redis = I.require('redis').createClient({ host: host, port: port });
    let master_redis = I.require('redis').createClient({ host: master_host, port: master_port });
    let dbcall = redisop.bind(redis, redis);
    let master_dbcall = redisop.bind(master_redis, master_redis);
    let cachedByName = {};
    let dynkeyspace = (branch) => branch ? branchKeyspace.replace('*', branch) : keyspace;
    let dbget = async (db, branch, key) => {
        if (branch) {
            let txn = redis.multi();
            txn.get(dynkeyspace(branch) + key);
            txn.get(keyspace + key);
            let vals = await txnExec(txn);
            return vals[0] || vals[1];
        } else {
            return await redisop(redis, 'get', [keyspace + key]);
        }
    };
    let dbset = async (db, branch, key, val) => {
        return await redisop(redis, 'set', [dynkeyspace(branch) + key, val]);
    };
    let dbexists = async (db, branch, key) => {
        return await redisop(redis, 'exists', [dynkeyspace(branch) + key]);
    }; 
    let getBranch = (key) => {
        let m = key.match(branchKeyspacePat);
        return m && m[1];
    };

    // get /code/:codeId - gives the code text
    // get /meta/:codeId - gives the code metadata, currently nothing
    // get /named/:name - gives the service metadata
    // get /named/:name/assets/:assetName - gets the asset ID for the name.
    // get /assets/:assetID - gets the asset content.
    I.get = async function (name, resid, query, headers) {
        let db = redis;
        let branch = headers && headers['inai-branch'];
        let pat = resid.match(/^[/]?(code|meta|named|assets)[/](.+)$/);
        if (pat) {
            switch (pat[1]) {
                case 'code': {
                    let codeId = pat[2];
                    let code = await dbget(db, branch, 'code/' + codeId);
                    return { status: 200, body: code };
                }
                case 'meta': {
                    let codeId = pat[2];
                    let meta = await dbget(db, branch, 'meta/' + codeId);
                    return { status: 200, body: JSON.parse(meta) };
                }
                case 'assets': {
                    let assetId = pat[2];
                    let [type, asset] = await Promise.all([
                        dbget(db, branch, 'assets/' + assetId + '/meta/type'),
                        dbget(db, branch, 'assets/' + assetId)
                    ]);
                    return { status: 200, headers: { 'content-type': type }, body: asset };
                }
                case 'named': {
                    let name = pat[2];
                    let cached = cachedByName[name];
                    if (cached && Date.now() < cached.keepUntil) {
                        return { status: 200, body: cached.body };
                    }
                    let assetsPat = name.match(/^([^/]+)[/]assets[/](.+)$/);
                    if (assetsPat) {
                        // This is a reference to an asset.
                        let serviceName = assetsPat[1];
                        let assetName = assetsPat[2];
                        let assetId = await dbget(db, branch, 'named/' + serviceName + '/assets/' + assetName);
                        cachedByName[name] = { keepUntil: Date.now() + 1000, body: assetId };
                        return { status: 200, body: assetId };
                    } else {
                        let [codeId, specStr] = await Promise.all([
                            dbget(db, branch, 'named/' + name + '/code'),
                            dbget(db, branch, 'named/' + name)
                        ]);
                        let spec = JSON.parse(specStr);
                        spec.codeId = codeId;
                        cachedByName[name] = { keepUntil: Date.now() + 1000, body: spec };
                        return { status: 200, body: spec };
                    }
                }
            }
        }
        return { status: 404, body: 'Not found' };
    };
   
    I.put = async function (name, resid, query, headers, body) {
        let db = master_redis;
        let branch = headers && headers['inai-branch'];
        let pat = resid.match(/^[/]?(code|meta|named|assets)[/](.+)$/);
        if (pat) {
            switch (pat[1]) {
                case 'code': {
                    let codeId = pat[2];
                    await dbset(db, branch, 'code/' + codeId, body);
                    return { status: 200 };
                }
                case 'meta': {
                    let codeId = pat[2];
                    await dbset(db, branch, 'meta/' + codeId, JSON.stringify(body));
                    return { status: 200 };
                }
                case 'assets': {
                    let type = headers && headers['content-type'];
                    if (!type) { return { status: 400, body: 'Need to give content type.'}; }
                    let assetId = pat[2];
                    await Promise.all([
                        dbset(db, branch, 'assets/' + assetId, body),
                        dbset(db, branch, 'assets/' + assetId + '/meta/type')
                    ]);
                    return { status: 200 };
                }
                case 'named': {
                    let name = pat[2];
                    let assetsPat = name.match(/^([^/]+)[/]assets[/](.+)$/);
                    if (assetsPat) {
                        let serviceName = assetsPat[1];
                        let assetName = assetsPat[2];
                        await dbset(db, branch, 'named/' + serviceName + '/assets/' + assetName, body); // body === assetId
                        return { status: 200 };
                    }
                    if (/[/]code$/.test(name)) {
                        // Ends in /code and so the value is a code id.
                        if (body.length > 80 || !(await master_dbcall('exists', [dbkey('code', body)]))) {
                            return { status: 400, body: 'Code ID does not exist.' };
                        }
                        await dbset(db, branch, 'named/' + name, body);
                        return { status: 200 };
                    }

                    // Post the code.
                    dbset(db, branch, 'named/' + name, body);
                    return { status: 200 };
                }
            }
        }
        return { status: 404, body: 'Not found' };
    };

    I.shutdown = async function (name, resid, query, headers, body) {
        I.get = undefined;
        I.boot = bootEndPoint;
        I.shutdown = undefined;
        redis.end(true);
        watcher.end(true);
        return { status: 200, body: 'Closed' };
    };

    let watcher = I.require('redis').createClient({ host: host, port: port });
    let keyspacePrefix = '__keyspace@0__:';
    let keyspaceTriggerPatternPrefix = keyspacePrefix + keyspace + 'named/';
    let keyspaceTriggerRE = new RegExp(keyspacePrefix + keyspace.replace(/^[/]([^/]+)/, '/$1(/b/([^/]+))?') + 'named/(.+)');

    let keyWatchers = new Map(); // A map from a dbkey to a task to execute when it becomes available.
    const branchPat = keyspaceTriggerPatternPrefix.replace(/:[/]([^/]+)[/]/, ':/$1/b/*/') + '*';
    const normalPat = keyspaceTriggerPatternPrefix + '*';
    watcher.psubscribe(branchPat, normalPat);
    watcher.on('pmessage', async function (pattern, channel, message) {
        let db = redis;
        let chparse = channel.match(keyspaceTriggerRE);
        let branch = chparse[2];
        let keyPart = chparse[3];
        let specPat = keyPart.match(/^([^/]+)$/);
        if (specPat) {
            let serviceName = specPat[1];
            if (message === 'set') {
                // Get the spec and form a list of keys that must exist for us to
                // boot the services.
                console.log("Service", serviceName, "received. Waiting for all resources.")
                let spec = resolveEnvVar(JSON.parse(await dbget(db, branch, 'named/' + serviceName)));
                console.assert(spec.name === serviceName, "Spec service name is '" + spec.name + "' but given '" + serviceName + "'");
                let sched = (ref, loop) => {
                    console.log("Service", spec.name, "waiting for key", ref);
                    keyWatchers.set(ref, loop);
                    return true;
                }
                onSpecReady(branch, spec, sched, async () => {
                    if (spec.disabled || (spec.env.indexOf('server') < 0)) {
                        console.log("Service [" + spec.name + "] loaded, but skipping due to disabled:" + spec.disabled + " or env:" + spec.env);
                        return true;
                    }
                    console.log("Booting service " + spec.name);
                    let codeId = await dbget(db, branch, 'named/' + spec.name + '/code');
                    let code = await dbget(db, branch, 'code/' + codeId);
                    await I.network('_services', 'put', codeId, null, null, code);
                    let result = await I.network('_services', 'post', codeId + '/instances', null, null, spec.config);
                    if (result.status < 200 || result.status >= 300) {
                        console.error("Failed to boot service [" + spec.name + "]");
                        return;
                    }
                    let serviceId = result.body;
                    await I.network('_dns', 'put', serviceId + '/_meta', null, null, spec);
                    await I.network('_dns', 'put', spec.name + '/_meta', null, null, spec);
                    await I.network('_dns', 'put', spec.name, null, null, serviceId);
                    console.log("Service [" + spec.name + "] is now ready.");
                });
            }
        } else {
            let fullKeyPart = channel.substring(keyspacePrefix.length);
            if (keyWatchers.has(fullKeyPart) && message === 'set') {
                let task = keyWatchers.get(fullKeyPart);
                keyWatchers.delete(fullKeyPart);
                I.atomic(task);
            }
        }
    });

    // Executes async task once all db resources needed for spec
    // are available. Until then, it keeps rescheduling itself.
    async function onSpecReady(branch, spec, sched, task, cache) {
        let db = redis;
        let bkeyspace = dynkeyspace(branch);
        let serviceName = spec.name;
        if (!cache) { cache = new Map(); }
        let loop = async () => { onSpecReady(branch, spec, sched, task, cache); };
        let nsCodeRef = 'named/' + spec.name + '/code';
        let codeRef = bkeyspace + nsCodeRef;
        let codeId = cache.get(codeRef);
        if (!codeId) {
            if (!(await dbexists(db, branch, nsCodeRef))) {
                return sched(codeRef, loop);
            }
            codeId = await dbget(db, branch, nsCodeRef);
            cache.set(codeRef, codeId);
        }
        let nsCodeKey = 'code/' + codeId;
        let codeKey = bkeyspace + nsCodeKey;
        if (!cache.get(codeKey) && !(await dbexists(db, branch, nsCodeKey))) {
            return sched(codeKey, loop);
        }
        cache.set(codeKey, true);
        if (spec.assets) {
            for (let asset in spec.assets) {
                let nsAssetRef = 'named/' + serviceName + '/assets/' + asset;
                let assetRef = bkeyspace + nsAssetRef;
                let assetId = cache.get(assetRef);
                if (!assetId) {
                    if (!(await dbexists(db, branch, nsAssetRef))) {
                        return sched(assetRef, loop);
                    }
                    assetId = await dbget(db, branch, nsAssetRef);
                    cache.set(assetRef, assetId);
                }
                let nsAssetKey = 'assets/' + assetId;
                let assetKey = bkeyspace + nsAssetKey;
                if (!cache.get(assetKey) && !(await dbexists(db, branch, nsAssetKey))) {
                    return sched(assetKey, loop);
                }
                cache.set(assetKey, true);
                let nsAssetType = 'assets/' + assetId + '/meta/type';
                let assetType = bkeyspace + nsAssetType;
                if (!cache.get(assetType) && !(await dbexists(db, branch, nsAssetType))) {
                    return sched(assetType, loop);
                }
                cache.set(assetType, true);
            }
        }

        // All good. Execute the task.
        I.atomic(task);
    }

    return { status: 200, body: "Started" };
}