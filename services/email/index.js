const _doc = `
# email service

This is a simple service based on [nodemailer][]
to send emails via sendmail or Amazon SES as
configured.

You post messages to \`/\` with body in the
following format -

\`\`\`
{
    "from": "...",
    "to": ["...", ...],
    "cc": ["...", ...],                        // OPTIONAL
    "bcc": ["...", ...],                       // OPTIONAL
    "subject": "the subject",
    "text": "Text representation of the email"
    "html": "HTML representation of the email" // OPTIONAL
}
\`\`\`

For more fields, see the [nodemailer][] documentation. The
JSON used is the same as that. This "service" is a super simple
wrapper around the library.

Currently supports only the AWS SES transport. The structure
of the reply upon sending a message is also aligned with the
SES service response.

> **Design note***: The API leaks the SES service through, which
> is not desirable if multiple backends are expected to be supported.
> So for now only the \`messageId\` and the \`envelope\` are sent back.

Currently, there is no \`get\` support for message details.

[nodemailer]: https://nodemailer.com/
`;

I.boot = async function bootFn(name, resid, query, headers, config) {
    let nodemailer = I.require("nodemailer");
    let transporter = null;

    if (config.transport === "ses") {
        let aws = I.require("aws-sdk");

        transporter = nodemailer.createTransport({
            SES: new aws.SES(config),
        });
    }

    if (!transporter) {
        return { status: 500, body: "Could not create transport" };
    }

    I.get = function (name, resid, query, headers) {
        if (resid === "/_doc") {
            return {
                status: 200,
                headers: { "content-type": "text/markdown" },
                body: _doc,
            };
        }
        return { status: 404, body: "Not found" };
    };

    I.post = async function (name, resid, query, headers, body) {
        let info = await new Promise((resolve, reject) => {
            transporter.sendMail(body, (err, info) => {
                if (err) {
                    return reject(err);
                }
                resolve(info);
            });
        });

        return {
            status: 200,
            body: { envelope: info.envelope, messageId: info.messageId },
        };
    };

    I.shutdown = async function (name, resid, query, headers) {
        I.boot = bootFn;
        I.post = null;
        I.shutdown = null;
        return { status: 200, body: "Ok" };
    };

    I.boot = null;
    return { status: 200, body: "Ok" };
};
