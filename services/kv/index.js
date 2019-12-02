
/**
 * A simple REDIS based key-value store. This can be made to
 * support larger-than-memory data using ARDB or SSDB.
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

// Holds the property that if two keys key1 and key2 are permitted,
// then their concatenation is also permitted.
const rePermittedKey = /^[-a-zA-z0-9_/]+$/;

function permittedKey(key) {
    return rePermittedKey.rest(key);
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
    let port = (args && args.port) || 6379;
    let keyspace = (args && args.keyspace) || '/inai/kv';

    let redis = I.require('redis').createClient({ host: host, port: port });
    let dbcall = redisop.bind(redis, redis);
    let dbkey = (key) => { return keyspace + key; };


    // get /path1/path2/key1
    // get /path1/path2/key2
    // get /path1/path2?prefix=true 
    //      will get /path1/path2/key1 and key2 in an array.
    I.get = async function (name, resid, query, headers) {
        try {
            if (query && query.prefix) {
                return { status: 200, body: await getPrefix(name, resid, query, headers) };
            }
            let key = name + '/' + resid;
            if (!permittedKey(key)) { throw "Bad key"; }
            let str = await dbcall('get', [dbkey(key)]);
            return { status: 200, body: JSON.parse(str) };
        } catch (e) {
            return { status: 404, body: "No such key" };
        }
    };

    I.put = async function (name, resid, query, headers, body) {
        try {
            let key = name + '/' + resid;
            if (!permittedKey(key)) { throw "Bad key"; }
            await dbcall('set', [dbkey(key), JSON.stringify(body)]);
            return { status: 200 };
        } catch (e) {
            return { status: 400, body: "Failed to set key" };
        }
    };

    I.shutdown = async function (name, resid, query, headers, body) {
        redis.end(true);
        I.get = undefined;
        I.put = undefined;
        I.post = undefined;
        I.shutdown = undefined;
        I.boot = bootEndPoint;
        return { status: 200, body: "Closed" };
    };

    // You can post an array of {k:,v:} objects to a key
    // end point ending in a '/' to have those subkeys
    // and their values added to it.
    I.post = async function (name, resid, query, headers, body) {
        let base = name + '/' + resid;
        if (/[/]$/.test(resid) && permittedKey(base) && body && 'length' in body) {
            let txn = redis.multi();
            let failedKeys = [];
            for (let {k,v} of body) {
                if (permittedKey(k) && k[0] !== '/') {
                    txn.set(base + k, JSON.stringify(v));
                } else {
                    failedKeys.push(k);
                }
            }
            await txnExec(txn);
            return { status: 200, body: { failedKeys: failedKeys } };
        }
    };

    async function getPrefix(name, resid, query, headers) {
        if (/[*]/.test(resid)) {
            return { status: 400, body: "Can't use wild card in prefix search." };
        }

        let keyPat = name + (resid[0] == '/' ? resid : '/' + resid) + '/*';
        if (!permittedKey(name + '/' + resid)) {
            throw "Bad key";
        }
        let prefixLen = keyPat.length - 1;

        // WARNING: This is a little dangerous in case the folks request
        // for all keys across the whole DB. But we mitigate that a little
        // bit by making the suffix pattern "/*". This gets us usual use
        // cases like getting all "fields" of a record or scanning a list
        // of items, without exposing a whole lot else.
        let keys = await dbcall('keys', [dbkey(keyPat)]);

        if (!keys) {
            throw "Not found";
        }

        if (!keys.length) {
            return [];
        }

        let txn = redis.multi();

        for (let i = 0; i < keys.length; ++i) {
            txn.get(keys[i]);
        }

        let result = await txnExec(txn);
        return result.map((v, i) => { return { k: keys[i].substring(prefixLen), v: JSON.parse(v.toString()) }; });
    }

    return { status: 200, body: "Started" };
}