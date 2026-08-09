# The keyboard

One map, written down, because thirteen panels were built by agents who never spoke to each other
and each of them claimed keys on its own. This file is the record. **If you add a key, add it here
in the same commit, and check the tables below before you take one.**

Every handler ignores a key press while the focus is in a text field, and every handler ignores
anything held with Control or Command, so the browser's own shortcuts still work.

## Time

| Key | What it does | Owner |
| --- | --- | --- |
| `Space` | Pause, and unpause | `src/ui/panels/hud.js` |
| `1` `2` `3` `4` | Speed: 1x, 3x, 12x, 60x | `src/ui/panels/hud.js` |
| `0` | Pause | `src/ui/panels/hud.js` |

The camera rig would otherwise use `1` to `5` for its own modes. It stands down: the HUD raises the
`camera-no-number-keys` flag at mount and the rig checks it. `Tab` is how you change camera mode.
`Space` in the drone camera flies up instead, and the HUD checks for that before taking it.

## Moving

| Key | What it does | Owner |
| --- | --- | --- |
| Drag | Hold the ground and move it | `src/render/camera.js` |
| Right drag | Orbit and tilt | `src/render/camera.js` |
| Wheel | Zoom, or on foot and in the air, the lens | `src/render/camera.js` |
| `W` `A` `S` `D` | Pan, walk or fly, depending on the mode | `src/render/camera.js` |
| `Tab`, `Shift` + `Tab` | Next and previous camera mode: planner, street, follow, drone, cinematic | `src/render/camera.js` |
| `Home` | Frame the whole island | `src/render/camera.js` |
| `F1` to `F4` | Go to Dunwich, Amity Point, Point Lookout, North Gorge | `src/render/camera.js` |
| `Shift` + `F1` to `F4` | Save the current view over that slot | `src/render/camera.js` |
| `Alt` + `1` to `4` | The same four views, without reaching for the function keys | `src/render/camera.js` |
| `P` | Photo mode | `src/render/camera.js` |
| `B` | Letterbox bars | `src/render/camera.js` |
| `L` | Place labels on and off | `src/render/camera.js` |
| `C` | The next cinematic shot | `src/render/camera.js` |
| `H` | Hide the whole interface | `src/render/camera.js` |

## Boards

Each of these opens its board and closes it again. `Escape` closes whatever is open.

| Key | Board | Owner |
| --- | --- | --- |
| `G` | The civic board | `src/ui/panels/civic.js` |
| `E` | The island calendar | `src/ui/panels/events.js` |
| `K` | The siting bench | `src/ui/panels/build.js` |
| `J` | The chronicle | `src/ui/panels/chronicle.js` |
| `U` | The works below the sand, proposed | `src/ui/panels/subterranean.js` |
| `O` | Settings | `src/ui/panels/settings.js` |
| `I` | The island log | `src/ui/panels/notifications.js` |
| `M` | The map: docked, then off; `Shift` + `M` for full screen | `src/ui/panels/map.js` |
| `N` | Mute and unmute; `Shift` + `N` for the mixer | `src/audio/audio.js` |
| `?` | The arrival screens again, from the acknowledgement | `src/ui/panels/onboarding.js` |

## Info views

| Key | What it does | Owner |
| --- | --- | --- |
| `V` | Open the info view picker, and close it | `src/ui/panels/infoviews.js` |
| `Alt` + `V` | Turn the current info view off | `src/ui/panels/infoviews.js` |
| `Alt` + a letter | Go straight to one view, from the table below | `src/ui/panels/infoviews.js` |
| `[` `]` | Step back and forward through the views | `src/ui/panels/infoviews.js` |
| Arrows, `Enter` | Move and choose, inside the picker | `src/ui/panels/infoviews.js` |

The letters, which are held with `Alt` so that none of them collides with a board:

| | | | |
| --- | --- | --- | --- |
| `C` Land cover | `E` Elevation and contours | `S` Slope | `T` Land tenure |
| `V` Vegetation communities | `F` Fire: what carries it | `D` Dune erosion and accretion | `G` Groundwater and the lakes |
| `K` Koala country and road strikes | `B` Shorebird roosts and disturbance | `W` Whales on migration | `M` Sea Country: banks and reefs |
| `O` Who is home tonight | `R` Rental availability | `P` Visitor density | `U` Business viability |
| `A` Roads, access and the tide | `X` Power | `H` Water and wastewater | `Y` Waste |
| `N` Mobile coverage and the ridge | `Q` Noise | | |

`Alt` + `V` is the odd one out: it clears the view rather than opening the vegetation one, because
turning a layer off is the thing you want more often. Vegetation is on the picker.

## The inspector

The inspector has no key of its own. It is always there, it fills when you click something on the
island, and it empties when you press `Escape`.

| Key | What it does |
| --- | --- |
| `Escape` | Clear the selection |
| `Backspace` | Back to the last thing you had selected |
| `Left` `Right` | Previous and next tab |
| `Up` `Down` | Move through what can be clicked in the panel |
| Double click, on the island | Fly to it |

## What is deliberately not bound

- No key opens the inspector, because clicking the island is the way in and a key would be a second
  answer to a question that already has one.
- No key builds anything. There is no build button and there is never going to be one:
  `src/ui/panels/build.js` explains why, and `K` opens the siting bench, which is a different thing.
- `5` does nothing. The camera rig has five modes and the HUD has four speeds, and rather than have
  one number key mean a camera mode while its four neighbours mean speeds, the fifth mode is on
  `Tab` with the rest.

## Where the collisions were

Recorded so nobody re-introduces them.

- `1` to `5` were claimed by both the camera rig and the HUD. Resolved by the `camera-no-number-keys`
  flag, which was already in place before this pass.
- Every info view letter collides with a board letter: `G`, `E`, `K`, `U`, `V`, `M`, `N`, `O`, `P`,
  `B`, `C`, `H`. Resolved by putting the whole info view alphabet behind `Alt`, and by
  `src/ui/panels/infoviews.js` listening in the capture phase and stopping the event so a key it
  owns never also reaches the camera rig.
- The island log had no key at all until this pass, which made it the only surface on screen you
  could not reach from the keyboard.
