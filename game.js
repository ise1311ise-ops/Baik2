/* Baikonur District Shooter — game.js */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d", { alpha: false });

function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function rand(a,b){ return a + Math.random()*(b-a); }
function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }

const IMG = {};
function loadImage(name, src){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{ IMG[name]=img; resolve(); };
    img.src = src;
  });
}
async function loadAssets(){
  await Promise.all([
    loadImage("player","./assets/player.svg"),
    loadImage("enemy","./assets/enemy.svg"),
  ]);
}

let running=false, paused=false, lastTs=0;

const WORLD = { w: 2200, h: 1400, tile: 44 };

function buildMap(districtId){
  const d = APPSTATE.districts.find(x=>x.id===districtId);
  const palette = d ? d.palette : ["#0e1a33","#16254a","#1f3563","#2a4580"];
  const seed = (districtId||"x").split("").reduce((a,c)=>a+c.charCodeAt(0), 0);
  function sr(n){ return (Math.sin(n*999 + seed*13.7) * 10000) % 1; }
  const obstacles=[];
  obstacles.push({x:0,y:0,w:WORLD.w,h:24},{x:0,y:WORLD.h-24,w:WORLD.w,h:24},{x:0,y:0,w:24,h:WORLD.h},{x:WORLD.w-24,y:0,w:24,h:WORLD.h});
  for(let i=0;i<18;i++){
    const r=Math.abs(sr(i+1));
    const x=120 + Math.floor(r*(WORLD.w-320));
    const y=120 + Math.floor(Math.abs(sr(i+51))*(WORLD.h-320));
    const w=110 + Math.floor(Math.abs(sr(i+101))*220);
    const h=90  + Math.floor(Math.abs(sr(i+151))*200);
    if(Math.abs(x-WORLD.w/2)<200 && Math.abs(y-WORLD.h/2)<160) continue;
    obstacles.push({x,y,w,h});
  }
  const portals=[
    { x:80, y:WORLD.h/2-60, r:26, to:{x:WORLD.w-120, y:WORLD.h/2-60} },
    { x:WORLD.w-80, y:WORLD.h/2+60, r:26, to:{x:120, y:WORLD.h/2+60} },
  ];
  return { palette, obstacles, portals };
}

const player = {
  x: WORLD.w/2, y: WORLD.h/2,
  vx:0, vy:0, r:18,
  hp:100, armor:0,
  speed:240, dashCd:0, dashTime:0,
  aimX:1, aimY:0,
  weapon:"blaster", skin:null,
  speedMul:1.0, armorStart:0, hpStart:0,
};

let bullets=[], enemies=[], particles=[];
const game = { wave:1, coinsEarned:0, map:null };

function weaponStats(mode){
  if(mode==="smg")     return { rate:0.08, dmg:8,  spread:0.14, speed:700, pellets:1 };
  if(mode==="shotgun") return { rate:0.55, dmg:10, spread:0.25, speed:680, pellets:6 };
  return               { rate:0.16, dmg:14, spread:0.10, speed:720, pellets:1 };
}

function applyEquipment(){
  const s=APPSTATE.get(); const eq=s.equipped||{};
  player.weapon = eq.weapon || "blaster";
  player.skin = eq.skin || null;
  player.speedMul=1.0; player.armorStart=0; player.hpStart=0;
  (eq.gear||[]).forEach(id=>{ if(id==="boots") player.speedMul*=1.10; if(id==="armor") player.armorStart+=40; });
  (eq.boosts||[]).forEach(id=>{ if(id==="medkit") player.hpStart+=35; });
}

function resetRun(){
  const s=APPSTATE.get();
  bullets=[]; enemies=[]; particles=[];
  game.wave=1; game.coinsEarned=0;
  game.map=buildMap(s.districtId);
  applyEquipment();
  player.x=WORLD.w/2; player.y=WORLD.h/2; player.vx=0; player.vy=0;
  player.hp=clamp(100+player.hpStart,1,160);
  player.armor=clamp(player.armorStart,0,120);
  player.dashCd=0; player.dashTime=0;
  document.getElementById("hudWave").textContent=String(game.wave);
  APPSTATE.toast("Зона загружена. Удачи!");
}

