
const network = require('./network');

let uniqueID = (function (prev) {
    return function () {
        return 'e' + (prev++);
    };
})(1);

const I = network.createNode({
    log: {requests: true, responses: true}
});

I.dom = function (resid, body) {
    return I.network('dom', 'post', resid, null, null, body);
};

const token = document.body.getAttribute("token");
const stdHeaders = new Headers();
stdHeaders.append('Content-Type', 'application/json');
stdHeaders.append('Authorization', 'Bearer: ' + token);
const providerURLBase =  (function () {
    let base = document.location.origin + document.location.pathname;
    let parts = base.match(/^(.+)[/][^/]+$/);
    if (parts) {
        return parts[1];
    }
    return base;
}());

async function boot() {
    let codeCache = {};

    // Start the main gateway service and the dom service by default.
    let headlessServices = ['dom', 'server'];
    if (document.body.hasAttribute('inai-boot')) {
        // Treat the 'inai-boot' attribute on the body element as
        // indicating space separated names of services to start.
        headlessServices.push.apply(headlessServices, document.body.getAttribute('inai-boot').trim().split(/\s+/));
    }

    // We protect against repeat specifications of services since the
    // app developer may not know what we start by default.
    let bootedHeadlessServices = new Set();
    for (let hs of headlessServices) {
        if (!bootedHeadlessServices.has(hs)) {
            bootedHeadlessServices.add(hs);
            console.log("Booting " + hs);
            await setupService(hs, uniqueID(), hs, codeCache);
        }
    }

    setupDOMObserver(codeCache);

    /**
     * The body will have elements with "inai" attributes that specify the codeId
     * of services that must manage this element's display. At the moment I'm
     * thinking that only one instance should be adequate to manage multiple
     * elements mapped to the same codeId. The codeId, in other words, determines
     * some kind of "type" of the element and the service (if relevant) should be
     * able to handle a colleection of these.
     */
    let elements = document.querySelectorAll('[inai]');

    // Bind anything with a declared 'inai-target'. Currently supports buttons.
    // NOTE: This is a stop-gap cheap arrangement to do some tests.
    // Basically, an element with an inai-target URL will direct
    // events generated according to the comma-sep list in inai-events
    // attribute via post messages. To top it all, the body is the event
    // object itself, which breaks the REST pattern.
    let controls = document.querySelectorAll('[inai-target]');
   
    // Mark controls as disabled initially until the required code
    // completes loading and the services are started.
    for (let control of controls) {
        let inai_disabled = control.getAttribute('disabled');
        control.inai_disabled = inai_disabled;
        control.setAttribute('disabled', '');
    }

    await Promise.all(Array.from(elements).map((element) => {
        return setupElementService(element, codeCache);
    }));

    // Activate controls.
    for (let control of controls) {
        setupControl(control);
    }

    window.I = I;
}

function setupDOMObserver(codeCache) {
    let observer = new MutationObserver(function (mutations) {
        for (let mutation of mutations) {
            if (mutation.type === 'childList') {
                for (let n of mutation.removedNodes) {
                    teardownElement(n);
                }
                for (let n of mutation.addedNodes) {
                    setupControl(n);
                    setupElementService(n, codeCache);
                }
            }
        }
    });

    // Watch for changes to DOM nodes so we can
    // load Inai code / instantiate services when
    // needed and bind elements to services too.
    observer.observe(document.querySelector('body'), { childList: true, subtree: true });
}

// Config arguments to boot services can be provided by either specifying
// URIComponent encoded JSON value in the `inai-args` attribute of the element
// being managed by the service, or via a <script> element with an attribute
// `inai-args-for` which specifies the name of the service that the script's
// body text provides the JSON args for. The `type` attribute of the script
// element must be set to `application/json`.
function serviceArgs(inai_name) {
    let inai_args = null;
    try {
        let argsScript = document.querySelector('script[inai-args-for="' + inai_name + '"]');
        if (argsScript) {
            inai_args = JSON.parse(argsScript.text);
        } else if (element.hasAttribute('inai-args')) {
            inai_args = JSON.parse(decodeURIComponent(element.getAttribute('inai-args')));
        }
    } catch (e) { }
    return inai_args;
}

