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
        let token = (await I.network('auth', 'post', '/token', {
            app: appId,
            salt: parts[0],
            time: parts[1],
            sig: sig
        }, null, null)).body.token;


        // Get the asset ID - which will be a hash of the asset object.
        // That way, multiple applications can share the same asset object.
        let assetId = (await I.network('_codebase', 'get', '/named/app/assets/template.html', null, null)).body;
        let template = (await I.network('_codebase', 'get', '/assets/' + assetId, null, null)).body;
        let html = template.replace(/{{token}}/g, token);
        return {
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: html
        }
    };
    return { status: 200, body: "Booted" };
};
