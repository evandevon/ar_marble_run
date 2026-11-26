# AR Marble Run

Draw ramps on paper. A webcam looking down at the paper turns your drawing into a marble run, shown on the front screen.

**Play it:** https://evandevon.github.io/ar_marble_run/

## Stage 1 (this version)

- **Screen mode:** the marble rolls over the live camera view of the paper.
- **Black lines become walls and ramps:** anything drawn in thick black marker (lines, curves, buckets, filled shapes, cut-outs) becomes solid.
- **Build / Run:** in Build mode the camera keeps scanning and outlines what it sees in blue. Press **Run** to freeze the layout and drop the marble.
- **No camera?** Use the built-in demo drawing, or a photo of a drawing.

Coming next: coloured objects (bouncy, traps, goal, boosters), automatic corner detection, and Projector mode.

## Classroom setup

1. Tape an A3 (or A4) sheet of white paper flat on a desk.
2. Mount the webcam above it, pointing straight down. A phone stand or desk lamp arm works.
3. Use even room light. Avoid a lamp directly above (glare) or strong shadows.
4. Open the site in Chrome or Edge, choose **Screen mode** and allow the camera.
5. Press **Lock colours**, then click the four corners of the paper.
6. Press **Start playing**. The setup is remembered for next time (**Use last setup**).

Thick felt markers work best. Pencil and thin pens are deliberately ignored.

## Controls

| Key / control | Action |
|---|---|
| Space or **Run / Stop** | Switch between Build and Run |
| Click the paper | Move the drop point (pink) |
| R or **Drop again** | Drop the marble again |
| C or **View** | Camera view / clean view |
| F | Fullscreen |
| **Ink** slider | How dark a line must be to count. Raise it if lines are missed, lower it if shadows appear as walls |
| **Join gaps** slider | Joins small breaks in wobbly hand-drawn lines |

## How it works

| File | Job |
|---|---|
| `js/camera.js` | Webcam, still photo and demo drawing sources |
| `js/homography.js` | Flattens the angled camera view of the paper into a rectangle |
| `js/vision.js` | Finds dark ink (adaptive to uneven light), joins gaps, traces each shape's outline |
| `js/physics.js` | Turns outlines into static walls (Matter.js) and simulates the marble |
| `js/render.js` | Draws the paper, outlines, drop point and marble |
| `js/main.js` | Screens, setup, controls and the main loop |

Everything runs in the browser. There is no server and nothing leaves the computer.

## Hosting

The site is plain HTML/JS with no build step. To publish: repo **Settings → Pages → Deploy from a branch → `main` / root**. GitHub Pages serves over HTTPS, which browsers require for camera access.

To run locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

Physics by [Matter.js](https://brm.io/matter-js/) (MIT), included in `lib/`.
