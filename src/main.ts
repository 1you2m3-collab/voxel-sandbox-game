import * as THREE from 'three';
import { io } from 'socket.io-client';
import type { PlayerState, RoomState } from './types';

const root = document.getElementById('root')!;

let html = `
  <div class="ui">
    <div class="menu" id="menu">
      <div class="card">
        <h1 style="text-align:center;margin-bottom:8px">VoxelCraft</h1>
        <input id="name" value="Explorer" maxlength="16">
        <button onclick="window.game.soloStart()">Play Solo</button>
        <button onclick="window.game.roomCreate()">Create Room</button>
        <input id="code" placeholder="Room Code" maxlength="6">
        <button onclick="window.game.roomJoin()">Join Room</button>
      </div>
    </div>
    <div class="topbar hidden" id="topbar">
      <div class="pill">Room: <span id="roomCode">-</span></div>
      <div class="pill">Players: <span id="playerCount">1</span></div>
    </div>
    <div class="controls hidden" id="controls">
      <div class="joy" id="joy"><div class="jstick"></div></div>
    </div>
    <div class="buttons hidden" id="buttons">
      <button class="btn" id="jumpBtn">JUMP</button>
      <button class="btn" id="mineBtn">MINE</button>
    </div>
  </div>
`;

root.innerHTML = html;

const menu = root.querySelector('#menu') as HTMLDivElement;
const topbar = root.querySelector('#topbar') as HTMLDivElement;
const controls = root.querySelector('#controls') as HTMLDivElement;
const buttons = root.querySelector('#buttons') as HTMLDivElement;

const nameInput = root.querySelector('#name') as HTMLInputElement;
const codeInput = root.querySelector('#code') as HTMLInputElement;
const roomCodeSpan = root.querySelector('#roomCode') as HTMLSpanElement;
const playerCountSpan = root.querySelector('#playerCount') as HTMLSpanElement;
const jumpBtn = root.querySelector('#jumpBtn') as HTMLButtonElement;
const mineBtn = root.querySelector('#mineBtn') as HTMLButtonElement;
const joyDiv = root.querySelector('#joy') as HTMLDivElement;
const jstick = joyDiv.querySelector('.jstick') as HTMLDivElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 150);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
root.appendChild(renderer.domElement);

const world = new THREE.Group();
scene.add(world);

const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(50, 50, 50);
light.castShadow = true;
light.shadow.mapSize.width = 2048;
light.shadow.mapSize.height = 2048;
scene.add(light);

scene.add(new THREE.HemisphereLight(0x88ccee, 0x44bb77, 1));

const blocks = new Map<string, THREE.Mesh>();
const remotePlayers = new Map<string, THREE.Group>();

const player = {
  pos: new THREE.Vector3(0, 5, 0),
  vel: new THREE.Vector3(),
  onGround: true,
  avatar: new THREE.Group()
};

const cam = {
  yaw: Math.PI,
  pitch: 0.5,
  dist: 6
};

const keys = { w: false, a: false, s: false, d: false, shift: false };
const joy = { x: 0, y: 0 };

scene.add(player.avatar);

function createAvatar(name: string, color: string) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.2, 0.4), new THREE.MeshStandardMaterial({ color }));
  body.position.y = 0.7;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xf4d8b4 }));
  head.position.y = 1.6;
  head.castShadow = true;
  g.add(head);
  return g;
}

player.avatar = createAvatar('Player', '#7dd3fc');
scene.add(player.avatar);

function genTerrain() {
  const r = 16;
  for (let x = -r; x <= r; x++) {
    for (let z = -r; z <= r; z++) {
      const h = Math.round(3 + Math.sin(x * 0.4) * 1.5 + Math.cos(z * 0.3) * 1.5);
      for (let y = 0; y <= h; y++) {
        const t = y === h ? 'grass' : y > h - 2 ? 'dirt' : 'stone';
        addBlock(x, y, z, t);
      }
      if (Math.random() < 0.1 && h > 2) addTree(x, h + 1, z);
    }
  }
  player.pos.set(0, genHeight(0, 0) + 2, 0);
}