function addCoins(n){
  const s=APPSTATE.get();
  s.coins=(s.coins||0)+n;
  game.coinsEarned+=n;
  APPSTATE.save();
  UI.updateHud();
}

function spawnWave(){
  const count=4+Math.floor(game.wave*1.6);
  for(let i=0;i<count;i++){
    const side=Math.floor(Math.random()*4);
    let x,y;
    if(side===0){ x=60; y=rand(60,WORLD.h-60); }
    if(side===1){ x=WORLD.w-60; y=rand(60,WORLD.h-60); }
    if(side===2){ x=rand(60,WORLD.w-60); y=60; }
    if(side===3){ x=rand(60,WORLD.w-60); y=WORLD.h-60; }
    enemies.push({ x,y, vx:0,vy:0, r:18, hp:40+game.wave*8, spd:110+game.wave*7, dmg:10+game.wave*1.3, hitT:0 });
  }
  document.getElementById("hudWave").textContent=String(game.wave);
  APPSTATE.toast(`Волна ${game.wave}: врагов ${count}`);
  TG && TG.haptic("light");
}

function rectCircleCollides(o,cx,cy,r){
  const x=clamp(cx,o.x,o.x+o.w);
  const y=clamp(cy,o.y,o.y+o.h);
  return dist2(cx,cy,x,y)<=r*r;
}
function pushOutFromRect(ent,o){
  const px=clamp(ent.x,o.x,o.x+o.w);
  const py=clamp(ent.y,o.y,o.y+o.h);
  const dx=ent.x-px, dy=ent.y-py;
  const d=Math.sqrt(dx*dx+dy*dy)||1;
  const overlap=ent.r-d;
  if(overlap>0){ ent.x+=(dx/d)*overlap; ent.y+=(dy/d)*overlap; }
}
function collide(ent){
  for(const o of game.map.obstacles){
    if(rectCircleCollides(o,ent.x,ent.y,ent.r)) pushOutFromRect(ent,o);
  }
}

const keys={};
addEventListener("keydown",(e)=>{ keys[e.key.toLowerCase()]=true; if(e.key===" ") e.preventDefault(); });
addEventListener("keyup",(e)=>{ keys[e.key.toLowerCase()]=false; });

let mouse={x:canvas.width/2,y:canvas.height/2,down:false};
canvas.addEventListener("pointermove",(e)=>{
  const r=canvas.getBoundingClientRect();
  mouse.x=(e.clientX-r.left)*(canvas.width/r.width);
  mouse.y=(e.clientY-r.top)*(canvas.height/r.height);
});
canvas.addEventListener("pointerdown",()=> mouse.down=true);
addEventListener("pointerup",()=> mouse.down=false);

const isTouch = matchMedia("(pointer: coarse)").matches;
const joy = document.getElementById("joy");
const joyStick = document.getElementById("joyStick");
const btnShoot = document.getElementById("btnShoot");
const btnDash  = document.getElementById("btnDash");
let joyState={active:false,id:null,dx:0,dy:0};
if(isTouch){
  const center=()=>{ const r=joy.getBoundingClientRect(); return {cx:r.left+r.width/2, cy:r.top+r.height/2, rad:r.width*0.38}; };
  joy.addEventListener("pointerdown",(e)=>{
    joyState.active=true; joyState.id=e.pointerId; joy.setPointerCapture(e.pointerId);
    const c=center(); const dx=e.clientX-c.cx, dy=e.clientY-c.cy;
    const len=Math.hypot(dx,dy)||1; const m=Math.min(c.rad,len);
    joyState.dx=(dx/len)*(m/c.rad); joyState.dy=(dy/len)*(m/c.rad);
    joyStick.style.transform=`translate(${joyState.dx*42-50}%, ${joyState.dy*42-50}%)`;
  });
  joy.addEventListener("pointermove",(e)=>{
    if(!joyState.active||joyState.id!==e.pointerId) return;
    const c=center(); const dx=e.clientX-c.cx, dy=e.clientY-c.cy;
    const len=Math.hypot(dx,dy)||1; const m=Math.min(c.rad,len);
    joyState.dx=(dx/len)*(m/c.rad); joyState.dy=(dy/len)*(m/c.rad);
    joyStick.style.transform=`translate(${joyState.dx*42-50}%, ${joyState.dy*42-50}%)`;
  });
  const up=()=>{ joyState.active=false; joyState.id=null; joyState.dx=0; joyState.dy=0; joyStick.style.transform="translate(-50%,-50%)"; };
  joy.addEventListener("pointerup",up); joy.addEventListener("pointercancel",up);
  btnShoot.addEventListener("pointerdown",()=> mouse.down=true);
  btnShoot.addEventListener("pointerup",()=> mouse.down=false);
  btnShoot.addEventListener("pointercancel",()=> mouse.down=false);
  btnDash.addEventListener("click",()=> dash());
}