function setupElementService(element, codeCache) {
    if (!(element instanceof Element) || !element.hasAttribute('inai')) { return; }
    let codeId = element.getAttribute('inai');
    let inai_name = element.hasAttribute('id') ? element.getAttribute('id') : null;
    let inai_id = uniqueID();
    element.setAttribute('inai-id', inai_id);
    return setupService(inai_name, inai_id, codeId, codeCache);
}

async function setupService(inai_name, inai_id, codeId, codeCache) {
    let inai_args = serviceArgs(inai_name);
    let codeP = codeCache[codeId];
    if (!codeP) {
        // The code cache stores promises to load the code.
        // That way, we can ensure that we don't load code
        // multiple times. Returns the config structure.
        codeCache[codeId] = codeP = (async () => {
            // Load the code.
            let response = await fetch(providerURLBase + '/_codebase/' + codeId, {
                method: 'GET',
                headers: stdHeaders
            });
            if (response.status !== 200) {
                console.error("Couldn't load code [" + codeId + "]")
                return null;
            }

            let code = await response.text();
            let given_args = response.headers.get('inai-args');

            // Compile the code.
            await I.network('_services', 'put', codeId, null, null, code);
            if (given_args) {
                return {config: JSON.parse(decodeURIComponent(given_args))};
            }

            return {config: null};
        })();
    }
    if (!(await codeP)) {
        return false;
    }

    let merged_args = {};
    let {config} = (await codeP); // Should complete immediately since we already awaited for it.

    // The "default" values of config are provided centrally.
    if (config) {
        for (let k in config) {
            merged_args[k] = config[k];
        }
    }

    // Local inai-args values override centrally provided configuration.
    if (inai_args) {
        for (let k in inai_args) {
            merged_args[k] = inai_args[k];
        }
    }
    
    let result = await I.network('_services', 'post', codeId + '/instances', { id: inai_id }, null, merged_args);
    if (result.status !== 200) { 
        console.error("Couldn't launch instance " + inai_id + " (" + JSON.stringify(result) + ")");
        return false;
    }
    let serviceId = result.body;
    console.assert(serviceId == inai_id);
    // If the element has been named using the id, make it
    // available via the DNS.
    if (inai_name) {
        await I.network('_dns', 'put', inai_name, null, null, serviceId);
    }
    return true;
}

function setupControl(control) {
    if (!(control instanceof Element) || !control.hasAttribute('inai-target')) {
        return;
    }
    let events = null;
    let tagName = control.tagName.toLowerCase();
    if (control.hasAttribute('inai-events')) {
        // Support both comma and white space as separators for maximum flexibility.
        events = control.getAttribute('inai-events').trim().split(/[,\s]+/);
    } else if (tagName === 'button') {
        // If the thing is a button, then even if inai-events
        // is not specified, we can assume that the intention is
        // to send click events to the given target.
        events = ['click'];
    } else if (/input|select|textarea/.test(tagName)) {
        events = ['change'];
    }
    if (!events) {
        console.error("Target mentioned for " + tagName + " but no events.")
        return;
    }
 
    let listener = function (ev) {
        // WARNING: This could be made more efficient by caching the
        // processed target and recomputing only on demand. Usually though,
        // this is sufficient.
        let target = control.getAttribute('inai-target');
        let pat = target.match(/^[/]?([^/]+)(.*)$/);
        let service = pat[1];
        let resid = pat[2];

        // post_sync handlers should be ordinary functions that return a promise.
        // This permits us to use this mechanism to take actions that are supposed
        // to occur inside an event handler. If we break away into async mode, that
        // won't hold. For example, if we need to create an AudioContext in response
        // to an event, we need to do it in a sync handler. Under normal conditions,
        // a service should implement async handlers only by default.
        let verb = control.hasAttribute('inai-sync') ? 'post_sync' : 'post';
        I.network(service, verb, resid, { event: ev.type }, null, ev);
    };
    control.inai_listener = listener;
    control.inai_events = events;

    for (let e of events) {
        control.addEventListener(e, listener);
    }

    control.removeAttribute('disabled');
}

async function teardownElement(element) {
    if (!(element instanceof Element)) { return; }
    if (element.hasAttribute('inai')) {
        await I.network(element.getAttribute('inai-id'), 'shutdown', '/', null, null, null);
    }

    if (element.inai_listener) {
        for (let e of element.inai_events) {
            element.removeEventListener(e, element.inai_listener);
        }
    }
}

window.addEventListener('load', boot);