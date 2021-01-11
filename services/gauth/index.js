// WARNING: This is a publicly exposed service, so it has to be
// be security checked. Currently, the only request that it
// handles is a POST request that submits a google token which is
// validated on the server using the Google Auth SDK and makes
// no other actions. So it is safe (I think) to be marked public,
// and a necessity in order to provide user info registration
// within the system.
I.boot = async function (name, resid, query, headers, config) {
    const { OAuth2Client } = I.require("google-auth-library");
    const client = new OAuth2Client(config.client_id);
    let audience = config.audience || [config.client_id];
    async function verify(token) {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: audience,
        });
        return ticket.getPayload();
    }

    // POST /token_signin  with body as token string
    // will validate the token on the server side and
    // save the user in the `auth` service.
    I.post = async function (name, resid, query, headers, body) {
        if (resid === "/token_signin") {
            let token = body;
            let payload = await verify(token);

            // We conform to the JWT token spec
            // https://tools.ietf.org/html/rfc7519
            // so that the concepts required are familiar
            // to devs and translatable across services.
            let userProfile = {
                iss: payload.iss,
                sub: payload.sub,
                email: payload.email,
                name: payload.name,
                given_name: payload.given_name,
                family_name: payload.family_name,
                picture: payload.picture,
                locale: payload.locale,
                iat: +payload.iat,
            };

            // WARNING: Letting auth results leak to client?
            return await I.network("auth", "post", "/users", null, headers, {
                user: userProfile,
                token: token,
            });
        }

        return { status: 404, body: "Not found" };
    };

    return { status: 200 };
};
