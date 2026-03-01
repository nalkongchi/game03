const {
  SAVE_KEY,
  IMG,
  SOLO_ENDING,
  NPCS,
  MINI_ROMANCE,
  EXTRA_MINI_ROMANCE,
  ACTS,
  SHOP,
  RANDS,
  DATE_EVS,
  RANDOM_NPC_EVENTS,
  MAIN_ENDINGS,
  ROMANCE_ENDINGS
} = window.MAGE_DATA;

let G={};
let alloc={mana:5,know:5,body:5,social:5};
let _q=[],_qi=0,_evCb=null,_lvCb=null,_lvNpc=null,_lvMark=null,_warnCb=null,_lvRes=[];
let bgmEnabled=true;
let bgmPrimed=false;
let activeModalId=null;
let lastFocusedBeforeModal=null;

const SAVE_KEYS=[SAVE_KEY,'mageAcad_v7_1','mageAcad_v7','mageAcad_v6','mageAcad_v5','mageAcad_v4','mageAcad_v3','mageAcad_v2'];
const MODAL_IDS=['ev-modal','lv-modal','date-modal','npc-modal','me-modal','warn-modal'];

function baseCounts(){return{job:0,class:0,social:0,free:0,forbidden:0,dates:0,scholarship:0,burnout:0,debt:0,byAct:{}};}
function calcPts(){return 40-(alloc.mana+alloc.know+alloc.body+alloc.social);}
function clamp(v,mn=0,mx=100){return Math.max(mn,Math.min(mx,v));}
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const next=document.getElementById(id);
  if(next) next.classList.add('active');
  requestAnimationFrame(()=>{
    syncLayoutOffsets();
    toggleScrollTopButton();
  });
}

function getYear(){return Math.ceil(G.turn/12)}
function getMonth(){return ((G.turn-1)%12)+1}
function getSeason(){const m=getMonth();if(m<=3)return['봄','sp'];if(m<=6)return['여름','su'];if(m<=9)return['가을','au'];return['겨울','wi'];}
function isDateSlot(v){return typeof v==='string'&&v.startsWith('date:')}
function getActById(id){return ACTS.find(a=>a.id===id)}
function getAvailableActs(){return ACTS.filter(a=>getYear()>=(a.unlock||1))}


function ensureStoryState(){
  if(!G.story) G.story={lastNpc:null,lastMiniNpc:null,lastDeepTurn:0,lastSeen:{}};
  if(!G.story.lastSeen) G.story.lastSeen={};
}

function choiceGainLabel(v){
  if(v>=5) return '크게 가까워짐';
  if(v>=3) return '조금 더 가까워짐';
  if(v>=1) return '분위기 호전';
  return '큰 변화 없음';
}

function getNextStoryThreshold(npcId,currentHeart){
  const list=(RANDOM_NPC_EVENTS?.[npcId]||[]).map(ev=>ev.minH).filter(v=>v>currentHeart);
  if(!list.length) return null;
  return Math.min(...list);
}

function weightedPick(arr,getWeight){
  const total=arr.reduce((sum,item)=>sum+Math.max(0,getWeight(item)),0);
  if(total<=0) return arr[Math.floor(Math.random()*arr.length)];
  let roll=Math.random()*total;
  for(const item of arr){
    roll-=Math.max(0,getWeight(item));
    if(roll<=0) return item;
  }
  return arr[arr.length-1];
}

function maybeQueueRandomNpcStory(mark){
  ensureStoryState();
  const pool=[];
  for(const npc of NPCS){
    if(!npc.meet(G.turn)) continue;
    const heart=G.npc[npc.id]||0;
    const list=RANDOM_NPC_EVENTS?.[npc.id]||[];
    for(const ev of list){
      if(heart < (ev.minH??0) || heart > (ev.maxH??100)) continue;
      const seenTurn=G.story.lastSeen?.[ev.id] ?? -999;
      if(G.turn - seenTurn < 5) continue;
      if(G.story.lastNpc===npc.id && G.turn-seenTurn < 8) continue;
      if(ev.kind==='branch' && G.turn - (G.story.lastDeepTurn||0) < 2) continue;
      pool.push({npc,ev});
    }
  }
  if(!pool.length) return;
  if(Math.random()>=0.68) return;
  const picked=weightedPick(pool,item=>{
    const heart=G.npc[item.npc.id]||0;
    const balanceBonus=Math.max(0,28-heart)*0.9;
    const deepBonus=item.ev.kind==='branch' ? 6 : 0;
    return (item.ev.weight||15)+balanceBonus+deepBonus;
  });
  G.story.lastNpc=picked.npc.id;
  G.story.lastSeen[picked.ev.id]=G.turn;
  if(picked.ev.kind==='branch') G.story.lastDeepTurn=G.turn;
  _q.push({type:'npc',npc:picked.npc,ev:picked.ev,mark});
}

function applyEff(eff){for(const[k,v]of Object.entries(eff||{})){if(k==='fat')G.fatigue=clamp(G.fatigue+v);else if(k==='gold')G.gold=Math.max(0,G.gold+v);else if(G.stats[k]!==undefined)G.stats[k]=Math.max(0,G.stats[k]+v);}}
function addLog(txt,cls='',mark=null){const label=mark||`${getYear()}년 ${getMonth()}월`;G.log.unshift({mark:label,txt,cls});if(G.log.length>60)G.log.pop();renderLog();}
function renderLog(){const p=document.getElementById('log-panel');let h='<div class="px9" style="color:var(--dim);margin-bottom:8px">— 최근 기록 —</div>';G.log.slice(0,28).forEach(item=>{h+=`<div class="le${item.cls?` le-${item.cls}`:''}">[${item.mark}] ${item.txt}</div>`});p.innerHTML=h;}

function initGame(name,stats){G={name,turn:1,totalTurns:60,gold:240,fatigue:0,stats:{mana:stats.mana,know:stats.know,body:stats.body,social:stats.social},npc:{leon:0,cassian:0,saren:0,vain:0,elias:0,jaiden:0,oliver:0},counts:baseCounts(),selAM:null,selPM:null,forcedRest:false,triggered:{},story:{lastNpc:null,lastMiniNpc:null,lastDeepTurn:0,lastSeen:{}},log:[],activeTab:'train',collapsed:{job:true,class:true,social:true,free:true}};}
function normalizeGameState(src){const counts=Object.assign(baseCounts(),src.counts||{});counts.byAct=counts.byAct||{};const story=src.story||{};return{name:src.name||'아리아',turn:Math.max(1,src.turn||1),totalTurns:60,gold:Math.max(0,src.gold??240),fatigue:clamp(src.fatigue??0),stats:{mana:Math.max(0,src.stats?.mana??5),know:Math.max(0,src.stats?.know??5),body:Math.max(0,src.stats?.body??5),social:Math.max(0,src.stats?.social??5)},npc:{leon:clamp(src.npc?.leon??0),cassian:clamp(src.npc?.cassian??0),saren:clamp(src.npc?.saren??0),vain:clamp(src.npc?.vain??0),elias:clamp(src.npc?.elias??0),jaiden:clamp(src.npc?.jaiden??0),oliver:clamp(src.npc?.oliver??0)},counts,selAM:src.selAM??null,selPM:src.selPM??null,forcedRest:!!src.forcedRest,triggered:src.triggered||{},story:{lastNpc:story.lastNpc??null,lastMiniNpc:story.lastMiniNpc??null,lastDeepTurn:story.lastDeepTurn??0,lastSeen:story.lastSeen||{}},log:Array.isArray(src.log)?src.log:[],activeTab:src.activeTab||'train',collapsed:src.collapsed||{job:true,class:true,social:true,free:true}};}
function migrateLegacySave(old){return normalizeGameState({name:old.name,turn:old.turn,totalTurns:60,gold:old.gold,fatigue:old.fatigue,stats:old.stats,npc:old.npc,forcedRest:old.forcedRest,triggered:old.triggered,log:(old.log||[]).map(item=>typeof item==='string'?{mark:'기록',txt:item,cls:''}:{mark:item.mark||'기록',txt:item.txt||'',cls:item.cls||''})});}
function saveGame(){if(Object.keys(G).length)localStorage.setItem(SAVE_KEY,JSON.stringify(G));}
function clearSave(){
  SAVE_KEYS.forEach(k=>localStorage.removeItem(k));
  refreshLoadButton();
}

