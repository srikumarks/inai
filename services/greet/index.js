
let count = 0;

const _doc = `
# Hello world greeting action

When you post a message to \`{{ref}}\`, it will append
a "Hello world!" message to the div it is attached to.
The message is independent of the contents of the posted
request.
`;

// A silly demo "greet" service.
I.boot = async function (name, resid, query, headers, config) {
    // POST /
    // will append a "Hello world" message to the div.
    I.post = async function (name, resid, query, headers, body) {
        I.dom(I._self, { op: 'append', tag: 'p', body: "[" + (++count) + "] Hello world!", childOf: I._self });
        return { status: 200 };
    };
    
    // GET /_doc
    // returns the documentation in the body text.
    I.get = async function (name, resid, query, headers) {
        if (resid === '/_doc') {
            return { status: 200, headers: { 'content-type': 'text/markdown' }, body: _doc.replace('{{ref}}', name) };
        }
        return { status: 404, body: 'Not found' };
    };

    I.boot = null;
    return { status: 200 };
};

