/**
 * This provides an interface to a Ghost CMS instance.
 *
 * The resource end points /posts/, /tags/, /authors/,
 * /pages/ and /settings/ are all supported. In addition,
 * images stored in ghost can be retrieved using the
 * /images/ end point. Such images can be identified
 * by the presence of the http://server:port/content
 * prefix in the image URL.
 *
 */
I.boot = async function (name, resid, query, headers, config) {
    let kBaseUrl = config.url.replace(/[/]*$/, "");
    let kVersion = config.version;
    let kContentApiKey = config.content_api_key;
    let kAdminApiKey = config.admin_api_key;
    let kImagesBaseUrl = config.images_base_url;

    let kContentApiPrefix = kBaseUrl + "/ghost/api/" + kVersion + "/content";

    let contentURL = (res) =>
        kContentApiPrefix + res + "?key=" + kContentApiKey;
    let imageURL = (res) => kImagesBaseUrl + res;
    let http = /^https:/.test(config.url)
        ? I.require("https")
        : I.require("http");

    let kContentEndPointsPat = /^[/](?:posts|authors|tags|pages|settings)[/]/;
    let kImagesPat = /^[/]content[/]images[/]/;

    I.get = async function (name, resid, query, headers, body) {
        if (kContentEndPointsPat.test(resid)) {
            let url = contentURL(resid);
            let queries = "";
            if (query) {
                for (let key in query) {
                    url += "&" + key + "=" + encodeURIComponent(query[key]);
                }
            }

            let json = await new Promise((resolve, reject) => {
                let req = http.request(
                    url + queries,
                    { method: "GET" },
                    (res) => {
                        let json = "";
                        res.setEncoding("utf8");
                        res.on("data", (chunk) => {
                            json += chunk;
                        });
                        res.on("end", () => {
                            resolve(json);
                        });
                    }
                );
                req.on("error", reject);
                req.end();
            });

            return { status: 200, body: JSON.parse(json) };
        }

        if (kImagesPat.test(resid)) {
            // We need to use the direct API to get the images.
            // So we map the /images/ end point to the actual image URL.
            //
            // Ideally though, this API shouldn't be accessed at all,
            // since we don't actually expect the images to be stored
            // within the Ghost CMS. What we should do is to store the
            // images on a CDN and use the URL in Ghost. However, this
            // API can be useful to have a self-contained system and
            // during development and rapid iteration phases.
            //
            // For this reason, the images_base_url config is provided
            // and exists independent of the content API stuff. You can
            // point this base URL at the CDN when configuring the system,
            // or to some other image repository.
            let url = imageURL(resid);

            let image = await new Promise((resolve, reject) => {
                let req = http.get(url, (res) => {
                    let contentType = res.headers["content-type"];
                    let chunks = [];
                    res.on("data", (chunk) => {
                        chunks.push(chunk);
                    });
                    res.on("end", () => {
                        resolve({
                            contentType: contentType,
                            data: Buffer.concat(chunks),
                        });
                    });
                });
                req.on("error", reject);
                req.end();
            });

            return { status: 200, body: image };
        }

        return { status: 404 };
    };

    I.boot = null;
    return { status: 200 };
};
