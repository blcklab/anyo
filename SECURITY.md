# Security

Please report vulnerabilities privately to the repository owner before opening a public issue.

## JSON execution model

Anyo treats world JSON strictly as data. It does not execute JavaScript from world documents. Host applications explicitly register the action names that documents may request.

## Safe object paths

Every public path-based API rejects these segments before reading or writing:

```text
__proto__
prototype
constructor
```

This applies to JSON patches, runtime data, bindings, history, migrations, and nested helpers. Malformed JSON Pointer escapes are rejected. Failed mutations are atomic and do not enter history.

## Renderer boundary

Anyo’s core imports no rendering engine. Sekai64 and Three.js remain optional peer dependencies isolated to their adapter modules. Renderer handles never enter world JSON or compiled architectural state.

## Remote assets

Applications remain responsible for:

- Allowlisting trusted image and model origins
- Applying a suitable Content Security Policy
- Validating authenticated or user-generated world documents
- Applying size and request limits to remote assets
- Avoiding secrets in public JSON documents

Sekai64 asset operations are cancellable and stale completions are ignored when the world changes.

## WebXR privacy and lifecycle

Immersive sessions must be requested from an explicit user gesture and should be served over HTTPS or localhost. Anyo does not record or transmit headset poses, controller poses, room boundaries, or hand data. Host applications must obtain appropriate consent before persisting or transmitting spatial input.

The renderer adapter keeps native WebXR sessions, frames, input sources, spaces, and GPU handles private. Anyo receives renderer-neutral snapshots only. Session denial or tracking loss must not break the non-XR website.

## Web-surface execution boundary

World JSON may reference a registered web application id, but it cannot contain executable JavaScript. Registered apps are trusted host code and receive only JSON-safe props plus an explicit Anyo context.

External URL surfaces are disabled by default. When enabled, hosts must provide exact allowed origins and a sandbox policy. Anyo rejects the dangerous combination of `allow-scripts` and `allow-same-origin`. Remote pages may also be blocked by their own CSP or `X-Frame-Options`.

Live DOM surfaces pause and hide during immersive XR. The renderer displays only the declared snapshot fallback in this release candidate.

## Runtime systems and transient state

Runtime systems do not execute code from world JSON. Systems are trusted host-supplied JavaScript modules, like plugins and registered actions.

Transient transform layers remain outside serialized world documents and history until the host explicitly calls `commitRuntimeTransform()`. Renderer synchronization failures restore dirty updates for retry. System disposal removes layers owned by that system name so stale simulation state cannot leak into replacement worlds.

Physics, animation, networking, and procedural systems must validate any untrusted external data before writing runtime transforms. Hosts remain responsible for rate limits and resource limits for simulation workloads.
