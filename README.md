# Paper Arcade

Draw a level with markers on paper (or a mini whiteboard). A webcam looking down turns the drawing into a game, played on the front screen, a tablet or a phone.

**Play it:** https://evandevon.github.io/ar_marble_run/ (add `?game=platformer` to a link to open a particular game)

## Games

| Game | Status |
|---|---|
| 🏃 **Platformer**: run and jump a stick figure across the level you drew | Ready |
| 🏎️ **Racer**: draw a track (and your own car on the level sheet) and race it top-down | Planned |
| 🪀 **Pinball**: draw bumpers and ramps; A and B are the flippers | Planned |
| 👻 **Maze chase**: draw a maze, collect the dots and dodge the chasers | Planned |

The camera only sees marker colours (black, blue, red, green, orange/yellow). Each game decides what the colours mean, and the start screen shows the key for the chosen game.

## Printable level sheet

Print **[template.html](template.html)** (landscape, A4 or A3, black and white is fine). It has a frame the exact shape of the game, a name line, the colour key, and a true-size picture of the character and its jump height. The four black corner squares let the game crop scans, photos and the webcam view automatically.

## Platformer: marker colours

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
3. **← →** (or A/D) to move, **Space / ↑ / W** to jump, hold **Shift** (or X) to run faster. Hold jump for a higher jump. **R** restarts.
4. Reach the green goal. You have 3 lives (change this under **Tune**). Press **Build** to change the drawing and try again.

**Tune → Feel** changes how quickly the character speeds up and stops: Floaty, Normal (the default) or Snappy.

### Phones and tablets

- **Touch controls** appear when you play. Put your left thumb anywhere on the left half of the screen and slide: the D-pad comes to your thumb, so there's nothing to find. Tap anywhere on the right half for the nearest button: **A** jumps and **B** runs. Up on the touch D-pad doesn't jump, because thumbs drift upwards while running. Turn the controls on or off under **Tune → Touch controls**.
- **Zoom:** on touch screens, the view zooms in and follows the character, with a mini-map of the whole level in the corner. Press **🔍** (or **V**) to switch between zoomed and the whole level, on any screen. Build mode always shows the whole page. (Zoom is off in projector mode, where the picture has to line up with the board.)
- **Using the phone as the camera:** **Screen mode** goes full screen and holds the screen sideways, so it doesn't spin round while the phone points down. (Android only. On iPhone and iPad, turn on rotation lock.) In setup, **📸 Hold picture** freezes the preview so you can set the corners without keeping perfectly still. While building, **📸 Snap** takes a still picture of the drawing (and finds the level sheet's corners again if the phone moved); **🎥 Live** goes back to the camera.
- Add the page to your home screen to play full screen.

Game controllers work too: stick or d-pad to move, A to jump, B to run, Y to restart, Start to switch between Build and Play.

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

## Projector mode

The game is projected onto the whiteboard, right on top of the drawing: the ink is the level, and the character runs along it.

1. Connect the projector and point it at the whiteboard. Extended or mirrored display both work.
2. Mount the webcam so it sees the whole projected picture (it doesn't have to be straight above).
3. Choose **Projector mode** and allow the camera. Set **Rotate** and **Flip** as in screen mode.
4. Press **📽️ Open projector window**. Drag the new window onto the projector screen and click it to fill the screen (**F** toggles full screen; double-click to leave).
5. Press **🎯 Line up**. The projector shows nine dots, one at a time, for about ten seconds. Keep the camera still and stand clear. The camera finds each dot and works out exactly where the projected picture lands, so no corner marks are needed.
6. Press **Start**. While building, the projector shows only the edges of the play area (so it doesn't confuse the camera). Press Play and the character, coins and goal glow are projected onto the board.

The main screen works as usual for the teacher: the camera view, Fix colours, Save level. Keys pressed with either window in front play the game.

If the projector window changes size, or the camera or projector is bumped, press **⚙ Setup** and **Line up** again. Line up works best with the room lights a little dimmed.

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
| V | Zoom in on the player / whole level |
| M | Sound on/off |
| F | Fullscreen |
| Esc | Back to Build |

## How it works

The code is split into a shared core and one folder per game:

| Folder / file | Job |
|---|---|
| `js/app.js` | The app shell: start screen, camera setup, scanning, class levels, Fix colours, controls, game loop |
| `js/core/camera.js` | Webcam and still-photo sources, rotate/flip |
| `js/core/homography.js` | Flattens the angled camera view into a rectangle |
| `js/core/vision.js` | Sorts every pixel into a marker colour (adjusting for uneven light), cleans edges, joins gaps |
| `js/core/colours.js` | The marker colours, clean view and build-mode outlines |
| `js/core/markers.js` | Finds the level sheet's corner squares |
| `js/core/projector.js`, `projector.html` | Projector mode: the projector window and the automatic line-up |
| `js/core/library.js` | Class levels saved in the browser (IndexedDB), export and import |
| `js/core/importer.js` | Reads PDFs (pdf.js) and photos, crops and straightens each page |
| `js/core/input.js`, `touch.js` | Keyboard, game controllers and the on-screen D-pad and A/B buttons, merged into one input |
| `js/core/effects.js`, `hud.js` | Particles, synthesised sounds, and the status panel |
| `js/games/index.js` | The list of games and the interface every game module follows |
| `js/games/platformer/` | The platformer: physics, stick figure, drawing, effects, demo level |
| `js/parked/` | The earlier marble-run physics, kept for mini golf / pinball |

### Adding a game

1. Make a folder in `js/games/` with an `index.js` that exports a game module. The comment at the top of `js/games/index.js` lists what a module provides: name and icon, what each colour means, settings, a demo drawing, build-mode guides, and a `create()` that returns the playing session.
2. Add it to `GAMES` in `js/games/index.js` (and remove it from `COMING_SOON`).

Everything else (camera, corners, Fix colours, class levels, scans, touch controls, gamepads, fullscreen) works for the new game automatically. Saved levels remember which game they were drawn for.

Everything runs in the browser. There is no server and nothing leaves the computer. PDF reading uses [pdf.js](https://mozilla.github.io/pdf.js/) (Apache 2.0), included in `lib/pdfjs/`.

## Hosting

Plain HTML/JS with no build step. Publish with **Settings → Pages → Deploy from a branch → `main` / root**. GitHub Pages serves over HTTPS, which browsers require for camera access.

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
