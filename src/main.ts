import './style.css';
import {
  AUTONOMY, DAD_RESOLVE_SECONDS, UPGRADES, advance, autonomyLevel, buy, canBuy, catchUp, currentLandmark,
  currentSpeed, deserialize, formatNumber, honk, isMaxed, level, missingRequirements, newGame, nextLandmark,
  resolveTakeover, serialize, takeoverKind, tripProgress, upgradeCost, type GameState, type UpgradeKind,
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

/** Catch up on time away and tell the player what happened if it was a while. */
function welcomeBack(delay = 0) {
  const before = state.odometer;
  const result = catchUp(state, Date.now());
  state = result.state;
  if (result.seconds <= 60) return;
  const k = takeoverKind(state);
  const stop = k ? ` Then it stopped at a ${k.name.toLowerCase()} ${k.emoji} and is waiting for your help.` : '';
  setTimeout(() => alert(`While you were away the car drove ${formatNumber(state.odometer - before)} miles.${stop}`), delay);
}

// ?seed=123 fixes the traffic so screenshots are reproducible; ?mile=430 shows a spot on the route.
const params = new URLSearchParams(location.search);
const mileParam = params.get('mile');
const roadScene = createMapView($('view'), {
  seed: Number(params.get('seed')) || Math.floor(Math.random() * 1e9),
  mile: mileParam === null ? undefined : Number(mileParam),
});
const upgradesEl = $('upgrades');

// Build upgrade buttons once, grouped by kind; update text each frame.
const GROUPS: [UpgradeKind, string][] = [['sensor', 'Sensors'], ['feature', 'Driving features'], ['comfort', 'Comfort']];
const upgradeButtons = GROUPS.flatMap(([kind, title]) => {
  const h = document.createElement('h2');
  h.textContent = title;
  upgradesEl.appendChild(h);
  return UPGRADES.filter((u) => u.kind === kind).map((u) => {
    const btn = document.createElement('button');
    btn.className = 'upgrade';
    btn.innerHTML = `<span><span class="name"></span><br><span class="desc"></span></span><span class="cost"></span>`;
    btn.addEventListener('click', () => { state = buy(state, u.id); save(); render(); });
    upgradesEl.appendChild(btn);
    return { u, btn, name: btn.querySelector('.name')!, desc: btn.querySelector('.desc')!, cost: btn.querySelector('.cost')! };
  });
});

const takeoverBtn = $<HTMLButtonElement>('takeover');
takeoverBtn.addEventListener('click', () => { state = resolveTakeover(state); save(); render(); });
$('honk').addEventListener('click', () => { state = honk(state); render(); });
$('reset').addEventListener('click', () => {
  if (confirm('Start the trip over from the driveway?')) { state = newGame(Date.now()); save(); render(); }
});
$('build').textContent = `build ${__BUILD_ID__}`;

function render() {
  $('miles').textContent = formatNumber(state.miles);
  $('speed').textContent = formatNumber(currentSpeed(state));
  const auto = autonomyLevel(state.levels);
  $('autonomy').textContent = `L${auto} · ${AUTONOMY[auto].name}`;
  const k = takeoverKind(state);
  takeoverBtn.hidden = !k;
  if (k) {
    takeoverBtn.querySelector('.what')!.textContent = `${k.emoji} ${k.name}!`;
    takeoverBtn.querySelector('.ask')!.textContent = auto >= 2 ? 'Tap to take over' : 'Tap to help Dad';
    (takeoverBtn.querySelector('.timer') as HTMLElement).style.width = `${(100 * (1 - state.takeover!.waited / DAD_RESOLVE_SECONDS)).toFixed(1)}%`;
  }
  $('progress').style.width = `${(tripProgress(state) * 100).toFixed(2)}%`;
  $('landmark').textContent = `📍 ${currentLandmark(state).name}`;
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
    b.cost.textContent = owned ? 'Owned ✓' : `${formatNumber(upgradeCost(state, b.u.id))} mi`;
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
  const wasStuck = !!state.takeover;
  state = { ...advance(state, dt, { dadHelps: true }), lastTick: Date.now() };
  if (state.takeover && !wasStuck) navigator.vibrate?.(60);
  roadScene.frame(Math.min(dt, 0.1), currentSpeed(state), tripProgress(state), sensorCones(state.levels), autonomyLevel(state.levels));
  render();
  if (t - lastSave > 5000) { save(); lastSave = t; }
  requestAnimationFrame(frame);
}

// Catch up when returning to the tab (rAF pauses in the background).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') welcomeBack();
  else save();
});

welcomeBack(100);
render();
requestAnimationFrame(frame);
