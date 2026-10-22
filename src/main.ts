import './style.css';
import {
  AUTONOMY, DAD_RESOLVE_SECONDS, TANK_GALLONS, TOW_SECONDS, TRIP_LENGTH, UPGRADES,
  advance, autonomyLevel, buy, canBuy, canBuyCoffee, catchUp, coffee, coffeeCost, crashKind, currentLandmark,
  currentSpeed, deserialize, formatCash, formatNumber, gasPrice, honk, hurryTow, income, isMaxed, level,
  missingRequirements, newGame, nextLandmark, resolveTakeover, serialize, stateAt, stopReason, takeoverKind,
  upgradeCost, viewers, type GameState, type UpgradeKind,
  LANDMARKS, STATES, daylight, hourOf, isNight, regionAt, DAY, arrived, hint, tripSummary,
} from './game';
import { isMuted, setMuted, sfx, unlockAudio } from './sound';
import { buildStrip, type Strip } from './map/strip';
import { createMapView } from './scene/mapScene';
import { sensorCones } from './perception';

const SAVE_KEY = 'idle-driver-save';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function load(): GameState {
  let raw: string | null = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { /* storage blocked */ }
  return deserialize(raw, Date.now());
}

function save() {
  try { localStorage.setItem(SAVE_KEY, serialize(state)); } catch { /* storage blocked */ }
}

let state = load();

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Catch up on time away and show what happened if it was a while. */
function welcomeBack() {
  const before = state;
  const result = catchUp(state, Date.now());
  state = result.state;
  if (result.seconds <= 60) return;
  const li = (text: string) => { const el = document.createElement('li'); el.textContent = text; return el; };
  $('away-list').replaceChildren(
    li(`⏱️ ${duration(result.seconds)} away`),
    li(`🚙 Drove ${formatNumber(state.odometer - before.odometer)} miles`),
    li(`💵 The stream earned ${formatCash(state.stats.earned - before.stats.earned)}`),
    li(`⛽ Burned ${(state.stats.gallons - before.stats.gallons).toFixed(1)} gallons (${formatCash(state.stats.fuelSpent - before.stats.fuelSpent)} at the pump)`),
  );
  $('away-stop').textContent = stopText(state, true);
  const dialog = $<HTMLDialogElement>('away');
  if (!dialog.open) dialog.showModal();
}

/** Why the car is stopped, in words. */
function stopText(s: GameState, away = false): string {
  const k = takeoverKind(s), c = crashKind(s);
  switch (stopReason(s)) {
    case 'crash': return `${c!.emoji}💥 ${c!.name}. ${away ? 'The tow truck is waiting for you.' : ''}`;
    case 'takeover': return `${k!.emoji} Stopped at a ${k!.name.toLowerCase()}, waiting for your help.`;
    case 'refuel': return `⛽ Filling up… ${Math.ceil(s.refuel!.left)}s`;
    case 'gas': return `⛽ Out of gas. Waiting for the stream to earn ${formatCash(gasPrice(s) * 0.5)}…`;
    case 'arrived': return '🏔️ You made it to the mountains!';
    default: return away ? '✅ Still rolling.' : '';
  }
}

// The route strip: drawn once the route's overview line has loaded.
const SVG = 'http://www.w3.org/2000/svg';
let strip: Strip | undefined;
const stripEl = $('strip') as unknown as SVGSVGElement;
const svg = (tag: string, attrs: Record<string, string | number>, parent: Element = stripEl) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent.appendChild(el);
  return el;
};
let driven: SVGElement | undefined, carDot: SVGElement | undefined;
fetch(new URL('map/route.json', document.baseURI))
  .then((r) => r.json())
  .then((route: { overview: [number, number][] }) => {
    strip = buildStrip(route.overview, TRIP_LENGTH, 360, 115, 14);
    svg('path', { d: strip.path, class: 'route', pathLength: 1 });
    driven = svg('path', { d: strip.path, class: 'driven', pathLength: 1, 'stroke-dasharray': '0 2' });
    for (const st of STATES.slice(1)) {
      const [x, y] = strip.at(st.at);
      svg('circle', { cx: x, cy: y, r: 1.6, class: 'border' });
    }
    for (const l of LANDMARKS.filter((x) => x.kind === 'city')) {
      const [x, y] = strip.at(l.at);
      svg('circle', { cx: x, cy: y, r: 2.6, class: 'city' });
    }
    const [sx, sy] = strip.at(0), [ex, ey] = strip.at(TRIP_LENGTH);
    svg('text', { x: sx - 4, y: sy + 12, class: 'tag', 'text-anchor': 'end' }).textContent = 'Orlando';
    svg('text', { x: ex + 4, y: ey - 6, class: 'tag' }).textContent = 'Rockies 🏔️';
    carDot = svg('circle', { r: 5, class: 'car' });
  })
  .catch(() => { /* the strip is optional */ });

