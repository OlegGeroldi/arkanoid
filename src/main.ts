import { App } from './app';
import { mainMenu } from './ui/menu';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
if (!canvas || !overlay) throw new Error('index.html is missing #stage or #overlay');

const app = new App(canvas, overlay);
app.setScene(mainMenu);
app.start();

// Handy while iterating on levels from the console.
declare global {
  interface Window {
    neonoid?: App;
  }
}
window.neonoid = app;
