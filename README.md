# Paper Platformer

Draw a level with whiteboard markers on paper (or a mini whiteboard). A webcam looking down turns the drawing into a platform game, played by a stick figure on the front screen.

**Play it:** https://evandevon.github.io/ar_marble_run/

## Printable level sheet

Print **[template.html](template.html)** (landscape, A4 or A3, black and white is fine). It has a frame the exact shape of the game, a name line, the colour key, and a true-size picture of the character and its jump height. The four black corner squares let the game crop scans, photos and the webcam view automatically.

## Marker colours

| Marker | Becomes |
|---|---|
| **Black** | Ground and walls, solid from every side. Any shape: lines, slopes, boxes, scribbles |
| **Blue** | Trampoline. Bounces you half a jump on its own. Press jump as you take off to go higher (up to 1.5× a normal jump); the earlier the press, the higher. Keep jump held and each bounce in a row goes higher still. You can jump up through a trampoline from below |
| **Red** | Danger (lava, spikes). Touch it and you restart |
| **Green** | The goal. Touch it to win |
| **Orange / yellow** | Coins. Draw dots |

## How to play

1. **Build mode:** draw the level. The camera outlines what it sees in each colour. Click the paper to move the start flag. The dotted arcs show how far and high the character can jump, and how high trampolines can bounce with and without a jump.
2. Press **Play** (or Enter). The level freezes and the stick figure appears.
3. **← →** (or A/D) to run, **Space / ↑ / W** to jump. Hold jump for a higher jump. **R** restarts.
4. Reach the green goal. You have 3 lives (change this under **Tune**). Press **Build** to change the drawing and try again.

Game controllers work too: stick or d-pad to move, A to jump, Y to restart, Start to switch between Build and Play.

No camera? Try the built-in demo level, or a photo of a drawing.

## Classroom setup

1. Tape a sheet of white paper (A3 is ideal) flat on a desk, or use a mini whiteboard.
2. Mount the webcam above it, pointing straight down.
3. Use even room light. Avoid a lamp directly above (glare) or strong shadows. Matte whiteboards reflect less than glossy ones.
4. Open the site in Chrome or Edge, choose **Screen mode** and allow the camera.
5. If the preview is sideways, upside down or mirrored, use **Rotate** and **Flip** until it matches what you see looking at the paper.
6. Press **Lock colours**, then click the four corners of the drawing area.
7. Press **Start**. The setup is remembered for next time (**Use last setup**).

Thick markers work best; pencil is ignored on purpose.

## Class levels

Open **📚 Class levels** from the start screen.

- **Save from the camera:** while building, press **💾 Save** and type a name (e.g. the student's name). Each level keeps the drawing and its start flag.
- **Add scans:** print level sheets, let the class draw, scan the whole pile on the photocopier as one PDF (in colour), and press **＋ Add scans**. Each page becomes a level. Sheets are cropped and turned the right way up automatically using the corner squares; you just name each one. Photos work too (several at once), and plain paper without corner squares is added as a whole page.
- **Play:** choose a level, or use ◀ ▶ (PageUp / PageDown) to move through the class's levels. Clicking a new start flag is remembered for that level.
- **Share between computers:** **⬇ Export library** saves every level in one file. Put it in Google Drive or Classroom, then **⬆ Import library file** on another computer.

Levels are stored in that browser on that computer. Private/incognito windows may not keep them.

With the webcam, **🔍 Find corner marks** in setup uses the sheet's corner squares instead of clicking corners.

## Fixing colours

Lighting and marker sets vary, so the camera will sometimes get a colour wrong. Press **🎨 Fix colours**:

1. Everything the camera recognised is tinted in its game colour, so mistakes stand out.
2. Click anything that's wrong, then choose what it should be: Ground, Bouncy, Danger, Goal, Coin, or **Ignore** (for shadows, the table edge, or a marker you don't want in the game).
3. The level updates straight away. **Undo** reverses the last fix; **Reset all** goes back to the standard colours.

Fixes are colour examples, so one fix covers every mark in that marker, and any colour can be given any job (e.g. purple as bouncy). They're saved on that computer, so you only fix a room's lighting once.

**Tune** has three sliders as well:

- **Black ink:** raise if black lines are missed, lower if shadows become ground.
- **Colour match:** raise if coloured marks are being ignored, lower if unrelated colours are being picked up.
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
| `js/library.js` | Class levels saved in the browser (IndexedDB), export and import |
| `js/importer.js` | Reads PDFs (pdf.js) and photos, crops and straightens each page |
| `js/markers.js` | Finds the level sheet's corner squares |
| `js/main.js` | Screens, setup, controls and the game loop |
| `js/marble/` | The earlier marble-run prototype, parked for a possible physics mode |

Everything runs in the browser. There is no server and nothing leaves the computer. PDF reading uses [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), included in `lib/pdfjs/`.

## Hosting

Plain HTML/JS with no build step. Publish with **Settings → Pages → Deploy from a branch → `main` / root**. GitHub Pages serves over HTTPS, which browsers require for camera access.

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
