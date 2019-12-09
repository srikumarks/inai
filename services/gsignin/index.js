
const _doc = `
# Google signin service

This inserts the required code and elements into the DOM
using which the user will be able to authenticate to the
server using google signin.

One of the boot parameters MUST be \`client_id\`,
whose value will be used to tell google which application is
contacting it for authentication.

The job of the widget is sort of done once it is "booted".
`;


I.boot = async function (name, resid, query, headers, config) {
    // As per ref: https://developers.google.com/identity/sign-in/web/sign-in

    // Create the platform script element and insert it.
    I.dom('gsignin/platformScript', {
        op: 'set',
        tag: 'script',
        attrs: { src: 'https://apis.google.com/js/platform.js', async: true, defer: true },
        childOf: 'head'
    });

    // Insert info about the client id
    I.dom('gsignin/meta', {
        op: 'set',
        tag: 'meta',
        attrs: { name: 'google-signin-client_id', content: config.client_id },
        childOf: 'head'
    });

    // Insert button
    // <div class="g-signin2" data-onsuccess="onSignIn"></div>
    let signinFnName = 'inai3_gsignin_onSignin';
    I.dom('gsignin/btn', {
        op: 'set',
        tag: 'div',
        attrs: { "class": 'g-signin2', "data-onsuccess": signinFnName },
        childOf: I._self
    });

    window[signinFnName] = async function (guser) {
        let profile = guser.getBasicProfile();
        console.log('ID: ' + profile.getId()); // Do not send to your backend! Use an ID token instead.
        console.log('Name: ' + profile.getName());
        console.log('Image URL: ' + profile.getImageUrl());
        console.log('Email: ' + profile.getEmail()); // This is null if the 'email' scope is not present.

        // id_token must be used to validate login resid on the server.
        // https://developers.google.com/identity/sign-in/web/backend-auth
        let id_token = guser.getAuthResponse().id_token;
        console.log('id_token', id_token);
        let result = await I.network('server', 'post', '/gauth/token_signin', null, null, id_token);
        if (result.status === 200) {
            I.dom('body', {
                op: 'set',
                sel: 'body',
                attrs: { token: result.body.token }
            });
        }
    };

    I.post = async function (name, resid, query, headers, body) {
        if (resid === '/signout') {
            let auth2 = gapi.auth2.getAuthInstance();
            auth2.signOut().then(function () {
                console.log('User signed out.');
            });
        }
        return { status: 200 };
    };

    // Can boot only once.
    I.boot = null;
    return { status: 200, body: "Booted" };
};
