// ╔══════════════════════════════════════════════════════╗
// ║  ВРАТА МИРОВ — game.js                              ║
// ║  Структура:                                          ║
// ║  1. Firebase (init, auth, db)                        ║
// ║  2. State (charState, state)                         ║
// ║  3. Auth (onAuthStateChanged, setupWorld)            ║
// ║  4. Storage (localStorage, Firestore save/load)      ║
// ║  5. Panels (renderAllPanels, stats, skills, equip)   ║
// ║  6. Pixel Art (portraits, doll)                      ║
// ║  7. Prompts (buildSystemPrompt)                      ║
// ║  8. Engine (askDM, renderActions, scroll)            ║
// ╚══════════════════════════════════════════════════════╝

// ════════════════════════════════════════════
// 1. FIREBASE
// ════════════════════════════════════════════
import { initializeApp }     from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import firebaseConfig from "../firebase-config.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);


// ════════════════════════════════════════════
// 2. STATE — состояние персонажа и игры
// ════════════════════════════════════════════
// ══ СОСТОЯНИЕ ПЕРСОНАЖА ══
const charState = {
  hp:{ cur:100, max:100 }, mp:{ cur:50, max:50 }, xp:{ cur:0, max:100 },
  stats:{ Сила:10, Ловкость:10, Интеллект:10, Харизма:10 },
  skills:[
    {name:'Красноречие',level:1},{name:'Скрытность',level:1},
    {name:'Атака',level:1},{name:'Магия',level:1},{name:'Торговля',level:1},
  ],
  inventory:[], gold:0,
};

// ══ ИГРОВОЕ СОСТОЯНИЕ ══
const state = {
  history:[], diceNotation:null, diceReason:null,
  waitingForDice:false, currentActions:[], locked:false,
  uid:null, gameId:'session_'+Date.now(),
  worldPrompt:null, thinkingText:'Рассказчик думает',
  nakazText:'',
  worldId: null,
};

// ── Настройки MP под каждый мир: название, цвет-смысл, механика ──
const WORLD_MP_CONFIG = {
  morrowind: { label:'Магия',      mechanic:'mp < 10 — заклинания недоступны, колдовство требует маны.' },
  lotr:      { label:'Воля',       mechanic:'mp — запас воли. < 10 — персонаж деморализован, не может вести за собой и противостоять тьме.' },
  hp:        { label:'Магическая сила', mechanic:'mp — запас магической силы. < 10 — сложные заклинания не удаются, только простые чары.' },
  witcher:   { label:'Выносливость знаков', mechanic:'mp — выносливость для знаков и уклонений. < 10 — знаки недоступны, только мечи.' },
  starwars:  { label:'Сила Джедая', mechanic:'mp — связь с Силой. < 10 — способности Силы недоступны, только физические действия.' },
  lego:      { label:'Воображение', mechanic:'mp — воображение для строительства и изобретений. < 10 — можно только ломать, не строить.' },
  alice:     { label:'Безумие',    mechanic:'mp — запас безумия (чем больше — тем лучше в Стране Чудес!). < 10 — Алиса начинает вести себя слишком логично и мир отвергает её.' },
  stardew:   { label:'Усталость',  mechanic:'mp — усталость (максимум = запас энергии). Каждое физическое действие тратит mp. < 10 — персонаж изнемогает: штраф к броскам. Сон восстанавливает полностью.' },
  default:   { label:'Мана',       mechanic:'mp < 10 — магические навыки недоступны.' },
};

// ══ AUTH ══
onAuthStateChanged(auth, user => {
  const loading = document.getElementById('auth-loading');
  if (!user){ window.location.href='index.html'; return; }
  state.uid = user.uid;
  const name = user.displayName||(user.isAnonymous?'Гость':user.email?.split('@')[0]||'Странник');
  document.getElementById('player-name-label').innerHTML = `<span>${name}</span>`;
  document.getElementById('player-bar').classList.add('visible');
  loadNakazy();

  const newGameData  = sessionStorage.getItem('dnd_newgame');
  const continueData = sessionStorage.getItem('dnd_continue');

  // Скрываем загрузку сразу — не ждём askDM
  loading.classList.add('hidden');
  setTimeout(()=>loading.remove(), 500);

  if (newGameData){
    sessionStorage.removeItem('dnd_newgame');
    try {
      const d = JSON.parse(newGameData);
      setupWorld(d);
      // Пробуем загрузить сохранённый стейт (если уже играли эту сессию)
      if (!loadCharState()) initCharForWorld(d);
      renderAllPanels();
      if (pendingLevelUpPoints > 0) openLevelUpModal();
      askDM(d.startMsg);
    } catch(e) {
      console.error('newgame parse error:', e);
      window.location.href='menu.html';
    }
  } else if (continueData){
    sessionStorage.removeItem('dnd_continue');
    try {
      const d = JSON.parse(continueData);
      setupWorld(d);
      state.history = d.history||[];
      state.gameId  = d.gameId||state.gameId;
      // Сначала Firestore, потом localStorage как более свежий
      if (d.charState) Object.assign(charState, d.charState);
      loadCharState(); // перезаписывает если есть более свежее в localStorage
      renderAllPanels();
      if (pendingLevelUpPoints > 0) openLevelUpModal();
      restoreHistory(state.history);
    } catch(e) {
      console.error('continue parse error:', e);
      window.location.href='menu.html';
    }
  } else {
    window.location.href='menu.html'; return;
  }
});

// ════════════════════════════════════════════
// 3. STORAGE — сохранение и загрузка
// ════════════════════════════════════════════
function saveCharState(){
  try {
    const key = 'dnd_char_' + (state.uid||'guest') + '_' + (state.gameId||'');
    localStorage.setItem(key, JSON.stringify({ charState, playerLevel, pendingLevelUpPoints }));
  } catch(e){ console.warn('saveCharState:', e); }
}

function loadCharState(){
  try {
    const key = 'dnd_char_' + (state.uid||'guest') + '_' + (state.gameId||'');
    const saved = localStorage.getItem(key);
    if (!saved) return false;
    const d = JSON.parse(saved);
    if (d.charState)    Object.assign(charState, d.charState);
    if (d.playerLevel)  playerLevel = d.playerLevel;
    if (d.pendingLevelUpPoints) pendingLevelUpPoints = d.pendingLevelUpPoints;
    return true;
  } catch(e){ return false; }
}

