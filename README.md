
> WARNING: This is a preliminary release for ideation purposes and is not
> intended to be used in production as it contains no tests and grew out
> of exploratory coding and testing. All that **will** be added in due
> course and this banner will be removed. Until then, tread with caution.
>
> You have been warned!

## Introduction

*Inai* is a prototype application server based on the idea of "what if
the internal components of a server were also built to interoperate using
representational state transfer, or REST?" If this works in the large
between multi-process and multi-computer distributed systems, do we
gain anything by adopting the same principle as interface between software
components **within** a single process?

This isn't a new idea and has been called [In-process REST][ipr] (see
[presentation][iprp]). What's fun about Inai is that it uses Javascript
throughout in order to get some not-so-easy-to-obtain system properties that
are favourable for rapid development, deployment and iteration of web
applications - both frontend and backend.

[ipr]: https://link.springer.com/chapter/10.1007/978-1-4614-9299-3_11
[iprp]: https://www.slideshare.net/MarcelWeiher/in-processrest

## Motivations

1. Live code update. If a "service" can only be accessed via an in-process virtual
   "network", then it will be easy to replace that service on the fly - both
   server side and client side. Basically, I hate seeing a "this site is down
   for maintenance" page.

2. Proxies. Such services can easily proxy requests over the network to remote
   services without change of programming model.

3. Version control. An updated service can put in mechanisms to support backward
   compatibility for its "customers".

4. Traceability. The virtual network can log all interactions between these
   services for higher visibility into application architecture.

5. Testability. Components should be testable in isolation. If we have late
   binding with all other dependencies, we can inject the component into
   different test environments.

6. Worst case, it may serve as a simulator to help programmers learn REST
   principles.

## Getting started

### Prerequisites

