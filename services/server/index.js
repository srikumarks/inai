/**
 * This is a service that is expected to be run on the client side that
 * is to be used as a gateway to talk to the server from which the 
 * client originated. The service is simply named `server` so that client
 * side code can talk to the "server" via `I.network('server', ...)`.
 * 
 * Status: UNTESTED
 */

 I.route = async function (name, verb, resid, query, headers, body) {
    if (verb === 'boot') {
        let location = document.location;
        let providerBaseURL = location.origin + location.pathname; // Includes the service that exposes the client.

        // Strip off trailing '/'
        if (/[/]$/.test(providerBaseURL)) {
            providerBaseURL = providerBaseURL.substring(0, providerBaseURL.length - 1);
        }

        I.route = async function (name, verb, resid, query, headers, body) {
            let parts = resid.match(/^[/]?([^/]+)(.*)$/);
            if (!parts) { return { status: 404, body: 'Not found' }; }
            let service = parts[1];
            let serviceResId = parts[2];
            let auth = 'Bearer: ' + document.body.getAttribute('token');
            let response = await fetch(providerBaseURL + '/_proxy', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': auth
                },
                body: JSON.stringify({
                    name: service,
                    verb: verb,
                    resid: serviceResId,
                    query: query,
                    headers: headers,
                    body: body
                })
            });

            let result = await response.json();
            if (result.status >= 200 && result.status < 300 && result.token) {
                document.body.setAttribute('token', result.token);
            }
            return result;
        };

        return { status: 200 };
    }

    return { status: 400, body: 'Gateway not booted yet' };
 };