let shootCd=0;
function camera(){
  return { x: clamp(player.x-canvas.width/2,0,WORLD.w-canvas.width),
           y: clamp(player.y-canvas.height/2,0,WORLD.h-canvas.height) };
}
function dash(){
  if(player.dashCd>0||player.dashTime>0) return;
  player.dashCd=1.2; player.dashTime=0.12; TG && TG.haptic("success");
}
function shoot(){
  if(shootCd>0) return;
  const w=weaponStats(player.weapon); shootCd=w.rate;
  let ax=player.aimX, ay=player.aimY;
  if(isTouch){
    let best=null, bestD=1e18;
    for(const e of enemies){ const d=dist2(player.x,player.y,e.x,e.y); if(d<bestD){bestD=d; best=e;} }
    if(best){ const dx=best.x-player.x, dy=best.y-player.y; const l=Math.hypot(dx,dy)||1; ax=dx/l; ay=dy/l; }
  } else {
    const cam=camera(); const mx=cam.x+mouse.x, my=cam.y+mouse.y;
    const dx=mx-player.x, dy=my-player.y; const l=Math.hypot(dx,dy)||1; ax=dx/l; ay=dy/l;
  }
  player.aimX=ax; player.aimY=ay;
  for(let p=0;p<w.pellets;p++){
    const ang=Math.atan2(ay,ax) + rand(-w.spread,w.spread);
    bullets.push({ x:player.x+ax*(player.r+4), y:player.y+ay*(player.r+4),
      vx:Math.cos(ang)*w.speed, vy:Math.sin(ang)*w.speed, r:4, dmg:w.dmg, life:0.9 });
  }
  TG && TG.haptic("light");
}

function hurt(amount){
  let dmg=amount;
  if(player.armor>0){ const absorb=Math.min(player.armor, dmg*0.65); player.armor-=absorb; dmg-=absorb; }
  player.hp-=dmg;
  document.getElementById("hudHp").textContent=String(Math.max(0,Math.round(player.hp)));
  document.getElementById("hudArmor").textContent=String(Math.max(0,Math.round(player.armor)));
  if(player.hp<=0) gameOver(); else TG && TG.haptic("error");
}
function gameOver(){
  paused=true; running=false;
  const s=APPSTATE.get(); const d=s.districtId;
  s.bestWaveByDistrict[d]=Math.max(s.bestWaveByDistrict[d]||0, game.wave);
  APPSTATE.save();
  UI.setScreen("menu");
  APPSTATE.toast(`Ты пал. Рекорд района: волна ${s.bestWaveByDistrict[d]}.`, 2400);
}

