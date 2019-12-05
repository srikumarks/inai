
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
        return { status: 404, body: 'No such config' };
    };
    
    I.post = async function (name, resid, query, headers, body) {
        switch (resid) {
            case '/check': {
                if (!headers) { break; }
                let auth = headers.authorization;
                if (!auth) { break; }
                let pat = auth.match(/^Bearer[:] (.+)$/);
                if (!pat) { break; }
                let token = pat[1];
                let parts = token.split('.');
                if (parts.length !== 4) { break; }
                let appId = parts[0];
                if (!knownApps[appId]) { break; }
                let salt = parts[1];
                let time = parts[2];
                let sig = parts[3];
                let calcsig = hmac(knownApps[kSystemId].secret, appId + '.' + salt + '.' + time);
                if (sig !== calcsig) { break; }
                if (Date.now() >= time + I.token_expiry_ms) {
                    return { status: 401, body: 'Expired' };
                }
                return { status: 200, body: knownApps[appId].perms };
            }
            case '/token': {
                if (!query || !query.app || !query.salt || !query.time || !query.sig) {
                    return { status: 400, body: 'Bad request' };
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
                return { status: 200, body: sigstr + '.' + sig };
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
                    status: 200, body: {
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
                let id = hmac(knownApps[kSystemId].secret, JSON.stringify([user.iss, user.sub, user.email]));
                knownUsers[id] = {
                    id: id,
                    user: user,
                    token: token
                };
                return { status: 200, body: { id: id } };
            }
        }

        return { status: 401, body: 'Unauthorized' };
    };

    I.boot = null;
    return { status: 200 };
};
