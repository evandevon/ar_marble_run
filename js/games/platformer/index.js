// Platformer: run and jump a stick figure across the level you drew.
import { Level, Game } from './physics.js';
import { drawBuild, drawPlay, hudItems } from './draw.js';
import { playEvent } from './fx.js';
import { makeDemo } from './demo.js';

export default {
  id: 'platformer',
  name: 'Platformer',
  icon: '🏃',
  tagline: 'Run and jump a stick figure across the level you drew.',
  colours: { black: 'Ground', blue: 'Trampoline', red: 'Danger', green: 'Goal', orange: 'Coins' },
  buildHint: 'Draw, then press Play. Click the paper to move the start flag.',
  playHint: '← → run · Space or ↑ jump · R restart',
  usesStart: true,
  defaultStart: { x: 80, y: 560 },
  settings: [
    { id: 'lives', label: 'Lives', value: '3', options: [['3', '3'], ['5', '5'], ['Infinity', 'Unlimited']] },
  ],

  makeDemo,
  drawBuild,

  // A level with no start flag yet: stand on the left-most piece of ground.
  guessStart(det) {
    let best = null;
    for (const o of det.outlines) {
      if (o.type !== 'black') continue;
      const minX = Math.min(...o.points.map((p) => p.x));
      if (!best || minX < best.minX) best = { o, minX };
    }
    if (!best) return { x: 70, y: 90 };
    const x = best.minX + 22;
    const tops = best.o.points.filter((p) => Math.abs(p.x - x) < 14).map((p) => p.y);
    const y = tops.length ? Math.min(...tops) - 2 : Math.min(...best.o.points.map((p) => p.y)) - 2;
    return { x: Math.max(12, x), y: Math.max(50, y) };
  },

  // Anything worth telling the players before they start.
  checkLevel(det) {
    return det.counts.green ? null : 'No green goal yet. Draw one to win!';
  },

  create({ det, start, settings, W, H }) {
    const lives = settings.lives === 'Infinity' ? Infinity : Number(settings.lives) || 3;
    const game = new Game(new Level(det, W, H), start, lives);
    game.events.push({ type: 'spawn', x: game.player.x, y: game.player.y });
    return {
      get state() { return game.state; },
      game,
      update(input, fx, sfx) {
        game.update({
          left: input.left,
          right: input.right,
          jumpHeld: input.up || input.a || input.b,
          jumpPressed: input.upPressed || input.aPressed || input.bPressed,
        });
        for (const e of game.events) playEvent(e, fx, sfx);
        game.events.length = 0;
      },
      draw(ctx, view) { drawPlay(ctx, game, view); },
      hud() { return hudItems(game); },
      restart() { game.restart(); },
      endCard() {
        const won = game.state === 'won';
        const stats = [];
        if (won) stats.push(`Time ${game.seconds.toFixed(1)}s`);
        if (game.coinsTotal) stats.push(`Coins ${game.coinsTaken}/${game.coinsTotal}`);
        if (won) {
          if (Number.isFinite(game.maxLives)) stats.push(game.deaths ? `${game.lives} ${game.lives === 1 ? 'life' : 'lives'} left` : 'No lives lost!');
          else stats.push(game.deaths ? `${game.deaths} ${game.deaths === 1 ? 'fall' : 'falls'}` : 'First try!');
        } else {
          stats.push('Can you find a safer way?');
        }
        return {
          won,
          title: won ? 'Level complete! 🎉' : 'Out of lives!',
          stats: stats.join(' · '),
          retry: won ? 'Play again' : 'Try again',
        };
      },
    };
  },
};