function update(dt){
  if(paused) return;
  // movement input
  let ix=0, iy=0;
  if(keys["w"]||keys["arrowup"]) iy-=1;
  if(keys["s"]||keys["arrowdown"]) iy+=1;
  if(keys["a"]||keys["arrowleft"]) ix-=1;
  if(keys["d"]||keys["arrowright"]) ix+=1;
  if(isTouch){ ix=joyState.dx; iy=joyState.dy; }
  const il=Math.hypot(ix,iy)||1;
  if(il>0.001){ ix/=il; iy/=il; }
  const speed=player.speed*player.speedMul*(player.dashTime>0?2.25:1.0);
  player.vx=ix*speed; player.vy=iy*speed;
  player.x+=player.vx*dt; player.y+=player.vy*dt;
  collide(player);
  for(const p of game.map.portals){
    if(dist2(player.x,player.y,p.x,p.y) < (p.r+player.r)*(p.r+player.r)){
      player.x=p.to.x; player.y=p.to.y;
      TG && TG.haptic("success"); APPSTATE.toast("Портал: переход в соседнюю зону");
    }
  }
  shootCd=Math.max(0,shootCd-dt);
  if(player.dashCd>0) player.dashCd=Math.max(0,player.dashCd-dt);
  if(player.dashTime>0) player.dashTime=Math.max(0,player.dashTime-dt);
  if(keys["shift"]) dash();

  // aim desktop
  if(!isTouch){
    const cam=camera(); const mx=cam.x+mouse.x, my=cam.y+mouse.y;
    const dx=mx-player.x, dy=my-player.y; const l=Math.hypot(dx,dy)||1;
    player.aimX=dx/l; player.aimY=dy/l;
  }
  if(mouse.down) shoot();

  // bullets
  for(let i=bullets.length-1;i>=0;i--){
    const b=bullets[i];
    b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    let hitWall=false;
    for(const o of game.map.obstacles){ if(rectCircleCollides(o,b.x,b.y,b.r)){ hitWall=true; break; } }
    if(hitWall || b.life<=0 || b.x<0||b.y<0||b.x>WORLD.w||b.y>WORLD.h){ bullets.splice(i,1); continue; }
    for(let j=enemies.length-1;j>=0;j--){
      const e=enemies[j];
      if(dist2(b.x,b.y,e.x,e.y) <= (b.r+e.r)*(b.r+e.r)){
        e.hp-=b.dmg; e.hitT=0.08; bullets.splice(i,1);
        if(e.hp<=0){
          enemies.splice(j,1);
          addCoins(8 + Math.floor(game.wave*0.9));
          for(let k=0;k<10;k++) particles.push({x:e.x,y:e.y,vx:rand(-120,120),vy:rand(-120,120),t:0.35});
          TG && TG.haptic("success");
        }
        break;
      }
    }
  }

  // enemies
  for(const e of enemies){
    const dx=player.x-e.x, dy=player.y-e.y; const l=Math.hypot(dx,dy)||1;
    e.vx=(dx/l)*e.spd; e.vy=(dy/l)*e.spd;
    e.x+=e.vx*dt; e.y+=e.vy*dt;
    collide(e);
    if(dist2(player.x,player.y,e.x,e.y) <= (player.r+e.r+6)*(player.r+e.r+6)) hurt(e.dmg*dt);
    e.hitT=Math.max(0,e.hitT-dt);
  }

  // particles
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.90; p.vy*=0.90; p.t-=dt;
    if(p.t<=0) particles.splice(i,1);
  }

  if(enemies.length===0){ game.wave += 1; spawnWave(); }
  document.getElementById("hudHp").textContent=String(Math.max(0,Math.round(player.hp)));
  document.getElementById("hudArmor").textContent=String(Math.max(0,Math.round(player.armor)));
}

