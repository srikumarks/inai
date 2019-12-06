
let showdown = require('showdown');
let md = new showdown.Converter({headerLevelStart: 2});

// POST /service to display the documentation associated with the 
// given service.
I.boot = async function (name, resid, query, headers, body) {

    I.post = async function (name, resid, query, headers, body) {
        if (resid === '/close') {
            return I.dom(I._self, { op: 'set', style: { display: 'none' }});
        } 
        let m = resid.match(/^[/]?([^/]+)$/);
        if (!m) { return { status: 404, body: "Not found" }; }

        let service = m[1];
        let doc = await I.network(service, 'get', '/_doc', null, null);
        if (doc.status >= 200 && doc.status < 300) {
            let html = md.makeHtml(doc.body);
            I.dom('doc/section', {sel: '#doc > section', op: 'set', body: html});
            I.dom(I._self, {op: 'set', style: { display: 'inherit' }});
            return { status: 200 };
        }

        return { status: doc.status };
    };

    let _selfsel = '[inai-id="' + I._self + '"]';
    I.dom(I._self, {op: 'set', style: { display: 'none' }});
    I.dom(I._self + '/button', {
        sel: _selfsel + ' > button',
        op: 'event',
        event: 'click',
        service: 'doc',
        verb: 'post',
        resid: '/close'
    });
    
    return { status: 200 };
};