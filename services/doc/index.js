
let showdown = require('showdown');
let md = new showdown.Converter({headerLevelStart: 2});

// POST /service to display the documentation associated with the 
// given service.
I.boot = async function (name, resid, query, headers, body) {

    I.post = async function (name, resid, query, headers, body) {
        if (resid === '/close') {
            return I.dom(I._self, { op: 'set', classes: "-is-active" });
        } 
        let m = resid.match(/^[/]?([^/]+)$/);
        if (!m) { return { status: 404, body: "Not found" }; }

        let service = m[1];
        let doc = await I.network(service, 'get', '/_doc', null, null);
        if (doc.status >= 200 && doc.status < 300) {
            let html = md.makeHtml(doc.body);
            I.dom('doc/title', {sel: '#doc #doc-title', op: 'set', body: "/doc/" + service});
            I.dom('doc/body', {sel: '#doc #doc-body', op: 'set', body: html});
            I.dom('doc/markdown/h', {sel: '#doc h2', op: 'set', attrs: { "class": "title is-2" }});
            I.dom(I._self, {op: 'set', classes: 'is-active'});
            return { status: 200 };
        }

        return { status: doc.status };
    };

    let _selfsel = '[inai-id="' + I._self + '"]';
    I.dom(I._self + '/button', {
        sel: _selfsel + ' button',
        op: 'event',
        event: 'click',
        service: 'doc',
        verb: 'post',
        resid: '/close'
    });
    
    return { status: 200 };
};