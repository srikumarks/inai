
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

async function boot(args) {
    let host = (args && args.host) || '127.0.0.1';
    let port = (args && args.port) || 6380;
    let keyspace = (args && args.keyspace) || '/inai/codebase/';
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

    // get /code/:codeId - gives the code text
    // get /meta/:codeId - gives the code metadata, currently nothing
    // get /named/:name - gives the service metadata
    // get /named/:name/assets/:assetName - gets the asset ID for the name.
    // get /assets/:assetID - gets the asset content.
    I.get = async function (name, resid, query, headers) {
        let pat = resid.match(/^[/]?(code|meta|named|assets)[/](.+)$/);
        if (pat) {
            switch (pat[1]) {
                case 'code': {
                    let codeId = pat[2];
                    let code = await dbcall('get', [dbkey('code', codeId)]);
                    return { status: 200, body: code };
                }
                case 'meta': {
                    let codeId = pat[2];
                    let meta = await dbcall('get', [dbkey('meta', codeId)]);
                    return { status: 200, body: JSON.parse(meta) };
                }
                case 'assets': {
                    let assetId = pat[2];
                    let [type, asset] = await Promise.all([
                        dbcall('get', [dbkey('assets', assetId, 'meta', 'type')]),
                        dbcall('get', [dbkey('assets', assetId)])
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
                        let assetId = await dbcall('get', [dbkey('named', serviceName, 'assets', assetName)]);
                        cachedByName[name] = { keepUntil: Date.now() + 1000, body: assetId };
                        return { status: 200, body: assetId };
                    } else {
                        let [codeId, specStr] = await Promise.all([
                            dbcall('get', [dbkey('named', name, 'code')]),
                            dbcall('get', [dbkey('named', name)]) 
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
        let pat = resid.match(/^[/]?(code|meta|named|assets)[/](.+)$/);
        if (pat) {
            switch (pat[1]) {
                case 'code': {
                    let codeId = pat[2];
                    await master_dbcall('set', [dbkey('code', codeId), body]);
                    return { status: 200 };
                }
                case 'meta': {
                    let codeId = pat[2];
                    await master_dbcall('set', [dbkey('meta', codeId), JSON.stringify(body)]);
                    return { status: 200 };
                }
                case 'assets': {
                    let type = headers && headers['content-type'];
                    if (!type) { return { status: 400, body: 'Need to give content type.'}; }
                    let assetId = pat[2];
                    await Promise.all([
                        master_dbcall('set', [dbkey('assets', assetId), body]),
                        master_dbcall('set', [dbkey('assets', assetId, 'meta', 'type'), type])
                    ]);
                    return { status: 200 };
                }
                case 'named': {
                    let name = pat[2];
                    let assetsPat = name.match(/^([^/]+)[/]assets[/](.+)$/);
                    if (assetsPat) {
                        let serviceName = assetsPat[1];
                        let assetName = assetsPat[2];
                        await master_dbcall('set', [dbkey('named', serviceName, 'assets', assetName), body]); // body === assetId
                        return { status: 200 };
                    }
                    if (/[/]code$/.test(name)) {
                        // Ends in /code and so the value is a code id.
                        if (body.length > 80 || !(await master_dbcall('exists', [dbkey('code', body)]))) {
                            return { status: 400, body: 'Code ID does not exist.' };
                        }
                        await master_dbcall('set', [dbkey('named', name), body]);
                        return { status: 200 };
                    }

                    // Post the code.
                    await master_dbcall('set', [dbkey('named', name), body]);
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

    let keyWatchers = new Map(); // A map from a dbkey to a task to execute when it becomes available.
    watcher.psubscribe(keyspaceTriggerPatternPrefix + '*');
    watcher.on('pmessage', async function (pattern, channel, message) {
        let keyPart = channel.substring(keyspaceTriggerPatternPrefix.length);
        let specPat = keyPart.match(/^([^/]+)$/);
        if (specPat) {
            let serviceName = specPat[1];
            if (message === 'set') {
                // Get the spec and form a list of keys that must exist for us to
                // boot the services.
                console.log("Service", serviceName, "received. Waiting for all resources.")
                let spec = JSON.parse(await dbcall('get', [dbkey('named', serviceName)]));
                console.assert(spec.name === serviceName, "Spec service name is '" + spec.name + "' but given '" + serviceName + "'");
                let sched = (ref, loop) => {
                    console.log("Service", spec.name, "waiting for key", ref);
                    keyWatchers.set(ref, loop);
                    return true;
                }
                onSpecReady(spec, sched, async () => {
                    if (spec.disabled || spec.env.indexOf('server') < 0) {
                        console.log("Service [" + spec.name + "] loaded, but skipping due to disabled:" + spec.disabled + " or env:" + spec.env);
                        return;
                    }
                    console.log("Booting service", spec.name);
                    let codeId = await dbcall('get', [dbkey('named', spec.name, 'code')]);
                    let code = await dbcall('get', [dbkey('code', codeId)]);
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
            let keyPart = channel.substring(keyspacePrefix.length);
            if (keyWatchers.has(keyPart) && message === 'set') {
                let task = keyWatchers.get(keyPart);
                keyWatchers.delete(keyPart);
                I.atomic(task);
            }
        }
    });

    // Executes async task once all db resources needed for spec
    // are available. Until then, it keeps rescheduling itself.
    async function onSpecReady(spec, sched, task, cache) {
        let serviceName = spec.name;
        if (!cache) { cache = new Map(); }
        let loop = async () => { onSpecReady(spec, keyWatchers, task, cache); };
        let codeRef = dbkey('named', spec.name, 'code');
        let codeId = cache.get(codeRef);
        if (!codeId) {
            if (!(await dbcall('exists', [codeRef]))) {
                return sched(codeRef, loop);
            }
            codeId = await dbcall('get', [codeRef]);
            cache.set(codeRef, codeId);
        }
        let codeKey = dbkey('code', codeId);
        if (!cache.get(codeKey) && !(await dbcall('exists', [codeKey]))) {
            return sched(codeKey, loop);
        }
        cache.set(codeKey, true);
        if (spec.assets) {
            for (let asset in spec.assets) {
                let assetRef = dbkey('named', serviceName, 'assets', asset);
                let assetId = cache.get(assetRef);
                if (!assetId) {
                    if (!(await dbcall('exists', [assetRef]))) {
                        return sched(assetRef, loop);
                    }
                    assetId = await dbcall('get', [assetRef]);
                    cache.set(assetRef, assetId);
                }
                let assetKey = dbkey('assets', assetId);
                if (!cache.get(assetKey) && !(await dbcall('exists', [assetKey]))) {
                    return sched(assetKey, loop);
                }
                cache.set(assetKey, true);
                let assetType = dbkey('assets', assetId, 'meta', 'type');
                if (!cache.get(assetType) && !(await dbcall('exists', [assetType]))) {
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