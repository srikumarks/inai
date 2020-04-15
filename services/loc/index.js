
const _docstr = `
# Location service 

A tiny facade for the [navigator.geolocation][geo] API.

You can query the current location by making a \`get\`
request to \`//{{ref}}/geolocation\`. The first time the request is made,
the service will initiate access to the geolocation API
which might prompt the user to give the necessary permission.
It'll then return the current location passed.

The arguments and returned structures conform to the
[Web GeoLocation API][geo].

[geo]: (https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API).

The query parameters that can be passed include -

- \`maximumAge\`: milliseconds giving how old the data can be.
- \`timeout\`: milliseconds giving how long the caller is willing to wait.
- \`enableHighAccuracy\`: true|false


If you want to watch the location, you can post a query to \`/geolocation\`
with the body given as \`{ "target": "//service/resid" }\` which results in the
target being posted with the position information whenever the watch fires. You
may optionally pass \`query\` and \`headers\` fields also, which will be passed
along to the target. In this case, the POST returns an \`ref\` field in the
body which gives the resource reference to use to cancel the watch by sending a
\`delete\` request.

Errors can be -

- 404 Not Found - if the service isn't available at all.
- 401 Unauthorized - if the permission was denied.
- 503 Service Unavailable - if for some reason the position isn't available now.
- 408 Timeout - the request timedout.
`;

I.boot = async function (name, resid, query, headers, config) {
    let _doc = null;

    const err_codes = { 1: 401, 2: 503, 3: 408 };
    const default_options = {
        maximumAge: 10000,
        timeout: 10000,
        enableHighAccuracy: false
    };

    const available = 'geolocation' in navigator;

    function pos2obj(pos) {
        return {
            timestamp: pos.timestamp,
            coords: {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                altitude: pos.coords.altitude,
                accuracy: pos.coords.accuracy,
                altitudeAccuracy: pos.coords.altitudeAccuracy,
                heading: pos.coords.heading,
                speed: pos.coords.speed
            }
        };
    }
    
    // GET /_doc
    // returns the documentation in the body text.
    I.get = async function (name, resid, query, headers) {
        if (resid === '/_doc') {
            if (!_doc) {
                // Do it only once. Can't do it at boot time because the boot time
                // id will be temporary.
                _doc = { status: 200, headers: { 'content-type': 'text/markdown' }, body: _docstr.replace('{{ref}}', name) };
            };
            return _doc;
        }

        if (/^[/]?geolocation$/.test(resid) && available) {
            return new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition((pos) => {
                    resolve({ status: 200, body: pos2obj(pos) });
                }, (err) => {
                    reject({ status: err_codes[err.code], body: err.message });
                }, query || default_options);
            });
        }

        return { status: 404 };
    };

    const targetPat = /^[/]?[/]?([^/]+)(.*)$/;
    
    I.post = async function (name, resid, query, headers, body) {
        if (/^[/]?geolocation$/.test(resid) && available) {
            let target = body && body.target && body.target.match(targetPat);
            if (target) {
                let id = navigator.geolocation.watchPosition((pos) => {
                    I.network(target[1], 'post', target[2], body.query || null, body.headers || null, pos2obj(pos));
                }, (err) => {
                    I.network(target[1], 'post', target[2], body.query || null, body.headers || null, { error: err.code, message: err.message });
                }, query || default_options);
                return { status: 200, body: { status: 'ok', ref: '/geolocation/' + id } };
            }

            return { status: 400, body: 'Malformed target' };
        }

        return { status: 404 };
    };

    I.delete = async function (name, resid, query, headers) {
        let m = resid.match(/^[/]?geolocation[/]([0-9]+)$/);
        if (!m || !available) { return { status: 404 }; }

        let id = +m[1];
        navigator.geolocation.clearWatch(id);
        return { status: 200 };
    };

    I.boot = null;
    return { status: 200 };
};

