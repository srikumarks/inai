
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
    return rePermittedKey.test(key);
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

    let ok = { status: 200 };
    let not_found = { status: 404, body: 'Not found' };
    let host = (args && args.host) || '127.0.0.1';
    let port = (args && args.port) || 6379;
    let write_host = (args && args.write_host) || host;
    let write_port = (args && args.write_port) || port;
    let keyspace = (args && args.keyspace) || '/inai/';

    // The branch keyspace is a prefix pattern which must have
    // one '*' in it which will be replaced with the branch
    // name.
    let branchKeyspace = (args && args.branchKeyspace) || keyspace.replace(/^[/]([^/]+)/, '/$1/b/*');

    // Ensure that the keyspaces terminate in '/'
    if (!/[/]$/.test(keyspace)) { keyspace += '/' }
    if (!/[/]$/.test(branchKeyspace)) { branchKeyspace += '/' }

    // Use different connections for read and write. That will
    // help when we want to direct writes to the master and reads to
    // a live replica.
    let redis = I.require('redis').createClient({ host: host, port: port });
    let write_redis = I.require('redis').createClient({ host: write_host, port: write_port });
    let dbcall = redisop.bind(redis, redis);
    let wdbcall = redisop.bind(write_redis, write_redis);
    let dbkey = (branch, key) => {
        return (branch ? branchKeyspace.replace('*',branch) : keyspace) + key;
    };
    let userkey = (service, resid) => {
        return service + (resid[0] === '/' ? '' : '/') + resid;
    }

    // The idea of a "branch" is a separate keyspace that is layered
    // on top of the existing keyspace so that the user gets to see
    // merged values - with the values on the branch taking precedence
    // over the values on the main trunk. When a user writes with a branch
    // code, the value gets written to the branch, which means services
    // which aren't aware of the branch will continue to see the base
    // data.
    //
    // This can be useful to create a safe space for deploying code
    // that can potentially modify the data in buggy ways. The idea is
    // you can operate a service on a branch until you're satisfied and
    // the merge the branch to the trunk when you're confident.
    let branch = (headers) => { return (headers && headers['inai-branch']) || null; };


    // get /path1/path2/key1
    // get /path1/path2/key2
    // get /path1/path2?prefix=true 
    //      will get /path1/path2/key1 and key2 in an array.
    // get /path1/path2?list=true
    //      will get list of items
    // get /path1/path2?list=true&unique=true
    //      will get set of items
    I.get = async function (name, resid, query, headers) {
        try {
            if (query && query.prefix) {
                return { status: 200, body: await getPrefix(name, resid, query, headers) };
            }
            if (query && query.list) {
                return { status: 200, body: await getList(query.unique ? 'smembers' : 'lrange', name, resid, query, headers); };
            }
            let key = userkey(name, resid);
            if (!permittedKey(key)) { throw "Bad key"; }
            let br = branch(headers);
            if (br) {
                let txn = redis.multi();
                txn.get(dbkey(br, key));
                txn.get(dbkey(null, key));
                let [cpstr, str] = await txnExec(txn);
                if (str === null) { return not_found; }
                return { status: 200, body: JSON.parse(cpstr === null ? str : cpstr) };
            } else {
                let str = await dbcall('get', [dbkey(null, key)]);
                return { status: 200, body: JSON.parse(str) };
            }
        } catch (e) {
            return not_found;
        }
    };

    I.put = async function (name, resid, query, headers, body) {
        try {
            let key = userkey(name, resid);
            if (!permittedKey(key)) { throw "Bad key"; }
            if (query && query.list) {
                await wdbcall(query.unique ? 'sadd' : 'rpush', [dbkey(branch(headers), key), ...body]);
            } else {
                await wdbcall('set', [dbkey(branch(headers), key), JSON.stringify(body)]);
            }
            return { status: 200 };
        } catch (e) {
            return { status: 400, body: "Failed to set key" };
        }
    };

    I.shutdown = async function (name, resid, query, headers, body) {
        redis.end(true);
        write_redis.end(true);
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
        let base = dbkey(branch(headers), userkey(name, resid));
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

    // Use to delete a branch ... by sending DELETE to /_branch/<brid>/<brns>
    I.delete = async function (name, resid, query, headers, body) {
        let br = resid.match(/^[/]_branch[/]([^/]+)[/]([^/]+)$/);
        if (!br) { return not_found; }
        let brid = br[1];
        let brns = br[2];

        await I.atomic(async () => {
            let keys = await dbcall('keys', dbkey(brid, brns + '/*'));
            let result = await wdbcall('del', keys);
            if (keys && (result !== keys.length)) {
                throw new Error('Found ' + keys.length + ' keys but deleted only ' + result);
            }
        });

        return ok;
    };

    // Use to merge a branch back to trunk by sending MERGE to /_branch/<brid>/<brns>
    // This is not a standard http verb, but we're only interested in REST, not HTTP.
    // The <brns> is useful to limit the merge to a subtree of the branch. For example,
    // you can merge back only the code associated with the branch without touching
    // any data by using the `codebase` namespace.
    I.merge = async function (name, resid, query, headers, body) {
        let br = resid.match(/^[/]_branch[/]([^/]+)[/]([^/]+)$/);
        if (!br) { return not_found; }
        let brid = br[1];
        let brns = br[2];

        await I.atomic(async () => {
            let keys = await dbcall('keys', dbkey(brid, brns + '/*'));
            if (keys && keys.length > 0) {
                let txn = redis.multi();
                for (let i = 0; i < keys.length; ++i) {
                    txn.rename(keys[i], keys[i].replace("/b/"+brid+"/"+brns, "/"+brns));
                }
                await txnExec(txn);
            }
        });

        return ok;
    };

    async function getPrefix(name, resid, query, headers) {
        if (/[*]/.test(resid)) {
            return { status: 400, body: "Can't use wild card in prefix search." };
        }

        let keyPat = userkey(name, resid) + '/*';
        if (!permittedKey(userkey(name, resid))) {
            throw "Bad key";
        }
        let br = branch(headers);
        let prefixLen = keyPat.length - 1;

        // WARNING: This is a little dangerous in case the folks request
        // for all keys across the whole DB. But we mitigate that a little
        // bit by making the suffix pattern "/*". This gets us usual use
        // cases like getting all "fields" of a record or scanning a list
        // of items, without exposing a whole lot else.
        let keys = await dbcall('keys', [dbkey(null, keysPat)]);

        if (!keys) {
            throw "Not found";
        }

        if (!keys.length) {
            return [];
        }

        let txn = redis.multi();

        for (let i = 0; i < keys.length; ++i) {
            if (br) { txn.get(br + keys[i]) };
            txn.get(keys[i]);
        }

        let result = await txnExec(txn);
        if (br) {
            let merged = [];
            for (let i = 0; i < result.length; i += 2) {
                merged.push(result[i] !== null ? result[i] : result[i + 1]);
            }
            return merged.map((v, i) => { return { k: keys[i].substring(prefixLen), v: JSON.parse(v.toString()) }; });
        } else {
            return result.map((v, i) => { return { k: keys[i].substring(prefixLen), v: JSON.parse(v.toString()) }; });
        }
    }

    async function getList(getter, name, resid, query, headers) {
        let key = userkey(name, resid);
        if (!permittedKey(key)) {
            throw "Bad key";
        }
        let br = branch(headers);

        let members = await dbcall(getter, getter === 'lrange' ? [dbkey(null, key), 0, -1] : [dbkey(null, key)]);
        if (!members) {
            throw "Now found";
        }

        if (!members.length) {
            return [];
        }

        return members;
    }

    return { status: 200, body: "Started" };
}