/** Pops a short message over the view. */
let toastTimer = 0;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.hidden = true; }, 4500);
}
let nextName = nextLandmark(state)?.name;

function clockText(s: GameState): string {
  const h = hourOf(s), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  const h12 = ((hh + 11) % 12) + 1;
  return `${isNight(s) ? '🌙' : '☀️'} ${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'} · day ${Math.floor(s.clock / DAY) + 1}`;
}

// ?seed=123 fixes the traffic so screenshots are reproducible; ?mile=430 shows a spot on the route.
const params = new URLSearchParams(location.search);
const mileParam = params.get('mile');
const roadScene = createMapView($('view'), {
  seed: Number(params.get('seed')) || Math.floor(Math.random() * 1e9),
  mile: mileParam === null ? undefined : Number(mileParam),
});

// Build upgrade buttons once, grouped by kind into the Car and Stream tabs; update text each frame.
const GROUPS: [UpgradeKind, string, string][] = [
  ['sensor', 'Sensors', 'upgrades-car'], ['feature', 'Driving features', 'upgrades-car'], ['comfort', 'Comfort', 'upgrades-car'],
  ['stream', 'Stream gear', 'upgrades-stream'],
];
const upgradeButtons = GROUPS.flatMap(([kind, title, parent]) => {
  const el = $(parent);
  const h = document.createElement('h2');
  h.textContent = title;
  el.appendChild(h);
  return UPGRADES.filter((u) => u.kind === kind).map((u) => {
    const btn = document.createElement('button');
    btn.className = 'upgrade';
    btn.innerHTML = `<span><span class="name"></span><br><span class="desc"></span></span><span class="cost"></span>`;
    btn.addEventListener('click', () => {
      const before = autonomyLevel(state.levels), next = buy(state, u.id);
      if (next !== state) (autonomyLevel(next.levels) > before ? sfx.levelUp : sfx.buy)();
      state = next; save(); render();
    });
    el.appendChild(btn);
    return { u, btn, name: btn.querySelector('.name')!, desc: btn.querySelector('.desc')!, cost: btn.querySelector('.cost')! };
  });
});

function showTab(tab: 'car' | 'stream') {
  for (const t of ['car', 'stream'] as const) {
    $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
    $(`upgrades-${t}`).hidden = t !== tab;
  }
}
$('tab-car').addEventListener('click', () => showTab('car'));
$('tab-stream').addEventListener('click', () => showTab('stream'));

const takeoverBtn = $<HTMLButtonElement>('takeover');
takeoverBtn.addEventListener('click', () => { state = resolveTakeover(state); save(); render(); });
const crashBtn = $<HTMLButtonElement>('crash');
crashBtn.addEventListener('click', () => { state = hurryTow(state); save(); render(); });
const coffeeBtn = $<HTMLButtonElement>('coffee');
coffeeBtn.addEventListener('click', () => { state = coffee(state); save(); render(); });
$('honk').addEventListener('click', () => { sfx.honk(); state = honk(state); render(); });
function newTrip() { state = newGame(Date.now()); endingShown = false; nextName = nextLandmark(state)?.name; save(); render(); }
$('reset').addEventListener('click', () => {
  if (confirm('Start the trip over from Orlando?')) newTrip();
});
$('new-trip').addEventListener('click', newTrip);
document.addEventListener('pointerdown', unlockAudio);
const muteBtn = $('mute');
const showMute = () => { muteBtn.textContent = isMuted() ? '🔇 Sound off' : '🔊 Sound on'; };
muteBtn.addEventListener('click', () => { setMuted(!isMuted()); showMute(); });
showMute();

