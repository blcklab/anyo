# VR release checklist

Run these checks in your actual viewer on each supported headset and browser.

## Entry and fallback

- Serve production builds over HTTPS.
- Request immersive VR only from an explicit user gesture.
- Check `world.xr.isSupported('immersive-vr')` before enabling the entry control.
- Keep a usable desktop/mobile fallback.
- Configure the `xr-spatial-tracking` Permissions Policy when the application is embedded.

## Comfort and accessibility

- Default to teleport locomotion and snap turning.
- Keep smooth locomotion and smooth turning opt-in.
- Do not add head bob, forced camera shake, or automatic movement.
- Provide a visible exit control.
- Support one-controller operation.
- Keep important interactions reachable through controller or gaze input.
- Use more than color alone to distinguish valid and invalid teleport targets.

## World behavior

- Verify floors, stairs, closed doors, walls, and player clearance for teleportation.
- Verify room visibility and portal state after movement.
- Verify controller and gaze actions use the same registered host actions as desktop input.
- Verify instanced products resolve to the correct Anyo entity.
- Check that runtime bindings and door-state updates remain incremental while XR is active.

## Lifecycle

- Enter and exit VR repeatedly.
- Test browser-initiated session termination.
- Test permission denial.
- Test tracking loss and restoration.
- Replace a world after leaving XR.
- Dispose while assets are loading.
- Confirm desktop RAF and XR RAF never run simultaneously.
- Profile memory after repeated load/enter/exit/dispose cycles.

## Device validation

Record the browser, browser version, headset, firmware, controllers, operating system, backend, supported features, and known limitations for every tested target.

Automated tests use XR mocks. Record physical headset results before calling a release stable; passing the mock suite does not establish tracking quality, comfort, or rendering performance.
