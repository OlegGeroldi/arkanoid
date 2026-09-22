import { App } from './app';
import { mainMenu } from './ui/menu';
import { teamQuizAdminScene } from './game/teamQuizAdmin';
import { teamQuizBroadcastScene } from './game/teamQuizBroadcast';
import { teamQuizDeviceScene } from './game/teamQuizDevice';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const overlay = document.getElementById('overlay');
if (!canvas || !overlay) throw new Error('index.html is missing #stage or #overlay');

const app = new App(canvas, overlay);

/** `?role=admin|broadcast|team` lets a tab jump straight into a team-quiz
 *  role instead of the landing menu — used by the "Demo run" menu screen to
 *  open the other roles (TV broadcast, auto-host, an unattended team) as
 *  their own tabs with one click each, rather than walking through the menu
 *  by hand in every one of them. */
const params = new URLSearchParams(location.search);
const role = params.get('role');
if (role === 'admin') {
  app.setScene((a) => teamQuizAdminScene(a, { auto: params.get('auto') === '1' }));
} else if (role === 'broadcast') {
  app.setScene((a) => teamQuizBroadcastScene(a));
} else if (role === 'team' && params.get('team')) {
  const teamId = params.get('team')!;
  const unattended = params.get('auto') === '1';
  app.setScene((a) => teamQuizDeviceScene(a, { teamId, levels: a.raceLevels(), superId: a.profile.favouriteSuper, unattended }));
} else {
  app.setScene(mainMenu);
}
app.start();

// Handy while iterating on levels from the console.
declare global {
  interface Window {
    neonoid?: App;
  }
}
window.neonoid = app;
