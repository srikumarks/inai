
/**
 * A single policy has the following structure -
 *      service : string (optional)
 *      methods : array of get|put|post|...
 *      resource : regexp describing resource
 *      groups : array of group names. User must be in one of these groups for policy match
 *
 * config.policies is an object whose keys are service names and whose values are
 * arrays of policies.
 *
 * When 'post'ing, the body is expected to be array of policies applicable to the service.
 */

// A single policy check tries to match against a line with
// the following syntax -
//
// <servicename><SPACE><method><SPACE><resid><SPACE><grouppat>
//
// <servicename> is the name of the service to which the request is
//               coming in.
// <method> is one of the exact words - get,post,put,delete
// <resid> is the resource "url" that's the target of the request.
//         This is expected to not have any spaces in it.
// <grouppat> This is a list of groups that the user who's currently
//         authenticated for the request is part of. The list is given
//         in the format `|group1|group2|group3|...|groupN|`.
//
// For example, a policy regex that permits access to the `auth` service for
// the `admin` and `sudoers` groups  will look like this -
//
// ```
// auth (?:get|put|post|delete) [^\s]+ (?:[|][^\s]+)*[|](?:admin|sudoers)[|](?:[^\s]+[|])*
// ```
//
// The policy service takes the policy structure and converts it into such
// a regexp that is then supplied in bulk to the `_policy` service for use
// at runtime.
//
// The burden of writing a correct regular expression is likely high,
// and to help with that this API only requires the resource id to be
// specified using a regex pattern .. with the rest of the complete
// regex line constructed based on parameters giving the service, methods
// and the groups.
//
// NOTE: When specifying resource, it may be worth making a leading '/'
// character in the resource id optional.
//
// NOTE: Because service names and group names are used literally, they
// need to be regex safe. If they match 
//
I.boot = async function main(name, resid, query, headers, config) {
    
    let policyMap = new Map();
    
    for (let service in config.policies) {
        policyMap.set(service, config.policies[service]);
    }

    I.get = async function (name, resid, query, headers) {
        let m = resid.match(/^[/]?[/]?([^/]+)$/);
        if (m && policyMap.has(m[1])) {
            return { status: 200, body: policyMap.get(m[1]) };
        }
        return { status: 404 };
    };

    I.post = async function (name, resid, query, headers, body) {
        let m = resid.match(/^[/]?[/]?([^/]+)$/);
        if (m) {
            let service = m[1];
            let existingPolicies = policyMap.has(service) ? policyMap.get(service) : [];
            let newPolicies = existingPolicies.concat(body);
            policyMap.set(newPolicies);
            await I.network('kv', 'put', '/auth/policies/' + service, null, null, newPolicies);
            await I.network('_policy', 'put', service, null, null, compilePolicies(service, newPolicies));
            return { status: 200, body: {service: service, policiesAdded: body.length, totalPolicies: newPolicies.length} };
        }

        return { status: 404 };
    };

    I.put = async function (name, resid, query, headers, body) {
        let m = resid.match(/^[/]?[/]?([^/]+)$/);
        if (m) {
            let service = m[1];
            let newPolicies = body.slice(0);
            policyMap.set(newPolicies);
            await I.network('kv', 'put', '/auth/policies/' + service, null, null, newPolicies);
            await I.network('_policy', 'put', service, null, null, compilePolicies(service, newPolicies));
            return { status: 200, body: {service: service, totalPolicies: newPolicies.length} };
        }

        return { status: 404 };
    };

    I.shutdown = function (name, resid, query, headers) {
        I.boot = main;
        I.post = null;
        I.get = null;
        I.put = null;
        I.shutdown = null;
        return { status: 200 };
    };

    I.boot = null;
    return { status: 200 };
};

function compilePolicies(service, policies) {
    return policies.map(compilePolicy.bind(service)).join('|');
}

function compilePolicy(policy) {
    if (!policy || !policy.methods || !policy.methods.length || !policy.resource || !policy.groups || !policy.groups.length) {
        throw new Error("policyman: Invalid policy object");
    }

    policy.methods.forEach(m => {
        if (!/^get|put|post|delete$/.test(m)) {
            throw new Error("policyman: Unknown method " + m);
        }
    });

    if (/\s/.test(policy.resource)) {
        throw new Error("policyman: Resource regex cannot contain spaces");
    }

    return (
        '(?:' + 
            escapeRegex(policy.service || this) + 
            '\\s+(?:' + 
                policy.methods.join('|') + 
            ')\\s+' + 
            policy.resource +
            '\\s+' +
            '(?:[|][^\\s]+)*(?:' + policy.groups.map(escapeRegex).join('|') + ')' + '(?:[^\\s]+[|])*'
        ')'
    );
}

function escapeRegex(str) {
    return str.replace(/[-.:$#@*|]/g, placeInSqBrackets);
}

function placeInSqBrackets(str) {
    return '[' + str + ']';
}