// ════════════════════════════════════════════
// 4. WORLD INIT — инициализация персонажа под мир
// ════════════════════════════════════════════
function initCharForWorld(d) {
  // Начальный стартовый набор из инвентаря
  if (d.startKit) {
    charState.gold = d.startKit.gold||0;
    charState.inventory = (d.startKit.items||[]).map(item=>{
      // items can be objects {name,icon,desc,qty} or legacy strings
      if (typeof item === 'string') return {name:item, icon:'📦', qty:1, desc:''};
      return {name:item.name||'?', icon:item.icon||'📦', qty:item.qty||1, desc:item.desc||''};
    });
  }
  // Подбираем статы под мир
  const worldId = d.worldTheme||'';
  // ── ХАРАКТЕРИСТИКИ: осмысленные под каждый мир ──
  const statSets = {
    // Morrowind: классическая RPG — тело, ловкость, разум, удача
    morrowind:  { Сила:10, Ловкость:12, Интеллект:10, Удача:8 },
    // ВК: физика, стойкость духа, мудрость предков, воля
    lotr:       { Сила:12, Выносливость:10, Мудрость:10, Воля:8 },
    // Гарри Поттер: магическая сила, интеллект, смелость, удача
    hp:         { Магия:12, Интеллект:10, Смелость:10, Удача:8 },
    // Ведьмак: бой — тело и рефлексы; охота — знания и чутьё
    witcher:    { Сила:12, Рефлексы:12, Знания:10, Чутьё:8 },
    // Звёздные войны: тело, ловкость, разум, связь с Силой
    starwars:   { Сила:10, Ловкость:12, Интеллект:10, Единство_с_Силой:8 },
    // LEGO: воображение — главный стат; координация, физика, удача
    lego:       { Творчество:14, Координация:10, Сила:8, Удача:10 },
    // Алиса: здесь всё шиворот-навыворот — любопытство важнее логики
    alice:      { Любопытство:14, Безрассудство:10, Логика:6, Везение:10 },
    // Stardew: выносливость (=макс усталость), здоровье, харизма, внимательность
    stardew:    { Выносливость:10, Здоровье:10, Харизма:8, Внимательность:10 },
  };
  if (statSets[worldId]) charState.stats = statSets[worldId];

  // ── НАВЫКИ: то чем реально занимается персонаж в этом мире ──
  const skillSets = {
    // Morrowind: оружие, скрытность, магия, торговля, красноречие
    morrowind: [{name:'Длинные клинки',level:1},{name:'Скрытность',level:1},{name:'Колдовство',level:1},{name:'Алхимия',level:1},{name:'Красноречие',level:1}],
    // ВК: сражение, стрельба/следопыт, магия, выживание, лидерство
    lotr:      [{name:'Владение оружием',level:1},{name:'Следопыт',level:1},{name:'Магия',level:1},{name:'Выживание',level:1},{name:'Лидерство',level:1}],
    // ГП: заклинания, зельеварение, трансфигурация, полёт, прорицание
    hp:        [{name:'Заклинания',level:1},{name:'Зельеварение',level:1},{name:'Трансфигурация',level:1},{name:'Полёт на метле',level:1},{name:'Прорицание',level:1}],
    // Ведьмак: мечи, знаки, алхимия, охота на чудовищ, выживание
    witcher:   [{name:'Фехтование',level:1},{name:'Знаки',level:1},{name:'Алхимия',level:1},{name:'Охота на чудовищ',level:1},{name:'Выживание',level:1}],
    // Звёздные войны: Сила, пилотаж, бластер, механика, дипломатия
    starwars:  [{name:'Владение Силой',level:1},{name:'Пилотаж',level:1},{name:'Стрельба из бластера',level:1},{name:'Механика',level:1},{name:'Дипломатия',level:1}],
    // LEGO: строительство, изобретения, командование, акробатика, хитрость
    lego:      [{name:'Строительство',level:1},{name:'Изобретения',level:1},{name:'Командование',level:1},{name:'Акробатика',level:1},{name:'Хитрость',level:1}],
    // Алиса: абсурдная логика, бег, чаепитие/убеждение, загадки, изменение размера
    alice:     [{name:'Абсурдная логика',level:1},{name:'Бег и прыжки',level:1},{name:'Искусство чаепития',level:1},{name:'Загадки',level:1},{name:'Изменение размера',level:1}],
    // Stardew: фермерство, рыбная ловля, горное дело, собирательство, боевые навыки
    stardew:   [{name:'Фермерство',level:1},{name:'Рыбная ловля',level:1},{name:'Горное дело',level:1},{name:'Собирательство',level:1},{name:'Боевые навыки',level:1}],
  };
  if (skillSets[worldId]) charState.skills = skillSets[worldId];
}

function setupWorld(d){
  if (d.worldTheme) {
    document.body.classList.add('theme-'+d.worldTheme);
    state.worldId = d.worldTheme;
    // Update MP label in sidebar
    const mpCfg = WORLD_MP_CONFIG[d.worldTheme] || WORLD_MP_CONFIG.default;
    const mpLbl = document.getElementById('mp-label');
    if (mpLbl) mpLbl.textContent = mpCfg.label;
    // SW: apply character colour theme
    if (d.worldTheme === 'starwars') {
      document.body.classList.remove('sw-jedi','sw-sith');
      const cc = (d.charClass||'').toLowerCase();
      if (cc.includes('оби') || cc.includes('энакин') || cc.includes('anakin') || cc.includes('obi')) {
        document.body.classList.add('sw-jedi');
      } else if (cc.includes('джанго') || cc.includes('палпатин') || cc.includes('jango') || cc.includes('palpatine')) {
        document.body.classList.add('sw-sith');
      }
    }
  }
  document.getElementById('game-title').textContent    = d.worldTitle    ||'Врата Миров';
  document.getElementById('game-subtitle').textContent = d.worldSubtitle ||'Твоё приключение';
  const barTitle = document.getElementById('bar-title');
  if (barTitle) { barTitle.textContent = d.worldTitle||'Врата Миров'; barTitle.style.display='block'; }
  const barSub = document.getElementById('bar-subtitle');
  if (barSub) { barSub.textContent = d.worldSubtitle||''; barSub.style.display='block'; }
  document.getElementById('char-panel-title').textContent = d.playerName||'Персонаж';
  if (d.playerName) document.getElementById('portrait-name').textContent = d.playerName;
  if (d.charClass)  document.getElementById('portrait-class').textContent = d.charClass;
  if (d.thinkingText){
    state.thinkingText=d.thinkingText;
    document.getElementById('typing').innerHTML=`${d.thinkingText}<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>`;
  }
  if (d.worldPrompt) state.worldPrompt=d.worldPrompt;
  setTimeout(updatePixelArt, 100);
}

// ══ РЕНДЕР ПАНЕЛЕЙ ══
// ── НАКАЗЫ — отдельное хранилище per user ──
function saveNakazy(){
  const text = document.getElementById('nakaz-text').value.trim();
  state.nakazText = text;
  try {
    localStorage.setItem('dnd_nakazy_'+(state.uid||'guest'), text);
  } catch(e){}
  const hint = document.getElementById('nakaz-saved');
  hint.classList.add('show');
  setTimeout(()=>hint.classList.remove('show'), 2500);
}
function loadNakazy(){
  try {
    const saved = localStorage.getItem('dnd_nakazy_'+(state.uid||'guest'));
    if (saved !== null) {
      state.nakazText = saved;
      const ta = document.getElementById('nakaz-text');
      if (ta) ta.value = saved;
    }
  } catch(e){}
}
function openNakazy(){
  loadNakazy();
  document.getElementById('nakazы-modal').classList.add('open');
}
function closeNakazy(){
  document.getElementById('nakazы-modal').classList.remove('open');
}
// Закрыть по клику на фон
document.getElementById('nakazы-modal').addEventListener('click', function(e){
  if (e.target === this) closeNakazy();
});


// ════════════════════════════════════════════
// 5. PANELS — рендер боковых панелей
// ════════════════════════════════════════════

function renderAllPanels(){
  renderBars(); renderStats(); renderSkills(); renderInventory();
  // Синхронизируем уровень в панели "Герой"
  const lvlEl = document.getElementById('portrait-level');
  if (lvlEl) lvlEl.textContent = 'Ур. ' + playerLevel;
  syncMobilePanels();
}

