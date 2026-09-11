# Security

Report suspected vulnerabilities privately to the repository owner before opening a public issue. Include a minimal reproduction and the affected package version.

## JSON execution model

World JSON is data. It can reference actions registered by your app, but it cannot provide JavaScript to execute.

## Safe object paths

Every public path-based API rejects these segments before reading or writing:

```text
__proto__
prototype
constructor
```

This applies to JSON patches, runtime data, bindings, history, migrations, and nested helpers. Malformed JSON Pointer escapes are rejected. Failed mutations are atomic and do not enter history.

## Renderer boundary

Core imports do not load a rendering engine. Sekai64 and Three.js are optional peers used by their adapters. Keep renderer handles out of world JSON and compiled architecture.

## Remote assets

Your app needs to:

- Allow only trusted image and model origins.
- Apply a Content Security Policy.
- Validate user-generated and authenticated world content.
- Limit remote asset sizes and requests.
- Keep secrets out of public JSON.

The Sekai64 adapter can cancel asset requests and ignores results from worlds that have been replaced.

## WebXR privacy and lifecycle

Immersive sessions must be requested from an explicit user gesture and should be served over HTTPS or localhost. Anyo does not record or transmit headset poses, controller poses, room boundaries, or hand data. Host applications must obtain appropriate consent before persisting or transmitting spatial input.

Native XR sessions, frames, input sources, spaces, and GPU handles stay inside the renderer adapter. Keep the ordinary website usable after session denial or tracking loss.

## Web-surface execution boundary

World JSON may reference a registered web application id, but it cannot contain executable JavaScript. Registered apps are trusted host code and receive only JSON-safe props plus an explicit Anyo context.

External URL surfaces are disabled by default. When enabled, hosts must provide exact allowed origins and a sandbox policy. Anyo rejects the dangerous combination of `allow-scripts` and `allow-same-origin`. Remote pages may also be blocked by their own CSP or `X-Frame-Options`.

The built-in web-surface runtime pauses and hides live DOM in immersive XR, leaving the declared snapshot fallback visible.

## Runtime systems and transient state

Runtime systems do not execute code from world JSON. Systems are trusted host-supplied JavaScript modules, like plugins and registered actions.

Temporary transform layers stay outside saved documents and history until your app calls `commitRuntimeTransform()`. Failed renderer updates remain dirty for retry. Disposing a system removes the layers owned by its name.

Physics, animation, networking, and procedural systems must validate any untrusted external data before writing runtime transforms. Hosts remain responsible for rate limits and resource limits for simulation workloads.