1. `npm` and `node` installed
2. [jq](https://stedolan.github.io/jq/) for build scripts
3. `redis-cli` and `redis-server` available on the command line
4. `browserify` available on the command line.

### Setup

1. Install the prerequisites.
2. Clone the repository.
2. `npm install` to get all the dependencies.
3. `make` to build everything and "deploy" it to a local redis instance.
4. `node server` to start the server

That will get you a sample application which supports google authenticated
login .. to do absolutely nothing interesting except if you're a software
developer and you're willing to look at how the code - both frontend and
backend - is structured. 

To see this wonderous creation, visit http://localhost:8080/app .
To check out what is in the deployed codebase, do `redis-cli -p 6380`.

The app is located in `services/app`. While the server is running, you can
make changes to it, hit `make` and have the new version deployed live into
the running server so that a browser refresh is all that is needed to test
your code. `app` makes use of `greet` and `gsignin` on the client side, which
you can also modify. `app`'s template demonstrates the use of
self-documenting components .. though not all components have documentation.
(They eventually will though.)

In production, the system expects to have a master REDIS instance to which
code will be deployed, which each node's replica instance will connect to to
pick up changes from. Currently, all nodes connected this way will be
identical, but we can build differentiation and related features into the
system later on.

## What is all this about?

Essentially, Inai takes a REST based approach to late binding components in
order to get a highly iterative development cycle. Many Inai services were
developed and debugged live within Inai.

At its core is the "network" - a half-page of code that routes messages
between components running in the server or client, depending on where it is
running. You invoke other REST services on your "network" using an expression
like this -

```
let result = await I.network(
        'service_name', 'post', '/res/part',
        {v: 1},
        {'content-type': 'text/plain'},
        'Imaginea Labs'
    );
if (result.status === 200) {
    console.log("Yeah!");
    console.log(result.headers);
    return result.body;
}
```

This protocol is a small subset of the HTTP standard. The arguments won't be
always marshalled to strings since these invocations are happening in-process.
Once you've learnt the `I.network` function, you pretty much know how components
talk to each other.

### Services

(Almost) every piece of code in Inai is parceled into a small "service"
that exposes a REST API for other services to communicate with it. A service
is simply a JS module that can be bundled into a single file using something
like `browserify index.js` in the service's directory. The server loads these
code bundles and injects some globals into them, the most important of which
is `I`. You set members on `I` in order to export REST APIs to the rest of the
world.

```
I.post = async function (name, resid, query, headers, body) {
    return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'Hello world!' };
}
```

1. `name` is the name of the service
2. `resid` is a URL-like thing without the origin - i.e. it is a pathname to the
   resource being exposed by the service.
3. `query` is a map or `null`.
4. `headers` is a map or `null`. For things that map to the external world,
   these will be actual http headers.
5. `body` is the message body - usually text or JSON.

Each such "service" also has a `spec.json` that describes how to load
and boot the service and in what contexts.

You can set the `I.boot` function to customize the component initialization,
where the `body` argument will be the `spec.config` object. There is also
a corresponding `I.shutdown` function. Both are optional to implement.

See the following for examples -

1. `services/app` - server side
2. `services/greet` - browser side
3. `services/gauth` - server side
4. `services/gsignin` - browser side

## Core services

### _dns

Performs the function of name mapping so services can communicate with each
other. The `_dns` is itself a service, which means you can live patch the DNS
while the system is running. Usually you won't be dealing with this.

See `network.js` for details.

### _services

This is a service used to instantiate other services on the node. Usually, you
won't have to deal with this either, as all the code that needs this is already
written for you.

See `network.js` for details.

### auth

This is a core but stub service that has a basic token mechanism in place
for illustrative purposes. It will be fleshed out into a more robust module.
It underlies the permission system using which Inai doles out access to its
services from the outside world.

## Client-side framework

While the use of REST is probably understandable on the server side, Inai
uses the **same** approach for client-side code as well. This means it comes
with a small framework for developing front end code, on top of which each
component you use can use a different internal framework (untested, but that's
the goal).

Client-side REST services are processes that can be attached to DOM elements
(one per element) so they can manage what shows under that element. This is
done with tags like -

```
<div id="meow" inai="greet"></div>
```

The `inai` attribute identifies the client-side codebase to be used to manage
this DOM element. The client-side code will automatically see this and spawn
the service for you and bind it to the element. Once bounds, the element will
have a unique `inai_id` attribute which identifies the service it is bound to.

If the element has an `id` attribute, then its value is used as the "domain
name" of the service that manages the element, so that you can wire other
services to talk to it by name.

If you have buttons and such active elements, you can capture their events
and have them sent to target services, which much be managing other elements.

```
<button inai_events="click,mouseover", inai_target="/meow/touch">Greet me!</button>
```

The `inai_events` is a comma-separated list of event names that will be
needed. These events will be captured and sent to the service target
identified by `inai_target`, where the first path component identifies the
service by name. The `resid` in the call to the service will contain the
remainder of the path name.

What's more, the minimal framework code will watch the DOM for changes
and if any new components are declared with `inai` attributes, it will
spawn the services to manage them automatically.

That's basically it for the front-end framework! Now go play with it!

Note that front-end components can also be deployed piecemeal using the
same deployment mechanism used in the server ... except they won't update
instantly unlike the server, and will need a page reload. While a live
update is possible using websockets and would make for a great demo,
I don't think it is a good idea to suddenly replace a visual element
while a user is interacting with it.

## How it all works

When you build a component, it is bundled into a single file and stored in
a REDIS database at a key. The code is identified by its sha1 hash and some
metadata about it is provided from the `spec.json` file. 

The server picks up the code and metadata from the REDIS database whenever it
detects a change in the mapping of a name to a service. It then boots the new
code and switches the DNS to the new service so that new requests will be
directed at the new instance.

While that much seems like something we seem to be doing with libraries like
file watchers and live reload, the reason there can be some guarantees about
this working in Inai is that **all the components are decoupled using late
bound names**. 

The client side fetches code from the server for each component it uses and
instantiates it into the requisite number of services over there. Just like
the server side code, these services can also communicate using the REST
protocol. For example, you could instantiate a "notifications" service to
which you can `post` messages to be displayed as notifications. The service
will manage the necessary DOM updates entirely on its own.