function syncMobilePanels(){
  const isMobile = window.innerWidth <= 860;
  if (!isMobile) return;
  const {hp,mp,xp} = charState;
  // Bars
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  const setW = (id, w) => { const el = document.getElementById(id); if(el) el.style.width = w; };
  set('hp-val-m',  `${hp.cur}/${hp.max}`);
  set('mp-val-m',  `${mp.cur}/${mp.max}`);
  set('xp-val-m',  `${xp.cur}/${xp.max}`);
  setW('hp-bar-m',  `${Math.max(0,Math.min(100,(hp.cur/hp.max)*100))}%`);
  setW('mp-bar-m',  `${Math.max(0,Math.min(100,(mp.cur/mp.max)*100))}%`);
  setW('xp-bar-m',  `${Math.max(0,Math.min(100,(xp.cur/xp.max)*100))}%`);
  // Stats
  const sgm = document.getElementById('stats-grid-m');
  if(sgm) sgm.innerHTML = Object.entries(charState.stats).map(([n,v])=>
    `<div class="stat-item"><div class="stat-item-val">${v}</div><div class="stat-item-name">${n}</div></div>`).join('');
  // Skills
  const slm = document.getElementById('skills-list-m');
  if(slm) slm.innerHTML = charState.skills.map(s=>`
    <div class="skill-row">
      <span class="skill-name">${s.name}</span>
      <div class="skill-dots">${[1,2,3,4,5].map(i=>`<div class="skill-dot ${i<=s.level?'filled':''}"></div>`).join('')}</div>
    </div>`).join('');
  // Inventory
  const igm = document.getElementById('inv-grid-m');
  if(igm){
    // Show all items + 2 empty slots as visual padding; horizontal scroll handles overflow
    const showCount = Math.max(8, charState.inventory.length + 2);
    let h='';
    for(let i=0;i<showCount;i++){
      const item=charState.inventory[i];
      if(item) h+=`<div class="inv-cell has-item" data-item-name="${(item.name||'').replace(/"/g,'&quot;')}" data-item-desc="${(item.desc||'').replace(/"/g,'&quot;')}">${item.icon||'📦'}${item.qty>1?`<span class="item-qty">${item.qty}</span>`:''}</div>`;
      else h+=`<div class="inv-cell"></div>`;
    }
    igm.innerHTML=h;
  }
  const gvm = document.getElementById('gold-val-m');
  if(gvm) gvm.textContent = charState.gold;
  // Portrait name/class/level
  const pn=document.getElementById('portrait-name-m'), pc=document.getElementById('portrait-class-m'), pl=document.getElementById('portrait-level-m');
  const pnD=document.getElementById('portrait-name'), pcD=document.getElementById('portrait-class');
  if(pn&&pnD) pn.textContent=pnD.textContent;
  if(pc&&pcD) pc.textContent=pcD.textContent;
  if(pl) pl.textContent='Ур. '+playerLevel;
  // HP/MP labels
  const hplD=document.getElementById('hp-label'), mplD=document.getElementById('mp-label');
  const hplM=document.getElementById('hp-label-m'), mplM=document.getElementById('mp-label-m');
  if(hplD&&hplM) hplM.textContent=hplD.textContent;
  if(mplD&&mplM) mplM.textContent=mplD.textContent;
}

function renderBars(){
  const {hp,mp,xp}=charState;
  document.getElementById('hp-val').textContent=`${hp.cur} / ${hp.max}`;
  document.getElementById('mp-val').textContent=`${mp.cur} / ${mp.max}`;
  document.getElementById('xp-val').textContent=`${xp.cur} / ${xp.max}`;
  document.getElementById('hp-bar').style.width=`${Math.max(0,Math.min(100,(hp.cur/hp.max)*100))}%`;
  document.getElementById('mp-bar').style.width=`${Math.max(0,Math.min(100,(mp.cur/mp.max)*100))}%`;
  document.getElementById('xp-bar').style.width=`${Math.max(0,Math.min(100,(xp.cur/xp.max)*100))}%`;
}

function renderStats(){
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = Object.entries(charState.stats).map(([name,val])=>
    `<div class="stat-item"><div class="stat-item-val">${val}</div><div class="stat-item-name">${name}</div></div>`
  ).join('');
}

function renderSkills(){
  const list = document.getElementById('skills-list');
  list.innerHTML = charState.skills.map(s=>`
    <div class="skill-row">
      <span class="skill-name">${s.name}</span>
      <div class="skill-dots">${[1,2,3,4,5].map(i=>`<div class="skill-dot ${i<=s.level?'filled':''}"></div>`).join('')}</div>
    </div>`).join('');
}

function renderInventory(){
  const grid = document.getElementById('inv-grid');
  const cells = 12;
  let html='';
  for (let i=0;i<cells;i++){
    const item = charState.inventory[i];
    if (item){
      html+=`<div class="inv-cell has-item" data-item-name="${(item.name||'').replace(/"/g,'&quot;')}" data-item-desc="${(item.desc||'').replace(/"/g,'&quot;')}">
        ${item.icon||'📦'}
        ${item.qty>1?`<span class="item-qty">${item.qty}</span>`:''}
      </div>`;
    } else {
      html+=`<div class="inv-cell"></div>`;
    }
  }
  grid.innerHTML=html;
  document.getElementById('gold-val').textContent=charState.gold;
}

