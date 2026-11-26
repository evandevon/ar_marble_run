# Paper Platformer

Draw a level with whiteboard markers on paper (or a mini whiteboard). A webcam looking down turns the drawing into a platform game, played by a stick figure on the front screen.

**Play it:** https://evandevon.github.io/ar_marble_run/

## Marker colours

| Marker | Becomes |
|---|---|
| **Black** | Ground and walls. Any shape: lines, slopes, boxes, scribbles |
| **Blue** | Bouncy trampoline |
| **Red** | Danger (lava, spikes). Touch it and you restart |
| **Green** | The goal. Touch it to win |
| **Orange / yellow** | Coins. Draw dots |

## How to play

1. **Build mode:** draw the level. The camera outlines what it sees in each colour. Click the paper to move the start flag. The dotted arcs show how far and high the character can jump.
2. Press **Play** (or Enter). The level freezes and the stick figure appears.
3. **← →** (or A/D) to run, **Space / ↑ / W** to jump. Hold jump for a higher jump. **R** restarts.
4. Reach the green goal. Press **Build** to change the drawing and try again.

Game controllers work too: stick or d-pad to move, A to jump, Y to restart, Start to switch between Build and Play.

No camera? Try the built-in demo level, or a photo of a drawing.

## Classroom setup

1. Tape a sheet of white paper (A3 is ideal) flat on a desk, or use a mini whiteboard.
2. Mount the webcam above it, pointing straight down.
3. Use even room light. Avoid a lamp directly above (glare) or strong shadows. Matte whiteboards reflect less than glossy ones.
4. Open the site in Chrome or Edge, choose **Screen mode** and allow the camera.
5. Press **Lock colours**, then click the four corners of the drawing area.
6. Press **Start**. The setup is remembered for next time (**Use last setup**).

Thick markers work best; pencil is ignored on purpose. If something is being missed, open **Tune**:

- **Black ink:** raise if black lines are missed, lower if shadows become ground.
- **Colour:** lower if faint colours (often yellow) are missed, raise if black lines pick up coloured edges.
- **Join gaps:** joins small breaks in wobbly lines.

## Other keys

| Key | Action |
|---|---|
| C | Camera view / clean view |
| M | Sound on/off |
| F | Fullscreen |
| Esc | Back to Build |

## How it works

| File | Job |
|---|---|
| `js/camera.js` | Webcam, still photo and demo-level sources |
| `js/homography.js` | Flattens the angled camera view into a rectangle |
| `js/vision.js` | Sorts every pixel into a marker colour (adjusting for uneven light), cleans edges, joins gaps |
| `js/platformer.js` | Character physics against the ink, coins, danger and goal |
| `js/stickman.js` | The animated stick figure |
| `js/effects.js` | Particles and synthesised sound effects |
| `js/render.js` | Draws everything |
| `js/main.js` | Screens, setup, controls and the game loop |
| `js/marble/` | The earlier marble-run prototype, parked for a possible physics mode |

Everything runs in the browser. There is no server and nothing leaves the computer.

## Hosting

Plain HTML/JS with no build step. Publish with **Settings → Pages → Deploy from a branch → `main` / root**. GitHub Pages serves over HTTPS, which browsers require for camera access.

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