function addTree(x: number, y: number, z: number) {
  for (let i = 0; i < 3; i++) addBlock(x, y + i, z, 'wood');
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        if (dx !== 0 || dz !== 0 || dy === 1) addBlock(x + dx, y + 2 + dy, z + dz, 'leaf');
      }
    }
  }
}

function addBlock(x: number, y: number, z: number, t: string) {
  const k = `${x},${y},${z}`;
  if (blocks.has(k)) return;
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: getColor(t) }));
  m.position.set(x + 0.5, y + 0.5, z + 0.5);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.k = k;
  blocks.set(k, m);
  world.add(m);
}

function getColor(t: string) {
  const c: Record<string, number> = { grass: 0x6edb72, dirt: 0x8b6b3d, stone: 0x8391a5, sand: 0xf4d58d, wood: 0x9a6d3a, leaf: 0x49c169 };
  return c[t] || 0xffffff;
}

function genHeight(x: number, z: number) {
  return Math.max(1, Math.min(8, Math.round(3 + Math.sin(x * 0.4) * 1.5 + Math.cos(z * 0.3) * 1.5)));
}

genTerrain();

let socket: any = null;
let mode = '';

const api = (import.meta.env.VITE_API || 'http://localhost:5173').replace('5173', '3030');

(window as any).game = {
  soloStart() {
    mode = 'solo';
    nameInput.value && (player.avatar.userData.name = nameInput.value);
    menu.classList.add('hidden');
    topbar.classList.remove('hidden');
    controls.classList.remove('hidden');
    buttons.classList.remove('hidden');
    roomCodeSpan.textContent = 'SOLO';
    animate();
  },
  roomCreate() {
    if (!socket) {
      socket = io(api, { transports: ['websocket'] });
      socket.on('roomState', (s: RoomState) => {
        roomCodeSpan.textContent = s.code;
        playerCountSpan.textContent = String(s.players.length);
        console.log('Room state:', s);
      });
      socket.on('playerUpdate', (p: PlayerState) => {
        if (p.id === socket.id) return;
        let a = remotePlayers.get(p.id);
        if (!a) {
          a = createAvatar(p.name, p.color);
          scene.add(a);
          remotePlayers.set(p.id, a);
        }
        a.position.set(p.x, p.y, p.z);
      });
      socket.on('playerLeave', (id: string) => {
        const a = remotePlayers.get(id);
        if (a) scene.remove(a);
        remotePlayers.delete(id);
      });
    }
    socket.emit('createRoom', { name: nameInput.value || 'Explorer' });
    mode = 'room';
    setTimeout(() => {
      if (socket.connected) {
        menu.classList.add('hidden');
        topbar.classList.remove('hidden');
        controls.classList.remove('hidden');
        buttons.classList.remove('hidden');
        animate();
      }
    }, 500);
  },
  roomJoin() {
    if (!socket) {
      socket = io(api, { transports: ['websocket'] });
      socket.on('roomState', (s: RoomState) => {
        roomCodeSpan.textContent = s.code;
        playerCountSpan.textContent = String(s.players.length);
      });
      socket.on('playerUpdate', (p: PlayerState) => {
        if (p.id === socket.id) return;
        let a = remotePlayers.get(p.id);
        if (!a) {
          a = createAvatar(p.name, p.color);
          scene.add(a);
          remotePlayers.set(p.id, a);
        }
        a.position.set(p.x, p.y, p.z);
      });
      socket.on('playerLeave', (id: string) => {
        const a = remotePlayers.get(id);
        if (a) scene.remove(a);
        remotePlayers.delete(id);
      });
    }
    socket.emit('joinRoom', { code: codeInput.value, name: nameInput.value || 'Explorer' });
    mode = 'room';
    setTimeout(() => {
      if (socket.connected) {
        menu.classList.add('hidden');
        topbar.classList.remove('hidden');
        controls.classList.remove('hidden');
        buttons.classList.remove('hidden');
        animate();
      }
    }, 500);
  }
};

jumpBtn.addEventListener('click', () => {
  if (player.onGround) {
    player.vel.y = 8;
    player.onGround = false;
  }
});

mineBtn.addEventListener('click', () => {
  const rc = new THREE.Raycaster(camera.position, camera.getWorldDirection(new THREE.Vector3()));
  const hit = rc.intersectObjects(world.children);
  if (hit.length) {
    const b = hit[0].object as THREE.Mesh;
    const k = b.userData.k;
    if (blocks.has(k)) {
      world.remove(b);
      blocks.delete(k);
    }
  }
});

