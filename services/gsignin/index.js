const _doc = `
# Google signin service

This inserts the required code and elements into the DOM
using which the user will be able to authenticate to the
server using google signin.

One of the boot parameters MUST be \`client_id\`,
whose value will be used to tell google which application is
contacting it for authentication.

The job of the widget is sort of done once it is "booted".

To specify a target service to notify upon various events,
give a meta tag in the following format in the "head" section
of the document -

\`\`\`
<meta name="inai-gsignin-target" content="//SERVICE/RES">
\`\`\`

The following events will then get posted to that end point -

1. query = { event: 'signinChanged' } , body = { state: val }
2. query = { event: 'signin' }, body = { user: {id,email,name,imageUrl,id_token} }
3. query = { event: 'signout' }, body = null

Furthermore, you can query the status user details from the gsignin
service on the client side when you need. 

The following 'get' requests are supported -

1. \`/status\` => Yields a 503 error if the service is unavailable, or status
   200 and a body with either 'signedin' or 'signedout'.

2. \`/user\` => If not signed in, this gives a 404. Otherwise it produces 
   \`{name, imageUrl, email}\` properties as the body.

3. \`/user/(name|imageUrl|email)\` => Use to get the specific field only in the
   body.  Produces a 404 if the user info is not available.

`;

I.boot = async function (name, resid, query, headers, config) {
    // As per ref: https://developers.google.com/identity/sign-in/web/sign-in

    // Insert info about the client id
    I.dom("gsignin/meta", {
        op: "set",
        tag: "meta",
        once: true,
        attrs: { name: "google-signin-client_id", content: config.client_id },
        childOf: "head",
    });

    // Create the platform script element and insert it.
    I.dom("gsignin/platformScript", {
        tag: "script",
        once: true,
        attrs: {
            src: "https://apis.google.com/js/platform.js",
            async: true,
            defer: true,
        },
        childOf: "head",
    });

    // Bind to a specified button. The class name is the indicator
    // that it is the google-signin button.
    // <div class="g-signin2" data-onsuccess="onSignIn"></div>
    let signinFnName = "inai3_gsignin_onSignin";
    I.dom("gsignin/btn", {
        sel: ".g-signin2",
        attrs: { "data-onsuccess": signinFnName },
    });

    let appStart = function appStart() {
        // Wait till the gapi is loaded ... if necessary.
        if (!window.gapi) {
            setTimeout(appStart, 50);
            return;
        }

        // Once gapi is available, we wait for auth2 to be available
        // to complete further initialization.
        window.gapi.load("auth2", initSigninV2);
    };

    let auth2 = null;
    let googleUser = null;

    let initSigninV2 = function () {
        // There may be a button already poised to do an init.
        // So check for whether the auth instance is available
        // first before performing an init.
        auth2 = window.gapi.auth2.getAuthInstance();
        if (!auth2) {
            auth2 = window.gapi.auth2.init({
                client_id: config.client_id,

                // Use the default scope. This scope MUST be the
                // same when using a button or when working with
                // a page that's already signed in.
                scope: "email profile openid",
            });
        }

        // Listen for sign-in state changes.
        auth2.isSignedIn.listen(signinChanged);

        // Listen for changes to current user.
        auth2.currentUser.listen(userChanged);

        // Sign in the user if they are currently signed in.
        if (auth2.isSignedIn.get() == true) {
            auth2.signIn();
        }

        // Start with the current live values.
        refreshValues();
    };

    let signinChanged = function (val) {
        let target = getTarget();
        if (!target) {
            return;
        }

        return I.network(
            target.service,
            "post",
            target.res,
            { event: "signinChanged" },
            null,
            { state: val }
        );
    };

    // The "target" is given as a meta tag with name="inai-gsignin-target"
    // and the URL as the target. The URL is expected to be in the format
    // "//service/res" ... where the leading slashes may be omitted.
    let getTarget = function () {
        let meta = document.head.querySelector(
            'meta[name="inai-gsignin-target"]'
        );
        if (!meta) {
            return;
        }

        let target = meta.getAttribute("content");
        if (!target) {
            return;
        }

        let pat = target.match(/^[/]?[/]?([^/]+)(.*)$/);
        if (pat) {
            return { service: pat[1], res: pat[2] };
        }
    };

    let profileAsObject = function (user) {
        let profile = user.getBasicProfile();
        if (!profile) {
            return;
        }
        return {
            id: profile.getId(),
            name: profile.getName(),
            imageUrl: profile.getImageUrl(),
            email: profile.getEmail(),
            id_token: user.getAuthResponse().id_token,
        };
    };

    let refreshValues = async function () {
        if (auth2) {
            console.log("Refreshing values...");

            googleUser = auth2.currentUser.get();
            if (!googleUser) {
                return;
            }

            let target = getTarget();
            if (target) {
                let userInfo = profileAsObject(googleUser);
                if (userInfo) {
                    await I.network(
                        target.service,
                        "post",
                        target.res,
                        { event: "signin" },
                        null,
                        { user: userInfo }
                    );
                }
            }
        }
    };

    let userChanged = async function userChanged(guser) {
        let userInfo = profileAsObject(guser);
        if (!userInfo) {
            return { status: 500 };
        }

        console.log("ID: " + userInfo.id); // Do not send to your backend! Use an ID token instead.
        console.log("Name: " + userInfo.name);
        console.log("Image URL: " + userInfo.imageUrl);
        console.log("Email: " + userInfo.email); // This is null if the 'email' scope is not present.

        // id_token must be used to validate login resid on the server.
        // https://developers.google.com/identity/sign-in/web/backend-auth
        if (userInfo.id_token) {
            console.log("id_token", userInfo.id_token);
            let result = await I.network(
                "server",
                "post",
                "/gauth/token_signin",
                null,
                null,
                userInfo.id_token
            );
            if (result.status === 200) {
                I.dom("body", {
                    op: "set",
                    sel: "body",
                    attrs: { token: result.body.token },
                });

                let target = getTarget();
                if (!target) {
                    return { status: 200 };
                }

                return I.network(
                    target.service,
                    "post",
                    target.res,
                    { event: "signin" },
                    null,
                    { user: userInfo }
                );
            }
        }
    };

    window[signinFnName] = userChanged;

    I.post = async function (name, resid, query, headers, body) {
        if (resid === "/signout") {
            let auth2 = window.gapi.auth2.getAuthInstance();

            auth2.signOut().then(function () {
                console.log("User signed out.");

                let target = getTarget();
                if (!target) {
                    return;
                }

                return I.network(
                    target.service,
                    "post",
                    target.res,
                    { event: "signout" },
                    null,
                    null
                );
            });

            return { status: 200 };
        }

        return { status: 200 };
    };

    I.get = function (name, resid, query, headers) {
        if (resid === "/status") {
            if (!window.gapi || !window.gapi.auth2) {
                return { status: 503, body: "Service unavailable" };
            }
            let auth2 = window.gapi.auth2.getAuthInstance();
            if (!auth2) {
                return { status: 503, body: "Service unavailable" };
            }
            if (auth2.isSignedIn.get()) {
                return { status: 200, body: "signedin" };
            }
            return { status: 200, body: "signedout" };
        }

        if (!googleUser) {
            return { status: 404, body: "No user info" };
        }
        let profile = googleUser.getBasicProfile();
        switch (resid) {
            case "/user":
            case "/user/":
                return {
                    status: 200,
                    body: {
                        name: profile.getName(),
                        imageUrl: profile.getImageUrl(),
                        email: profile.getEmail(),
                    },
                };
            case "/user/name":
                return { status: 200, body: profile.getName() };
            case "/user/imageurl":
            case "/user/imageUrl":
                return { status: 200, body: profile.getImageUrl() };
            case "/user/email":
                return { status: 200, body: profile.getEmail() };
            default:
                return { status: 404, body: "Unknown resource" };
        }
    };

    // Can boot only once.
    I.boot = null;
    appStart();
    return { status: 200, body: "Booted" };
};
