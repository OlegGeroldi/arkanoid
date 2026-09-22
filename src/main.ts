import { App } from './app';
import { startScene } from './ui/start';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
if (!canvas || !overlay) throw new Error('index.html is missing #stage or #overlay');

const app = new App(canvas, overlay);
app.setScene(startScene);
app.start();

declare global {
  interface Window {
    neonoid?: App;
  }
}
window.neonoid = app;