joyDiv.addEventListener('pointerdown', (e) => {
  const r = joyDiv.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const updateJoy = (e: PointerEvent) => {
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const clamp = Math.min(len, 40);
    const ang = Math.atan2(dy, dx);
    joy.x = Math.cos(ang) * clamp / 40;
    joy.y = Math.sin(ang) * clamp / 40;
    jstick.style.left = `calc(50% + ${Math.cos(ang) * clamp}px)`;
    jstick.style.top = `calc(50% + ${Math.sin(ang) * clamp}px)`;
  };
  const end = () => {
    joy.x = 0;
    joy.y = 0;
    jstick.style.left = '50%';
    jstick.style.top = '50%';
    window.removeEventListener('pointermove', updateJoy);
    window.removeEventListener('pointerup', end);
  };
  updateJoy(e);
  window.addEventListener('pointermove', updateJoy);
  window.addEventListener('pointerup', end);
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'w') keys.w = true;
  if (e.key.toLowerCase() === 'a') keys.a = true;
  if (e.key.toLowerCase() === 's') keys.s = true;
  if (e.key.toLowerCase() === 'd') keys.d = true;
  if (e.shiftKey) keys.shift = true;
  if (e.code === 'Space') jumpBtn.click();
  if (e.key.toLowerCase() === 'e') mineBtn.click();
});

window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() === 'w') keys.w = false;
  if (e.key.toLowerCase() === 'a') keys.a = false;
  if (e.key.toLowerCase() === 's') keys.s = false;
  if (e.key.toLowerCase() === 'd') keys.d = false;
  if (e.key === 'Shift') keys.shift = false;
});

let dragX = 0, dragY = 0, dragging = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  dragX = e.clientX;
  dragY = e.clientY;
});

window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  cam.yaw -= (e.clientX - dragX) * 0.005;
  cam.pitch -= (e.clientY - dragY) * 0.005;
  cam.pitch = Math.max(0.1, Math.min(Math.PI - 0.1, cam.pitch));
  dragX = e.clientX;
  dragY = e.clientY;
});

window.addEventListener('pointerup', () => {
  dragging = false;
});

window.addEventListener('wheel', (e) => {
  cam.dist += e.deltaY * 0.01;
  cam.dist = Math.max(3, Math.min(15, cam.dist));
}, { passive: true });

function animate() {
  requestAnimationFrame(animate);

  const mx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0) + joy.x;
  const mz = (keys.w ? 1 : 0) - (keys.s ? 1 : 0) - joy.y;

  if (mx !== 0 || mz !== 0) {
    const fw = new THREE.Vector3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
    const rg = new THREE.Vector3(fw.z, 0, -fw.x);
    const sp = keys.shift ? 10 : 6;
    player.pos.x += fw.x * -mz * sp * 0.016 + rg.x * mx * sp * 0.016;
    player.pos.z += fw.z * -mz * sp * 0.016 + rg.z * mx * sp * 0.016;
  }

  player.vel.y -= 20 * 0.016;
  player.pos.y += player.vel.y * 0.016;

  const gh = genHeight(Math.round(player.pos.x), Math.round(player.pos.z)) + 2;
  if (player.pos.y <= gh) {
    player.pos.y = gh;
    player.vel.y = 0;
    player.onGround = true;
  } else {
    player.onGround = false;
  }

  if (player.pos.y < -20) player.pos.set(0, genHeight(0, 0) + 2, 0);

  player.avatar.position.copy(player.pos);
  player.avatar.rotation.y = cam.yaw;
  player.avatar.position.y += 0.2;

  const off = new THREE.Vector3(
    Math.sin(cam.yaw) * cam.dist,
    2 + Math.sin(cam.pitch) * cam.dist,
    Math.cos(cam.yaw) * cam.dist
  );
  const tgt = player.pos.clone();
  tgt.y += 1.3;
  camera.position.copy(tgt).add(off);
  camera.lookAt(tgt);

  if (socket && mode === 'room') {
    socket.emit('move', { x: player.pos.x, y: player.pos.y, z: player.pos.z });
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