function refreshLoadButton(){
  const loadBtn=document.getElementById('load-btn');
  if(!loadBtn) return;
  loadBtn.style.display=SAVE_KEYS.some(k=>localStorage.getItem(k)) ? 'inline-block' : 'none';
}

function safeParseSave(key){
  const raw=localStorage.getItem(key);
  if(!raw) return null;
  try{
    return { key, data: JSON.parse(raw) };
  }catch(err){
    console.warn(`손상된 저장 데이터 제거: ${key}`, err);
    localStorage.removeItem(key);
    return { key, error: err };
  }
}

function renderTextLines(container, lines){
  if(!container) return;
  container.replaceChildren(...lines.map(text=>{
    const row=document.createElement('div');
    row.textContent=text;
    return row;
  }));
}

function syncLayoutOffsets(){
  const root=document.documentElement;
  const hud=document.querySelector('#screen-game .hud-wrap');
  const tabbar=document.getElementById('game-tabbar');
  const hudHeight=hud ? Math.ceil(hud.getBoundingClientRect().height) : 0;
  const tabHeight=tabbar ? Math.ceil(tabbar.getBoundingClientRect().height) : 0;
  root.style.setProperty('--hud-offset', `${hudHeight}px`);
  root.style.setProperty('--tabbar-offset', `${tabHeight}px`);
  toggleScrollTopButton();
}

function scrollToTopNow(){
  window.scrollTo({top:0,behavior:'smooth'});
}