// ══ ОБНОВЛЕНИЕ СОСТОЯНИЯ ИЗ ОТВЕТА ИИ ══
function applyCharUpdate(update){
  if(!update) return;
  let changed=false;

  if(update.hp!==undefined){ charState.hp.cur=Math.max(0,Math.min(charState.hp.max,update.hp)); changed=true; }
  if(update.hp_max!==undefined){ charState.hp.max=update.hp_max; changed=true; }
  if(update.mp!==undefined){ charState.mp.cur=Math.max(0,Math.min(charState.mp.max,update.mp)); changed=true; }
  if(update.mp_max!==undefined){ charState.mp.max=update.mp_max; changed=true; }
  // XP is managed by game code only — ignore any xp/xp_add from Gemini
  // (Gemini tends to add XP every turn regardless of instructions)
  if(update.gold!==undefined){ charState.gold=Math.max(0,update.gold); changed=true; }

  if(update.stats){ Object.assign(charState.stats,update.stats); changed=true; }

  if(update.skills){
    update.skills.forEach(us=>{
      let s = charState.skills.find(sk => sk.name === us.name);
      if (!s) s = charState.skills.find(sk => sk.name.toLowerCase().trim() === (us.name||"").toLowerCase().trim());
      if (s) {
        const newLevel = Math.max(1, Math.min(5, us.level));
        console.log('[DM] skill "' + s.name + '" ' + s.level + ' -> ' + newLevel);
        s.level = newLevel;
      } else {
        console.warn("[DM] skill not found:", us.name, "| available:", charState.skills.map(sk=>sk.name));
      }
    });
    changed=true;
  }

  if(update.inventory_add){
    update.inventory_add.forEach(raw=>{
      // Normalize: Gemini sometimes sends a plain string instead of an object
      const item = typeof raw === 'string' ? {name:raw, icon:'📦', qty:1, desc:''} : raw;
      // Validate icon: must be a single emoji (≤2 chars grapheme cluster), else fallback
      const iconStr = item.icon || '';
      const isEmoji = iconStr.length > 0 && iconStr.length <= 4 && /\p{Emoji}/u.test(iconStr);
      if (!isEmoji) item.icon = '📦';
      if (!item.name) return; // skip malformed entries
      // Skip if this item is also being removed in the same update (Gemini contradiction guard)
      if (update.inventory_remove) {
        const alsoRemoving = update.inventory_remove.some(r => {
          const rn = typeof r === 'string' ? r : (r.name||'');
          return rn.toLowerCase().trim() === item.name.toLowerCase().trim();
        });
        if (alsoRemoving) { console.warn('[DM] inventory_add+remove conflict, skipping add for:', item.name); return; }
      }
      const ex = charState.inventory.find(i => i.name === item.name)
              || charState.inventory.find(i => i.name.toLowerCase().trim() === item.name.toLowerCase().trim());
      if (ex) ex.qty = (ex.qty||1) + (item.qty||1);
      else charState.inventory.push({icon:'📦', desc:'', ...item, qty:item.qty||1});
    });
    changed=true;
  }

  if(update.inventory_remove){
    update.inventory_remove.forEach(entry=>{
      // entry может быть строкой "Название" или объектом {name, qty}
      const removeName = typeof entry === 'string' ? entry : (entry.name || '');
      const removeQty  = typeof entry === 'object' && entry.qty ? entry.qty : null; // null = удалить весь стек
      // Поиск: точный → регистронезависимый → по подстроке (для "5 семян репы" vs "семена репы")
      let idx = charState.inventory.findIndex(i => i.name === removeName);
      if (idx < 0) idx = charState.inventory.findIndex(i => i.name.toLowerCase().trim() === removeName.toLowerCase().trim());
      if (idx < 0) {
        // fuzzy: ищем предмет имя которого содержится в запросе или наоборот
        idx = charState.inventory.findIndex(i => {
          const a = i.name.toLowerCase(), b = removeName.toLowerCase();
          return a.includes(b) || b.includes(a);
        });
      }
      if (idx >= 0) {
        const item = charState.inventory[idx];
        if (removeQty && item.qty > removeQty) {
          item.qty -= removeQty;
          console.log('[DM] inventory_remove qty:', removeQty, 'from', item.name, '-> remaining:', item.qty);
        } else {
          console.log('[DM] inventory_remove (full stack):', item.name);
          charState.inventory.splice(idx, 1);
        }
      } else {
        console.warn('[DM] inventory_remove: item not found:', removeName, '| inventory:', charState.inventory.map(i=>i.name));
      }
    });
    changed=true;
  }

  if(changed){ renderAllPanels(); updatePixelArt(); saveCharState(); }
}

let playerLevel = 1;
let pendingLevelUpPoints = 0;  // очки для распределения

function levelUp(){
  playerLevel++;
  // HP и MP растут автоматически, характеристики — выбор игрока
  charState.hp.max += 10; charState.hp.cur = charState.hp.max;
  charState.mp.max += 5;  charState.mp.cur = charState.mp.max;
  document.getElementById('portrait-level').textContent = 'Ур. ' + playerLevel;
  addDMMessage('✨ **Уровень ' + playerLevel + '!** HP и мана восстановлены. Распредели 2 очка характеристик!');
  updatePixelArt();
  saveCharState();
  pendingLevelUpPoints += 2;
  openLevelUpModal();
}

function openLevelUpModal(){
  const modal = document.getElementById('levelup-modal');
  if (!modal) return;
  renderLevelUpModal();
  modal.classList.add('open');
}

function renderLevelUpModal(){
  const pts = document.getElementById('lu-points');
  if (pts) pts.textContent = pendingLevelUpPoints;
  const grid = document.getElementById('lu-stat-grid');
  if (!grid) return;
  grid.innerHTML = Object.entries(charState.stats).map(([name, val]) => `
    <div class="lu-stat-row">
      <div class="lu-stat-info">
        <span class="lu-stat-name">${name}</span>
        <span class="lu-stat-val" id="lu-val-${name}">${val}</span>
      </div>
      <button class="lu-plus-btn" onclick="window._luAddStat('${name}')" ${pendingLevelUpPoints <= 0 ? 'disabled' : ''}>+</button>
    </div>`).join('');
}

window._luAddStat = function(statName){
  if (pendingLevelUpPoints <= 0) return;
  charState.stats[statName] = (charState.stats[statName] || 0) + 1;
  pendingLevelUpPoints--;
  renderLevelUpModal();
  renderStats();
  saveCharState();
  if (pendingLevelUpPoints <= 0) {
    setTimeout(() => {
      document.getElementById('levelup-modal').classList.remove('open');
    }, 600);
  }
};

window._closeLevelUpModal = function(){
  // Only allow closing if all points are spent
  if (pendingLevelUpPoints <= 0) {
    document.getElementById('levelup-modal').classList.remove('open');
  }
};

// ══ XP — детерминированное начисление опыта кодом, не ИИ ══
function grantXP(amount){
  if(!amount || amount <= 0) return;
  charState.xp.cur += amount;
  while(charState.xp.cur >= charState.xp.max){
    charState.xp.cur -= charState.xp.max;
    charState.xp.max = Math.round(charState.xp.max * 1.5);
    levelUp();
  }
  renderBars();
  saveCharState();
  console.log('[XP] +' + amount + ' → ' + charState.xp.cur + '/' + charState.xp.max);
}

// ══ СОХРАНЕНИЕ ══
async function saveProgress(){
  if(!state.uid||state.history.length===0) return;
  try {
    const titleEl=document.getElementById('game-title');
    await setDoc(doc(db,'players',state.uid,'games',state.gameId),{
      gameId:        state.gameId,
      title:         titleEl.textContent+' · '+new Date().toLocaleDateString('ru'),
      history:       state.history,
      charState:     charState,
      worldTheme:    document.body.className.match(/theme-(\S+)/)?.[1]||null,
      worldTitle:    titleEl.textContent,
      worldSubtitle: document.getElementById('game-subtitle').textContent,
      thinkingText:  state.thinkingText,
      savedAt:       serverTimestamp(),
    });
    const el=document.getElementById('save-indicator');
    el.classList.add('visible');
    setTimeout(()=>el.classList.remove('visible'),2500);
  } catch(e){ console.warn('Autosave:',e); }
}

// ══ СИСТЕМНЫЙ ПРОМПТ ══

