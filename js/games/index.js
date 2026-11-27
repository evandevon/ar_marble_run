// The games. Each one is a module in its own folder; everything else (camera,
// setup, colours, Fix colours, class levels, scans, controls) is shared.
//
// A game module is an object with:
//
//   id, name, icon, tagline      shown on the start screen
//   colours                      what each marker colour means in this game,
//                                e.g. { black: 'Walls', red: 'Danger' }. Leave a colour out to ignore it.
//   buildHint, playHint          one-line hints shown in the toolbar
//   usesStart, defaultStart      whether clicking the paper places a start point
//   settings                     game options shown under Tune:
//                                [{ id, label, value, options: [[value, label], …] }]
//   makeDemo()                   -> { canvas, corners, start }: a demo drawing to try without a camera
//   guessStart(det)              -> { x, y }: a sensible start point for a scanned level
//   checkLevel(det)              -> a message to show when Play is pressed, or null
//   drawBuild(ctx, { det, start, now })     build-mode guides
//   create({ det, start, settings, W, H })  -> a play session:
//       state                    'playing' | 'won' | 'over' (anything else counts as playing)
//       update(input, fx, sfx)   one 1/60 s step. input is from core/input.js;
//                                fx (particles) and sfx (sounds) are from core/effects.js
//       draw(ctx, { det, now })  draw the game over the paper
//       hud()                    -> list of short status strings
//       restart()
//       endCard()                -> { won, title, stats, retry }
//
// The game world is always the flattened paper: 1000 x 707 "paper pixels".

import platformer from './platformer/index.js';

export const GAMES = [platformer];

// Planned games, shown on the start screen as "coming soon".
export const COMING_SOON = [
  { id: 'racer', name: 'Racer', icon: '🏎️', tagline: 'Draw a track (and your own car) and race it top-down.' },
  { id: 'pinball', name: 'Pinball', icon: '🪀', tagline: 'Draw bumpers and ramps; A and B are the flippers.' },
  { id: 'maze', name: 'Maze chase', icon: '👻', tagline: 'Draw a maze, collect the dots and dodge the chasers.' },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || GAMES[0];
}
