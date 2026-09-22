# Public homepage

This directory contains the checked-in source and deployable static build for the public `gomrok.org` homepage.

- `app/` contains the Next.js source and local Vazirmatn font wiring.
- `dist/` is the reviewed static package used by the IIS root-homepage deployment helper.
- The application under `client/` remains the `/app` product and is deployed independently.

The public homepage package must not replace the `/app` application or its API route.
