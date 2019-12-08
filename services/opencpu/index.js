
/**
 * This service provides a gateway to an OpenCPU server,
 * whose server prefix URL is given in config.server.
 * For example, http://localhost:5656/ocpu/library/
 * 
 * This services permits invoking R functions using a
 * two-part resid structured as "/package/rfunc" where
 * "package" is the name of the package and "rfunc" is
 * the name of the function you're interested in. To
 * supply named arguments to the function, send a JSON
 * body. The result of the function will be returned
 * to you in JSON form.
 * 
 * The requests are made using 'post' verb. Note that
 * the JSON marshalling may add some overhead to the
 * R script call.
 * 
 * UNTESTED
 */
I.boot = async function (name, resid, query, headers, config) {

    let http = /^https:/.test(config.server) ? I.require('https') : I.require('http');
    let urlPrefix = config.server.match(/^http[s]?:[/][/](.+)$/)[1];

    I.post = async function (name, resid, query, headers, body) {
        let pat = resid.match(/^[/]?([^/]+)[/]([^/]+)$/);
        if (!pat) { return { status: 404, body: 'Not found' }; }

        let package = pat[1];
        let rfunc = pat[2];

        let json = await new Promise((resolve, reject) => {
            let req = http.request(urlPrefix + package + '/R/' + rfunc + '/json',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                },
                (res) => {
                    let json = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => { json += chunk; });
                    res.on('end', () => { resolve(json); });
                }
            );
            req.on('error', reject);
            req.write(JSON.stringify(body));
            req.end();
        });

        return { status: 200, body: JSON.parse(json) };
    };

    I.boot = null;
    return { status: 200 };
};