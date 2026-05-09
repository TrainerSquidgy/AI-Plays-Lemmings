// ─── Constants ────────────────────────────────────────────────────────────────
const APP_VERSION='pack-0.3.3-png-global-animation-library';
const EXPANDED_EDITOR=true;

// --- archived: vanilla fall-distance lookup (retired, all levels now use generated table) ---
// const VANILLA_FALL_DISTANCE_BY_MAP = Object.freeze({ '$7174': 72, ... '$71F6': 33, ... });
// function normaliseMapAddressForFallDistance(addr) { ... }
// function vanillaFallDistanceForMap(addr) { ... }

// Unified v2: fall distance is always taken from the stored INI value.
// The vanilla lookup table is retired: all levels use the generated header table.
function resolveFallDistance(value) {
  if (value === undefined || value === null || value === '') return 0x38;
  const n = num(value, NaN);
  return Number.isFinite(n) ? (n & 0xFF) : 0x38;
}
const TW=8,TH=8;
let levelConfig={cols:112,rows:19,mode:'singleplayer',ruleset:'sms-expanded'};
let COLS=levelConfig.cols,ROWS=levelConfig.rows,TOTAL=COLS*ROWS;
function clampMapDimension(value,fallback,min,max){
  const n=Math.floor(Number(value));
  if(!Number.isFinite(n))return fallback;
  return Math.max(min,Math.min(max,n));
}
function syncLevelConfigFromLevelData(){
  // Metadata sync only. Actual map dimensions change via resizeLevelMap()
  // so typing in the Level tab cannot silently corrupt the active tile array.
  levelConfig.mode=levelData.mode||levelConfig.mode||'singleplayer';
  levelConfig.ruleset=levelData.ruleset||levelConfig.ruleset||'sms-expanded';
  levelConfig.cols=COLS;
  levelConfig.rows=ROWS;
}
function resizeLevelMap(newCols,newRows,{preserve=true,markDirty=true,status=true}={}){
  newCols=clampMapDimension(newCols,COLS,1,512);
  newRows=clampMapDimension(newRows,ROWS,1,128);
  if(newCols===COLS&&newRows===ROWS){
    levelData.width_tiles=COLS;levelData.height_tiles=ROWS;
    const w=q('#lf-width_tiles'),h=q('#lf-height_tiles'); if(w)w.value=COLS; if(h)h.value=ROWS;
    return false;
  }
  const oldCols=COLS, oldRows=ROWS, oldTiles=tiles;
  const next=new Uint8Array(newCols*newRows);
  if(preserve&&oldTiles){
    const copyRows=Math.min(oldRows,newRows);
    const copyCols=Math.min(oldCols,newCols);
    for(let r=0;r<copyRows;r++){
      for(let c=0;c<copyCols;c++) next[r*newCols+c]=oldTiles[r*oldCols+c]||0;
    }
  }
  COLS=newCols;ROWS=newRows;TOTAL=COLS*ROWS;
  levelConfig.cols=COLS;levelConfig.rows=ROWS;
  levelData.width_tiles=COLS;levelData.height_tiles=ROWS;
  const w=q('#lf-width_tiles'),h=q('#lf-height_tiles'); if(w)w.value=COLS; if(h)h.value=ROWS;
  tiles=next;
  if(trapPos&&(trapPos.col<0||trapPos.col>=COLS||trapPos.row<0||trapPos.row>=ROWS))trapPos=null;
  for(const prefix of Object.keys(MP_MARKERS)){
    const cell=markerCell(prefix);
    if(cell&&(cell.col>=COLS||cell.row>=ROWS)){
      levelData[`${prefix}_col`]=-1;
      levelData[`${prefix}_row`]=-1;
      setLevelFieldValue(`${prefix}_col`,-1);
      setLevelFieldValue(`${prefix}_row`,-1);
    }
  }
  pngOverlayObjects=pngOverlayObjects
    .filter(o=>o.col>=0&&o.row>=0&&o.col<COLS&&o.row<ROWS)
    .map(o=>{
      const widthTiles=Math.max(1,Math.min(Number(o.widthTiles||1),COLS-o.col));
      const heightTiles=Math.max(1,Math.min(Number(o.heightTiles||1),ROWS-o.row));
      return {...o,widthTiles,heightTiles,widthPx:widthTiles*TW,heightPx:heightTiles*TH};
    });
  selectedPngObjectId=null;pngObjectDrag=null;
  history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;
  // Selection/paste co-ordinates are tile-grid based; clear them after a resize
  // so an old off-map selection cannot be pasted into the new dimensions.
  try{selStart=null;selEnd=null;pasteMode=false;}catch{}
  try{resizeMapCanvas();}catch{}
  try{updateHistStatus();}catch{}
  try{redrawMap();}catch{}
  try{updateStatusBar();}catch{}
  if(markDirty)try{updateDirty();}catch{}
  if(status)try{setPackStatus(`Map resized to ${COLS}×${ROWS} tiles`);}catch{}
  return true;
}
function applyMapSizeFromFields(){
  syncLevelData();
  const profile=getRulesetProfile(levelData.ruleset);
  if(profile.fixedCols&&profile.fixedRows){
    levelData.width_tiles=profile.fixedCols;
    levelData.height_tiles=profile.fixedRows;
    const w=q('#lf-width_tiles'),h=q('#lf-height_tiles');
    if(w)w.value=profile.fixedCols;
    if(h)h.value=profile.fixedRows;
  }
  return resizeLevelMap(levelData.width_tiles,levelData.height_tiles,{preserve:true,markDirty:true,status:true});
}
function bytesToBase64Chunked(bytes){
  const arr=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  let binary=''; const chunk=0x8000;
  for(let i=0;i<arr.length;i+=chunk) binary+=String.fromCharCode(...arr.subarray(i,i+chunk));
  return btoa(binary);
}

const RULESET_PROFILES={
  'sms-expanded':{
    label:'SMS Custom',
    mode:'singleplayer',
    description:'Custom SMS-style levels using the familiar skill and INI fields, with flexible map dimensions.',
    groups:['singleplayer','sms-fields','size','skills','world','audio']
  },
  'sms-original':{
    label:'SMS Original Compatible',
    mode:'original',
    fixedCols:112,
    fixedRows:19,
    description:'Strict original-game style metadata. Map size is locked to the SMS 112×19 tile layout.',
    groups:['singleplayer','sms-fields','size','skills','world','audio','original-note']
  },
  'multiplayer':{
    label:'Multiplayer',
    mode:'multiplayer',
    description:'Early multiplayer metadata layer for player ownership and shared playfield levels.',
    groups:['multiplayer','size','skills','world','audio']
  },
  'experimental':{
    label:'Experimental',
    mode:'experimental',
    description:'Open sandbox for future expanded rulesets. Uses the SMS fields until a richer schema is added.',
    groups:['experimental','singleplayer','sms-fields','size','skills','world','audio']
  }
};
function getRulesetProfile(ruleset=(levelData&&levelData.ruleset)||'sms-expanded'){
  return RULESET_PROFILES[ruleset]||RULESET_PROFILES['sms-expanded'];
}
function currentRulesetKey(){
  const el=typeof q==='function'?q('#lf-ruleset'):null;
  return (el&&el.value)||levelData.ruleset||'sms-expanded';
}
function refreshRulesetFormVisibility(){
  const profile=getRulesetProfile(currentRulesetKey());
  const active=new Set(profile.groups||[]);
  const pngMode = typeof isPngMapMode === 'function' && isPngMapMode();
  if (pngMode) {
    active.delete('world');
    active.delete('sms-fields');
    active.add('png-only');
  } else {
    active.delete('png-only');
  }
  document.querySelectorAll('[data-ruleset-groups]').forEach(el=>{
    const groups=String(el.dataset.rulesetGroups||'').split(',').map(x=>x.trim()).filter(Boolean);
    const visible=groups.length===0||groups.includes('all')||groups.some(g=>active.has(g));
    el.style.display=visible?'':'none';
  });

  const modeEl=q('#lf-mode');
  if(modeEl&&profile.mode){ modeEl.value=profile.mode; }

  const desc=q('#ruleset-profile-description');
  if(desc)desc.textContent=profile.description||'';

  const widthEl=q('#lf-width_tiles');
  const heightEl=q('#lf-height_tiles');
  const applyBtn=q('#btn-apply-map-size');
  const locked=!!(profile.fixedCols&&profile.fixedRows);
  if(widthEl){ widthEl.disabled=locked; if(locked)widthEl.value=profile.fixedCols; }
  if(heightEl){ heightEl.disabled=locked; if(locked)heightEl.value=profile.fixedRows; }
  if(applyBtn){ applyBtn.textContent=locked?'↔ Apply SMS Size (112×19)':'↔ Apply Map Size'; }
}
function applyRulesetProfile({fromUser=false}={}){
  syncLevelData();
  const profile=getRulesetProfile(levelData.ruleset);
  if(profile.mode){
    levelData.mode=profile.mode;
    const modeEl=q('#lf-mode'); if(modeEl)modeEl.value=profile.mode;
  }
  if(profile.fixedCols&&profile.fixedRows){
    levelData.width_tiles=profile.fixedCols;
    levelData.height_tiles=profile.fixedRows;
    const w=q('#lf-width_tiles'),h=q('#lf-height_tiles');
    if(w)w.value=profile.fixedCols;
    if(h)h.value=profile.fixedRows;
  }
  refreshRulesetFormVisibility();
  refreshPngModeUi();
  updateProjectSaveButtons();
  if(fromUser)try{setPackStatus(`${profile.label} ruleset selected`);}catch{}
}
const FONT="'Segoe UI','Arial Black',Arial,sans-serif";
const C={bg:"#10101e",panel:"#161625",border:"#2a2a45",gold:"#f0c040",text:"#e8e8ff",dim:"#b0b8d8",danger:"#ff6060"};


// ─── State ────────────────────────────────────────────────────────────────────
let tiles=new Uint8Array(TOTAL),history=[new Uint8Array(TOTAL)],histIdx=0;
let savedTileSnapshot=new Uint8Array(TOTAL); // tracks last exported state for dirty check
let tilesetImg=null,tilesetName="",tilesPerRow=16,activeTilesetId=null;
let selTile=1,tool="draw",zoom=2;
let isPainting=false,selStart=null,selEnd=null,hoverCell=null;
let brushes=[],activeBrush=null,brushPreviews=[];
let packName="My Brush Pack";
let brushHandle="TL"; // TL|TR|BL|BR - which corner cursor anchors to
let isFirstLaunch=true; // cleared after first pack load
let clipboard=null; // {w,h,data} - Ctrl+C/V copy-paste buffer
let isCopyDrag=false; // true when mid-drag in select mode copies instead of moves
let pasteMode=false; // true when clipboard ghost is being dragged for placement
let ignoreTransparency=false; // when true, tile #0 in stamps/pastes is skipped
let trapPos=null; // {col,row} - placed trap marker position
let terrainPngImg=null, terrainPngName='', terrainPngDataUrl='', terrainPngVisible=true;
let pngOverlayObjects=[];
let selectedPngObjectId=null;
let pngObjectDrag=null;
let savedOverlaySnapshotJson='[]';
let savedPngLevelSnapshotJson='';
let pngDraftAutosaveTimer=null;
let pngDraftAutosaveInFlight=false;
let lastPngDraftAutosaveSnapshot='';
let pngDraftAutosaveRestorePromptShown=false;
let activePngObjectRole='hatch';
let activePngAnimationCategory='hatches';
let activePngAnimationId='default_hatch';
let activePngPlacementMode='animation'; // animation | steel | no_collision | select
const PNG_TERRAIN_RULES=[
  {id:'steel',label:'Steel Tile',role:'steel',colour:'#80c0ff',summary:'destructive skills stop here'},
  {id:'no_collision',label:'Non-collidable Tile',role:'no_collision',colour:'#ff80c0',summary:'PNG terrain ignored here'}
];
const PNG_OBJECT_FOREGROUND_Z_INDEX=100;
const PNG_DEFAULT_Z_INDEX_BY_ROLE={
  decorative:0,
  no_collision:5,
  steel:5,
  water:20,
  acid:20,
  toxic:20,
  fire:30,
  hatch:40,
  exit:50,
  goal:50,
  triggered_trap:120
};
function defaultPngZIndexForRole(role){const r=String(role||'decorative').toLowerCase();return Number(PNG_DEFAULT_Z_INDEX_BY_ROLE[r]??0);}
function pngObjectZIndex(obj){const v=Number(obj?.zIndex??obj?.z_index??obj?.z??obj?.layer);return Number.isFinite(v)?v:defaultPngZIndexForRole(obj?.role);}
function pngObjectsInDrawOrder(list=pngOverlayObjects){return (Array.isArray(list)?list:[]).map((o,i)=>({o,i,z:pngObjectZIndex(o)})).sort((a,b)=>a.z-b.z||a.i-b.i).map(x=>x.o);}
function pngObjectsInPickOrder(list=pngOverlayObjects){return (Array.isArray(list)?list:[]).map((o,i)=>({o,i,z:pngObjectZIndex(o)})).sort((a,b)=>b.z-a.z||b.i-a.i).map(x=>x.o);}
const pngAnimationPreviewImages=new Map();
const PNG_ANIMATION_CATEGORIES=[
  {id:'hatches',label:'Hatches',roles:['hatch']},
  {id:'goals',label:'Goals',roles:['exit','goal']},
  {id:'fire',label:'Fire',roles:['fire']},
  {id:'traps',label:'Traps',roles:['triggered_trap']},
  {id:'water',label:'Water/Acid',roles:['water','acid','toxic']},
  {id:'decorative',label:'Decorative',roles:['decorative']}
];
const PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME='png-animation-library.json';
const PNG_GLOBAL_ANIMATION_LIBRARY_DISPLAY_PATH='custom-levels/'+PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME;
let pngAnimationLibrarySaveTimer=null;
let pngAnimationLibrarySaveInFlight=false;
let pngAnimationLibrarySavePromise=null;
let lastPngAnimationLibrarySnapshot='';
let pngAnimationPack={
  format:'sms-lemmings-animation-pack',
  version:1,
  name:'Default PNG Animation Pack',
  animations:[
    {id:'default_hatch',name:'Classic Hatch',category:'hatches',role:'hatch',image:'assets/Hatch_Animation.png',frameWidthTiles:5,frameHeightTiles:3,frames:6,orientation:'vertical',trigger:'level_start',spawnOffsetX:16,spawnOffsetY:8},
    {id:'default_goal',name:'Classic Goal',category:'goals',role:'exit',image:'assets/Torch_Left.png',frameWidthTiles:2,frameHeightTiles:2,frames:3,orientation:'horizontal',trigger:'constant_loop'},
    {id:'default_fire_top',name:'Fire Top',category:'fire',role:'fire',image:'assets/Fire_Top.png',frameWidthTiles:1,frameHeightTiles:1,frames:3,orientation:'horizontal',trigger:'constant_loop'},
    {id:'default_fire_bottom',name:'Fire Bottom',category:'fire',role:'fire',image:'assets/Fire_Bottom.png',frameWidthTiles:1,frameHeightTiles:1,frames:2,orientation:'horizontal',trigger:'constant_loop'},
    {id:'default_bear_trap',name:'Bear Trap',category:'traps',role:'triggered_trap',image:'assets/Bear_Trap.png',frameWidthTiles:2,frameHeightTiles:2,frames:7,orientation:'vertical',trigger:'lemming_position',triggerOffsetX:8,triggerOffsetY:15},
    {id:'default_crusher',name:'Crusher',category:'traps',role:'triggered_trap',image:'assets/Crusher.png',frameWidthTiles:4,frameHeightTiles:2,frames:6,orientation:'vertical',trigger:'lemming_position',triggerOffsetX:16,triggerOffsetY:15},
    {id:'default_flamethrower',name:'Flamethrower',category:'traps',role:'triggered_trap',image:'assets/Flamethrower.png',frameWidthTiles:4,frameHeightTiles:2,frames:6,orientation:'vertical',trigger:'lemming_position',triggerOffsetX:16,triggerOffsetY:15},
    {id:'default_noose',name:'Noose',category:'traps',role:'triggered_trap',image:'assets/Noose.png',frameWidthTiles:1,frameHeightTiles:4,frames:5,orientation:'horizontal',trigger:'lemming_position',triggerOffsetX:4,triggerOffsetY:31},
    {id:'default_drip',name:'Drip / Tap',category:'traps',role:'triggered_trap',image:'assets/Drip.png',frameWidthTiles:1,frameHeightTiles:4,frames:5,orientation:'horizontal',trigger:'lemming_position',triggerOffsetX:4,triggerOffsetY:31},
    {id:'default_water_top',name:'Water Top',category:'water',role:'water',image:'assets/Water_Top.png',frameWidthTiles:1,frameHeightTiles:1,frames:3,orientation:'horizontal',trigger:'constant_loop'},
    {id:'default_water_bottom',name:'Water Bottom',category:'water',role:'water',image:'assets/Water_Bottom.png',frameWidthTiles:1,frameHeightTiles:1,frames:3,orientation:'horizontal',trigger:'constant_loop'},
    {id:'default_acid_top',name:'Acid Top',category:'water',role:'acid',image:'assets/Acid_Top.png',frameWidthTiles:1,frameHeightTiles:1,frames:3,orientation:'horizontal',trigger:'constant_loop'},
    {id:'default_acid_bottom',name:'Acid Bottom',category:'water',role:'acid',image:'assets/Acid_Bottom.png',frameWidthTiles:1,frameHeightTiles:1,frames:3,orientation:'horizontal',trigger:'constant_loop'}
  ]
};
const PNG_DEFAULT_ANIMATION_PACK=JSON.parse(JSON.stringify(pngAnimationPack));
let refImg=null,refOpacity=0.4,refVisible=true; // reference image overlay
let refX=0,refY=0,refScale=1.0; // refScale = fraction of base canvas width (zoom-independent); refX/Y in base (unzoomed) pixels
let refDragging=false,refDragStartX=0,refDragStartY=0,refDragOriginX=0,refDragOriginY=0;

// Tileset id → default trap type (matches INI trap_type values)
const TILESET_TRAP_MAP={0:3, 1:0, 2:0, 3:0, 4:1, 6:0, 7:4};
// Tileset id → trap name (for status bar hint)
const TILESET_TRAP_NAMES={0:"Bear Trap",1:"None",2:"None",3:"None",4:"Crusher",6:"None",7:"Tap"};


function isPngMapMode(){return String(levelData?.map_format||'mlm').toLowerCase()==='png'||!!levelData?.terrain_png;}
function syncMapFormatToggle(){
  const png=isPngMapMode();
  const mlmBtn=q('#btn-map-format-mlm');
  const pngBtn=q('#btn-map-format-png');
  if(mlmBtn){
    mlmBtn.classList.toggle('active',!png);
    mlmBtn.style.background=!png?C.gold:'#161625';
    mlmBtn.style.color=!png?'#101020':C.dim;
    mlmBtn.style.borderColor=!png?C.gold:C.border;
  }
  if(pngBtn){
    pngBtn.classList.toggle('active',png);
    pngBtn.style.background=png?C.gold:'#161625';
    pngBtn.style.color=png?'#101020':C.dim;
    pngBtn.style.borderColor=png?C.gold:C.border;
  }
}
function setMapFormat(format,{fromUser=false}={}){
  const next=String(format||'mlm').toLowerCase()==='png'?'png':'mlm';
  levelData.map_format=next;
  if(next==='mlm'){
    // The terrain PNG path is only meaningful in PNG mode. Clearing it here
    // prevents a stale filename from silently forcing PNG mode again.
    levelData.terrain_png='';
  }
  const mapEl=q('#lf-map_format'),pngEl=q('#lf-terrain_png');
  if(mapEl)mapEl.value=next;
  if(pngEl&&next==='mlm')pngEl.value='';
  refreshPngModeUi();
  refreshRulesetFormVisibility();
  updateDirty();
  if(fromUser)setPackStatus(next==='png'?'PNG level format: terrain PNG + animation objects':'MLM level format: tilemap + tilesets/brushes');
}
function safeLevelStem(){return String(levelData.level_id||levelData.name||'level_001').replace(/[^a-zA-Z0-9_\-.]/g,'_')||'level_001';}
function normaliseMainGameRating(value){const safe=String(value||'FUN').toUpperCase().replace(/\s+/g,'');return ['FUN','TRICKY','TAXING','MAYHEM','EXTRA1','EXTRA2','EXTRA3','EXTRA4'].includes(safe)?safe:'FUN';}
function mainGameRatingOptions(){return [['FUN','Fun'],['TRICKY','Tricky'],['TAXING','Taxing'],['MAYHEM','Mayhem'],['EXTRA1','Extra 1'],['EXTRA2','Extra 2'],['EXTRA3','Extra 3'],['EXTRA4','Extra 4']];}
function pngAnimations(){return Array.isArray(pngAnimationPack?.animations)?pngAnimationPack.animations:[];}
function normalisePngAnimationId(value){if(value===undefined||value===null)return'';if(typeof value==='object')return normalisePngAnimationId(value.id||value.animationId||value.animation_id||value.name);return String(value).trim();}
function pngObjectAnimationId(obj){return normalisePngAnimationId(obj?.animationId||obj?.animation_id||obj?.animId||obj?.anim_id||obj?.animationKey||obj?.animation_key||obj?.animation?.id||obj?.animation?.animationId||obj?.animation?.animation_id||obj?.anim?.id||obj?.anim?.animationId||obj?.anim?.animation_id||(typeof obj?.animation==='string'?obj.animation:null)||(typeof obj?.anim==='string'?obj.anim:null));}
function pngAnimationById(id){const key=normalisePngAnimationId(id);if(!key)return null;return pngAnimations().find(a=>normalisePngAnimationId(a.id)===key||normalisePngAnimationId(a.animationId)===key||normalisePngAnimationId(a.animation_id)===key)||pngAnimations().find(a=>normalisePngAnimationId(a.id).toLowerCase()===key.toLowerCase()||normalisePngAnimationId(a.animationId).toLowerCase()===key.toLowerCase()||normalisePngAnimationId(a.animation_id).toLowerCase()===key.toLowerCase())||null;}
function activePngAnimation(){return activePngAnimationId?pngAnimationById(activePngAnimationId):null;}
function categoryForPngRole(role){const r=String(role||'decorative').toLowerCase();if(r==='hatch')return'hatches';if(r==='exit'||r==='goal')return'goals';if(r==='fire')return'fire';if(r==='triggered_trap')return'traps';if(r==='water'||r==='acid'||r==='toxic')return'water';return'decorative';}
function roleForPngCategory(category){const c=String(category||'decorative').toLowerCase();if(c==='hatches')return'hatch';if(c==='goals')return'exit';if(c==='fire')return'fire';if(c==='traps')return'triggered_trap';if(c==='water')return'water';return'decorative';}
function defaultTriggerForRole(role){const r=String(role||'decorative').toLowerCase();if(r==='hatch')return'level_start';if(r==='triggered_trap')return'lemming_position';return'constant_loop';}
function normalisePngAnimation(anim){const a={...(anim||{})};a.id=String(a.id||a.name||('animation_'+Date.now()));a.name=String(a.name||a.label||a.id);a.category=String(a.category||categoryForPngRole(a.role)||'decorative');a.role=String(a.role||roleForPngCategory(a.category)||'decorative').toLowerCase();a.frameWidthTiles=Math.max(1,Number(a.frameWidthTiles??a.frame_width_tiles??a.widthTiles??a.width_tiles??1)||1);a.frameHeightTiles=Math.max(1,Number(a.frameHeightTiles??a.frame_height_tiles??a.heightTiles??a.height_tiles??1)||1);a.frames=Math.max(1,Number(a.frames??a.frame_count??a.frameCount??1)||1);a.orientation=String(a.orientation||a.frame_axis||a.frameAxis||'horizontal').toLowerCase();a.trigger=String(a.trigger||defaultTriggerForRole(a.role)).toLowerCase();return a;}
function mergePngAnimationLists(...lists){const byId=new Map();for(const list of lists){for(const raw of (Array.isArray(list)?list:[])){const anim=normalisePngAnimation(raw);byId.set(String(anim.id),anim);}}return Array.from(byId.values());}
function pngAnimationLibraryPayload(){return {format:'sms-lemmings-png-animation-library',version:1,name:'Global PNG Animation Library',animations:pngAnimations().map(a=>normalisePngAnimation(a))};}
function setPngAnimationLibraryFromPayload(payload,{merge=true}={}){const incoming=Array.isArray(payload?.animations)?payload.animations:[];const base=merge?pngAnimations():PNG_DEFAULT_ANIMATION_PACK.animations;pngAnimationPack={...PNG_DEFAULT_ANIMATION_PACK,format:'sms-lemmings-png-animation-library',version:1,name:payload?.name||'Global PNG Animation Library',animations:mergePngAnimationLists(base,incoming)};return pngAnimations().length;}
function mergePngAnimationPackIntoGlobal(pack){if(!pack||!Array.isArray(pack.animations)||!pack.animations.length)return 0;const before=pngAnimations().length;setPngAnimationLibraryFromPayload(pack,{merge:true});return Math.max(0,pngAnimations().length-before);}
function schedulePngAnimationLibrarySave({immediate=false,silent=true}={}){if(!window.electronAPI||typeof window.electronAPI.savePngAnimationLibrary!=='function')return;const delay=immediate?0:600;if(pngAnimationLibrarySaveTimer)clearTimeout(pngAnimationLibrarySaveTimer);pngAnimationLibrarySaveTimer=setTimeout(()=>{pngAnimationLibrarySaveTimer=null;saveGlobalPngAnimationLibrary({silent});},delay);}
async function saveGlobalPngAnimationLibrary({silent=false,force=false}={}){
  if(force&&pngAnimationLibrarySaveTimer){
    clearTimeout(pngAnimationLibrarySaveTimer);
    pngAnimationLibrarySaveTimer=null;
  }
  if(!window.electronAPI||typeof window.electronAPI.savePngAnimationLibrary!=='function'){
    if(!silent)setPackStatus('Global PNG animation library cannot be saved in this build.');
    return false;
  }
  if(pngAnimationLibrarySavePromise){
    try{await pngAnimationLibrarySavePromise;}catch{}
    return saveGlobalPngAnimationLibrary({silent,force});
  }
  let payload,snapshot;
  try{payload=pngAnimationLibraryPayload();snapshot=JSON.stringify(payload);}catch{return false;}
  if(!force&&snapshot&&snapshot===lastPngAnimationLibrarySnapshot){
    if(!silent)setPackStatus('Global PNG animation library already saved.');
    return true;
  }
  pngAnimationLibrarySaveInFlight=true;
  pngAnimationLibrarySavePromise=(async()=>{
    try{
      const r=await window.electronAPI.savePngAnimationLibrary(payload);
      if(r&&r.ok!==false){
        lastPngAnimationLibrarySnapshot=snapshot;
        if(!silent)setPackStatus(`Saved global PNG animation library: ${PNG_GLOBAL_ANIMATION_LIBRARY_DISPLAY_PATH}`);
        return true;
      }
      if(!silent)setPackStatus('Could not save global PNG animation library: '+((r&&r.error)||'Unknown error'));
    }catch(err){
      if(!silent)setPackStatus('Could not save global PNG animation library.');
    }finally{
      pngAnimationLibrarySaveInFlight=false;
      pngAnimationLibrarySavePromise=null;
    }
    return false;
  })();
  return pngAnimationLibrarySavePromise;
}
async function loadGlobalPngAnimationLibrary({silent=false}={}){if(!window.electronAPI||typeof window.electronAPI.loadPngAnimationLibrary!=='function')return false;try{const r=await window.electronAPI.loadPngAnimationLibrary();const payload=(r&&r.payload)?r.payload:r;if(payload&&Array.isArray(payload.animations)&&payload.animations.length){setPngAnimationLibraryFromPayload(payload,{merge:true});lastPngAnimationLibrarySnapshot=JSON.stringify(pngAnimationLibraryPayload());renderPngAnimationPalette();refreshPngModeUi();if(!activePngAnimationId&&pngAnimations()[0])activePngAnimationId=pngAnimations()[0].id;if(!silent)setPackStatus(`Loaded global PNG animation library: ${payload.animations.length} animation${payload.animations.length===1?'':'s'}.`);return true;}if(!silent)setPackStatus('No saved global PNG animation library yet; using defaults.');}catch(err){if(!silent)setPackStatus('Could not load global PNG animation library.');}return false;}
function editorPreviewSrcForAnimation(anim){const src=String(anim?.image||anim?.png||'');if(!src)return'';if(src.startsWith('data:')||src.startsWith('/')||/^(https?:)?\/\//i.test(src))return src;if(src.startsWith('assets/'))return 'playtest-engine/'+src;return src;}
function getPngAnimationPreviewImage(anim){const src=editorPreviewSrcForAnimation(anim);if(!src)return null;let entry=pngAnimationPreviewImages.get(src);if(entry)return entry.loaded?entry.img:null;const img=new Image();entry={img,loaded:false};pngAnimationPreviewImages.set(src,entry);img.onload=()=>{entry.loaded=true;try{renderPngAnimationPalette();redrawMap();}catch{}};img.onerror=()=>{entry.error=true;};img.src=src;return null;}
function animationFootprint(anim){const a=normalisePngAnimation(anim||{});return {widthTiles:a.frameWidthTiles,heightTiles:a.frameHeightTiles,widthPx:a.frameWidthTiles*TW,heightPx:a.frameHeightTiles*TH};}
function objectFromAnimation(anim,cell){
  const a=normalisePngAnimation(anim||{});
  const fp=animationFootprint(a);
  const col=Math.max(0,Math.min(COLS-1,Math.floor(cell.col)));
  const row=Math.max(0,Math.min(ROWS-1,Math.floor(cell.row)));
  const widthTiles=Math.min(fp.widthTiles,COLS-col);
  const heightTiles=Math.min(fp.heightTiles,ROWS-row);
  const x=col*TW,y=row*TH,widthPx=widthTiles*TW,heightPx=heightTiles*TH;
  let role=String(a.role||'decorative').toLowerCase();
  const obj={id:`${a.id}_${col}_${row}_${Date.now().toString(36)}`,type:'animated_object',role,category:String(a.category||categoryForPngRole(role)),animation_id:a.id,animationId:a.id,col,row,x,y,widthTiles,heightTiles,widthPx,heightPx,zIndex:defaultPngZIndexForRole(role),trigger:String(a.trigger||defaultTriggerForRole(role))};
  if(role==='hatch'){
    obj.spawn_x=x+Number(a.spawnOffsetX??Math.floor(widthPx/2));
    obj.spawn_y=y+Number(a.spawnOffsetY??Math.max(0,heightPx-1));
  }else if(role==='exit'||role==='goal'){
    obj.role='exit';
    // PNG goals behave like a single object rather than two torches. The exit
    // trigger is centred on the middle 8px of the bottom row of the animation.
    obj.trigger_x=x+Number(a.triggerOffsetX??Math.floor(widthPx/2));
    obj.trigger_y=y+Number(a.triggerOffsetY??Math.max(0,heightPx-1));
  }else if(role==='triggered_trap'){
    obj.trigger='lemming_position';
    obj.trigger_x=x+Number(a.triggerOffsetX??Math.floor(widthPx/2));
    obj.trigger_y=y+Number(a.triggerOffsetY??Math.max(0,heightPx-1));
  }
  return obj;
}
function pngObjectBounds(obj){
  const widthPx=Math.max(1,Number(obj?.widthPx??obj?.width_px??(obj?.widthTiles||1)*TW)||TW);
  const heightPx=Math.max(1,Number(obj?.heightPx??obj?.height_px??(obj?.heightTiles||1)*TH)||TH);
  const x=Number.isFinite(Number(obj?.x))?Number(obj.x):(Number(obj?.col)||0)*TW;
  const y=Number.isFinite(Number(obj?.y))?Number(obj.y):(Number(obj?.row)||0)*TH;
  return {x,y,widthPx,heightPx};
}
function isFreePngPointRole(role){return ['hatch','exit','goal','triggered_trap'].includes(String(role||'').toLowerCase());}
function pngObjectPointKind(role){const r=String(role||'').toLowerCase();if(r==='hatch')return 'spawn';if(r==='exit'||r==='goal')return 'exit';if(r==='triggered_trap')return 'trigger';return '';}
function pngObjectPoint(obj){
  const role=String(obj?.role||'').toLowerCase();
  const b=pngObjectBounds(obj);
  if(role==='hatch')return {x:Number(obj.spawn_x??obj.spawnX??(b.x+Math.floor(b.widthPx/2))),y:Number(obj.spawn_y??obj.spawnY??(b.y+Math.max(0,b.heightPx-1))),kind:'spawn'};
  if(role==='exit'||role==='goal')return {x:Number(obj.trigger_x??obj.triggerX??obj.exit_x??(b.x+Math.floor(b.widthPx/2))),y:Number(obj.trigger_y??obj.triggerY??obj.exit_y??(b.y+Math.max(0,b.heightPx-1))),kind:'exit'};
  if(role==='triggered_trap')return {x:Number(obj.trigger_x??obj.triggerX??(b.x+Math.floor(b.widthPx/2))),y:Number(obj.trigger_y??obj.triggerY??(b.y+Math.max(0,b.heightPx-1))),kind:'trigger'};
  return null;
}
function objectFootprintsOverlap(a,b){
  const ab=pngObjectBounds(a),bb=pngObjectBounds(b);
  return ab.x < bb.x+bb.widthPx && ab.x+ab.widthPx > bb.x && ab.y < bb.y+bb.heightPx && ab.y+ab.heightPx > bb.y;
}
function objectAtPoint(point){
  if(!point)return null;
  for(const o of pngObjectsInPickOrder()){
    const b=pngObjectBounds(o);
    if(point.x>=b.x&&point.x<b.x+b.widthPx&&point.y>=b.y&&point.y<b.y+b.heightPx)return o;
  }
  return null;
}
function objectAtCell(cell){return cell?objectAtPoint({x:cell.col*TW+Math.floor(TW/2),y:cell.row*TH+Math.floor(TH/2)}):null;}
function deselectPngAnimation(){activePngAnimationId='';activePngPlacementMode='select';selectedPngObjectId=null;pngObjectDrag=null;renderPngAnimationPalette();redrawMap();updateStatusBar();setPackStatus('PNG object placement deselected. Drag existing objects to move them. Hold Alt while dragging hatches, goals, or traps for pixel positioning. Ctrl-click one of them to set its gameplay point.');}
function normalisePngObjectPosition(obj){
  const moved={...obj};
  moved.widthPx=Math.max(1,Number(moved.widthPx??moved.width_px??(moved.widthTiles||1)*TW)||TW);
  moved.heightPx=Math.max(1,Number(moved.heightPx??moved.height_px??(moved.heightTiles||1)*TH)||TH);
  moved.widthTiles=Math.max(1,Number(moved.widthTiles??Math.ceil(moved.widthPx/TW))||1);
  moved.heightTiles=Math.max(1,Number(moved.heightTiles??Math.ceil(moved.heightPx/TH))||1);
  moved.x=Math.max(0,Math.min(COLS*TW-moved.widthPx,Number(moved.x)||0));
  moved.y=Math.max(0,Math.min(ROWS*TH-moved.heightPx,Number(moved.y)||0));
  moved.col=Math.max(0,Math.min(COLS-1,Math.floor(moved.x/TW)));
  moved.row=Math.max(0,Math.min(ROWS-1,Math.floor(moved.y/TH)));
  const animationId=pngObjectAnimationId(moved);
  if(animationId){moved.animationId=animationId;moved.animation_id=animationId;}
  moved.zIndex=pngObjectZIndex(moved);
  return moved;
}
function movePngObjectTo(objectId,cell,baseObject=null){
  const src=baseObject||pngOverlayObjects.find(o=>String(o.id)===String(objectId));
  if(!src||!cell)return false;
  const target={x:Math.floor(cell.col)*TW,y:Math.floor(cell.row)*TH};
  return movePngObjectToPoint(objectId,target,baseObject,{snap:true});
}
function movePngObjectToPoint(objectId,point,baseObject=null,{snap=false}={}){
  const src=baseObject||pngOverlayObjects.find(o=>String(o.id)===String(objectId));
  if(!src||!point)return false;
  const b=pngObjectBounds(src);
  const nextX=snap?Math.floor(point.x/TW)*TW:Math.floor(point.x);
  const nextY=snap?Math.floor(point.y/TH)*TH:Math.floor(point.y);
  const moved=normalisePngObjectPosition({...src,x:nextX,y:nextY,widthPx:b.widthPx,heightPx:b.heightPx});
  const dx=moved.x-b.x,dy=moved.y-b.y;
  for(const key of ['spawn_x','trigger_x','exit_x']) if(Number.isFinite(Number(moved[key]))) moved[key]=Number(moved[key])+dx;
  for(const key of ['spawn_y','trigger_y','exit_y']) if(Number.isFinite(Number(moved[key]))) moved[key]=Number(moved[key])+dy;
  pngOverlayObjects=pngOverlayObjects.filter(o=>String(o.id)===String(objectId)||!objectFootprintsOverlap(moved,o)).map(o=>String(o.id)===String(objectId)?moved:o);
  selectedPngObjectId=moved.id;
  syncPngObjectSummary();redrawMap();updateDirty();
  return true;
}
function placeActivePngAnimation(cell,point=null){if(!cell)return;const anim=activePngAnimation();if(!anim){setPackStatus('No PNG animation selected.');return;}const obj=objectFromAnimation(anim,cell);if(point&&isFreePngPointRole(obj.role)){const before=pngObjectBounds(obj);const b=pngObjectBounds(obj);const placed=normalisePngObjectPosition({...obj,x:point.x,y:point.y,widthPx:b.widthPx,heightPx:b.heightPx});const dx=placed.x-before.x,dy=placed.y-before.y;Object.assign(obj,placed);for(const key of ['spawn_x','trigger_x','exit_x']) if(Number.isFinite(Number(obj[key]))) obj[key]=Number(obj[key])+dx;for(const key of ['spawn_y','trigger_y','exit_y']) if(Number.isFinite(Number(obj[key]))) obj[key]=Number(obj[key])+dy;}pngOverlayObjects=pngOverlayObjects.filter(o=>!objectFootprintsOverlap(obj,o));pngOverlayObjects.push(obj);selectedPngObjectId=obj.id;levelData.map_format='png';const mapEl=q('#lf-map_format');if(mapEl)mapEl.value='png';syncPngObjectSummary();pushHistory(tiles,pngOverlayObjects);setPackStatus(`Placed ${anim.name||anim.id} at ${obj.x},${obj.y}px`);redrawMap();updateDirty();}
function placePngTerrainRule(cell,role){if(!cell)return;const rule=pngTerrainRuleByRole(role);if(!rule)return;const obj={id:`${role}_${cell.col}_${cell.row}_${Date.now().toString(36)}`,type:'terrain_rule',role:rule.role,category:'terrain_rules',col:cell.col,row:cell.row,x:cell.col*TW,y:cell.row*TH,widthTiles:1,heightTiles:1,widthPx:TW,heightPx:TH,zIndex:defaultPngZIndexForRole(rule.role),source:'png-terrain-rule'};pngOverlayObjects=pngOverlayObjects.filter(o=>!objectFootprintsOverlap(obj,o));pngOverlayObjects.push(obj);selectedPngObjectId=obj.id;levelData.map_format='png';const mapEl=q('#lf-map_format');if(mapEl)mapEl.value='png';syncPngObjectSummary();pushHistory(tiles,pngOverlayObjects);setPackStatus(`Placed ${rule.label} at ${obj.col},${obj.row}`);redrawMap();updateDirty();}
function placePngObject(role,cell){const first=pngAnimations().find(a=>String(a.role).toLowerCase()===String(role).toLowerCase())||pngAnimations().find(a=>String(a.category)===categoryForPngRole(role));if(first)activePngAnimationId=first.id;placeActivePngAnimation(cell);}
function clearPngObjectAt(cell,point=null){const target=point|| (cell?{x:cell.col*TW+Math.floor(TW/2),y:cell.row*TH+Math.floor(TH/2)}:null);if(!target)return;const before=pngOverlayObjects.length;pngOverlayObjects=pngOverlayObjects.filter(o=>{const b=pngObjectBounds(o);return !(target.x>=b.x&&target.x<b.x+b.widthPx&&target.y>=b.y&&target.y<b.y+b.heightPx);});if(pngOverlayObjects.length!==before){selectedPngObjectId=null;syncPngObjectSummary();pushHistory(tiles,pngOverlayObjects);setPackStatus('PNG object cleared');redrawMap();updateDirty();}}
function setPngObjectPointAt(objectId,point){
  const src=pngOverlayObjects.find(o=>String(o.id)===String(objectId));
  if(!src||!point||!isFreePngPointRole(src.role))return false;
  const obj={...src};
  const kind=pngObjectPointKind(obj.role);
  if(kind==='spawn'){obj.spawn_x=Math.floor(point.x);obj.spawn_y=Math.floor(point.y);}
  else{obj.trigger_x=Math.floor(point.x);obj.trigger_y=Math.floor(point.y);if(kind==='exit'){obj.exit_x=obj.trigger_x;obj.exit_y=obj.trigger_y;}}
  pngOverlayObjects=pngOverlayObjects.map(o=>String(o.id)===String(objectId)?obj:o);
  selectedPngObjectId=obj.id;
  syncPngObjectSummary();pushHistory(tiles,pngOverlayObjects);redrawMap();updateDirty();
  setPackStatus(`${kind==='spawn'?'Spawn':kind==='exit'?'Exit':'Trap trigger'} point set to ${Math.floor(point.x)},${Math.floor(point.y)}px`);
  return true;
}
function adjustSelectedPngObjectZIndex(delta){
  const src=pngOverlayObjects.find(o=>String(o.id)===String(selectedPngObjectId));
  if(!src){setPackStatus('Select a PNG object first.');return false;}
  const obj=normalisePngObjectPosition({...src,zIndex:pngObjectZIndex(src)+Number(delta||0)});
  pngOverlayObjects=pngOverlayObjects.map(o=>String(o.id)===String(obj.id)?obj:o);
  syncPngObjectSummary();pushHistory(tiles,pngOverlayObjects);redrawMap();updateDirty();
  setPackStatus(`Set ${obj.role||'PNG object'} layer/z-index to ${obj.zIndex}`);
  return true;
}
function setSelectedPngObjectZIndex(value){
  const src=pngOverlayObjects.find(o=>String(o.id)===String(selectedPngObjectId));
  if(!src){setPackStatus('Select a PNG object first.');return false;}
  const z=Number(value);
  if(!Number.isFinite(z)){setPackStatus('Layer/z-index must be a number.');return false;}
  const obj=normalisePngObjectPosition({...src,zIndex:z});
  pngOverlayObjects=pngOverlayObjects.map(o=>String(o.id)===String(obj.id)?obj:o);
  syncPngObjectSummary();pushHistory(tiles,pngOverlayObjects);redrawMap();updateDirty();
  setPackStatus(`Set ${obj.role||'PNG object'} layer/z-index to ${obj.zIndex}`);
  return true;
}
function resetSelectedPngObjectZIndex(){
  const src=pngOverlayObjects.find(o=>String(o.id)===String(selectedPngObjectId));
  if(!src){setPackStatus('Select a PNG object first.');return false;}
  return setSelectedPngObjectZIndex(defaultPngZIndexForRole(src.role));
}
function syncPngObjectSummary(){const el=q('#png-object-summary');const selected=pngOverlayObjects.find(o=>String(o.id)===String(selectedPngObjectId));const layerInput=q('#png-layer-z');if(layerInput)layerInput.value=selected?String(pngObjectZIndex(selected)):'0';if(!el)return;const counts={};for(const o of pngOverlayObjects)counts[o.role]=(counts[o.role]||0)+1;const text=Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(' · ');const selectedText=selected?` · selected ${selected.role||'object'} z=${pngObjectZIndex(selected)}`:'';el.textContent=(text?text+selectedText:'PNG workflow: 1) Import terrain PNG. 2) Import animations into the global PNG library. 3) Place objects and Ctrl-click points. 4) Save PNG Level JSON. 5) Publish to Custom Levels.');}
function drawAnimationFrame(ctx,anim,dx,dy,dw,dh,frame=0){const a=normalisePngAnimation(anim||{});const img=getPngAnimationPreviewImage(a);if(!img)return false;const fw=a.frameWidthTiles*TW,fh=a.frameHeightTiles*TH;const f=Math.max(0,Math.min(a.frames-1,frame|0));const vertical=String(a.orientation||'horizontal').startsWith('v');const sx=vertical?0:f*fw;const sy=vertical?f*fh:0;try{ctx.drawImage(img,sx,sy,fw,fh,dx,dy,dw,dh);return true;}catch{return false;}}
function drawPngOverlayObjects(ctx){
  for(const objRaw of pngObjectsInDrawOrder()){
    const obj=normalisePngObjectPosition(objRaw);
    const role=String(obj.role||'decorative').toLowerCase();
    const anim=pngAnimationById(pngObjectAnimationId(obj));
    const x=obj.x*zoom,y=obj.y*zoom,w=obj.widthPx*zoom,h=obj.heightPx*zoom;
    const rule=pngTerrainRuleByRole(role);
    const colour=(rule?.colour)||{hatch:'#40e070',exit:'#80c0ff',goal:'#80c0ff',triggered_trap:'#ff8040',fire:'#ff3030',water:'#4090ff',acid:'#b0ff40',toxic:'#b0ff40',decorative:'#c080ff'}[role]||'#c080ff';
    ctx.save();
    const drawn=rule?false:drawAnimationFrame(ctx,anim,x,y,w,h,0);
    if(!drawn){ctx.globalAlpha=rule?0.42:0.28;if(role==='no_collision'){ctx.fillStyle='rgba(255,80,160,0.45)';ctx.fillRect(x,y,w,h);ctx.strokeStyle='rgba(255,255,255,0.65)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);ctx.moveTo(x+w,y);ctx.lineTo(x,y+h);ctx.stroke();}else{ctx.fillStyle=colour;ctx.fillRect(x,y,w,h);}ctx.globalAlpha=1;}
    ctx.strokeStyle=String(obj.id)===String(selectedPngObjectId)?C.gold:colour;ctx.lineWidth=String(obj.id)===String(selectedPngObjectId)?4:3;ctx.strokeRect(x,y,w,h);
    ctx.fillStyle=colour;ctx.font=`bold ${Math.max(8,Math.floor(Math.min(w,h)*0.28))}px monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
    const label={hatch:'H',exit:'G',goal:'G',triggered_trap:'T',fire:'F',water:'W',acid:'A',toxic:'A',steel:'S',no_collision:'Ø',decorative:'D'}[role]||'?';ctx.fillText(label,x+w/2,y+h/2);
    const point=pngObjectPoint(obj);
    if(point){
      const px=point.x*zoom,py=point.y*zoom;
      ctx.save();ctx.strokeStyle=C.gold;ctx.fillStyle=C.gold;ctx.lineWidth=2;
      if(point.kind==='exit'){ctx.globalAlpha=0.55;ctx.beginPath();ctx.arc(px,py,8*zoom,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
      ctx.beginPath();ctx.moveTo(px-5*zoom,py);ctx.lineTo(px+5*zoom,py);ctx.moveTo(px,py-5*zoom);ctx.lineTo(px,py+5*zoom);ctx.stroke();
      ctx.beginPath();ctx.arc(px,py,2.2*zoom,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
function drawActivePngAnimationGhost(ctx,cell){
  if(!cell||!isPngMapMode())return;const rule=pngTerrainRuleByRole(activePngPlacementMode);
  if(rule){const x=cell.col*TW*zoom,y=cell.row*TH*zoom,w=TW*zoom,h=TH*zoom;ctx.save();ctx.globalAlpha=0.55;ctx.fillStyle=rule.colour;ctx.fillRect(x,y,w,h);ctx.globalAlpha=1;ctx.strokeStyle=C.gold;ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);ctx.restore();return;}
  const anim=activePngAnimation();if(!anim)return;const fp=animationFootprint(anim);const col=Math.max(0,Math.min(COLS-1,cell.col));const row=Math.max(0,Math.min(ROWS-1,cell.row));const w=Math.min(fp.widthTiles,COLS-col)*TW*zoom;const h=Math.min(fp.heightTiles,ROWS-row)*TH*zoom;const x=col*TW*zoom,y=row*TH*zoom;ctx.save();ctx.globalAlpha=0.65;drawAnimationFrame(ctx,anim,x,y,w,h,0);ctx.globalAlpha=1;ctx.strokeStyle=C.gold;ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);ctx.restore();
}
function pngOverlayPayload(){return {format:'sms-lemmings-png-overlay',version:2,objects:pngOverlayObjects.map(o=>normalisePngObjectPosition(o))};}
function animationPackPayload(){return pngAnimationLibraryPayload();}
function pngLevelAnimationJsonPayload(options={}){const includeLegacyAnimations=!!options.includeLegacyAnimations;const payload={format:'sms-lemmings-png-level',version:2,mapFormat:'png',terrainPng:levelData.terrain_png||terrainPngName||'',backgroundColor:levelData.background_color||'#000000',animationLibrary:PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME,animationPack:{source:'global',path:PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME},objects:pngOverlayObjects.map(o=>normalisePngObjectPosition(o))};if(includeLegacyAnimations)payload.animations=pngAnimations().map(a=>normalisePngAnimation(a));return payload;}
function defaultAnimationPackPayload(){return pngAnimationLibraryPayload();}
function pngLevelDirtySnapshot(){
  try{
    return JSON.stringify({
      mapFormat:levelData?.map_format||'',
      terrainPng:levelData?.terrain_png||terrainPngName||'',
      backgroundColor:levelData?.background_color||'#000000',
      pngLevelJson:levelData?.png_level_json||'',
      pngLevel:pngLevelAnimationJsonPayload()
    });
  }catch{return '';}
}

function pngDraftAutosavePayload(){
  const globalLibrary=pngAnimationLibraryPayload();
  const objects=clonePngOverlayObjects(pngOverlayObjects).map(o=>normalisePngObjectPosition(o));
  const pngLevelJson={...pngLevelAnimationJsonPayload(),objects};
  return {
    format:'sms-lemmings-editor-png-draft-autosave',
    version:1,
    updatedAt:new Date().toISOString(),
    levelData:{...levelData,map_format:'png'},
    terrainPngName:terrainPngName||levelData.terrain_png||'',
    terrainPngDataUrl:terrainPngDataUrl||'',
    terrainPngVisible:terrainPngVisible!==false,
    pngOverlayObjects:objects,
    pngGlobalAnimationLibrary:globalLibrary,
    pngAnimationPack:globalLibrary,
    pngLevelJson
  };
}
function pngDraftAutosaveSnapshot(){
  try{return JSON.stringify(pngDraftAutosavePayload());}catch{return '';}
}
function setPngAutosaveStatus(text){const el=q('#png-autosave-status');if(el)el.textContent=text||'';}
function schedulePngDraftAutosave({immediate=false}={}){
  if(!isPngMapMode())return;
  if(!window.electronAPI||typeof window.electronAPI.savePngDraftAutosave!=='function')return;
  const delay=immediate?0:900;
  if(pngDraftAutosaveTimer)clearTimeout(pngDraftAutosaveTimer);
  pngDraftAutosaveTimer=setTimeout(()=>{pngDraftAutosaveTimer=null;savePngDraftAutosaveNow();},delay);
}
async function savePngDraftAutosaveNow(){
  if(pngDraftAutosaveInFlight||!isPngMapMode())return;
  if(!window.electronAPI||typeof window.electronAPI.savePngDraftAutosave!=='function')return;
  let payload,snapshot;
  try{payload=pngDraftAutosavePayload();snapshot=JSON.stringify(payload);}catch{return;}
  if(snapshot&&snapshot===lastPngDraftAutosaveSnapshot)return;
  pngDraftAutosaveInFlight=true;
  try{
    const r=await window.electronAPI.savePngDraftAutosave(payload);
    if(r&&r.ok!==false){lastPngDraftAutosaveSnapshot=snapshot;const label=payload.updatedAt?new Date(payload.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'now';setPngAutosaveStatus(`Autosaved PNG draft ${label}`);}
    else if(r&&r.error)setPngAutosaveStatus('Autosave failed: '+r.error);
  }catch(err){setPngAutosaveStatus('Autosave failed. Save PNG Level JSON before closing.');}
  finally{pngDraftAutosaveInFlight=false;}
}
function applyPngDraftAutosavePayload(payload){
  if(!payload||typeof payload!=='object')throw new Error('Autosave file is empty or invalid.');
  const level=payload.levelData||{};
  levelData={...levelData,...level,map_format:'png'};
  const pack=payload.pngGlobalAnimationLibrary||payload.pngAnimationPack||{};
  const animations=Array.isArray(pack.animations)?pack.animations:(Array.isArray(payload.pngLevelJson?.animations)?payload.pngLevelJson.animations:[]);
  if(animations.length){mergePngAnimationPackIntoGlobal({...pack,animations});schedulePngAnimationLibrarySave({immediate:true,silent:true});}
  const objects=Array.isArray(payload.pngOverlayObjects)?payload.pngOverlayObjects:(Array.isArray(payload.pngLevelJson?.objects)?payload.pngLevelJson.objects:[]);
  pngOverlayObjects=clonePngOverlayObjects(objects).map(o=>normalisePngObjectPosition(o));
  terrainPngName=payload.terrainPngName||levelData.terrain_png||terrainPngName||'';
  terrainPngDataUrl=payload.terrainPngDataUrl||'';
  terrainPngVisible=payload.terrainPngVisible!==false;
  if(terrainPngDataUrl){
    const img=new Image();
    img.onload=()=>{terrainPngImg=img;resizeLevelMap(Math.max(1,Math.floor(img.naturalWidth/TW)),Math.max(1,Math.floor(img.naturalHeight/TH)),{preserve:true,markDirty:false,status:false});redrawMap();};
    img.src=terrainPngDataUrl;
  }
  populateLevelForm(levelData);
  activePngPlacementMode='select';activePngAnimationId='';selectedPngObjectId=null;pngObjectDrag=null;
  refreshPngModeUi();syncPngObjectSummary();history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;updateHistStatus();redrawMap();updateDirty();
}
async function restorePngDraftAutosave({prompt=true}={}){
  if(!window.electronAPI||typeof window.electronAPI.loadPngDraftAutosave!=='function'){
    await appAlert('No PNG autosave support is available in this build.',{title:'No autosave'});return false;
  }
  const r=await window.electronAPI.loadPngDraftAutosave();
  const payload=r&&r.payload?r.payload:r;
  if(!payload||payload.ok===false){
    if(prompt)await appAlert((r&&r.error)||'No PNG autosave draft was found.',{title:'No PNG autosave'});
    return false;
  }
  const when=payload.updatedAt?new Date(payload.updatedAt).toLocaleString():'unknown time';
  const count=Array.isArray(payload.pngGlobalAnimationLibrary?.animations)?payload.pngGlobalAnimationLibrary.animations.length:(Array.isArray(payload.pngAnimationPack?.animations)?payload.pngAnimationPack.animations.length:(Array.isArray(payload.pngLevelJson?.animations)?payload.pngLevelJson.animations.length:0));
  if(prompt){
    const ok=await appConfirm(`Restore the last PNG editor autosave?

Saved: ${when}
Animations: ${count}

This replaces the current editor canvas/object layer.`,{title:'Restore PNG autosave?',okText:'Restore'});
    if(!ok)return false;
  }
  applyPngDraftAutosavePayload(payload);
  lastPngDraftAutosaveSnapshot=pngDraftAutosaveSnapshot();
  setPackStatus(`Restored PNG autosave from ${when}. Save PNG Level JSON or Publish to Custom Levels when you're happy.`);
  setPngAutosaveStatus(`Restored autosave from ${when}`);
  return true;
}
async function maybePromptForPngDraftAutosave(){
  if(pngDraftAutosaveRestorePromptShown)return;
  pngDraftAutosaveRestorePromptShown=true;
  if(!window.electronAPI||typeof window.electronAPI.loadPngDraftAutosave!=='function')return;
  try{
    const r=await window.electronAPI.loadPngDraftAutosave();
    const payload=r&&r.payload?r.payload:r;
    if(!payload||payload.ok===false||!payload.updatedAt)return;
    const autosaveAnimations=Array.isArray(payload.pngGlobalAnimationLibrary?.animations)?payload.pngGlobalAnimationLibrary.animations:(Array.isArray(payload.pngAnimationPack?.animations)?payload.pngAnimationPack.animations:[]);
    const hasImportedAnimations=autosaveAnimations.some(a=>String(a.image||'').startsWith('data:image/'));
    const hasObjects=Array.isArray(payload.pngOverlayObjects)&&payload.pngOverlayObjects.length>0;
    if(!hasImportedAnimations&&!hasObjects)return;
    const when=new Date(payload.updatedAt).toLocaleString();
    const ok=await appConfirm(`I found an autosaved PNG draft from ${when}.

Restore it now?`,{title:'Recover PNG draft?',okText:'Restore'});
    if(ok)restorePngDraftAutosave({prompt:false});
    else setPngAutosaveStatus(`Autosave available from ${when}`);
  }catch{}
}
function markPngLevelSaved(){
  savedOverlaySnapshotJson=JSON.stringify(pngOverlayObjects);
  savedPngLevelSnapshotJson=pngLevelDirtySnapshot();
}
function pngTerrainRuleByRole(role){return PNG_TERRAIN_RULES.find(r=>r.role===String(role||'').toLowerCase())||null;}
function isPngTerrainRuleRole(role){return !!pngTerrainRuleByRole(role);}
function setPngPlacementMode(mode){activePngPlacementMode=mode||'select';if(activePngPlacementMode!=='animation')activePngAnimationId='';renderPngAnimationPalette();redrawMap();updateStatusBar();const rule=pngTerrainRuleByRole(activePngPlacementMode);if(rule)setPackStatus('Selected PNG terrain rule: '+rule.label);}
function refreshPngModeUi(){
  const png=isPngMapMode();
  const brushSec=q('#left-brush-pack-section');if(brushSec)brushSec.style.display=png?'none':'flex';
  const pngSec=q('#png-mode-section');if(pngSec)pngSec.style.display=png?'flex':'none';
  const brushStrip=q('#brush-strip');if(brushStrip)brushStrip.style.display=png?'none':'flex';
  const animStrip=q('#png-animation-strip');if(animStrip)animStrip.style.display=png?'flex':'none';
  for(const id of ['#mlm-tools-section','#active-tile-section','#brush-handle-section','#reference-image-section']){const el=q(id);if(el)el.style.display=png?'none':'';}
  const tilesTab=document.querySelector('.rpanel-tab[data-tab="tiles"]');
  if(tilesTab){
    tilesTab.textContent='TILES';
    tilesTab.style.display=png?'none':'';
    if(png&&tilesTab.classList.contains('active')){
      const levelTab=document.querySelector('.rpanel-tab[data-tab="level"]');
      if(levelTab)levelTab.click();
    }
  }
  const tilesPage=q('#rpanel-tiles');if(tilesPage)tilesPage.style.display=png?'none':(document.querySelector('.rpanel-tab[data-tab="tiles"]')?.classList.contains('active')?'flex':tilesPage.style.display);
  const tsBtn=q('#btn-open-ts');if(tsBtn)tsBtn.style.display=png?'none':'';
  if(png){activeBrush=null;pasteMode=false;}
  syncMapFormatToggle();
  renderPngAnimationPalette();
  updateTilePreview();
  updateStatusBar();
}
function renderPngAnimationPalette(){const tabs=q('#png-animation-tabs'),list=q('#png-animation-list'),status=q('#png-active-animation-status');if(!tabs||!list)return;tabs.innerHTML='';for(const cat of PNG_ANIMATION_CATEGORIES){const btn=document.createElement('button');btn.className='sbtn';btn.textContent=cat.label;btn.style.cssText=`font-size:10px;${activePngAnimationCategory===cat.id?'border-color:'+C.gold+';color:'+C.gold:''}`;btn.onclick=()=>{activePngAnimationCategory=cat.id;const first=pngAnimations().find(a=>String(a.category||categoryForPngRole(a.role))===cat.id);if(first)activePngAnimationId=first.id;renderPngAnimationPalette();redrawMap();};tabs.appendChild(btn);}list.innerHTML='';const shown=pngAnimations().filter(a=>String(a.category||categoryForPngRole(a.role))===activePngAnimationCategory);if(!shown.length){list.innerHTML=`<div style="font-size:11px;color:${C.dim};padding:10px">No animations in this category yet. Import one from the PNG Mode panel.</div>`;}for(const animRaw of shown){const anim=normalisePngAnimation(animRaw);const card=document.createElement('button');card.className='sbtn';card.style.cssText=`width:120px;height:82px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-color:${activePngPlacementMode==='animation'&&activePngAnimationId===anim.id?C.gold:C.border};color:${activePngPlacementMode==='animation'&&activePngAnimationId===anim.id?C.gold:C.text};flex-shrink:0`;const canvas=document.createElement('canvas');canvas.width=64;canvas.height=40;canvas.style.cssText='image-rendering:pixelated;background:#05050a;border:1px solid #242440;max-width:90px;max-height:44px';const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;c.fillStyle='#05050a';c.fillRect(0,0,canvas.width,canvas.height);const fw=anim.frameWidthTiles*TW,fh=anim.frameHeightTiles*TH;const scale=Math.max(1,Math.floor(Math.min(64/fw,40/fh)));const dw=fw*scale,dh=fh*scale;if(!drawAnimationFrame(c,anim,Math.floor((64-dw)/2),Math.floor((40-dh)/2),dw,dh,0)){c.fillStyle=C.dim;c.font='9px monospace';c.textAlign='center';c.fillText(anim.role,32,22);}const label=document.createElement('div');label.textContent=anim.name||anim.id;label.style.cssText='font-size:9px;font-weight:800;max-width:108px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';card.appendChild(canvas);card.appendChild(label);card.onclick=()=>{activePngPlacementMode='animation';activePngPlacementMode='animation';activePngAnimationId=anim.id;activePngAnimationCategory=anim.category;renderPngAnimationPalette();redrawMap();setPackStatus('Selected PNG animation: '+(anim.name||anim.id));};list.appendChild(card);}const active=activePngAnimation();const rule=pngTerrainRuleByRole(activePngPlacementMode);if(status)status.textContent=rule?`Selected: ${rule.label} · ${rule.summary}`:(activePngPlacementMode==='animation'&&active?`Selected: ${active.name||active.id} · ${active.role} · ${active.frameWidthTiles||active.widthTiles||1}×${active.frameHeightTiles||active.heightTiles||1} tiles`:'No object selected. Click and drag an existing object to move it.');}


async function saveEditorTextFile(defaultName,text,extensionName='JSON',extension='json'){
  const data=Array.from(new TextEncoder().encode(String(text)));
  return window.electronAPI.saveFile({defaultName,filters:[{name:extensionName,extensions:[extension]}],data});
}
async function exportPngOverlayJson(){
  syncLevelData();
  if(!levelData.overlay_json)levelData.overlay_json=safeLevelStem()+'.overlay.json';
  const el=q('#lf-overlay_json');if(el)el.value=levelData.overlay_json;
  await saveEditorTextFile(levelData.overlay_json,JSON.stringify(pngOverlayPayload(),null,2),'JSON','json');
  savedOverlaySnapshotJson=JSON.stringify(pngOverlayObjects);updateDirty();
  setPackStatus('Exported PNG overlay JSON.');
}
async function exportAnimationPackJson(){
  syncLevelData();
  if(!levelData.animation_pack_json)levelData.animation_pack_json=safeLevelStem()+'.animpack.json';
  const el=q('#lf-animation_pack_json');if(el)el.value=levelData.animation_pack_json;
  await saveEditorTextFile(levelData.animation_pack_json,JSON.stringify(defaultAnimationPackPayload(),null,2),'JSON','json');
  setPackStatus('Exported global PNG animation library JSON. Levels store placements and refer to this library.');
}

async function exportPngLevelAnimationJson(){
  syncLevelData();
  if(!levelData.png_level_json)levelData.png_level_json=safeLevelStem()+'.pnglevel.json';
  const el=q('#lf-png_level_json');if(el)el.value=levelData.png_level_json;
  await saveEditorTextFile(levelData.png_level_json,JSON.stringify(pngLevelAnimationJsonPayload(),null,2),'JSON','json');
  markPngLevelSaved();updateDirty();
  setPackStatus('Saved PNG Level JSON with placed objects/points. Animations live in the global PNG animation library.');
}


function ensurePngPublishFilenames(){
  const rating=normaliseMainGameRating(levelData.rating||'FUN');
  const n=String(Math.max(1,Number(levelData.level_number)||1)).padStart(2,'0');
  const rawLevelId=String(levelData.level_id||'').trim();
  const defaultishId=!rawLevelId||/^level[_-]?0*1$/i.test(rawLevelId);
  const preferredStem=defaultishId?`${rating}_${n}`:safeLevelStem();
  const stem=preferredStem.replace(/\.(mlm\.ini|ini|pnglevel\.json|png)$/i,'')||`${rating}_${n}`;
  const terrainName=`${stem}.png`;
  const jsonName=`${stem}.pnglevel.json`;
  levelData.map_format='png';
  levelData.level_id=stem;
  levelData.terrain_png=terrainName;
  levelData.png_level_json=jsonName;
  levelData.animation_pack_json=PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME;
  const idEl=q('#lf-level_id'),mapEl=q('#lf-map_format'),terrainEl=q('#lf-terrain_png'),jsonEl=q('#lf-png_level_json'),packEl=q('#lf-animation_pack_json');
  if(idEl)idEl.value=stem;
  if(mapEl)mapEl.value='png';
  if(terrainEl)terrainEl.value=terrainName;
  if(jsonEl)jsonEl.value=jsonName;
  if(packEl)packEl.value=PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME;
  return {stem,terrainName,jsonName,iniName:`${stem}.mlm.ini`};
}

function isMultiplayerLevelMode(data=levelData){
  const ruleset=String(data?.ruleset||'').toLowerCase();
  const mode=String(data?.mode||'').toLowerCase();
  return ruleset==='multiplayer'||mode==='multiplayer';
}

function normaliseMultiplayerPublishStem(){
  syncLevelData();
  const raw=String(levelData.level_id||'').trim();
  const n=String(Math.max(1,Number(levelData.level_number)||1)).padStart(2,'0');
  const defaultish=!raw||/^level[_-]?0*1$/i.test(raw);
  const preferred=defaultish?`MULTI_${n}`:raw;
  return preferred.replace(/\.(mlm\.ini|ini|mlm|json)$/i,'').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').toUpperCase()||`MULTI_${n}`;
}

function ensureMultiplayerPublishFilenames(){
  const stem=normaliseMultiplayerPublishStem();
  levelData.level_id=stem;
  levelData.mode='multiplayer';
  levelData.ruleset='multiplayer';
  levelData.mlm_file=`${stem}.mlm`;
  levelData.rating='multiplayer';
  const idEl=q('#lf-level_id'),modeEl=q('#lf-mode'),rulesetEl=q('#lf-ruleset'),mlmEl=q('#lf-mlm_file'),ratingEl=q('#lf-rating');
  if(idEl)idEl.value=stem;
  if(modeEl)modeEl.value='multiplayer';
  if(rulesetEl)rulesetEl.value='multiplayer';
  if(mlmEl)mlmEl.value=`${stem}.mlm`;
  if(ratingEl)ratingEl.value='multiplayer';
  refreshRulesetFormVisibility();
  return {stem,mlmName:`${stem}.mlm`,iniName:`${stem}.mlm.ini`};
}

async function publishCurrentLevelToMultiplayerLevels(){
  syncLevelData();
  if(!isMultiplayerLevelMode()){
    const ok=await appConfirm('This level is not marked as Multiplayer yet. Switch Ruleset Category and Level Type to Multiplayer and publish it there?',{title:'Publish multiplayer level',okText:'Switch & Publish'});
    if(!ok)return;
    levelData.mode='multiplayer';
    levelData.ruleset='multiplayer';
    populateLevelForm(levelData);
  }
  applyMapSizeFromFields();
  const missing=getProjectSaveMissingFields();
  if(missing.length){
    await appAlert('Fill in these level details before publishing to multiplayer:\n\n• '+missing.join('\n• '),{title:'Multiplayer publish needs details'});
    return;
  }
  const {stem,mlmName,iniName}=ensureMultiplayerPublishFilenames();
  const title=String(levelData.name||stem).trim()||stem;
  const mlmBytes=encodeMlm(tiles);
  const iniText=levelDataToIni({...levelData,level_id:stem,name:title,mode:'multiplayer',ruleset:'multiplayer',mlm_file:mlmName,rating:'multiplayer'});
  setPackStatus(`Publishing multiplayer level ${stem} into public/multiplayer/levels…`);
  try{
    const result=await window.electronAPI.publishMultiplayerLevel({
      levelId:stem,
      title,
      mlmName,
      iniName,
      mlmBase64:bytesToBase64Chunked(mlmBytes),
      iniText
    });
    if(!result||!result.ok){
      await appAlert('Could not publish this multiplayer level.\n\n'+(result&&result.error?result.error:'Unknown error'),{title:'Publish failed',danger:true});
      setPackStatus('Multiplayer publish failed. Run npm run web and open /editor/ from localhost.');
      return;
    }
    savedTileSnapshot=new Uint8Array(tiles);
    updateDirty();
    setPackStatus(`Published ${stem} to Multiplayer Levels. Files: ${result.files?.mlm||mlmName}, ${result.files?.ini||iniName}.`);
    await appAlert(`Published to multiplayer levels.\n\nSaved:\n• ${result.files?.mlm||'multiplayer/levels/'+mlmName}\n• ${result.files?.ini||'multiplayer/levels/'+iniName}\n\nThe 2 PLAYER level selector will pick it up from /api/multiplayer-levels.`,{title:'Multiplayer level published'});
  }catch(err){
    await appAlert('Could not publish this multiplayer level.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Publish failed',danger:true});
    setPackStatus('Multiplayer publish failed.');
  }
}

async function publishCurrentPngLevelToCustomLevels(){
  syncLevelData();
  if(!isPngMapMode()){
    await appAlert('Switch this level to PNG mode before publishing it as a custom PNG level.',{title:'PNG mode only'});
    return;
  }

  const payloadBeforeNames=pngLevelAnimationJsonPayload();
  const terrainDataUrl=terrainPngDataUrl || (String(payloadBeforeNames.terrainPng||'').startsWith('data:image/')?String(payloadBeforeNames.terrainPng):'');
  if(!terrainDataUrl){
    await appAlert('I need the actual terrain PNG data to publish the level. Re-import the terrain PNG, then press Publish to Custom Levels again.',{title:'Terrain PNG needed',danger:true});
    return;
  }

  const {stem,terrainName,jsonName,iniName}=ensurePngPublishFilenames();
  const title=String(levelData.name||stem).trim()||stem;
  const rating=normaliseMainGameRating(levelData.rating||'FUN');
  const levelNumber=Math.max(1,Number(levelData.level_number)||1);
  const pngLevelJson={...pngLevelAnimationJsonPayload(),terrainPng:terrainName,backgroundColor:levelData.background_color||'#000000'};
  const iniText=levelDataToIni({...levelData,rating,level_number:levelNumber,map_format:'png',terrain_png:terrainName,png_level_json:jsonName,animation_pack_json:PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME,mlm_file:''});

  const animationLibraryPayload=pngAnimationLibraryPayload();
  const animationLibrarySaved=await saveGlobalPngAnimationLibrary({silent:true,force:true});
  setPackStatus(animationLibrarySaved?'Publishing PNG level and global animations into public/custom-levels…':'Publishing PNG level; publish endpoint will also write the global animation library…');
  try{
    const result=await window.electronAPI.publishCustomPngLevel({
      levelId:stem,
      title,
      iniName,
      terrainPngName:terrainName,
      pngLevelJsonName:jsonName,
      rating,
      levelNumber,
      iniText,
      pngLevelJson,
      animationLibrary:animationLibraryPayload,
      animationLibraryName:PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME,
      terrainPngDataUrl:terrainDataUrl
    });

    if(!result||!result.ok){
      await appAlert('Could not publish this PNG level.\n\n'+(result&&result.error?result.error:'Unknown error'),{title:'Publish failed',danger:true});
      setPackStatus('Publish failed. If you opened the editor as a plain file/static page, run npm run web and use localhost/editor/.');
      return;
    }

    markPngLevelSaved();
    updateDirty();
    setPackStatus(`Published ${stem} to Custom Levels (${rating} ${String(levelNumber).padStart(2,'0')}) and saved global animations. Files: ${result.files?.ini||iniName}, ${result.files?.terrain_png||terrainName}, ${result.files?.png_level_json||jsonName}, ${result.files?.animation_library||PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME}. Manifest now has ${result.manifestCount||'?'} level(s).`);
    await appAlert(`Published to the main game's Custom Levels list.\n\nSaved:\n• ${result.files?.ini||'custom-levels/'+iniName}\n• ${result.files?.terrain_png||'custom-levels/'+terrainName}\n• ${result.files?.png_level_json||'custom-levels/'+jsonName}\n• ${result.files?.animation_library||'custom-levels/'+PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME}\n• ${result.files?.manifest||'custom-levels/manifest.json'}\n\nOpen the main game, toggle CLASSIC/CUSTOM to CUSTOM, then cycle to the matching pack card.`,{title:'Custom level published'});
  }catch(err){
    await appAlert('Could not publish this PNG level.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Publish failed',danger:true});
    setPackStatus('Publish failed.');
  }
}

async function importPngLevelAnimationJson(){
  const r=await window.electronAPI.openFile([{name:'PNG Level JSON',extensions:['json']}]);
  if(!r)return;
  try{
    const text=new TextDecoder().decode(new Uint8Array(r.data));
    const payload=JSON.parse(text);
    const animations=Array.isArray(payload.animations)?payload.animations:Array.isArray(payload.animationPackJson?.animations)?payload.animationPackJson.animations:[];
    const objects=Array.isArray(payload.objects)?payload.objects:Array.isArray(payload.overlayJson?.objects)?payload.overlayJson.objects:[];
    if(!animations.length&&!objects.length)throw new Error('That JSON does not contain PNG animation/object data.');
    if(animations.length){mergePngAnimationPackIntoGlobal({name:payload.name||payload.packName||'Imported PNG animations',animations});schedulePngAnimationLibrarySave({immediate:true,silent:true});}
    pngOverlayObjects=clonePngOverlayObjects(objects).map(o=>normalisePngObjectPosition(o));
    selectedPngObjectId=null;pngObjectDrag=null;
    const fileName=String(r.path||r.name||'level_001.pnglevel.json').replace(/.*[\\/]/,'');
    levelData.map_format='png';
    levelData.png_level_json=fileName;
    if(payload.terrainPng)levelData.terrain_png=payload.terrainPng;
    if(payload.backgroundColor)levelData.background_color=payload.backgroundColor;
    if(String(payload.terrainPng||'').startsWith('data:image/')){
      terrainPngDataUrl=payload.terrainPng;terrainPngName=fileName.replace(/\.pnglevel\.json$/i,'.png');
      const img=new Image();img.onload=()=>{terrainPngImg=img;resizeLevelMap(Math.max(1,Math.floor(img.naturalWidth/TW)),Math.max(1,Math.floor(img.naturalHeight/TH)),{preserve:true,markDirty:false,status:false});redrawMap();};img.src=terrainPngDataUrl;
    }
    populateLevelForm(levelData);
    activePngPlacementMode='select';activePngAnimationId='';
    refreshPngModeUi();syncPngObjectSummary();
    history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;updateHistStatus();
    markPngLevelSaved();redrawMap();updateDirty();
    setPackStatus(`Loaded PNG Level JSON: ${fileName} · ${objects.length} object${objects.length===1?'':'s'}${animations.length?` · merged ${animations.length} legacy embedded animation${animations.length===1?'':'s'} into the global library`:''}`);
  }catch(err){
    await appAlert('Could not load PNG Level JSON.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'PNG Level JSON failed',danger:true});
  }
}

async function exportRenderedMapPng(){
  if(!isPngMapMode()&&!tilesetImg){appAlert('Load a tileset before exporting a rendered PNG.',{title:'No tileset'});return;}
  if(isPngMapMode()&&!terrainPngImg){appAlert('Import a terrain PNG first.',{title:'No terrain PNG'});return;}
  const canvas=document.createElement('canvas');
  canvas.width=COLS*TW;canvas.height=ROWS*TH;
  const ctx=canvas.getContext('2d');
  ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='#000000';ctx.fillRect(0,0,canvas.width,canvas.height);
  if(isPngMapMode()&&terrainPngImg){
    ctx.drawImage(terrainPngImg,0,0,Math.min(canvas.width,terrainPngImg.naturalWidth),Math.min(canvas.height,terrainPngImg.naturalHeight));
  }else{
    const tilesPerRowLocal=Math.max(1,tilesPerRow||16);
    for(let row=0;row<ROWS;row++){
      for(let col=0;col<COLS;col++){
        const tile=tiles[row*COLS+col]||0;
        const sx=(tile%tilesPerRowLocal)*TW;
        const sy=Math.floor(tile/tilesPerRowLocal)*TH;
        try{ctx.drawImage(tilesetImg,sx,sy,TW,TH,col*TW,row*TH,TW,TH);}catch{}
      }
    }
  }
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob){appAlert('Could not export PNG.',{title:'PNG export failed',danger:true});return;}
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const safe=safeLevelStem()||'rendered_level';
  await window.electronAPI.saveFile({defaultName:`${safe}.png`,filters:[{name:'PNG',extensions:['png']}],data:Array.from(bytes)});
  setPackStatus(isPngMapMode()?`Exported terrain PNG copy (${COLS*TW}×${ROWS*TH}px)`: `Exported rendered map PNG (${COLS*TW}×${ROWS*TH}px)`);
}

async function importTerrainPngFile(){
  const input=document.createElement('input');input.type='file';input.accept='image/png';
  input.onchange=()=>{
    const file=input.files&&input.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        if(img.naturalWidth%8!==0||img.naturalHeight%8!==0){appAlert(`PNG dimensions must be clean multiples of 8. This one is ${img.naturalWidth}×${img.naturalHeight}.`);return;}
        terrainPngImg=img;terrainPngName=file.name;terrainPngDataUrl=reader.result;
        levelData.map_format='png';levelData.terrain_png=file.name;
        if(!levelData.png_level_json)levelData.png_level_json=safeLevelStem()+'.pnglevel.json';
        const cols=img.naturalWidth/8,rows=img.naturalHeight/8;
        resizeLevelMap(cols,rows,{preserve:false,markDirty:true,status:false});
        const mapEl=q('#lf-map_format'),pngEl=q('#lf-terrain_png'),w=q('#lf-width_tiles'),h=q('#lf-height_tiles');
        if(mapEl)mapEl.value='png';if(pngEl)pngEl.value=file.name;if(w)w.value=cols;if(h)h.value=rows;
        setPackStatus(`Imported PNG terrain preview: ${file.name} (${cols}×${rows} tiles) · autosaved as PNG draft`);
        refreshPngModeUi();redrawMap();updateDirty();schedulePngDraftAutosave({immediate:true});
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

const MP_MARKERS={
  p1_hatch:{label:"P1 H",name:"P1 hatch",colour:"#4aa3ff",hotkey:"1"},
  p1_goal:{label:"P1 G",name:"P1 goal",colour:"#7ed0ff",hotkey:"2"},
  p2_hatch:{label:"P2 H",name:"P2 hatch",colour:"#ff7070",hotkey:"3"},
  p2_goal:{label:"P2 G",name:"P2 goal",colour:"#ffb070",hotkey:"4"},
};

function isMultiplayerProfile(){
  const ruleset=String(levelData?.ruleset||"").toLowerCase();
  const mode=String(levelData?.mode||"").toLowerCase();
  return ruleset==="multiplayer"||mode==="multiplayer";
}
function markerCell(prefix,data=levelData){
  const col=Number(data?.[`${prefix}_col`]);
  const row=Number(data?.[`${prefix}_row`]);
  if(!Number.isFinite(col)||!Number.isFinite(row)||col<0||row<0)return null;
  return {col:Math.floor(col),row:Math.floor(row)};
}
function setLevelFieldValue(id,value){
  const el=q(`#lf-${id}`);
  if(el)el.value=value;
}
function setMultiplayerMarker(prefix,cell){
  if(!cell)return false;
  const col=Math.max(0,Math.min(COLS-1,Math.floor(cell.col)));
  const row=Math.max(0,Math.min(ROWS-1,Math.floor(cell.row)));
  levelData[`${prefix}_col`]=col;
  levelData[`${prefix}_row`]=row;
  setLevelFieldValue(`${prefix}_col`,col);
  setLevelFieldValue(`${prefix}_row`,row);
  updateProjectSaveButtons();
  redrawMap();
  const marker=MP_MARKERS[prefix];
  setPackStatus(`${marker?.name||prefix} set to tile (${col},${row}) / px (${col*TW},${row*TH})`);
  return true;
}
function clearMultiplayerMarker(prefix){
  levelData[`${prefix}_col`]=-1;
  levelData[`${prefix}_row`]=-1;
  setLevelFieldValue(`${prefix}_col`,-1);
  setLevelFieldValue(`${prefix}_row`,-1);
  updateProjectSaveButtons();
  redrawMap();
  setPackStatus(`${MP_MARKERS[prefix]?.name||prefix} cleared`);
}
function handleMultiplayerMarkerHotkey(e){
  if(e.ctrlKey||e.metaKey||e.altKey)return false;
  const keyByCode={Digit1:"p1_hatch",Numpad1:"p1_hatch",Digit2:"p1_goal",Numpad2:"p1_goal",Digit3:"p2_hatch",Numpad3:"p2_hatch",Digit4:"p2_goal",Numpad4:"p2_goal"};
  const prefix=keyByCode[e.code];
  if(!prefix)return false;

  e.preventDefault();
  if(!isMultiplayerProfile()){
    setPackStatus("Switch Ruleset Category or Level Type to Multiplayer before assigning P1/P2 markers.");
    return true;
  }

  if(e.shiftKey){
    clearMultiplayerMarker(prefix);
    return true;
  }

  if(!hoverCell){
    setPackStatus(`Hover the map, then press ${MP_MARKERS[prefix]?.hotkey||"?"} to place ${MP_MARKERS[prefix]?.name||prefix}.`);
    return true;
  }

  setMultiplayerMarker(prefix,hoverCell);
  return true;
}

// ─── Level data state ─────────────────────────────────────────────────────────
let levelData = {
  pack_name:"Untitled Pack",
  level_id:"level_001",
  name:"",
  mode:"singleplayer",
  ruleset:"sms-expanded",
  width_tiles:112,
  height_tiles:19,
  players:2,
  ownership:'per-player',
  p1_label:'P1',
  p2_label:'P2',
  p1_hatch_col:-1, p1_hatch_row:-1,
  p1_goal_col:-1, p1_goal_row:-1,
  p2_hatch_col:-1, p2_hatch_row:-1,
  p2_goal_col:-1, p2_goal_row:-1,

  map_format:'mlm',
  terrain_png:'',
  background_color:'#000000',
  png_level_json:'',
  overlay_json:'',
  animation_pack_json:'',

  // SMS compatibility fields kept for MLM/INI/playtest paths during the fork.
  mlm_file:"", rating:"custom", level_number:1, fall_distance:56, fall_distance_override:0,
  music:0,
  tileset:0, trap_type:0, trap_x:0, trap_y:0,
  num_lemmings:50, percent_needed:50, release_rate:50, time_minutes:5,
  climbers:0, floaters:0, bombers:0, blockers:0,
  builders:0, bashers:0, miners:0, diggers:0
};
let communityLockedLevelActive=false;
let communityLockedLevelSnapshot=null;


// ─── MLM codec ────────────────────────────────────────────────────────────────
function decodeMlm(ab){
  const d=new Uint8Array(ab),o=new Uint8Array(TOTAL);let s=0,t=0;
  while(s<d.length&&t<TOTAL){if(d[s]===0){const n=d[s+1]??0;s+=2;for(let i=0;i<n&&t<TOTAL;i++)o[t++]=0;}else o[t++]=d[s++];}
  return o;
}
function encodeMlm(t){
  const o=[];let i=0;
  while(i<TOTAL){if(t[i]===0){let n=0;while(i<TOTAL&&t[i]===0&&n<255){n++;i++;}o.push(0,n);}else o.push(t[i++]);}
  return o;
}
function blankMap(){return new Uint8Array(TOTAL);}
function isDirty(){const tileDirty=tiles.length!==savedTileSnapshot.length||tiles.some((v,i)=>v!==savedTileSnapshot[i]);const overlayDirty=JSON.stringify(pngOverlayObjects)!==savedOverlaySnapshotJson;const pngLevelDirty=isPngMapMode()&&pngLevelDirtySnapshot()!==savedPngLevelSnapshotJson;return tileDirty||overlayDirty||pngLevelDirty;}
savedPngLevelSnapshotJson=pngLevelDirtySnapshot();

// ─── Brush pack serialisation ─────────────────────────────────────────────────
function packToJson(name,brs,meta={}){
  const linkedTilesetId = (meta.linkedTilesetId !== undefined) ? meta.linkedTilesetId : (activeTilesetId !== undefined ? activeTilesetId : null);
  return JSON.stringify({
    name,
    linkedTilesetId,
    brushes:brs.map(x=>({name:x.name,w:x.w,h:x.h,data:btoa(String.fromCharCode(...x.data))}))
  });
}
function cloneBrushForPack(b){
  if(!b)return null;
  return {name:b.name||"Brush",w:b.w||1,h:b.h||1,data:new Uint8Array(b.data||[])};
}
function packFromJson(json){
  try{
    const p=JSON.parse(json);
    const dec=arr=>arr.map(x=>({name:x.name,w:x.w,h:x.h,data:new Uint8Array(atob(x.data).split("").map(c=>c.charCodeAt(0)))}));
    if(Array.isArray(p))return{name:"Imported Pack",brushes:dec(p)};
    return{name:p.name||"Imported Pack",brushes:dec(p.brushes||[])};
  }catch{return null;}
}

// ─── Brush previews ───────────────────────────────────────────────────────────
function renderBrushPreview(brush,scale=2){
  const c=document.createElement("canvas");
  c.width=brush.w*TW*scale;c.height=brush.h*TH*scale;
  const ctx=c.getContext("2d");ctx.imageSmoothingEnabled=false;
  ctx.fillStyle="#000";ctx.fillRect(0,0,c.width,c.height);
  for(let r=0;r<brush.h;r++)for(let col=0;col<brush.w;col++){
    const tid=brush.data[r*brush.w+col],dx=col*TW*scale,dy=r*TH*scale;
    if(tid===0){ctx.fillStyle="#000";ctx.fillRect(dx,dy,TW*scale,TH*scale);}
    else if(tilesetImg)ctx.drawImage(tilesetImg,(tid%tilesPerRow)*TW,Math.floor(tid/tilesPerRow)*TH,TW,TH,dx,dy,TW*scale,TH*scale);
    else{ctx.fillStyle=`hsl(${(tid*37)%360},55%,35%)`;ctx.fillRect(dx,dy,TW*scale,TH*scale);}
  }
  return c.toDataURL();
}
function regeneratePreviews(){brushPreviews=brushes.map(b=>renderBrushPreview(b,zoom));}

// ─── History ──────────────────────────────────────────────────────────────────
function clonePngOverlayObjects(list=pngOverlayObjects){
  return JSON.parse(JSON.stringify(Array.isArray(list)?list:[]));
}
function makeHistoryEntry(tileData=tiles,overlayData=pngOverlayObjects){
  return {tiles:new Uint8Array(tileData||[]),overlay:clonePngOverlayObjects(overlayData)};
}
function historyEntryTiles(entry){
  if(entry&&entry.tiles!==undefined)return new Uint8Array(entry.tiles);
  return new Uint8Array(entry||[]);
}
function historyEntryOverlay(entry){
  if(entry&&entry.overlay!==undefined)return clonePngOverlayObjects(entry.overlay);
  return [];
}
function pushHistory(t=tiles,overlay=pngOverlayObjects){
  history=history.slice(0,histIdx+1);history.push(makeHistoryEntry(t,overlay));
  if(history.length>200)history=history.slice(history.length-200);
  histIdx=history.length-1;updateHistStatus();
}
function undo(){if(histIdx<=0)return;histIdx--;const entry=history[histIdx];tiles=historyEntryTiles(entry);pngOverlayObjects=historyEntryOverlay(entry);selectedPngObjectId=null;pngObjectDrag=null;syncPngObjectSummary();updateHistStatus();redrawMap();updateDirty();}
function redo(){if(histIdx>=history.length-1)return;histIdx++;const entry=history[histIdx];tiles=historyEntryTiles(entry);pngOverlayObjects=historyEntryOverlay(entry);selectedPngObjectId=null;pngObjectDrag=null;syncPngObjectSummary();updateHistStatus();redrawMap();updateDirty();}
async function revertAll(){
  if(!(await appConfirm("Revert ALL changes and return to last saved state? This cannot be undone.",{title:"Revert all?",okText:"Revert All",danger:true})))return;
  const first=history[0]||makeHistoryEntry(savedTileSnapshot,JSON.parse(savedOverlaySnapshotJson||'[]'));
  tiles=historyEntryTiles(first);pngOverlayObjects=historyEntryOverlay(first);selectedPngObjectId=null;pngObjectDrag=null;history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;syncPngObjectSummary();updateHistStatus();redrawMap();updateDirty();
}
function updateHistStatus(){
  q("#hist-status").textContent=`${histIdx+1}/${history.length} (max 200)`;
  q("#btn-undo").disabled=histIdx<=0;q("#btn-redo").disabled=histIdx>=history.length-1;
}

// ─── Storage ──────────────────────────────────────────────────────────────────
async function loadPackFromDisk(){
  const json=await window.electronAPI.loadBrushes();
  if(json&&!isFirstLaunch){
    const pack=packFromJson(json);
    if(pack){brushes=pack.brushes;packName=pack.name;}
  }
  isFirstLaunch=false;
  regeneratePreviews();updateBrushUI();
}
async function savePackToDisk(){
  const json=packToJson(packName,brushes,{linkedTilesetId:activeTilesetId});
  // Save to the active tileset's linked brush-pack file whenever a tileset is active.
  if(activeTilesetId!==null){
    await window.electronAPI.saveTilesetPackByName(tilesetPackFileName(activeTilesetId), json);
  } else {
    await window.electronAPI.saveBrushes(json);
  }
  setPackStatus(`Pack "${packName}" - ${brushes.length} brush${brushes.length!==1?"es":""} ✓`);
  const el=q("#pack-name");if(el&&el.value!==packName)el.value=packName;
}

function tilesetPackFileName(id){
  // CUSTOM_TILESET_BRUSH_PACK_LINK_V1: custom tilesets keep their own linked pack by local tileset id.
  const n=Number(id);
  const ts=BUNDLED_TILESETS.find(t=>Number(t.id)===n);
  return ts ? ts.name+".json" : "tileset_"+n+".json";
}
function tilesetBrushPackDisplayName(id){
  const n=Number(id);
  const ts=BUNDLED_TILESETS.find(t=>Number(t.id)===n);
  if(ts)return ts.name+" Brushes";
  const custom=(typeof customTilesetById==='function')?customTilesetById(n):null;
  return `${custom?(custom.name||custom.safeName||('Custom '+n)):('Custom '+n)} Brushes`;
}
async function makeStarterBrushesForCustomTileset(previousGrassBrushes=[]){
  let seed=[];
  try{
    const grassJson=await window.electronAPI.loadTilesetPackByName(tilesetPackFileName(0));
    const grassPack=grassJson?packFromJson(grassJson):null;
    if(grassPack&&Array.isArray(grassPack.brushes)&&grassPack.brushes.length){
      seed=grassPack.brushes.slice(0,2).map(cloneBrushForPack).filter(Boolean);
    }
  }catch(e){console.warn('Could not seed custom brush pack from Grass pack',e);}
  if(!seed.length&&Array.isArray(previousGrassBrushes)&&previousGrassBrushes.length){
    seed=previousGrassBrushes.slice(0,2).map(cloneBrushForPack).filter(Boolean);
  }
  if(!seed.length){
    seed=[
      {name:'Grass Brush 1',w:1,h:1,data:new Uint8Array([1])},
      {name:'Grass Brush 2',w:1,h:1,data:new Uint8Array([2])}
    ];
  }
  return seed;
}
function syncRefInputs(){
  const xs=q("#ref-x"),ys=q("#ref-y"),sc=q("#ref-scale");
  if(xs)xs.value=Math.round(refX*zoom);
  if(ys)ys.value=Math.round(refY*zoom);
  if(sc)sc.value=Math.round(refScale*100);
}
function updateRefUI(){
  const btn=q("#btn-ref-toggle"),hint=q("#ref-hint");
  if(!refImg){
    if(btn){btn.textContent="👁";btn.classList.remove("active");}
    if(hint)hint.textContent="No image. Alt+drag to move";
    return;
  }
  if(btn){btn.textContent="👁";btn.classList.toggle("active",refVisible);}
  const rw=Math.round(refImg.naturalWidth*refScale),rh=Math.round(refImg.naturalHeight*refScale);
  if(hint)hint.textContent=`${refImg.naturalWidth}×${refImg.naturalHeight}px · ${rw}×${rh} scaled`;
}

function setPackStatus(msg){const el=q("#pack-status");if(el)el.textContent=msg;}
async function saveSession(){
  try{
    const sess={tiles:btoa(String.fromCharCode(...tiles)),tilesPerRow,tilesetName,selTile,zoom,levelData:{...levelData},pngOverlayObjects:clonePngOverlayObjects(pngOverlayObjects),pngAnimationLibrary:PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME,terrainPngName,terrainPngDataUrl,terrainPngVisible};
    await window.electronAPI.saveSession(JSON.stringify(sess));
    setPackStatus("Session saved ✓");
  }catch{setPackStatus("⚠ session save failed");}
}

// ─── DOM helper ───────────────────────────────────────────────────────────────
function q(sel){return document.querySelector(sel);}

// EDITABLE_FIELD_GUARD_V1: keep text/select controls editable after modal/lock/UI patches.
// Path picker outputs keep their explicit readonly state; locked community levels can still lock level params.
const EDITABLE_FIELD_KEEP_READONLY_IDS = new Set(['baseline-rom-path','save-ips-path','save-sms-path']);
const EDITABLE_FIELD_LOCKABLE_IDS = new Set(['lf-name','lf-num_lemmings','lf-percent_needed','lf-release_rate','lf-time_minutes','lf-climbers','lf-floaters','lf-bombers','lf-blockers','lf-builders','lf-bashers','lf-miners','lf-diggers','lf-tileset_id','lf-trap_type','lf-trap_x','lf-trap_y','lf-fall_distance','lf-music']);
function isTextEditControl(el){
  if(!el || !el.tagName)return false;
  const tag=el.tagName.toUpperCase();
  if(tag==='TEXTAREA' || tag==='SELECT')return true;
  if(tag!=='INPUT')return false;
  const type=String(el.type||'text').toLowerCase();
  return !['button','checkbox','radio','range','file','submit','reset','color','hidden'].includes(type);
}
function shouldKeepControlLocked(el){
  if(!el)return true;
  if(EDITABLE_FIELD_KEEP_READONLY_IDS.has(el.id))return true;
  if(el.dataset && el.dataset.keepReadonly==='1')return true;
  if(typeof communityLockedLevelActive!=='undefined' && communityLockedLevelActive && EDITABLE_FIELD_LOCKABLE_IDS.has(el.id))return true;
  return false;
}
function ensureEditableControl(el){
  if(!isTextEditControl(el) || shouldKeepControlLocked(el))return el;
  el.readOnly=false;
  el.disabled=false;
  el.removeAttribute('readonly');
  el.removeAttribute('disabled');
  el.style.pointerEvents='auto';
  el.style.userSelect='text';
  el.style.webkitUserSelect='text';
  if(el.tabIndex<0)el.tabIndex=0;
  return el;
}
function protectEditableControl(el){
  if(!isTextEditControl(el) || shouldKeepControlLocked(el))return el;
  ensureEditableControl(el);
  if(el.dataset && !el.dataset.editableGuardV1){
    ['keydown','keypress','keyup','beforeinput','input','mousedown','mouseup','click','dblclick','selectstart','paste','copy','cut'].forEach(type=>{
      el.addEventListener(type,ev=>ev.stopPropagation(),true);
    });
    el.dataset.editableGuardV1='1';
  }
  return el;
}
function refreshEditableControls(root=document){
  try{(root||document).querySelectorAll('input,textarea,select').forEach(protectEditableControl);}catch{}
}

function withCooldown(fn, ms=500){
  let locked=false;
  return async function(...args){
    if(locked)return;
    locked=true;
    const el=this;
    if(el && el.disabled!==undefined)el.disabled=true;
    try{return await fn.apply(this,args);}
    finally{setTimeout(()=>{locked=false;if(el && el.disabled!==undefined)el.disabled=false;},ms);}
  };
}


// WEB_DIALOGS_V1: in-app dialogs so browser "don't show popups" cannot block editor actions.
function appDialogEsc(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}
function appDialog({title='Notice',message='',okText='OK',cancelText='',danger=false,input=false,inputValue='',inputPlaceholder=''}={}){
  return new Promise(resolve=>{
    const old=document.getElementById('app-dialog-overlay');
    if(old)old.remove();
    const ov=document.createElement('div');
    ov.id='app-dialog-overlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px';
    ov.innerHTML=`<div style="background:#1e1e32;border:2px solid ${danger?'#e05050':C.gold};border-radius:8px;padding:22px;min-width:320px;max-width:min(540px,92vw);box-shadow:0 8px 40px #000a;color:${C.text};font-family:${FONT}">
      <div style="font-size:14px;font-weight:900;color:${danger?'#ff9090':C.gold};margin-bottom:12px;letter-spacing:1px">${appDialogEsc(title)}</div>
      <div style="font-size:12px;color:${C.text};font-weight:700;line-height:1.55;white-space:pre-wrap;margin-bottom:${input?'10px':'18px'}">${appDialogEsc(message)}</div>
      ${input?`<input id="app-dialog-input" type="text" value="${appDialogEsc(inputValue)}" placeholder="${appDialogEsc(inputPlaceholder)}" style="width:100%;margin-bottom:18px;background:#22223a;color:${C.text};border:1px solid ${C.border};border-radius:4px;padding:8px;font-family:${FONT};font-size:12px;font-weight:700;outline:none">`:''}
      <div style="display:flex;gap:8px">${cancelText?`<button id="app-dialog-cancel" class="sbtn" style="flex:1">${appDialogEsc(cancelText)}</button>`:''}<button id="app-dialog-ok" class="sbtn ${danger?'red':'active'}" style="flex:1">${appDialogEsc(okText)}</button></div>
    </div>`;
    document.body.appendChild(ov);
    const inputEl=ov.querySelector('#app-dialog-input');
    const cleanup=value=>{document.removeEventListener('keydown',onKey,true);ov.remove();resolve(value);};
    const onKey=e=>{
      if(e.key==='Escape'&&cancelText){e.preventDefault();cleanup(input?null:false);}
      if(e.key==='Enter'){e.preventDefault();cleanup(input?(inputEl?inputEl.value:''):true);}
    };
    document.addEventListener('keydown',onKey,true);
    const ok=ov.querySelector('#app-dialog-ok'),cancel=ov.querySelector('#app-dialog-cancel');
    if(ok)ok.onclick=()=>cleanup(input?(inputEl?inputEl.value:''):true);
    if(cancel)cancel.onclick=()=>cleanup(input?null:false);
    ov.onclick=e=>{if(e.target===ov&&cancelText)cleanup(input?null:false);};
    setTimeout(()=>{(inputEl||ok)?.focus(); if(inputEl)inputEl.select();},0);
  });
}
function appConfirm(message,opts={}){return appDialog({title:opts.title||'Are you sure?',message,okText:opts.okText||'Continue',cancelText:opts.cancelText||'Cancel',danger:!!opts.danger});}
function appAlert(message,opts={}){return appDialog({title:opts.title||'Notice',message,okText:opts.okText||'OK',cancelText:'',danger:!!opts.danger});}
function appPrompt(message,defaultValue='',opts={}){return appDialog({title:opts.title||message||'Enter value',message:opts.body||'',okText:opts.okText||'OK',cancelText:opts.cancelText||'Cancel',input:true,inputValue:defaultValue||'',inputPlaceholder:opts.placeholder||''});}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async ()=>{
  // Load tileset images from the editor-local tilesets/ folder
  await loadBundledTilesetImages();

  document.getElementById("app").innerHTML=buildHTML();
  applyStyles();try{initScrollPositionMemory();}catch(err){console.warn("Scroll memory init failed",err);}try{installPanelQualityOfLifeShortcuts();}catch(err){console.warn("Panel QoL shortcuts init failed",err);}bindAll();initLevelReorderPreference();loadDefaultPackForTileset(0);await loadGlobalPngAnimationLibrary({silent:true});redrawMap();setTimeout(()=>maybePromptForPngDraftAutosave(),350);
  // No dirty-state IPC in the web version
});

async function loadBundledTilesetImages(){
  const api=window.electronAPI;
  for(const ts of BUNDLED_TILESETS){
    try{
      const dataUrl=await api.loadTilesetImage(ts.file);
      if(dataUrl) ts.dataUrl=dataUrl;
      else console.warn(`Tileset image not found: ${ts.file}`);
    }catch(e){
      console.warn(`Failed to load tileset ${ts.file}:`, e);
    }
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function applyStyles(){
  const s=document.createElement("style");
  s.textContent=`
    *{box-sizing:border-box;margin:0;padding:0;user-select:none;-webkit-user-select:none}
    input,textarea,select{user-select:text;-webkit-user-select:text;pointer-events:auto}
    body{font-family:${FONT};background:${C.bg};color:${C.text};height:100vh;overflow:hidden;font-size:12px}
    input[type=number],input[type=text]{font-family:${FONT};background:#22223a;color:${C.text};border:1px solid ${C.border};border-radius:4px;padding:5px 8px;font-size:12px;font-weight:600;outline:none;width:100%}
    input[type=number]::-webkit-inner-spin-button{opacity:.4}
    .sec{padding:10px 12px;border-bottom:1px solid ${C.border}}
    .lbl{font-size:10px;color:${C.gold};letter-spacing:2px;font-weight:800;margin-bottom:6px;display:block;text-transform:uppercase}
    .sbtn{padding:5px 10px;border-radius:4px;border:none;cursor:pointer;background:#252540;color:${C.text};font-family:${FONT};font-size:12px;font-weight:700;transition:background .1s;letter-spacing:.3px}
    .sbtn:hover{background:#303058}.sbtn:disabled{opacity:.3;cursor:default}
    .sbtn.active{background:${C.gold};color:#12121f}
    .sbtn.green{background:#5080e0;color:#fff}.sbtn.blue2{background:#5080e0;color:#fff}.sbtn.blue{background:#50a0e0;color:#12121f}.sbtn.red{background:#e05050;color:#fff}
    .tool-btn{flex:1;padding:7px 2px;text-align:center;border-radius:4px;border:none;cursor:pointer;font-family:${FONT};font-size:14px;background:#252540;color:${C.text};font-weight:700;transition:all .1s}
    .tool-btn.active{background:${C.gold};color:#12121f}
    .zoom-btn{flex:1;padding:5px 0;border-radius:4px;border:none;cursor:pointer;font-family:${FONT};font-size:12px;font-weight:700;background:#252540;color:${C.text}}
    .zoom-btn.active{background:${C.gold};color:#12121f}
    .handle-btn{flex:1;padding:4px 0;border-radius:3px;border:none;cursor:pointer;font-family:${FONT};font-size:11px;font-weight:700;background:#252540;color:${C.text}}
    .handle-btn.active{background:#404070;color:${C.gold};border:1px solid ${C.gold}}
    .brush-item{border-radius:4px;cursor:pointer;background:#1a1a2e;border:2px solid ${C.border};overflow:hidden;margin-bottom:4px}
    .brush-item.active{background:#1e2e1e;border-color:${C.gold}}
    .brush-item:hover{border-color:#4a4a70}
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;display:flex;align-items:center;justify-content:center}
    .modal-box{background:#1e1e32;border:2px solid ${C.gold};border-radius:6px;padding:24px;min-width:320px;max-width:480px;box-shadow:0 8px 40px #000a}
    .modal-title{font-size:14px;font-weight:800;color:${C.gold};margin-bottom:16px;letter-spacing:1px}
    .modal-body{font-size:12px;color:${C.dim};font-weight:600;line-height:1.6;margin-bottom:16px}
    .modal-body b{color:${C.text}}.modal-row{display:flex;gap:8px}
    ::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:#0a0a18}::-webkit-scrollbar-thumb{background:#303050;border-radius:3px}
    .rpanel-tab{transition:background .1s,color .1s}
    .rpanel-tab.active{background:#0e0e20!important;color:${C.gold}!important}
    .rpanel-tab:hover:not(.active){background:#1e1e32!important;color:${C.text}!important}
    .rpanel-page{display:none;flex-direction:column;flex:1;overflow:hidden}
    .rpanel-page.active-page{display:flex!important}
    select{font-family:${FONT};cursor:pointer}
  `;
  document.head.appendChild(s);
}

// ─── HTML ─────────────────────────────────────────────────────────────────────
function buildHTML(){return `
<div id="root" style="height:100vh;display:flex;flex-direction:column;overflow:hidden">

  <div style="background:#0e0e20;border-bottom:2px solid ${C.gold};padding:5px 14px;display:flex;align-items:center;gap:8px;flex-shrink:0">
    <div style="display:flex;flex-direction:column;line-height:1.1;flex-shrink:0;margin-right:4px">
      <span style="color:${C.gold};font-weight:900;font-size:13px;letter-spacing:2px">SMS LEMMINGS PACK EDITOR</span>
      <span id="app-version-label" style="color:#7080a0;font-size:9px;font-weight:700;letter-spacing:1px">v${APP_VERSION}</span>
    </div>
    <span id="dirty-dot" style="color:${C.danger};font-size:18px;display:none" title="Unsaved Changes">●</span>

    <div id="top-nav-left" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button id="btn-new" class="sbtn" style="color:${C.danger};border:1px solid #503535">🗋 New</button>
      <button id="btn-open-mlm" class="sbtn" style="color:#80c0ff;border:1px solid #354575">📂 Open</button>
      <button id="btn-png-level-browser" class="sbtn" style="color:#ffcf80;border:1px solid #554020" title="Browse published Custom PNG levels">📚 Levels</button>
      <button id="btn-js-playtest" class="sbtn active" style="color:#101020;border:1px solid #b09030" title="Run the current level in the JavaScript engine">▶ Playtest</button>

      <div id="map-format-toggle" style="display:flex;gap:2px;align-items:center;margin-left:4px" title="Choose the level terrain format">
        <button id="btn-map-format-mlm" class="sbtn" style="border-radius:4px 0 0 4px;font-size:11px;padding:5px 8px">MLM</button>
        <button id="btn-map-format-png" class="sbtn" style="border-left:none;border-radius:0 4px 4px 0;font-size:11px;padding:5px 8px">PNG</button>
      </div>

      <div style="display:flex;position:relative">
        <button id="btn-project-save" class="sbtn green" style="border-radius:4px 0 0 4px">💾 Export JSON</button>
        <button id="btn-save-dropdown" class="sbtn green" style="border-left:none;border-radius:0 4px 4px 0;padding:5px 8px" title="Export options">▾</button>
        <div id="save-dropdown-menu" style="display:none;position:absolute;top:100%;left:0;z-index:220;background:#1e1e32;border:2px solid #355035;border-radius:4px;min-width:170px;box-shadow:0 4px 16px #000a;margin-top:2px;padding:4px">
          <button id="btn-save-new-version" class="sbtn active" style="width:100%;text-align:left;margin-bottom:4px">💾 Export Pack JSON</button>
          <button id="btn-version-history" class="sbtn" style="width:100%;text-align:left;margin-bottom:4px;color:#e8d0ff;border:1px solid #554075">🧾 Export Metadata JSON</button>
          <button id="btn-export-mlm" class="sbtn active" style="width:100%;text-align:left">📤 Export MLM</button>
        </div>
      </div>

    </div>

    <div style="flex:1"></div>

    <div id="top-nav-right" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <button id="btn-erase-all" class="sbtn" style="color:${C.danger};border:1px solid #503535" title="Erase all tiles and traps">🗑 Erase All</button>
      <button id="btn-open-ts" class="sbtn" style="color:#80ff80;border:1px solid #355035">🖼 Tilesets</button>
      <button id="btn-sessions" class="sbtn" style="color:#ffb060;border:1px solid #554020">🗂 Sessions</button>
    </div>
  </div>

  <div style="display:flex;flex:1;overflow:hidden">

    <!-- LEFT SIDEBAR -->
    <div style="width:196px;background:${C.panel};border-right:1px solid ${C.border};display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0">

      <div id="mlm-tools-section" class="sec">
        <span class="lbl">MLM Tools</span>
        <div style="display:flex;gap:3px;margin-bottom:5px">
          <button class="tool-btn" data-tool="draw"  title="Draw [B]">B<div style="font-size:9px;opacity:.6;margin-top:2px">Draw</div></button>
          <button class="tool-btn" data-tool="erase" title="Erase [E]">E<div style="font-size:9px;opacity:.6;margin-top:2px">Erase</div></button>
          <button class="tool-btn" data-tool="fill"  title="Fill [F]">F<div style="font-size:9px;opacity:.6;margin-top:2px">Fill</div></button>
          <button class="tool-btn" data-tool="select"title="Select [S]">S<div style="font-size:9px;opacity:.6;margin-top:2px">Select</div></button>
          <button class="tool-btn" data-tool="trap"  title="Trap Placement [T]">T<div style="font-size:9px;opacity:.6;margin-top:2px">Trap</div></button>
        </div>
        <div style="font-size:10px;color:${C.dim};font-weight:600;margin-bottom:3px">Left Click: Draw, Right Click: Erase · Middle Click: Pick · D: Deselect</div>
        <div style="font-size:10px;color:${C.dim};font-weight:600;margin-bottom:3px">Ctrl+B: Brush · Ctrl+C: Copy · Ctrl+V: Paste</div>
        <div style="font-size:10px;color:${C.dim};font-weight:600;margin-bottom:3px">MP: hover map then 1=P1 Hatch, 2=P1 Goal, 3=P2 Hatch, 4=P2 Goal · Shift+number clears</div>
        <div style="font-size:10px;color:${C.dim};font-weight:600;margin-bottom:3px">In Select: Del: Erase Selected, · Middle Drag: Copy</div>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;margin-top:2px">
          <input type="checkbox" id="chk-ignore-transparent" style="width:auto;cursor:pointer">
          <span style="font-size:10px;color:${C.dim};font-weight:600">Ignore empty tiles (tile #0) when brushing.</span>
        </label>
      </div>

      <div class="sec">
        <div style="display:flex;gap:4px;margin-bottom:4px">
          <button id="btn-undo"   class="sbtn" style="flex:1">↩ Undo</button>
          <button id="btn-redo"   class="sbtn" style="flex:1">↪ Redo</button>
        </div>
        <button id="btn-revert" class="sbtn" style="width:100%;margin-bottom:4px;color:${C.danger}">⚠ Revert All <small style="opacity:.5">F12</small></button>
        <div id="hist-status" style="font-size:10px;color:${C.dim};font-weight:600">1/1 (max 200)</div>
      </div>

      <div class="sec">
        <span class="lbl">Zoom [+/-]</span>
        <div style="display:flex;gap:3px">
          ${[1,2,3,4,5].map(z=>`<button class="zoom-btn" data-z="${z}">${z}×</button>`).join("")}
        </div>
      </div>

      <div id="active-tile-section" class="sec">
        <span class="lbl">Active Tile</span>
        <div style="display:flex;align-items:center;gap:8px">
          <div id="tile-preview" style="width:28px;height:28px;border:2px solid ${C.gold};border-radius:4px;background:#1a1a30;display:flex;align-items:center;justify-content:center;font-size:10px;color:${C.gold};font-weight:800;flex-shrink:0">#1</div>
          <input id="tile-num" type="number" value="1" min="0" max="255" style="width:60px">
        </div>
        <div id="brush-active-label" style="display:none"></div>
      </div>

      <div id="brush-handle-section" class="sec">
        <span class="lbl">Brush Handle</span>
        <div style="display:flex;gap:3px;margin-bottom:3px">
          <button class="handle-btn active" data-h="TL">↖ TL</button>
          <button class="handle-btn" data-h="TR">↗ TR</button>
          <button class="handle-btn" data-h="BL">↙ BL</button>
          <button class="handle-btn" data-h="BR">↘ BR</button>
        </div>
        <div style="font-size:10px;color:${C.dim};font-weight:600">Which corner sticks to cursor</div>
      </div>

      <!-- REFERENCE IMAGE -->
      <div id="reference-image-section" class="sec" style="flex-shrink:0">
        <span class="lbl">Reference Image</span>
        <div style="display:flex;gap:3px;margin-bottom:4px">
          <button id="btn-ref-load"   class="sbtn" style="flex:1;font-size:11px">📁 Load</button>
          <button id="btn-ref-clear"  class="sbtn" style="flex:1;font-size:11px;color:#e08060">✕</button>
          <button id="btn-ref-toggle" class="sbtn" style="flex:1;font-size:11px" title="Show/hide [R]">👁</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:10px;color:${C.dim};font-weight:700;white-space:nowrap">Opacity</span>
          <input id="ref-opacity" type="range" min="0" max="100" value="40" style="flex:1;accent-color:${C.gold};cursor:pointer">
          <span id="ref-opacity-val" style="font-size:10px;color:${C.gold};font-weight:700;min-width:28px;text-align:right">40%</span>
        </div>
        <div style="display:flex;gap:3px;margin-bottom:4px">
          <button id="btn-ref-fit-w" class="sbtn" style="flex:1;font-size:10px" title="Scale to canvas width">↔ Width</button>
          <button id="btn-ref-fit-h" class="sbtn" style="flex:1;font-size:10px" title="Scale to canvas height">↕ Height</button>
          <button id="btn-ref-reset" class="sbtn" style="flex:1;font-size:10px" title="Reset position and scale">⌂ Reset</button>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
          <span style="font-size:10px;color:${C.dim};font-weight:700">Scale</span>
          <input id="ref-scale" type="number" min="1" max="1000" value="100" style="width:52px;font-size:11px" title="Scale %">
          <span style="font-size:10px;color:${C.dim};font-weight:700">%</span>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:3px;align-items:center">
          <span style="font-size:10px;color:${C.dim};font-weight:700">X</span>
          <input id="ref-x" type="number" value="0" style="flex:1;font-size:11px" title="X offset (px)">
          <span style="font-size:10px;color:${C.dim};font-weight:700">Y</span>
          <input id="ref-y" type="number" value="0" style="flex:1;font-size:11px" title="Y offset (px)">
        </div>
        <div id="ref-hint" style="font-size:10px;color:${C.dim};font-weight:600;margin-top:2px">No image: Alt+drag to move</div>
      </div>

      <!-- BRUSH PACK -->
      <div id="left-brush-pack-section" class="sec" style="flex-shrink:0;display:flex;flex-direction:column">
        <span class="lbl">Brush Pack</span>
        <div style="display:flex;gap:4px;margin-bottom:4px">
          <input id="pack-name" type="text" value="My Brush Pack" style="flex:1" title="Pack name">
          <button id="btn-rename-pack" class="sbtn" style="font-size:11px;padding:4px 7px" title="Rename pack file on disk">✎</button>
        </div>
        <div id="pack-status" style="font-size:10px;color:${C.dim};font-weight:600;margin-bottom:6px">…</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px">
          <button id="btn-add-brush"  class="sbtn blue2" style="font-size:12px" title="Add brush from selection: Ctrl+B">＋ Add Brush</button>
          <button id="btn-clear-brush"  class="sbtn" style="font-size:12px;display:none" title="Deselect active brush [D]">✕ Deselect</button>
          <button id="btn-copy-sel"   class="sbtn" style="font-size:12px" title="Copy selection Ctrl+C">⎘ Copy</button>
          <button id="btn-paste-sel"  class="sbtn" style="font-size:12px" title="Paste at cursor Ctrl+V">⎗ Paste</button>
        </div>
        <div id="brush-empty-hint-left" style="font-size:10px;color:${C.dim};line-height:1.55;font-weight:600;margin-bottom:8px">
Brushes live in the bottom strip. Click a brush to use it; Alt+Click asks before deleting it. Select a region, then Add Brush or Ctrl+B to create one.
        </div>
        <button id="btn-unload-brushes" class="sbtn" style="width:100%;margin-bottom:5px;color:#e08060;border:1px solid #503020">🗑 Unload / New Pack</button>
        <div style="display:flex;gap:4px">
          <button id="btn-export-pack" class="sbtn" style="flex:1;font-size:11px">⬇ Export</button>
          <button id="btn-import-pack" class="sbtn" style="flex:1;font-size:11px">⬆ Import</button>
        </div>
      </div>

      <!-- PNG MODE ANIMATION PACK -->
      <div id="png-mode-section" class="sec" style="flex-shrink:0;display:none;flex-direction:column">
        <span class="lbl">PNG Mode</span>
        <div style="font-size:10px;color:${C.dim};line-height:1.45;margin-bottom:7px">PNG workflow: import terrain, import/place animated objects, Ctrl-click hatches/goals/traps to set gameplay points, save the PNG Level JSON, then Publish to Custom Levels to add it to the main game automatically.</div>
        <button id="btn-import-terrain-png-left" class="sbtn active" style="width:100%;font-size:11px;margin-bottom:5px">1 · Import Terrain PNG</button>
        <button id="btn-js-playtest-png-left" class="sbtn active" style="width:100%;font-size:11px;margin-bottom:7px;color:#101020;border-color:#b09030">▶ Playtest Current PNG Level</button>
        <div style="font-size:9px;color:${C.gold};font-weight:900;letter-spacing:1px;text-transform:uppercase;margin:4px 0">Import animation by type</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:7px">
          <button class="sbtn green png-import-role" data-role="hatch" style="font-size:10px">＋ Hatch</button>
          <button class="sbtn green png-import-role" data-role="exit" style="font-size:10px">＋ Goal</button>
          <button class="sbtn green png-import-role" data-role="fire" style="font-size:10px">＋ Fire</button>
          <button class="sbtn green png-import-role" data-role="triggered_trap" style="font-size:10px">＋ Trap</button>
          <button class="sbtn green png-import-role" data-role="water" style="font-size:10px">＋ Water</button>
          <button class="sbtn green png-import-role" data-role="acid" style="font-size:10px">＋ Acid</button>
          <button class="sbtn green png-import-role" data-role="decorative" style="font-size:10px;grid-column:1/3">＋ Decorative</button>
        </div>
        <div style="font-size:9px;color:${C.gold};font-weight:900;letter-spacing:1px;text-transform:uppercase;margin:4px 0">Terrain rules</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:7px">
          <button class="sbtn png-terrain-rule" data-role="steel" style="font-size:10px">Steel</button>
          <button class="sbtn png-terrain-rule" data-role="no_collision" style="font-size:10px">No Collide</button>
        </div>
        <div style="font-size:9px;color:${C.gold};font-weight:900;letter-spacing:1px;text-transform:uppercase;margin:4px 0">Selected object layer</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:5px">
          <button id="btn-png-layer-down" class="sbtn" style="font-size:10px">⬇ Back</button>
          <button id="btn-png-layer-reset" class="sbtn" style="font-size:10px">Role Default</button>
          <button id="btn-png-layer-up" class="sbtn" style="font-size:10px">⬆ Front</button>
        </div>
        <input id="png-layer-z" type="number" value="0" title="Selected PNG object z-index. 0=back/decorative, 100+=foreground over lemmings." style="width:100%;font-size:11px;margin-bottom:5px">
        <div id="png-object-summary" style="font-size:10px;color:${C.dim};line-height:1.45;background:#10101e;border:1px solid ${C.border};border-radius:5px;padding:7px 8px;margin-bottom:7px">PNG workflow: import terrain, import/place animated objects, Ctrl-click points, then publish.</div>
        <button id="btn-png-export-level-left" class="sbtn green" style="width:100%;font-size:11px;margin-bottom:5px">💾 Save PNG Level JSON</button>
        <button id="btn-png-import-level-left" class="sbtn" style="width:100%;font-size:11px;margin-bottom:5px">📂 Load PNG Level JSON</button>
        <button id="btn-png-browse-published-left" class="sbtn" style="width:100%;font-size:11px;margin-bottom:5px;color:#ffcf80;border:1px solid #554020">📚 Browse Published PNG Levels</button>
        <button id="btn-png-save-library-left" class="sbtn" style="width:100%;font-size:11px;margin-bottom:5px;color:#a0ffb0;border:1px solid #306030">💾 Save Global Animation Library</button>
        <button id="btn-png-recover-autosave-left" class="sbtn" style="width:100%;font-size:11px;margin-bottom:5px;color:#80c0ff;border:1px solid #305070">🛟 Recover PNG Autosave</button>
        <button id="btn-png-export-ini-left" class="sbtn" style="width:100%;font-size:11px;margin-bottom:5px">📄 Export Level INI</button>
        <button id="btn-png-publish-custom-left" class="sbtn active" style="width:100%;font-size:11px;margin-bottom:5px;color:#101020;border-color:#b09030">⭐ Publish to Custom Levels</button>
        <button id="btn-export-rendered-png-left" class="sbtn" style="width:100%;font-size:11px;margin-bottom:5px">🖼 Export Terrain PNG Copy</button>
        <div id="png-autosave-status" style="font-size:9px;color:#80c0ff;font-weight:800;line-height:1.35;margin-bottom:4px">PNG draft autosave will protect imported animations.</div>
        <div id="png-active-animation-status" style="font-size:10px;color:${C.gold};font-weight:700;line-height:1.45">Selected: Classic Hatch</div>
      </div>
    </div>

    <!-- MAP AREA -->
    <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
      <div style="background:#0e0e22;border-bottom:2px solid ${C.border};padding:5px 16px;flex-shrink:0;display:flex;align-items:center;gap:16px">
        <span id="sb-tool" style="background:${C.gold};color:#12121f;padding:2px 10px;border-radius:3px;font-size:12px;font-weight:900;letter-spacing:1px;min-width:80px;text-align:center">✏ DRAW</span>
        <span id="sb-cell" style="color:${C.dim};font-size:12px;min-width:150px;font-weight:600">- · -</span>
        <span id="sb-zoom" style="color:${C.dim};font-size:12px;font-weight:600">zoom <b style="color:${C.text}">2×</b></span>
        <span style="color:${C.dim};font-size:12px;font-weight:600">tile <b id="sb-tile-val" style="color:${C.gold}">#1</b></span>
        <span id="sb-sel" style="color:${C.dim};font-size:12px;font-weight:600;display:none"></span>
        <span style="flex:1"></span>
        <span style="font-size:10px;color:#404065;font-weight:700">B/E/F/S·D · Ctrl+B · F12=revert · Ctrl+Alt+Scroll=zoom</span>
      </div>
      <div id="map-scroll" style="flex:1;overflow:auto;background:#000">
        <div style="padding:16px;display:inline-block;min-width:100%">
          <canvas id="map-canvas" style="display:block;image-rendering:pixelated;border:1px solid #1a1a1a;cursor:crosshair"></canvas>
        </div>
      </div>
      <!-- BRUSH STRIP: fixed 200px, two rows, vertical scroll -->
      <div id="brush-strip" style="height:200px;flex-shrink:0;background:${C.panel};border-top:2px solid ${C.border};display:flex;flex-direction:column;overflow:hidden">
        <div id="brush-empty-hint" style="display:flex;align-items:center;padding:0 14px;font-size:11px;color:${C.dim};font-weight:600;white-space:nowrap;flex:1">
          No brushes yet - select a region and press ＋
        </div>
        <div id="brush-list" style="display:flex;flex-direction:row;flex-wrap:wrap;gap:5px;padding:6px 8px;overflow-x:hidden;overflow-y:scroll;flex:1;align-content:flex-start"></div>
      </div>
      <div id="png-animation-strip" style="height:200px;flex-shrink:0;background:${C.panel};border-top:2px solid ${C.border};display:none;flex-direction:column;overflow:hidden">
        <div id="png-animation-tabs" style="display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid ${C.border};overflow-x:auto;flex-shrink:0"></div>
        <div id="png-animation-list" style="display:flex;flex-direction:row;gap:6px;padding:6px 8px;overflow-x:auto;overflow-y:hidden;flex:1;align-items:center"></div>
      </div>
    </div>

    <!-- RIGHT PANEL: tabbed -->
    <div style="width:224px;background:${C.panel};border-left:1px solid ${C.border};display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">
      <!-- Tab bar -->
      <div style="display:flex;border-bottom:2px solid ${C.border};flex-shrink:0">
        <button class="rpanel-tab active" data-tab="tiles"  style="flex:1;padding:6px 2px;font-size:10px;font-weight:800;border:none;background:#0e0e20;color:${C.gold};cursor:pointer;letter-spacing:1px">TILES</button>
        <button class="rpanel-tab"        data-tab="level"  style="flex:1;padding:6px 2px;font-size:10px;font-weight:800;border:none;background:#161625;color:${C.dim};cursor:pointer;letter-spacing:1px">LEVEL</button>
        <button class="rpanel-tab"        data-tab="build"  style="flex:1;padding:6px 2px;font-size:10px;font-weight:800;border:none;background:#161625;color:${C.dim};cursor:pointer;letter-spacing:1px">PACK</button>
      </div>

      <!-- Tiles tab -->
      <div id="rpanel-tiles" class="rpanel-page" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
        <div class="sec">
          <span class="lbl">Tileset Picker</span>
          <div id="ts-hint" style="font-size:11px;color:${C.dim};font-weight:600;line-height:1.5">Load a PNG via header (Ctrl+I) or pick built-in ▾</div>
        </div>
        <div style="overflow-y:auto;overflow-x:hidden;flex:1;padding:6px">
          <canvas id="tileset-canvas" style="display:block;image-rendering:pixelated;cursor:crosshair;max-width:100%"></canvas>
        </div>
      </div>

      <!-- Level data tab -->
      <div id="rpanel-level" class="rpanel-page" style="display:none;flex-direction:column;flex:1;overflow-y:auto">
        <div class="sec">
          <span class="lbl">Level Data</span>
          <div style="display:flex;gap:4px;margin-bottom:6px">
            <button id="btn-export-ini" class="sbtn active" style="flex:1;font-size:11px">📄 Export INI</button>
            <button id="btn-import-ini" class="sbtn" style="flex:1;font-size:11px">📂 Import INI</button>
          </div>
        </div>
        <div id="level-form-container" style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;font-size:11px"></div>
      </div>
      <!-- Pack tab -->
      <div id="rpanel-build" class="rpanel-page" style="display:none;flex-direction:column;flex:1;overflow-y:auto">
        <div class="sec"><span class="lbl">Pack</span></div>
        <div style="padding:10px;display:flex;flex-direction:column;gap:8px">
          <p style="font-size:10px;color:${C.dim};line-height:1.6">
            Pack Editor mode keeps the full tile editing workflow, with local JSON/MLM/INI exports and no online or ROM build steps.
          </p>
          <button id="btn-expanded-export-level" class="sbtn green" style="width:100%;font-size:11px">💾 Export Pack Level JSON</button>
          <button id="btn-expanded-export-meta" class="sbtn" style="width:100%;font-size:11px;color:#e8d0ff;border:1px solid #554075">🧾 Export Metadata JSON</button>
          <button id="btn-expanded-export-mlm" class="sbtn active" style="width:100%;font-size:11px">📤 Export MLM Compatibility</button>
          <button id="btn-expanded-export-ini" class="sbtn active" style="width:100%;font-size:11px">📄 Export INI Compatibility</button>
          <button id="btn-publish-multiplayer-level" class="sbtn active" style="width:100%;font-size:11px;color:#bfe8ff;border:1px solid #306080">⚔ Publish Multiplayer Level</button>
          <button id="btn-expanded-export-png" class="sbtn" style="width:100%;font-size:11px">🖼 Export Rendered Map PNG</button>
          <div id="build-status" style="display:none;padding:10px;border-radius:4px;font-size:11px;font-weight:700;text-align:center"></div>
        </div>
      </div>
    </div>
  </div>

  <div id="modal-brush"   class="modal-overlay" style="display:none"></div>
  <div id="modal-tileset" class="modal-overlay" style="display:none"></div>
  <div id="modal-import"  class="modal-overlay" style="display:none"></div>
  <div id="modal-generic" class="modal-overlay" style="display:none"></div>
</div>`;}

// ─── Infer tileset from file path ─────────────────────────────────────────────
// Only checks the filename and immediate parent folder: NOT the full path,
// so repo/drive names like "Sega-Master-System-Lemmings" are ignored.
function inferTilesetFromPath(filePath){
  if(!filePath)return null;
  // Normalise slashes, split, take only last 2 parts (parent folder + filename)
  const parts=filePath.replace(/\\/g,"/").split("/").filter(Boolean);
  const relevant=parts.slice(-2).join("/").toLowerCase();
  const map=[
    [7,["sega"]],
    [6,["sand2","sand_2"]],
    [4,["brick"]],
    [3,["ice"]],
    [2,["fire"]],
    [1,["sand1","sand_1","sand"]],
    [0,["grass"]],
  ];
  for(const [id,keywords] of map){
    for(const kw of keywords){
      if(relevant.includes(kw))return id;
    }
  }
  return null;
}

// ─── Bind ─────────────────────────────────────────────────────────────────────
function bindAll(){
  const api=window.electronAPI;

  // Top bar
  q("#btn-open-mlm").onclick=withCooldown(async()=>{
    if(isDirty()&&!(await appConfirm("You have unsaved changes. Open a new file anyway?")))return;
    const r=await api.openFile([{name:"MLM",extensions:["mlm"]}]);if(!r)return;
    tiles=decodeMlm(new Uint8Array(r.data).buffer);
    savedTileSnapshot=new Uint8Array(tiles);
    history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;updateHistStatus();redrawMap();updateDirty();
    // Try to find matching INI in same folder
    const iniJson=await api.findSiblingIni(r.path);
    if(iniJson){
      levelData=iniToLevelData(iniJson);
      populateLevelForm(levelData);
      const tsId=levelData.tileset??0;
      applyTilesetForLoadedLevel(tsId);
      setPackStatus("Loaded INI: "+r.path.replace(/.*[\\\/]/,"").replace(/\.mlm$/i,".ini"));
    } else {
      // No INI: infer tileset from path, else keep current
      const inferredTs=inferTilesetFromPath(r.path);
      const keepTs=inferredTs!==null ? inferredTs : (activeTilesetId??0);
      const stem=(r.path||"level_001").replace(/.*[/\\]/,"").replace(/\.mlm$/i,"");
      levelData={
        pack_name:levelData.pack_name||"Untitled Pack", level_id:stem||"level_001", name:"", mode:"singleplayer", ruleset:"sms-expanded", width_tiles:COLS, height_tiles:ROWS, players:2, ownership:'per-player', p1_label:'P1', p2_label:'P2', p1_hatch_col:-1, p1_hatch_row:-1, p1_goal_col:-1, p1_goal_row:-1, p2_hatch_col:-1, p2_hatch_row:-1, p2_goal_col:-1, p2_goal_row:-1,
        mlm_file:r.path.replace(/.*[/\\]/,""), rating:"custom", level_number:1, fall_distance:56, fall_distance_override:0,
        music:0,
        tileset:keepTs, trap_type:0, trap_x:0, trap_y:0,
        num_lemmings:20, percent_needed:50, release_rate:50, time_minutes:5,
        climbers:0, floaters:0, bombers:0, blockers:0,
        builders:0, bashers:0, miners:0, diggers:0
      };
      populateLevelForm(levelData);
      trapPos=null;
      applyTilesetForLoadedLevel(keepTs);
      redrawMap();
    }
  },500);
  q("#btn-open-ts").onclick=withCooldown(()=>showTilesetBrowserModal(),500);
  const browseBtn=q("#btn-browse-levels")||q("#btn-project-levels");
  if(browseBtn) browseBtn.onclick=withCooldown(()=>showSessionModal(),500);
  const shareCurrentBtn=q("#btn-share-current-level");
  if(shareCurrentBtn) shareCurrentBtn.onclick=withCooldown(()=>showShareCurrentLevelModal(),500);
  const shareBtn=q("#btn-share-levels");
  if(shareBtn) shareBtn.onclick=withCooldown(()=>showShareLevelsModal(),500);
  const communityBtn=q("#btn-community-levels");
  if(communityBtn) communityBtn.onclick=withCooldown(()=>showCommunityLevelsModal(),500);
  const communityMenuBtn=q("#btn-community-menu");
  const communityDropBtn=q("#btn-community-dropdown");
  const communityMenu=q("#community-dropdown-menu");
  const toggleCommunityMenu=(e)=>{
    if(e){e.preventDefault();e.stopPropagation();}
    if(!communityMenu)return;
    const open=communityMenu.style.display!=="block";
    communityMenu.style.display=open?"block":"none";
    const saveMenu=q("#save-dropdown-menu"); if(saveMenu)saveMenu.style.display="none";
  };
  if(communityMenuBtn)communityMenuBtn.onclick=toggleCommunityMenu;
  if(communityDropBtn)communityDropBtn.onclick=toggleCommunityMenu;
  const saveDropBtn=q("#btn-save-dropdown");
  const saveMenu=q("#save-dropdown-menu");
  if(saveDropBtn&&saveMenu){
    saveDropBtn.onclick=(e)=>{
      e.preventDefault();e.stopPropagation();
      const open=saveMenu.style.display!=="block";
      saveMenu.style.display=open?"block":"none";
      if(communityMenu)communityMenu.style.display="none";
    };
  }
  const playtestBtn=q("#btn-js-playtest");
  if(playtestBtn) playtestBtn.onclick=withCooldown(()=>showJsEnginePlaytestModal(),500);

  const topSaveBtn=q("#btn-project-save");
  if(topSaveBtn) topSaveBtn.onclick=withCooldown(()=>{ const b=q("#btn-expanded-export-level"); if(b) b.click(); },500);
  const projectsBtn=q("#btn-sessions");
  if(projectsBtn) projectsBtn.onclick=withCooldown(()=>showSessionModal(),500);
  const publishedPngLevelsBtn=q("#btn-png-level-browser");
  if(publishedPngLevelsBtn) publishedPngLevelsBtn.onclick=withCooldown(()=>showPublishedPngLevelBrowserModal(),500);
  const saveNewVersionBtn=q('#btn-save-new-version');
  if(saveNewVersionBtn) saveNewVersionBtn.onclick=withCooldown(()=>{const saveMenu=q('#save-dropdown-menu');if(saveMenu)saveMenu.style.display='none';const b=q('#btn-expanded-export-level');if(b)b.click();},500);
  const versionHistoryBtn=q('#btn-version-history');
  if(versionHistoryBtn) versionHistoryBtn.onclick=withCooldown(()=>{const saveMenu=q('#save-dropdown-menu');if(saveMenu)saveMenu.style.display='none';const b=q('#btn-expanded-export-meta');if(b)b.click();},500);
  q("#btn-export-mlm").onclick=withCooldown(async()=>{
    syncLevelData();
    const safeName=(levelData.mlm_file||levelData.name||"level").replace(/[^a-zA-Z0-9_\-.]/g,"_").replace(/\.mlm$/i,"")||"level";
    const ok=await api.saveFile({defaultName:safeName+".mlm",filters:[{name:"MLM",extensions:["mlm"]}],data:encodeMlm(tiles)});
    if(ok){
      savedTileSnapshot=new Uint8Array(tiles);markPngLevelSaved();updateDirty();
      // Auto-populate MLM Filename field from saved name
      if(!levelData.mlm_file){
        levelData.mlm_file=safeName+".mlm";
        const el=q("#lf-mlm_file");if(el)el.value=levelData.mlm_file;
      }
    }
  },500);
  q("#btn-new").onclick=withCooldown(async()=>{
    if(isDirty()&&!(await appConfirm("You have unsaved changes. Start a new map anyway?")))return;
    tiles=blankMap();savedTileSnapshot=new Uint8Array(TOTAL);
    history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;updateHistStatus();
    const keepTs=activeTilesetId??0;
    levelData={pack_name:levelData.pack_name||"Untitled Pack",level_id:"level_001",name:"",mode:"singleplayer",ruleset:"sms-expanded",width_tiles:COLS,height_tiles:ROWS,players:2,ownership:'per-player',p1_label:'P1',p2_label:'P2',p1_hatch_col:-1,p1_hatch_row:-1,p1_goal_col:-1,p1_goal_row:-1,p2_hatch_col:-1,p2_hatch_row:-1,p2_goal_col:-1,p2_goal_row:-1,mlm_file:"",rating:"custom",level_number:1,fall_distance:56, fall_distance_override:0,
      music:0,
      tileset:keepTs,trap_type:0,trap_x:0,trap_y:0,num_lemmings:20,percent_needed:50,
      release_rate:50,time_minutes:5,climbers:0,floaters:0,bombers:0,blockers:0,
      builders:0,bashers:0,miners:0,diggers:0};
    populateLevelForm(levelData);trapPos=null;pngOverlayObjects=[];selectedPngObjectId=null;terrainPngImg=null;terrainPngName='';terrainPngDataUrl='';markPngLevelSaved();
    redrawMap();updateDirty();
  },500);

  // Tools
  document.querySelectorAll(".tool-btn").forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  setTool("draw");
  const mlmFormatBtn=q('#btn-map-format-mlm');
  const pngFormatBtn=q('#btn-map-format-png');
  if(mlmFormatBtn)mlmFormatBtn.onclick=()=>setMapFormat('mlm',{fromUser:true});
  if(pngFormatBtn)pngFormatBtn.onclick=()=>setMapFormat('png',{fromUser:true});
  q("#btn-undo").onclick=()=>{if(canUseHistoryEditShortcut("undo changes on a locked community level"))undo();};q("#btn-redo").onclick=()=>{if(canUseHistoryEditShortcut("redo changes on a locked community level"))redo();};
  q("#btn-revert").onclick=()=>{if(canUseHistoryEditShortcut("revert a locked community level"))revertAll();};
  document.querySelectorAll(".zoom-btn").forEach(b=>b.onclick=()=>setZoom(+b.dataset.z));
  setZoom(2);

  // Brush handle
  document.querySelectorAll(".handle-btn").forEach(b=>b.onclick=()=>{
    brushHandle=b.dataset.h;
    document.querySelectorAll(".handle-btn").forEach(x=>x.classList.toggle("active",x.dataset.h===brushHandle));
  });

  q("#tile-num").oninput=e=>{selTile=Math.max(0,Math.min(255,+e.target.value||0));activeBrush=null;updateTilePreview();updateStatusBar();};
  // tilesPerRow is always 16 for MLM format

  // Pack name
  q("#pack-name").oninput=e=>{packName=e.target.value;savePackToDisk();};
  q("#btn-rename-pack").onclick=()=>showRenamePackModal();

  q("#btn-clear-brush").onclick=deselectBrush;
  q("#btn-add-brush").onclick=()=>createBrushFromSelection();
  const delBtn=q("#btn-del-brush"); if(delBtn)delBtn.onclick=()=>deleteActiveBrush({confirm:true});
  q("#btn-copy-sel").onclick=copySelection;
  q("#btn-paste-sel").onclick=enterPasteMode;
  const chkIT = q("#chk-ignore-transparent");
  chkIT.onchange=e=>{ignoreTransparency=e.target.checked; e.target.blur();};
  chkIT.addEventListener("mousedown",e=>{ e.preventDefault(); chkIT.checked=!chkIT.checked; ignoreTransparency=chkIT.checked; chkIT.dispatchEvent(new Event("change")); });
  q("#btn-unload-brushes").onclick=async()=>{
    if(brushes.length&&!(await appConfirm("Create a fresh empty pack? Current brushes will be unloaded.",{title:"Create fresh pack?",okText:"Create Fresh Pack",danger:true})))return;
    brushes=[];brushPreviews=[];activeBrush=null;packName="New Pack";
    q("#pack-name").value=packName;
    savePackToDisk();updateBrushUI();updateTilePreview();
  };
  q("#btn-export-pack").onclick=async()=>{
    const safe=packName.replace(/\s+/g,"-").replace(/[^a-zA-Z0-9\-_]/g,"")||"brushes";
    await api.saveFile({defaultName:`${safe}.json`,filters:[{name:"JSON",extensions:["json"]}],data:Array.from(new TextEncoder().encode(packToJson(packName,brushes)))});
  };
  q("#btn-import-pack").onclick=async()=>{
    const r=await api.openFile([{name:"JSON",extensions:["json"]}]);if(!r)return;
    const pack=packFromJson(new TextDecoder().decode(new Uint8Array(r.data)));if(!pack)return;
    showImportModal(pack);
  };

  // Map canvas
  const mc=q("#map-canvas");
  mc.addEventListener("mousedown",e=>{if(document.activeElement&&document.activeElement!==document.body)document.activeElement.blur();onMapDown(e);});
  mc.addEventListener("mousemove",onMapMove);
  mc.addEventListener("mouseup",onMapUp);
  mc.addEventListener("mouseleave",()=>{hoverCell=null;updateStatusBar();onMapUp();redrawMap();});
  mc.addEventListener("contextmenu",e=>e.preventDefault());
  // middle-click handled in onMapDown - auxclick not used

  // Scroll: Ctrl+Alt=zoom, else horizontal pan
  q("#map-scroll").addEventListener("wheel",e=>{
    if(e.ctrlKey&&e.altKey){e.preventDefault();setZoom(e.deltaY<0?Math.min(zoom+1,5):Math.max(zoom-1,1));return;}
    if(e.shiftKey)return;e.preventDefault();q("#map-scroll").scrollLeft+=e.deltaY;
  },{passive:false});

  q("#tileset-canvas").onclick=onTilesetClick;
  document.addEventListener("keydown",onKey);

  // ── Tileset dropdown ───────────────────────────────────────────────────
  const ddMenu=q("#ts-dropdown-menu");
  const ddBtn=q("#btn-ts-dropdown");
  // Legacy tileset dropdown support: current UI opens the unified Tilesets panel instead.
  refreshTilesetDropdownMenu();
  if(ddBtn&&ddMenu){
    ddBtn.onclick=(e)=>{
      e.stopPropagation();
      ddMenu.style.display=ddMenu.style.display==="none"?"block":"none";
    };
  }
  wireCustomTilesetsButton();
  document.addEventListener("click",()=>{
    if(ddMenu)ddMenu.style.display="none";
    const saveMenu=q("#save-dropdown-menu"); if(saveMenu)saveMenu.style.display="none";
    const communityMenu=q("#community-dropdown-menu"); if(communityMenu)communityMenu.style.display="none";
  });

  // ── Right panel tabs ───────────────────────────────────────────────────
  document.querySelectorAll(".rpanel-tab").forEach(tab=>{
    tab.onclick=withCooldown(()=>{
      document.querySelectorAll(".rpanel-tab").forEach(t=>{
        t.classList.toggle("active",t===tab);
        t.style.background=t===tab?"#0e0e20":"#161625";
        t.style.color=t===tab?C.gold:C.dim;
      });
      const page=tab.dataset.tab;
      document.querySelectorAll(".rpanel-page").forEach(p=>p.style.display="none");
      const el=q(`#rpanel-${page}`);if(el)el.style.display="flex";
    },500);
  });
  // Show tiles page by default
  q("#rpanel-tiles").style.display="flex";

  // ── Level form ─────────────────────────────────────────────────────────
  buildLevelFormDOM(); // build form fields imperatively
  refreshCustomTilesetsCache().then(()=>{refreshTilesetSelectOptions();refreshTilesetDropdownMenu();}).catch(()=>{refreshTilesetDropdownMenu();});
  populateLevelForm(levelData); // fill with defaults
  refreshRulesetFormVisibility();
  const rulesetSelEl=q('#lf-ruleset');
  if(rulesetSelEl){
    rulesetSelEl.addEventListener('change',()=>applyRulesetProfile({fromUser:true}));
  }
  const mapFormatSelEl=q('#lf-map_format');
  if(mapFormatSelEl){
    mapFormatSelEl.addEventListener('change',()=>setMapFormat(mapFormatSelEl.value,{fromUser:true}));
  }
  // When the tileset selector changes in the Level tab, switch the displayed tileset
  const tsSelEl = q('#lf-tileset_id');
  if (tsSelEl) {
    tsSelEl.addEventListener('change', () => {
      const id = parseInt(tsSelEl.value) || 0;
      const ts = BUNDLED_TILESETS.find(t => t.id === id);
      // Let the selection helpers change activeTilesetId so custom packs can seed from the previously active pack.
      if (ts && ts.dataUrl) {
        selectBundledTileset(ts);
      } else {
        selectCustomTileset(id);
      }
    });
  }
  const lfIds=["pack_name","level_id","name","mode","ruleset","width_tiles","height_tiles","map_format","terrain_png","background_color","png_level_json","overlay_json","animation_pack_json","players","ownership","p1_label","p2_label","rating","level_number","num_lemmings","percent_needed",
    "release_rate","time_minutes","climbers","floaters","bombers","blockers",
    "builders","bashers","miners","diggers","tileset_id","trap_type","trap_x","trap_y","fall_distance","music"];
  updateProjectSaveButtons();
  const applySizeBtn=q('#btn-apply-map-size');
  if(applySizeBtn)applySizeBtn.onclick=withCooldown(()=>applyMapSizeFromFields(),500);
  const importTerrainBtn=q('#btn-import-terrain-png');
  if(importTerrainBtn)importTerrainBtn.onclick=withCooldown(()=>importTerrainPngFile(),500);
  const exportOverlayBtn=q('#btn-export-overlay-json');
  if(exportOverlayBtn)exportOverlayBtn.onclick=withCooldown(()=>exportPngOverlayJson(),500);
  const exportAnimPackBtn=q('#btn-export-animation-pack-json');
  if(exportAnimPackBtn)exportAnimPackBtn.onclick=withCooldown(()=>exportAnimationPackJson(),500);
  const importTerrainLeft=q('#btn-import-terrain-png-left');
  if(importTerrainLeft)importTerrainLeft.onclick=withCooldown(()=>importTerrainPngFile(),500);
  const playtestPngLeft=q('#btn-js-playtest-png-left');
  if(playtestPngLeft)playtestPngLeft.onclick=withCooldown(()=>showJsEnginePlaytestModal(),500);
  document.querySelectorAll('.png-import-role').forEach(btn=>{btn.onclick=withCooldown(()=>showPngAnimationImportModal({role:btn.dataset.role}),500);});
  document.querySelectorAll('.png-terrain-rule').forEach(btn=>{btn.onclick=()=>setPngPlacementMode(btn.dataset.role);});
  const layerDown=q('#btn-png-layer-down'),layerUp=q('#btn-png-layer-up'),layerReset=q('#btn-png-layer-reset'),layerInput=q('#png-layer-z');
  if(layerDown)layerDown.onclick=()=>adjustSelectedPngObjectZIndex(-10);
  if(layerUp)layerUp.onclick=()=>adjustSelectedPngObjectZIndex(10);
  if(layerReset)layerReset.onclick=()=>resetSelectedPngObjectZIndex();
  if(layerInput)layerInput.onchange=()=>setSelectedPngObjectZIndex(layerInput.value);
  const exportPngLevelLeft=q('#btn-png-export-level-left');
  if(exportPngLevelLeft)exportPngLevelLeft.onclick=withCooldown(()=>exportPngLevelAnimationJson(),500);
  const importPngLevelLeft=q('#btn-png-import-level-left');
  if(importPngLevelLeft)importPngLevelLeft.onclick=withCooldown(()=>importPngLevelAnimationJson(),500);
  const browsePngPublishedLeft=q('#btn-png-browse-published-left');
  if(browsePngPublishedLeft)browsePngPublishedLeft.onclick=withCooldown(()=>showPublishedPngLevelBrowserModal(),500);
  const savePngLibraryLeft=q('#btn-png-save-library-left');
  if(savePngLibraryLeft)savePngLibraryLeft.onclick=withCooldown(()=>saveGlobalPngAnimationLibrary({silent:false}),500);
  const recoverPngAutosaveLeft=q('#btn-png-recover-autosave-left');
  if(recoverPngAutosaveLeft)recoverPngAutosaveLeft.onclick=withCooldown(()=>restorePngDraftAutosave(),500);
  const exportPngIniLeft=q('#btn-png-export-ini-left');
  if(exportPngIniLeft)exportPngIniLeft.onclick=withCooldown(()=>{const b=q('#btn-expanded-export-ini');if(b)b.click();},500);
  const publishPngCustomLeft=q('#btn-png-publish-custom-left');
  if(publishPngCustomLeft)publishPngCustomLeft.onclick=withCooldown(()=>publishCurrentPngLevelToCustomLevels(),500);
  const exportMapPngLeft=q('#btn-export-rendered-png-left');
  if(exportMapPngLeft)exportMapPngLeft.onclick=withCooldown(()=>exportRenderedMapPng(),500);
  syncPngObjectSummary();
  refreshPngModeUi();
  // form field listeners added in buildLevelFormDOM

  q("#btn-export-ini").onclick=exportIni;
  q("#btn-import-ini").onclick=importIni;

  // ── Expanded Pack panel ────────────────────────────────────────────────
  {
    const api=window.electronAPI;

    function buildStatus(msg, type){
      const el=q("#build-status"); if(!el)return;
      if(type==='hidden'){el.style.display="none";return;}
      el.style.display="block";
      const styles={
        ok:  "background:#0a2018;border:1px solid #40c060;color:#40c060",
        err: "background:#200a0a;border:1px solid #c04040;color:#c04040",
        busy:"background:#0e0e1c;border:1px solid #606080;color:#a0a0c0",
      };
      el.style.cssText=`display:block;padding:10px;border-radius:4px;font-size:11px;font-weight:700;text-align:center;${styles[type]||styles.busy}`;
      el.textContent=msg;
    }

    function safeLevelFileStem(){
      syncLevelData();
      return String(levelData.level_id||levelData.name||'expanded_level').replace(/[^a-zA-Z0-9_\-.]/g,'_')||'expanded_level';
    }

    function expandedLevelPayload(){
      syncLevelData();
      syncLevelConfigFromLevelData();
      applyMapSizeFromFields();
      return {
        format:'sms-lemmings-pack-editor-level',
        version:1,
        meta:{...levelData,width_tiles:COLS,height_tiles:ROWS},
        png_level:isPngMapMode()?pngLevelAnimationJsonPayload():null,
        map:{
          tile_width:TW,
          tile_height:TH,
          width_tiles:COLS,
          height_tiles:ROWS,
          encoding:'raw-u8-base64',
          data:bytesToBase64Chunked(tiles)
        }
      };
    }

    async function saveTextFile(defaultName,text,extensionName='JSON',extension='json'){
      const data=Array.from(new TextEncoder().encode(text));
      return api.saveFile({defaultName,filters:[{name:extensionName,extensions:[extension]}],data});
    }

    const exportLevelBtn=q('#btn-expanded-export-level');
    if(exportLevelBtn) exportLevelBtn.onclick=withCooldown(async()=>{
      try{
        const payload=expandedLevelPayload();
        await saveTextFile(safeLevelFileStem()+'.json',JSON.stringify(payload,null,2));
        savedTileSnapshot=new Uint8Array(tiles);markPngLevelSaved();updateDirty();
        buildStatus('Pack level JSON exported ✓','ok');
      }catch(e){buildStatus(e.message||'Pack level export failed.','err');}
    },500);

    const exportMetaBtn=q('#btn-expanded-export-meta');
    if(exportMetaBtn) exportMetaBtn.onclick=withCooldown(async()=>{
      try{
        syncLevelData();
        await saveTextFile(safeLevelFileStem()+'.meta.json',JSON.stringify({format:'sms-lemmings-pack-editor-meta',version:1,meta:{...levelData}},null,2));
        buildStatus('Metadata JSON exported ✓','ok');
      }catch(e){buildStatus(e.message||'Metadata export failed.','err');}
    },500);

    const exportMlmBtn=q('#btn-expanded-export-mlm');
    if(exportMlmBtn) exportMlmBtn.onclick=withCooldown(async()=>{
      try{
        syncLevelData();
        const safeName=(levelData.mlm_file||levelData.level_id||levelData.name||'level').replace(/[^a-zA-Z0-9_\-.]/g,'_').replace(/\.mlm$/i,'')||'level';
        applyMapSizeFromFields();
        await api.saveFile({defaultName:safeName+'.mlm',filters:[{name:'MLM',extensions:['mlm']}],data:encodeMlm(tiles)});
        buildStatus('MLM compatibility file exported ✓','ok');
      }catch(e){buildStatus(e.message||'MLM export failed.','err');}
    },500);

    const exportIniBtn=q('#btn-expanded-export-ini');
    if(exportIniBtn) exportIniBtn.onclick=withCooldown(async()=>{
      try{
        syncLevelData();
        await saveTextFile(safeLevelFileStem()+'.mlm.ini',levelDataToIni(levelData),'INI','ini');
        buildStatus('INI compatibility file exported ✓','ok');
      }catch(e){buildStatus(e.message||'INI export failed.','err');}
    },500);

    const publishMpBtn=q('#btn-publish-multiplayer-level');
    if(publishMpBtn) publishMpBtn.onclick=withCooldown(async()=>{
      try{ await publishCurrentLevelToMultiplayerLevels(); }
      catch(e){buildStatus(e.message||'Multiplayer publish failed.','err');}
    },500);

    const exportPngBtn=q('#btn-expanded-export-png');
    if(exportPngBtn) exportPngBtn.onclick=withCooldown(async()=>{
      try{ await exportRenderedMapPng(); buildStatus('Rendered PNG exported ✓','ok'); }
      catch(e){ buildStatus(e.message||'PNG export failed.','err'); }
    },500);
  }


  // Erase All
  const eraseAllBtn=q("#btn-erase-all");
  if(eraseAllBtn) eraseAllBtn.onclick=async()=>{
    if(communityBlockLockedLevelAction('erase all tiles or clear the trap'))return;
    if(!(await appConfirm("Erase all tiles and clear the trap? This cannot be undone.",{title:"Erase all?",okText:"Erase All",danger:true})))return;
    tiles=new Uint8Array(TOTAL);
    trapPos=null;levelData.trap_x=0;levelData.trap_y=0;
    const xEl=q("#lf-trap_x"),yEl=q("#lf-trap_y");
    if(xEl)xEl.value=0;if(yEl)yEl.value=0;
    pushHistory(tiles);redrawMap();updateDirty();
    setPackStatus("All tiles and traps erased.");
  };

  // ── Drag-and-drop MLM onto map ─────────────────────────────────────────
  const mapScroll=q("#map-scroll");
  mapScroll.addEventListener("dragover",e=>{
    const f=e.dataTransfer.items[0];
    if(f&&f.type.startsWith("image/"))return; // let ref image handler take it
    e.preventDefault();e.dataTransfer.dropEffect="copy";mapScroll.style.outline=`2px dashed ${C.gold}`;
  });
  mapScroll.addEventListener("dragleave",()=>mapScroll.style.outline="none");
  mapScroll.addEventListener("drop",async e=>{
    e.preventDefault();mapScroll.style.outline="none";
    const file=e.dataTransfer.files[0];
    if(!file)return;
    // Image files are handled by the reference image drop handler
    if(file.type.startsWith("image/"))return;
    if(isDirty()&&!(await appConfirm("You have unsaved changes. Load dropped file anyway?")))return;
    const buf=await file.arrayBuffer();
    tiles=decodeMlm(buf);
    savedTileSnapshot=new Uint8Array(tiles);
    history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;updateHistStatus();redrawMap();updateDirty();
    levelData.mlm_file=file.name;
    // Try to read sibling INI via drop path (webkitRelativePath or name)
    const dropIniJson=await api.findSiblingIni(file.path||file.name);
    if(dropIniJson){
      levelData=iniToLevelData(dropIniJson);populateLevelForm(levelData);
      if(levelData.trap_x||levelData.trap_y){
        trapPos={col:Math.round((levelData.trap_x-4)/8),row:Math.round((levelData.trap_y-8)/8)};
      } else { trapPos=null; }
      const dropTsId=levelData.tileset??0;
      applyTilesetForLoadedLevel(dropTsId);
    } else {
      const inferredTsDrop=inferTilesetFromPath(file.path||file.name);
      const keepTsDrop=inferredTsDrop!==null?inferredTsDrop:(activeTilesetId??0);
      levelData={...levelData,level_id:(file.name||"level_001").replace(/\.mlm$/i,""),name:"",mlm_file:file.name,rating:"custom",level_number:1,fall_distance:56, fall_distance_override:0,
        music:0,
        tileset:keepTsDrop,trap_type:0,trap_x:0,trap_y:0,num_lemmings:50,percent_needed:50,release_rate:5,
        time_minutes:5,climbers:0,floaters:0,bombers:0,blockers:0,builders:0,bashers:0,miners:0,diggers:0};
      populateLevelForm(levelData);trapPos=null;
      if(inferredTsDrop!==null){
        const inferTsDrop=BUNDLED_TILESETS.find(t=>t.id===inferredTsDrop);
        if(inferTsDrop&&inferTsDrop.dataUrl)loadTilesetFromDataUrl(inferTsDrop.dataUrl,inferTsDrop.name+".png",true);
      }
      loadDefaultPackForTileset(keepTsDrop);
    }
    setPackStatus("Loaded: "+file.name+(dropIniJson?" + INI":""));
  });

  // ── Reference image ───────────────────────────────────────────────────
  function loadRefImage(dataUrl){
    const img=new Image();
    img.onload=()=>{
      refImg=img;refVisible=true;
      // Default: 100% (natural size, zoom-independent)
      refScale=1.0;
      refX=0;refY=0;
      syncRefInputs();updateRefUI();redrawMap();
    };
    img.src=dataUrl;
  }
  q("#btn-ref-load").onclick=async()=>{const r=await api.openImage();if(r)loadRefImage(r.dataUrl);};
  q("#btn-ref-clear").onclick=()=>{refImg=null;updateRefUI();redrawMap();};
  q("#btn-ref-toggle").onclick=()=>{refVisible=!refVisible;updateRefUI();redrawMap();};
  q("#ref-opacity").oninput=e=>{refOpacity=+e.target.value/100;q("#ref-opacity-val").textContent=e.target.value+"%";redrawMap();};

  q("#btn-ref-fit-w").onclick=()=>{
    if(!refImg)return;
    refScale=(COLS*TW)/refImg.naturalWidth;
    refX=0;syncRefInputs();redrawMap();
  };
  q("#btn-ref-fit-h").onclick=()=>{
    if(!refImg)return;
    refScale=(ROWS*TH)/refImg.naturalHeight;
    refY=0;syncRefInputs();redrawMap();
  };
  q("#btn-ref-reset").onclick=()=>{
    if(!refImg)return;
    refScale=(COLS*TW)/refImg.naturalWidth;
    refX=0;refY=0;syncRefInputs();redrawMap();
  };
  q("#ref-scale").onchange=e=>{
    refScale=Math.max(0.01,+e.target.value/100);
    syncRefInputs();redrawMap();
  };
  q("#ref-x").onchange=e=>{refX=Math.round(+e.target.value/zoom);redrawMap();};
  q("#ref-y").onchange=e=>{refY=Math.round(+e.target.value/zoom);redrawMap();};

  // Alt+drag on canvas to reposition reference image
  const mc2=q("#map-canvas");
  mc2.addEventListener("mousedown",e=>{
    if(!e.altKey||!refImg)return;
    e.preventDefault();e.stopPropagation();
    refDragging=true;
    refDragStartX=e.clientX;refDragStartY=e.clientY;
    refDragOriginX=refX;refDragOriginY=refY;
    mc2.style.cursor="move";
  },{capture:true});
  window.addEventListener("mousemove",e=>{
    if(!refDragging)return;
    // Mouse delta is in screen pixels; divide by zoom to get base pixels
    refX=refDragOriginX+Math.round((e.clientX-refDragStartX)/zoom);
    refY=refDragOriginY+Math.round((e.clientY-refDragStartY)/zoom);
    syncRefInputs();redrawMap();
  });
  window.addEventListener("mouseup",e=>{
    if(!refDragging)return;
    refDragging=false;
    q("#map-canvas").style.cursor="crosshair";
  });
  // Allow drag-dropping an image directly onto the map canvas as reference
  const mapScroll2=q("#map-scroll");
  mapScroll2.addEventListener("dragover",e=>{
    const f=e.dataTransfer.items[0];
    if(f&&f.type.startsWith("image/")){
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect="copy";
      mapScroll2.style.outline=`2px dashed #80c0ff`;
    }
  });
  mapScroll2.addEventListener("dragleave",()=>mapScroll2.style.outline="none");
  mapScroll2.addEventListener("drop",e=>{
    const file=e.dataTransfer.files[0];
    if(!file||!file.type.startsWith("image/"))return;
    e.preventDefault();e.stopPropagation();
    mapScroll2.style.outline="none";
    const reader=new FileReader();
    reader.onload=ev=>loadRefImage(ev.target.result);
    reader.readAsDataURL(file);
  });
}

// ─── Dirty indicator ──────────────────────────────────────────────────────────
function updateDirty(){
  const el=q("#dirty-dot");if(el)el.style.display=isDirty()?"inline":"none";
  if(isPngMapMode())schedulePngDraftAutosave();
}

// ─── Tool / zoom ──────────────────────────────────────────────────────────────
function setTool(t){
  tool=t;
  document.querySelectorAll(".tool-btn").forEach(b=>b.classList.toggle("active",b.dataset.tool===t));
  updateStatusBar();
}
function setZoom(z){
  zoom=z;
  document.querySelectorAll(".zoom-btn").forEach(b=>b.classList.toggle("active",+b.dataset.z===z));
  resizeMapCanvas();redrawMap();redrawTileset();regeneratePreviews();updateBrushUI();updateStatusBar();
}
function resizeMapCanvas(){const mc=q("#map-canvas");mc.width=COLS*TW*zoom;mc.height=ROWS*TH*zoom;}
function deselectBrush(){activeBrush=null;updateBrushUI();updateTilePreview();updateStatusBar();}

function updateStatusBar(){
  const labels={draw:"✏ DRAW",erase:"⌫ ERASE",fill:"🪣 FILL",select:"⬚ SELECT",trap:"🪤 TRAP"};
  q("#sb-tool").textContent=pasteMode?"📋 PASTE":labels[tool]||tool;
  q("#sb-zoom").innerHTML=`zoom <b style="color:${C.text}">${zoom}×</b>`;
  q("#sb-tile-val").textContent=activeBrush!==null&&brushes[activeBrush]?`[B]`:`#${selTile}`;
  if(hoverCell){
    const tid=tiles[hoverCell.row*COLS+hoverCell.col];
    const mpHint=isMultiplayerProfile()?" · MP 1=P1H 2=P1G 3=P2H 4=P2G":"";
    if(isPngMapMode()){
      const anim=activePngAnimation();
      q("#sb-cell").innerHTML=`col <b style="color:${C.gold}">${hoverCell.col}</b> · row <b style="color:${C.gold}">${hoverCell.row}</b> · PNG object <b style="color:${C.dim}">${esc(anim?.name||anim?.id||'-')}</b>`;
    }else{
      q("#sb-cell").innerHTML=`col <b style="color:${C.gold}">${hoverCell.col}</b> · row <b style="color:${C.gold}">${hoverCell.row}</b> · tile <b style="color:${C.dim}">#${tid}</b>${mpHint}`;
    }
  }else q("#sb-cell").textContent="- · -";
  // Selection size indicator
  const sb=q("#sb-sel");
  if(selStart&&selEnd&&tool==="select"){
    const w=Math.abs(selEnd.col-selStart.col)+1,h=Math.abs(selEnd.row-selStart.row)+1;
    sb.style.display="inline";sb.textContent=`sel ${w}×${h}`;
  }else{sb.style.display="none";}
  updateDirty();
}

function drawMultiplayerMarkers(ctx){
  for(const [prefix,marker] of Object.entries(MP_MARKERS)){
    const cell=markerCell(prefix);
    if(!cell)continue;
    if(cell.col<0||cell.col>=COLS||cell.row<0||cell.row>=ROWS)continue;
    const x=cell.col*TW*zoom;
    const y=cell.row*TH*zoom;
    const w=TW*zoom;
    const h=TH*zoom;
    ctx.save();
    ctx.fillStyle=marker.colour;
    ctx.globalAlpha=0.32;
    ctx.fillRect(x,y,w,h);
    ctx.globalAlpha=1;
    ctx.strokeStyle=marker.colour;
    ctx.lineWidth=3;
    ctx.strokeRect(x,y,w,h);
    ctx.fillStyle=marker.colour;
    ctx.font=`bold ${Math.max(8,Math.floor(w*0.38))}px monospace`;
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(marker.label,x+w/2,y+h/2);
    ctx.restore();
  }
}

// ─── Drawing ──────────────────────────────────────────────────────────────────
function drawTile(ctx,tid,dx,dy,dw,dh){
  if(tid===0){ctx.fillStyle="#000";ctx.fillRect(dx,dy,dw,dh);}
  else if(tilesetImg)ctx.drawImage(tilesetImg,(tid%tilesPerRow)*TW,Math.floor(tid/tilesPerRow)*TH,TW,TH,dx,dy,dw,dh);
  else{ctx.fillStyle=`hsl(${(tid*37)%360},55%,35%)`;ctx.fillRect(dx,dy,dw,dh);if(dw>=10){ctx.fillStyle="#fff";ctx.font=`${Math.min(dw-2,9)}px monospace`;ctx.fillText(String(tid),dx+1,dy+dh-2);}}
}

// Compute top-left draw offset for brush based on handle setting
function brushOrigin(col,row,b){
  let dc=col,dr=row;
  if(brushHandle==="TR")dc=col-b.w+1;
  else if(brushHandle==="BL")dr=row-b.h+1;
  else if(brushHandle==="BR"){dc=col-b.w+1;dr=row-b.h+1;}
  return{dc,dr};
}

function redrawMap(){
  const canvas=q("#map-canvas");if(!canvas)return;
  resizeMapCanvas();
  const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
  const tw=TW*zoom,th=TH*zoom;
  ctx.fillStyle=levelData.background_color||"#000";ctx.fillRect(0,0,canvas.width,canvas.height);

  if(isPngMapMode()&&terrainPngImg&&terrainPngVisible){
    ctx.save();
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(terrainPngImg,0,0,terrainPngImg.naturalWidth*zoom,terrainPngImg.naturalHeight*zoom);
    ctx.restore();
  }

  if(!isPngMapMode()){
    for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
      const tid=tiles[r*COLS+c];
      drawTile(ctx,tid,c*tw,r*th,tw,th);
    }
  }

  // Reference image: drawn OVER tiles but under hover/grid overlays
  // refX/Y are in base (unzoomed) pixels; refScale is fraction of base canvas width
  if(!isPngMapMode()&&refImg&&refVisible&&refOpacity>0){
    ctx.save();
    ctx.globalAlpha=refOpacity;
    const rw=Math.round(refImg.naturalWidth*refScale*zoom);
    const rh=Math.round(refImg.naturalHeight*refScale*zoom);
    ctx.drawImage(refImg,refX*zoom,refY*zoom,rw,rh);
    ctx.restore();
  }

  // Hover indicator: always draw a subtle outline on the hovered tile
  if(hoverCell){
    const{col,row}=hoverCell;
    const tw2=TW*zoom,th2=TH*zoom;

    if(tool==="draw"||tool==="erase"){
      const hoverStamp=pasteMode?clipboard:(activeBrush!==null&&brushes[activeBrush]?brushes[activeBrush]:null);
      if(hoverStamp&&tool==="draw"){
        const b=hoverStamp;
        const{dc,dr}=brushOrigin(col,row,b);
        ctx.globalAlpha=0.55;
        for(let r=0;r<b.h;r++)for(let c=0;c<b.w;c++){
          const tid=b.data[r*b.w+c];
          if(ignoreTransparency&&tid===0)continue;
          const tr=dr+r,tc=dc+c;
          if(tr>=0&&tr<ROWS&&tc>=0&&tc<COLS)drawTile(ctx,tid,tc*tw,tr*th,tw,th);
        }
        ctx.globalAlpha=1;
        ctx.strokeStyle=pasteMode?"#a080ff":C.gold;ctx.lineWidth=3;
        ctx.strokeRect(dc*tw,dr*th,b.w*tw,b.h*th);
        // Anchor dot on cursor tile
        ctx.fillStyle=pasteMode?"#a080ff":C.gold;ctx.globalAlpha=0.8;
        ctx.fillRect(col*tw,row*th,tw2,th2);ctx.globalAlpha=1;
      }else{
        // Single tile highlight
        ctx.globalAlpha=0.45;ctx.fillStyle=tool==="erase"?"#ff4040":C.gold;
        ctx.fillRect(col*tw2,row*th2,tw2,th2);ctx.globalAlpha=1;
        // Top-left corner marker
        ctx.strokeStyle="rgba(255,255,255,0.6)";ctx.lineWidth=2;
        ctx.strokeRect(col*tw2,row*th2,tw2,th2);
      }
    }else{
      // For fill/select: just a soft outline on hovered tile
      ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=1;
      ctx.strokeRect(col*tw,row*th,TW*zoom,TH*zoom);
    }
  }

  if(zoom>=2){
    ctx.strokeStyle="rgba(255,255,255,0.08)";ctx.lineWidth=1;
    for(let c=0;c<=COLS;c++){ctx.beginPath();ctx.moveTo(c*TW*zoom,0);ctx.lineTo(c*TW*zoom,ROWS*TH*zoom);ctx.stroke();}
    for(let r=0;r<=ROWS;r++){ctx.beginPath();ctx.moveTo(0,r*TH*zoom);ctx.lineTo(COLS*TW*zoom,r*TH*zoom);ctx.stroke();}
  }

  if(selStart&&selEnd&&tool==="select"){
    const x1=Math.min(selStart.col,selEnd.col),x2=Math.max(selStart.col,selEnd.col);
    const y1=Math.min(selStart.row,selEnd.row),y2=Math.max(selStart.row,selEnd.row);
    ctx.save();ctx.strokeStyle=C.gold;ctx.lineWidth=3;ctx.setLineDash([5,4]);
    ctx.strokeRect(x1*TW*zoom,y1*TH*zoom,(x2-x1+1)*TW*zoom,(y2-y1+1)*TH*zoom);ctx.restore();
  }

  // Trap placement tool - hover highlight + placed marker
  if(tool==="trap"){
    if(hoverCell){
      ctx.save();ctx.globalAlpha=0.5;ctx.fillStyle="#ff8000";
      ctx.fillRect(hoverCell.col*TW*zoom,hoverCell.row*TH*zoom,TW*zoom,TH*zoom);
      ctx.globalAlpha=1;ctx.strokeStyle="#ff8000";ctx.lineWidth=2;
      ctx.strokeRect(hoverCell.col*TW*zoom,hoverCell.row*TH*zoom,TW*zoom,TH*zoom);
      ctx.restore();
    }
    if(trapPos){
      const tx=trapPos.col*TW*zoom,ty=trapPos.row*TH*zoom,tw2=TW*zoom,th2=TH*zoom;
      ctx.save();
      // Orange cross-hair fill
      ctx.fillStyle="rgba(255,100,0,0.35)";ctx.fillRect(tx,ty,tw2,th2);
      ctx.strokeStyle="#ff6400";ctx.lineWidth=3;ctx.strokeRect(tx,ty,tw2,th2);
      // Draw a small 🪤 symbol as text
      ctx.fillStyle="#ff6400";ctx.font=`bold ${Math.max(8,tw2-4)}px monospace`;
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText("T",tx+tw2/2,ty+th2/2);
      ctx.restore();
    }
  }

  drawMultiplayerMarkers(ctx);
  if(isPngMapMode()){
    drawPngOverlayObjects(ctx);
    drawActivePngAnimationGhost(ctx,hoverCell);
  }
}


// ─── Tileset ──────────────────────────────────────────────────────────────────
function redrawTileset(){
  const canvas=q("#tileset-canvas");if(!canvas||!tilesetImg)return;
  const panelW=208,tileDisp=zoom*TW,pad=2;
  const tpr=Math.max(1,Math.floor((panelW-pad)/(tileDisp+pad)));
  const totalTiles=(tilesetImg.naturalWidth/TW)*(tilesetImg.naturalHeight/TH);
  const rows=Math.ceil(totalTiles/tpr);
  canvas.width=tpr*(tileDisp+pad)+pad;canvas.height=rows*(tileDisp+pad)+pad;
  const ctx=canvas.getContext("2d");ctx.imageSmoothingEnabled=false;
  ctx.fillStyle="#12121f";ctx.fillRect(0,0,canvas.width,canvas.height);
  const srcTpr=tilesetImg.naturalWidth/TW;
  for(let i=0;i<totalTiles;i++){
    const col=i%tpr,row=Math.floor(i/tpr),dx=pad+col*(tileDisp+pad),dy=pad+row*(tileDisp+pad);
    const srcCol=i%srcTpr,srcRow=Math.floor(i/srcTpr);
    if(i===0){ctx.fillStyle="#000";ctx.fillRect(dx,dy,tileDisp,tileDisp);}
    else ctx.drawImage(tilesetImg,srcCol*TW,srcRow*TH,TW,TH,dx,dy,tileDisp,tileDisp);
  }
  const hcol=selTile%tpr,hrow=Math.floor(selTile/tpr);
  ctx.strokeStyle=C.gold;ctx.lineWidth=3;
  ctx.strokeRect(pad+hcol*(tileDisp+pad)-1,pad+hrow*(tileDisp+pad)-1,tileDisp+2,tileDisp+2);
  canvas._tpr=tpr;canvas._tileDisp=tileDisp;canvas._pad=pad;
}

let customTilesetPath=null; // full path when tileset loaded from file

function loadTilesetFromDataUrl(dataUrl,name,silent=false,filePath=null){
  const img=new Image();
  img.onload=()=>{
    tilesetImg=img;tilesetName=name;
    if(filePath!==null)customTilesetPath=filePath;
    const hint=filePath?`📁 ${name} · click to select`:`${name} · click to select`;
    q("#ts-hint").textContent=hint;
    regeneratePreviews();updateBrushUI();redrawTileset();redrawMap();
    // No modal - default pack loading handled by caller
  };
  img.onerror=()=>appAlert("Could not load image.");img.src=dataUrl;
}

function onTilesetClick(e){
  const canvas=q("#tileset-canvas");if(!canvas||!canvas._tpr)return;
  const{_tpr:tpr,_tileDisp:td,_pad:pad}=canvas;
  const r=canvas.getBoundingClientRect();
  const col=Math.floor((e.clientX-r.left-pad)/(td+pad));
  const row=Math.floor((e.clientY-r.top-pad)/(td+pad));
  if(col<0||col>=tpr||row<0)return;
  selTile=row*tpr+col;activeBrush=null;
  q("#tile-num").value=selTile;
  updateTilePreview();redrawTileset();updateStatusBar();
}

// ─── Map interaction ──────────────────────────────────────────────────────────
function getCell(e){
  const r=q("#map-canvas").getBoundingClientRect();
  const col=Math.floor((e.clientX-r.left)/(TW*zoom)),row=Math.floor((e.clientY-r.top)/(TH*zoom));
  return(col>=0&&col<COLS&&row>=0&&row<ROWS)?{col,row}:null;
}
function getMapPoint(e){
  const canvas=q("#map-canvas");if(!canvas)return null;
  const r=canvas.getBoundingClientRect();
  const x=Math.floor((e.clientX-r.left)/zoom),y=Math.floor((e.clientY-r.top)/zoom);
  return(x>=0&&x<COLS*TW&&y>=0&&y<ROWS*TH)?{x,y}:null;
}

function paintAt(t,col,row,erase){
  if(erase){t[row*COLS+col]=0;return;}
  // Paste mode acts like a temporary brush using clipboard data
  const stampSrc=pasteMode?clipboard:(activeBrush!==null&&brushes[activeBrush]?brushes[activeBrush]:null);
  if(stampSrc){
    const{dc,dr}=brushOrigin(col,row,stampSrc);
    for(let r=0;r<stampSrc.h;r++)for(let c=0;c<stampSrc.w;c++){
      const tid=stampSrc.data[r*stampSrc.w+c];
      if(ignoreTransparency&&tid===0)continue;
      const tr=dr+r,tc=dc+c;
      if(tr>=0&&tr<ROWS&&tc>=0&&tc<COLS)t[tr*COLS+tc]=tid;
    }
  }else{
    if(ignoreTransparency&&selTile===0)return;
    t[row*COLS+col]=selTile;
  }
}

function pickTileUnderCursor(){
  if(!hoverCell)return;
  const tid=tiles[hoverCell.row*COLS+hoverCell.col];
  selTile=tid;activeBrush=null;
  q("#tile-num").value=selTile;
  updateTilePreview();redrawTileset();updateStatusBar();
}

function floodFill(src,col,row,fill){
  const tgt=src[row*COLS+col];if(tgt===fill)return src;
  const t=new Uint8Array(src);const stack=[[col,row]];
  while(stack.length){const[c,r]=stack.pop();if(c<0||c>=COLS||r<0||r>=ROWS||t[r*COLS+c]!==tgt)continue;t[r*COLS+c]=fill;stack.push([c+1,r],[c-1,r],[c,r+1],[c,r-1]);}
  return t;
}

// Move selection - copies tiles, fills source with black
function moveSelection(t,x1,y1,x2,y2,dcol,drow){
  const w=x2-x1+1,h=y2-y1+1;
  const chunk=new Uint8Array(w*h);
  for(let r=0;r<h;r++)for(let c=0;c<w;c++)chunk[r*w+c]=t[(y1+r)*COLS+(x1+c)];
  // Clear source
  for(let r=0;r<h;r++)for(let c=0;c<w;c++)t[(y1+r)*COLS+(x1+c)]=0;
  // Paste at dest
  for(let r=0;r<h;r++)for(let c=0;c<w;c++){
    const tr=drow+r,tc=dcol+c;
    if(tr>=0&&tr<ROWS&&tc>=0&&tc<COLS)t[tr*COLS+tc]=chunk[r*w+c];
  }
  return t;
}

let dragSelStart=null,dragSelSnap=null; // for move-drag
function onMapDown(e){
  e.preventDefault();const cell=getCell(e);if(!cell)return;
  const point=getMapPoint(e);

  if(isPngMapMode()){
    if(e.button===2){
      if(e.shiftKey){clearPngObjectAt(cell,point);return;}
      deselectPngAnimation();
      return;
    }
    if(e.button===0){
      const existing=objectAtPoint(point)||objectAtCell(cell);
      if(e.ctrlKey){
        const selected=pngOverlayObjects.find(o=>String(o.id)===String(selectedPngObjectId));
        const target=(existing&&isFreePngPointRole(existing.role))?existing:(selected&&isFreePngPointRole(selected.role)?selected:null);
        if(target){setPngObjectPointAt(target.id,point);return;}
      }
      if(existing&&(e.altKey||activePngPlacementMode==='select'||!activePngAnimation())){
        selectedPngObjectId=existing.id;syncPngObjectSummary();
        pngObjectDrag={id:existing.id,startCell:cell,startPoint:point,baseObject:{...existing},baseBounds:pngObjectBounds(existing),freeMove:!!(e.altKey&&isFreePngPointRole(existing.role)),moved:false};
        isPainting=true;
        redrawMap();updateStatusBar();
        return;
      }
      if(pngTerrainRuleByRole(activePngPlacementMode)){
        placePngTerrainRule(cell,activePngPlacementMode);
        return;
      }
      if(activePngPlacementMode==='animation'&&activePngAnimation()){
        placeActivePngAnimation(cell,e.altKey?point:null);
        return;
      }
      if(existing){
        selectedPngObjectId=existing.id;syncPngObjectSummary();redrawMap();updateStatusBar();
      }
      return;
    }
    return;
  }

  // Right-click in paste mode = exit paste mode
  if(pasteMode&&e.button===2){exitPasteMode();selStart=null;selEnd=null;clipboard=null;redrawMap();return;}

  const erase=e.button===2||tool==="erase";

  // Right-click outside paste/select/trap modes = clear selection + clipboard
  if(e.button===2&&tool!=="select"&&tool!=="trap"){
    selStart=null;selEnd=null;clipboard=null;redrawMap();updateStatusBar();
  }

  // Trap placement tool - left click places trap, right click clears it
  if(tool==="trap"){
    if(e.button===0&&cell){
      trapPos={col:cell.col,row:cell.row};
      // Convert tile coords to game pixel coords (x*8+4, y*8+8)
      const gx=cell.col*8+4, gy=cell.row*8+8;
      levelData.trap_x=gx; levelData.trap_y=gy;
      const xEl=q("#lf-trap_x"),yEl=q("#lf-trap_y");
      if(xEl)xEl.value=gx; if(yEl)yEl.value=gy;
      // Auto-set trap type from tileset if trap_type is currently 0
      const activeTsId=levelData.tileset??0;
      const autoTrap=TILESET_TRAP_MAP[activeTsId]??0;
      if(autoTrap&&levelData.trap_type===0){
        levelData.trap_type=autoTrap;
        const trapEl=q("#lf-trap_type");if(trapEl)trapEl.value=String(autoTrap);
      }
      // Switch to Level tab so user sees the result
      const levelTabBtn=document.querySelector(".rpanel-tab[data-tab='level']");
      if(levelTabBtn)levelTabBtn.click();
      setPackStatus("Trap placed at tile ("+cell.col+","+cell.row+") → px ("+gx+","+gy+")");
      redrawMap();
    }
    if(e.button===2){
      trapPos=null; levelData.trap_x=0; levelData.trap_y=0;
      const xEl=q("#lf-trap_x"),yEl=q("#lf-trap_y");
      if(xEl)xEl.value=0; if(yEl)yEl.value=0;
      setPackStatus("Trap cleared");redrawMap();
    }
    return;
  }

  if(tool==="select"){
    // Right-click in select mode = back to draw, tile resets to #0
    if(e.button===2){
      setTool("draw");selStart=null;selEnd=null;
      selTile=0;q("#tile-num").value=0;activeBrush=null;
      updateTilePreview();redrawTileset();redrawMap();return;
    }
    // Middle-click inside selection = start copy-drag (takes priority over pick)
    if(e.button===1&&selStart&&selEnd){
      const x1=Math.min(selStart.col,selEnd.col),x2=Math.max(selStart.col,selEnd.col);
      const y1=Math.min(selStart.row,selEnd.row),y2=Math.max(selStart.row,selEnd.row);
      if(cell.col>=x1&&cell.col<=x2&&cell.row>=y1&&cell.row<=y2){
        isCopyDrag=true;
        dragSelStart={cell,x1,y1,x2,y2};
        dragSelSnap=new Uint8Array(tiles);
        isPainting=true;return;
      }
    }
    // Middle-click outside selection = pick tile
    if(e.button===1){pickTileUnderCursor();return;}
    // Left-click inside existing selection = start move-drag
    if(e.button===0&&selStart&&selEnd){
      const x1=Math.min(selStart.col,selEnd.col),x2=Math.max(selStart.col,selEnd.col);
      const y1=Math.min(selStart.row,selEnd.row),y2=Math.max(selStart.row,selEnd.row);
      if(cell.col>=x1&&cell.col<=x2&&cell.row>=y1&&cell.row<=y2){
        isCopyDrag=false;
        dragSelStart={cell,x1,y1,x2,y2};
        dragSelSnap=new Uint8Array(tiles);
        isPainting=true;return;
      }
    }
    selStart=cell;selEnd=cell;dragSelStart=null;isCopyDrag=false;isPainting=true;updateStatusBar();return;
  }

  // Middle-click outside select mode = pick tile
  if(e.button===1){pickTileUnderCursor();return;}
  if(tool==="fill"){const t=floodFill(tiles,cell.col,cell.row,erase?0:selTile);tiles=t;pushHistory(t);redrawMap();updateDirty();return;}
  isPainting=true;const t=new Uint8Array(tiles);paintAt(t,cell.col,cell.row,erase);tiles=t;redrawMap();updateDirty();
}

function onMapMove(e){
  const cell=getCell(e);hoverCell=cell;updateStatusBar();
  if(isPngMapMode()){
    const point=getMapPoint(e);
    if(pngObjectDrag&&isPainting&&cell&&point){
      if(pngObjectDrag.freeMove||e.altKey&&isFreePngPointRole(pngObjectDrag.baseObject?.role)){
        const dx=point.x-pngObjectDrag.startPoint.x;
        const dy=point.y-pngObjectDrag.startPoint.y;
        const target={x:pngObjectDrag.baseBounds.x+dx,y:pngObjectDrag.baseBounds.y+dy};
        movePngObjectToPoint(pngObjectDrag.id,target,pngObjectDrag.baseObject,{snap:false});
      }else{
        const dCol=cell.col-pngObjectDrag.startCell.col;
        const dRow=cell.row-pngObjectDrag.startCell.row;
        const target={col:pngObjectDrag.baseObject.col+dCol,row:pngObjectDrag.baseObject.row+dRow};
        movePngObjectTo(pngObjectDrag.id,target,pngObjectDrag.baseObject);
      }
      pngObjectDrag.moved=true;
      return;
    }
    redrawMap();return;
  }
  if(pasteMode){redrawMap();return;} // always redraw for ghost preview
  if(!isPainting||!cell){redrawMap();return;}

  if(tool==="select"){
    if(dragSelStart){
      const{x1,y1,x2,y2}=dragSelStart;
      const dCol=cell.col-dragSelStart.cell.col;
      const dRow=cell.row-dragSelStart.cell.row;
      if(isCopyDrag){
        // Copy drag: paste from snapshot without clearing source
        const w=x2-x1+1,h=y2-y1+1;
        const chunk=new Uint8Array(w*h);
        for(let r=0;r<h;r++)for(let c=0;c<w;c++)chunk[r*w+c]=dragSelSnap[(y1+r)*COLS+(x1+c)];
        const t=new Uint8Array(dragSelSnap);
        for(let r=0;r<h;r++)for(let c=0;c<w;c++){
          const tid=chunk[r*w+c];
          if(ignoreTransparency&&tid===0)continue;
          const tr=y1+dRow+r,tc=x1+dCol+c;
          if(tr>=0&&tr<ROWS&&tc>=0&&tc<COLS)t[tr*COLS+tc]=tid;
        }
        tiles=t;
      }else{
        tiles=moveSelection(new Uint8Array(dragSelSnap),x1,y1,x2,y2,x1+dCol,y1+dRow);
      }
      selStart={col:x1+dCol,row:y1+dRow};
      selEnd={col:x2+dCol,row:y2+dRow};
      redrawMap();return;
    }
    selEnd=cell;redrawMap();updateStatusBar();return;
  }
  if(tool==="fill")return;
  const erase=(e.buttons&2)||tool==="erase";
  const t=new Uint8Array(tiles);paintAt(t,cell.col,cell.row,erase);tiles=t;redrawMap();updateDirty();
}

function onMapUp(){
  if(isPngMapMode()&&pngObjectDrag){
    const moved=!!pngObjectDrag.moved;
    pngObjectDrag=null;isPainting=false;
    if(moved){pushHistory(tiles,pngOverlayObjects);setPackStatus('Moved PNG animation object');}
    redrawMap();updateDirty();return;
  }
  if(!isPainting)return;isPainting=false;
  if(tool==="select"){
    if(dragSelStart){pushHistory(tiles);dragSelStart=null;dragSelSnap=null;updateDirty();}
    redrawMap();return;
  }
  if(tool!=="fill")pushHistory(tiles);
  updateDirty();
}

// ─── Brush creation ───────────────────────────────────────────────────────────
function getSelectionData(){
  if(!selStart||!selEnd)return null;
  const x1=Math.min(selStart.col,selEnd.col),x2=Math.max(selStart.col,selEnd.col);
  const y1=Math.min(selStart.row,selEnd.row),y2=Math.max(selStart.row,selEnd.row);
  const w=x2-x1+1,h=y2-y1+1;
  const data=new Uint8Array(w*h);
  for(let r=0;r<h;r++)for(let c=0;c<w;c++)data[r*w+c]=tiles[(y1+r)*COLS+(x1+c)];
  return{w,h,data};
}

function copySelection(){
  const sd=getSelectionData();if(!sd){setPackStatus("Nothing to copy - make a selection first.");return;}
  clipboard={w:sd.w,h:sd.h,data:new Uint8Array(sd.data)};
  setPackStatus(`Copied ${sd.w}×${sd.h} - now in paste mode · click to stamp · Esc/RMB to cancel`);
  enterPasteMode();
}
function enterPasteMode(){
  if(!clipboard){setPackStatus("Nothing in clipboard - Ctrl+C first.");return;}
  pasteMode=true;
  activeBrush=null; // deactivate any active brush
  setTool("draw");  // ensure we're in draw mode so painting works
  updateTilePreview();updateBrushUI();
  setPackStatus(`📋 Paste mode ${clipboard.w}×${clipboard.h} · click to stamp · Esc/RMB to cancel`);
  redrawMap();
}
function exitPasteMode(){
  pasteMode=false;
  setPackStatus(brushes.length?`Pack "${packName}" - ${brushes.length} brush${brushes.length!==1?"es":""} ✓`:"Ready");
  redrawMap();
}
function createBrushFromSelection(){
  const sd=getSelectionData();if(!sd){appAlert("Make a selection first (S tool).");return;}
  showBrushModal(sd,false);
}

// ─── Tile preview ─────────────────────────────────────────────────────────────
function updateTilePreview(){
  const el=q("#tile-preview"),lbl=q("#brush-active-label");
  if(!el)return;
  if(isPngMapMode()){const anim=activePngAnimation();el.textContent='PNG';el.style.borderColor=C.gold;if(lbl)lbl.style.display='none';if(anim)el.title=anim.name||anim.id;return;}
  if(activeBrush!==null&&brushes[activeBrush]){
    el.textContent="B";el.style.borderColor="#808080";
    if(lbl)lbl.style.display="none";
  }else{el.textContent=selTile===0?"■":`#${selTile}`;el.style.borderColor=C.gold;if(lbl)lbl.style.display="none";}
}

// ─── Brush list UI ────────────────────────────────────────────────────────────

async function deleteBrushAtIndex(i, opts={}){
  if(i===null || i===undefined || i<0 || i>=brushes.length)return false;
  const removed=brushes[i];
  if(opts.confirm){
    const ok=await appConfirm(`Delete this ${removed?.name?`\"${removed.name}\" `:''}${removed?.w||'?'}×${removed?.h||'?'} brush from the current pack?`,{title:'Delete brush?',okText:'Delete Brush',danger:true});
    if(!ok)return false;
  }
  brushes.splice(i,1);brushPreviews.splice(i,1);
  if(activeBrush===i)activeBrush=null;else if(activeBrush>i)activeBrush--;
  savePackToDisk();updateBrushUI();updateTilePreview();updateStatusBar();
  setPackStatus(`Deleted brush${removed&&removed.name?': '+removed.name:''}.`);
  return true;
}
function deleteActiveBrush(opts={}){
  if(activeBrush===null){appAlert?appAlert('Select a brush to remove.'):alert('Select a brush to remove.');return false;}
  return deleteBrushAtIndex(activeBrush,opts);
}

function updateBrushUI(){
  const clr=q("#btn-clear-brush");
  if(clr)clr.style.display=activeBrush!==null?"block":"none";
  const hint=q("#brush-empty-hint-left");
  if(hint){
    const active=(activeBrush!==null&&brushes[activeBrush])?brushes[activeBrush]:null;
    hint.innerHTML=active
      ? `Active brush: <b style="color:${C.text}">${esc(active.name||('Brush '+(activeBrush+1)))}</b> · ${active.w}×${active.h}<br>Bottom strip: click to select, Alt+Click asks before deleting.`
      : `Brushes live in the bottom strip. Click a brush to use it; Alt+Click asks before deleting it. Select a region, then Add Brush or Ctrl+B to create one.`;
  }

  // ── Bottom strip: thumbnail palette; this is now the single brush picker ──
  syncBottomStrip();

  const nameEl=q("#pack-name");if(nameEl&&nameEl.value!==packName)nameEl.value=packName;
  setPackStatus(brushes.length?`Pack "${packName}" - ${brushes.length} brush${brushes.length!==1?"es":""} ✓`:"Ready - no brushes loaded");
  refreshEditableControls(document);
}


function syncBottomStrip(){
  const strip=q("#brush-list"),hint=q("#brush-empty-hint");
  if(!strip)return;
  hint.style.display=brushes.length?"none":"flex";
  strip.innerHTML="";
  if(!brushes.length)return;

  // Always render thumbnails at 2x zoom regardless of editor zoom
  // Strip is 200px: two rows of 91px each (200 - 12px padding - 5px gap) / 2
  const THUMB_ZOOM=2;
  const ROW_H=91;
  const THUMB_H=ROW_H-4; // minus border

  brushes.forEach((b,i)=>{
    // Size based on brush tile dimensions at fixed 2x zoom
    const dispW=Math.max(b.w*TW*THUMB_ZOOM, 12);
    const dispH=b.h*TH*THUMB_ZOOM;
    // Scale down if taller than THUMB_H
    const scale=dispH>THUMB_H?(THUMB_H/dispH):1;
    const finalW=Math.round(dispW*scale), finalH=Math.round(dispH*scale);
    const cardW=finalW+4;

    const card=document.createElement("div");
    card.style.cssText=`width:${cardW}px;min-width:${cardW}px;height:${ROW_H}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:4px;border:2px solid ${activeBrush===i?C.gold:C.border};background:${activeBrush===i?"#1e2e1e":"#0a0a18"};overflow:hidden;box-sizing:border-box`;
    card.title=`${b.name||'Brush '+(i+1)} · ${b.w}×${b.h} tiles · Alt+Click to delete`;

    if(brushPreviews[i]){
      const img=document.createElement("img");
      img.src=brushPreviews[i];
      img.style.cssText=`image-rendering:pixelated;width:${finalW}px;height:${finalH}px;display:block`;
      card.appendChild(img);
    }else{
      card.style.fontSize="9px";card.style.color=C.dim;
      card.textContent="?";
    }

    card.onclick=async e=>{
      if(e&&e.altKey){
        e.preventDefault();
        await deleteBrushAtIndex(i,{confirm:true});
        return;
      }
      activeBrush=i;setTool("draw");updateBrushUI();updateTilePreview();updateStatusBar();
    };
    strip.appendChild(card);
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────

// SCROLL_POSITION_MEMORY_V1: preserve scroll positions when modals/panels are rebuilt.
const SCROLL_POSITION_MEMORY_KEY = 'lemmingsEditorScrollPositions:v1';
let _scrollPositionMemory = (()=>{
  try{return JSON.parse(sessionStorage.getItem(SCROLL_POSITION_MEMORY_KEY)||'{}')||{};}catch{return {};}
})();
let _scrollPositionMemoryReady=false;
function scrollMemoryId(el){
  if(!el || el.nodeType!==1)return '';
  const ds=el.dataset||{};
  return ds.scrollKey || el.id || '';
}
function isScrollMemoryCandidate(el){
  if(!el || el.nodeType!==1)return false;
  if(!scrollMemoryId(el))return false;
  return (el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1);
}
function rememberScrollPosition(el){
  if(!isScrollMemoryCandidate(el))return;
  const key=scrollMemoryId(el);
  _scrollPositionMemory[key]={top:el.scrollTop||0,left:el.scrollLeft||0};
  try{sessionStorage.setItem(SCROLL_POSITION_MEMORY_KEY,JSON.stringify(_scrollPositionMemory));}catch{}
}
function rememberScrollPositions(root){
  root=root||document;
  try{
    if(root.nodeType===1)rememberScrollPosition(root);
    (root.querySelectorAll?root:document).querySelectorAll('[id],[data-scroll-key]').forEach(rememberScrollPosition);
  }catch{}
}
function restoreScrollPositions(root){
  root=root||document;
  try{
    const nodes=[];
    if(root.nodeType===1)nodes.push(root);
    nodes.push(...(root.querySelectorAll?root:document).querySelectorAll('[id],[data-scroll-key]'));
    nodes.forEach(el=>{
      const key=scrollMemoryId(el);
      const saved=key&&_scrollPositionMemory[key];
      if(!saved)return;
      if(el.scrollHeight > el.clientHeight + 1)el.scrollTop=Math.max(0,Number(saved.top)||0);
      if(el.scrollWidth > el.clientWidth + 1)el.scrollLeft=Math.max(0,Number(saved.left)||0);
    });
  }catch{}
}
function scheduleScrollPositionRestore(root){
  const target=root||document;
  const run=()=>restoreScrollPositions(target);
  try{requestAnimationFrame(()=>{run();requestAnimationFrame(run);});}catch{setTimeout(run,0);}
  setTimeout(run,40);
  setTimeout(run,160);
  setTimeout(run,360);
}
function initScrollPositionMemory(){
  if(_scrollPositionMemoryReady)return;
  _scrollPositionMemoryReady=true;
  document.addEventListener('scroll',e=>rememberScrollPosition(e.target),true);
  const attach=()=>{
    ['modal-generic','modal-brush','modal-tileset','modal-import'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el || el.__scrollPositionObserver || typeof MutationObserver==='undefined')return;
      const obs=new MutationObserver(()=>scheduleScrollPositionRestore(el));
      obs.observe(el,{childList:true,subtree:true});
      el.__scrollPositionObserver=obs;
    });
    scheduleScrollPositionRestore(document);
  };
  attach();
  setTimeout(attach,0);
}


// PANEL_QOL_V2: Escape steps back one layer, closes only one dropdown/panel, / focuses panel search, and locked-level edit shortcuts are guarded.
let _panelEscapeBackHandler=null;
function setPanelEscapeBackHandler(fn){
  _panelEscapeBackHandler=typeof fn==='function'?fn:null;
}
function clearPanelEscapeBackHandler(){
  _panelEscapeBackHandler=null;
}
function runPanelEscapeBackHandler(){
  if(typeof _panelEscapeBackHandler!=='function')return false;
  const fn=_panelEscapeBackHandler;
  _panelEscapeBackHandler=null;
  try{ fn(); }
  catch(err){ console.error('Panel back handler failed',err); }
  return true;
}
function isUiVisible(el){
  if(!el)return false;
  const style=getComputedStyle(el);
  return style.display!=='none' && style.visibility!=='hidden' && el.offsetParent!==null;
}
function closeTopOpenDropdown(){
  const visible=[];
  ['save-dropdown-menu','community-dropdown-menu','proj-dropdown-menu','ts-dropdown-menu'].forEach(id=>{
    const el=document.getElementById(id);
    if(el && el.style && el.style.display && el.style.display!=='none')visible.push(el);
  });
  if(!visible.length)return false;
  // Close only the most recently declared/visually top-most dropdown. Escape should step back once.
  const el=visible[visible.length-1];
  rememberScrollPositions(el);
  el.style.display='none';
  return true;
}
function closeTopOpenPanel(){
  for(const id of ['modal-generic','modal-brush','modal-import','modal-tileset']){
    const el=document.getElementById(id);
    if(el && el.style.display!=='none'){
      closeModal('#'+id);
      return true;
    }
  }
  return false;
}
function focusFirstPanelSearch(){
  const selectors=['#share-search','#community-search','#lb-search','#project-search'];
  for(const sel of selectors){
    const el=document.querySelector(sel);
    if(el && !el.disabled && isUiVisible(el)){
      el.focus();
      if(el.select)el.select();
      return true;
    }
  }
  return false;
}
function installPanelQualityOfLifeShortcuts(){
  if(window.__lemmingsPanelQolV2)return;
  window.__lemmingsPanelQolV2=true;
  window.__lemmingsPanelQolV1=true;
  document.addEventListener('keydown',e=>{
    const key=e.key||'';
    const tag=(e.target&&e.target.tagName)||'';
    const inTextField=tag==='TEXTAREA'||tag==='SELECT'||(tag==='INPUT'&&e.target.type!=='checkbox');
    if(key==='Escape'){
      // In-app alert/confirm dialogs manage Escape themselves so their Promise resolves correctly.
      if(document.getElementById('app-dialog-overlay'))return;
      if(closeTopOpenDropdown() || runPanelEscapeBackHandler() || closeTopOpenPanel()){
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if(key==='/' && !e.ctrlKey && !e.metaKey && !e.altKey && !inTextField){
      if(focusFirstPanelSearch()){
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  },true);
}
function canUseHistoryEditShortcut(action){
  if(typeof communityBlockLockedLevelAction==='function' && communityBlockLockedLevelAction(action||'change the layout'))return false;
  return true;
}

function closeModal(id){const el=q(id);if(!el)return;rememberScrollPositions(el);if(id==="#modal-generic"){try{window._jsPlaytestCleanup&&window._jsPlaytestCleanup();}catch{}clearPanelEscapeBackHandler();}el.style.display="none";el.innerHTML="";}
function esc(value){return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');}
function showModal(html){
  clearPanelEscapeBackHandler();
  const ov=q("#modal-generic");
  if(!ov) throw new Error("Generic modal container is missing");
  rememberScrollPositions(ov);
  ov.innerHTML=`<div class="modal-box" style="max-width:1280px;width:min(1280px,96vw);max-height:92vh;overflow:auto">${html}</div>`;
  ov.style.display="flex";
  ov.onclick=e=>{if(e.target===ov)closeModal("#modal-generic");};
  scheduleScrollPositionRestore(ov);
}


// Brush save modal (called explicitly via Ctrl+B)
function showBrushModal(sd,isOverwrite){
  const def=tilesetName?`${tilesetName.replace(/\.[^.]+$/,"")} Brush ${brushes.length+1}`:`Brush ${brushes.length+1}`;
  const title=isOverwrite?"✏ Overwrite Brush":"💾 New Brush";
  const ov=q("#modal-brush");
  ov.innerHTML=`<div class="modal-box">
    <div class="modal-title">${title}</div>
    <div class="modal-body">Size: <b>${sd.w} × ${sd.h} tiles</b></div>
    <input id="bm-name" type="text" placeholder="${def}" style="margin-bottom:14px">
    <div class="modal-row">
      <button id="bm-ok" class="sbtn blue2" style="flex:1;font-size:13px">✓ Save</button>
      <button id="bm-cancel" class="sbtn" style="flex:1;font-size:13px">✕ Cancel</button>
    </div></div>`;
  ov.style.display="flex";
  const ni=q("#bm-name");protectEditableControl(ni);ni.focus();
  ni.onkeydown=e=>{if(e.key==="Enter")doSave();if(e.key==="Escape")closeModal("#modal-brush");};
  ov.onclick=e=>{if(e.target===ov)closeModal("#modal-brush");};
  function doSave(){
    const raw=q("#bm-name").value.trim();
    const name=raw||def;
    brushes.push({name,w:sd.w,h:sd.h,data:sd.data});
    brushPreviews.push(renderBrushPreview(brushes[brushes.length-1],zoom));
    activeBrush=brushes.length-1;
    closeModal("#modal-brush");
    savePackToDisk();updateBrushUI();updateTilePreview();
  }
  q("#bm-ok").onclick=doSave;q("#bm-cancel").onclick=()=>closeModal("#modal-brush");
}

function showTilesetModal(name){
  const ov=q("#modal-tileset");
  ov.innerHTML=`<div class="modal-box">
    <div class="modal-title">🖼 Tileset Loaded</div>
    <div class="modal-body"><b>${name}</b> loaded successfully.<br>Would you also like to load a brush pack for this tileset?</div>
    <div class="modal-row">
      <button id="tm-load" class="sbtn active" style="flex:1;font-size:12px">📂 Load Brush Pack</button>
      <button id="tm-skip" class="sbtn" style="flex:1;font-size:12px">Skip</button>
    </div></div>`;
  ov.style.display="flex";
  ov.onclick=e=>{if(e.target===ov)closeModal("#modal-tileset");};
  q("#tm-skip").onclick=()=>closeModal("#modal-tileset");
  q("#tm-load").onclick=async()=>{
    closeModal("#modal-tileset");
    const r=await window.electronAPI.openFile([{name:"JSON",extensions:["json"]}]);if(!r)return;
    const pack=packFromJson(new TextDecoder().decode(new Uint8Array(r.data)));if(!pack)return;
    showImportModal(pack);
  };
}

function showImportModal(pack){
  const ov=q("#modal-import");
  ov.innerHTML=`<div class="modal-box">
    <div class="modal-title">📦 Import Brush Pack</div>
    <div class="modal-body">Importing <b>"${pack.name}"</b> - ${pack.brushes.length} brush${pack.brushes.length!==1?"es":""}.<br><br>Replace your current pack, or merge?</div>
    <div class="modal-row">
      <button id="im-replace" class="sbtn red"  style="flex:1;font-size:12px">🔄 Replace</button>
      <button id="im-merge"   class="sbtn blue" style="flex:1;font-size:12px">➕ Merge</button>
      <button id="im-cancel"  class="sbtn"      style="font-size:12px;padding:5px 10px">Cancel</button>
    </div></div>`;
  ov.style.display="flex";
  ov.onclick=e=>{if(e.target===ov)closeModal("#modal-import");};
  q("#im-cancel").onclick=()=>closeModal("#modal-import");
  q("#im-replace").onclick=()=>{brushes=pack.brushes;packName=pack.name;regeneratePreviews();closeModal("#modal-import");savePackToDisk();updateBrushUI();};
  q("#im-merge").onclick=()=>{brushes=[...brushes,...pack.brushes];regeneratePreviews();closeModal("#modal-import");savePackToDisk();updateBrushUI();};
}

function showRenamePackModal(){
  const ov=q("#modal-generic");
  ov.innerHTML=`<div class="modal-box">
    <div class="modal-title">✎ Rename Brush Pack</div>
    <div class="modal-body">This renames the pack in memory and on disk next save. Enter a new name:</div>
    <input id="rp-name" type="text" value="${packName}" style="margin-bottom:14px">
    <div class="modal-row">
      <button id="rp-ok" class="sbtn active" style="flex:1;font-size:13px">✓ Rename</button>
      <button id="rp-cancel" class="sbtn" style="flex:1;font-size:13px">Cancel</button>
    </div></div>`;
  ov.style.display="flex";
  const ni=q("#rp-name");protectEditableControl(ni);ni.focus();ni.select();
  ni.onkeydown=e=>{if(e.key==="Enter")doRename();if(e.key==="Escape")closeModal("#modal-generic");};
  ov.onclick=e=>{if(e.target===ov)closeModal("#modal-generic");};
  function doRename(){
    const v=q("#rp-name").value.trim();if(!v)return;
    packName=v;q("#pack-name").value=packName;
    savePackToDisk();closeModal("#modal-generic");updateBrushUI();
  }
  q("#rp-ok").onclick=doRename;q("#rp-cancel").onclick=()=>closeModal("#modal-generic");
}

// ─── Level data helpers ───────────────────────────────────────────────────────
function syncLevelData(){
  const g=(id,fallback=0)=>{const el=q(`#lf-${id}`);return el?(isNaN(+el.value)?el.value:+el.value):fallback;};
  const text=(id,fallback="")=>{const el=q(`#lf-${id}`);return el?String(el.value||""):fallback;};

  levelData.pack_name      = text("pack_name",levelData.pack_name||"Untitled Pack");
  levelData.level_id       = text("level_id",levelData.level_id||"level_001");
  levelData.name           = text("name",levelData.name||"");
  levelData.mode           = text("mode",levelData.mode||"singleplayer");
  levelData.ruleset        = text("ruleset",levelData.ruleset||"sms-expanded");
  levelData.width_tiles    = g("width_tiles",levelData.width_tiles||112);
  levelData.height_tiles   = g("height_tiles",levelData.height_tiles||19);
  levelData.map_format     = q("#lf-map_format")?.value || levelData.map_format || "mlm";
  levelData.terrain_png    = q("#lf-terrain_png")?.value || levelData.terrain_png || "";
  levelData.background_color = q("#lf-background_color")?.value || levelData.background_color || "#000000";
  levelData.png_level_json = q("#lf-png_level_json")?.value || levelData.png_level_json || "";
  levelData.overlay_json   = q("#lf-overlay_json")?.value || levelData.overlay_json || "";
  levelData.animation_pack_json = q("#lf-animation_pack_json")?.value || levelData.animation_pack_json || "";
  levelData.players         = g("players",levelData.players||2);
  levelData.ownership       = text("ownership",levelData.ownership||"per-player");
  levelData.p1_label        = text("p1_label",levelData.p1_label||"P1");
  levelData.p2_label        = text("p2_label",levelData.p2_label||"P2");
  levelData.p1_hatch_col    = g("p1_hatch_col",levelData.p1_hatch_col??-1);
  levelData.p1_hatch_row    = g("p1_hatch_row",levelData.p1_hatch_row??-1);
  levelData.p1_goal_col     = g("p1_goal_col",levelData.p1_goal_col??-1);
  levelData.p1_goal_row     = g("p1_goal_row",levelData.p1_goal_row??-1);
  levelData.p2_hatch_col    = g("p2_hatch_col",levelData.p2_hatch_col??-1);
  levelData.p2_hatch_row    = g("p2_hatch_row",levelData.p2_hatch_row??-1);
  levelData.p2_goal_col     = g("p2_goal_col",levelData.p2_goal_col??-1);
  levelData.p2_goal_row     = g("p2_goal_row",levelData.p2_goal_row??-1);

  // Compatibility fields retained for MLM/INI/playtest paths.
  levelData.rating         = normaliseMainGameRating(text("rating",levelData.rating||"FUN"));
  levelData.level_number   = g("level_number",levelData.level_number||1);
  levelData.num_lemmings   = g("num_lemmings",50);
  levelData.percent_needed = g("percent_needed",50);
  levelData.release_rate   = g("release_rate",5);
  levelData.time_minutes   = g("time_minutes",5);
  levelData.climbers       = g("climbers",0);
  levelData.floaters       = g("floaters",0);
  levelData.bombers        = g("bombers",0);
  levelData.blockers       = g("blockers",0);
  levelData.builders       = g("builders",0);
  levelData.bashers        = g("bashers",0);
  levelData.miners         = g("miners",0);
  levelData.diggers        = g("diggers",0);
  levelData.tileset        = readTilesetSelectValue(levelData.tileset??0);
  levelData.trap_type      = g("trap_type",0);
  levelData.trap_x         = g("trap_x",0);
  levelData.trap_y         = g("trap_y",0);
  levelData.fall_distance  = g("fall_distance",56);
  levelData.music          = g("music",0);
  try{communityUpdateShareCurrentButton();}catch{}
}


function getProjectSaveMissingFields(){
  syncLevelData();
  const missing=[];
  const pngMode=isPngMapMode();
  const reqText=[
    ["pack_name","Pack name"],
    ["level_id","Level ID"],
    ["name","Level name"],
    ["mode","Mode"],
    ["ruleset","Ruleset"],
    ["width_tiles","Width tiles"],
    ["height_tiles","Height tiles"],
    ["num_lemmings","Number of lemmings"],
    ["percent_needed","Percent needed"],
    ["release_rate","Release rate"],
    ["time_minutes","Time limit"],
    ...(pngMode?[["terrain_png","Terrain PNG"],["png_level_json","PNG Level JSON"]]:[["tileset","Tileset"]]),
    ["fall_distance","Fall distance"],
    ["music","Music"]
  ];
  for(const [key,label] of reqText){
    const v=levelData[key];
    if(v===undefined||v===null||String(v).trim()==="") missing.push(label);
  }
  const ranged=[
    ["width_tiles","Width tiles"],
    ["height_tiles","Height tiles"],
    ["num_lemmings","Number of lemmings"],
    ["percent_needed","Percent needed"],
    ["release_rate","Release rate"],
    ["time_minutes","Time limit"],
    ...(pngMode?[]:[["tileset","Tileset"]]),
    ["fall_distance","Fall distance"],
    ["music","Music"]
  ];
  for(const [key,label] of ranged){
    const v=Number(levelData[key]);
    if(!Number.isFinite(v)) missing.push(label);
  }
  if(Number(levelData.width_tiles)<=0) missing.push("Width tiles must be greater than 0");
  if(Number(levelData.height_tiles)<=0) missing.push("Height tiles must be greater than 0");
  if(String(levelData.ruleset||levelData.mode||'').toLowerCase()==='multiplayer'){
    if(!Number.isFinite(Number(levelData.players))||Number(levelData.players)<2) missing.push('Players must be at least 2');
    if(!String(levelData.ownership||'').trim()) missing.push('Ownership');
  }
  if(Number(levelData.num_lemmings)<=0) missing.push("Number of lemmings must be greater than 0");
  if(Number(levelData.percent_needed)<=0) missing.push("Percent needed must be greater than 0");
  ["climbers","floaters","bombers","blockers","builders","bashers","miners","diggers"].forEach(k=>{
    const v=levelData[k];
    if(v===undefined||v===null||String(v).trim()===""||!Number.isFinite(Number(v))){
      missing.push(k.charAt(0).toUpperCase()+k.slice(1));
    }
  });
  return [...new Set(missing)];
}
function isProjectSaveReady(){return getProjectSaveMissingFields().length===0;}
function updateProjectSaveButtons(){
  const ready=isProjectSaveReady();
  ["#btn-project-save","#btn-expanded-export-level"].forEach(sel=>{
    const el=q(sel);
    if(el){
      el.disabled=!ready;
      el.title=ready?"Export this expanded level":"Fill in all level details before exporting";
    }
  });
}
function showProjectSaveMissingPopup(){
  const missing=getProjectSaveMissingFields();
  if(!missing.length)return true;
  appAlert("Fill in these level details before exporting:\n\n• "+missing.join("\n• "));
  updateProjectSaveButtons();
  return false;
}

function populateLevelForm(d){
  const sv=(id,v)=>{const el=q(`#lf-${id}`);if(el)el.value=v;};
  sv("pack_name",d.pack_name||"Untitled Pack");
  sv("level_id",d.level_id||"level_001");
  sv("name",d.name||"");
  sv("mode",d.mode||"singleplayer");
  sv("ruleset",d.ruleset||"sms-expanded");
  sv("width_tiles",d.width_tiles||112);
  sv("height_tiles",d.height_tiles||19);
  sv("map_format",d.map_format||"mlm");
  sv("terrain_png",d.terrain_png||"");
  sv("background_color",d.background_color||"#000000");
  sv("png_level_json",d.png_level_json||"");
  sv("overlay_json",d.overlay_json||"");
  sv("animation_pack_json",d.animation_pack_json||"");
  sv("players",d.players||2);
  sv("ownership",d.ownership||"per-player");
  sv("p1_label",d.p1_label||"P1");
  sv("p2_label",d.p2_label||"P2");
  sv("p1_hatch_col",d.p1_hatch_col??-1); sv("p1_hatch_row",d.p1_hatch_row??-1);
  sv("p1_goal_col",d.p1_goal_col??-1);   sv("p1_goal_row",d.p1_goal_row??-1);
  sv("p2_hatch_col",d.p2_hatch_col??-1); sv("p2_hatch_row",d.p2_hatch_row??-1);
  sv("p2_goal_col",d.p2_goal_col??-1);   sv("p2_goal_row",d.p2_goal_row??-1);
  sv("rating",normaliseMainGameRating(d.rating||"FUN"));
  sv("level_number",d.level_number||1);
  sv("num_lemmings",d.num_lemmings||50);
  sv("percent_needed",d.percent_needed||50);
  sv("release_rate",d.release_rate||5);
  sv("time_minutes",d.time_minutes||5);
  sv("climbers",d.climbers||0); sv("floaters",d.floaters||0);
  sv("bombers",d.bombers||0);   sv("blockers",d.blockers||0);
  sv("builders",d.builders||0); sv("bashers",d.bashers||0);
  sv("miners",d.miners||0);     sv("diggers",d.diggers||0);
  setTilesetSelectValue(d.tileset??0);
  sv("trap_type",d.trap_type||0);
  sv("trap_x",d.trap_x||0); sv("trap_y",d.trap_y||0);
  sv("fall_distance",d.fall_distance||56);
  sv("music",d.music||0);
  syncLevelConfigFromLevelData();
  refreshRulesetFormVisibility();
  try{ if(typeof communitySetActiveLockFromLevel==='function') communitySetActiveLockFromLevel(d||levelData||{}); }catch{}
  updateProjectSaveButtons();
}

function multiplayerMarkerIniLines(d,{compact=false}={}){
  const lines=[];
  const add=(prefix,alias=null)=>{
    const cell=markerCell(prefix,d);
    if(!cell)return;
    const names=alias?[prefix,alias]:[prefix];
    for(const name of names){
      if(compact)lines.push(`${name} = ${cell.col},${cell.row}`);
      lines.push(`${name}_col = ${cell.col}`);
      lines.push(`${name}_row = ${cell.row}`);
      lines.push(`${name}_x = ${cell.col*TW}`);
      lines.push(`${name}_y = ${cell.row*TH}`);
    }
  };
  add('p1_hatch');
  add('p1_goal','p1_exit');
  add('p2_hatch');
  add('p2_goal','p2_exit');
  return lines;
}
function multiplayerSectionIniLines(d){
  if(!isMultiplayerLevelMode(d))return [];
  return [
    '',
    '[multiplayer]',
    'enabled = true',
    `players = ${d.players||2}`,
    `ownership = ${d.ownership||'per-player'}`,
    `lemmings_per_player = ${Math.max(1,Number(d.lemmings_per_player||d.num_lemmings||40)||40)}`,
    `p1_label = ${d.p1_label||'P1'}`,
    `p2_label = ${d.p2_label||'P2'}`,
    'p1_goal_marker = green_torch',
    'p2_goal_marker = blue_torch',
    ...multiplayerMarkerIniLines(d,{compact:true})
  ];
}

function levelDataToIni(d, mlmPath=""){
  const lines=[
    "[level]",
    `; Generated by SMS Lemmings Pack Editor`,
    `pack_name = ${d.pack_name||"Untitled Pack"}`,
    `level_id = ${d.level_id||"level_001"}`,
    `mode = ${d.mode||"singleplayer"}`,
    `ruleset = ${d.ruleset||"sms-expanded"}`,
    `width_tiles = ${d.width_tiles||COLS}`,
    `height_tiles = ${d.height_tiles||ROWS}`,
    `map_format = ${d.map_format||"mlm"}`,
    ...(String(d.map_format||"").toLowerCase()==="png"||d.terrain_png?[
      `terrain_png = ${d.terrain_png||""}`,
      `background_color = ${d.background_color||"#000000"}`,
      `png_level_json = ${d.png_level_json||safeLevelStem()+".pnglevel.json"}`,
      `animation_pack_json = ${d.animation_pack_json||PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME}`,
    ]:[]),
    ...(String(d.ruleset||d.mode||'').toLowerCase()==='multiplayer'||String(d.mode||'').toLowerCase()==='multiplayer'?[
      `players = ${d.players||2}`,
      `ownership = ${d.ownership||'per-player'}`,
      `p1_label = ${d.p1_label||'P1'}`,
      `p2_label = ${d.p2_label||'P2'}`,
      ...multiplayerMarkerIniLines(d),
    ]:[]),
    `name = ${(d.name||"").toUpperCase()}`,
    `rating = ${d.rating||"fun"}`,
    `level_number = ${d.level_number||1}`,
    `fall_distance = ${d.fall_distance||56}`,
    `music = ${d.music||0}`,
    ...(String(d.map_format||'').toLowerCase()==='png'||d.terrain_png?[]:[
      `tileset = ${d.tileset??0}`,
      ...(d.trap_type?[
        `trap_type = ${d.trap_type}`,
        `trap_x = ${d.trap_x||0}`,
        `trap_y = ${d.trap_y||0}`,
      ]:[]),
    ]),
    `num_lemmings = ${d.num_lemmings||50}`,
    `percent_needed = ${d.percent_needed||50}`,
    `release_rate = ${d.release_rate||5}`,
    `time_minutes = ${d.time_minutes||5}`,
    `climbers = ${d.climbers||0}`,
    `floaters = ${d.floaters||0}`,
    `bombers = ${d.bombers||0}`,
    `blockers = ${d.blockers||0}`,
    `builders = ${d.builders||0}`,
    `bashers = ${d.bashers||0}`,
    `miners = ${d.miners||0}`,
    `diggers = ${d.diggers||0}`,
  ];
  lines.push(...multiplayerSectionIniLines(d));
  return lines.join("\n");
}

function iniToLevelData(text){
  const d={...levelData};
  for(const line of text.split("\n")){
    const s=line.trim();
    if(!s||s.startsWith(";"))continue;
    const eq=s.indexOf("=");if(eq<0)continue;
    const k=s.slice(0,eq).trim().toLowerCase();
    const v=s.slice(eq+1).split(";")[0].trim();
    const num=n=>isNaN(+n)?0:+n;
    const tilePair=value=>{const m=String(value||'').match(/^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/);return m?{col:num(m[1]),row:num(m[2])}:null;};
	if(k==="name")d.name=v;
    else if(k==="pack_name")d.pack_name=v;
    else if(k==="level_id")d.level_id=v;
    else if(k==="mode")d.mode=v;
    else if(k==="ruleset")d.ruleset=v;
    else if(k==="width_tiles")d.width_tiles=num(v);
    else if(k==="height_tiles")d.height_tiles=num(v);
    else if(k==="map_format")d.map_format=v;
    else if(k==="terrain_png"||k==="terrain_image"||k==="map_image"||k==="png")d.terrain_png=v;
    else if(k==="background_color"||k==="background_colour")d.background_color=v;
    else if(k==="png_level_json"||k==="png_animations_json"||k==="level_json")d.png_level_json=v;
    else if(k==="overlay_json"||k==="animation_overlay"||k==="objects_json")d.overlay_json=v;
    else if(k==="animation_pack_json"||k==="animation_pack"||k==="animations_json")d.animation_pack_json=v;
    else if(k==="players")d.players=num(v);
    else if(k==="ownership")d.ownership=v;
    else if(k==="p1_label")d.p1_label=v;
    else if(k==="p2_label")d.p2_label=v;
    else if(k==="p1_hatch_col")d.p1_hatch_col=num(v);
    else if(k==="p1_hatch_row")d.p1_hatch_row=num(v);
    else if(k==="p1_goal_col"||k==="p1_exit_col")d.p1_goal_col=num(v);
    else if(k==="p1_goal_row"||k==="p1_exit_row")d.p1_goal_row=num(v);
    else if(k==="p2_hatch_col")d.p2_hatch_col=num(v);
    else if(k==="p2_hatch_row")d.p2_hatch_row=num(v);
    else if(k==="p2_goal_col"||k==="p2_exit_col")d.p2_goal_col=num(v);
    else if(k==="p2_goal_row"||k==="p2_exit_row")d.p2_goal_row=num(v);
    else if(k==="p1_hatch_x")d.p1_hatch_col=Math.floor(num(v)/TW);
    else if(k==="p1_hatch_y")d.p1_hatch_row=Math.floor(num(v)/TH);
    else if(k==="p1_goal_x"||k==="p1_exit_x")d.p1_goal_col=Math.floor(num(v)/TW);
    else if(k==="p1_goal_y"||k==="p1_exit_y")d.p1_goal_row=Math.floor(num(v)/TH);
    else if(k==="p2_hatch_x")d.p2_hatch_col=Math.floor(num(v)/TW);
    else if(k==="p2_hatch_y")d.p2_hatch_row=Math.floor(num(v)/TH);
    else if(k==="p2_goal_x"||k==="p2_exit_x")d.p2_goal_col=Math.floor(num(v)/TW);
    else if(k==="p2_goal_y"||k==="p2_exit_y")d.p2_goal_row=Math.floor(num(v)/TH);
    else if(k==="p1_hatch"){const p=tilePair(v);if(p){d.p1_hatch_col=p.col;d.p1_hatch_row=p.row;}}
    else if(k==="p1_goal"||k==="p1_exit"){const p=tilePair(v);if(p){d.p1_goal_col=p.col;d.p1_goal_row=p.row;}}
    else if(k==="p2_hatch"){const p=tilePair(v);if(p){d.p2_hatch_col=p.col;d.p2_hatch_row=p.row;}}
    else if(k==="p2_goal"||k==="p2_exit"){const p=tilePair(v);if(p){d.p2_goal_col=p.col;d.p2_goal_row=p.row;}}
    else if(k==="lemmings_per_player")d.num_lemmings=num(v);
    else if(k==="mlm_file")d.mlm_file=v;
    else if(k==="rating")d.rating=v;
    else if(k==="level_number")d.level_number=num(v);
    else if(k==="fall_distance")d.fall_distance=num(v);
    else if(k==="fall_distance_override")d.fall_distance_override=num(v);
    else if(k==="music")d.music=num(v);
    else if(k==="tileset")d.tileset=num(v);
    else if(k==="trap_type")d.trap_type=num(v);
    else if(k==="trap_x")d.trap_x=num(v);
    else if(k==="trap_y")d.trap_y=num(v);
    else if(k==="num_lemmings")d.num_lemmings=num(v);
    else if(k==="percent_needed")d.percent_needed=num(v);
    else if(k==="release_rate")d.release_rate=num(v);
    else if(k==="time_minutes")d.time_minutes=num(v);
    else if(k==="climbers")d.climbers=num(v);
    else if(k==="floaters")d.floaters=num(v);
    else if(k==="bombers")d.bombers=num(v);
    else if(k==="blockers")d.blockers=num(v);
    else if(k==="builders")d.builders=num(v);
    else if(k==="bashers")d.bashers=num(v);
    else if(k==="miners")d.miners=num(v);
    else if(k==="diggers")d.diggers=num(v);
  }
  return d;
}

async function exportIni(){
  syncLevelData();
  const safe=(levelData.mlm_file||levelData.name||"level").replace(/[^a-zA-Z0-9_\-.]/g,"_").replace(/\.ini$/i,"")||"level";
  applyMapSizeFromFields();
  const text=levelDataToIni(levelData);
  await window.electronAPI.saveFile({
    defaultName:`${safe}.ini`,
    filters:[{name:"INI",extensions:["ini"]}],
    data:Array.from(new TextEncoder().encode(text))
  });
}

async function importIni(){
  const r=await window.electronAPI.openFile([{name:"INI",extensions:["ini","txt"]}]);
  if(!r)return;
  const text=new TextDecoder().decode(new Uint8Array(r.data));
  levelData=iniToLevelData(text);
  populateLevelForm(levelData);
  if(levelData.width_tiles&&levelData.height_tiles)resizeLevelMap(levelData.width_tiles,levelData.height_tiles,{preserve:true,markDirty:true,status:false});
  if(levelData.trap_x||levelData.trap_y){
    trapPos={col:Math.round((levelData.trap_x-4)/8),row:Math.round((levelData.trap_y-8)/8)};
  } else {trapPos=null;}
  redrawMap();
  // Auto-switch to matching built-in tileset if possible
  const tsId=levelData.tileset??0;
  applyTilesetForLoadedLevel(tsId);
  setPackStatus(`Imported INI: ${levelData.name||"unnamed"}`);
}


// ─── Build level form DOM ────────────────────────────────────────────────────

function builtinTilesetOptions(){return [["0","Grass"],["1","Sand 1"],["2","Fire"],["3","Ice"],["4","Brick"],["6","Sand 2"],["7","Sega"]];}
function builtinTilesetIds(){
  return builtinTilesetOptions().map(([v])=>Number(v));
}
function isBuiltInTilesetId(id){
  return builtinTilesetIds().includes(Number(id));
}
function normaliseTilesetId(id,fallback=0){
  const n=Number(id);
  return Number.isFinite(n) ? n : fallback;
}
function customTilesetLabelById(id){
  const t=customTilesetById(id);
  return t ? `${t.localId} - ${t.name||t.safeName||'Custom Tileset'} (custom)` : `${id} - Custom Tileset (not loaded yet)`;
}
function ensureTilesetOptionValue(id){
  const el=q("#lf-tileset_id"); if(!el)return;
  const value=String(normaliseTilesetId(id,0));
  if([...el.options].some(o=>o.value===value))return;
  const opt=document.createElement('option');
  opt.value=value;
  opt.textContent=isBuiltInTilesetId(value) ? (builtinTilesetOptions().find(([v])=>String(v)===value)||[value,'Tileset '+value])[1] : customTilesetLabelById(value);
  opt.dataset.pendingTileset='1';
  el.appendChild(opt);
}
function setTilesetSelectValue(id){
  const value=String(normaliseTilesetId(id,0));
  ensureTilesetOptionValue(value);
  const el=q("#lf-tileset_id"); if(el)el.value=value;
}
function readTilesetSelectValue(fallback=0){
  const el=q("#lf-tileset_id");
  if(!el)return normaliseTilesetId(fallback,0);
  if(el.value===''||el.value===undefined||el.value===null){
    setTilesetSelectValue(fallback);
    return normaliseTilesetId(fallback,0);
  }
  return normaliseTilesetId(el.value,normaliseTilesetId(fallback,0));
}
async function applyTilesetForLoadedLevel(tilesetId){
  const id=normaliseTilesetId(tilesetId,0);
  levelData.tileset=id;
  setTilesetSelectValue(id);
  try{await refreshCustomTilesetsCache();}catch{}
  refreshTilesetSelectOptions();
  setTilesetSelectValue(id);
  const ts=BUNDLED_TILESETS.find(t=>Number(t.id)===id);
  if(ts&&ts.dataUrl){
    activeTilesetId=id; customTilesetPath=null;
    loadTilesetFromDataUrl(ts.dataUrl,ts.name+".png",true);
    loadDefaultPackForTileset(id);
    return;
  }
  const t=customTilesetById(id)||{localId:id,name:'Custom Tileset'};
  activeTilesetId=id; customTilesetPath='custom:'+id;
  try{
    const src=await window.electronAPI.getCustomTilesetImage(currentTilesetProjectName(),id);
    loadTilesetFromDataUrl(src,(t.name||t.safeName||('Custom '+id))+'.png',true,'custom:'+id);
    setPackStatus('Loaded custom tileset #'+id);
  }catch(err){
    console.error('Could not load custom tileset for level',err);
    setPackStatus('Level uses custom tileset #'+id+' (preview unavailable)');
  }
  loadDefaultPackForTileset(id);
}
let _customTilesetsCache=[];
async function refreshCustomTilesetsCache(){
  try{
    const projectName=(q("#project-name")?.value||"My Project").trim()||"My Project";
    const r=await window.electronAPI.listCustomTilesets(projectName);
    _customTilesetsCache=(r&&r.tilesets)||[];
  }catch{_customTilesetsCache=[];}
  return _customTilesetsCache;
}
function allTilesetOptions(){
  const opts=builtinTilesetOptions();
  for(const t of _customTilesetsCache||[]){
    opts.push([String(t.localId),`${t.localId} - ${t.name||t.safeName||'Custom Tileset'} (custom)`]);
  }
  return opts;
}
function refreshTilesetSelectOptions(){
  const el=q("#lf-tileset_id"); if(!el)return;
  const current=String((el.value!==''&&el.value!==undefined&&el.value!==null)?el.value:(levelData.tileset??0));
  el.innerHTML=allTilesetOptions().map(([v,label])=>`<option value="${esc(v)}">${esc(label)}</option>`).join("");
  ensureTilesetOptionValue(current);
  el.value=current;
  refreshTilesetDropdownMenu();
}
function currentTilesetProjectName(){
  return (q("#project-name")?.value||"My Project").trim()||"My Project";
}
function customTilesetById(id){
  id=Number(id);
  return (_customTilesetsCache||[]).find(t=>Number(t.localId)===id)||null;
}
function makeTilesetMenuItem(label,onClick){
  const item=document.createElement("button");
  item.style.cssText=`display:block;width:100%;text-align:left;padding:7px 12px;background:none;border:none;color:${C.text};font-family:${FONT};font-size:12px;font-weight:700;cursor:pointer`;
  item.textContent=label;
  item.onmouseenter=()=>item.style.background="#252550";
  item.onmouseleave=()=>item.style.background="none";
  item.onclick=onClick;
  return item;
}
function selectBundledTileset(ts){
  const ddMenu=q("#ts-dropdown-menu"); if(ddMenu)ddMenu.style.display="none";
  activeTilesetId=ts.id;
  customTilesetPath=null;
  levelData.tileset=ts.id;
  const tsSel=q("#lf-tileset_id");if(tsSel)tsSel.value=String(ts.id);
  const autoTrap=TILESET_TRAP_MAP[ts.id]??0;
  if(autoTrap){levelData.trap_type=autoTrap;const trapEl=q("#lf-trap_type");if(trapEl)trapEl.value=String(autoTrap);}
  if(ts.dataUrl)loadTilesetFromDataUrl(ts.dataUrl, ts.name+".png", true);
  loadDefaultPackForTileset(ts.id);
  try{communityUpdateShareCurrentButton();}catch{}
}
async function selectCustomTileset(id){
  const ddMenu=q("#ts-dropdown-menu"); if(ddMenu)ddMenu.style.display="none";
  const t=customTilesetById(id)||{localId:id,name:'Custom Tileset'};
  const localId=Number(t.localId||id);
  customTilesetPath='custom:'+localId;
  levelData.tileset=localId;
  const tsSel=q("#lf-tileset_id");if(tsSel)tsSel.value=String(localId);
  try{
    const src=await window.electronAPI.getCustomTilesetImage(currentTilesetProjectName(),localId);
    loadTilesetFromDataUrl(src,(t.name||t.safeName||('Custom '+localId))+'.png',true,'custom:'+localId);
  }catch(err){
    console.error('Could not load custom tileset image',err);
    setPackStatus('Selected custom tileset #'+localId+' (preview unavailable)');
  }
  await loadDefaultPackForTileset(localId);
  try{communityUpdateShareCurrentButton();}catch{}
}
function refreshTilesetDropdownMenu(){
  const ddMenu=q("#ts-dropdown-menu"); if(!ddMenu)return;
  ddMenu.innerHTML="";
  BUNDLED_TILESETS.forEach(ts=>ddMenu.appendChild(makeTilesetMenuItem(`${ts.id} - ${ts.name}`,()=>selectBundledTileset(ts))));
  const custom=(_customTilesetsCache||[]).slice().sort((a,b)=>Number(a.localId)-Number(b.localId));
  if(custom.length){
    const sep=document.createElement('div');
    sep.textContent='Custom tilesets';
    sep.style.cssText=`padding:6px 12px;border-top:1px solid ${C.border};color:${C.gold};font-size:11px;font-weight:900;text-transform:uppercase`;
    ddMenu.appendChild(sep);
    custom.forEach(t=>ddMenu.appendChild(makeTilesetMenuItem(`${t.localId} - ${t.name||t.safeName||'Custom Tileset'} (custom)`,()=>selectCustomTileset(t.localId))));
  }
}
function wireCustomTilesetsButton(){
  const btn=q("#btn-custom-tilesets");
  if(!btn)return;
  btn.disabled=false;
  btn.removeAttribute("disabled");
  btn.style.pointerEvents="auto";
  btn.style.cursor="pointer";
  const open=async(e)=>{
    if(e){e.preventDefault();e.stopPropagation();}
    try{
      await showCustomTilesetsModal();
    }catch(err){
      console.error("Custom tilesets panel failed", err);
      appAlert("Could not open Custom Tilesets.\n\n" + (err&&err.message ? err.message : String(err||"Unknown error")));
    }
  };
  btn.onclick=open;
  btn.addEventListener("click", open, true);
}

function tilesetImageSrcForCard(ts){
  if(ts && ts.dataUrl) return ts.dataUrl;
  if(ts && ts.file) return 'tilesets/' + ts.file;
  return 'tilesets/TILESET_TEMPLATE.png';
}

function dataUrlToByteArray(dataUrl){
  const comma=String(dataUrl||'').indexOf(',');
  const b64=comma>=0?String(dataUrl).slice(comma+1):String(dataUrl||'');
  const bin=atob(b64);
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return Array.from(out);
}
async function imageSourceToByteArray(src){
  src=String(src||'');
  if(!src) return [];
  if(src.startsWith('data:')) return dataUrlToByteArray(src);
  const r=await fetch(src,{cache:'no-store'});
  if(!r.ok) throw new Error('Could not fetch PNG for download.');
  return Array.from(new Uint8Array(await r.arrayBuffer()));
}
function safePngName(name){
  return (String(name||'tileset').replace(/[^a-zA-Z0-9_ .-]+/g,'_').replace(/\s+/g,' ').trim()||'tileset').replace(/\.png$/i,'')+'.png';
}
async function downloadTilesetPng({custom=false,id=null,name='tileset',file=''}){
  try{
    let src='';
    if(custom) src=await window.electronAPI.getCustomTilesetImage(currentTilesetProjectName(),id);
    else src=await window.electronAPI.loadTilesetImage(file);
    if(!src) throw new Error('No PNG preview is available for this tileset.');
    const data=await imageSourceToByteArray(src);
    await window.electronAPI.saveFile({defaultName:safePngName(name),filters:[{name:'PNG image',extensions:['png']}],data});
    setPackStatus('Downloaded '+safePngName(name));
  }catch(err){
    console.error('Download tileset PNG failed',err);
    await appAlert('Could not download PNG.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Download failed',danger:true});
  }
}
async function openLooseTilesetPng(){
  const api=window.electronAPI;
  const r=await api.openFile([{name:'Images',extensions:['png','bmp','gif','jpg','jpeg']}]);
  if(!r)return;
  activeTilesetId=null;
  const bytes=new Uint8Array(r.data);
  const ext=String(r.path||'png').split('.').pop().toLowerCase();
  const mime=ext==='jpg'||ext==='jpeg'?'image/jpeg':`image/${ext}`;
  let bin='';
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  const dataUrl=`data:${mime};base64,${btoa(bin)}`;
  loadTilesetFromDataUrl(dataUrl,(r.path||'tileset.png').replace(/.*[/\\]/,''),false,r.path);
  closeModal('#modal-generic');
}
async function cloneBuiltinTilesetForEdit(ts){
  const projectName=currentTilesetProjectName();
  const name=await appPrompt('Clone tileset as:', (ts&&ts.name?ts.name:'Tileset')+' Copy', {title:'Clone built-in tileset',okText:'Clone & Edit'});
  if(!name)return;
  try{
    const r=await window.electronAPI.cloneBuiltinTileset(projectName, ts.id, name);
    if(!r||!r.ok)throw new Error((r&&r.error)||'Could not clone tileset.');
    await refreshCustomTilesetsCache(); refreshTilesetSelectOptions(); refreshTilesetDropdownMenu();
    setPackStatus('Cloned '+ts.name+' into custom tileset #'+r.tileset.localId);
    showCustomTilesetEditor(r.tileset);
  }catch(err){
    console.error('Clone built-in tileset failed',err);
    await appAlert('Could not clone tileset.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Clone failed',danger:true});
  }
}
async function duplicateCustomTilesetForEdit(t){
  const projectName=currentTilesetProjectName();
  const name=await appPrompt('Duplicate tileset as:', (t&&t.name?t.name:(t&&t.safeName)||'Custom Tileset')+' Copy', {title:'Duplicate custom tileset',okText:'Duplicate & Edit'});
  if(!name)return;
  try{
    const r=await window.electronAPI.duplicateCustomTileset(projectName, t.localId, name);
    if(!r||!r.ok)throw new Error((r&&r.error)||'Could not duplicate tileset.');
    await refreshCustomTilesetsCache(); refreshTilesetSelectOptions(); refreshTilesetDropdownMenu();
    setPackStatus('Duplicated custom tileset #'+t.localId+' as #'+r.tileset.localId);
    showCustomTilesetEditor(r.tileset);
  }catch(err){
    console.error('Duplicate custom tileset failed',err);
    await appAlert('Could not duplicate tileset.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Duplicate failed',danger:true});
  }
}
async function uploadCustomTilesetPngFromBrowser(id){
  const projectName=currentTilesetProjectName();
  try{
    const r=await window.electronAPI.importCustomTilesetPng(projectName,id);
    if(!r||r.cancelled)return;
    if(!r.ok)throw new Error(r.error||'Could not upload PNG.');
    await refreshCustomTilesetsCache(); refreshTilesetSelectOptions(); refreshTilesetDropdownMenu();
    setPackStatus('Uploaded PNG for custom tileset #'+id);
    showTilesetBrowserModal();
  }catch(err){
    console.error('Upload custom tileset PNG failed',err);
    await appAlert('Could not upload PNG.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Upload failed',danger:true});
  }
}

async function showTilesetBrowserModal(){
  const projectName=currentTilesetProjectName();
  try{ await refreshCustomTilesetsCache(); }
  catch(err){ console.error('Could not refresh custom tilesets', err); _customTilesetsCache=[]; }

  const builtins=BUNDLED_TILESETS.map(ts=>`
    <div class="tileset-card" style="text-align:left;border:1px solid ${Number(levelData.tileset)===Number(ts.id)?C.gold:C.border};background:#10101e;border-radius:8px;padding:9px;color:${C.text};box-shadow:0 3px 14px #0007">
      <img src="${esc(tilesetImageSrcForCard(ts))}" style="display:block;width:100%;height:148px;object-fit:contain;image-rendering:pixelated;background:#080812;border:1px solid #242440;border-radius:5px;margin-bottom:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <b style="color:${C.gold};font-size:12px">${esc(ts.name)}</b>
        <span style="font-size:10px;color:${C.dim};font-weight:900">#${esc(ts.id)}</span>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <button class="sbtn" data-use-built-in-ts="${esc(ts.id)}">Use</button>
        <button class="sbtn" data-download-built-in-ts="${esc(ts.id)}">Download PNG</button>
      </div>
    </div>`).join('');

  const custom=(_customTilesetsCache||[]).slice().sort((a,b)=>Number(a.localId)-Number(b.localId));
  const customCards=custom.length?custom.map(t=>`
    <div class="custom-tileset-card" style="border:1px solid ${Number(levelData.tileset)===Number(t.localId)?C.gold:C.border};background:#10101e;border-radius:8px;padding:8px;display:flex;gap:8px;align-items:center">
      <img data-unified-custom-ts-preview="${esc(t.localId)}" src="${isWebBuild()?'tilesets/TILESET_TEMPLATE.png?v='+APP_VERSION:'tilesets/TILESET_TEMPLATE.png'}" style="width:76px;height:76px;image-rendering:pixelated;border:1px solid #242440;background:#080812;object-fit:contain;border-radius:5px;flex-shrink:0">
      <div style="min-width:0;flex:1">
        <div style="font-weight:900;color:${C.gold};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">#${esc(t.localId)} · ${esc(t.name||t.safeName||'Custom Tileset')}</div>
        <div style="font-size:10px;color:${C.dim};margin-top:3px">Bank ${esc(t.graphicsBank)} · Animations ${customTilesetAnimationCount(t)}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">
          <button class="sbtn" data-use-unified-custom-ts="${esc(t.localId)}">Use</button>
          <button class="sbtn" data-edit-unified-custom-ts="${esc(t.localId)}">Edit</button>
          <button class="sbtn" data-duplicate-unified-custom-ts="${esc(t.localId)}">Duplicate</button>
          <button class="sbtn" data-upload-unified-custom-ts="${esc(t.localId)}">Upload PNG</button>
          <button class="sbtn" data-download-unified-custom-ts="${esc(t.localId)}">Download PNG</button>
          <button class="sbtn red" data-remove-unified-custom-ts="${esc(t.localId)}">Remove</button>
        </div>
      </div>
    </div>`).join(''):`<div style="color:${C.dim};font-size:12px;border:1px dashed ${C.border};border-radius:8px;padding:12px">Custom tileset editing is disabled in this static no-API pass.</div>`;

  showModal(`
    <div class="modal-title">🖼 Tilesets <span style="color:${C.dim};font-size:10px">built-ins and loose PNGs</span></div>
    <div class="modal-body" style="margin-bottom:10px">Choose a built-in tileset, upload a loose PNG for preview/editing, or download a bundled tileset PNG.</div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px">
      <label class="lbl" style="margin:0">Default tilesets</label>
      <button id="tileset-load-loose-png" class="sbtn" style="color:#80c0ff;border-color:#354575">Upload PNG</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px">
      ${builtins}
    </div>

    <button id="tileset-browser-close" class="sbtn" style="width:100%">Close</button>
  `);
  q('#tileset-browser-close').onclick=()=>closeModal('#modal-generic');
  q('#tileset-load-loose-png').onclick=()=>openLooseTilesetPng();

  document.querySelectorAll('[data-use-built-in-ts]').forEach(btn=>{btn.onclick=()=>{const id=parseInt(btn.dataset.useBuiltInTs)||0;const ts=BUNDLED_TILESETS.find(x=>Number(x.id)===id);if(ts){selectBundledTileset(ts);setPackStatus('Selected '+ts.name+' tileset');}closeModal('#modal-generic');};});
  document.querySelectorAll('[data-download-built-in-ts]').forEach(btn=>{btn.onclick=()=>{const id=parseInt(btn.dataset.downloadBuiltInTs)||0;const ts=BUNDLED_TILESETS.find(x=>Number(x.id)===id);if(ts)downloadTilesetPng({custom:false,id:ts.id,name:ts.name,file:ts.file});};});

  document.querySelectorAll('[data-unified-custom-ts-preview]').forEach(async img=>{try{const id=parseInt(img.dataset.unifiedCustomTsPreview)||0;const src=await window.electronAPI.getCustomTilesetImage(projectName,id);if(src)img.src=src;}catch{}});
  document.querySelectorAll('[data-use-unified-custom-ts]').forEach(btn=>{btn.onclick=async()=>{const id=parseInt(btn.dataset.useUnifiedCustomTs)||0;await selectCustomTileset(id);closeModal('#modal-generic');};});
  document.querySelectorAll('[data-edit-unified-custom-ts]').forEach(btn=>{btn.onclick=()=>{const id=parseInt(btn.dataset.editUnifiedCustomTs)||0;const t=(_customTilesetsCache||[]).find(x=>Number(x.localId)===id);if(t)showCustomTilesetEditor(t);};});
  document.querySelectorAll('[data-duplicate-unified-custom-ts]').forEach(btn=>{btn.onclick=()=>{const id=parseInt(btn.dataset.duplicateUnifiedCustomTs)||0;const t=(_customTilesetsCache||[]).find(x=>Number(x.localId)===id);if(t)duplicateCustomTilesetForEdit(t);};});
  document.querySelectorAll('[data-upload-unified-custom-ts]').forEach(btn=>{btn.onclick=()=>uploadCustomTilesetPngFromBrowser(parseInt(btn.dataset.uploadUnifiedCustomTs)||0);});
  document.querySelectorAll('[data-download-unified-custom-ts]').forEach(btn=>{btn.onclick=()=>{const id=parseInt(btn.dataset.downloadUnifiedCustomTs)||0;const t=(_customTilesetsCache||[]).find(x=>Number(x.localId)===id);if(t)downloadTilesetPng({custom:true,id:t.localId,name:t.name||t.safeName||('Custom '+t.localId)});};});
  document.querySelectorAll('[data-remove-unified-custom-ts]').forEach(btn=>{btn.onclick=async()=>{const id=parseInt(btn.dataset.removeUnifiedCustomTs)||0;const t=(_customTilesetsCache||[]).find(x=>Number(x.localId)===id);if(!t)return;if(!(await appConfirm('Remove custom tileset #'+id+' ('+(t.name||t.safeName||'Custom Tileset')+')?\n\nThis deletes its project custom tileset assets and regenerates the include files.',{title:'Remove custom tileset?',okText:'Remove',danger:true})))return;try{const r=await window.electronAPI.deleteCustomTileset(projectName,id);if(!r||!r.ok){await appAlert('Could not remove custom tileset.'+(r&&r.error?'\n'+r.error:''),{title:'Remove failed',danger:true});return;}await refreshCustomTilesetsCache();refreshTilesetSelectOptions();refreshTilesetDropdownMenu();setPackStatus('Removed custom tileset #'+id+' and regenerated ROM-side assets');showTilesetBrowserModal();}catch(err){console.error('Could not remove custom tileset',err);await appAlert('Could not remove custom tileset.\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Remove failed',danger:true});}};});
}

async function showCustomTilesetsModal(){
  return showTilesetBrowserModal();
  const projectName=(q("#project-name")?.value||"My Project").trim()||"My Project";
  try{
    await refreshCustomTilesetsCache();
  }catch(err){
    console.error("Could not refresh custom tilesets", err);
    _customTilesetsCache=[];
  }
  const rows=(_customTilesetsCache||[]).map(t=>`
    <div style="display:flex;gap:8px;align-items:center;border:1px solid ${C.border};background:#10101e;padding:8px;border-radius:6px;margin-bottom:6px">
      <img data-custom-ts-preview="${esc(t.localId)}" src="${isWebBuild()?'tilesets/TILESET_TEMPLATE.png?v='+APP_VERSION:'tilesets/TILESET_TEMPLATE.png'}" style="width:64px;height:64px;image-rendering:pixelated;border:1px solid ${C.border};background:#ff00ff;object-fit:contain">
      <div style="font-weight:900;color:${C.gold};min-width:44px">#${esc(t.localId)}</div>
      <div style="flex:1">
        <div style="font-weight:900">${esc(t.name||t.safeName||'Custom Tileset')}</div>
        <div style="font-size:10px;color:${C.dim}">Bank ${esc(t.graphicsBank)} · Entrance ${tileLabel(t.entranceMarker)} · Exit ${(t.goalMarkers||[]).map(x=>tileLabel(x)).join(', ')}</div>
        <div style="font-size:10px;color:${C.dim}">Animations: ${customTilesetAnimationCount(t)}</div>
      </div>
      <button class="sbtn" data-edit-custom-ts="${esc(t.localId)}">Edit</button>
      <button class="sbtn" data-use-custom-ts="${esc(t.localId)}">Use</button>
      <button class="sbtn red" data-remove-custom-ts="${esc(t.localId)}" title="Remove custom tileset">Remove</button>
    </div>`).join("") || `<div style="color:${C.dim};font-size:12px;margin-bottom:8px">Custom tileset editing is disabled in this static no-API pass.</div>`;
  showModal(`
    <div class="modal-title">🧩 Custom Tilesets <span style="color:${C.dim};font-size:10px">v${APP_VERSION}</span></div>
    <div class="modal-body">
      <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px">
        <img src="${isWebBuild()?'tilesets/TILESET_TEMPLATE.png?v='+APP_VERSION:'tilesets/TILESET_TEMPLATE.png'}" style="width:128px;height:128px;image-rendering:pixelated;border:1px solid ${C.border};background:#ff00ff">
        <div style="font-size:12px;line-height:1.5;color:${C.text}">
          <b>Custom tileset workflow</b><br>1. Import a tight indexed tileset PNG.<br>2. Click tiles to set entrance, exit, and behaviour.<br>3. Create or import animations.<br>4. Press Save to regenerate the ASM includes.
        </div>
      </div>
      ${rows}
      <input id="custom-ts-name" type="text" value="Grass Template" style="margin:8px 0" placeholder="Custom tileset name">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="custom-ts-create" class="sbtn green" style="flex:1">Create from Grass Template</button>
        <button id="custom-ts-close" class="sbtn" style="flex:1">Close</button>
      </div>
    </div>`);
  document.querySelectorAll('[data-custom-ts-preview]').forEach(async img=>{
    try{
      const id=parseInt(img.dataset.customTsPreview)||0;
      const src=await window.electronAPI.getCustomTilesetImage(projectName,id);
      if(src) img.src=src;
    }catch{}
  });
  q("#custom-ts-close").onclick=()=>closeModal("#modal-generic");
  q("#custom-ts-create").onclick=async()=>{
    const name=(q("#custom-ts-name")?.value||"Grass Template").trim()||"Grass Template";
    try{
      const r=await window.electronAPI.createTemplateTileset(projectName,name);
      if(!r||!r.ok){appAlert("Could not create custom tileset."+(r&&r.error?"\n"+r.error:""));return;}
      await refreshCustomTilesetsCache(); refreshTilesetSelectOptions(); refreshTilesetDropdownMenu(); showCustomTilesetsModal();
    }catch(err){
      console.error("Could not create custom tileset", err);
      appAlert("Could not create custom tileset.\n" + (err&&err.message ? err.message : String(err||"Unknown error")));
    }
  };
  document.querySelectorAll("[data-use-custom-ts]").forEach(btn=>{
    btn.onclick=()=>{
      const id=parseInt(btn.dataset.useCustomTs)||0;
      levelData.tileset=id;
      const sel=q("#lf-tileset_id"); if(sel){refreshTilesetSelectOptions();sel.value=String(id);}
      setPackStatus("Selected custom tileset #"+id);
      closeModal("#modal-generic");
    };
  });
  document.querySelectorAll("[data-remove-custom-ts]").forEach(btn=>{
    btn.onclick=async()=>{
      const id=parseInt(btn.dataset.removeCustomTs)||0;
      const t=(_customTilesetsCache||[]).find(x=>Number(x.localId)===id);
      if(!t) return;
      if(!(await appConfirm('Remove custom tileset #'+id+' ('+(t.name||t.safeName||'Custom Tileset')+')?\n\nThis deletes its project custom tileset assets and regenerates the include files.',{title:'Remove custom tileset?',okText:'Remove',danger:true}))) return;
      try{
        const r=await window.electronAPI.deleteCustomTileset(projectName,id);
        if(!r||!r.ok){appAlert('Could not remove custom tileset.'+(r&&r.error?'\n'+r.error:''));return;}
        await refreshCustomTilesetsCache(); refreshTilesetSelectOptions(); refreshTilesetDropdownMenu(); setPackStatus('Removed custom tileset #'+id+' and regenerated ROM-side assets'); showCustomTilesetsModal();
      }catch(err){ console.error('Could not remove custom tileset', err); appAlert('Could not remove custom tileset.\n'+(err&&err.message?err.message:String(err||'Unknown error'))); }
    };
  });
  document.querySelectorAll("[data-edit-custom-ts]").forEach(btn=>{
    btn.onclick=()=>{
      const id=parseInt(btn.dataset.editCustomTs)||0;
      const t=(_customTilesetsCache||[]).find(x=>Number(x.localId)===id);
      if(t) showCustomTilesetEditor(t);
    };
  });
}
function isWebBuild(){ return location.protocol==='http:' || location.protocol==='https:'; }
function tileLabel(n){ const v=Number(n)||0; return '$'+(v&255).toString(16).toUpperCase().padStart(2,'0')+' / '+(v&255); }
function customTilesetAnimationCount(t){
  return (Array.isArray(t&&t.animations)?t.animations:[]).filter(a=>a && !a.pending && (a.file || a.sourcePng || (Array.isArray(a.commands)&&a.commands.length))).length;
}
function cloneObj(o){ return JSON.parse(JSON.stringify(o||{})); }
const CUSTOM_TILESET_PROP_INFO={
  nonCollidable:{label:'Non-collidable'}, steel:{label:'Steel'}, water:{label:'Water'}, toxic:{label:'Toxic'}, oneWayRight:{label:'One-way right'}, oneWayLeft:{label:'One-way left'}
};
function parseTileNumber(s){ s=String(s||'').trim(); if(!s) return null; let v=null; if(/^\$[0-9a-f]+$/i.test(s)) v=parseInt(s.slice(1),16); else if(/^0x[0-9a-f]+$/i.test(s)) v=parseInt(s.slice(2),16); else if(/^[0-9a-f]{2}$/i.test(s)&&/[a-f]/i.test(s)) v=parseInt(s,16); else if(/^\d+$/.test(s)) v=parseInt(s,10); return Number.isFinite(v)?Math.max(0,Math.min(255,v|0)):null; }
function parseTileList(text){ const out=[]; for(const raw of String(text||'').split(/[\s,]+/)){ const part=raw.trim(); if(!part)continue; const m=part.match(/^(.+?)-(.+)$/); if(m){ const a=parseTileNumber(m[1]),b=parseTileNumber(m[2]); if(a!==null&&b!==null){ for(let i=Math.min(a,b);i<=Math.max(a,b);i++) out.push(i); } } else { const v=parseTileNumber(part); if(v!==null) out.push(v); } } return [...new Set(out.filter(v=>v>0&&v<256))].sort((a,b)=>a-b); }
function formatTileList(arr){ return (arr||[]).map(v=>'$'+(Number(v)&255).toString(16).toUpperCase().padStart(2,'0')).join(', '); }
function tileHasProp(t, prop, id){ return ((t.properties&&t.properties[prop])||[]).map(Number).includes(Number(id)); }
function toggleTileProp(t, prop, id, force){ t.properties=t.properties||{}; const set=new Set((t.properties[prop]||[]).map(Number)); if(force===true)set.add(id); else if(force===false)set.delete(id); else set.has(id)?set.delete(id):set.add(id); set.delete(0); t.properties[prop]=[...set].sort((a,b)=>a-b); }


async function showCustomTilesetEditor(original){
  const projectName=(q("#project-name")?.value||"My Project").trim()||"My Project";
  const t=cloneObj(original);
  t.properties=t.properties||{};
  const propOrder=['nonCollidable','steel','water','toxic','oneWayRight','oneWayLeft'];
  const propNames={nonCollidable:'Empty / decorative',steel:'Steel',water:'Water',toxic:'Fire / acid',oneWayRight:'One-way right',oneWayLeft:'One-way left'};
  const propColours={nonCollidable:'#66ccff',steel:'#eeeeee',water:'#3388ff',toxic:'#ff6633',oneWayRight:'#66ff66',oneWayLeft:'#ff66ff'};
  for(const p of propOrder) if(!Array.isArray(t.properties[p])) t.properties[p]=[];

  let imgSrc=null; try{ imgSrc=await window.electronAPI.getCustomTilesetImage(projectName,t.localId); }catch{}
  if(!imgSrc) imgSrc=isWebBuild()?'tilesets/TILESET_TEMPLATE.png?v='+APP_VERSION:'tilesets/TILESET_TEMPLATE.png';

  let selectedTile=0, selectedProperty='nonCollidable', markerMode=null, isDirty=false, isSaving=false;

  function hasProp(id,p){return Array.isArray(t.properties[p])&&t.properties[p].includes(id);}
  function setProp(id,p,on){t.properties[p]=Array.isArray(t.properties[p])?t.properties[p]:[];const has=t.properties[p].includes(id);if(on&&!has)t.properties[p].push(id);if(!on&&has)t.properties[p]=t.properties[p].filter(x=>x!==id);t.properties[p].sort((a,b)=>a-b);}
  function propList(p){return (t.properties[p]||[]).map(tileLabel).join(' ');}
  function markDirty(){isDirty=true;updateStatus();}
  function updateStatus(){const s=q('#ct-save-status');if(!s)return;s.textContent=isSaving?'Saving…':(isDirty?'Unsaved changes.':'Saved.');s.style.color=isDirty?C.gold:C.dim;}

  const propTabs=propOrder.map(p=>`<button class="sbtn ct-prop-tab" data-prop="${p}" style="border-color:${propColours[p]};color:${propColours[p]}">${propNames[p]}</button>`).join('');
  const animCount=customTilesetAnimationCount(t);

  showModal(`
    <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>🧩 Custom Tileset #${esc(t.localId)} <span style="color:${C.dim};font-size:10px">Bank ${esc(t.graphicsBank)}</span></span>
      <button id="ct-back" class="sbtn">Back</button>
    </div>
    <div class="modal-body" style="max-width:1240px">
      <div style="display:grid;grid-template-columns:540px minmax(420px,1fr);gap:16px;align-items:start">
        <div>
          <div id="ct-grid" style="position:relative;width:512px;height:512px;background-color:#ff00ff;background-position:0 0;background-size:512px 512px;background-repeat:no-repeat;image-rendering:pixelated;border:1px solid ${C.border};box-shadow:0 0 0 2px #05050a inset"></div>
          <div style="font-size:10px;color:${C.dim};margin-top:7px;line-height:1.45">Entrance and exit artwork must stay separated exactly like the template, otherwise the game cannot find the marker tiles reliably.</div>
          <div id="ct-selected" style="font-size:11px;color:${C.gold};margin-top:6px"></div>
        </div>
        <div>
          <label style="font-size:10px;color:${C.dim}">Tileset name</label>
          <input id="ct-edit-name" type="text" value="${esc(t.name||t.safeName||'Custom Tileset')}" style="width:100%;margin-bottom:8px">

          <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
            <button id="ct-import-png" class="sbtn">Upload Tileset PNG</button>
            <button id="ct-pick-entrance" class="sbtn">Pick entrance</button>
            <button id="ct-pick-exit" class="sbtn">Pick exit</button>
            <button id="ct-open-animation-manager" class="sbtn green">Animations (${animCount})</button>
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${propTabs}</div>
          <div id="ct-prop-panel" style="border:1px solid ${C.border};background:#10101e;padding:8px;border-radius:6px;margin-bottom:8px"></div>

          <div style="display:flex;gap:8px;margin-top:10px">
            <button id="ct-save" class="sbtn green" style="flex:2;font-size:13px;padding:8px 12px">Save changes</button>
            <button id="ct-cancel" class="sbtn" style="flex:1">Cancel</button>
          </div>
          <div id="ct-save-status" style="font-size:10px;color:${C.dim};margin-top:7px">Saved.</div>
        </div>
      </div>
    </div>`);

  const grid=q('#ct-grid'); if(grid) grid.style.backgroundImage=`url("${String(imgSrc).replace(/"/g,'%22')}")`;

  function renderTabs(){document.querySelectorAll('.ct-prop-tab').forEach(btn=>{const on=btn.dataset.prop===selectedProperty;btn.style.background=on?(propColours[btn.dataset.prop]||C.gold):'#252540';btn.style.color=on?'#05050a':(propColours[btn.dataset.prop]||C.text);});}
  function renderGrid(){
    if(!grid)return;
    grid.querySelectorAll('.ct-cell').forEach(n=>n.remove());
    for(let id=0;id<256;id++){
      const x=id%16,y=Math.floor(id/16);
      const cell=document.createElement('button');cell.className='ct-cell';cell.dataset.tile=id;cell.title='Tile '+tileLabel(id);
      cell.style.cssText=`position:absolute;left:${x*32}px;top:${y*32}px;width:32px;height:32px;background:transparent;border:1px solid rgba(255,255,255,.14);padding:0;cursor:pointer`;
      const marks=[];for(const p of propOrder)if(hasProp(id,p))marks.push(propColours[p]);
      if(marks.length)cell.style.boxShadow=marks.map((c,i)=>`inset 0 0 0 ${2+i*2}px ${c}`).join(',');
      if(id===selectedTile)cell.style.outline='2px solid '+C.gold;
      if(id===Number(t.entranceMarker))cell.style.border='2px solid #00ff66';
      if((t.goalMarkers||[]).includes(id))cell.style.border='2px solid #ffcc33';
      cell.onclick=()=>{
        selectedTile=id;
        if(markerMode==='entrance'){t.entranceMarker=id;markerMode=null;markDirty();}
        else if(markerMode==='exit'){t.goalMarkers=[id,0];markerMode=null;markDirty();}
        else{setProp(id,selectedProperty,!hasProp(id,selectedProperty));markDirty();}
        renderGrid();renderPanel();
      };
      grid.appendChild(cell);
    }
  }
  function renderPanel(){
    const sel=q('#ct-selected');if(sel)sel.textContent='Selected tile: '+tileLabel(selectedTile)+' / '+selectedTile;
    const p=selectedProperty, box=q('#ct-prop-panel'); if(!box)return;
    box.innerHTML=`
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px">
        <div><b style="color:${propColours[p]}">${propNames[p]}</b><div style="font-size:10px;color:${C.dim}">Click tiles to toggle this property. Coloured borders show assigned tiles.</div></div>
        <button id="ct-toggle-current" class="sbtn">${hasProp(selectedTile,p)?'Remove selected':'Add selected'}</button>
      </div>
      <div style="font-size:10px;color:${C.dim};margin-bottom:5px">Entrance: ${tileLabel(t.entranceMarker)} · Exit: ${(t.goalMarkers||[]).map(tileLabel).join(', ')}</div>
      <textarea id="ct-prop-list" spellcheck="false" style="width:100%;min-height:54px;background:#05050a;color:${C.text};border:1px solid ${C.border};border-radius:4px;padding:6px;font-family:monospace;font-size:11px">${esc(propList(p))}</textarea>`;
    const tog=q('#ct-toggle-current');if(tog)tog.onclick=()=>{setProp(selectedTile,p,!hasProp(selectedTile,p));markDirty();renderGrid();renderPanel();};
    const list=q('#ct-prop-list');if(list){
      list.removeAttribute('readonly');
      list.removeAttribute('disabled');
      list.style.pointerEvents='auto';
      list.style.userSelect='text';
      list.style.webkitUserSelect='text';
      ['keydown','keypress','keyup','beforeinput','input','mousedown','mouseup','click','dblclick','selectstart','paste','copy','cut'].forEach(type=>{
        list.addEventListener(type,ev=>ev.stopPropagation(),true);
      });
      list.oninput=()=>{isDirty=true;updateStatus();};
      list.onchange=()=>{t.properties[p]=parseTileList(list.value);markDirty();renderGrid();renderPanel();};
    }
  }
  async function saveEditor(){
    if(isSaving)return;
    try{
      isSaving=true;updateStatus();
      const list=q('#ct-prop-list');if(list)t.properties[selectedProperty]=parseTileList(list.value);
      const patch={name:(q('#ct-edit-name')?.value||t.name||'Custom Tileset').trim(),entranceMarker:t.entranceMarker,goalMarkers:t.goalMarkers||[0,0],properties:t.properties};
      const r=await window.electronAPI.updateCustomTileset(projectName,t.localId,patch);
      if(!r||!r.ok){appAlert('Could not save custom tileset.'+(r&&r.error?'\n'+r.error:''));return;}
      Object.assign(t,r.tileset||{});
      t.properties=t.properties||{};
      for(const p of propOrder) if(!Array.isArray(t.properties[p])) t.properties[p]=[];
      isDirty=false;
      await refreshCustomTilesetsCache();
      refreshTilesetSelectOptions();
      renderTabs();
      renderGrid();
      renderPanel();
      setPackStatus('Saved custom tileset #'+t.localId);
      updateStatus();
    }catch(err){appAlert('Could not save custom tileset.\n'+(err&&err.message?err.message:String(err||'Unknown error')));}
    finally{isSaving=false;updateStatus();}
  }

  document.querySelectorAll('.ct-prop-tab').forEach(btn=>btn.onclick=()=>{selectedProperty=btn.dataset.prop;renderTabs();renderPanel();});
  const ctNameInput=q('#ct-edit-name');
  if(ctNameInput){
    ctNameInput.removeAttribute('readonly');
    ctNameInput.removeAttribute('disabled');
    ctNameInput.style.pointerEvents='auto';
    ctNameInput.style.userSelect='text';
    ctNameInput.style.webkitUserSelect='text';
    ['keydown','keypress','keyup','beforeinput','input','mousedown','mouseup','click','dblclick','selectstart','paste','copy','cut'].forEach(type=>{
      ctNameInput.addEventListener(type,ev=>ev.stopPropagation(),true);
    });
    ctNameInput.oninput=()=>markDirty();
  }
  q('#ct-pick-entrance').onclick=()=>{markerMode='entrance';setPackStatus('Click the entrance marker tile.');};
  q('#ct-pick-exit').onclick=()=>{markerMode='exit';setPackStatus('Click the exit anchor tile.');};
  q('#ct-save').onclick=saveEditor;
  const customTilesetEditorBack=()=>{const btn=q('#ct-back');if(btn)btn.click();else showCustomTilesetsModal();};
  setPanelEscapeBackHandler(customTilesetEditorBack);
  q('#ct-back').onclick=async()=>{if(isDirty&&!(await appConfirm('Discard unsaved changes?',{title:'Discard changes?',okText:'Discard',danger:true})))return;showCustomTilesetsModal();};
  q('#ct-cancel').onclick=async()=>{if(isDirty&&!(await appConfirm('Discard unsaved changes?',{title:'Discard changes?',okText:'Discard',danger:true})))return;showCustomTilesetsModal();};
  q('#ct-open-animation-manager').onclick=async()=>{if(isDirty)await saveEditor();await refreshCustomTilesetsCache();const fresh=(_customTilesetsCache||[]).find(x=>Number(x.localId)===Number(t.localId))||t;showCustomTilesetAnimationManager(fresh);};
  q('#ct-import-png').onclick=async()=>{
    try{
      if(isDirty)await saveEditor();
      const r=await window.electronAPI.importCustomTilesetPng(projectName,t.localId);
      if(!r||r.cancelled)return;
      if(!r.ok){appAlert('Could not upload PNG.\n'+(r.error||'Unknown error'));return;}
      await refreshCustomTilesetsCache();setPackStatus('Uploaded tileset PNG.');const fresh=(_customTilesetsCache||[]).find(x=>Number(x.localId)===Number(t.localId))||t;showCustomTilesetEditor(fresh);
    }catch(err){appAlert('Could not upload PNG.\n'+(err&&err.message?err.message:String(err||'Unknown error')));}
  };

  renderTabs();renderGrid();renderPanel();updateStatus();
}

async function showCustomTilesetAnimationManager(original){
  const projectName=(q("#project-name")?.value||"My Project").trim()||"My Project";
  const t=cloneObj(original);
  let imgSrc=null; try{ imgSrc=await window.electronAPI.getCustomTilesetImage(projectName,t.localId); }catch{}
  if(!imgSrc) imgSrc=isWebBuild()?'tilesets/TILESET_TEMPLATE.png?v='+APP_VERSION:'tilesets/TILESET_TEMPLATE.png';

  function savedAnimationRefs(){
    return (Array.isArray(t.animations)?t.animations:[])
      .map((a,index)=>({a,index}))
      .filter(ref=>ref.a && !ref.a.pending && (ref.a.file || ref.a.sourcePng || (Array.isArray(ref.a.commands)&&ref.a.commands.length)));
  }
  function animationLabel(label, idx){
    let s=String(label||'').trim();
    s=s.replace(/^AnimFrames[_\s-]*/i,'').replace(/[_]+/g,' ').replace(/\s+/g,' ').trim();
    s=s.replace(/\bAnim(ation)?\s*$/i,'').trim();
    if(!s || /^custom$/i.test(s)) s='Animation '+String((idx||0)+1);
    return s;
  }
  function refreshAnimationRefs(){
    animationRefs=savedAnimationRefs();
    if(selectedIndex>=0 && !animationRefs.some(ref=>ref.index===selectedIndex)) selectedIndex=animationRefs.length?animationRefs[0].index:-1;
  }
  function selectedAnimation(){ return selectedIndex>=0 && Array.isArray(t.animations) ? t.animations[selectedIndex] : null; }

  let animationRefs=savedAnimationRefs();
  let selectedIndex=animationRefs.length?animationRefs[0].index:-1;
  let selectedPng={filePath:null,filename:null,dataUrl:null,img:null};
  let previewFrame=0, previewTimer=null, formDirty=false;

  const fallback={label:`Animation ${animationRefs.length+1}`,startTiles:'$A0',widthTiles:2,heightTiles:1,frameCount:3,sequence:'0,1,2',mode:'ONE_PER_TILE'};
  const draft=Object.assign({},fallback,t.animationDraft||{});
  draft.label=animationLabel(draft.label,animationRefs.length);

  function friendlyMode(mode){return ({AUTO:'Auto (recommended)',ONE_TILE:'Single tile',FOUR_TILES:'4 tiles, 5-step loop',FOUR_TILES_TRUE4:'4 tiles, 4-frame loop',SIX_TILES:'6 tiles, 4-frame loop',ONE_PER_TILE:'Any size, each tile'})[mode]||mode||'Auto (recommended)';}
  function startsFromText(txt){return String(txt||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.startsWith('$')?parseInt(x.slice(1),16):parseInt(x,10)).filter(n=>Number.isFinite(n));}
  function formData(){return {label:(q('#am-name')?.value||'Animation').trim(),startTiles:(q('#am-start')?.value||'$00').trim(),widthTiles:Math.max(1,parseInt(q('#am-w')?.value||'1',10)||1),heightTiles:Math.max(1,parseInt(q('#am-h')?.value||'1',10)||1),frameCount:Math.max(1,parseInt(q('#am-frames')?.value||'1',10)||1),sequence:(q('#am-seq')?.value||'0').trim(),mode:(q('#am-mode')?.value||'AUTO').trim()};}
  function highlightedTiles(){const d=formData(),out=[];for(const s of startsFromText(d.startTiles))for(let i=0;i<d.widthTiles*d.heightTiles;i++)out.push(s+i);return new Set(out);}
  function expectedPngText(){const d=formData();return `${d.widthTiles*8}×${d.heightTiles*d.frameCount*8}px minimum`;}
  function pngDimensionWarning(){
    if(!selectedPng.img)return '';
    const d=formData(), expectedW=d.widthTiles*8, expectedH=d.heightTiles*d.frameCount*8;
    const w=selectedPng.img.naturalWidth||0, h=selectedPng.img.naturalHeight||0;
    if(w%8!==0 || h%8!==0) return `PNG is ${w}×${h}px. Width and height must be multiples of 8.`;
    if(w<expectedW || h<expectedH) return `PNG is ${w}×${h}px. Current parameters need at least ${expectedW}×${expectedH}px. Adjust Width, Height, or Frames, then Save Animation.`;
    return '';
  }
  function updateSaveButtons(){
    const a=selectedAnimation();
    const pngBtn=q('#am-png'), saveBtn=q('#am-apply-png'), delBtn=q('#am-delete');
    if(pngBtn)pngBtn.textContent=a&&a.sourcePng?'Replace PNG':'Upload PNG';
    if(saveBtn)saveBtn.textContent='Save Animation';
    if(delBtn)delBtn.style.display=a?'':'none';
  }
  function animationCards(){
    refreshAnimationRefs();
    const saved=animationRefs.map((ref,shownIdx)=>{const a=ref.a,idx=ref.index;const starts=(Array.isArray(a.startTiles)?a.startTiles:[]).map(tileLabel).join(', ')||'not set';const active=idx===selectedIndex;const title=animationLabel(a.label,shownIdx);return `<button class="am-card" data-am-select="${idx}" style="display:block;width:100%;text-align:left;border:1px solid ${active?C.gold:C.border};background:${active?'#20203a':'#10101e'};border-radius:8px;padding:9px;margin-bottom:8px;color:${C.text};cursor:pointer;overflow:hidden"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%" title="${esc(title)}">${esc(title)}</b><div style="font-size:10px;color:${C.dim};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%" title="${esc(friendlyMode(a.mode))} · ${esc(a.widthTiles||'?')}×${esc(a.heightTiles||'?')} · ${esc(a.frameCount||'?')} frame(s) · ${esc(starts)}">${esc(friendlyMode(a.mode))} · ${esc(a.widthTiles||'?')}×${esc(a.heightTiles||'?')} · ${esc(a.frameCount||'?')} frame(s) · ${esc(starts)}</div></button>`;}).join('');
    const d = (()=>{try{return formData();}catch{return draft;}})();
    const newCard = selectedIndex<0 ? `<button class="am-card" data-am-new-draft="1" style="display:block;width:100%;text-align:left;border:1px solid ${C.gold};background:#20203a;border-radius:8px;padding:9px;margin-bottom:8px;color:${C.text};cursor:pointer;overflow:hidden"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">New animation</b><div style="font-size:10px;color:${C.dim};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%" title="${esc(friendlyMode(d.mode))} · ${esc(d.widthTiles||'?')}×${esc(d.heightTiles||'?')} · ${esc(d.frameCount||'?')} frame(s) · ${esc(d.startTiles||'not set')}">${esc(friendlyMode(d.mode))} · ${esc(d.widthTiles||'?')}×${esc(d.heightTiles||'?')} · ${esc(d.frameCount||'?')} frame(s) · ${esc(d.startTiles||'not set')}</div></button>` : '';
    return (saved + newCard) || `<div style="border:1px dashed ${C.border};border-radius:8px;padding:12px;background:#080812;color:${C.dim};font-size:11px">No animations yet. Press New, upload a PNG, adjust the parameters, then Save Animation.</div>`;
  }

  showModal(`
    <div class="modal-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <span>🎞️ Animation Manager: ${esc(t.name||t.safeName||'Custom Tileset')}</span>
      <button id="am-back" class="sbtn">Back to tileset</button>
    </div>
    <div class="modal-body" style="max-width:1180px">
      <div style="display:grid;grid-template-columns:340px 360px minmax(320px,1fr);gap:14px;align-items:start">
        <div>
          <div id="am-grid" style="position:relative;width:320px;height:320px;background-color:#ff00ff;background-position:0 0;background-size:320px 320px;background-repeat:no-repeat;image-rendering:pixelated;border:1px solid ${C.border};box-shadow:0 0 0 2px #05050a inset"></div>
          <div style="font-size:10px;color:${C.dim};margin-top:7px">Highlighted tiles are used by the current animation. Click the tilesheet to change the first tile.</div>
        </div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:8px"><b style="color:${C.gold};font-size:13px">Animations</b><span style="display:flex;gap:6px"><button id="am-clear-all" class="sbtn red" title="Clear every animated tile entry for this custom tileset">Clear All Animations</button><button id="am-new" class="sbtn">New</button></span></div>
          <div id="am-list">${animationCards()}</div>
        </div>
        <div style="border:1px solid ${C.border};background:#0c0c16;border-radius:8px;padding:10px">
          <div id="am-edit-title" style="font-weight:900;color:${C.gold};margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">Animation</div>
          <div style="font-size:10px;color:${C.dim};line-height:1.45;margin-bottom:8px">Workflow: upload a PNG, adjust the parameters until the preview looks right, then Save Animation. Existing animations can reuse the saved PNG or replace it.</div>
          <label style="font-size:10px;color:${C.dim}">Animation name</label><input id="am-name" type="text" style="width:100%;margin-bottom:6px">
          <label style="font-size:10px;color:${C.dim}">Start tile(s)</label><input id="am-start" type="text" style="width:100%;margin-bottom:6px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <label style="font-size:10px;color:${C.dim}">Width in tiles<input id="am-w" type="text" style="width:100%"></label>
            <label style="font-size:10px;color:${C.dim}">Height in tiles<input id="am-h" type="text" style="width:100%"></label>
            <label style="font-size:10px;color:${C.dim}">Frames<input id="am-frames" type="text" style="width:100%"></label>
            <label style="font-size:10px;color:${C.dim}">Frame order<input id="am-seq" type="text" style="width:100%"></label>
          </div>
          <label style="font-size:10px;color:${C.dim};display:block;margin-top:6px">Animation type</label>
          <select id="am-mode" style="width:100%;margin-bottom:8px">
            <option value="AUTO">Auto (recommended)</option><option value="ONE_TILE">Single tile</option><option value="FOUR_TILES">4 tiles, 5-step loop</option><option value="FOUR_TILES_TRUE4">4 tiles, 4-frame loop</option><option value="SIX_TILES">6 tiles, 4-frame loop</option><option value="ONE_PER_TILE">Any size, each tile</option>
          </select>
          <div id="am-dim-hint" style="font-size:10px;color:${C.dim};margin-bottom:8px">PNG needed: ${esc(expectedPngText())}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
            <button id="am-png" class="sbtn" style="flex:1">Upload PNG</button>
            <button id="am-apply-png" class="sbtn green" style="flex:1">Save Animation</button>
            <button id="am-delete" class="sbtn red" style="flex:1">Remove</button>
          </div>
          <div id="am-status" style="font-size:10px;color:${C.dim};margin-bottom:8px">Ready.</div>
          <div id="am-preview-box" style="display:none;border:1px solid ${C.border};background:#05050a;border-radius:8px;padding:8px">
            <div id="am-preview-name" style="font-size:10px;color:${C.dim};margin-bottom:5px">No PNG selected.</div>
            <canvas id="am-preview-canvas" width="256" height="96" style="image-rendering:pixelated;background:#ff00ff;border:1px solid ${C.border};max-width:100%"></canvas>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:6px">
              <span id="am-preview-frame" style="font-size:10px;color:${C.dim}">Frame 0</span>
              <span style="display:flex;gap:4px"><button id="am-prev" class="sbtn" style="font-size:10px">Prev</button><button id="am-play" class="sbtn" style="font-size:10px">Play</button><button id="am-next" class="sbtn" style="font-size:10px">Next</button></span>
            </div>
          </div>
        </div>
      </div>
    </div>`);

  const grid=q('#am-grid'); if(grid) grid.style.backgroundImage=`url("${String(imgSrc).replace(/"/g,'%22')}")`;
  function setStatus(msg,warn=false){const s=q('#am-status');if(s){s.textContent=msg;s.style.color=warn?C.gold:C.dim;}}
  function updateDimHint(){const h=q('#am-dim-hint');if(h)h.textContent='PNG needed: '+expectedPngText();}
  function protect(){
    ['am-name','am-start','am-w','am-h','am-frames','am-seq','am-mode'].forEach(id=>{
      const el=q('#'+id);if(!el)return;
      el.removeAttribute('readonly'); el.removeAttribute('disabled'); el.disabled=false; el.readOnly=false; el.style.pointerEvents='auto'; el.style.userSelect='text'; el.style.webkitUserSelect='text'; el.tabIndex=0;
      if(!el.dataset.amProtected){['keydown','keypress','keyup','beforeinput','input','mousedown','mouseup','click','dblclick','selectstart','paste','copy','cut'].forEach(type=>el.addEventListener(type,ev=>ev.stopPropagation(),true));el.dataset.amProtected='1';}
      el.oninput=()=>{formDirty=true;updateDimHint();renderTiles();renderPreview();const warn=pngDimensionWarning();setStatus(warn||'Unsaved animation changes. Press Save Animation when the preview looks right.',!!warn||true);};
      el.onchange=()=>{formDirty=true;updateDimHint();renderTiles();renderPreview();const warn=pngDimensionWarning();setStatus(warn||'Unsaved animation changes. Press Save Animation when the preview looks right.',!!warn||true);};
    });
  }
  function keepAnimationFormEditable(){protect();setTimeout(()=>protect(),0);}
  function fill(a){
    if(a){q('#am-name').value=animationLabel(a.label,selectedIndex);q('#am-start').value=Array.isArray(a.startTiles)?a.startTiles.map(tileLabel).join(','):'$00';q('#am-w').value=a.widthTiles||1;q('#am-h').value=a.heightTiles||1;q('#am-frames').value=a.frameCount||1;q('#am-seq').value=Array.isArray(a.sequence)?a.sequence.join(','):(a.sequence||'0');q('#am-mode').value=a.mode||'AUTO';q('#am-edit-title').textContent='Editing: '+animationLabel(a.label,selectedIndex);}
    else{q('#am-name').value=draft.label;q('#am-start').value=draft.startTiles;q('#am-w').value=draft.widthTiles;q('#am-h').value=draft.heightTiles;q('#am-frames').value=draft.frameCount;q('#am-seq').value=draft.sequence;q('#am-mode').value=draft.mode;q('#am-edit-title').textContent='New animation';}
    formDirty=false;selectedPng={filePath:null,filename:null,dataUrl:null,img:null};const box=q('#am-preview-box');if(box)box.style.display='none';updateDimHint();updateSaveButtons();renderTiles();protect();setStatus(a?'Edit parameters, replace the PNG if needed, then Save Animation.':'Upload a PNG, adjust the parameters, then Save Animation.');
  }
  function newAnimationDefaults(){
    const n=savedAnimationRefs().length+1;
    return {label:`Animation ${n}`,startTiles:draft.startTiles||'$A0',widthTiles:draft.widthTiles||2,heightTiles:draft.heightTiles||1,frameCount:draft.frameCount||3,sequence:draft.sequence||'0,1,2',mode:draft.mode||'ONE_PER_TILE'};
  }
  function startNewAnimation(){
    selectedIndex=-1;
    const nd=newAnimationDefaults();
    q('#am-name').value=nd.label;q('#am-start').value=nd.startTiles;q('#am-w').value=nd.widthTiles;q('#am-h').value=nd.heightTiles;q('#am-frames').value=nd.frameCount;q('#am-seq').value=nd.sequence;q('#am-mode').value=nd.mode;q('#am-edit-title').textContent='New animation';
    formDirty=false;selectedPng={filePath:null,filename:null,dataUrl:null,img:null};const box=q('#am-preview-box');if(box)box.style.display='none';updateDimHint();updateSaveButtons();renderTiles();protect();setStatus('Upload a PNG first, then adjust the parameters and Save Animation.');renderList();
  }
  async function confirmDiscardIfNeeded(){
    if(!formDirty && !selectedPng.filePath)return true;
    return await appConfirm('Discard unsaved animation changes?',{title:'Unsaved animation',okText:'Discard',danger:true});
  }
  function renderList(){
    const list=q('#am-list');if(list)list.innerHTML=animationCards();
    document.querySelectorAll('[data-am-select]').forEach(btn=>btn.onclick=async()=>{if(!(await confirmDiscardIfNeeded()))return;selectedIndex=parseInt(btn.dataset.amSelect,10);fill(selectedAnimation());renderList();});
    const draftBtn=q('[data-am-new-draft]'); if(draftBtn) draftBtn.onclick=()=>{selectedIndex=-1;renderList();};
    updateSaveButtons();
  }
  function renderTiles(){if(!grid)return;grid.querySelectorAll('.am-cell').forEach(n=>n.remove());const hi=highlightedTiles();for(let id=0;id<256;id++){const x=id%16,y=Math.floor(id/16);const cell=document.createElement('button');cell.className='am-cell';cell.style.cssText=`position:absolute;left:${x*20}px;top:${y*20}px;width:20px;height:20px;background:transparent;border:1px solid rgba(255,255,255,.10);padding:0;cursor:pointer`;if(hi.has(id))cell.style.boxShadow='inset 0 0 0 3px '+C.gold+', inset 0 0 0 5px #000';cell.onclick=()=>{q('#am-start').value=tileLabel(id);formDirty=true;updateDimHint();setStatus('Start tile changed. Press Save Animation when ready.',true);renderTiles();renderPreview();};grid.appendChild(cell);}}
  function renderPreview(){const box=q('#am-preview-box'),canvas=q('#am-preview-canvas'),name=q('#am-preview-name'),ft=q('#am-preview-frame');if(!box||!canvas)return;updateDimHint();if(!selectedPng.img){return;}const d=formData(),fw=d.widthTiles*8,fh=d.heightTiles*8,fc=d.frameCount;previewFrame=((previewFrame%fc)+fc)%fc;box.style.display='block';const actualW=selectedPng.img.naturalWidth||0,actualH=selectedPng.img.naturalHeight||0;if(name)name.textContent=(selectedPng.filename||'animation.png')+' · PNG '+actualW+'×'+actualH+'px · using '+d.widthTiles+'×'+d.heightTiles+' tile(s), '+d.frameCount+' frame(s)';const ctx=canvas.getContext('2d');const scale=Math.max(1,Math.floor(Math.min(8,240/Math.max(fw,fh))));canvas.width=fw*scale;canvas.height=fh*scale;ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);try{ctx.drawImage(selectedPng.img,0,previewFrame*fh,fw,fh,0,0,fw*scale,fh*scale);}catch{}if(ft)ft.textContent='Frame '+previewFrame+' of '+(fc-1);const warn=pngDimensionWarning();setStatus(warn||'Preview loaded. Fiddle with the parameters, then Save Animation.',!!warn);}
  function stepPreview(d){previewFrame+=d;renderPreview();}
  function stopPreview(){if(previewTimer)clearInterval(previewTimer);previewTimer=null;const b=q('#am-play');if(b)b.textContent='Play';}
  async function saveAnimation(){
    const d=formData();
    const current=selectedAnimation();
    const warn=pngDimensionWarning();
    if(warn){setStatus(warn,true);return;}
    if(selectedPng.filePath){
      if(selectedIndex>=0)d.replaceAnimationIndex=selectedIndex;
      d.filePath=selectedPng.filePath;
      const r=await window.electronAPI.importCustomAnimationPng(projectName,t.localId,d);
      if(!r||r.cancelled)return false;
      if(!r.ok){await appAlert('Could not save animation.\n'+(r.error||'Unknown error'),{title:'Animation save failed',danger:true});return false;}
      Object.assign(t,r.tileset||{});
      refreshAnimationRefs();
      selectedIndex=Number.isInteger(Number(r.animationIndex))?Number(r.animationIndex):(Number.isInteger(Number(r.replacedIndex))&&Number(r.replacedIndex)>=0?Number(r.replacedIndex):(animationRefs.length?animationRefs[animationRefs.length-1].index:-1));
      formDirty=false;selectedPng={filePath:null,filename:null,dataUrl:null,img:null};
      await refreshCustomTilesetsCache();
      fill(selectedAnimation());renderList();setPackStatus('Saved animation and regenerated includes.');setStatus('Animation saved.');return true;
    }
    if(current){
      const r=await window.electronAPI.updateCustomAnimation(projectName,t.localId,selectedIndex,d);
      if(!r||!r.ok){await appAlert('Could not save animation.\n'+(r&&r.error?r.error:'Unknown error'),{title:'Animation save failed',danger:true});return false;}
      Object.assign(t,r.tileset||{});
      refreshAnimationRefs();
      selectedIndex=Number.isInteger(Number(r.animationIndex))?Number(r.animationIndex):selectedIndex;
      formDirty=false;
      await refreshCustomTilesetsCache();
      fill(selectedAnimation());renderList();setPackStatus('Updated animation parameters.');setStatus('Animation saved.');return true;
    }
    await appAlert('Upload a PNG before saving this new animation.\n\nOnce the preview looks right, press Save Animation.',{title:'Upload PNG first'});
    return false;
  }

  protect();if(selectedIndex>=0){fill(selectedAnimation());renderList();}else{startNewAnimation();}
  const animationManagerBack=()=>{const btn=q('#am-back');if(btn)btn.click();else showCustomTilesetEditor(t);};
  setPanelEscapeBackHandler(animationManagerBack);
  q('#am-back').onclick=async()=>{if(!(await confirmDiscardIfNeeded()))return;await refreshCustomTilesetsCache();const fresh=(_customTilesetsCache||[]).find(x=>Number(x.localId)===Number(t.localId))||t;showCustomTilesetEditor(fresh);};
  q('#am-new').onclick=async()=>{if(!(await confirmDiscardIfNeeded()))return;startNewAnimation();};
  q('#am-clear-all').onclick=async()=>{
    if(!Array.isArray(t.animations)||!t.animations.length){selectedIndex=-1;formDirty=false;startNewAnimation();setStatus('No animated tiles are enabled for this tileset. Builds will generate an empty animation script.',false);return;}
    const ok=await appConfirm('Remove all animations from this custom tileset?\n\nThis will regenerate the tileset with no animated tiles.',{title:'Clear all animations?',okText:'Clear All',danger:true});
    if(!ok){keepAnimationFormEditable();return;}
    try{
      for(let i=(t.animations||[]).length-1;i>=0;i--){
        const r=await window.electronAPI.removeCustomAnimation(projectName,t.localId,i);
        if(!r||!r.ok) throw new Error((r&&r.error)||'Could not remove animation '+(i+1));
        if(r.tileset) Object.assign(t,r.tileset);
      }
      t.animations=[];selectedIndex=-1;formDirty=false;selectedPng={filePath:null,filename:null,dataUrl:null,img:null};
      await refreshCustomTilesetsCache();renderList();startNewAnimation();setPackStatus('Custom tileset now has no animated tiles.');setStatus('No animated tiles are enabled for this tileset. Builds will generate an empty animation script.',false);
    }catch(err){await appAlert('Could not clear animations.\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Clear failed',danger:true});keepAnimationFormEditable();}
  };
  q('#am-png').onclick=async()=>{const r=await window.electronAPI.previewCustomAnimationPng(projectName,t.localId);if(!r||r.cancelled)return;if(!r.ok){await appAlert('Could not open PNG.'+(r&&r.error?'\n'+r.error:''),{title:'PNG failed',danger:true});return;}selectedPng={filePath:r.filePath,filename:r.filename,dataUrl:r.dataUrl,img:null};previewFrame=0;const img=new Image();img.onload=()=>{selectedPng.img=img;formDirty=true;renderPreview();updateSaveButtons();};img.onerror=()=>appAlert('Could not preview PNG.',{title:'PNG failed',danger:true});img.src=r.dataUrl;};
  q('#am-prev').onclick=()=>stepPreview(-1);q('#am-next').onclick=()=>stepPreview(1);q('#am-play').onclick=()=>{if(previewTimer){stopPreview();return;}q('#am-play').textContent='Stop';previewTimer=setInterval(()=>stepPreview(1),300);};
  q('#am-apply-png').onclick=saveAnimation;
  q('#am-delete').onclick=async()=>{if(selectedIndex<0)return;const reallyRemove=await appConfirm('Remove this animation?',{title:'Remove animation?',okText:'Remove',danger:true});if(!reallyRemove){keepAnimationFormEditable();return;}const r=await window.electronAPI.removeCustomAnimation(projectName,t.localId,selectedIndex);if(!r||!r.ok){await appAlert('Could not remove animation.'+(r&&r.error?'\n'+r.error:''),{title:'Remove failed',danger:true});return;}Object.assign(t,r.tileset||{});refreshAnimationRefs();selectedIndex=animationRefs.length?animationRefs[0].index:-1;await refreshCustomTilesetsCache();fill(selectedAnimation());renderList();setPackStatus('Removed animation.');};
}

function pngAnimationImportDefaults(role='decorative'){const r=String(role||'decorative').toLowerCase();const presets={hatch:{category:'hatches',role:'hatch',trigger:'level_start',fw:5,fh:3,name:'Hatch'},exit:{category:'goals',role:'exit',trigger:'constant_loop',fw:2,fh:2,name:'Goal'},fire:{category:'fire',role:'fire',trigger:'constant_loop',fw:1,fh:1,name:'Fire'},triggered_trap:{category:'traps',role:'triggered_trap',trigger:'lemming_position',fw:2,fh:2,name:'Triggered Trap'},water:{category:'water',role:'water',trigger:'constant_loop',fw:1,fh:1,name:'Water'},acid:{category:'water',role:'acid',trigger:'constant_loop',fw:1,fh:1,name:'Acid'},decorative:{category:'decorative',role:'decorative',trigger:'constant_loop',fw:1,fh:1,name:'Decorative'}};return presets[r]||presets.decorative;}
function showPngAnimationImportModal(preset={}){
  const defaults=pngAnimationImportDefaults(preset.role||preset.category||'decorative');
  let selected={dataUrl:null,img:null,name:''};
  let previewFrame=0;
  let pointOffset=null;
  let previewDrawRect=null;
  showModal(`<div class="modal-title">＋ Import PNG Animation</div><div class="modal-body" style="margin-bottom:8px">Import a PNG strip/sheet, set its gameplay role, then click the preview for Hatch spawn, Goal exit, or Trap trigger points. That point becomes the default for newly placed objects.</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px"><label style="font-size:10px;color:${C.gold};font-weight:900">Name<input id="pam-name" value="${defaults.name}" style="width:100%;margin-top:3px"></label><label style="font-size:10px;color:${C.gold};font-weight:900">Category<select id="pam-category" style="width:100%;margin-top:3px"><option value="hatches">Hatches</option><option value="goals">Goals</option><option value="fire">Fire</option><option value="traps">Triggered Traps</option><option value="water">Water/Acid</option><option value="decorative">Decorative</option></select></label><label style="font-size:10px;color:${C.gold};font-weight:900">Role<select id="pam-role" style="width:100%;margin-top:3px"><option value="hatch">Hatch</option><option value="exit">Goal / Exit</option><option value="fire">Fire Hazard</option><option value="triggered_trap">Triggered Trap</option><option value="water">Water</option><option value="acid">Acid / Toxic</option><option value="decorative">Decorative</option></select></label><label style="font-size:10px;color:${C.gold};font-weight:900">Trigger<select id="pam-trigger" style="width:100%;margin-top:3px"><option value="constant_loop">Constant loop</option><option value="level_start">Triggered at level start</option><option value="lemming_position">Triggered by lemming position</option></select></label><label style="font-size:10px;color:${C.gold};font-weight:900">Frame Width Tiles<input id="pam-fw" type="number" min="1" value="${defaults.fw}" style="width:100%;margin-top:3px"></label><label style="font-size:10px;color:${C.gold};font-weight:900">Frame Height Tiles<input id="pam-fh" type="number" min="1" value="${defaults.fh}" style="width:100%;margin-top:3px"></label><label style="font-size:10px;color:${C.gold};font-weight:900">Frames<input id="pam-frames" type="number" min="1" value="1" style="width:100%;margin-top:3px"></label><label style="font-size:10px;color:${C.gold};font-weight:900">Orientation<select id="pam-orientation" style="width:100%;margin-top:3px"><option value="horizontal">Horizontal strip</option><option value="vertical">Vertical strip</option></select></label></div><div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap"><button id="pam-load" class="sbtn active">🖼 Choose PNG</button><button id="pam-prev" class="sbtn">◀</button><button id="pam-next" class="sbtn">▶</button><span id="pam-status" style="font-size:10px;color:${C.dim};font-weight:800">No PNG selected.</span></div><canvas id="pam-preview" width="200" height="100" title="For Hatch/Goal/Trap: click to set spawn/exit/trigger point" style="image-rendering:pixelated;background:#05050a;border:1px solid ${C.border};max-width:100%;margin-bottom:4px;cursor:crosshair"></canvas><div id="pam-point-status" style="font-size:10px;color:${C.dim};font-weight:800;line-height:1.35;margin-bottom:8px">Hatch/Goal/Trap animations: click the preview to set the gameplay point.</div><div style="display:flex;justify-content:flex-end;gap:8px"><button id="pam-cancel" class="sbtn">Cancel</button><button id="pam-save" class="sbtn green">Save Animation</button></div>`);
  const presetSet=()=>{const set=(id,v)=>{const el=q('#'+id);if(el)el.value=v;};set('pam-category',defaults.category);set('pam-role',defaults.role);set('pam-trigger',defaults.trigger);};presetSet();
  function form(){return{name:q('#pam-name')?.value||'New Animation',category:q('#pam-category')?.value||'decorative',role:q('#pam-role')?.value||'decorative',trigger:q('#pam-trigger')?.value||'constant_loop',frameWidthTiles:Math.max(1,Number(q('#pam-fw')?.value)||1),frameHeightTiles:Math.max(1,Number(q('#pam-fh')?.value)||1),frames:Math.max(1,Number(q('#pam-frames')?.value)||1),orientation:q('#pam-orientation')?.value||'horizontal'};}
  function defaultPointFor(d){const fw=d.frameWidthTiles*TW,fh=d.frameHeightTiles*TH;const role=String(d.role||'').toLowerCase();if(role==='hatch')return{x:Math.floor(fw/2),y:Math.max(0,fh-1)};if(role==='exit'||role==='goal')return{x:Math.floor(fw/2),y:Math.max(0,fh-1)};if(role==='triggered_trap')return{x:Math.floor(fw/2),y:Math.max(0,fh-1)};return null;}
  function pointLabel(d){const role=String(d.role||'').toLowerCase();if(role==='hatch')return 'Spawn point';if(role==='exit'||role==='goal')return 'Exit point';if(role==='triggered_trap')return 'Trap trigger point';return '';}
  function currentPoint(d){return pointOffset||defaultPointFor(d);}
  function render(){const canvas=q('#pam-preview');if(!canvas)return;const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.fillStyle='#05050a';ctx.fillRect(0,0,canvas.width,canvas.height);const st=q('#pam-status'),pst=q('#pam-point-status');previewDrawRect=null;if(!selected.img){if(st)st.textContent='No PNG selected.';if(pst)pst.textContent='Hatch/Goal/Trap animations: click the preview to set the gameplay point.';return;}const d=form(),fw=d.frameWidthTiles*TW,fh=d.frameHeightTiles*TH,frames=d.frames;previewFrame=((previewFrame%frames)+frames)%frames;const vertical=String(d.orientation).startsWith('v');const sx=vertical?0:previewFrame*fw,sy=vertical?previewFrame*fh:0;const scale=Math.max(1,Math.floor(Math.min(canvas.width/fw,canvas.height/fh)));const dw=fw*scale,dh=fh*scale,dx=Math.floor((canvas.width-dw)/2),dy=Math.floor((canvas.height-dh)/2);previewDrawRect={dx,dy,dw,dh,scale,fw,fh};try{ctx.drawImage(selected.img,sx,sy,fw,fh,dx,dy,dw,dh);}catch{}const p=currentPoint(d);if(p){const px=dx+p.x*scale,py=dy+p.y*scale;ctx.save();ctx.strokeStyle=C.gold;ctx.fillStyle=C.gold;ctx.lineWidth=2;if(String(d.role).toLowerCase()==='exit'){ctx.globalAlpha=0.55;ctx.beginPath();ctx.arc(px,py,8*scale,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}ctx.beginPath();ctx.moveTo(px-7,py);ctx.lineTo(px+7,py);ctx.moveTo(px,py-7);ctx.lineTo(px,py+7);ctx.stroke();ctx.beginPath();ctx.arc(px,py,3,0,Math.PI*2);ctx.fill();ctx.restore();if(pst)pst.textContent=`${pointLabel(d)}: ${p.x},${p.y}px inside the first frame. Click the preview to change it.`;}else if(pst)pst.textContent='Decorative/hazard loops do not need a gameplay point.';if(st)st.textContent=`${selected.name} · frame ${previewFrame+1}/${frames} · ${selected.img.naturalWidth}×${selected.img.naturalHeight}px`;}
  q('#pam-load').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/png';input.onchange=()=>{const file=input.files&&input.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{selected={dataUrl:reader.result,img,name:file.name};q('#pam-name').value=file.name.replace(/\.png$/i,'');pointOffset=null;render();};img.onerror=()=>appAlert('Could not load animation PNG.',{title:'PNG failed',danger:true});img.src=reader.result;};reader.readAsDataURL(file);};input.click();};
  ['pam-name','pam-category','pam-role','pam-trigger','pam-fw','pam-fh','pam-frames','pam-orientation'].forEach(id=>{const el=q('#'+id);if(el){el.oninput=()=>{pointOffset=null;render();};el.onchange=()=>{pointOffset=null;render();};}});
  q('#pam-category').onchange=()=>{const cat=q('#pam-category').value;const role=roleForPngCategory(cat);q('#pam-role').value=role;q('#pam-trigger').value=defaultTriggerForRole(role);pointOffset=null;render();};q('#pam-role').onchange=()=>{const role=q('#pam-role').value;q('#pam-category').value=categoryForPngRole(role);q('#pam-trigger').value=defaultTriggerForRole(role);pointOffset=null;render();};q('#pam-prev').onclick=()=>{previewFrame--;render();};q('#pam-next').onclick=()=>{previewFrame++;render();};
  q('#pam-preview').onclick=e=>{const d=form();if(!selected.img||!previewDrawRect||!defaultPointFor(d))return;const r=q('#pam-preview').getBoundingClientRect();const sx=q('#pam-preview').width/r.width,sy=q('#pam-preview').height/r.height;const cx=(e.clientX-r.left)*sx,cy=(e.clientY-r.top)*sy;const {dx,dy,dw,dh,scale,fw,fh}=previewDrawRect;if(cx<dx||cy<dy||cx>=dx+dw||cy>=dy+dh)return;pointOffset={x:Math.max(0,Math.min(fw-1,Math.floor((cx-dx)/scale))),y:Math.max(0,Math.min(fh-1,Math.floor((cy-dy)/scale)))};render();};
  q('#pam-cancel').onclick=()=>closeModal('#modal-generic');q('#pam-save').onclick=async()=>{if(!selected.dataUrl){appAlert('Choose a PNG first.',{title:'No PNG'});return;}const d=form();const id=String(d.name||'animation').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'')||('animation_'+Date.now());const point=currentPoint(d);const pointPatch={};const role=String(d.role||'').toLowerCase();if(point&&role==='hatch'){pointPatch.spawnOffsetX=point.x;pointPatch.spawnOffsetY=point.y;}else if(point&&(role==='exit'||role==='goal'||role==='triggered_trap')){pointPatch.triggerOffsetX=point.x;pointPatch.triggerOffsetY=point.y;}const anim=normalisePngAnimation({...d,...pointPatch,id,image:selected.dataUrl,sourceName:selected.name});pngAnimationPack.animations=[...pngAnimations().filter(a=>String(a.id)!==id),anim];activePngPlacementMode='animation';activePngAnimationId=anim.id;activePngAnimationCategory=anim.category;renderPngAnimationPalette();refreshPngModeUi();updateDirty();setPackStatus('Imported PNG animation: '+anim.name+' · saving to global PNG animation library…');await saveGlobalPngAnimationLibrary({silent:true});setPackStatus('Imported PNG animation: '+anim.name+' · saved globally and available to every PNG level.');schedulePngDraftAutosave({immediate:true});closeModal('#modal-generic');};render();
}

function buildLevelFormDOM(){
  const c=q("#level-form-container");if(!c)return;
  c.innerHTML="";
  const G=C; // colour ref
  function row(label,el){
    const wrap=document.createElement("div");
    wrap.style.cssText="display:flex;flex-direction:column;gap:2px";
    const lbl=document.createElement("div");
    lbl.style.cssText="font-size:9px;color:"+G.gold+";font-weight:800;letter-spacing:1px;text-transform:uppercase";
    lbl.textContent=label;
    wrap.appendChild(lbl);wrap.appendChild(el);return wrap;
  }
  function inp(id,type,opts={}){
    const el=document.createElement("input");
    el.type=type;el.id="lf-"+id;
    if(opts.min!==undefined)el.min=opts.min;
    if(opts.max!==undefined)el.max=opts.max;
    if(opts.value!==undefined)el.value=opts.value;
    if(opts.placeholder)el.placeholder=opts.placeholder;
    el.style.cssText="font-family:"+FONT+";background:#22223a;color:"+G.text+";border:1px solid "+G.border+";border-radius:4px;padding:4px 6px;font-size:11px;font-weight:600;outline:none;width:100%";
    el.addEventListener("change",()=>{syncLevelData();updateProjectSaveButtons();refreshPngModeUi();});el.addEventListener("input",()=>{syncLevelData();updateProjectSaveButtons();refreshPngModeUi();});
    return el;
  }
  function sel(id,options){
    const el=document.createElement("select");el.id="lf-"+id;
    el.style.cssText="font-family:"+FONT+";background:#22223a;color:"+G.text+";border:1px solid "+G.border+";border-radius:4px;padding:4px 6px;font-size:11px;font-weight:600;outline:none;width:100%;cursor:pointer";
    options.forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;el.appendChild(o);});
    el.addEventListener("change",()=>{syncLevelData();updateProjectSaveButtons();refreshPngModeUi();});
    return el;
  }
  function hr(){const d=document.createElement("hr");d.style.cssText="border:none;border-top:1px solid "+G.border+";margin:4px 0";return d;}
  function note(text){
    const n=document.createElement('div');
    n.style.cssText='font-size:10px;color:'+G.dim+';line-height:1.45;background:#10101e;border:1px solid '+G.border+';border-radius:5px;padding:7px 8px';
    n.textContent=text;
    return n;
  }
  function section(title,groups,children){
    const wrap=document.createElement('div');
    wrap.dataset.rulesetGroups=(groups||['all']).join(',');
    wrap.style.cssText='display:flex;flex-direction:column;gap:7px;margin-bottom:6px';
    if(title){
      const h=document.createElement('div');
      h.style.cssText='font-size:10px;color:'+G.gold+';font-weight:900;letter-spacing:1px;text-transform:uppercase;border-top:1px solid '+G.border+';padding-top:8px;margin-top:2px';
      h.textContent=title;
      wrap.appendChild(h);
    }
    children.forEach(child=>wrap.appendChild(child));
    return wrap;
  }
  function skillGrid(){
    const grid=document.createElement("div");
    grid.style.cssText="display:grid;grid-template-columns:1fr 1fr;gap:4px";
    ["climbers","floaters","bombers","blockers","builders","bashers","miners","diggers"].forEach(s=>{
      const wrap=document.createElement("div");
      wrap.style.cssText="display:flex;flex-direction:column;gap:2px";
      const lbl=document.createElement("div");
      lbl.style.cssText="font-size:9px;color:"+G.dim+";font-weight:700";
      lbl.textContent=s[0].toUpperCase()+s.slice(1);
      wrap.appendChild(lbl);
      wrap.appendChild(inp(s,"number",{min:0,max:99,value:0}));
      grid.appendChild(wrap);
    });
    return grid;
  }

  const sizeBtn=document.createElement('button');
  sizeBtn.id='btn-apply-map-size';
  sizeBtn.className='sbtn active';
  sizeBtn.style.cssText='width:100%;font-size:11px;margin-top:2px';
  sizeBtn.textContent='↔ Apply Map Size';

  c.appendChild(section('Identity',['all'],[
    row("Pack Name", inp("pack_name","text",{placeholder:"Untitled Pack"})),
    row("Level ID", inp("level_id","text",{placeholder:"level_001"})),
    row("Level Name", inp("name","text",{placeholder:"MY LEVEL"})),
    row("Ruleset Category", sel("ruleset",[["sms-expanded","SMS Custom"],["sms-original","SMS Original Compatible"],["multiplayer","Multiplayer"],["experimental","Experimental"]])),
    row("Level Type", sel("mode",[["singleplayer","Single Player"],["multiplayer","Multiplayer"],["original","Original-Compatible"],["experimental","Experimental"]])),
    (()=>{const n=note('');n.id='ruleset-profile-description';return n;})()
  ]));

  c.appendChild(section('Map Size',['size'],[
    row("Width Tiles", inp("width_tiles","number",{min:1,max:512,value:112})),
    row("Height Tiles", inp("height_tiles","number",{min:1,max:128,value:19})),
    sizeBtn,
    note('MLM files stay raw and dimensionless. INI/JSON carry width_tiles and height_tiles; Apply Map Size resizes the live canvas while preserving the top-left of the current map.')
  ]));

  const pngImportBtn=document.createElement('button');
  pngImportBtn.id='btn-import-terrain-png';
  pngImportBtn.className='sbtn active';
  pngImportBtn.style.cssText='width:100%;font-size:11px;margin-top:2px';
  pngImportBtn.textContent='🖼 Import Terrain PNG Preview';

  c.appendChild(section('Original Compatibility',['original-note'],[
    note('Original-compatible levels use the SMS 112×19 tilemap. The size fields are locked; exporting applies that size so the MLM stays compatible.')
  ]));

  c.appendChild(section('Multiplayer',['multiplayer'],[
    note('Early multiplayer metadata. Player-owned hatches/exits will move into an object layer later; for now this stores the ruleset and ownership intent in INI/JSON.'),
    row('Players', sel('players',[["2","2 Players"]])),
    row('Ownership', sel('ownership',[["per-player","Player-owned exits/hatches"],["shared-hatches","Shared hatches, owned exits"],["shared","Shared everything / test"]])),
    row('P1 Label', inp('p1_label','text',{placeholder:'P1'})),
    row('P2 Label', inp('p2_label','text',{placeholder:'P2'})),
    note('Hotkeys: hover the map then press 1=P1 hatch, 2=P1 goal, 3=P2 hatch, 4=P2 goal. Shift+number clears that marker.'),
    row('P1 Hatch Col', inp('p1_hatch_col','number',{min:-1,value:-1})),
    row('P1 Hatch Row', inp('p1_hatch_row','number',{min:-1,value:-1})),
    row('P1 Goal Col', inp('p1_goal_col','number',{min:-1,value:-1})),
    row('P1 Goal Row', inp('p1_goal_row','number',{min:-1,value:-1})),
    row('P2 Hatch Col', inp('p2_hatch_col','number',{min:-1,value:-1})),
    row('P2 Hatch Row', inp('p2_hatch_row','number',{min:-1,value:-1})),
    row('P2 Goal Col', inp('p2_goal_col','number',{min:-1,value:-1})),
    row('P2 Goal Row', inp('p2_goal_row','number',{min:-1,value:-1}))
  ]));

  c.appendChild(section('Gameplay',['singleplayer','experimental','multiplayer'],[
    row("Main Game Pack", sel("rating",mainGameRatingOptions())),
    row("Level Number", inp("level_number","number",{min:1,max:99,value:1})),
    row("Lemmings", sel("num_lemmings",[["1","1"],["2","2"],["4","4"],["5","5"],["10","10"],["20","20"],["50","50"],["80","80"]])),
    row("% To Save", inp("percent_needed","number",{min:0,max:100,value:50})),
    row("Release Rate (1-99)", inp("release_rate","number",{min:1,max:99,value:5})),
    row("Time (minutes)", inp("time_minutes","number",{min:1,max:99,value:5}))
  ]));

  c.appendChild(section('Skills',['skills'],[
    skillGrid()
  ]));

  c.appendChild(section('World / Objects',['world'],[
    row("Tileset", sel("tileset_id",allTilesetOptions())),
    row("Trap Type", sel("trap_type",[["0","None"],["1","Crusher (Brick)"],["2","Noose (Yellow)"],["3","Bear Trap (Grass)"],["4","Tap (SEGA)"]])),
    row("Trap X", inp("trap_x","number",{min:0,value:0})),
    row("Trap Y", inp("trap_y","number",{min:0,value:0})),
    row("Fall Distance", inp("fall_distance","number",{min:1,max:255,value:56}))
  ]));

  const musicOpts=[["0","Default"],...Array.from({length:17},(_,i)=>[(i+1).toString(),(i+1).toString()])];
  c.appendChild(section('Audio',['audio'],[
    row("Music (0=default)", sel("music",musicOpts))
  ]));

  refreshEditableControls(c);
  refreshRulesetFormVisibility();
}

// ─── Sessions ────────────────────────────────────────────────────────────────
let currentSessionName = "";

async function saveNamedSession(name){
  if(!name)return;
  try{
    const tilesetDataUrl = tilesetImg ? tilesetImg.src : "";
    const sess={
      tiles:btoa(String.fromCharCode(...tiles)),
      tilesetName, tilesetDataUrl,
      customTilesetPath: customTilesetPath||null,
      selTile, zoom,
      levelData:{...levelData},
      pngOverlayObjects:clonePngOverlayObjects(pngOverlayObjects),
      pngAnimationLibrary:PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME,
      terrainPngName, terrainPngDataUrl, terrainPngVisible
    };
    await window.electronAPI.saveNamedSession(name, JSON.stringify(sess));
    currentSessionName=name;
    updateSessionUI();
    setPackStatus("Session \""+name+"\" saved ✓");
  }catch(e){setPackStatus("⚠ session save failed: "+e.message);}
}

async function loadNamedSession(name){
  try{
    const json=await window.electronAPI.loadNamedSession(name);
    if(!json){setPackStatus("Session not found: "+name);return;}
    const sess=JSON.parse(json);
    if(sess.tiles){
      const raw=atob(sess.tiles);
      tiles=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i++)tiles[i]=raw.charCodeAt(i);
      savedTileSnapshot=new Uint8Array(tiles);
      history=[makeHistoryEntry(tiles,pngOverlayObjects)];histIdx=0;updateHistStatus();
    }
    if(sess.tilesetDataUrl&&sess.tilesetDataUrl.length>10){
      customTilesetPath=sess.customTilesetPath||null;
      loadTilesetFromDataUrl(sess.tilesetDataUrl, sess.tilesetName||"tileset.png", true, customTilesetPath);
    }
    if(sess.selTile!==undefined){selTile=sess.selTile;q("#tile-num").value=selTile;}
    if(sess.zoom){setZoom(sess.zoom);}
    if(sess.levelData){
      levelData={...levelData,...sess.levelData};populateLevelForm(levelData);
      if(levelData.trap_x||levelData.trap_y){
        trapPos={col:Math.round((levelData.trap_x-4)/8),row:Math.round((levelData.trap_y-8)/8)};
      } else {trapPos=null;}
    }
    if(Array.isArray(sess.pngOverlayObjects))pngOverlayObjects=clonePngOverlayObjects(sess.pngOverlayObjects);
    if(sess.pngAnimationPack&&Array.isArray(sess.pngAnimationPack.animations)){mergePngAnimationPackIntoGlobal(sess.pngAnimationPack);schedulePngAnimationLibrarySave({immediate:true,silent:true});}
    if(sess.terrainPngDataUrl){
      terrainPngDataUrl=sess.terrainPngDataUrl;terrainPngName=sess.terrainPngName||terrainPngName;terrainPngVisible=sess.terrainPngVisible!==false;
      const img=new Image();img.onload=()=>{terrainPngImg=img;redrawMap();};img.src=terrainPngDataUrl;
    }
    markPngLevelSaved();refreshPngModeUi();syncPngObjectSummary();
    currentSessionName=name;
    updateSessionUI();
    redrawMap();updateDirty();
    setPackStatus("Session \""+name+"\" loaded ✓");
  }catch(e){setPackStatus("⚠ session load failed: "+e.message);}
}

async function showSessionModal(){
  const sessions=await window.electronAPI.listSessions()||[];
  const ov=q("#modal-generic");
  const listHTML=sessions.length
    ? sessions.map(s=>`<button class="sbtn" style="width:100%;margin-bottom:4px;text-align:left" onclick="loadNamedSession('${s}');closeModal('#modal-generic')">${s}</button>`).join("")
    : `<div style="color:${C.dim};font-size:11px;margin-bottom:8px">No saved sessions yet.</div>`;
  ov.innerHTML=`<div class="modal-box">
    <div class="modal-title">💾 Sessions</div>
    <div style="margin-bottom:10px;font-size:11px;color:${C.dim};font-weight:600">Load a saved session:</div>
    <div style="max-height:200px;overflow-y:auto;margin-bottom:12px">${listHTML}</div>
    <div class="modal-title" style="font-size:12px;margin-bottom:8px">Save current as:</div>
    <input id="sess-name-inp" type="text" placeholder="Session name..." value="${currentSessionName}" style="margin-bottom:10px">
    <div class="modal-row">
      <button id="sess-save-btn" class="sbtn active" style="flex:1">💾 Save</button>
      <button class="sbtn" style="flex:1" onclick="closeModal('#modal-generic')">Cancel</button>
    </div>
  </div>`;
  ov.style.display="flex";
  ov.onclick=e=>{if(e.target===ov)closeModal("#modal-generic");};
  const ni=q("#sess-name-inp");ni.focus();
  ni.onkeydown=e=>{if(e.key==="Enter")doSave();if(e.key==="Escape")closeModal("#modal-generic");};
  q("#sess-save-btn").onclick=doSave;
  function doSave(){
    const n=q("#sess-name-inp").value.trim();
    if(!n){appAlert("Enter a session name.");return;}
    saveNamedSession(n);closeModal("#modal-generic");
  }
}

function updateSessionUI(){
  const el=q("#session-name-label");
  if(el)el.textContent=currentSessionName?`"${currentSessionName}"`:"unsaved";
}

// ─── Default brush packs per tileset ─────────────────────────────────────────
const TILESET_PACK_LABELS = {
  0:"Grass Brushes", 1:"Sand 1 Brushes", 2:"Fire Brushes",
  3:"Ice Brushes", 4:"Brick Brushes", 6:"Sand 2 Brushes", 7:"Sega Brushes"
};

async function loadDefaultPackForTileset(tilesetId){
  const id=normaliseTilesetId(tilesetId,0);
  const previousGrassBrushes=(Number(activeTilesetId)===0&&Array.isArray(brushes))?brushes.slice(0,2).map(cloneBrushForPack).filter(Boolean):[];
  activeTilesetId=id;
  const ts=BUNDLED_TILESETS.find(t=>Number(t.id)===id);
  const isCustom=!ts;
  const fname=tilesetPackFileName(id);

  let json=null;
  try{ json=await window.electronAPI.loadTilesetPackByName(fname); }
  catch(e){ console.error("loadTilesetPackByName failed:",e); }

  if(!json){
    // No saved pack yet. Built-ins start empty; custom tilesets are seeded from Grass's first two brushes.
    packName=tilesetBrushPackDisplayName(id);
    brushes=isCustom?await makeStarterBrushesForCustomTileset(previousGrassBrushes):[];
    brushPreviews=[];activeBrush=null;
    regeneratePreviews();
    // Save immediately so the pack is linked to this tileset from the first switch.
    try{ await window.electronAPI.saveTilesetPackByName(fname, packToJson(packName,brushes,{linkedTilesetId:id})); }
    catch(e){ console.error("saveTilesetPackByName failed:",e); }
    updateBrushUI();
    const nameEl=q("#pack-name");if(nameEl)nameEl.value=packName;
    setPackStatus(isCustom
      ? `Created linked custom tileset pack: "${packName}" - seeded with ${brushes.length} Grass brush${brushes.length!==1?'es':''}`
      : `New pack: "${packName}" - add brushes with + or Ctrl+B`);
    return;
  }

  const pack=packFromJson(json);
  if(!pack){
    packName=tilesetBrushPackDisplayName(id);
    brushes=isCustom?await makeStarterBrushesForCustomTileset(previousGrassBrushes):[];
    brushPreviews=[];activeBrush=null;
    regeneratePreviews();
    try{ await window.electronAPI.saveTilesetPackByName(fname, packToJson(packName,brushes,{linkedTilesetId:id})); }
    catch(e){ console.error("saveTilesetPackByName failed:",e); }
    updateBrushUI();
    const nameEl=q("#pack-name");if(nameEl)nameEl.value=packName;
    return;
  }

  brushes=pack.brushes;
  packName=pack.name||tilesetBrushPackDisplayName(id);
  brushPreviews=[];activeBrush=null;
  regeneratePreviews();
  updateBrushUI();
  const nameEl=q("#pack-name");if(nameEl)nameEl.value=packName;
  setPackStatus(`Loaded linked pack: "${packName}" - ${brushes.length} brush${brushes.length!==1?"es":""}`);
}


// ─── Keyboard ─────────────────────────────────────────────────────────────────

function handlePngObjectHotkey(e){
  if(!isPngMapMode()||!hoverCell)return false;
  const key=String(e.key||'').toLowerCase();
  const roles={h:'hatch',x:'exit',t:'triggered_trap',f:'fire',w:'water',a:'acid'};
  if((key==='backspace'||key==='delete')&&e.shiftKey){e.preventDefault();clearPngObjectAt(hoverCell);return true;}
  if(!e.shiftKey||!roles[key])return false;
  e.preventDefault();placePngObject(roles[key],hoverCell);return true;
}

function onKey(e){
  // Don't intercept when typing in inputs (except specific combos)
  const inInput=(e.target.tagName==="INPUT"&&e.target.type!=="checkbox")||e.target.tagName==="SELECT"||e.target.tagName==="TEXTAREA";
  const ctrl=e.ctrlKey||e.metaKey;

  if(ctrl&&e.key==="z"){e.preventDefault();if(canUseHistoryEditShortcut("undo changes on a locked community level"))undo();return;}
  if(ctrl&&e.shiftKey&&e.key==="Z"){e.preventDefault();if(canUseHistoryEditShortcut("redo changes on a locked community level"))redo();return;}
  if(ctrl&&(e.key==="y")){e.preventDefault();if(canUseHistoryEditShortcut("redo changes on a locked community level"))redo();return;}
  if(e.key==="F12"){e.preventDefault();if(canUseHistoryEditShortcut("revert a locked community level"))revertAll();return;}

  if(inInput)return;

  if(handleMultiplayerMarkerHotkey(e))return;
  if(handlePngObjectHotkey(e))return;

  const key=(e.key||"").toLowerCase();
  if(isPngMapMode()&&selectedPngObjectId&&(key==='['||key===']')){e.preventDefault();adjustSelectedPngObjectZIndex(key==='['?-10:10);return;}
  if(ctrl&&key==="o"){e.preventDefault();q("#btn-open-mlm").click();return;}
  if(ctrl&&key==="i"){e.preventDefault();q("#btn-open-ts").click();return;}
  if(ctrl&&e.shiftKey&&key==="s"){e.preventDefault();showSessionModal();return;}
  if(ctrl&&key==="s"){e.preventDefault(); q("#btn-project-save")?.click();return;}
  if(ctrl&&key==="e"){e.preventDefault();q("#btn-export-mlm").click();return;}

  // Ctrl+B = add new brush from selection
  if(ctrl&&e.key.toLowerCase()==="b"){e.preventDefault();createBrushFromSelection();return;}

  // Ctrl+C/V = copy/paste
  if(ctrl&&e.key==="c"){e.preventDefault();copySelection();return;}
  if(ctrl&&e.key==="v"){e.preventDefault();enterPasteMode();return;}

  // Escape = cancel paste mode, deselect, clear clipboard / PNG animation
  if(e.key==="Escape"){
    if(isPngMapMode()){deselectPngAnimation();return;}
    if(pasteMode){exitPasteMode();}
    selStart=null;selEnd=null;clipboard=null;
    redrawMap();updateStatusBar();
    return;
  }

  // Delete/Backspace = erase selected/hovered PNG object or tile selection
  if((e.key==="Delete"||e.key==="Backspace")&&!inInput){
    if(isPngMapMode()){const cell=hoverCell; if(selectedPngObjectId){const obj=pngOverlayObjects.find(o=>String(o.id)===String(selectedPngObjectId)); if(obj)clearPngObjectAt({col:obj.col,row:obj.row}); return;} if(cell){clearPngObjectAt(cell);return;}}
    if(selStart&&selEnd&&tool==="select"){
      if(!canUseHistoryEditShortcut("erase selected tiles on a locked community level"))return;
      const x1=Math.min(selStart.col,selEnd.col),x2=Math.max(selStart.col,selEnd.col);
      const y1=Math.min(selStart.row,selEnd.row),y2=Math.max(selStart.row,selEnd.row);
      const t=new Uint8Array(tiles);
      for(let r=y1;r<=y2;r++)for(let c=x1;c<=x2;c++)t[r*COLS+c]=0;
      tiles=t;pushHistory(t);redrawMap();updateDirty();
      setPackStatus(`Erased ${x2-x1+1}×${y2-y1+1} selection`);
      return;
    }
  }

  // Tool keys (no modifier)
  if(e.key==="r"&&!ctrl){if(refImg){refVisible=!refVisible;updateRefUI();redrawMap();}return;}
  const tm={b:"draw",e:"erase",f:"fill",s:"select",t:"trap"};
  if(tm[e.key]&&!ctrl)setTool(tm[e.key]);
  if(e.key==="d"&&!ctrl)deselectBrush();

  // +/- zoom; but also use for add/delete brush when not zooming context
  if((e.key==="+"||e.key==="=")&&!e.shiftKey&&!ctrl)setZoom(Math.min(zoom+1,5));
  if(e.key==="-"&&!ctrl)setZoom(Math.max(zoom-1,1));
  // Numpad +/- or with shift for brush add/del
  if(e.key==="+"&&e.shiftKey&&!ctrl){e.preventDefault();q("#btn-add-brush").click();return;}
  if(e.key==="_"&&!ctrl){deleteActiveBrush();return;}
}


function initLevelReorderPreference(){
  const el=q('#confirm-level-reorder');
  if(!el)return;
  const saved=localStorage.getItem('confirmLevelBrowserMoves');
  el.checked = saved === null ? true : saved !== 'false';
  el.addEventListener('change',()=>localStorage.setItem('confirmLevelBrowserMoves', el.checked ? 'true' : 'false'));
}
function shouldConfirmLevelBrowserMove(){
  const el=q('#confirm-level-reorder');
  if(el)return !!el.checked;
  return localStorage.getItem('confirmLevelBrowserMoves') !== 'false';
}
function levelReorderLabel(mode, fromId, toId){
  if(mode === 'swap') return `Swap ${fromId} with ${toId}?`;
  return `Move ${fromId} ${mode === 'after' ? 'after' : 'before'} ${toId}? This will renumber the levels in between.`;
}

// ─── Level Browser Modal ─────────────────────────────────────────────────────
let _levelManifest = null;
let _levelBrowserSharedMap = new Map();
let _levelBrowserCat = localStorage.getItem('lbLastCat') || 'FUN';
const _levelThumbCache = new Map(); // cache key → { hash, dataUrl }
function levelThumbHashFromBytes(bytes, extra=''){
  let h=2166136261;
  const data=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes||[]);
  for(let i=0;i<data.length;i++){ h^=data[i]; h=Math.imul(h,16777619); }
  for(let i=0;i<String(extra).length;i++){ h^=String(extra).charCodeAt(i)&255; h=Math.imul(h,16777619); }
  return (h>>>0).toString(16).padStart(8,'0');
}
function levelThumbMetaHash(meta, mlmFile='', tilesetId=0){
  return String((meta&&(meta.thumbnail_hash||meta.thumb_hash||meta.mlm_hash||meta.hash||meta.updated||meta.mtime||meta.modified))||'');
}
function levelThumbCacheKey(scope, id, tilesetId){return [scope||'levels',String(id||''),String(tilesetId||0)].join('|');}
function paintCachedLevelThumb(canvas, dataUrl){
  if(!canvas||!dataUrl)return false;
  const img=new Image();
  img.onload=()=>{const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);};
  img.src=dataUrl;return true;
}
function putLevelThumbCache(key, hash, canvas){if(!key||!canvas)return;try{_levelThumbCache.set(key,{hash:String(hash||''),dataUrl:canvas.toDataURL('image/png'),at:Date.now()});}catch{}}
function getLevelThumbCache(key, hash=''){const hit=_levelThumbCache.get(key);if(!hit)return null;if(hash&&hit.hash&&String(hit.hash)!==String(hash)){_levelThumbCache.delete(key);return null;}return hit.dataUrl||null;}
function deleteLevelThumbCacheFor(id){const needle=String(id||'');if(!needle)return;for(const key of Array.from(_levelThumbCache.keys())) if(key.includes('|'+needle+'|')||key.includes('|'+needle)) _levelThumbCache.delete(key);}





async function getPublishedPngLevels(){
  if(!window.electronAPI||typeof window.electronAPI.listCustomPngLevels!=='function')return [];
  const result=await window.electronAPI.listCustomPngLevels();
  if(!result||result.ok===false)throw new Error((result&&result.error)||'Could not read the Custom PNG level manifest.');
  const levels=Array.isArray(result.levels)?result.levels:[];
  return levels.filter(level=>level&&(level.png_level_json||level.terrain_png||String(level.map_format||'').toLowerCase()==='png'));
}

function publishedPngLevelLabel(level){
  const rating=String(level.rating||level.pack||level.category||'CUSTOM').toUpperCase();
  const number=Number(level.level_number||level.number||0);
  const prefix=number?`${rating} ${String(number).padStart(2,'0')}`:rating;
  return `${prefix} · ${level.title||level.name||level.id||'Untitled PNG level'}`;
}

async function loadPublishedPngLevel(levelId){
  const id=String(levelId||'').trim();
  if(!id)return false;
  if(isDirty()){
    const ok=await appConfirm('Load this published PNG level? Unsaved editor changes will be replaced.',{title:'Load published PNG level',okText:'Load level'});
    if(!ok)return false;
  }
  if(!window.electronAPI||typeof window.electronAPI.loadCustomPngLevel!=='function'){
    throw new Error('Published PNG level loading is not available in this build.');
  }
  const result=await window.electronAPI.loadCustomPngLevel(id);
  if(!result||result.ok===false)throw new Error((result&&result.error)||'Could not load the published PNG level.');

  const entry=result.entry||{};
  const iniText=String(result.iniText||'');
  const parsedIni=iniText.trim()?iniToLevelData(iniText):{};
  const pngLevelJson=result.pngLevelJson&&typeof result.pngLevelJson==='object'?result.pngLevelJson:{};
  const lib=result.animationLibrary&&Array.isArray(result.animationLibrary.animations)?result.animationLibrary:null;
  if(lib){
    setPngAnimationLibraryFromPayload(lib,{merge:true});
    lastPngAnimationLibrarySnapshot=JSON.stringify(pngAnimationLibraryPayload());
  }

  levelData={...levelData,...parsedIni,map_format:'png'};
  levelData.level_id=levelData.level_id||entry.id||id;
  levelData.name=levelData.name||entry.title||entry.name||id;
  levelData.rating=levelData.rating||entry.rating||entry.pack||'FUN';
  levelData.level_number=levelData.level_number||entry.level_number||entry.number||1;
  levelData.terrain_png=entry.terrain_png||pngLevelJson.terrainPng||pngLevelJson.terrain_png||levelData.terrain_png||'';
  levelData.png_level_json=entry.png_level_json||entry.pngLevelJson||levelData.png_level_json||`${id}.pnglevel.json`;
  levelData.animation_pack_json=entry.animation_pack_json||pngLevelJson.animationLibrary||PNG_GLOBAL_ANIMATION_LIBRARY_FILENAME;
  levelData.background_color=pngLevelJson.backgroundColor||pngLevelJson.background_color||levelData.background_color||'#000000';

  const objects=Array.isArray(pngLevelJson.objects)?pngLevelJson.objects:[];
  pngOverlayObjects=clonePngOverlayObjects(objects).map(o=>normalisePngObjectPosition(o));
  selectedPngObjectId=null;
  activePngPlacementMode='select';
  activePngAnimationId='';
  pngObjectDrag=null;

  terrainPngName=levelData.terrain_png||entry.terrain_png||'';
  terrainPngDataUrl=result.terrainPngDataUrl||'';
  terrainPngVisible=true;
  terrainPngImg=null;
  if(terrainPngDataUrl){
    const img=new Image();
    img.onload=()=>{
      terrainPngImg=img;
      resizeLevelMap(Math.max(1,Math.floor(img.naturalWidth/TW)),Math.max(1,Math.floor(img.naturalHeight/TH)),{preserve:false,markDirty:false,status:false});
      redrawMap();
    };
    img.src=terrainPngDataUrl;
  }

  populateLevelForm(levelData);
  renderPngAnimationPalette();
  refreshPngModeUi();
  syncPngObjectSummary();
  history=[makeHistoryEntry(tiles,pngOverlayObjects)];
  histIdx=0;
  updateHistStatus();
  savedTileSnapshot=new Uint8Array(tiles);
  markPngLevelSaved();
  updateDirty();
  redrawMap();
  setPackStatus(`Loaded published PNG level: ${publishedPngLevelLabel(entry)}`);
  return true;
}

async function showPublishedPngLevelBrowserModal(){
  try{
    const levels=await getPublishedPngLevels();
    const body=levels.length?levels.map((level,index)=>`
      <button class="sbtn" data-load-published-png="${esc(level.id||'')}" style="width:100%;text-align:left;margin-bottom:6px;padding:9px;border-color:${C.border}">
        <div style="font-size:12px;font-weight:900;color:${C.gold};margin-bottom:3px">${esc(publishedPngLevelLabel(level))}</div>
        <div style="font-size:10px;color:${C.dim};line-height:1.45">${esc(level.id||'')} · ${esc(level.terrain_png||'no terrain PNG listed')} · ${esc(level.png_level_json||'no PNG level JSON listed')}</div>
      </button>`).join(''):`<div style="color:${C.dim};font-size:11px;line-height:1.5">No published PNG levels were found in <b>public/custom-levels/manifest.json</b> yet. Publish a PNG level first, then it will appear here.</div>`;
    showModal(`
      <div class="modal-title">📚 Published PNG Levels</div>
      <div style="font-size:11px;color:${C.dim};line-height:1.5;margin-bottom:10px">Loads levels from the main game's <b>Custom Levels</b> folder. This is separate from temporary editor sessions.</div>
      <div style="max-height:60vh;overflow:auto;margin-bottom:10px">${body}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button id="published-png-level-close" class="sbtn">Close</button></div>
    `);
    const close=q('#published-png-level-close');if(close)close.onclick=()=>closeModal('#modal-generic');
    document.querySelectorAll('[data-load-published-png]').forEach(btn=>{
      btn.onclick=async()=>{
        try{
          await loadPublishedPngLevel(btn.dataset.loadPublishedPng);
          closeModal('#modal-generic');
        }catch(err){
          console.error('Published PNG level load failed',err);
          await appAlert('Could not load that published PNG level.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Load failed',danger:true});
        }
      };
    });
  }catch(err){
    console.error('Published PNG browser failed',err);
    await appAlert('Could not open the published PNG level browser.\n\n'+(err&&err.message?err.message:String(err||'Unknown error')),{title:'Levels unavailable',danger:true});
  }
}

// ─── Offline stubs for removed online/project/community features ──────────────
function communitySetActiveLockFromLevel(){ communityLockedLevelActive=false; communityLockedLevelSnapshot=null; }
function communityCanSaveLockedLevel(){ return true; }
function communityBlockLockedLevelAction(){ return false; }
function communityUpdateShareCurrentButton(){}
async function showShareCurrentLevelModal(){ appAlert('Online sharing has been removed from this local Pack Editor build.', {title:'Sharing removed'}); }
async function showShareLevelsModal(){ appAlert('Online sharing has been removed from this local Pack Editor build.', {title:'Sharing removed'}); }
async function showCommunityLevelsModal(){ appAlert('Community browsing has been removed from this local Pack Editor build.', {title:'Community removed'}); }
async function openLevelBrowserModal(){ return showPublishedPngLevelBrowserModal(); }
async function showWebProjectsModal(){ showSessionModal(); }
async function showLevelVersionsModal(){ const b=q('#btn-expanded-export-meta'); if(b)b.click(); }

function playtestBytesToBase64(bytes){
  const src=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  let out='';
  for(let i=0;i<src.length;i+=0x8000){
    const chunk=src.subarray(i,i+0x8000);
    out+=String.fromCharCode.apply(null,chunk);
  }
  return btoa(out);
}
function currentLevelSlotIdForPlaytest(){
  const rating=String(levelData.rating||'FUN').toUpperCase().replace(/\s+/g,'');
  const n=String(Number(levelData.level_number)||1).padStart(2,'0');
  return `${rating}_${n}`;
}
const JS_PLAYTEST_PAYLOAD_SCHEMA_VERSION='editor-playtest-v3';
function jsPlaytestNumberForPayload(value,fallback=0){
  if(value===undefined||value===null||value==='')return fallback;
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}
function jsPlaytestNormalisePayloadMetadata(meta={},levelId=''){
  const m={...(meta||{})};
  if(m.tileset===undefined&&m.tileset_id!==undefined)m.tileset=m.tileset_id;
  m.tileset=jsPlaytestNumberForPayload(m.tileset ?? activeTilesetId,0);
  m.rating=String(m.rating||m.category||'FUN').toUpperCase().replace(/\s+/g,'');
  m.level_number=jsPlaytestNumberForPayload(m.level_number ?? m.number,1);
  m.name=String(m.name||m.title||levelId||currentLevelSlotIdForPlaytest()||'Editor Playtest');
  m.mlm_file='__EDITOR_PLAYTEST__.mlm';
  // JS_ENGINE_PLAYTEST_PAYLOAD_V3: fall distance and music are first-class playtest metadata.
  m.fall_distance=jsPlaytestNumberForPayload(m.fall_distance ?? m.fallDistance,56);
  m.music=jsPlaytestNumberForPayload(m.music ?? m.music_track ?? m.musicTrack,0);
  return m;
}
function jsPlaytestMetaDebugLabel(meta={}){
  return `fall ${jsPlaytestNumberForPayload(meta.fall_distance,56)} · music ${jsPlaytestNumberForPayload(meta.music,0)}`;
}
function buildJsEnginePlaytestPayload(){
  syncLevelData();
  const levelId=currentLevelSlotIdForPlaytest();
  const meta=jsPlaytestNormalisePayloadMetadata(levelData,levelId);
  meta.width_tiles=COLS;meta.height_tiles=ROWS;
  if(isPngMapMode()){
    if(!terrainPngDataUrl) throw new Error('PNG mode needs an imported terrain PNG before playtesting.');
    const currentPngAnimationLibrary=pngAnimationLibraryPayload();
    meta.map_format='png';meta.terrain_png=terrainPngDataUrl;meta.png_level_json='__EDITOR_PLAYTEST__.pnglevel.json';meta.animation_pack_json='__EDITOR_PLAYTEST__.animpack.json';
    const pngLevelJson={...pngLevelAnimationJsonPayload({includeLegacyAnimations:true}),animationLibrary:'__EDITOR_PLAYTEST__.animpack.json',animationPack:{source:'playtest',path:'__EDITOR_PLAYTEST__.animpack.json',animations:currentPngAnimationLibrary.animations}};
    return {schemaVersion:JS_PLAYTEST_PAYLOAD_SCHEMA_VERSION,levelId,name:meta.name,metadata:meta,terrainPngDataUrl,pngLevelJson,overlayJson:{objects:pngLevelJson.objects},animationPackJson:currentPngAnimationLibrary,verificationKey:'editor-current-png:'+levelThumbHashFromBytes(new TextEncoder().encode(JSON.stringify({meta,pngLevelJson,terrainPngName,pngAnimationLibrary:currentPngAnimationLibrary})),terrainPngName||''),source:'editor-current-png-level',createdAt:new Date().toISOString()};
  }
  const bytes=encodeMlm(tiles);
  return {schemaVersion:JS_PLAYTEST_PAYLOAD_SCHEMA_VERSION,levelId,name:meta.name,metadata:meta,mlmBase64:playtestBytesToBase64(bytes),verificationKey:'editor-current:'+levelThumbHashFromBytes(bytes,JSON.stringify(meta)),source:'editor-current-level',createdAt:new Date().toISOString()};
}

function showJsEnginePlaytestModal(payloadOverride=null, options={}){
  let payload;
  const staticPayload=(payloadOverride&&typeof payloadOverride==='object')?payloadOverride:null;
  const buildPayloadForModal=()=>staticPayload?{...staticPayload}:buildJsEnginePlaytestPayload();
  try{payload=buildPayloadForModal();}
  catch(e){appAlert('Could not prepare playtest level: '+(e&&e.message?e.message:String(e)),{title:'Playtest failed',danger:true});return;}
  const engineSrc='playtest-engine/index.html?editorEmbed=1&v='+encodeURIComponent(APP_VERSION||'1');
  const refreshLabel=staticPayload?'Restart Playtest':'Refresh From Editor';
  const titleText=options.title||'▶ JS Engine Playtest';
  showModal(`<div class="modal-title" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><span>${esc(titleText)}</span><span style="font-size:10px;color:${C.dim};font-weight:900">${esc(payload.levelId)} · ${esc(payload.name)} · ${esc(jsPlaytestMetaDebugLabel(payload.metadata||{}))}</span></div>
    <div class="modal-body" style="margin-bottom:8px">${esc(options.bodyText||'This runs the current editor level in the JavaScript engine using a local browser payload.')}</div>
    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;flex-wrap:wrap">
      <button id="playtest-refresh" class="sbtn active">${esc(refreshLabel)}</button>
      <button id="playtest-preview" class="sbtn">Preview Only</button>
      <button id="playtest-close" class="sbtn">${esc(options.closeLabel||'Close')}</button>
      <span id="playtest-status" style="font-size:11px;color:${C.dim};font-weight:800">Loading engine…</span>
    </div>
    <div style="background:#000;border:2px solid ${C.gold};border-radius:8px;padding:8px;display:flex;justify-content:center;align-items:center;overflow:hidden">
      <iframe id="js-playtest-frame" src="${engineSrc}" style="width:min(100%,1008px);height:min(72vh,576px);aspect-ratio:7/4;border:0;background:#000;image-rendering:pixelated"></iframe>
    </div>
    <div style="font-size:10px;color:${C.dim};line-height:1.5;margin-top:8px">Click inside the playtest window if the keyboard does not respond.${staticPayload?(options.autoReturnOnVictory?' Win the level to return to the share screen automatically.':' Get a victory, then close this panel to return to sharing.'):' Built-in tilesets are supported; custom tileset simulation can come next.'}</div>`);
  const frame=q('#js-playtest-frame');
  const status=q('#playtest-status');
  let mode='play';
  let victoryRecorded=false;
  let autoReturnScheduled=false;
  const setStatus=txt=>{const s=q('#playtest-status');if(s)s.textContent=txt;};
  const playtestEngineOptions=()=>({mode,singleLevel:options.singleLevel!==false,autoReturnOnVictory:!!options.autoReturnOnVictory});
  const saveLocal=()=>{try{localStorage.setItem('__smsLemmingsEditorPlaytestPayload',JSON.stringify({payload,options:playtestEngineOptions()}));}catch{}};
  saveLocal();
  const send=()=>{
    if(!frame||!frame.contentWindow)return;
    const engineOptions=playtestEngineOptions();
    saveLocal();
    frame.contentWindow.postMessage({type:'sms-lemmings-playtest-level',payload,options:engineOptions},'*');
    setStatus(mode==='preview'?'Preview loaded.':'Playtest loaded.');
    try{frame.focus();}catch{}
  };
  const onMsg=e=>{
    const d=e&&e.data;
    if(!d||typeof d!=='object')return;
    if(d.type==='sms-lemmings-playtest-ready'){send();}
    if(d.type==='sms-lemmings-playtest-error'){setStatus('Engine error: '+(d.message||'unknown'));}
    if(d.type==='sms-lemmings-playtest-diagnostic'){setStatus(String(d.message||''));}
    if(d.type==='sms-lemmings-playtest-result'){
      if(d.success){
        const key=String(d.verificationKey||payload.verificationKey||'');
        if(key)communityRecordPlaytestVictory(key,d.result||{});
        victoryRecorded=true;
        setStatus(options.autoReturnOnVictory?'Victory confirmed ✓ Returning to Share…':'Victory confirmed ✓ You can now share/update this level.');
        try{if(typeof options.onVictory==='function')options.onVictory(d);}catch{}
        if(options.autoReturnOnVictory&&!autoReturnScheduled){
          autoReturnScheduled=true;
          const delay=Math.max(0,Number(options.returnDelayMs==null?650:options.returnDelayMs)||0);
          setTimeout(()=>{try{closePlaytest();}catch{}},delay);
        }
      }else{
        setStatus('Playtest finished: not enough lemmings saved.');
      }
    }
  };
  window.addEventListener('message',onMsg);
  window._jsPlaytestCleanup=()=>{window.removeEventListener('message',onMsg);window._jsPlaytestCleanup=null;};
  const closePlaytest=()=>{try{window._jsPlaytestCleanup&&window._jsPlaytestCleanup();}catch{} closeModal('#modal-generic'); if(typeof options.onClose==='function')setTimeout(()=>options.onClose({victoryRecorded,payload}),0);};
  if(status)status.textContent='Loading engine…';
  if(frame){frame.onload=()=>{setTimeout(send,0);setTimeout(send,350);setTimeout(send,1000);};}
  q('#playtest-refresh').onclick=()=>{payload=buildPayloadForModal();mode='play';send();};
  q('#playtest-preview').onclick=()=>{payload=buildPayloadForModal();mode='preview';send();};
  q('#playtest-close').onclick=closePlaytest;
}



// Level Library was part of the online/project API build and is removed here.
async function levelLibraryAddCurrentLevel(){ appAlert('Level Library has been removed from this local Pack Editor build.', {title:'Library removed'}); }
async function showLevelLibraryModal(){ appAlert('Level Library has been removed from this local Pack Editor build.', {title:'Library removed'}); }

setTimeout(()=>{ try{ initLevelReorderPreference(); }catch(_){} }, 0); // v2.0.0
