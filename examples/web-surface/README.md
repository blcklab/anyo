# Web-surface example

This example mounts a trusted host-registered HTML/CSS/JavaScript application onto an Anyo wall.

```bash
npm install ../blcklab-sekai64-0.7.0-rc.1.tgz
npm run build
python -m http.server 4173
```

Open `http://localhost:4173/examples/web-surface/`.

The live DOM surface is used on desktop. Its snapshot remains an ordinary Sekai64 image primitive and is shown whenever live DOM presentation is unavailable, including immersive XR in this release candidate.