// ════════════════════════════════════════════
// 6. PROMPTS — системные промпты для ИИ
// ════════════════════════════════════════════
function buildSystemPrompt(){
  const base = state.worldPrompt || 'Ты — рассказчик, ведущий приключение.';
  const hp=charState.hp, mp=charState.mp, xp=charState.xp;
  const mpCfg = WORLD_MP_CONFIG[state.worldId] || WORLD_MP_CONFIG.default;
  const curXP = xp.cur;

  const statsEntries = Object.entries(charState.stats);
  const statsStr  = statsEntries.map(([k,v])=>`${k}: ${v}`).join(' | ');
  const skillsStr = charState.skills.map(s=>`${s.name} (ур.${s.level}/5)`).join(' | ');
  const invStr    = charState.inventory.map(i=>i.name+'x'+(i.qty||1)).join(', ')||'пусто';

  const topStat  = [...statsEntries].sort((a,b)=>b[1]-a[1])[0] || ['???', 10];
  const topSkill = [...charState.skills].sort((a,b)=>b.level-a.level)[0] || {name:'???',level:1};

  const nakazBlock = state.nakazText
    ? `\n\nПОЖЕЛАНИЯ ИГРОКА (строго соблюдай):\n${state.nakazText}`
    : '';

  return base + nakazBlock + `

═══ СОСТОЯНИЕ ПЕРСОНАЖА ═══
HP: ${hp.cur}/${hp.max} | ${mpCfg.label}: ${mp.cur}/${mp.max} | Опыт: ${curXP}/${xp.max} | Золото: ${charState.gold}
Характеристики: ${statsStr}
Навыки: ${skillsStr}
Инвентарь: ${invStr}
Сильная сторона: ${topStat[0]} (${topStat[1]}) и навык «${topSkill.name}» ур.${topSkill.level}

═══ КАК ХАРАКТЕРИСТИКИ И НАВЫКИ ВЛИЯЮТ НА ИГРУ ═══
Характеристики — числа 1-20. Навыки — уровень 1-5. Это НЕ декорации — они меняют что происходит.

ПРАВИЛА (обязательны):
1. Высокий стат (14+) = персонаж справляется без броска или с явным преимуществом. Напиши в тексте почему: «Твоя [стат] позволяет...»
2. Низкий стат (7-) = персонаж заметно спотыкается. Отрази это в повествовании.
3. При броске DICE указывай в reason: какой стат проверяется и порог успеха. Пример: «Проверка Ловкости — нужно 10+»
4. Высокий проверяемый стат снижает порог на 2-3, низкий — повышает на 2-3.
5. Навык «${topSkill.name}» ур.${topSkill.level} — давай игроку шанс применить его каждые 2-3 хода. При успехе: skills:[{"name":"${topSkill.name}","level":${Math.min(5, topSkill.level+1)}}] в DATA если это был сложный вызов.
6. Называй характеристики и навыки персонажа по имени когда они релевантны.

═══ КАК ПИСАТЬ ═══
- СТРОГО 1-2 абзаца. Максимум 600 символов в STORY. Сразу к действию, без вступлений и резюме.
- Не пересказывай что игрок только что сделал — сразу результат и то что происходит дальше.
- Диалоги с тире: — Реплика! — сказал NPC.
- 1-2 эмодзи по смыслу, не больше.

═══ МЕХАНИКА ═══
- Рискованное действие где стат не гарантирует успех → TYPE=DICE
- Опыт начисляется системой автоматически. НЕ включай xp, xp_add в DATA никогда.
- Урон от врагов: hp -5 до -20. HP не ниже 1.
- Золото НИКОГДА не может быть меньше 0. Если у игрока недостаточно золота для покупки — откажи в покупке в тексте, не трать золото, не включай gold в DATA.
- ${mpCfg.mechanic}

═══ ФОРМАТ ОТВЕТА (строго!) ═══

Бросок:
STORY
текст сцены
END_STORY
TYPE=DICE
DICE={notation:1d20,reason:Проверка Ловкости — нужно 12+}
DATA={}  ← или только изменившиеся hp/mp/gold/stats/skills/inventory

Выбор:
STORY
текст сцены
END_STORY
TYPE=CHOICE
ACTIONS=⚔️ Атаковать|💬 Поговорить|🏃 Сбежать
DATA={}  ← или только изменившиеся поля

DATA — JSON только с изменившимися полями:
hp, mp, gold — числа (только изменившиеся)
stats: {"Ловкость":13}
skills: [{"name":"Скрытность","level":2}]
inventory_add: [{"name":"Зелье","icon":"🧪","qty":1,"desc":"Лечит 20 HP"}]
inventory_remove: ["точное название предмета как в инвентаре"] или [{"name":"название","qty":3}] если тратится часть

ПРАВИЛА ИНВЕНТАРЯ (строго!):
- Если игрок ТРАТИТ/ИСПОЛЬЗУЕТ предмет → inventory_remove ОБЯЗАТЕЛЕН
- Если игрок ПОЛУЧАЕТ предмет → inventory_add ОБЯЗАТЕЛЕН
- inventory_remove: используй ТОЧНОЕ название предмета из инвентаря игрока (см. список выше)
- Нельзя одновременно add и remove одного и того же предмета
- Если предмета нет в инвентаре — нельзя его использовать, напиши об этом в тексте

ЗАПРЕЩЕНО: писать варианты действий в STORY.`
}

// ══ ДВИЖОК ══
const log=document.getElementById('story-log');
const actionZone=document.getElementById('action-zone');
const typing=document.getElementById('typing');

function scrollBottom(){
  setTimeout(()=>{
    const last = log.lastElementChild;
    if (last) last.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }, 100);
}
function scrollToActions(){
  setTimeout(()=>{
    actionZone.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }, 150);
}
function showTyping(v){ typing.classList.toggle('visible',v); }

function addDMMessage(rawText){
  const html = rawText
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\r\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n')   // схлопываем 3+ переносов в 2
    .replace(/\n\n/g,'</p><p>')  // двойной => новый абзац
    .replace(/\n/g,'<br>');       // одинарный => br
  const d=document.createElement('div');
  d.className='message dm-block';
  d.innerHTML='<div class="dm-text"><p>'+html+'</p></div>';
  log.appendChild(d); scrollBottom();
}

function addPlayerMessage(text){
  const d=document.createElement('div');
  d.className='message player-block';
  d.innerHTML=`<div class="player-text">↳ ${text}</div>`;
  log.appendChild(d); scrollBottom();
}
function addDiceResult(notation,result,reason){
  const d=document.createElement('div');
  d.className='message dice-result';
  d.innerHTML=`🎲 ${reason}<br><span class="roll-number">${result}</span><small style="opacity:0.6">${notation}</small>`;
  log.appendChild(d); scrollBottom();
}
function setActionZone(html){ actionZone.innerHTML=html; if(html.trim()) scrollToActions(); }

function rollDice(notation){
  const m=notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if(!m) return Math.floor(Math.random()*20)+1;
  const n=+m[1],s=+m[2],mod=m[3]?+m[3]:0;
  let t=0; for(let i=0;i<n;i++) t+=Math.floor(Math.random()*s)+1;
  return t+mod;
}


