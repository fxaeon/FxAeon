# FxAeon X profile artwork

| File | Dimensions | Use |
| --- | ---: | --- |
| `fxaeon-x-profile.png` | 400 × 400 | X profile photo upload |
| `fxaeon-x-banner.png` | 1500 × 500 | X header/banner upload |
| `fxaeon-x-profile.svg` | 400 × 400 | Editable profile source |
| `fxaeon-x-banner.svg` | 1500 × 500 | Editable banner source |

The compositions use the existing FxAeon ribbon paths from
`apps/mini-app/src/components/FxLogo.tsx` and
`apps/landing/assets/fxaeon-mark.svg`. The profile keeps the mark centered
inside the circular crop; at 32px the ribbon mark remains about 23px wide.
The banner leaves the left side clear for X's overlaid profile photo and keeps
the mark in the central 380px of banner height. It contains no text.

The palette is the existing `#080808` canvas, `#202020` border, and `#2973FF`
brand blue. The logo paths are unchanged.

X's Help Center recommends 400 × 400 profile photos and 1500 × 500 headers.
It notes that up to 60px may be cropped from the top and bottom of a header on
some displays. X does not document a fixed profile-avatar overlap safe zone;
the empty left side is a conservative layout choice. SVG files are the editable
masters; upload the PNG exports.

Sources:

- [How to customize your profile](https://help.x.com/en/managing-your-account/how-to-customize-your-profile)
- [Help with uploading a profile photo](https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo)

Regenerate both PNG exports and a temporary desktop/phone/circle-crop review
sheet with the workspace's Playwright browser:

~~~sh
node apps/landing/assets/social/render.mjs
~~~

The review sheet is written to the system temporary directory and is not an
upload asset.
