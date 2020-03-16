
const _doc = `
# ThumbSignIn service

This inserts the required code and elements into the DOM using which the user
will be able to authenticate to the server using [ThumbSignin][TSI] service.

A good amount of the setup work is completed once the widget is "booted".
So all you need to get this setup going is to identify the widget container
element, give it an \`id\` attribute that uniquely identifies it and an 
\`inai\` attribute that has \`thumbsignin\` as its value, indicating that this
widget will be managed by the \`thumbsignin\` client-side service.

TSI will then set things up so that you can then use the \`id\` you've given 
to the widget and make requests to it. One of the things you may want to
do is to add button at an appropriate place on the page which you setup to
post a click event to \`/<tsi-widget-id>/login\` like this -

\`\`\`
<button inai-target="/<tsi-widget-id>/login">
    Login with ThumbSignIn
</button>
\`\`\`

Same goes if you want a "register with ThumbSignIn" button, which you direct
it to \`/<tsi-widget-id>/register\` instead.

Inai will wire up such buttons with the appropriate event handlers.

[TSI]: https://thumbsignin.com
`;

function sleep(ms) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, ms, true);
    });
}

async function ensure(test, poll_ms) {
    while (!test()) {
        await sleep(poll_ms || 100);
    }
    return true;
}

debugger;

I.boot = async function bootFn(name, resid, query, headers, config) {
    // As per ref: https://app.thumbsignin.com/app/web
    debugger;

    let element = document.querySelector('[inai-id="' + I._self + '"]');
    if (!element) {
        console.error("Unattached thumbsignin!");
        return { status: 500, body: 'Invalid thumbsignin boot' };
    }

    // Create the platform script element and insert it.
    I.dom('thumbsignin/platformScript', {
        op: 'set',
        tag: 'script',
        once: true,
        attrs: { src: 'https://thumbsignin.com/thumbsign_widget.js' },
        childOf: 'head'
    });

    await ensure(() => window.thumbSignIn);

    if (!config.LOGIN_CONFIG) {
        return { status: 500, body: 'No LOGIN_CONFIG' };
    }

    window.thumbSignIn.addConfig('REGISTER_CONFIG', config.REGISTER_CONFIG);
    window.thumbSignIn.addConfig('LOGIN_CONFIG', config.LOGIN_CONFIG);

    debugger;
    
    await Promise.all([
        window.thumbSignIn.init({
            id: 'tsRegister',
            config: 'REGISTER_CONFIG',
            container: element.getAttribute('id')
        }),

        window.thumbSignIn.init({
            id: 'tsLogin',
            config: 'LOGIN_CONFIG',
            container: element.getAttribute('id')
        })
    ]);

    const docResponse = {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
        body: _doc
    };

    I.get = async function (name, resid, query, headers) {
        if (resid === '/_doc') { return docResponse; }

        return { status: 404 };
    };

    I.post = async function (name, resid, query, headers, body) {
        debugger;
        if (resid === '/register') {
            debugger;
            window.tsRegister.open();
            return { status: 200, body: 'TSI register window is now open' };
        }

        if (resid === '/login') {
            debugger;
            window.tsLogin.open();
            return { status: 200, body: 'TSI login window is now open' };
        }

        return { status: 200, body: 'Ok' };
    };

    I.shutdown = async function (name, resid, query, headers) {
        if (window.tsRegister) {
            window.tsRegister.close();
        }

        if (window.tsLogin) {
            window.tsLogin.close();
        }

        I.boot = bootFn;
        I.get = null;
        I.post = null;
        I.shutdown = null;
        return { status: 200 };
    };

    // Can boot only once.
    I.boot = null;
    return { status: 200, body: "Booted" };
};
