var HmacSigner = exports,
	url = require("url"),
	querystring = require("querystring"),
	crypto = require("crypto");

// http://docs.amazonwebservices.com/general/latest/gr/signature-version-4.html

function hmac(key, string, encoding) {
	return crypto.createHmac("sha256", key).update(string, "utf8").digest(encoding);
}

function hash(string, encoding) {
	return crypto.createHash("sha256").update(string, "utf8").digest(encoding);
}

// This function assumes the string has already been percent encoded
function encodeRfc3986(urlEncodedString) {
	return urlEncodedString.replace(/[!'()*]/g, function (c) {
		return "%" + c.charCodeAt(0).toString(16).toUpperCase();
	});
}

/*
 * request: { path | body, [host], [method], [headers], [service], [region] }
 * credentials: { accessKeyId, secretKey }
 */
function RequestSigner(request, credentials) {

	if (typeof request === "string") {
		request = {url : request};
	}
	if (request.url) {
		this.parsedUrl = url.parse(request.url);
	}

	var headers = request.headers = (request.headers || {});

	this.request = request;
	this.credentials = credentials;
    
    if (!credentials || !credentials.accessKeyId || !credentials.secretKey) {
        throw new Error("No credentials");
    }

	if (!request.method && request.body) {
		request.method = "post";
	}

	if (!headers.Host && !headers.host) {
		headers.Host = this.parsedUrl.hostname || request.parsedUrl.host || "";

		// If a port is specified explicitly, use it as is
		if (this.parsedUrl.port) {
			headers.Host += ":" + this.parsedUrl.port;
		}
	}
}

RequestSigner.prototype.prepareRequest = function () {

	var request = this.request, headers = request.headers, query;

	if (request.body && !headers["Content-Type"] && !headers["content-type"]) {
		headers["Content-Type"] = "application/json; charset=UTF-8";
	}

	if (request.body && !headers["Content-Length"] && !headers["content-length"]) {
		headers["Content-Length"] = Buffer.byteLength(JSON.stringify(request.body));
	}

	if (headers[this.credentials.headers.date_uc] || headers[this.credentials.headers.date_lc]) {
		this.datetime = headers[this.credentials.headers.date_uc] || headers[this.credentials.headers.date_lc];
	} else {
		headers[this.credentials.headers.date_uc] = this.getDateTime();
	}
	delete headers.Authorization;
	delete headers.authorization;
};

RequestSigner.prototype.sign = function () {
	this.prepareRequest();
	this.request.headers.Authorization = this.authHeader();
	return this.request;
};

RequestSigner.prototype.getDateTime = function () {
	if (!this.datetime) {
		var headers = this.request.headers,
			date = new Date(headers.Date || headers.date || new Date);

		this.datetime = date.toISOString().replace(/[:\-]|\.\d{3}/g, "");
	}
	return this.datetime;
};

RequestSigner.prototype.getDate = function () {
	return this.getDateTime().substr(0, 8);
};

RequestSigner.prototype.authHeader = function () {
	return [
		"HmacSHA256 Credential=" + this.credentials.accessKeyId,
		"SignedHeaders=" + this.signedHeaders(),
		"Signature=" + this.signature(),
	].join(", ");
};

RequestSigner.prototype.signature = function () {
	var date = this.getDate();
	var kDate = hmac(this.credentials.secretKey, date);
	return hmac(kDate, this.stringToSign(), "hex");
};

RequestSigner.prototype.stringToSign = function () {

	var canonicalHash = hash(this.canonicalString(), "hex");
	var stringToSign = [
		"HmacSHA256",
		this.getDateTime(),
		canonicalHash,
	].join("\n");
	return stringToSign;
};

RequestSigner.prototype.canonicalString = function () {
	this.prepareRequest();

	var pathStr = this.parsedUrl.pathname,
		query = this.parsedUrl.query?this.parsedUrl.query:"",
		headers = this.request.headers,
		queryStr = "",
		bodyHash = hash(JSON.stringify(this.request.body) || "", "hex");

	query = querystring.parse(query);

	pathStr = this.parsedUrl.pathname.split("/").map(function (seg) {
		return encodeURIComponent(seg);
	}).join("/");

	queryStr = Object.keys(query).sort().map(function (key) {
		return encodeURIComponent(key) + "=" +
            encodeURIComponent(query[key]);
	}).join("&");

	var canonicalRequest = [
		this.request.method || "get",
		pathStr,
		queryStr,
		this.canonicalHeaders() + "\n",
		this.signedHeaders(),
		bodyHash,
	].join("\n");
	return canonicalRequest;
};

RequestSigner.prototype.canonicalHeaders = function () {
	var headers = this.request.headers;

	function trimAll(header) {
		return header.toString().trim().replace(/\s+/g, " ");
	}

	return Object.keys(headers)
		.sort(function (a, b) {
			return a.toLowerCase() < b.toLowerCase() ? -1 : 1;
		})
		.map(function (key) {
			return key.toLowerCase() + ":" + trimAll(headers[key]);
		})
		.join("\n");
};

RequestSigner.prototype.signedHeaders = function () {
	return Object.keys(this.request.headers)
		.map(function (key) {
			return key.toLowerCase();
		})
		.sort()
		.join(";");
};

RequestSigner.prototype.credentialString = function () {
	return [
		this.getDate(),
	].join("/");
};

HmacSigner.RequestSigner = RequestSigner;

HmacSigner.sign = function (request, credentials) {
	return new RequestSigner(request, credentials).sign();
};
