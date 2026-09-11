# VR room example

Install the exact Sekai64 release candidate, build Anyo, and serve the repository over HTTPS or localhost:

```bash
npm install ../blcklab-sekai64-0.7.0-rc.1.tgz
npm run build
python -m http.server 4173
```

Open `http://localhost:4173/examples/vr-room/`.

The example works as an ordinary desktop world when immersive VR is unavailable. On a supported WebXR device it demonstrates session entry, a shared desktop/XR frame step, teleportation, snap turning, controller selection, and the existing Anyo action registry.
