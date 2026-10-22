import './style.css';
import {
  AUTONOMY, DAD_RESOLVE_SECONDS, TANK_GALLONS, TOW_SECONDS, TRIP_LENGTH, UPGRADES,
  advance, autonomyLevel, buy, canBuy, canBuyCoffee, catchUp, coffee, coffeeCost, crashKind, currentLandmark,
  currentSpeed, deserialize, formatCash, formatNumber, gasPrice, honk, hurryTow, income, isMaxed, level,
  missingRequirements, newGame, nextLandmark, resolveTakeover, serialize, stateAt, stopReason, takeoverKind,
  tripProgress, upgradeCost, viewers, type GameState, type UpgradeKind,
} from './game';
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
    btn.addEventListener('click', () => { state = buy(state, u.id); save(); render(); });
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
$('honk').addEventListener('click', () => { state = honk(state); render(); });
$('reset').addEventListener('click', () => {
  if (confirm('Start the trip over from Orlando?')) { state = newGame(Date.now()); save(); render(); }
});
$('build').textContent = `build ${__BUILD_ID__}`;

function render() {
  $('cash').textContent = formatCash(state.cash);
  $('rate').textContent = `+${formatCash(income(state) * 60)}/min`;
  $('viewers').textContent = formatNumber(viewers(state));
  const gas = $('gas');
  gas.style.width = `${((state.gas / TANK_GALLONS) * 100).toFixed(1)}%`;
  gas.style.background = state.gas < TANK_GALLONS * 0.15 ? '#e5484d' : 'var(--accent)';
  $('gas-text').textContent = `$${gasPrice(state).toFixed(2)}/gal`;
  $('speedo').textContent = `${Math.round(currentSpeed(state))} mph`;

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
  status.hidden = !(reason === 'refuel' || reason === 'gas' || reason === 'arrived');
  if (!status.hidden) status.textContent = stopText(state);

  const tired = state.tiredness;
  $('dad-face').textContent = auto >= 5 ? '💤' : tired < 0.3 ? '😀' : tired < 0.55 ? '🙂' : tired < 0.8 ? '🥱' : '😴';
  const meter = $('tired');
  meter.style.width = `${(tired * 100).toFixed(1)}%`;
  meter.style.background = tired < 0.55 ? 'var(--good)' : tired < 0.8 ? 'var(--accent)' : '#e5484d';
  $('coffee-cost').textContent = formatCash(coffeeCost(state));
  coffeeBtn.disabled = !canBuyCoffee(state);

  $('progress').style.width = `${(tripProgress(state) * 100).toFixed(2)}%`;
  $('landmark').textContent = `📍 Mile ${Math.floor(state.odometer).toLocaleString()} of ${Math.round(TRIP_LENGTH).toLocaleString()} · ${stateAt(state.odometer).code} · last city: ${currentLandmark(state).name}`;
  const next = nextLandmark(state);
  $('next').textContent = next
    ? `Next: ${next.name} in ${formatNumber(next.at - state.odometer)} miles`
    : 'You made it to the mountains! 🏔️';
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
  const wasStuck = !!state.takeover, wasCrashed = !!state.crash;
  state = { ...advance(state, dt, { dadHelps: true }), lastTick: Date.now() };
  if (state.takeover && !wasStuck) navigator.vibrate?.(60);
  if (state.crash && !wasCrashed) navigator.vibrate?.([80, 60, 200]);
  roadScene.frame(Math.min(dt, 0.1), state.odometer * 1609.344, sensorCones(state.levels), autonomyLevel(state.levels),
    state.crash && { id: state.crashes, kind: state.crash.kind });
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
