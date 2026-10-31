(() => {
'use strict';
const catalog = JSON.parse(document.getElementById('catalog-data').textContent);
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escapeHTML = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => new Intl.NumberFormat('ru-RU').format(Number(n)) + ' ₽';
const categories = {kitchen:'Кухни',sofa:'Диваны',wardrobe:'Шкафы',other:'Другие детали'};
const allowedCategories = new Set(Object.keys(categories));
const safeURL = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
let state = {version:1,favorites:[1],notes:{},findings:[]};
let db = null, storageWorks = true, activeFilter = 'all', onlyFavorites = false, activeKitchen = 1;
let editFindingId = null, selectedFindingPhoto = null, lightboxKitchen = null, lightboxAngle = 0, persistQueue = Promise.resolve(), toastTimer;
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3200); }
function warnStorage() { if (!storageWorks) return; storageWorks = false; const p = document.createElement('p'); p.className = 'storage-warning'; p.textContent = 'Браузер не разрешил постоянное сохранение. Изменения доступны до закрытия страницы — скачайте резервную копию через «Сохранить».'; document.body.prepend(p); }
async function initStorage() {
  try {
    db = await new Promise((resolve,reject) => { const r = indexedDB.open('moya-kvartira-catalog-v1',1); r.onupgradeneeded = () => r.result.createObjectStore('project'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Хранилище занято')); });
    const saved = await new Promise((resolve,reject) => { const r = db.transaction('project').objectStore('project').get('personal'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    if (saved) state = validateState(saved);
  } catch { warnStorage(); }
}
function persist() {
  if (!db) return Promise.resolve(false);
  const snapshot = structuredClone(state);
  persistQueue = persistQueue.catch(() => {}).then(() => new Promise(resolve => { const tx = db.transaction('project','readwrite'); tx.objectStore('project').put(snapshot,'personal'); tx.oncomplete = () => resolve(true); tx.onerror = () => { warnStorage(); resolve(false); }; tx.onabort = () => { warnStorage(); resolve(false); }; }));
  return persistQueue;
}
function validateState(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1) throw new Error('Неизвестный формат подборки');
  const result = {version:1,favorites:[],notes:{},findings:[]};
  if (!Array.isArray(raw.favorites) || !Array.isArray(raw.findings) || !raw.notes || typeof raw.notes !== 'object') throw new Error('В файле не хватает данных подборки');
  result.favorites = [...new Set(raw.favorites.filter(x => Number.isInteger(x) && catalog.some(v => v.id === x)))];
  catalog.forEach(k => { if (typeof raw.notes[k.id] === 'string') result.notes[k.id] = raw.notes[k.id].slice(0,12000); });
  if (raw.findings.length > 200) throw new Error('В одном файле можно загрузить до 200 находок');
  for (const f of raw.findings) {
    if (!f || typeof f.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(f.id) || typeof f.title !== 'string' || typeof f.photo !== 'string' || !/^data:image\/(jpeg|png|webp|avif|gif);base64,[A-Za-z0-9+/=]+$/.test(f.photo) || f.photo.length > 22e6) throw new Error('В подборке обнаружена неподдерживаемая фотография');
    result.findings.push({id:f.id,title:f.title.slice(0,150),category:allowedCategories.has(f.category)?f.category:'other',photo:f.photo,price:Number.isFinite(Number(f.price)) && Number(f.price)>0 ? Math.min(Number(f.price),1e8):null,link:safeURL(f.link),note:String(f.note||'').slice(0,3000),createdAt:typeof f.createdAt==='string'?f.createdAt:new Date().toISOString()});
  }
  return result;
}
const angleLabel = (k, angle) => k.views?.[angle] || (angle===0?'Общий вид':'Кухня прямо');
function frame(k, angle, loading = 'lazy') {
  if(k.requiresCorrection) return '<span class="correction-placeholder"><span>На исправлении</span><strong>Сверяем размеры и стены</strong></span>';
  const ratio=k.images?k.ratios[angle]:k.ratio||'4/3';
  const n=Number(ratio.split('/')[0])/Number(ratio.split('/')[1]);
  const src=k.images?k.images[angle]:k.image;
  return `<span class="pair-frame ${k.images?'single-frame':''}" data-angle="${angle}" style="aspect-ratio:${ratio};--frame-ratio:${n}"><img src="${escapeHTML(src)}" loading="${loading}" alt="${escapeHTML(k.name)} — ${escapeHTML(angleLabel(k,angle))}"></span>`;
}
function hydrateFrames() { $$('[data-image]').forEach(el => { const k = catalog.find(k => k.id === Number(el.dataset.image)); if (k) { el.innerHTML = `<img src="${escapeHTML(k.image)}" alt="Кухня Белый и дуб, вид от входа" fetchpriority="high">`; } }); }
function renderKitchens() {
  const results = catalog.filter(k => (activeFilter==='all'||k.tags.includes(activeFilter)) && (!onlyFavorites||state.favorites.includes(k.id)));
  $('#result-count').textContent = results.length;
  $('#catalog-empty').hidden = results.length !== 0;
  $('#kitchen-grid').innerHTML = results.map(k => `<article class="kitchen-card" data-kitchen="${k.id}"><div class="card-photo"><button class="photo-open" data-open="${k.id}" aria-label="Открыть ${escapeHTML(k.name)}">${frame(k,0)}</button>${k.badge?'<span class="card-badge">'+escapeHTML(k.badge)+'</span>':k.id===1?'<span class="card-badge">Уже понравился</span>':''}<button class="favorite-button" data-favorite="${k.id}" aria-label="${state.favorites.includes(k.id)?'Убрать из избранного':'Добавить в избранное'}: ${escapeHTML(k.name)}" aria-pressed="${state.favorites.includes(k.id)}">${state.favorites.includes(k.id)?'♥':'♡'}</button></div><div class="angle-tabs" role="group" aria-label="Ракурс ${escapeHTML(k.name)}"><button class="active" aria-pressed="true" data-card-angle="0">↗ ${angleLabel(k,0)}</button><button aria-pressed="false" data-card-angle="1">▤ ${escapeHTML(angleLabel(k,1))}</button><button data-open="${k.id}" style="margin-left:auto">Подробнее →</button></div><div class="card-heading"><span class="card-number">${String(k.id).padStart(2,'0')}</span><h3><button class="card-title" data-open="${k.id}">${escapeHTML(k.name)}</button></h3></div><p class="card-subtitle">${escapeHTML(k.short)}</p><div class="card-bottom"><span>${escapeHTML(k.form)}</span><span>${escapeHTML(k.table)}</span><span>Без посудомойки</span></div></article>`).join('');
}
function toggleFavorite(id) {
  state.favorites = state.favorites.includes(id) ? state.favorites.filter(x=>x!==id) : [...state.favorites,id]; persist(); renderKitchens(); updateDetailFavorite();
}
function updateDetailFavorite() { const isFav = state.favorites.includes(activeKitchen); const b = $('#detail-favorite'); b.setAttribute('aria-pressed',String(isFav)); b.textContent = isFav?'♥ В избранном':'♡ В избранное'; }
function roomPlan(k) {
  if(k.id===6)return '<img class="exact-plan" src="assets/kitchen-layout.svg" alt="Ориентировочная схема: вход снизу, холодильник слева, гарнитур сверху, диван напротив">';
  const font = 'font-family="system-ui,sans-serif" font-size="11" fill="#2f352f"';
  let blocks = '<rect x="40" y="30" width="250" height="37" rx="2" fill="#cbd4c2"/><text x="161" y="54" text-anchor="middle" '+font+'>Гарнитур</text>';
  if (k.fridgeWall==='left') blocks += '<rect x="10" y="84" width="42" height="45" rx="2" fill="#d9bc9c"/><text x="31" y="111" text-anchor="middle" '+font+'>Х</text><path d="M52 106 h24 m-7 -4 7 4 -7 4" fill="none" stroke="#9c6b43"/><text x="84" y="109" '+font+'>Дверца →</text>';
  else blocks += '<rect x="248" y="30" width="42" height="37" fill="#d9bc9c"/><text x="269" y="54" text-anchor="middle" '+font+'>Х</text>';
  if (k.id===8) blocks += '<rect x="40" y="67" width="38" height="37" fill="#cbd4c2"/>';
  if(k.id===15) blocks += '<rect x="10" y="131" width="42" height="43" fill="#e4d6c0"/><text x="31" y="148" text-anchor="middle" '+font+'>СВЧ</text><text x="31" y="165" text-anchor="middle" '+font+'>Дух.</text>';
  if(k.id===16) blocks += '<rect x="248" y="30" width="42" height="37" fill="#e4d6c0"/><text x="269" y="45" text-anchor="middle" '+font+'>СВЧ</text><text x="269" y="61" text-anchor="middle" '+font+'>Дух.</text>';
  blocks += '<rect x="150" y="184" width="146" height="42" rx="7" fill="#cbd4c2"/><text x="223" y="210" text-anchor="middle" '+font+'>Диван</text><rect x="175" y="132" width="100" height="39" rx="17" fill="#e4d6c0"/><text x="225" y="157" text-anchor="middle" '+font+'>Стол</text>';
  return `<svg viewBox="0 0 355 258" role="img" aria-label="Условная схема: ${k.fridgeWall==='left'?'холодильник вдоль левой боковой стены, вход на нижней стене плана':'холодильник в линии кухни у окна'}, диван напротив"><path d="M47 235H10V30H23V15H322V97M322 160V235H110" fill="none" stroke="#687260" stroke-width="2"/><rect x="10" y="15" width="24" height="58" fill="#d6d7cb"/><text x="42" y="251" ${font}>Вход ↑</text><text x="315" y="130" text-anchor="end" ${font}>Балкон →</text>${blocks}</svg>`;
}
function openKitchen(id) {
  const k = catalog.find(x=>x.id===id); if (!k) return;
  activeKitchen=id; $('#detail-kicker').textContent=`Кухня ${String(id).padStart(2,'0')} / ${catalog.length} · 11,5 м²`;
  $('#view-layout-plan').hidden=k.id!==6; $('#view-reference').hidden=!k.reference; $('#detail-title').textContent=k.name; $('#detail-summary').textContent=k.summary;
  $('#detail-views').innerHTML=[0,1].map(a=>`<button class="detail-view" data-enlarge="${a}" aria-label="Увеличить ${angleLabel(k,a)}">${frame(k,a,'eager')}<span class="view-label"><span>${String(a+1).padStart(2,'0')} · ${escapeHTML(angleLabel(k,a))}</span><span>Увеличить ↗</span></span></button>`).join('');
  $('#detail-materials').innerHTML=`<dl>${Object.entries(k.materials).map(([label,value])=>`<div class="material-row"><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>`;
  $('#detail-includes').innerHTML=k.includes.map(s=>`<li>${escapeHTML(s)}</li>`).join('');
  $('#detail-layout').textContent=k.layout; $('#detail-plan').innerHTML=roomPlan(k); $('#detail-caution').textContent=k.caution;
  $('#kitchen-note').value=state.notes[id]||''; $('#note-status').textContent=''; updateDetailFavorite();
  if (!$('#detail-dialog').open) { $('#detail-dialog').showModal(); $('#detail-dialog').scrollTop=0; } else $('#detail-dialog').scrollTop=0;
}
function showKitchenPhoto(id, angle) { lightboxKitchen=id;lightboxAngle=angle; const k=catalog.find(x=>x.id===id); $('#lightbox-title').textContent=`${String(id).padStart(2,'0')} · ${k.name} / ${angleLabel(k,angle)}`; $('#lightbox-image').innerHTML=frame(k,angle,'eager'); $('.lightbox-controls').hidden=false; if(!$('#lightbox').open)$('#lightbox').showModal(); }
function showFindingPhoto(id) { const f=state.findings.find(x=>x.id===id); if(!f)return; lightboxKitchen=null;$('#lightbox-title').textContent=f.title;$('#lightbox-image').innerHTML=`<img class="uploaded-large" src="${f.photo}" alt="${escapeHTML(f.title)}">`;$('.lightbox-controls').hidden=true;$('#lightbox').showModal(); }
function page(name) { $('#kitchens-page').hidden=name!=='kitchens';$('#collection-page').hidden=name!=='collection';$$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===name));window.scrollTo({top:0,behavior:'instant'}); }
function renderFindings() { $('#find-count').textContent=state.findings.length;const filter=$('#collection-filter').value;const rows=state.findings.filter(x=>filter==='all'||x.category===filter);$('#findings-empty').hidden=rows.length>0;$('#findings-grid').innerHTML=rows.map(f=>`<article class="finding-card"><button class="finding-photo" data-finding-photo="${f.id}" aria-label="Увеличить ${escapeHTML(f.title)}"><img class="finding-image" src="${f.photo}" loading="lazy" alt="${escapeHTML(f.title)}"></button><div class="finding-meta"><span>${categories[f.category]}</span><span>${f.price?money(f.price):''}</span></div><h3>${escapeHTML(f.title)}</h3>${f.note?`<p>${escapeHTML(f.note)}</p>`:''}<div class="finding-actions">${f.link?`<a href="${escapeHTML(f.link)}" target="_blank" rel="noopener noreferrer">Открыть ссылку ↗</a>`:''}<button data-edit-finding="${f.id}">Изменить</button><button class="delete-finding" data-delete-finding="${f.id}">Удалить</button></div></article>`).join(''); }
function openFinding(id=null) {editFindingId=id;selectedFindingPhoto=null;$('#finding-form').reset();$('#finding-error').textContent='';$('#finding-preview').hidden=true;$('#finding-preview').removeAttribute('src');$('#upload-label').hidden=false;$('#finding-dialog-title').textContent=id?'Изменить находку':'Новая находка';if(id){const f=state.findings.find(x=>x.id===id);if(!f)return;$('#finding-title').value=f.title;$('#finding-category').value=f.category;$('#finding-price').value=f.price||'';$('#finding-link').value=f.link;$('#finding-note').value=f.note;selectedFindingPhoto=f.photo;$('#finding-preview').src=f.photo;$('#finding-preview').hidden=false;$('#upload-label').hidden=true;}$('#finding-dialog').showModal();}
async function readFile(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file);}); }
async function photoFromFile(file) { if(!/^image\/(jpeg|png|webp|avif|gif)$/.test(file.type))throw new Error('Подойдёт фотография JPG, PNG, WebP, AVIF или GIF.');if(file.size>15e6)throw new Error('Выберите фотографию размером до 15 МБ.');const url=await readFile(file);await new Promise((resolve,reject)=>{const im=new Image();im.onload=resolve;im.onerror=()=>reject(new Error('Не удалось открыть изображение.'));im.src=url;});return url; }
document.addEventListener('click',e=>{
  const close=e.target.closest('[data-close]');if(close){$('#'+close.dataset.close).close();return;}
  const open=e.target.closest('[data-open]');if(open){openKitchen(Number(open.dataset.open));return;}
  const favorite=e.target.closest('[data-favorite]');if(favorite){toggleFavorite(Number(favorite.dataset.favorite));return;}
  const angle=e.target.closest('[data-card-angle]');if(angle){const card=angle.closest('.kitchen-card');$('.pair-frame',card).dataset.angle=angle.dataset.cardAngle;$$('[data-card-angle]',card).forEach(b=>{const active=b===angle;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});const k=catalog.find(x=>x.id===Number(card.dataset.kitchen));const img=$('.photo-open img',card);if(k.images){$('.photo-open',card).innerHTML=frame(k,Number(angle.dataset.cardAngle));}else if(img)img.alt=k.name+' — '+angleLabel(k,Number(angle.dataset.cardAngle));return;}
  const filter=e.target.closest('[data-filter]');if(filter){activeFilter=filter.dataset.filter;$$('[data-filter]').forEach(b=>{b.classList.toggle('active',b===filter);b.setAttribute('aria-pressed',String(b===filter));});renderKitchens();return;}
  const pg=e.target.closest('[data-page]');if(pg){page(pg.dataset.page);return;}
  const zoom=e.target.closest('[data-enlarge]');if(zoom){showKitchenPhoto(activeKitchen,Number(zoom.dataset.enlarge));return;}
  const fp=e.target.closest('[data-finding-photo]');if(fp){showFindingPhoto(fp.dataset.findingPhoto);return;}
  const edit=e.target.closest('[data-edit-finding]');if(edit){openFinding(edit.dataset.editFinding);return;}
  const del=e.target.closest('[data-delete-finding]');if(del){if(del.dataset.confirm!=='yes'){del.dataset.confirm='yes';del.textContent='Удалить фото?';del.classList.add('delete-confirm');setTimeout(()=>{if(del.isConnected){delete del.dataset.confirm;del.textContent='Удалить';del.classList.remove('delete-confirm');}},4000);return;}state.findings=state.findings.filter(f=>f.id!==del.dataset.deleteFinding);persist();renderFindings();toast('Находка удалена');}
});
$('.brand').addEventListener('click',e=>{e.preventDefault();page('kitchens');});
$('#favorites-filter').addEventListener('click',()=>{onlyFavorites=!onlyFavorites;$('#favorites-filter').setAttribute('aria-pressed',String(onlyFavorites));renderKitchens();});
$('#reset-filter').addEventListener('click',()=>{onlyFavorites=false;activeFilter='all';$('#favorites-filter').setAttribute('aria-pressed','false');$$('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter==='all');b.setAttribute('aria-pressed',String(b.dataset.filter==='all'));});renderKitchens();});
$('#detail-favorite').addEventListener('click',()=>toggleFavorite(activeKitchen));
$('#previous-kitchen').addEventListener('click',()=>{const i=catalog.findIndex(k=>k.id===activeKitchen);openKitchen(catalog[(i-1+catalog.length)%catalog.length].id)});$('#next-kitchen').addEventListener('click',()=>{const i=catalog.findIndex(k=>k.id===activeKitchen);openKitchen(catalog[(i+1)%catalog.length].id)});
$('#kitchen-note').addEventListener('input',()=>{state.notes[activeKitchen]=$('#kitchen-note').value;$('#note-status').textContent='Сохраняем…';persist().then(ok=>{$('#note-status').textContent=ok?'Заметка сохранена':'Заметка доступна до закрытия страницы. Скачайте подборку.';});});
$('#lightbox-prev').addEventListener('click',()=>{if(lightboxKitchen)showKitchenPhoto(lightboxKitchen,1-lightboxAngle);});$('#lightbox-next').addEventListener('click',()=>{if(lightboxKitchen)showKitchenPhoto(lightboxKitchen,1-lightboxAngle);});
document.addEventListener('keydown',e=>{if($('#lightbox').open&&lightboxKitchen&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();showKitchenPhoto(lightboxKitchen,1-lightboxAngle);}});
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#add-finding').addEventListener('click',()=>openFinding());$('#add-first-finding').addEventListener('click',()=>openFinding());$('#collection-filter').addEventListener('change',renderFindings);
$('#finding-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;$('#finding-error').textContent='';$('#finding-submit').disabled=true;try{selectedFindingPhoto=await photoFromFile(file);$('#finding-preview').src=selectedFindingPhoto;$('#finding-preview').hidden=false;$('#upload-label').hidden=true;if(!$('#finding-title').value)$('#finding-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,150);}catch(err){$('#finding-error').textContent=err.message;}finally{$('#finding-submit').disabled=false;}});
$('#finding-form').addEventListener('submit',async e=>{e.preventDefault();if(!selectedFindingPhoto){$('#finding-error').textContent='Добавьте фотографию.';return;}const title=$('#finding-title').value.trim();if(!title){$('#finding-error').textContent='Укажите название находки.';return;}const id=editFindingId||crypto.randomUUID();const prior=state.findings.find(x=>x.id===id);const item={id,title,category:$('#finding-category').value,price:$('#finding-price').value?Number($('#finding-price').value):null,link:safeURL($('#finding-link').value),note:$('#finding-note').value.trim(),photo:selectedFindingPhoto,createdAt:prior?.createdAt||new Date().toISOString()};state.findings=prior?state.findings.map(f=>f.id===id?item:f):[item,...state.findings];$('#finding-submit').disabled=true;await persist();$('#finding-submit').disabled=false;$('#finding-dialog').close();$('#collection-filter').value='all';renderFindings();toast(storageWorks?'Находка сохранена':'Находка добавлена. Скачайте резервную копию.');});
function showReference(title,src){lightboxKitchen=null;$('#lightbox-title').textContent=title;$('#lightbox-image').innerHTML='<img class="uploaded-large" src="'+escapeHTML(src)+'" alt="'+escapeHTML(title)+'">';$('.lightbox-controls').hidden=true;$('#lightbox').showModal();}
$('#view-layout-plan').addEventListener('click',()=>showReference('Оценочная схема расстановки — №6','assets/kitchen-layout.svg'));
$('#view-floor-plan').addEventListener('click',()=>showReference('Исходный план квартиры','assets/floor-plan.png'));
$('#view-reference').addEventListener('click',()=>{const k=catalog.find(x=>x.id===activeKitchen);if(k.reference)showReference('Ваш референс',k.reference)});
function openBackup(){$('#backup-message').textContent='';$('#backup-dialog').showModal();}
$('#backup-open').addEventListener('click',openBackup);$('#backup-footer').addEventListener('click',openBackup);
$('#export-data').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Моя квартира — подборка.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);$('#backup-message').textContent='Подборка скачана: избранное, заметки и загруженные вами фотографии.';});
$('#import-data').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;const out=$('#backup-message');try{if(file.size>100e6)throw new Error('Подборка должна быть меньше 100 МБ.');const incoming=validateState(JSON.parse(await file.text()));const map=new Map(state.findings.map(f=>[f.id,f]));incoming.findings.forEach(f=>map.set(f.id,f));state.findings=[...map.values()];state.favorites=[...new Set([...state.favorites,...incoming.favorites])];state.notes={...state.notes,...incoming.notes};await persist();renderKitchens();renderFindings();out.textContent='Подборка загружена. Ваши фотографии, заметки и избранное на месте.';}catch(err){out.textContent='Не удалось загрузить подборку: '+err.message;}e.target.value='';});
async function start(){$('#kitchen-count').textContent=catalog.length;await initStorage();hydrateFrames();renderKitchens();renderFindings();const m=location.hash.match(/^#kitchen-(\d+)$/);if(m&&catalog.some(k=>k.id===Number(m[1])))openKitchen(Number(m[1]));}
start();
})();