function draw(){
  const cam=camera();
  ctx.fillStyle="#070b14";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const pal=game.map.palette, t=WORLD.tile;
  const sx=Math.floor(cam.x/t), sy=Math.floor(cam.y/t);
  const ex=Math.ceil((cam.x+canvas.width)/t), ey=Math.ceil((cam.y+canvas.height)/t);
  for(let y=sy;y<ey;y++){
    for(let x=sx;x<ex;x++){
      const ix=x*t-cam.x, iy=y*t-cam.y;
      ctx.fillStyle=pal[(x+y)&3];
      ctx.fillRect(ix,iy,t,t);
      ctx.strokeStyle="rgba(255,255,255,0.04)";
      ctx.strokeRect(ix,iy,t,t);
    }
  }

  for(const o of game.map.obstacles){
    const x=o.x-cam.x, y=o.y-cam.y;
    ctx.fillStyle="rgba(255,255,255,0.06)"; ctx.fillRect(x,y,o.w,o.h);
    ctx.strokeStyle="rgba(234,240,255,0.16)"; ctx.strokeRect(x+1,y+1,o.w-2,o.h-2);
  }

  for(const p of game.map.portals){
    const x=p.x-cam.x, y=p.y-cam.y;
    ctx.beginPath(); ctx.arc(x,y,p.r,0,Math.PI*2);
    ctx.fillStyle="rgba(90,225,255,0.12)"; ctx.fill();
    ctx.strokeStyle="rgba(90,225,255,0.45)"; ctx.lineWidth=3; ctx.stroke();
  }

  for(const b of bullets){
    const x=b.x-cam.x, y=b.y-cam.y;
    ctx.beginPath(); ctx.arc(x,y,b.r,0,Math.PI*2);
    ctx.fillStyle="rgba(90,225,255,0.95)"; ctx.fill();
  }

  for(const e of enemies){
    const x=e.x-cam.x, y=e.y-cam.y;
    const size=44;
    ctx.globalAlpha = e.hitT>0 ? 0.65 : 1.0;
    ctx.drawImage(IMG.enemy, x-size/2, y-size/2, size, size);
    ctx.globalAlpha = 1.0;
    const hp=clamp(e.hp/(40+game.wave*8),0,1);
    ctx.fillStyle="rgba(0,0,0,0.35)"; ctx.fillRect(x-22,y-34,44,6);
    ctx.fillStyle="rgba(255,90,107,0.9)"; ctx.fillRect(x-22,y-34,44*hp,6);
  }

  const px=player.x-cam.x, py=player.y-cam.y;
  const psize=48;
  ctx.drawImage(IMG.player, px-psize/2, py-psize/2, psize, psize);
  if(player.skin==="skin_camo"){ ctx.fillStyle="rgba(124,255,154,0.12)"; ctx.beginPath(); ctx.arc(px,py,22,0,Math.PI*2); ctx.fill(); }
  if(player.skin==="skin_neon"){ ctx.fillStyle="rgba(195,107,255,0.12)"; ctx.beginPath(); ctx.arc(px,py,22,0,Math.PI*2); ctx.fill(); }
  ctx.strokeStyle="rgba(234,240,255,0.16)"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px+player.aimX*34, py+player.aimY*34); ctx.stroke();

  for(const p of particles){
    const x=p.x-cam.x, y=p.y-cam.y;
    ctx.fillStyle="rgba(255,255,255,0.35)"; ctx.fillRect(x,y,2,2);
  }

  ctx.fillStyle="rgba(0,0,0,0.25)"; ctx.fillRect(10,10,220,54);
  ctx.strokeStyle="rgba(255,255,255,0.14)"; ctx.strokeRect(10,10,220,54);
  ctx.font="bold 14px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  ctx.fillStyle="rgba(234,240,255,0.85)";
  ctx.fillText("⚔️ Волна: "+game.wave+"  🪙 +"+game.coinsEarned, 18, 32);
  ctx.font="12px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  ctx.fillStyle="rgba(234,240,255,0.65)";
  ctx.fillText("Порталы подсвечены • здания блокируют", 18, 52);
}

function loop(ts){
  if(!running) return;
  const dt=Math.min(0.033, (ts-lastTs)/1000 || 0);
  lastTs=ts;
  update(dt); draw();
  requestAnimationFrame(loop);
}

function startGame(){
  paused=false; running=true; lastTs=performance.now();
  resetRun(); spawnWave();
  requestAnimationFrame(loop);
}
function pauseGame(){ paused=true; }
function resumeGame(){ paused=false; lastTs=performance.now(); }
function stopGame(){ running=false; paused=false; }

window.addEventListener("bks_equipment_changed", ()=>{ if(running){ applyEquipment(); APPSTATE.toast("Экипировка обновлена."); } });

window.addEventListener("bks_start_game", async ()=>{ if(!IMG.player) await loadAssets(); startGame(); });
window.addEventListener("bks_pause_game", ()=> pauseGame());
window.addEventListener("bks_resume_game", ()=> resumeGame());
window.addEventListener("bks_stop_game", ()=> stopGame());