// The ending: a summary card and the stream chat going wild.
const CHAT_NAMES = ['roadtrip_rita', 'xX_lidar_Xx', 'kansas_kev', 'dogmom42', 'autopilot_fan', 'snackattack', 'mtn_mike', 'grandma_joan', 'buc_ees_lover', 'tow_truck_ted'];
const CHAT_LINES = ['WE MADE IT 🏔️🏔️🏔️', 'that sunset tho 😭', 'GG dad', 'the dog is so happy', 'remember the corn maze crash lmao', 'best stream ever', 'F for the snacks', 'next trip: Alaska??', '🚙💨💨', 'chat we did it', 'dad finally gets a nap', 'mountains look fake they are so pretty', 'no more Kansas 🌾', 'the car drove itself the whole last day!!', 'subscribed 🔔'];
let endingShown = false, chatTimer = 0, chatN = 0;
function showEnding() {
  endingShown = true;
  const rows = tripSummary(state);
  $('summary').replaceChildren(...rows.map(([emoji, k, v], i) => {
    const li = document.createElement('li');
    if (i === rows.length - 1) li.className = 'wide';
    li.innerHTML = `<span class="k"></span><span class="v"></span>`;
    li.querySelector('.k')!.textContent = `${emoji} ${k}`;
    li.querySelector('.v')!.textContent = v;
    return li;
  }));
  $('chat').replaceChildren();
  clearInterval(chatTimer);
  const addChat = () => {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> <span></span>';
    li.querySelector('b')!.textContent = CHAT_NAMES[(chatN * 7) % CHAT_NAMES.length];
    li.querySelector('span')!.textContent = CHAT_LINES[chatN % CHAT_LINES.length];
    chatN++;
    const list = $('chat');
    list.appendChild(li);
    while (list.children.length > 7) list.firstElementChild!.remove();
  };
  for (let i = 0; i < 4; i++) addChat();
  chatTimer = window.setInterval(addChat, 1300);
}
$('build').textContent = `build ${__BUILD_ID__}`;

