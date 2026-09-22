import './ui/show.css';
import { App } from './app';
import { startScene } from './ui/start';
import { playerShowScene } from './game/player';
import { tvShowScene } from './game/tv';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
if (!canvas || !overlay) throw new Error('index.html is missing #stage or #overlay');

const app = new App(canvas, overlay);
const role = new URLSearchParams(location.search).get('role');
app.setScene(role === 'tv' ? tvShowScene : role === 'player' ? playerShowScene : startScene);
app.start();

declare global {
  interface Window {
    neonoid?: App;
  }
}
window.neonoid = app;
