# Tailwind CSS styles for whole app

To use this, you don't really need to do anything apart from including
the resultant style build in whatever HTML files you serve. You can make
multiple of them and keep them as resources associated with the `tailwind`
service and use whichever is appropriate for the page you're serving.

For example, the default build takes `styles-src.css` and turns it into `styles.css`
which is kept associated with the `tailwind` service as an "asset" which
can be loaded using -

```
<link rel="stylesheet" href="/_codebase/named/tailwind/assets/styles.css">
```

directly in any template HTML. The build instructions are in the root
Makefile. This breaks a little encapsulation, but I'll fix that in time.
For now, having a global style-serving service is a nice consistency.

NOTE: You don't even need to indicate needing the tailwind service in
your HTML body's `boot` attribute. Just using the link will suffice.
