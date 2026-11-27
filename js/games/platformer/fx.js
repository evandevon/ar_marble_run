// What each platformer event looks and sounds like.
import { PLAYER } from './physics.js';

export function playEvent(e, fx, sfx) {
  switch (e.type) {
    case 'jump':
      fx.burst(e.x, e.y, { count: 8, speed: 2, colour: '#c9c2b4', angle: 0, spread: Math.PI, gravity: -0.02, life: 22, size: 4 });
      sfx.play('jump');
      break;
    case 'land':
      if (e.impact > 5) {
        const n = Math.min(16, Math.round(e.impact * 1.2));
        fx.burst(e.x - 4, e.y, { count: n / 2, speed: e.impact / 4, colour: '#c9c2b4', angle: Math.PI, spread: 0.7, gravity: -0.01, life: 24, size: 4 });
        fx.burst(e.x + 4, e.y, { count: n / 2, speed: e.impact / 4, colour: '#c9c2b4', angle: 0, spread: 0.7, gravity: -0.01, life: 24, size: 4 });
        sfx.play('land');
      }
      break;
    case 'dust':
      fx.burst(e.x, e.y - 2, { count: 1, speed: 0.8, colour: '#d6d0c4', angle: -Math.PI / 2, spread: 1.5, gravity: -0.02, life: 18, size: 3.5 });
      break;
    case 'bounce':
      fx.ring(e.x, e.y, '#3a7bff', 46);
      fx.burst(e.x, e.y, { count: 14, speed: 4, colour: ['#3a7bff', '#9cc0ff', '#fff'], angle: -Math.PI / 2, spread: 2.2, life: 28 });
      sfx.play('bounce');
      break;
    case 'boost': {
      const n = Math.round(6 + e.power * 18);
      fx.ring(e.x, e.y, '#9cc0ff', 20 + e.power * 30);
      fx.burst(e.x, e.y, { count: n, speed: 2 + e.power * 4, colour: ['#3a7bff', '#9cc0ff', '#ffffff'], angle: Math.PI / 2, spread: 1.6, life: 26, shape: 'star', size: 3.5 });
      if (e.ratio > PLAYER.bounceMax + 0.01) fx.text(e.x, e.y - 50, 'HIGHER!', '#3a7bff');
      else if (e.power > 0.8) fx.text(e.x, e.y - 50, 'SUPER!', '#3a7bff');
      sfx.play('boost', e.ratio ? e.ratio / PLAYER.bounceMax : e.power);
      break;
    }
    case 'bonk':
      fx.burst(e.x, e.y, { count: 5, speed: 2, colour: '#fff', angle: Math.PI / 2, spread: 2, life: 15 });
      break;
    case 'coin':
      fx.ring(e.x, e.y, '#ffb703', 34);
      fx.burst(e.x, e.y, { count: 14, speed: 3.5, colour: ['#ffb703', '#ffe08a', '#fff'], gravity: 0.05, life: 30, shape: 'star', size: 4 });
      fx.text(e.x, e.y - 18, '+1');
      sfx.play('coin');
      break;
    case 'die':
      fx.burst(e.x, e.y, { count: 26, speed: 5, colour: e.fell ? ['#e0157f', '#fff'] : ['#ff3b30', '#ff9f0a', '#e0157f'], life: 40, size: 4 });
      fx.ring(e.x, e.y, '#ff3b30', 60);
      sfx.play('die');
      break;
    case 'spawn':
      fx.ring(e.x, e.y - 20, '#e0157f', 40);
      fx.burst(e.x, e.y - 20, { count: 12, speed: 2.5, colour: ['#e0157f', '#fff'], gravity: 0, life: 24 });
      break;
    case 'gameover':
      sfx.play('gameover');
      break;
    case 'win':
      for (let i = 0; i < 4; i++) {
        fx.burst(e.x, e.y, { count: 30, speed: 7 + i, colour: ['#2ecc71', '#ffb703', '#3a7bff', '#e0157f', '#fff'], gravity: 0.12, life: 90, shape: 'confetti', size: 5, spread: 1.6 });
      }
      fx.ring(e.x, e.y, '#2ecc71', 90);
      sfx.play('win');
      break;
  }
}
