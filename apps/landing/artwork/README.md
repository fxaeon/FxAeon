# Current

Original FxAeon motion artwork: two bevelled metal ribbons in a cobalt studio. The geometry, lighting, camera and choreography are authored in `scene.js`. There are no UI captures, stock clips, downloaded models, audio tracks or financial simulations.

This is an offline authoring project. Three.js, GSAP and HyperFrames never ship to the website; only the compressed MP4s and poster do. Install the pinned development packages in this directory separately from the application workspace. Node 22+, Chrome and FFmpeg/FFprobe on PATH are required.

1. `npm install --ignore-scripts`
2. `npm run build`
3. `npm run check`
4. `npm run render`
5. `npm run render:wide`
6. `npm run export`

The timeline is paused and seekable. It drives only the scene's visual phase and a short camera-frame entrance. Three.js uses internal UUIDs and supports animation loops, but this scene never starts a renderer loop or uses randomness for visible geometry. Keeping the library in `vendor.min.js` lets the composition checker analyze the authored animation separately.

Review snapshots at 0, 3.5 and 6.5 seconds before exporting. The DOM layout sweep may report that nothing moves because the geometry changes inside a fixed canvas; verify the rendered frames. The silent output is intentional.

The export script encodes the 1440×720 wide composition and the 540px phone rendition as H.264, yuv420p, without audio, with `+faststart`. It tags the transfer function as sRGB to match browser compositing and derives the JPEG poster from the first wide frame. Keep the phone file below 1MB and the desktop file below 2MB; preserve both crossing ribbons in the phone crop. The landing loads the rendition only when playback is allowed and the artwork enters view.
