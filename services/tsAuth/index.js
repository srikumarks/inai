
const _doc = `
# ThumbSignIn backend service

This [ThumbSignIn backend](https://thumbsignin.com) service is pretty
quiescient. It receives callbacks on end points such as \`/tsAuth/register\`
and \`/tsAuth/authenticate\` and translates them for the \`auth\` service.
`;

I.boot = async function (name, resid, query, headers, config) {
    // As per ref: https://app.thumbsignin.com/app/web

    let https = I.require('https');
    let crypto = I.require('crypto');
    
    const tsCredentials = {
        accessKeyId: config.accessKeyId,
        secretKey: config.secretKey,
    };

    const tsAPI = config.tsAPI;

    const redirectURL = config.redirectURL;

    I.get = async function (name, resid, query, headers) {
        if (resid === '/_doc') {
            return {
                status: 200,
                headers: { 'content-type': 'text/markdown' },
                body: _doc
            };
        }

        return { status: 404 };
    };

    I.post = async function (name, resid, query, headers, body) {
        
        if (resid === '/authenticate') {
            let request = {
                method: 'get',
                headers: {},
                url: tsAPI + '/authenticate'
            };

            let response = await I.network('hmac', 'post', '/sign', null, null, {
                service: 'thumbsignin',
                request: request
            });

            if (response.status !== 200) {
                return { status: 500, body: 'Failed to get TSI transaction ID' };
            }

            request = response.body.signedRequest;

            let json = await getJson(request);

            return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.parse(json) };
        }

        let pat = resid.match(/^[/]?txnStatus[/]([^/]+)/);
        if (pat) {
            let txnId = pat[1];
            let cancelled = (query && query.cancelled && true);

            let request = {
                method: 'get',
                headers: {},
                url: tsAPI + '/txn-status/' + txnId + (cancelled ? '?cancelled=true' : '')
            };

            let response = await I.network('hmac', 'post', '/sign', null, null, {
                service: 'thumbsignin',
                request: request
            });
            if (response.status !== 200) {
                return { status: 500, body: 'Could not sign ThumbSignIn request.' };
            }

            request = response.body.signedRequest;

            let json = JSON.parse(await getJson(request));

            if (json.status === 'COMPLETED_SUCCESSFUL') {
                // We conform to the JWT token spec
                // https://tools.ietf.org/html/rfc7519
                // so that the concepts required are familiar
                // to devs and translatable across services.
                let userProfile = {
                    iss: 'thumbsignin.com',
                    sub: 'auth',
                    email: json.userId,
                    name: '',
                    given_name: '',
                    family_name: '',
                    picture: null,
                    locale: null,
                    iat: Date.now()
                };

                // Make a token for this user login attempt since it succeeded.                
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

                let response = await I.network('auth', 'post', '/users', null, headers, { user: userProfile, token: token });
                if (response.status !== 200) {
                    return { status: 500, body: 'Failed to auth' };
                }

                json.token = response.body.token;
                json.redirectUrl = redirectURL; 

                let headers = {
                    'content-type': 'application/json',
                    'set-cookie': response.headers['set-cookie']
                };

                return { status: 200, headers: headers, body: json };
            }

            return { status: 500, body: json.status };
        }

        return { status: 200, body: 'Ok' };
    };


    function getJson(request) {
        return new Promise((resolve, reject) => {
            let req = https.request(request.url, request,
                (res) => {
                    let json = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => { json += chunk; });
                    res.on('end', () => { resolve(json); });
                }
            );
            req.on('error', reject);
            req.end();
        });
    }

    // Can boot only once.
    I.boot = null;
    return { status: 200, body: "Booted" };
};
