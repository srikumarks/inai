
const _doc = `
# HMAC request signer service

Based on the Amazon Web Services sample code.

Make a \'post\' request to \'/sign\` with a body like -

\`\`\`
{"service": "service_name", "request": {...request JSON to sign...}}
\`\`\`

- to get the fully signed request object as the result \`body.request\`.

The \`service_name\` must be one of the registered names in the
\`hmac\` service's \`config.credentials\` hash. The following
service names are available -

{{service_names}}

`;

let HmacSigner = require('./hmac_signer');

I.boot = async function (name, resid, query, headers, config) {

    const credentials = config.credentials;
    const servicesList = Object.keys(credentials).map(c => '- ' + c).join('\n');
    const docResponse = {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
        body: _doc.replace('{{service_names}}', servicesList)
    };
    
    I.post = function (name, resid, query, headers, body) {
        if (resid === '/sign') {
            if (body && (body.service in credentials) && body.request) {
                return { status: 200, body: { request: HmacSigner.sign(body.request, credentials[body.service]) } };
            }
            return { status: 400, body: 'Malformed request body' };
        }
        return { status: 404, body: 'Not found' };
    };

    I.get = function (name, resid, query, headers) {
        if (resid === '/_doc') { return docResponse; }

        return { status: 404, body: 'Not found' };
    };

    // Can boot only once.
    I.boot = null;

    return { status: 200, body: "Booted" };
};
