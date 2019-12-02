
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
    let selfElement = document.querySelector('[inai_id="' + I._self + '"]')

    // As per ref: https://developers.google.com/identity/sign-in/web/sign-in

    // Create the platform script element and insert it.
    let platformScript = document.createElement('script');
    platformScript.setAttribute('src', 'https://apis.google.com/js/platform.js');
    platformScript.setAttribute('async', true);
    platformScript.setAttribute('defer', true);
    document.head.appendChild(platformScript);

    // Insert info about the client id
    let meta = document.createElement('meta');
    meta.setAttribute('name', 'google-signin-client_id');
    meta.setAttribute('content', config.client_id);
    document.head.appendChild(meta);

    // Insert button
    // <div class="g-signin2" data-onsuccess="onSignIn"></div>
    let signinFnName = 'inai3_gsignin_onSignin';
    let btn = document.createElement('div');
    btn.setAttribute('class', 'g-signin2');
    btn.setAttribute('data-onsuccess', signinFnName);
    selfElement.appendChild(btn);

    window[signinFnName] = function (guser) {
        let profile = guser.getBasicProfile();
        console.log('ID: ' + profile.getId()); // Do not send to your backend! Use an ID token instead.
        console.log('Name: ' + profile.getName());
        console.log('Image URL: ' + profile.getImageUrl());
        console.log('Email: ' + profile.getEmail()); // This is null if the 'email' scope is not present.

        // id_token must be used to validate login on the server.
        // https://developers.google.com/identity/sign-in/web/backend-auth
        let id_token = guser.getAuthResponse().id_token;
        console.log('id_token', id_token);
        return I.network('server', 'post', '/gauth/token_signin', null, null, id_token);
    };

    // Add a signout button. Clicking will signout of the
    // app but not out of google.
    let signout = document.createElement('a');
    signout.setAttribute('href', '#');
    signout.onclick = function inai3_gsignin_signOut() {
        let auth2 = gapi.auth2.getAuthInstance();
        auth2.signOut().then(function () {
            console.log('User signed out.');
        });
    };
    selfElement.appendChild(signout);

    // Can boot only once.
    I.boot = null;
    return { status: 200, body: "Booted" };
};
