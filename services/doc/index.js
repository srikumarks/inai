
let showdown = require('showdown');
let md = new showdown.Converter({headerLevelStart: 2});

// POST /service to display the documentation associated with the 
// given service.
I.boot = async function (name, resid, query, headers, body) {
    let root = document.querySelector('[inai_id="' + I._self + '"]');

    I.post = async function (name, resid, query, headers, body) {
        let m = resid.match(/^[/]?([^/]+)$/);
        if (!m) { return { status: 404, body: "Not found" }; }

        let service = m[1];
        let doc = await I.network(service, 'get', '/_doc', null, null);
        if (doc.status >= 200 && doc.status < 300) {
            let html = md.makeHtml(doc.body);
            root.querySelector('section').innerHTML = html;
            root.style.display = 'inherit';
            return { status: 200 };
        }

        return { status: doc.status };
    };

    root.style.display = 'none';
    root.querySelector('button').onclick = function (event) {
        root.style.display = 'none';
    };
    
    return { status: 200 };
};