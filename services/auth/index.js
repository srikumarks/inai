
/** 
 * A simple authentication service that can generate basic timestamped tokens.
 * The tokens don't identify users, but applications using the standard
 * appid/secret idea.
 * 
 * TODO: `auth` is currently mostly hard coded in the spec.json and will need to be
 * fleshed out into a more robust service.
 */
let crypto = I.require('crypto');


function random(n) {
    return crypto.randomBytes(n).toString('hex');
}

function newSalt() {
    return random(10);
}

function newBranch(secret, user) { 
    let b = random(4) + '.' + user;
    let brand = hmac(secret, b).substring(0, 8);
    let bsig = hmac(secret, brand).substring(0,8);
    return brand + '-' + bsig;
}

function validBranchID(secret, branch) {
    let parts = branch.split('-');
    if (parts.length !== 2) { return null; }
    return hmac(secret, parts[0]).substring(0,8) === parts[1] ? parts[0] : null;
}

function hmac(secret, data) {
    let h = crypto.createHmac('sha1', secret);
    h.update(data);
    return h.digest('hex');
}

// Notice how we're only defining the `boot` verb initially
// and when booting is initiated we populate the other
// handlers and disable booting again.
I.boot = async function (name, resid, query, headers, config) {

    // Hardcoded for now.
    // TODO: Use the codebase store for app permissions too.
    let knownApps = config.knownApps;
    let kSystemId = config.systemId;
    let knownUsers = {};

    I.token_expiry_ms = 5 * 60 * 1000; // 5 minutes.
    I.earliest_renew_time_ms = 0;

    I.get = async function (name, resid, query, headers) {
        switch (resid) {
            case '/time':
                let now = Date.now();
                let salt = random(10);
                let str = salt + '.' + now;
                let sig = hmac(knownApps[kSystemId].secret, str);
                return { status: 200, body: str + '.' + sig}; 
        }
        let pat = resid.match(/^[/]?user[/]([A-Za-z0-9]+)$/);
        if (pat) {
            let id = pat[1];
            if (knownUsers[id]) {
                return { status: 200, body: knownUsers[id] };
            }
        }
        return { status: 404, body: "Not found" };
    };
    
    I.put = async function (name, resid, query, headers, body) {
        if (/^[/]?_config[/]token_expiry_ms$/.test(resid)) {
            I.token_expiry_ms = +body;
            return { status: 200 };
        }
        if (/^[/]?_config[/]earliest_renew_time_ms$/.test(resid)) {
            I.earliest_renew_time_ms = +body;
            return { status: 200 };
        }
        return { status: 404, body: 'auth: No such config - ' + resid };
    };
    
    function unpackAuthToken(authorization) {
        let auth = authorization;
        if (!auth) { return null; }
        let pat = auth.match(/^Bearer[:] (.+)$/);
        if (!pat) { return null; }
        let token = pat[1];
        let parts = token.split('.');
        let branch = null;
        if (parts.length === 6) {
            branch = parts.shift();
        }
        let userid = null;
        if (parts.length === 5) {
            userid = parts.shift();
        }
        if (parts.length !== 4) { return null; }
        let appId = parts[0];
        if (!knownApps[appId]) { return null; }
        let salt = parts[1];
        let time = parts[2];
        let sig = parts[3];
        let context = (branch ? (branch + '.' + userid + '.') : (userid ? userid + '.' : ''));
        let calcSig = hmac(knownApps[kSystemId].secret, context + appId + '.' + salt + '.' + time);
        return {
            branch: branch,
            user: userid,
            app: appId,
            salt: salt,
            time: +time,
            sig: sig,
            calcSig: calcSig
        };
    }

    function validatedTokenInfo(info) {
        if (!info) { return null; }
        if (info.sig !== info.calcSig) { return null; }
        if (Date.now() >= info.time + I.token_expiry_ms) { return null; }
        return info;
    }

    I.post = async function (name, resid, query, headers, body) {
        switch (resid) {
            case '/check': {
                if (!headers) { break; }
                let tokenInfo = validatedTokenInfo(unpackAuthToken(headers.authorization));
                if (!tokenInfo) { break; }
                return { status: 200, body: knownApps[tokenInfo.app].perms };
            }
            case '/token': {
                if (!query || !query.app || !query.salt || !query.time || !query.sig) {
                    // User wants to renew a token. You can just POST to /token
                    // with the appropriate expired token in the authorization header
                    // as a "Bearer:" token and the service will send you a renewed
                    // token. You may ask "But doesn't this mean that all tokens are
                    // valid indefinitely?". The step of token renewal offers a chance
                    // for us to invalidate a token. Instead of storing tokens in a
                    // DB with an "invalid" flag against them to invalidate, we store
                    // a global "earliest_renew_time_ms" time stamp. Any token that was
                    // issued before this time stamp won't be renewable and the user will
                    // have to sign in again to get a new token. This means we can 
                    // in one go invalidate a whole bunch of tokens in case of some fraud
                    // from the backend without the intervention of a database.
                    let info = unpackAuthToken(headers.authorization);
                    if (!info || info.sig !== info.calcSig || info.time < I.earliest_renew_time_ms) {
                        return { status: 401, body: 'Bad token' };
                    }
                    let salt = newSalt();
                    let time = Date.now();
                    let prefix = (
                        (info.branch ? info.branch + '.' : '') +
                        (info.user ? info.user + '.' : '') +
                        (info.app ? info.app + '.' : '') +
                        salt + '.' +
                        time
                    );
                    let sig = hmac(knownApps[kSystemId].secret, prefix);
                    return {
                        status: 200,
                        body: {
                            branch: info.branch,
                            user: info.user,
                            app: info.app,
                            salt: salt,
                            time: time,
                            token: prefix + '.' + sig
                        }
                    };
                }
                if (!knownApps[query.app]) { break; }
                let now = Date.now();
                if (now >= query.time + I.token_expiry_ms) { return { status: 401, body: 'Expired' }; }
                let mysig = hmac(knownApps[kSystemId].secret, query.salt + '.' + query.time);
                let clisig = hmac(knownApps[query.app].secret, query.app + '.' + query.salt + '.' + query.time + '.' + mysig);
                if (query.sig !== clisig) { break; }
                let salt = random(10);
                let sigstr = query.app + '.' + salt + '.' + now;
                let sig = hmac(knownApps[kSystemId].secret, sigstr);
                return {
                    status: 200,
                    body: {
                        app: query.app,
                        salt: salt,
                        time: now,
                        token: sigstr + '.' + sig
                    }
                };
            }
            case '/app': {
                let check = await I.post(name, '/check', query, headers, null);
                if (check.status !== 200 || check.body.profile !== 'admin') {
                    return { status: 401, body: 'Unauthorized' };
                }

                // Make a new appid and secret, or obey the admin.
                let appId = body.appId || random(10);
                let appSecret = body.appSecret || random(20);
                let perms = body.perms || { profile: 'none' };

                // We trust the admin
                knownApps[appId] = {
                    secret: appSecret,
                    perms: perms
                };

                return {
                    status: 200,
                    body: {
                        appId: appId,
                        appSecret: appSecret,
                        perms: perms
                    }
                };
            }
            case '/user': {
                // Used to register user information associated with a token.
                // TODO: Currently uses an in-memory store. Needs to go to a database.
                let user = body.user;
                let token = body.token;
                let userid = hmac(knownApps[kSystemId].secret, JSON.stringify([user.iss, user.sub, user.email]));
                let info = validatedTokenInfo(unpackAuthToken(headers && headers.authorization));
                if (!info) {
                    return { status: 401, body: 'Unauthorized' };
                }
                let userTokenPrefix = [userid, info.app, newSalt(), Date.now()].join('.');
                let userTokenSig = hmac(knownApps[kSystemId].secret, userTokenPrefix);
                let userToken = userTokenPrefix + '.' + userTokenSig;
                knownUsers[userid] = {
                    id: userid,
                    user: user,
                    token: token,
                    userToken: userToken
                };
                return {
                    status: 200,
                    body: {
                        user: userid,
                        app: info.app,
                        token: userToken
                    }
                };
            }
            case '/branch': {
                let info = validatedTokenInfo(unpackAuthToken(headers && headers.authorization));
                if (!info || !info.user) { return { status: 401, body: 'Unauthorized' }; }
                let branch = newBranch(knownApps[kSystemId].secret, info.user);
                let tokenPrefix = [branch, info.user, info.app, newSalt(), Date.now()].join('.');
                let tokenSig = hmac(knownApps[kSystemId].secret, tokenPrefix);
                let token = tokenPrefix + '.' + tokenSig;
                return {
                    status: 200,
                    body: {
                        branch: branch,
                        user: info.user,
                        app: info.app,
                        token: token
                    }
                };
            }
        }

        return { status: 401, body: 'Unauthorized' };
    };

    I.boot = null;
    return { status: 200 };
};