// ════════════════════════════════════════════
// 7. ENGINE — игровой движок
// ════════════════════════════════════════════
// ── Парсер текстового формата ──
// Gemini возвращает plain text с разделителями, не JSON
function parseGeminiResponse(text) {
  const result = { story:'', type:'choice', actions:[], char_update:{} };

  // Извлекаем STORY — ищем между STORY и END_STORY (нечувствительно к пробелам/переносам)
  const storyMatch = text.match(/STORY[ \t]*\r?\n([\s\S]*?)\r?\nEND_STORY/i);
  if (storyMatch) {
    result.story = storyMatch[1].trim();
  } else {
    // Fallback: всё до первого маркера TYPE= или END_STORY
    result.story = text
      .replace(/END_STORY[\s\S]*/i, '')
      .replace(/TYPE=[\s\S]*/i, '')
      .trim();
    if (!result.story) result.story = text.trim();
  }

  // Убираем все служебные маркеры если вдруг попали в story
  result.story = result.story
    .replace(/\bEND_STORY\b/gi, '')
    .replace(/\bSTORY\b/gi, '')
    .replace(/^TYPE=\S+/gim, '')
    .replace(/^ACTIONS=.*/gim, '')
    .replace(/^DATA=\{.*\}/gim, '')
    .replace(/^DICE=\{.*\}/gim, '')
    .trim();

  // Тип
  result.type = /TYPE=DICE/i.test(text) ? 'dice' : 'choice';

  // Кубик
  if (result.type === 'dice') {
    const diceM = text.match(/DICE=\{([^}]+)\}/i);
    if (diceM) {
      const d = diceM[1];
      const notM = d.match(/notation[:\s]+([\w+\-]+)/i);
      const resM = d.match(/reason[:\s]+([^,}]+)/i);
      result.dice = {
        notation: notM ? notM[1].trim() : '1d20',
        reason:   resM ? resM[1].trim() : 'Бросок'
      };
    } else {
      result.dice = { notation:'1d20', reason:'Бросок' };
    }
  }

  // Действия — поддерживаем | и newline как разделители
  const actM = text.match(/ACTIONS=(.+)/i);
  if (actM) {
    result.actions = actM[1].split(/[|\n]/).map(a=>a.trim()).filter(Boolean);
  }

  // DATA — char_update
  // Gemini sometimes writes DATA= with newlines/spaces inside the JSON,
  // so we find the opening brace and manually balance braces to extract it.
  const dataIdx = text.search(/DATA=\s*\{/i);
  if (dataIdx !== -1) {
    const braceStart = text.indexOf('{', dataIdx);
    let depth = 0, end = -1;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      const jsonStr = text.slice(braceStart, end + 1);
      try {
        result.char_update = JSON.parse(jsonStr);
        console.log('[DM] DATA parsed:', result.char_update);
      } catch(e) {
        // Try cleaning common Gemini quirks: unquoted keys, trailing commas
        try {
          const cleaned = jsonStr
            .replace(/,\s*([}\]])/g, '$1')          // trailing commas
            .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // unquoted keys
          result.char_update = JSON.parse(cleaned);
          console.log('[DM] DATA parsed (cleaned):', result.char_update);
        } catch(e2) {
          console.warn('[DM] DATA parse failed:', jsonStr, e2);
        }
      }
    }
  }

  // Hard trim story to ~700 chars, cut at last sentence boundary
  if (result.story.length > 700) {
    const trimmed = result.story.slice(0, 720);
    const lastPunct = Math.max(trimmed.lastIndexOf('!'), trimmed.lastIndexOf('.'), trimmed.lastIndexOf('?'));
    result.story = lastPunct > 400 ? trimmed.slice(0, lastPunct + 1) : trimmed.trimEnd() + '…';
  }

  if (result.type==='choice' && result.actions.length===0) {
    result.actions = ['▶️ Продолжить...'];
  }
  return result;
}

async function askDM(userMessage){
  if(state.locked) return;
  state.locked=true;
  if(userMessage) state.history.push({role:'user',content:userMessage});
  showTyping(true); setActionZone('');

  try {
    // ── ЗАПРОС к Gemini 2.5 Flash ──
    const resp1 = await fetch('https://dnd-proxy.vercel.app/api/proxy',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        max_tokens:3000,
        system:buildSystemPrompt(),
        messages:state.history
      })
    });
    const data1 = await resp1.json();
    const raw1 = (data1.content?.[0]?.text || '').trim();


    const parsed = parseGeminiResponse(raw1);

    if (!parsed.story || parsed.story.trim()==='') {
      showTyping(false); state.locked=false;
      setTimeout(()=>askDM(null),1500); return;
    }

    // Dedup: don't push if last assistant message is identical (retry/corruption guard)
    const lastMsg = state.history[state.history.length-1];
    if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.content !== raw1) {
      state.history.push({role:'assistant',content:raw1});
    }
    // Trim history to last 30 entries to avoid context size / corruption issues
    if (state.history.length > 30) state.history = state.history.slice(-30);
    showTyping(false);
    addDMMessage(parsed.story);
    if(parsed.char_update) applyCharUpdate(parsed.char_update);
    // Grant XP by scene type: CHOICE = small passive xp, DICE scenes grant XP in _roll
    if(parsed.type === 'choice') grantXP(1);
    state.locked = false;   // ← разблокируем ДО renderActions, иначе кнопки не работают
    renderActions(parsed);
    saveProgress();

  } catch(err){
    showTyping(false);
    state.locked = false;
    addDMMessage('⚠ Связь прервана. Попробуй ещё раз.');
    setActionZone(`<button class="action-btn" onclick="window._retry()">🔄 Попробовать снова</button>`);
  }
}

function renderActions(parsed){
  const{type,actions,dice}=parsed;
  let html='<div class="btn-group">';
  if(type==='dice'){
    state.waitingForDice=true;
    state.diceNotation=dice?.notation||'1d20';
    state.diceReason=dice?.reason||'Бросок';
    html+=`<button class="dice-btn" onclick="window._roll()">🎲 Бросить кубик — ${state.diceReason} (${state.diceNotation})</button>`;
  } else if(actions?.length){
    state.currentActions=actions;
    actions.forEach((a,i)=>{ html+=`<button class="action-btn" onclick="window._choice(${i})">${a}</button>`; });
  }
  html+=`<button class="action-btn action-btn--custom" onclick="window._toggleCustomAction()">✏️ Своё действие</button>`;
  html+='</div>';
  html+=`<div class="custom-action-row" id="custom-action-row" style="display:none;">
    <input id="custom-action-input" class="custom-action-input" type="text" placeholder="Введи своё действие..." maxlength="200"
      onkeydown="if(event.key==='Enter') window._sendCustomAction()" />
    <button class="action-btn action-btn--send" onclick="window._sendCustomAction()">▶ Отправить</button>
  </div>`;
  setActionZone(html);
}

function _choice(i){
  const a=state.currentActions?.[i];
  if(!a||state.locked) return;
  addPlayerMessage(a); askDM(`Я выбираю: ${a}`);
}
function _toggleCustomAction(){
  const row = document.getElementById('custom-action-row');
  if (!row) return;
  const visible = row.style.display !== 'none';
  row.style.display = visible ? 'none' : 'flex';
  if (!visible) {
    const inp = document.getElementById('custom-action-input');
    if (inp) { inp.value=''; inp.focus(); }
  }
}
function _sendCustomAction(){
  if (state.locked) return;
  const inp = document.getElementById('custom-action-input');
  const text = inp ? inp.value.trim() : '';
  if (!text) return;
  addPlayerMessage(text);
  askDM(`Я выбираю: ${text}`);
}
function _roll(){
  if(!state.waitingForDice||state.locked) return;
  const n=state.diceNotation,r=state.diceReason,result=rollDice(n);
  state.waitingForDice=false;
  addDiceResult(n,result,r);
  // Parse threshold from reason like "Проверка Ловкости — нужно 12+"
  const threshM = r.match(/(\d+)\+/);
  const threshold = threshM ? parseInt(threshM[1]) : 10;
  const success = result >= threshold;
  grantXP(success ? 4 : 2);  // success: +4, failure: +2 (x5 slower)
  askDM(`Я бросил ${n} для "${r}" и выпало: ${result}`);
}
function _retry(){
  if(state.history.length&&state.history[state.history.length-1].role==='assistant') state.history.pop();
  askDM(null);
}

