import { App, type Scene } from '../app';
import {
  accountLevel,
  addProfile,
  isSuperUnlocked,
  isSkillUnlocked,
  removeProfile,
  MAX_PROFILES,
  type Profile,
} from '../core/storage';
import { SUPER_LIST, type SuperId } from '../core/supers';
import { SKILL_LIST, SKILL_SLOTS } from '../core/skills';
import { BALL_TYPE_LIST } from '../core/balls';
import { Backdrop } from '../render/backdrop';
import { button, el } from './dom';
import { music } from '../audio/music';
import { sfx } from '../audio/sfx';
import { net } from '../net/client';
import { teamQuizAdminScene } from '../game/teamQuizAdmin';
import { teamQuizDeviceScene } from '../game/teamQuizDevice';
import { teamQuizBroadcastScene } from '../game/teamQuizBroadcast';
import { teamQuizEditorScene } from '../game/teamQuizEditor';
import { TeamQuizStore } from '../game/teamQuizStore';

/** The menu is a canvas backdrop plus a DOM overlay; every screen swaps the
 *  overlay contents and leaves the animation running underneath. */
export function mainMenu(app: App): Scene {
  const backdrop = new Backdrop();
  /** Which skill slot the next pick fills, and a hook to redraw the loadout
   *  screen after a click. */
  let editingSlot = 0;
  let renderLoadout: (() => void) | null = null;

  const show = (...nodes: HTMLElement[]): void => {
    app.overlay.classList.add('interactive');
    app.overlay.replaceChildren(...nodes);
  };

  // -------------------------------------------------------------- title --

  /** The very first thing anyone sees: branding and the two ways in — start
   *  a match, or go straight to editing the trivia content. Everything else
   *  — who you are, whether the network is up — lives one tap further, on
   *  the role screen, so this one stays a clean landing page. */
  function screenTitle(): void {
    show(
      el(
        'div',
        { class: 'screen narrow', style: 'text-align:center' },
        el('h1', { class: 'logo' }, 'TEAM QUIZ'),
        el('p', { class: 'tagline' }, 'Team Arkanoid · Trivia board · Boost shop'),
        el(
          'div',
          { class: 'row', style: 'margin-top:28px;justify-content:center' },
          button('Start →', screenRole, 'btn primary'),
          button('📝 Quiz content', () => app.setScene((a) => teamQuizEditorScene(a)), 'btn ghost'),
        ),
      ),
    );
  }

  // ------------------------------------------------------------ role pick --

  function screenRole(): void {
    const netLabel =
      net.status === 'online' ? 'network: connected' : net.status === 'connecting' ? 'network: connecting…' : 'network: offline';

    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Who are you in this game?'),

        el(
          'div',
          { class: 'row between', style: 'margin-bottom:16px' },
          el(
            'div',
            { class: 'row', style: 'gap:8px' },
            el('span', { class: 'pill' }, `Player: ${app.profile.name}`),
            app.profile.admin ? el('span', { class: 'pill pink' }, 'admin') : null,
            el('span', { class: `pill${net.status === 'online' ? '' : ' pink'}` }, netLabel),
          ),
          button('Switch player', screenProfiles, 'btn small ghost'),
        ),

        el(
          'div',
          { class: 'grid c4' },
          modeCard(
            '🤖',
            'Host a match',
            'Register players and teams, the computer runs rounds and judges the trivia board',
            () => app.setScene((a) => teamQuizAdminScene(a, { auto: true })),
          ),
          modeCard(
            '👥',
            'Play on a team',
            'One device per team: shop and trivia, pilot screen on your turn',
            () => screenTeamQuizJoin(),
          ),
          modeCard(
            '📺',
            'Broadcast screen',
            'For a projector/TV — shows the announcement board and total score for everyone',
            () => app.setScene((a) => teamQuizBroadcastScene(a)),
          ),
          modeCard(
            '🧪',
            'Test',
            'Real multi-device dry run: pick a roster shape (solo teams, shared team, AI teammates) and it seeds itself',
            () => screenTestModes(),
          ),
        ),

        net.status === 'online'
          ? el('p', { class: 'hint', style: 'margin-top:14px' }, `Link for other devices on the network: ${net.shareUrl}`)
          : el(
              'p',
              { class: 'hint', style: 'margin-top:14px' },
              "Not served from the room server. To play over LAN: run npm run build && npm run serve on one computer, everyone else opens the printed address.",
            ),

        el(
          'div',
          { class: 'row', style: 'margin-top:20px;gap:8px' },
          button('← Back', screenTitle, 'btn small ghost'),
          button('Loadout', screenLoadout, 'btn small ghost'),
          button('Sound & music', screenAudio, 'btn small ghost'),
          button('Controls & rules', screenHelp, 'btn small ghost'),
        ),
      ),
    );
  }

  const modeCard = (icon: string, title: string, desc: string, onClick: () => void): HTMLElement =>
    el(
      'div',
      { class: 'card', onclick: onClick },
      el('div', { class: 'title' }, el('span', { class: 'icon' }, icon), title),
      el('div', { class: 'desc' }, desc),
    );

  // ----------------------------------------------------------- loadout --

  function screenLoadout(): void {
    const render = (): void => {
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, 'Loadout'),
          el(
            'p',
            { class: 'hint' },
            'Your super and two active skills carry into any pilot role you play.',
          ),
          el('h3', {}, 'Super'),
          superPicker(app.profile.favouriteSuper, (id) => {
            app.saveProfile((p) => (p.favouriteSuper = id));
            sfx.play('ui');
            render();
          }),
          el('h3', { style: 'margin-top:16px' }, 'Active skills'),
          el('p', { class: 'hint', style: 'margin-top:0' }, 'Click a skill to slot or unslot it.'),
          skillPicker(),
          el('div', { class: 'row', style: 'margin-top:18px' }, button('Back', screenRole, 'btn primary')),
        ),
      );
    };
    renderLoadout = render;
    render();
  }

  function superPicker(current: SuperId, onPick: (id: SuperId) => void): HTMLElement {
    const grid = el('div', { class: 'grid c2' });
    for (const def of SUPER_LIST) {
      const locked = !isSuperUnlocked(app.profile, def.id);
      grid.append(
        el(
          'div',
          {
            class: `card${def.id === current ? ' selected' : ''}${locked ? ' locked' : ''}`,
            onclick: () => {
              if (locked) return;
              onPick(def.id);
            },
          },
          el(
            'div',
            { class: 'title', style: `color:${def.color}` },
            el('span', { class: 'icon' }, def.icon),
            def.name,
            locked ? el('span', { class: 'pill' }, `lvl ${def.unlockLevel}`) : null,
          ),
          el('div', { class: 'desc' }, def.desc),
        ),
      );
    }
    return grid;
  }

  /** Two slots; clicking a skill puts it in the slot being edited. */
  function skillPicker(): HTMLElement {
    const equipped = app.profile.skills;
    const grid = el('div', { class: 'grid c3' });

    for (const def of SKILL_LIST) {
      const locked = !isSkillUnlocked(app.profile, def.id);
      const slot = equipped.indexOf(def.id);
      grid.append(
        el(
          'div',
          {
            class: `card${slot >= 0 ? ' selected' : ''}${locked ? ' locked' : ''}`,
            onclick: () => {
              if (locked) return;
              const next = [...app.profile.skills];
              if (slot >= 0) next[slot] = null;
              else {
                const free = next.findIndex((s) => s === null);
                next[free >= 0 ? free : editingSlot] = def.id;
                editingSlot = (editingSlot + 1) % SKILL_SLOTS;
              }
              app.saveProfile((p) => (p.skills = next));
              sfx.play('ui');
              renderLoadout?.();
            },
          },
          el(
            'div',
            { class: 'title', style: `color:${def.color}` },
            el('span', { class: 'icon' }, def.icon),
            def.name,
            slot >= 0 ? el('span', { class: 'pill' }, slot === 0 ? 'Q' : 'E') : null,
            locked ? el('span', { class: 'pill' }, `lvl ${def.unlockLevel}`) : null,
          ),
          el('div', { class: 'desc' }, def.desc),
          el('div', { class: 'desc', style: 'opacity:.75' }, `Cooldown ${def.cooldown}s`),
        ),
      );
    }
    return grid;
  }

  // --------------------------------------------------------------- profiles --

  function profileCard(p: Profile, isAdminViewer: boolean): HTMLElement {
    const acc = accountLevel(p);
    const active = p.id === app.store.activeId;

    return el(
      'div',
      { class: `card${active ? ' selected' : ''}` },
      el(
        'div',
        { class: 'title', onclick: () => { app.switchProfile(p.id); sfx.play('ui'); screenRole(); } },
        el('span', { class: 'icon' }, p.admin ? '★' : '●'),
        p.name,
        active ? el('span', { class: 'pill' }, 'active') : null,
      ),
      el('div', { class: 'desc' }, `Level ${acc.level} · XP ${Math.round(p.totalXp)}`),
      isAdminViewer
        ? el(
            'div',
            { class: 'row', style: 'gap:6px;margin-top:8px' },
            el('input', {
              type: 'text',
              value: p.name,
              style: 'max-width:150px',
              onchange: (e: Event) => {
                const name = (e.target as HTMLInputElement).value.trim().slice(0, 24);
                if (!name) return;
                app.commitStore(() => (p.name = name));
                screenProfiles();
              },
            }),
            button(
              'Reset',
              () => {
                app.commitStore(() => {
                  p.totalXp = 0;
                  p.bestScore = 0;
                  p.runs = 0;
                });
                screenProfiles();
              },
              'btn small',
            ),
            app.store.players.length > 1
              ? button(
                  'Delete',
                  () => {
                    removeProfile(app.store, p.id);
                    screenProfiles();
                  },
                  'btn small danger',
                )
              : null,
          )
        : null,
    );
  }

  function screenProfiles(): void {
    const viewerIsAdmin = app.profile.admin;
    const nameInput = el('input', { type: 'text', placeholder: 'Player name', style: 'max-width:220px' });

    const create = (): void => {
      const created = addProfile(app.store, nameInput.value || `Player ${app.store.players.length + 1}`);
      if (!created) return;
      sfx.play('powerup');
      screenProfiles();
    };

    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Players'),
        el('p', { class: 'hint' }, `Up to ${MAX_PROFILES} profiles, each with its own level, XP and supers.`),

        el('div', { class: 'grid c2', style: 'margin-top:14px' }, ...app.store.players.map((p) => profileCard(p, viewerIsAdmin))),

        app.store.players.length < MAX_PROFILES
          ? el(
              'div',
              { class: 'row', style: 'margin-top:16px' },
              nameInput,
              button('Create player', create, 'btn small primary'),
            )
          : el('p', { class: 'hint', style: 'margin-top:16px' }, `Reached the ${MAX_PROFILES}-profile limit.`),

        el(
          'div',
          { class: 'row', style: 'margin-top:20px' },
          button('Back', screenRole, 'btn ghost'),
          !viewerIsAdmin
            ? el('span', { class: 'hint' }, 'Renaming and deleting need the admin profile.')
            : null,
        ),
      ),
    );
  }

  // ------------------------------------------------------------------ audio --

  function screenAudio(): void {
    const render = (): void => {
      const p = app.profile;
      const track = music.nowPlaying;

      show(
        el(
          'div',
          { class: 'screen narrow' },
          el('h2', {}, 'Sound & music'),
          el(
            'p',
            { class: 'hint' },
            'Sound effects are synthesized live — no files, no load delay. Music is bring-your-own-tracks.',
          ),

          el(
            'label',
            { class: 'field', style: 'margin-top:14px' },
            `Effects: ${Math.round(p.sfxVolume * 100)}%`,
            el('input', {
              type: 'range',
              min: '0',
              max: '100',
              value: String(Math.round(p.sfxVolume * 100)),
              oninput: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value) / 100;
                app.saveProfile((prof) => (prof.sfxVolume = v));
                sfx.setVolume(v);
              },
              onchange: () => {
                sfx.play('powerup');
                render();
              },
            }),
          ),

          el(
            'label',
            { class: 'field' },
            `Music: ${Math.round(p.musicVolume * 100)}%`,
            el('input', {
              type: 'range',
              min: '0',
              max: '100',
              value: String(Math.round(p.musicVolume * 100)),
              oninput: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value) / 100;
                app.saveProfile((prof) => (prof.musicVolume = v));
                music.setVolume(v);
              },
              onchange: render,
            }),
          ),

          el(
            'div',
            { class: 'row', style: 'margin-top:10px' },
            button(
              p.musicOn ? 'Music on' : 'Music off',
              () => {
                const on = !app.profile.musicOn;
                app.saveProfile((prof) => (prof.musicOn = on));
                music.setEnabled(on);
                render();
              },
              `btn small${p.musicOn ? ' primary' : ''}`,
            ),
            music.available ? button('Next track', () => { music.next(); setTimeout(render, 300); }, 'btn small') : null,
          ),

          el(
            'p',
            { class: 'hint', style: 'margin-top:14px' },
            music.available
              ? `Now playing: ${track?.title ?? track?.file ?? '—'}`
              : 'No tracks yet. Drop files in public/music and list them in public/music/manifest.json — instructions in README.md.',
          ),
          el(
            'pre',
            { class: 'code' },
            '{\n  "tracks": [\n    { "file": "menu.mp3", "title": "Standby", "scene": "menu" },\n    { "file": "drive.mp3", "title": "Neon Drive", "scene": "game" }\n  ]\n}',
          ),

          el('div', { class: 'row', style: 'margin-top:18px' }, button('Back', screenRole, 'btn primary')),
        ),
      );
    };
    render();
  }

  // ------------------------------------------------------------------ help --

  function screenHelp(): void {
    show(
      el(
        'div',
        { class: 'screen' },
        el('h2', {}, 'Controls & rules'),
        el(
          'div',
          { class: 'grid c2' },
          el(
            'div',
            {},
            el('h3', {}, 'Pilot controls'),
            el(
              'table',
              { class: 'keys' },
              row('Mouse / A · D / ← · →', 'move paddle'),
              row('Space / W', 'launch ball, fire laser'),
              row('Shift', 'super (once the gauge is full)'),
              row('Q · E', 'active skills'),
            ),
            el('h3', { style: 'margin-top:16px' }, 'Round'),
            el(
              'p',
              { class: 'hint' },
              'All teams play their level at once. First to clear gets +1, everyone else −1. Pilot rotates each round so everyone gets a turn.',
            ),
          ),
          el(
            'div',
            {},
            el('h3', {}, 'How XP works'),
            el(
              'p',
              { class: 'hint' },
              "Every brick broken earns XP. A hit streak without losing the ball raises the multiplier. A round's XP banks to your profile and unlocks new supers and skills over time — set them up in Loadout.",
            ),
            el('h3', { style: 'margin-top:14px' }, 'Team shop'),
            el(
              'p',
              { class: 'hint' },
              'Credits come from trivia cards — the host awards them by hand. Spend them on a life, a shield, a super, more time, or sabotaging a rival — live, mid-round, while the pilot plays.',
            ),
            el('h3', { style: 'margin-top:14px' }, 'Elemental balls'),
            el(
              'div',
              { class: 'col', style: 'gap:4px' },
              ...BALL_TYPE_LIST.filter((b) => b.id !== 'normal').map((b) =>
                el('p', { class: 'hint', style: 'margin:0' }, el('b', { style: `color:${b.color}` }, `${b.name}: `), b.desc),
              ),
            ),
          ),
        ),
        el('div', { class: 'row', style: 'margin-top:22px' }, button('Back', screenRole, 'btn primary')),
      ),
    );
  }

  const row = (k: string, v: string): HTMLElement => el('tr', {}, el('td', {}, k), el('td', {}, v));

  // -------------------------------------------------------------- team quiz --

  let joinStore: TeamQuizStore | null = null;
  let joinUnsub: (() => void) | null = null;

  function closeJoinStore(): void {
    joinUnsub?.();
    joinUnsub = null;
    joinStore?.dispose();
    joinStore = null;
  }

  function screenTeamQuizJoin(): void {
    closeJoinStore();
    joinStore = new TeamQuizStore('public');
    const store = joinStore;

    const enterDevice = (teamId: string): void => {
      closeJoinStore();
      app.setScene((a) => teamQuizDeviceScene(a, { teamId, levels: a.raceLevels(), superId: a.profile.favouriteSuper }));
    };

    const renderJoin = (): void => {
      show(
        el(
          'div',
          { class: 'screen' },
          el('h2', {}, 'Pick your team'),
          !store.roster.length
            ? el('p', { class: 'hint' }, 'No teams yet — ask the host to create some.')
            : null,
          el(
            'div',
            { class: 'grid c3' },
            ...store.roster.map((team) =>
              el(
                'div',
                { class: 'card', style: `border-color:${team.color}44` },
                el('div', { class: 'title', style: `color:${team.color}` }, team.name),
                el('div', { class: 'desc' }, team.members.length ? team.members.map((m) => m.name).join(', ') : 'Nobody on this team yet'),
                button('Join', () => enterDevice(team.id), 'btn small primary'),
              ),
            ),
          ),
          el(
            'div',
            { class: 'row', style: 'margin-top:16px' },
            button(
              'Back',
              () => {
                closeJoinStore();
                screenRole();
              },
              'btn ghost',
            ),
          ),
        ),
      );
    };

    renderJoin();
    joinUnsub = store.subscribe(renderJoin);
  }

  // ---------------------------------------------------------------- test --

  interface TestMemberSpec {
    name: string;
    /** Roster-level flag (`core/teamRace.ts`'s `TeamMember.ai`) — whichever
     *  device ends up holding this team auto-races this member's turns,
     *  regardless of how that device connected (URL shortcut or a normal
     *  join), since it's read off the shared roster rather than a per-tab
     *  option. */
    ai?: boolean;
  }
  interface TestTeamSpec {
    name: string;
    members: TestMemberSpec[];
  }

  /** Real multi-device dry runs — this seeds the roster shape and starts
   *  the match, then everyone else just joins normally from their own
   *  device via the printed LAN link. Nothing here
   *  opens a tab on anyone else's behalf except for a team with *no* human
   *  member at all, which needs some tab open somewhere to actually run. */
  function screenTestModes(): void {
    show(
      el(
        'div',
        { class: 'screen narrow', style: 'text-align:center' },
        el('h2', {}, '🧪 Test'),
        el('p', { class: 'hint' }, 'A real dry run across real devices — pick a roster shape, everyone else joins normally.'),
        el(
          'div',
          { class: 'col', style: 'gap:10px;margin-top:14px' },
          button(
            '🙋 Everyone for themselves',
            () =>
              runTest(
                [
                  { name: 'Team 1', members: [{ name: 'Player 1' }] },
                  { name: 'Team 2', members: [{ name: 'Player 2' }] },
                ],
                'Team 1',
              ),
            'btn',
          ),
          button(
            '🤝 We share one team',
            () =>
              runTest(
                [
                  { name: 'Us', members: [{ name: 'Player 1' }, { name: 'Player 2' }] },
                  { name: 'Computer', members: [{ name: 'AI 1', ai: true }, { name: 'AI 2', ai: true }] },
                ],
                'Us',
              ),
            'btn',
          ),
          button(
            '🤖 Different teams, AI teammates',
            () =>
              runTest(
                [
                  { name: 'Team 1', members: [{ name: 'Player 1' }, { name: 'AI teammate', ai: true }] },
                  { name: 'Team 2', members: [{ name: 'Player 2' }, { name: 'AI teammate', ai: true }] },
                ],
                'Team 1',
              ),
            'btn',
          ),
          button(
            '🕹️ Solo, 4 players (3 AI)',
            () =>
              runTest(
                [
                  { name: 'Player 1', members: [{ name: 'Player 1' }] },
                  { name: 'Player 2', members: [{ name: 'Player 2', ai: true }] },
                  { name: 'Player 3', members: [{ name: 'Player 3', ai: true }] },
                  { name: 'Player 4', members: [{ name: 'Player 4', ai: true }] },
                ],
                'Player 1',
              ),
            'btn',
          ),
        ),
        el('div', { class: 'row', style: 'margin-top:16px;justify-content:center' }, button('Back', screenRole, 'btn small ghost')),
      ),
    );

    function runTest(specs: TestTeamSpec[], playAsName: string): void {
      closeJoinStore();
      joinStore = new TeamQuizStore('admin');
      const store = joinStore;

      show(
        el(
          'div',
          { class: 'screen narrow', style: 'text-align:center' },
          el('h2', {}, '🧪 Test'),
          el('p', { class: 'hint' }, 'Setting up teams…'),
        ),
      );

      const waitForRosterSize = (n: number): Promise<void> =>
        new Promise((resolve) => {
          const check = (): void => {
            if (store.roster.length < n) return;
            unsub();
            resolve();
          };
          const unsub = store.subscribe(check);
          check();
        });

      async function seed(): Promise<void> {
        const teamIds: string[] = [];
        for (const spec of specs) {
          store.net.addTeam(spec.name);
          await waitForRosterSize(teamIds.length + 1);
          const teamId = store.roster[teamIds.length].id;
          teamIds.push(teamId);
          for (const member of spec.members) store.net.addMember(teamId, member.name, member.ai);
        }
        store.net.startMatch(50);
        showReady(teamIds);
      }

      function showReady(teamIds: string[]): void {
        const openTab = (query: string): void => {
          window.open(`${location.pathname}?${query}`, '_blank');
        };
        const playAsIndex = specs.findIndex((s) => s.name === playAsName);
        const playAsId = teamIds[playAsIndex];
        const others = specs.map((spec, i) => ({ spec, id: teamIds[i] })).filter((_, i) => i !== playAsIndex);
        const aiOnlyTeams = others.filter(({ spec }) => spec.members.every((m) => m.ai));

        show(
          el(
            'div',
            { class: 'screen narrow', style: 'text-align:center' },
            el('h2', {}, '🧪 Test ready'),
            el('p', { class: 'hint' }, `This tab becomes ${playAsName} — play it yourself.`),
            el(
              'div',
              { class: 'row', style: 'justify-content:center;margin-top:12px' },
              button(
                `▶️ Play as ${playAsName}`,
                () => {
                  closeJoinStore();
                  app.setScene((a) => teamQuizDeviceScene(a, { teamId: playAsId, levels: a.raceLevels(), superId: a.profile.favouriteSuper }));
                },
                'btn primary large',
              ),
            ),
            others.length
              ? el(
                  'p',
                  { class: 'hint', style: 'margin-top:18px' },
                  `On the other laptop: open ${net.shareUrl}, pick "A group of us" → "Play on a team" → ${others
                    .map((o) => o.spec.name)
                    .join(' / ')}.`,
                )
              : null,
            aiOnlyTeams.length
              ? el(
                  'div',
                  {},
                  el('p', { class: 'hint', style: 'margin-top:12px' }, 'A fully-AI team needs one open tab to actually run:'),
                  el(
                    'div',
                    { class: 'col', style: 'gap:8px;align-items:center' },
                    ...aiOnlyTeams.map(({ spec, id }) =>
                      button(`🤖 Open ${spec.name} (plays itself)`, () => openTab(`role=team&team=${id}`), 'btn ghost'),
                    ),
                  ),
                )
              : null,
            el('p', { class: 'hint', style: 'margin-top:12px' }, 'Someone needs to run the trivia board and the TV:'),
            el(
              'div',
              { class: 'col', style: 'gap:8px;align-items:center' },
              button('🤖 Open auto-host', () => openTab('role=admin&auto=1'), 'btn ghost'),
              button('📺 Open TV (broadcast)', () => openTab('role=broadcast'), 'btn ghost'),
            ),
            el(
              'div',
              { class: 'row', style: 'margin-top:16px;justify-content:center' },
              button(
                'Back',
                () => {
                  closeJoinStore();
                  screenRole();
                },
                'btn small ghost',
              ),
            ),
          ),
        );
      }

      void seed();
    }
  }

  music.setScene('menu');
  screenTitle();

  return {
    update(dt) {
      backdrop.update(dt);
    },
    draw(ctx, w, h) {
      backdrop.draw(ctx, w, h);
    },
    dispose() {
      // Whatever screen we were on stops talking to the network with us.
      closeJoinStore();
      app.overlay.replaceChildren();
      app.overlay.classList.remove('interactive');
    },
  };
}