function toggleScrollTopButton(){
  const btn=document.getElementById('scroll-top-btn');
  const gameScreen=document.getElementById('screen-game');
  if(!btn || !gameScreen) return;
  const shouldShow=gameScreen.classList.contains('active') && window.scrollY>220;
  btn.classList.toggle('show', shouldShow);
  btn.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

function getFocusableElements(scope){
  return [...scope.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter(el=>!el.disabled && el.offsetParent !== null);
}

function getTopOpenModal(){
  return [...MODAL_IDS].reverse().find(id=>document.getElementById(id)?.classList.contains('open')) || null;
}

function openModal(id){
  const overlay=document.getElementById(id);
  if(!overlay) return;
  lastFocusedBeforeModal=document.activeElement instanceof HTMLElement ? document.activeElement : null;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden','false');
  activeModalId=id;
  const dialog=overlay.querySelector('.modal');
  requestAnimationFrame(()=>{
    const focusables=getFocusableElements(overlay);
    const target=focusables[0] || dialog || overlay;
    if(target && typeof target.focus==='function') target.focus();
  });
}

function closeModalById(id,{restoreFocus=true}={}){
  const overlay=document.getElementById(id);
  if(!overlay) return;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden','true');
  activeModalId=getTopOpenModal();
  if(restoreFocus && lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal)){
    const target=lastFocusedBeforeModal;
    lastFocusedBeforeModal=null;
    if(typeof target.focus==='function') target.focus();
  }else if(!activeModalId){
    lastFocusedBeforeModal=null;
  }
}

function requestModalClose(id=getTopOpenModal()){
  if(!id) return false;
  if(id==='ev-modal') closeEvModal();
  else if(id==='lv-modal') closeLvModal();
  else if(id==='date-modal') closeDateModal();
  else if(id==='npc-modal') closeNpcModal();
  else if(id==='me-modal') closeMeModal();
  else if(id==='warn-modal') closeWarnModal(false);
  else closeModalById(id);
  return true;
}

function trapModalFocus(event){
  const topId=getTopOpenModal();
  if(!topId || event.key!=='Tab') return;
  const overlay=document.getElementById(topId);
  if(!overlay) return;
  const focusables=getFocusableElements(overlay);
  if(!focusables.length){
    event.preventDefault();
    overlay.querySelector('.modal')?.focus();
    return;
  }
  const first=focusables[0];
  const last=focusables[focusables.length-1];
  if(event.shiftKey && document.activeElement===first){
    event.preventDefault();
    last.focus();
  }else if(!event.shiftKey && document.activeElement===last){
    event.preventDefault();
    first.focus();
  }
}

function handleDelegatedClick(event){
  const trigger=event.target.closest('[data-action]');
  if(!trigger) return;
  const action=trigger.dataset.action;
  if(action==='open-me'){
    tryStartBgm();
    openMeModal(trigger.dataset.fromCreate==='true');
  }else if(action==='adjust-stat'){
    adj(trigger.dataset.stat, Number(trigger.dataset.delta || 0));
  }else if(action==='toggle-category'){
    toggleCat(trigger.dataset.category);
  }else if(action==='select-activity'){
    selAct(trigger.dataset.activityId);
  }else if(action==='open-npc'){
    openNpcModal(trigger.dataset.npcId);
  }else if(action==='buy-item'){
    buyItem(trigger.dataset.itemId);
  }else if(action==='pick-choice'){
    pickNpcChoice(Number(trigger.dataset.choiceIndex));
  }else if(action==='close-love-modal'){
    closeLvModal();
  }else if(action==='start-date'){
    startDate(trigger.dataset.npcId);
  }else if(action==='scroll-top'){
    scrollToTopNow();
  }
}

function handleDelegatedKeydown(event){
  if(event.key==='Escape' && requestModalClose()){
    event.preventDefault();
    return;
  }
  if(event.key==='Tab'){
    trapModalFocus(event);
    return;
  }
  if(event.key!=='Enter' && event.key!==' ') return;
  const trigger=event.target.closest('[data-action]');
  if(!trigger) return;
  const tag=trigger.tagName;
  if(tag==='BUTTON' || tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT' || tag==='A') return;
  event.preventDefault();
  trigger.click();
}

function setupModalAccessibility(){
  MODAL_IDS.forEach(id=>{
    const overlay=document.getElementById(id);
    if(!overlay) return;
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-hidden','true');
    const dialog=overlay.querySelector('.modal');
    if(dialog) dialog.setAttribute('tabindex','-1');
    overlay.addEventListener('click',event=>{
      if(event.target===event.currentTarget) requestModalClose(id);
    });
  });
}

function getBgm(){return document.getElementById('bgm')}
function updateBgmButton(isPlaying){
  const btn=document.getElementById('bgm-toggle');
  if(!btn) return;
  if(bgmEnabled&&isPlaying){
    btn.textContent='🎵 BGM ON';
    btn.classList.remove('off');
  }else{
    btn.textContent='🔇 BGM OFF';
    btn.classList.add('off');
  }
}
async function tryStartBgm(force=false){
  const bgm=getBgm();
  if(!bgm) return false;
  if(!bgmEnabled && !force){
    updateBgmButton(false);
    return false;
  }
  bgm.volume=.35;
  try{
    await bgm.play();
    bgmPrimed=true;
    updateBgmButton(true);
    return true;
  }catch(err){
    updateBgmButton(!bgm.paused);
    return false;
  }
}
function stopBgm(){
  const bgm=getBgm();
  if(!bgm) return;
  bgm.pause();
  updateBgmButton(false);
}
async function toggleBgm(){
  const bgm=getBgm();
  if(!bgm) return;
  if(!bgmEnabled || bgm.paused){
    bgmEnabled=true;
    await tryStartBgm(true);
  }else{
    bgmEnabled=false;
    stopBgm();
  }
}
function primeBgmFromGesture(){
  if(bgmPrimed || !bgmEnabled) return;
  tryStartBgm();
}
function initBgm(){
  updateBgmButton(false);
  document.addEventListener('pointerdown', primeBgmFromGesture, true);
  document.addEventListener('keydown', primeBgmFromGesture, true);
}

function startCreate(){alloc={mana:5,know:5,body:5,social:5};document.getElementById('char-name').value='';showScreen('screen-create');renderAlloc();}
function renderAlloc(){
  const defs=[['mana','✨ 마력','s-mana'],['know','📚 지식','s-know'],['body','💪 체력','s-body'],['social','💬 사교','s-soc']];
  let h='';
  for(const[k,lbl,cls]of defs){
    const v=alloc[k];
    h+=`<div class="srow ${cls}"><span class="slbl">${lbl}</span><div class="sbw"><div class="sbf" style="width:${v*2.5}%"></div></div><span class="sn">${v}</span><button class="sbtn" type="button" data-action="adjust-stat" data-stat="${k}" data-delta="-1">−</button><button class="sbtn" type="button" data-action="adjust-stat" data-stat="${k}" data-delta="1">+</button></div>`;
  }
  document.getElementById('stat-alloc').innerHTML=h;
  document.getElementById('pts').textContent=calcPts();
}

function adj(k,d){const pts=calcPts();if(d>0&&pts<=0)return;if(d<0&&alloc[k]<=1)return;alloc[k]+=d;renderAlloc();}
function randomizeAlloc(){let remain=40;const keys=['mana','know','body','social'];alloc={mana:1,know:1,body:1,social:1};remain-=4;while(remain>0){alloc[keys[Math.floor(Math.random()*keys.length)]]++;remain--;}renderAlloc();}
function confirmCreate(){const name=document.getElementById('char-name').value.trim()||'아리아';initGame(name,{...alloc});startGame();}

function startGame(){showScreen('screen-game');if(!G.activeTab)G.activeTab='train';renderAll();}
function setTab(tab,{save=true}={}){
  G.activeTab=tab;
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  const panel=document.getElementById(`tab-${tab}`);
  if(panel) panel.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  if(save) saveGame();
}
function renderAll(){
  renderHUD();
  renderTrain();
  renderRelations();
  renderShop();
  renderStatus();
  renderLog();
  setTab(G.activeTab||'train',{save:false});
  saveGame();
  syncLayoutOffsets();
}

function renderHUD(){
  document.getElementById('hd-name').textContent=G.name;
  document.getElementById('hd-gold').textContent=G.gold;
  document.getElementById('hd-prog').style.width=(Math.min(G.turn,G.totalTurns)/G.totalTurns*100)+'%';
  document.getElementById('hd-turn').textContent=Math.min(G.turn,G.totalTurns)+'/'+G.totalTurns;
  const[sn,sc]=getSeason();
  document.getElementById('hd-date').textContent=`${getYear()}년차 ${getMonth()}월`;
  document.getElementById('hd-season').innerHTML=`<span class="stag ${sc}">${sn}</span>`;
  
  const fat = G.fatigue;
  const fatEl = document.getElementById('hd-fatigue-txt');
  fatEl.textContent = fat;
  fatEl.style.color = fat >= 80 ? 'var(--red)' : fat >= 50 ? 'var(--ora)' : 'var(--grn)';
}

function slotText(v){if(!v)return{txt:'선택 안 함',empty:true};if(isDateSlot(v)){const npc=NPCS.find(n=>n.id===v.split(':')[1]);return{txt:npc?`💕 ${npc.name} 데이트`:'💕 데이트',empty:false};}const a=getActById(v);return a?{txt:`${a.icon} ${a.name}`,empty:false}:{txt:'선택 안 함',empty:true};}
function getComboPreview(am,pm){const out={mana:0,know:0,body:0,social:0,gold:0,heart:0,notes:[]};if(!am||!pm||isDateSlot(am)||isDateSlot(pm))return out;const pair=[am,pm].sort().join('|');if(pair==['alchemy_assist','alchemy_practicum'].sort().join('|')){out.mana+=1;out.know+=1;out.gold+=5;out.notes.push('연금 시너지');}else if(pair==['wall_guard','martial_basics'].sort().join('|')){out.body+=1;out.notes.push('전투 시너지');}else if(pair==['banquet_service','royal_tea'].sort().join('|')){out.social+=2;out.notes.push('궁정 인맥 시너지');}else if(pair==['market_delivery','night_market'].sort().join('|')){out.social+=1;out.gold+=8;out.notes.push('시장 인맥 시너지');}else if(pair==['library_sorting','ancient_texts'].sort().join('|')){out.know+=1;out.notes.push('연구 시너지');}else if(pair==['forbidden_decoding','secret_archive'].sort().join('|')){out.mana+=2;out.know+=1;out.notes.push('금지 지식 공명');}return out;}
function getDatePreview(npcId){const evList=DATE_EVS[npcId]||[];return evList.filter(e=>G.npc[npcId]>=e.req).pop()||{fat:8,h:5};}
function getPreviewResult(){const res={mana:0,know:0,body:0,social:0,gold:0,fat:0,heart:0,notes:[]};for(const slot of [G.selAM,G.selPM]){if(!slot)continue;if(isDateSlot(slot)){const npcId=slot.split(':')[1],ev=getDatePreview(npcId);res.fat+=(ev.fat||8);res.heart+=(ev.h||5);const npc=NPCS.find(n=>n.id===npcId);if(npc)res.notes.push(`${npc.name} 호감도 +${ev.h||5}`);}else{const a=getActById(slot);if(!a)continue;for(const[k,v]of Object.entries(a.stat||{}))res[k]+=v;res.gold+=(a.gold||0);res.fat+=(a.fat||0);}}
const combo=getComboPreview(G.selAM,G.selPM);['mana','know','body','social','gold','heart'].forEach(k=>res[k]+=combo[k]||0);res.notes.push(...combo.notes);res.gold-=10;res.endGold=Math.max(0,G.gold+res.gold);res.endFat=clamp(G.fatigue+res.fat);res.forced=res.endFat>=90;return res;}

function fmtChange(k, v) {
  if (!v) return '';
  const labels = { mana:'마력', know:'지식', body:'체력', social:'사교', gold:'골드', fat:'피로' };
  const lbl = labels[k] || k;
  const sign = v > 0 ? '+' : '';
  const isGood = k === 'fat' ? v < 0 : v > 0;
  const cls = isGood ? 'c-pos' : 'c-neg';
  return `<span class="${cls}">${lbl} ${sign}${v}</span>`;
}

function fmtPreviewStat(k, v) {
  if (!v) return '';
  const labels = { mana:'마력', know:'지식', body:'체력', social:'사교', gold:'골드', fat:'피로' };
  const lbl = labels[k] || k;
  const sign = v > 0 ? '+' : '';
  const isGood = k === 'fat' ? v < 0 : v > 0;
  const cls = isGood ? 'c-pos' : 'c-neg';
  return `<div class="preview-stat ${cls}">${lbl} ${sign}${v}</div>`;
}

function renderPreview(){const p=getPreviewResult();const chosen=!!(G.selAM||G.selPM);const main=document.getElementById('preview-main');const sub=document.getElementById('preview-sub');if(!chosen){main.innerHTML='<div class="preview-empty">활동을 고르면 예상 변화가 표시돼요.</div>';sub.innerHTML='';sub.className='preview-sub';return;}
  const parts=[fmtPreviewStat('mana',p.mana),fmtPreviewStat('know',p.know),fmtPreviewStat('body',p.body),fmtPreviewStat('social',p.social),fmtPreviewStat('gold',p.gold),fmtPreviewStat('fat',p.fat)].filter(Boolean);
  main.innerHTML=parts.join('') || '<div class="preview-empty c-neu">큰 변화 없음</div>';
  const lines=[
    {txt:`월말 예상 골드 ${p.endGold}G`},
    {txt:`예상 피로 ${p.endFat}/100`}
  ];
  if(p.heart) lines.push({txt:`데이트 포함 호감도 +${p.heart}`,wide:true});
  if(p.notes.length) lines.push({txt:p.notes.join(', '),wide:true});
  if(p.forced) lines.push({txt:'⚠️ 이 상태면 다음 달 강제 휴식 가능',wide:true,warn:true});
  sub.innerHTML=lines.map(line=>`<div class="${line.wide?'span-all ':''}${line.warn?'preview-warn-line':''}">${line.txt}</div>`).join('');
  sub.className='preview-sub';
}

function toggleCat(key) {
  if(!G.collapsed) G.collapsed = {};
  G.collapsed[key] = !G.collapsed[key];
  renderTrain();
  saveGame();
}

function renderTrain(){
  const am=slotText(G.selAM),pm=slotText(G.selPM);
  const amEl=document.getElementById('slot-am'),pmEl=document.getElementById('slot-pm');
  amEl.textContent=am.txt;
  pmEl.textContent=pm.txt;
  amEl.classList.toggle('empty',am.empty);
  pmEl.classList.toggle('empty',pm.empty);
  document.getElementById('m-info').textContent=G.forcedRest?`⚠️ ${getYear()}년차 ${getMonth()}월 — 강제 휴식 (활동 불가)`:`${getYear()}년차 ${getMonth()}월 — 이달의 활동을 선택하세요`;
  if(G.forcedRest){
    document.getElementById('act-grid').innerHTML='<div class="cat-head" role="note">🛌 이달은 강제 휴식입니다.</div>';
    renderPreview();
    return;
  }

  const groups=[
    {key:'job',label:'🧹 아르바이트 — 돈 벌기 / 성장 적음'},
    {key:'class',label:'📚 수업 — 돈 쓰기 / 성장 큼'},
    {key:'social',label:'🎭 사교 — 돈 쓰기 / 호감도업'},
    {key:'free',label:'😴 무료 행동 — 회복 / 소성장'}
  ];

  let h='';
  for(const g of groups){
    const list=getAvailableActs().filter(a=>a.type===g.key);
    if(!list.length) continue;
    const isCol=G.collapsed && G.collapsed[g.key];

    h+=`<div class="cat-wrap">`;
    h+=`<div class="cat-head ${isCol ? 'collapsed' : ''}" data-action="toggle-category" data-category="${g.key}" role="button" tabindex="0" aria-expanded="${String(!isCol)}">${g.label}</div>`;
    h+=`<div class="cat-body ${isCol ? 'collapsed' : ''}" id="cat-${g.key}">`;

    for(const a of list){
      const selected=G.selAM===a.id||G.selPM===a.id;
      const disabled=!(a.gold<0&&G.gold<Math.abs(a.gold));

      const st=[];
      for(const[k,v] of Object.entries(a.stat||{})) st.push(fmtChange(k,v));
      if(a.gold) st.push(fmtChange('gold',a.gold));
      if(a.fat) st.push(fmtChange('fat',a.fat));

      const statStr=st.length ? st.join(' ') : '<span class="c-neu">변화 없음</span>';
      h+=`<button class="ab${selected?' sel':''}${disabled?'':' dis'}" type="button" data-action="select-activity" data-activity-id="${a.id}"><span class="ai">${a.icon}</span><span class="an">${a.name}</span><span class="ac">${statStr}</span></button>`;
    }
    h+=`</div></div>`;
  }

  document.getElementById('act-grid').innerHTML=h;

  let anyDate=false;
  for(const npc of NPCS){
    if(G.npc[npc.id]>=25&&npc.meet(G.turn)) anyDate=true;
  }
  const dbt=document.getElementById('date-btn-main');
  if(dbt){
    dbt.style.display=(anyDate && !G.forcedRest) ? 'block' : 'none';
    dbt.textContent=isDateSlot(G.selPM) ? '💕 데이트 대상 변경 (오후)' : '💕 데이트 신청 (오후 슬롯)';
  }

  renderPreview();
}

function selAct(id){if(G.forcedRest)return;const a=getActById(id);if(!a)return;if(a.gold<0&&G.gold<Math.abs(a.gold)){addLog(`💸 ${a.name} 비용이 부족합니다.`,'bad');return;}if(G.selAM===id){G.selAM=null;renderTrain();saveGame();return;}if(G.selPM===id){G.selPM=null;renderTrain();saveGame();return;}const pmIsDate=isDateSlot(G.selPM);if(!G.selAM)G.selAM=id;else if(!G.selPM)G.selPM=id;else if(pmIsDate)G.selAM=id;else{G.selAM=G.selPM;G.selPM=id;}renderTrain();saveGame();}

function renderRelations(){
  let h='',anyDate=false;
  for(const npc of NPCS){
    const met=npc.meet(G.turn),heart=G.npc[npc.id];
    if(heart>=25&&met) anyDate=true;
    const attrs=met ? `data-action="open-npc" data-npc-id="${npc.id}" role="button" tabindex="0"` : '';
    h+=`<div class="nc${met?'':' locked'}" ${attrs}><img src="${IMG[npc.id]}" class="npc-img" alt="${npc.name}"><div style="flex:1;min-width:0"><span class="nn">${npc.name}${met?'':' 🔒'}</span><div class="nh"><div class="nhf" style="width:${heart}%"></div></div></div><span class="hnum">${met?heart:'?'}</span></div>`;
  }
  document.getElementById('npc-list').innerHTML=h;

  const db=document.getElementById('date-btn');
  db.style.display=(anyDate&&!G.forcedRest)?'block':'none';
  db.textContent=isDateSlot(G.selPM)?'💕 데이트 대상 변경 (오후)':'💕 데이트 신청 (오후)';
}

function renderShop(){
  let h='';
  for(const it of SHOP){
    h+=`<div class="sh-item"><div><div class="sh-name">${it.name}</div><div class="sh-desc">${it.desc}</div></div><button class="btn btn-xs" type="button" data-action="buy-item" data-item-id="${it.id}" ${G.gold<it.cost?'disabled':''}>${it.cost}G</button></div>`;
  }
  document.getElementById('shop-list').innerHTML=h;
}

function renderStatus(){const defs=[['mana','✨ 마력','sd-mana'],['know','📚 지식','sd-know'],['body','💪 체력','sd-body'],['social','💬 사교','sd-soc']];let h='';for(const[k,lbl,cls]of defs){const v=Math.min(G.stats[k],100);h+=`<div class="sdr ${cls}"><span class="sdlbl">${lbl}</span><div class="sdb"><div class="sdf" style="width:${v}%"></div></div><span class="sdn">${G.stats[k]}</span></div>`;}document.getElementById('stat-panel').innerHTML=h;document.getElementById('fat-num').textContent=G.fatigue+'/100';const ff=document.getElementById('fat-fill');ff.style.width=G.fatigue+'%';ff.style.background=G.fatigue>=80?'#ff4040':G.fatigue>=50?'#ff9040':'#40e880';let b='';if(G.fatigue>=80)b+='<span class="badge b-bad">⚠️ 과로</span>';else if(G.fatigue>=50)b+='<span class="badge b-warn">😰 피로</span>';else b+='<span class="badge b-ok">✅ 정상</span>';if(G.forcedRest)b+='<span class="badge b-bad">🛌 강제 휴식</span>';if(G.gold<30)b+='<span class="badge b-warn">💸 자금 부족</span>';if(G.counts.forbidden>=3)b+='<span class="badge b-warn">🌑 금지 지식</span>';document.getElementById('badges').innerHTML=b;}

function getEmptySlotWarning(){if(G.forcedRest)return'';const am=!G.selAM,pm=!G.selPM;if(am&&pm)return'오전/오후 활동이 모두 비어 있어요. 이번 달을 그대로 넘길까요?';if(am)return'오전 활동을 선택하지 않았어요. 그대로 진행할까요?';if(pm)return'오후 활동을 선택하지 않았어요. 그대로 진행할까요?';return'';}
function openWarnModal(text,cb){
  document.getElementById('warn-text').textContent=text;
  _warnCb=cb;
  openModal('warn-modal');
}

function closeWarnModal(run=false){
  closeModalById('warn-modal');
  if(run&&_warnCb){
    const f=_warnCb;
    _warnCb=null;
    f();
  }else{
    _warnCb=null;
  }
}

function attemptConfirmMonth(){const msg=getEmptySlotWarning();if(msg){openWarnModal(msg,processMonth);}else processMonth();}

let _monthAM=null,_monthPM=null,_monthMark=null;
function processMonth(){if(!G.forcedRest&&!G.selAM&&!G.selPM){addLog('활동을 최소 1개 선택하세요.');return;} ensureStoryState(); _monthMark=`${getYear()}년 ${getMonth()}월`;_monthAM=G.selAM;_monthPM=G.selPM;_q=[];_qi=0;if(G.forcedRest){G.fatigue=clamp(G.fatigue-45);addLog('🛌 강제 휴식. 피로 −45','good',_monthMark);G.forcedRest=false;}else{for(const slot of [_monthAM,_monthPM]){if(!slot)continue;if(isDateSlot(slot))doDateActivity(slot.split(':')[1],_monthMark);else{const act=getActById(slot);if(act)doActivity(act,_monthMark);}}applyComboBonus(_monthAM,_monthPM,_monthMark);}applyLivingCost(_monthMark);applySemesterScholarship(_monthMark);maybeQueueMiniRomance(_monthMark);maybeQueueRandomNpcStory(_monthMark);if(G.fatigue>=90&&!G.forcedRest){G.forcedRest=true;G.counts.burnout++;_q.push({type:'sys',ico:'🛌',ttl:'과로로 쓰러짐',txt:'극심한 피로로 쓰러졌다. 다음 달은 강제 휴식이다.',tags:['다음 달 강제 휴식'],mark:_monthMark});addLog('⚠️ 과로 쓰러짐! 다음 달 강제 휴식','bad',_monthMark);}if(Math.random()<0.12)_q.push({type:'rand',ev:RANDS[Math.floor(Math.random()*RANDS.length)],mark:_monthMark});G.selAM=null;G.selPM=null;G.turn++;renderAll();runQueue();}
function doActivity(act,mark){if(act.gold<0&&G.gold<Math.abs(act.gold)){addLog(`💸 ${act.name} 비용이 부족해 참여하지 못했다.`,'bad',mark);_q.push({type:'sys',ico:'💸',ttl:'비용 부족',txt:`${act.name} 비용이 부족해 참여하지 못했다.`,tags:['행동 무효'],mark});return;}if(act.fail&&Math.random()<act.fail){for(const[k,v]of Object.entries(act.fstat||{})){if(k==='fat')G.fatigue=clamp(G.fatigue+v);else if(k==='gold')G.gold=Math.max(0,G.gold+v);else G.stats[k]=Math.max(0,(G.stats[k]||0)+v);}addLog('❌ '+act.ftxt,'bad',mark);_q.push({type:'sys',ico:'❌',ttl:'활동 실패',txt:act.ftxt,tags:[],mark});return;}for(const[k,v]of Object.entries(act.stat||{}))G.stats[k]=Math.max(0,(G.stats[k]||0)+v);G.fatigue=clamp(G.fatigue+(act.fat||0));if(act.gold)G.gold=Math.max(0,G.gold+act.gold);G.counts[act.type]=(G.counts[act.type]||0)+1;G.counts.byAct[act.id]=(G.counts.byAct[act.id]||0)+1;if(act.forbidden)G.counts.forbidden++;const statStr=Object.entries(act.stat||{}).map(([k,v])=>({mana:'마력',know:'지식',body:'체력',social:'사교'}[k]+(v>0?'+':'')+v)).join(' ');addLog(`${act.icon} ${act.name}${statStr?' ('+statStr+')':''}${act.gold?((act.gold>0?' +':' ')+act.gold+'G'):''}`,'good',mark);if(act.npc&&Math.random()<(act.nc||0)){const npc=NPCS.find(n=>n.id===act.npc);if(npc&&npc.meet(G.turn)){const gain=act.type==='social'?4:3;G.npc[act.npc]=clamp(G.npc[act.npc]+gain);addLog(`❤️ ${npc.name}와(과) 가까워졌다. 호감도 +${gain}`,'heart',mark);}}}
function doDateActivity(npcId,mark){const npc=NPCS.find(n=>n.id===npcId);if(!npc)return;let ev=(DATE_EVS[npcId]||[]).filter(e=>G.npc[npcId]>=e.req).pop();if(!ev)ev={fat:8,h:5,txt:`${npc.name}와(과) 조용한 시간을 보냈다. 짧았지만 분명히 마음이 가까워졌다.`};G.fatigue=clamp(G.fatigue+(ev.fat||8));G.counts.dates++;_q.push({type:'date',npc,ev,mark});}
function applyComboBonus(am,pm,mark){if(!am||!pm||isDateSlot(am)||isDateSlot(pm))return;const pair=[am,pm].sort().join('|');if(pair===['alchemy_assist','alchemy_practicum'].sort().join('|')){G.stats.mana+=1;G.stats.know+=1;G.gold+=5;addLog('🔗 연금 시너지! 마력 +1, 지식 +1, 골드 +5G','good',mark);}else if(pair===['wall_guard','martial_basics'].sort().join('|')){G.stats.body+=1;G.npc.cassian=clamp(G.npc.cassian+2);addLog('🔗 전투 시너지! 체력 +1, 카시안 호감도 +2','heart',mark);}else if(pair===['banquet_service','royal_tea'].sort().join('|')){G.stats.social+=2;G.npc.leon=clamp(G.npc.leon+2);addLog('🔗 궁정 인맥 시너지! 사교 +2, 레온 호감도 +2','heart',mark);}else if(pair===['market_delivery','night_market'].sort().join('|')){G.stats.social+=1;G.gold+=8;G.npc.saren=clamp(G.npc.saren+2);addLog('🔗 시장 인맥 시너지! 사교 +1, 골드 +8G, 사렌 호감도 +2','heart',mark);}else if(pair===['library_sorting','ancient_texts'].sort().join('|')){G.stats.know+=1;G.npc.oliver=clamp(G.npc.oliver+2);addLog('🔗 연구 시너지! 지식 +1, 올리버 호감도 +2','heart',mark);}else if(pair===['forbidden_decoding','secret_archive'].sort().join('|')){G.stats.mana+=2;G.stats.know+=1;G.counts.forbidden++;G.npc.vain=clamp(G.npc.vain+3);addLog('🔗 금지 지식 공명! 마력 +2, 지식 +1, 베인 호감도 +3','heart',mark);}}
function applyLivingCost(mark){if(G.gold>=10){G.gold-=10;addLog('💸 생활비 10G 차감','bad',mark);}else{G.counts.debt++;G.stats.social=Math.max(0,G.stats.social-2);addLog('⚠️ 생활비 부족! 사교 −2','bad',mark);}if(G.gold===0)G.counts.debt++;}
function applySemesterScholarship(mark){if(G.turn%6!==0)return;const score=G.stats.mana+G.stats.know+G.stats.body+G.stats.social+(G.counts.class*2);let reward=0;if(score>=150)reward=45;else if(score>=120)reward=28;if(reward>0){G.gold+=reward;G.counts.scholarship++;addLog(`🏅 학기 장학금 +${reward}G`,'good',mark);_q.push({type:'sys',ico:'🏅',ttl:'학기 장학금',txt:`이번 학기 성적이 우수하여 장학금 ${reward}G를 받았다.`,tags:[`골드 +${reward}G`],mark});}}
function maybeQueueMiniRomance(mark){
  ensureStoryState();
  const candidates=NPCS.filter(n=>n.meet(G.turn)&&G.npc[n.id]>=12);
  if(!candidates.length||Math.random()>=0.48) return;
  const npc=weightedPick(candidates,n=>{
    const heart=G.npc[n.id]||0;
    const recencyPenalty=G.story.lastMiniNpc===n.id ? 8 : 0;
    return Math.max(6,32-Math.floor(heart/3)-recencyPenalty);
  });
  const lines=[...(MINI_ROMANCE[npc.id]||[]),...(EXTRA_MINI_ROMANCE?.[npc.id]||[])];
  const txt=lines[Math.floor(Math.random()*lines.length)]||'잠깐의 대화가 이상하게 오래 남았다.';
  const heart=G.npc[npc.id]||0;
  const gain=heart<30?3:heart<60?2:1;
  G.story.lastMiniNpc=npc.id;
  _q.push({type:'mini',npc,txt,h:gain,mark});
}
function runQueue(){if(_qi>=_q.length){checkEnding();return;}const item=_q[_qi++];if(item.type==='sys'){showEvModal(item.ico,item.ttl,item.txt,item.tags||[],runQueue,null);}else if(item.type==='rand'){applyEff(item.ev.eff);renderAll();addLog('🌀 '+item.ev.ttl,'ev',item.mark);showEvModal(item.ev.ico,item.ev.ttl,item.ev.txt,item.ev.tags,runQueue,null);}else if(item.type==='mini'){G.npc[item.npc.id]=clamp(G.npc[item.npc.id]+item.h);addLog(`💞 ${item.npc.name}와 작은 순간. 호감도 +${item.h}`,'heart',item.mark);renderAll();showEvModal(item.npc.icon,`${item.npc.name} — 작은 순간`,item.txt,[`호감도 +${item.h}`],runQueue,IMG[item.npc.id]);}else if(item.type==='npc'){showLoveScene(item.npc,item.ev,runQueue,'이벤트',item.mark);}else if(item.type==='date'){showLoveScene(item.npc,item.ev,runQueue,'데이트',item.mark);}}

function showEvModal(ico,ttl,txt,tags,cb,imgSrc=null){
  const evImg=document.getElementById('ev-img');
  if(imgSrc){
    evImg.src=imgSrc;
    evImg.style.display='block';
  }else{
    evImg.style.display='none';
    evImg.removeAttribute('src');
  }
  document.getElementById('ev-ico').textContent=ico;
  document.getElementById('ev-ttl').textContent=ttl;
  document.getElementById('ev-txt').textContent=txt;
  document.getElementById('ev-tags').innerHTML=(tags||[]).map(t=>`<span class="tag ${(String(t).includes('−')||String(t).includes('-'))?'tn':'tp'}">${t}</span>`).join('');
  _evCb=cb;
  openModal('ev-modal');
}

function closeEvModal(){
  closeModalById('ev-modal');
  if(_evCb){
    const f=_evCb;
    _evCb=null;
    renderAll();
    f();
  }
}

function showLoveScene(npc,ev,cb,label='이벤트',mark=null){
  const baseGain=ev.h||0;
  if(baseGain) G.npc[npc.id]=clamp(G.npc[npc.id]+baseGain);
  addLog(`${label==='데이트'?'💕':'💌'} ${npc.name} ${label}! 호감도 +${baseGain}`,'heart',mark);
  renderAll();
  _lvNpc=npc;
  _lvCb=cb;
  _lvMark=mark;
  _lvRes=ev.res||[];
  document.getElementById('lv-img').src=IMG[npc.id];
  document.getElementById('lv-ico').textContent=npc.icon;
  document.getElementById('lv-ttl').textContent=`${npc.name} — ${label}`;
  document.getElementById('lv-txt').textContent=ev.txt;
  const cl=document.getElementById('lv-choices');
  if(ev.choices&&ev.choices.length){
    cl.innerHTML=ev.choices.map((c,i)=>`<button class="chbtn" type="button" data-action="pick-choice" data-choice-index="${i}">${c}</button>`).join('');
  }else{
    cl.innerHTML=`<button class="btn" type="button" data-action="close-love-modal">확인</button>`;
  }
  openModal('lv-modal');
}

function pickNpcChoice(i){
  const res=(_lvRes||[])[i];
  if(!res) return;
  if(_lvNpc){
    G.npc[_lvNpc.id]=clamp(G.npc[_lvNpc.id]+(res.h||0));
    if(res.h){
      addLog(`💬 ${_lvNpc.name} — ${choiceGainLabel(res.h)} (호감도 +${res.h})`,'heart',_lvMark);
    }else{
      addLog(`💬 ${_lvNpc.name}와 대화를 이어갔다.`,'ev',_lvMark);
    }
  }
  if(res.next && res.next.choices && res.next.choices.length){
    const mergedText=[res.txt,res.next.txt].filter(Boolean).join('\n\n');
    document.getElementById('lv-txt').textContent=mergedText;
    document.getElementById('lv-choices').innerHTML=res.next.choices.map((c,idx)=>`<button class="chbtn" type="button" data-action="pick-choice" data-choice-index="${idx}">${c}</button>`).join('');
    _lvRes=res.next.res||[];
  }else{
    document.getElementById('lv-txt').textContent=res.txt;
    document.getElementById('lv-choices').innerHTML=`<button class="btn" type="button" data-action="close-love-modal">확인</button>`;
    _lvRes=[];
  }
  renderAll();
}

function closeLvModal(){
  closeModalById('lv-modal');
  _lvMark=null;
  if(_lvCb){
    const f=_lvCb;
    _lvCb=null;
    _lvNpc=null;
    _lvRes=[];
    renderAll();
    f();
  }else{
    _lvNpc=null;
    _lvRes=[];
    renderAll();
  }
}

function openDateMenu(){
  if(G.forcedRest) return;
  const list=NPCS.filter(n=>G.npc[n.id]>=25&&n.meet(G.turn));
  if(!list.length) return;
  document.getElementById('date-choices').innerHTML=list.map(n=>`<button class="chbtn" type="button" data-action="start-date" data-npc-id="${n.id}">${n.icon} ${n.name} <span style="color:var(--pink);font-family:var(--px);font-size:10px">❤️${G.npc[n.id]}</span></button>`).join('');
  openModal('date-modal');
}

function closeDateModal(){closeModalById('date-modal');}

function startDate(npcId){closeDateModal();G.selPM=`date:${npcId}`;G.activeTab='train';renderAll();}

function getLoveStage(h){if(h>=80)return'💖 연인 직전';if(h>=60)return'💗 감정 자각';if(h>=40)return'🩷 신경 쓰임';if(h>=20)return'🤝 친해짐';return'👤 지인';}
function openNpcModal(id){
  const npc=NPCS.find(n=>n.id===id);
  if(!npc) return;
  const h=G.npc[id];
  document.getElementById('nm-img').src=IMG[id];
  document.getElementById('nm-name').textContent=npc.name;
  document.getElementById('nm-title').textContent=npc.title;
  document.getElementById('nm-desc').textContent=npc.desc;
  document.getElementById('nm-hf').style.width=h+'%';
  document.getElementById('nm-hn').textContent=h+'/100';
  document.getElementById('nm-stage').textContent=getLoveStage(h);
  const nextThreshold=getNextStoryThreshold(id,h);
  document.getElementById('nm-next').textContent=nextThreshold!==null?`다음 깊은 에피소드 구간까지 호감도 ${Math.max(0,nextThreshold-h)}`:'현재 호감도로 대부분의 랜덤 에피소드가 해금됨 ✨';
  openModal('npc-modal');
}

function closeNpcModal(){closeModalById('npc-modal');}

function getTopNpc(){let best=null;for(const npc of NPCS){const v=G.npc[npc.id];if(!best||v>best.v)best={id:npc.id,name:npc.name,v};}return best;}
function getBuildType(){const arr=[['마력',G.stats.mana],['지식',G.stats.know],['체력',G.stats.body],['사교',G.stats.social]].sort((a,b)=>b[1]-a[1]);return `${arr[0][0]} 중심 성장형`}
function openMeModal(fromCreate=false){
  const hasSave=Object.keys(G).length>0;
  const rawName=hasSave ? G.name : (document.getElementById('char-name').value.trim() || '수련생');
  const name=String(rawName).replace(/[<>]/g,'').slice(0,10) || '수련생';
  const stats=hasSave ? G.stats : alloc;
  const fatigue=hasSave ? G.fatigue : 0;
  const gold=hasSave ? G.gold : 240;
  const top=hasSave ? getTopNpc() : null;
  const lines=[
    `이름: ${name}`,
    `성장 성향: ${hasSave ? getBuildType() : '초기 배분 확인 중'}`,
    `마력 ${stats.mana} / 지식 ${stats.know} / 체력 ${stats.body} / 사교 ${stats.social}`,
    `피로도 ${fatigue}/100`,
    `골드 ${gold}G`
  ];
  if(top&&top.v>0) lines.push(`가장 가까운 인물: ${top.name} (${top.v})`);
  if(hasSave&&G.counts.forbidden>0) lines.push(`금지 지식 노출: ${G.counts.forbidden}회`);
  renderTextLines(document.getElementById('me-meta-list'), lines);

  let desc='지금은 아직 수련의 초입이다. 어떤 마법사가 될지는 당신의 선택에 달려 있다.';
  if(hasSave){
    if(fatigue>=80) desc='최근 너무 무리하고 있다. 조금 쉬지 않으면 다음 달에 쓰러질 수도 있다.';
    else if(fatigue>=50) desc='꾸준히 성장 중이지만 피로가 꽤 쌓였다. 이번 달 선택은 회복도 고려하는 편이 좋다.';
    else desc='지금 흐름은 안정적이다. 전략적으로 고르면 원하는 엔딩 쪽으로 더 빠르게 기울 수 있다.';
  }
  document.getElementById('me-desc').textContent=desc;
  openModal('me-modal');
  if(!fromCreate&&hasSave) G.activeTab='relations';
}

function closeMeModal(){closeModalById('me-modal');}

function buyItem(id){const it=SHOP.find(x=>x.id===id);if(!it||G.gold<it.cost)return;G.gold-=it.cost;applyEff(it.eff);addLog(`🛍️ ${it.name} 구매 (${it.desc})`,'good');renderAll();}

function getEndingSnapshot(){return{mana:G.stats.mana,know:G.stats.know,body:G.stats.body,social:G.stats.social,gold:G.gold,fatigue:G.fatigue,npc:G.npc,scholarship:G.counts.scholarship,forbidden:G.counts.forbidden,burnout:G.counts.burnout,debt:G.counts.debt,dates:G.counts.dates,jobCount:G.counts.job,classCount:G.counts.class,socialCount:G.counts.social,freeCount:G.counts.free,alchemyCount:(G.counts.byAct.alchemy_assist||0)+(G.counts.byAct.alchemy_practicum||0)};}
function checkEnding(){if(G.turn<=G.totalTurns)return;const s=getEndingSnapshot();const main=MAIN_ENDINGS.find(e=>e.cond(s))||MAIN_ENDINGS[MAIN_ENDINGS.length-1];const romanceCandidates=ROMANCE_ENDINGS.filter(r=>r.cond(s));let romance=null;if(romanceCandidates.length)romance=romanceCandidates.sort((a,b)=>(G.npc[b.id]||0)-(G.npc[a.id]||0))[0];showEnding(main,romance);}
function showEnding(main,romance){document.getElementById('en-ico').textContent=main.ico;document.getElementById('en-main-ttl').textContent=main.ttl;document.getElementById('en-main-txt').textContent=main.txt;const sideWrap=document.getElementById('en-side-wrap'),sideLabel=document.getElementById('en-side-label'),sideTtl=document.getElementById('en-side-ttl'),sideTxt=document.getElementById('en-side-txt');sideWrap.style.display='block';if(romance){sideLabel.textContent='💕 로맨스 에필로그';sideLabel.style.color='var(--pink)';sideTtl.style.color='var(--pink)';sideTtl.textContent=romance.ttl;sideTxt.textContent=romance.txt;}else{sideLabel.textContent='🌙 솔로 에필로그';sideLabel.style.color='var(--silver)';sideTtl.style.color='var(--silver)';sideTtl.textContent=SOLO_ENDING.ttl;sideTxt.textContent=SOLO_ENDING.txt;}document.getElementById('en-meta').innerHTML=`총 아르바이트 <span style="color:var(--gold)">${G.counts.job}</span>회 / 수업 <span style="color:var(--know)">${G.counts.class}</span>회 / 사교 <span style="color:var(--pink)">${G.counts.social}</span>회 / 무료 행동 <span style="color:var(--grn)">${G.counts.free}</span>회<br>데이트 <span style="color:var(--pink)">${G.counts.dates}</span>회 / 장학금 <span style="color:var(--gold)">${G.counts.scholarship}</span>회 / 금지 지식 <span style="color:#b18cff">${G.counts.forbidden}</span>회`;const cols={mana:'#9050ff',know:'#40b0ff',body:'#40e880',social:'#ffaa40'};document.getElementById('en-stats').innerHTML=[['✨ 마력',G.stats.mana,'mana'],['📚 지식',G.stats.know,'know'],['💪 체력',G.stats.body,'body'],['💬 사교',G.stats.social,'social'],['💰 골드',G.gold,'gold']].map(([l,v,k])=>`<div class="en-st" style="border-color:${cols[k]||'#e8b830'};color:${cols[k]||'#e8b830'}">${l}<br>${v}</div>`).join('');clearSave();showScreen('screen-ending');}

function loadGame(){
  let hadCorrupt=false;
  for(const key of SAVE_KEYS){
    const parsed=safeParseSave(key);
    if(!parsed) continue;
    if(parsed.error){
      hadCorrupt=true;
      continue;
    }
    try{
      G=key==='mageAcad_v2' ? migrateLegacySave(parsed.data) : normalizeGameState(parsed.data);
      if(key!==SAVE_KEY) saveGame();
      refreshLoadButton();
      if(hadCorrupt) window.alert('손상된 저장 데이터를 정리하고 가장 최신 저장으로 불러왔어요.');
      startGame();
      return;
    }catch(err){
      console.warn(`저장 데이터 복구 실패: ${key}`, err);
      localStorage.removeItem(key);
      hadCorrupt=true;
    }
  }
  refreshLoadButton();
  if(hadCorrupt) window.alert('저장 데이터를 불러오지 못해 손상된 저장을 초기화했어요.');
}

function restartGame(){showScreen('screen-title');}

document.addEventListener('DOMContentLoaded',()=>{
  for(let i=0;i<70;i++){
    const s=document.createElement('div');
    s.className='star';
    s.style.cssText=`left:${Math.random()*100}%;top:${Math.random()*100}%;width:${Math.random()*2+1}px;height:${Math.random()*2+1}px;animation-delay:${Math.random()*3}s;animation-duration:${2+Math.random()*3}s`;
    document.body.appendChild(s);
  }

  refreshLoadButton();
  setupModalAccessibility();
  initBgm();

  document.addEventListener('click', handleDelegatedClick);
  document.addEventListener('keydown', handleDelegatedKeydown);
  window.addEventListener('resize', syncLayoutOffsets);

  document.getElementById('new-game-btn').addEventListener('click',()=>{tryStartBgm();startCreate();});
  document.getElementById('load-btn').addEventListener('click',()=>{tryStartBgm();loadGame();});
  document.getElementById('back-btn').addEventListener('click',()=>{tryStartBgm();showScreen('screen-title');});
  document.getElementById('start-btn').addEventListener('click',()=>{tryStartBgm();confirmCreate();});
  document.getElementById('confirm-btn').addEventListener('click',()=>{tryStartBgm();attemptConfirmMonth();});
  document.getElementById('random-stat-btn').addEventListener('click',randomizeAlloc);
  document.getElementById('date-btn').addEventListener('click',()=>{tryStartBgm();openDateMenu();});
  document.getElementById('date-btn-main').addEventListener('click',()=>{tryStartBgm();openDateMenu();});
  document.getElementById('restart-btn').addEventListener('click',()=>{tryStartBgm();restartGame();});
  document.getElementById('ev-close-btn').addEventListener('click',()=>{tryStartBgm();closeEvModal();});
  document.getElementById('date-cancel-btn').addEventListener('click',closeDateModal);
  document.getElementById('npc-close-btn').addEventListener('click',closeNpcModal);
  document.getElementById('me-close-btn').addEventListener('click',closeMeModal);
  document.getElementById('warn-cancel-btn').addEventListener('click',()=>closeWarnModal(false));
  document.getElementById('warn-ok-btn').addEventListener('click',()=>closeWarnModal(true));
  document.getElementById('bgm-toggle').addEventListener('click',toggleBgm);
  document.getElementById('scroll-top-btn').addEventListener('click',scrollToTopNow);
  document.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',()=>setTab(btn.dataset.tab)));

  window.addEventListener('scroll',toggleScrollTopButton,{passive:true});
  syncLayoutOffsets();
  toggleScrollTopButton();
});