function restoreHistory(history){
  for(const msg of history){
    if(msg.role==='user'&&!msg.content.startsWith('Начни новое')){
      addPlayerMessage(msg.content.replace('Я выбираю: ',''));
    } else if(msg.role==='assistant'){
      const p = parseGeminiResponse(msg.content);
      if(p.story) addDMMessage(p.story);
    }
  }
  askDM('Продолжай приключение. Напомни коротко где я нахожусь и что происходит, затем дай варианты.');
}

document.getElementById('btn-logout').addEventListener('click',async()=>{ await signOut(auth); window.location.href='index.html'; });




// tooltip hide logic is handled by tooltips.js


window.goToMenu=()=>{ window.location.href='menu.html'; };

// ══ ПИКСЕЛЬ-АРТ ══
const PIXEL_SCALE = 1; // canvas 48x72 -> отображается в 96x144 через CSS

// Палитры для каждого мира
const WORLD_PALETTES = {
  morrowind: { skin:'#c8a882', hair:'#3a2010', body:'#8b3d18', legs:'#5a2810', outline:'#1a0a00' },
  lotr:      { skin:'#d4b896', hair:'#6a4a20', body:'#4a6040', legs:'#3a4830', outline:'#151510' },
  hp:        { skin:'#e8c8a0', hair:'#3a2808', body:'#8b2020', legs:'#1a1a50', outline:'#100808' },
  witcher:   { skin:'#d0b090', hair:'#f0f0f0', body:'#1a1a1a', legs:'#1a1a1a', outline:'#080808' },
  starwars:  { skin:'#c8a870', hair:'#181818', body:'#303040', legs:'#202030', outline:'#080810' },
  lego:      { skin:'#f0d020', hair:'#a06010', body:'#e03020', legs:'#2040c0', outline:'#101010' },
  alice:     { skin:'#f0c8d0', hair:'#d0a8d8', body:'#4080c0', legs:'#c02080', outline:'#180818' },
  stardew:   { skin:'#e8c898', hair:'#803010', body:'#608030', legs:'#4a6020', outline:'#181008' },
  default:   { skin:'#c8a882', hair:'#3a2010', body:'#604888', legs:'#403060', outline:'#0e0e14' },
};

// Пиксельный рисунок персонажа (48x72 пикселей)
// Формат: строки пикселей, символы: S=кожа H=волосы B=тело L=ноги .=прозрачный O=контур
const CHAR_SPRITE = [
  '....OOOOO....',
  '...OSHHHSO...',
  '...OSSSSO....',
  '....OOOO.....',
  '..OOBBBBBOO..',
  '..OBBBBBBBOO.',
  '..OBBBBBBBOO.',
  '..OBBBBBBBOO.',
  '..OOBBBBBOO..',
  '..OO.OOO.OO..',
  '..OO.OLL.OO..',
  '..OO.OLL.OO..',
  '..OO.OLL.OO..',
  '..OO.OLL.OO..',
  '....OSSSO....',
];

