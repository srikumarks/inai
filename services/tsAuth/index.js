const _doc = `
# ThumbSignIn backend service

This [ThumbSignIn backend](https://thumbsignin.com) service is pretty
quiescient. It receives callbacks on end points such as \`/tsAuth/register\`
and \`/tsAuth/authenticate\` and translates them for the \`auth\` service.
`;

I.boot = async function (name, resid, query, headers, config) {
    // As per ref: https://app.thumbsignin.com/app/web

    let https = I.require("https");
    let crypto = I.require("crypto");

    const tsCredentials = {
        accessKeyId: config.accessKeyId,
        secretKey: config.secretKey,
    };

    const tsAPI = config.tsAPI;
    const redirectURL = config.redirectURL;
    const tsAppId = config.tsAppId;
    const tsAppSecret = config.tsAppSecret;

    I.get = async function (name, resid, query, headers) {
        if (resid === "/_doc") {
            return {
                status: 200,
                headers: { "content-type": "text/markdown" },
                body: _doc,
            };
        }

        if (resid === "/authenticate" || resid === "/register") {
            let userId = null;
            let authResult = await I.network(
                "auth",
                "post",
                "/check",
                null,
                headers
            );
            if (authResult.status === 200) {
                userId = authResult.body.user;
            } else if (resid === "/register") {
                // User must be signed in already.
                return {
                    status: 503,
                    body: "User needs to be signed in to register for TSI.",
                };
            }

            let request = {
                method: "get",
                headers: {},
                url: tsAPI + resid + (userId ? "?userId=" + userId : ""),
            };

            let response = await I.network(
                "hmac",
                "post",
                "/sign",
                null,
                null,
                {
                    service: "thumbsignin",
                    request: request,
                }
            );

            if (response.status !== 200) {
                return {
                    status: 500,
                    body: "Failed to get TSI transaction ID",
                };
            }

            request = response.body.signedRequest;
            let json = await getJson(request);

            return {
                status: 200,
                headers: { "content-type": "application/json" },
                body: JSON.parse(json),
            };
        }

        let pat = resid.match(/^[/]?txnStatus[/]([^/]+)/);
        if (pat) {
            let txnId = pat[1];
            let cancelled = query && query.cancelled && true;

            let request = {
                method: "get",
                headers: {},
                url:
                    tsAPI +
                    "/txn-status/" +
                    txnId +
                    (cancelled ? "?cancelled=true" : ""),
            };

            let response = await I.network(
                "hmac",
                "post",
                "/sign",
                null,
                null,
                {
                    service: "thumbsignin",
                    request: request,
                }
            );
            if (response.status !== 200) {
                return {
                    status: 500,
                    body: "Could not sign ThumbSignIn request.",
                };
            }

            request = response.body.signedRequest;

            let json = JSON.parse(await getJson(request));
            console.log("TSI logged in " + JSON.stringify(json, null, 4));

            if (json.status === "COMPLETED_SUCCESSFUL") {
                // We conform to the JWT token spec
                // https://tools.ietf.org/html/rfc7519
                // so that the concepts required are familiar
                // to devs and translatable across services.
                let userProfile = {
                    iss: "thumbsignin.com",
                    sub: "auth",
                    email: json.userId,
                    name: "",
                    given_name: "",
                    family_name: "",
                    picture: null,
                    locale: null,
                    iat: Date.now(),
                };

                // Make a token for this user login attempt since it succeeded.
                let time = (await I.network("auth", "get", "/time", null, null))
                    .body;
                let parts = time.split(".");
                let str = tsAppId + "." + time;
                let h = crypto.createHmac("sha1", tsAppSecret);
                h.update(str);
                let sig = h.digest("hex");
                let tokenReply = await I.network(
                    "auth",
                    "post",
                    "/token",
                    {
                        app: tsAppId,
                        salt: parts[0],
                        time: parts[1],
                        sig: sig,
                    },
                    headers,
                    null
                );
                let token = tokenReply.body.token;

                let response = await I.network(
                    "auth",
                    "post",
                    "/users",
                    null,
                    tokenReply.headers,
                    { user: userProfile, token: token }
                );
                if (response.status !== 200) {
                    return { status: 500, body: "Failed to auth" };
                }

                json.token = response.body.token;
                json.redirectUrl = redirectURL;

                let outHeaders = {
                    "content-type": "application/json",
                    "set-cookie": response.headers["set-cookie"],
                };

                return { status: 200, headers: outHeaders, body: json };
            } else {
                return { status: 200, body: json };
            }

            return { status: 500, body: json.status };
        }

        return { status: 200, body: "Ok" };
    };

    function getJson(request) {
        return new Promise((resolve, reject) => {
            let req = https.request(request.url, request, (res) => {
                let json = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => {
                    json += chunk;
                });
                res.on("end", () => {
                    resolve(json);
                });
            });
            req.on("error", reject);
            req.end();
        });
    }

    // Can boot only once.
    I.boot = null;
    return { status: 200, body: "Booted" };
};