function render() {
  const done = arrived(state);
  if (done && !endingShown) showEnding();
  if (!done && endingShown) { endingShown = false; clearInterval(chatTimer); }
  $('ending').hidden = !done;
  const tip = hint(state);
  $('hint').hidden = !tip;
  if (tip) $('hint').textContent = `💡 ${tip}`;
  $('cash').textContent = formatCash(state.cash);
  $('rate').textContent = `+${formatCash(income(state) * 60)}/min`;
  $('viewers').textContent = formatNumber(viewers(state));
  const gas = $('gas');
  gas.style.width = `${((state.gas / TANK_GALLONS) * 100).toFixed(1)}%`;
  gas.style.background = state.gas < TANK_GALLONS * 0.15 ? '#e5484d' : 'var(--accent)';
  $('gas-text').textContent = `$${gasPrice(state).toFixed(2)}/gal`;
  $('speedo').textContent = done ? `🌅 Sunset · day ${Math.floor(state.clock / DAY) + 1}` : `${Math.round(currentSpeed(state))} mph · ${clockText(state)}`;

  const auto = autonomyLevel(state.levels);
  $('autonomy').textContent = `L${auto} · ${AUTONOMY[auto].name}`;
  const c = crashKind(state);
  crashBtn.hidden = !c;
  if (c) {
    crashBtn.querySelector('.what')!.textContent = `${c.emoji}💥 ${c.name}!`;
    crashBtn.querySelector('.ask')!.textContent = `Repairs ${formatCash(state.crash!.cost)} · tap to hurry the tow truck (${Math.ceil(state.crash!.left)}s)`;
    (crashBtn.querySelector('.timer') as HTMLElement).style.width = `${(100 * (state.crash!.left / TOW_SECONDS)).toFixed(1)}%`;
  }
  const k = takeoverKind(state);
  takeoverBtn.hidden = !k;
  if (k) {
    takeoverBtn.querySelector('.what')!.textContent = `${k.emoji} ${k.name}!`;
    takeoverBtn.querySelector('.ask')!.textContent = auto >= 2 ? 'Tap to take over' : 'Tap to help Dad';
    (takeoverBtn.querySelector('.timer') as HTMLElement).style.width = `${(100 * (1 - state.takeover!.waited / DAD_RESOLVE_SECONDS)).toFixed(1)}%`;
  }
  const reason = stopReason(state);
  const status = $('status');
  status.hidden = !(reason === 'refuel' || reason === 'gas');
  if (!status.hidden) status.textContent = stopText(state);

  const tired = state.tiredness;
  $('dad-face').textContent = auto >= 5 ? '💤' : tired < 0.3 ? '😀' : tired < 0.55 ? '🙂' : tired < 0.8 ? '🥱' : '😴';
  const meter = $('tired');
  meter.style.width = `${(tired * 100).toFixed(1)}%`;
  meter.style.background = tired < 0.55 ? 'var(--good)' : tired < 0.8 ? 'var(--accent)' : '#e5484d';
  $('coffee-cost').textContent = formatCash(coffeeCost(state));
  coffeeBtn.disabled = !canBuyCoffee(state);

  if (strip && driven && carDot) {
    driven.setAttribute('stroke-dasharray', `${strip.drawnShare(state.odometer)} 2`);
    const [x, y] = strip.at(state.odometer);
    carDot.setAttribute('cx', x.toFixed(1));
    carDot.setAttribute('cy', y.toFixed(1));
  }
  const region = regionAt(state.odometer);
  const mul = region.viewers * (isNight(state) ? 0.85 : 1);
  $('landmark').textContent = `📍 Mile ${Math.floor(state.odometer).toLocaleString()} of ${Math.round(TRIP_LENGTH).toLocaleString()} · ${stateAt(state.odometer).code} · ${region.name} (viewers ×${mul.toFixed(2)})`;
  const next = nextLandmark(state);
  $('next').textContent = next
    ? `Next: ${next.emoji} ${next.name} in ${formatNumber(next.at - state.odometer)} miles · last: ${currentLandmark(state).name}`
    : 'You made it to the mountains! 🏔️';
  if (next?.name !== nextName) {
    const passed = LANDMARKS.filter((l) => l.at <= state.odometer).pop();
    if (passed && nextName !== undefined) sfx.landmark();
    if (passed && nextName !== undefined) toast(`${passed.emoji} ${passed.name}!${passed.kind === 'city' ? '' : ' Chat goes wild.'}`);
    nextName = next?.name;
  }
  const where = roadScene.place();
  if (where) {
    const toNext = where.next ? ` · ${where.next.name} in ${formatNumber((where.next.s - where.s) / 1609.344)} mi` : '';
    $('place').textContent = `Near ${where.prev}${toNext}`;
  }
  for (const b of upgradeButtons) {
    const lv = level(state, b.u.id);
    const missing = missingRequirements(state, b.u.id);
    const owned = isMaxed(state, b.u.id);
    b.name.textContent = b.u.max === 1 ? b.u.name : `${b.u.name} (lv ${lv})`;
    b.desc.textContent = owned || !missing.length ? b.u.description : `Needs ${missing.map(([u, n]) => (u.max === 1 ? u.name : `${u.name} lv ${n}`)).join(', ')}`;
    b.cost.textContent = owned ? 'Owned ✓' : formatCash(upgradeCost(state, b.u.id));
    b.btn.disabled = !canBuy(state, b.u.id);
    b.btn.classList.toggle('owned', owned);
    b.btn.classList.toggle('locked', missing.length > 0);
  }
}

let last = performance.now();
let lastSave = 0;
function frame(t: number) {
  const dt = Math.min((t - last) / 1000, 1);
  last = t;
  const wasStuck = !!state.takeover, wasCrashed = !!state.crash, wasHere = arrived(state);
  state = { ...advance(state, dt, { dadHelps: true }), lastTick: Date.now() };
  if (state.takeover && !wasStuck) { navigator.vibrate?.(60); sfx.takeover(); }
  if (state.crash && !wasCrashed) { navigator.vibrate?.([80, 60, 200]); sfx.crash(); }
  if (arrived(state) && !wasHere) { sfx.arrive(); window.setTimeout(() => $('ending').scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 6500); }
  roadScene.frame(Math.min(dt, 0.1), state.odometer * 1609.344, sensorCones(state.levels), autonomyLevel(state.levels),
    state.crash && { id: state.crashes, kind: state.crash.kind }, daylight(state), arrived(state));
  render();
  if (t - lastSave > 5000) { save(); lastSave = t; }
  requestAnimationFrame(frame);
}

// Catch up when returning to the tab (rAF pauses in the background).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') welcomeBack();
  else save();
});

welcomeBack();
render();
requestAnimationFrame(frame);
