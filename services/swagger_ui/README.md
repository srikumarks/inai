# swagger_ui

Presents the Swagger (OpenAPI) UI under the DOM element that's
marked for this using `inai="swagger_ui"` attribute.

The boot-time config will be used to decide what to show in this UI.
Otherwise, you can send a `post` on the resource `"/"` with Swagger-UI spec
as the body to instantiate the UI for that spec. The spec parameters are
described [on the docs page][spec].

[spec]: https://github.com/swagger-api/swagger-ui/blob/HEAD/docs/usage/configuration.md
