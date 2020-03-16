/**
 * This is a stupid app for test/demo purposes. It loads a template,
 * fills the token field and serves it up.
 */
let fs = I.require('fs');


let crypto = I.require('crypto');

I.boot = async function (name, resid, query, headers, config) {

    let appId = config.id;
    let appSecret = config.secret;

    I.get = async function (name, resid, query, headers) {
        let time = (await I.network('auth', 'get', '/time', null, null)).body;
        let parts = time.split(".");
        let str = appId + '.' + time;
        let h = crypto.createHmac('sha1', appSecret);
        h.update(str);
        let sig = h.digest('hex');
        let tokenResult = await I.network('auth', 'post', '/token', {
            app: appId,
            salt: parts[0],
            time: parts[1],
            sig: sig
        }, null, null);
        let token = tokenResult.body.token;


        // Get the asset ID - which will be a hash of the asset object.
        // That way, multiple applications can share the same asset object.
        let assetId = (await I.network('_codebase', 'get', '/named/app/assets/template.html', null, null)).body;
        let template = (await I.network('_codebase', 'get', '/assets/' + assetId, null, null)).body;
        let html = template.replace(/{{token}}/g, token);
        let outHeaders = {
            'content-type': 'text/html'
        };
        if (tokenResult.headers && tokenResult.headers['set-cookie']) {
            outHeaders['set-cookie'] = tokenResult.headers['set-cookie'];
        }
        return { status: 200, headers: outHeaders, body: html };
    };
    return { status: 200, body: "Booted" };
};