function drawPixelDoll(worldTheme) {
  const canvas = document.getElementById('pixel-doll');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pal = WORLD_PALETTES[worldTheme] || WORLD_PALETTES.default;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const colorMap = { S: pal.skin, H: pal.hair, B: pal.body, L: pal.legs, O: pal.outline, '.': null };



  const pw = 3, ph = 3;
  // Центрируем спрайт на canvas 48x72
  const spriteW = CHAR_SPRITE[0].length * pw;
  const spriteH = CHAR_SPRITE.length * ph;
  const offsetX = Math.floor((W - spriteW) / 2);
  const offsetY = Math.floor((H - spriteH) / 2) - 4;

  CHAR_SPRITE.forEach((row, ry) => {
    for (let cx = 0; cx < row.length; cx++) {
      const ch = row[cx];
      const col = colorMap[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(offsetX + cx * pw, offsetY + ry * ph, pw, ph);
    }
  });


}

// Портрет (32x32 пикселей)
const PORTRAIT_SPRITES = {
  // Базовые лица по классам
  warrior:  ['........','..OOOO..','..SSSSO.','..SHSSO.','..SSSSO.','..OBBO..','...OO...','........'],
  mage:     ['..HHHH..','..OHSSO.','..SHSSO.','..SSSSO.','..OBBO..','...OO...','........','........'],
  rogue:    ['........','...OOO..','..OSSSO.','..SHSHO.','..SSSSO.','..OBBO..','...OO...','........'],
  default:  ['........','..OOOO..','..SSSSO.','..SHSHO.','..SSSSO.','..OBBO..','...OO...','........'],
};

const PORTRAIT_BG = {
  morrowind:'#2a1a10', lotr:'#101a08', hp:'#180818', witcher:'#101010',
  starwars:'#020410', lego:'#201000', alice:'#100818', stardew:'#081408', default:'#0e0e14',
};

// SW character -> sprite id mapping
const SW_CHAR_SPRITES = {
  'Оби-Ван Кеноби': 'sw-obiwan',
  'Джанго Фетт':    'sw-jango',
  'Энакин Скайуокер':'sw-anakin',
  'Палпатин':       'sw-palpatine',
};

function drawPortraitSVG(canvasId, spriteId) {
  // Replace canvas with inline SVG for SW characters
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentNode;
  // Remove old SVG portrait if exists
  const oldSvg = parent.querySelector('.sw-portrait-svg');
  if (oldSvg) oldSvg.remove();
  // Create SVG element
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const size = canvasId === 'portrait-canvas-m' ? '28' : '32';
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 32 34');
  svg.classList.add('sw-portrait-svg');
  svg.style.cssText = 'filter:drop-shadow(0 0 4px rgba(0,150,255,0.6));flex-shrink:0;';
  // Background
  const bg = document.createElementNS(svgNS, 'rect');
  bg.setAttribute('width','32'); bg.setAttribute('height','34');
  bg.setAttribute('rx','4'); bg.setAttribute('fill','#020A18');
  svg.appendChild(bg);
  // Use sprite
  const use = document.createElementNS(svgNS, 'use');
  use.setAttribute('href', '#' + spriteId);
  svg.appendChild(use);
  // Border
  const border = document.createElementNS(svgNS, 'rect');
  border.setAttribute('width','31'); border.setAttribute('height','33');
  border.setAttribute('rx','4'); border.setAttribute('fill','none');
  border.setAttribute('stroke','#0066AA'); border.setAttribute('stroke-width','1');
  svg.appendChild(border);
  // Replace or hide canvas
  canvas.style.display = 'none';
  parent.insertBefore(svg, canvas);
}

function drawPortrait(worldTheme, charClass) {
  // For starwars — use SVG sprites
  if (worldTheme === 'starwars') {
    const spriteId = SW_CHAR_SPRITES[charClass] || 'sw-obiwan';
    drawPortraitSVG('portrait-canvas', spriteId);
    drawPortraitSVG('portrait-canvas-m', spriteId);
    return;
  }
  // Restore canvas if switching away from SW
  ['portrait-canvas','portrait-canvas-m'].forEach(id => {
    const c = document.getElementById(id);
    if (c) c.style.display = '';
    const oldSvg = c?.parentNode?.querySelector('.sw-portrait-svg');
    if (oldSvg) oldSvg.remove();
  });

  const canvas = document.getElementById('portrait-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pal = WORLD_PALETTES[worldTheme] || WORLD_PALETTES.default;
  const bg  = PORTRAIT_BG[worldTheme] || PORTRAIT_BG.default;
  ctx.clearRect(0, 0, 32, 32);

  // Фон
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 32, 32);

  // Декоративная рамка
  ctx.fillStyle = pal.outline;
  ctx.fillRect(0, 0, 32, 1); ctx.fillRect(0, 31, 32, 1);
  ctx.fillRect(0, 0, 1, 32); ctx.fillRect(31, 0, 1, 32);

  // Выбираем спрайт
  const spriteKey = charClass?.toLowerCase().includes('маг')||charClass?.toLowerCase().includes('mag') ? 'mage'
    : charClass?.toLowerCase().includes('разбой')||charClass?.toLowerCase().includes('rogue') ? 'rogue'
    : charClass?.toLowerCase().includes('воин')||charClass?.toLowerCase().includes('war') ? 'warrior'
    : 'default';
  const sprite = PORTRAIT_SPRITES[spriteKey] || PORTRAIT_SPRITES.default;
  const colorMap = { S: pal.skin, H: pal.hair, O: pal.outline, B: pal.body, '.': null };
  const pw = 3, startX = 8, startY = 10;

  sprite.forEach((row, ry) => {
    for (let cx = 0; cx < row.length; cx++) {
      const col = colorMap[row[cx]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(startX + cx * pw, startY + ry * pw, pw, pw);
    }
  });

  // Орнамент под миром — уголки
  ctx.fillStyle = pal.accent || pal.body;
  [[2,2],[27,2],[2,27],[27,27]].forEach(([x,y])=>{
    ctx.fillRect(x,y,3,1); ctx.fillRect(x,y,1,3);
  });
}

function updatePixelArt() {
  const theme = document.body.className.match(/theme-(\S+)/)?.[1] || 'default';
  drawPortrait(theme, document.getElementById('portrait-class')?.textContent);
  drawPixelDoll(theme);
}

// Начальный рендер пустых панелей
renderAllPanels();

// ══ МОБАЙЛ: панель всегда открыта, синхронизация при ресайзе ══
window.addEventListener('resize', syncMobilePanels);

// ══ ЗВЁЗДНЫЕ ВОЙНЫ: анимация кораблей ══
(function initSWShips(){
  // dir: 1=left→right, -1=right→left, 0=random each pass
  const SHIPS = [
    { id:'sw-ship-xwing',      w:70,  h:36, speed:24, yFrac:0.10, opacity:0.40 },
    { id:'sw-ship-bwing',      w:64,  h:36, speed:14, yFrac:0.25, opacity:0.30 },
    { id:'sw-ship-tiefighter', w:44,  h:32, speed:18, yFrac:0.40, opacity:0.32 },
    { id:'sw-ship-falcon',     w:56,  h:36, speed:11, yFrac:0.58, opacity:0.28 },
    { id:'sw-ship-deathstar',  w:50,  h:50, speed:5,  yFrac:0.72, opacity:0.20 },
    { id:'sw-ship-xwing',      w:54,  h:28, speed:30, yFrac:0.18, opacity:0.28 },
    { id:'sw-ship-tiefighter', w:36,  h:28, speed:22, yFrac:0.85, opacity:0.22 },
    { id:'sw-ship-bwing',      w:48,  h:30, speed:16, yFrac:0.65, opacity:0.18 },
  ];
  let container = null;
  const shipEls = [];

  function createShips(){
    if (document.body.className.indexOf('theme-starwars') === -1) return;
    if (container) return;
    container = document.createElement('div');
    container.id = 'sw-ships-layer';
    container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden;';
    document.body.appendChild(container);

    const vw = window.innerWidth;
    SHIPS.forEach((s, i) => {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', s.w);
      svg.setAttribute('height', s.h);
      svg.setAttribute('viewBox', s.dir === 1 ? `0 0 ${s.w} ${s.h}` : `0 0 ${s.w} ${s.h}`);
      svg.style.cssText = `position:absolute;opacity:${s.opacity};`;
      if (s.dir === -1) svg.setAttribute('transform', 'scale(-1,1)');

      const use = document.createElementNS(ns, 'use');
      use.setAttribute('href', '#' + s.id);
      svg.appendChild(use);
      container.appendChild(svg);

      // Random start position
      // Random direction each ship
      const dir = Math.random() > 0.5 ? 1 : -1;
      const startX = dir === 1
        ? -(s.w + Math.random() * vw * 0.5)
        : vw + Math.random() * vw * 0.5;
      const speed = s.speed * (0.7 + Math.random() * 0.6);

      shipEls.push({
        el: svg, s, dir,
        x: startX,
        y: window.innerHeight * s.yFrac + (Math.random() - 0.5) * 60,
        vx: speed * dir,
      });
    });
    animate();
  }

  function animate(){
    if (!container) return;
    if (document.body.className.indexOf('theme-starwars') === -1) {
      destroyShips(); return;
    }
    const vw = window.innerWidth;
    shipEls.forEach(obj => {
      obj.x += obj.vx * 0.016;
      // Wrap + pick new random direction on each pass
      if (obj.dir === 1 && obj.x > vw + obj.s.w + 20) {
        obj.dir = Math.random() > 0.5 ? 1 : -1;
        obj.x   = obj.dir === 1 ? -obj.s.w - 10 : vw + obj.s.w + 10;
        obj.y   = window.innerHeight * obj.s.yFrac + (Math.random()-0.5)*80;
        obj.vx  = obj.s.speed * obj.dir * (0.7 + Math.random()*0.6);
      } else if (obj.dir === -1 && obj.x < -(obj.s.w + 20)) {
        obj.dir = Math.random() > 0.5 ? 1 : -1;
        obj.x   = obj.dir === 1 ? -obj.s.w - 10 : vw + obj.s.w + 10;
        obj.y   = window.innerHeight * obj.s.yFrac + (Math.random()-0.5)*80;
        obj.vx  = obj.s.speed * obj.dir * (0.7 + Math.random()*0.6);
      }
      obj.el.style.top = obj.y + 'px';
      if (obj.dir === -1) {
        obj.el.style.left      = (obj.x - obj.s.w) + 'px';
        obj.el.style.transform = 'scaleX(-1)';
      } else {
        obj.el.style.left      = obj.x + 'px';
        obj.el.style.transform = '';
      }
    });
    requestAnimationFrame(animate);
  }

  function destroyShips(){
    if (container) { container.remove(); container = null; shipEls.length = 0; }
  }

  // Start when theme is applied
  const observer = new MutationObserver(() => {
    if (document.body.className.indexOf('theme-starwars') !== -1) {
      if (!container) setTimeout(createShips, 100);
    } else {
      destroyShips();
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Also start if already on SW theme
  if (document.body.className.indexOf('theme-starwars') !== -1) {
    setTimeout(createShips, 300);
  }
})();

// Экспорт в window для onclick
window.openNakazy  = openNakazy;
window.closeNakazy = closeNakazy;
window.saveNakazy  = saveNakazy;
window.goToMenu    = goToMenu;
window._choice     = _choice;
window._roll       = _roll;
window._retry      = _retry;
window._toggleCustomAction = _toggleCustomAction;
window._sendCustomAction   = _sendCustomAction;
