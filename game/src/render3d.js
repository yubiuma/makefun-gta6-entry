// The 3D renderer: three.js draws Azura Bay at night from the same simulation the
// top-down version ran. The world speaks in ground-plane units (x east, y south);
// the scene maps them to (x, up, z), so a simulation angle a becomes a scene yaw of
// -a. Nothing here touches the simulation: draw() reads the world state and the
// frame's ui object, moves meshes and the camera, and paints.
//
// The night look is carried by emissive canvas textures (lit windows, neon signs),
// instanced streetlight pools, headlight glow and blob shadows rather than shadow
// maps or many live lights — one hemisphere light and one moon directional are
// enough, and every frame stays cheap on any GPU.
import * as THREE from 'three';
import { CITY, GARAGE, PALETTE } from './config.js';
import { hash2 } from './geom.js';
import { blockRect, streetCenterX, streetCenterY } from './city.js';
import { SCREEN_TITLE } from './screens.js';

const SKY = 0x0a0e1c;
const FOG_COLOR = 0x0a0e1c;

/** Darken a #rrggbb colour by a factor, for night walls and roofs. */
function shade(hex, factor) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return (r << 16) | (g << 8) | b;
}

/** A radial glow texture (white core fading out), tinted per use by material colour. */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft dark disc texture, for blob shadows under cars and people. */
function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.5)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/**
 * One building facade: a colour canvas (dark wall, dim windows) and its emissive
 * partner (only the lit windows, warm and cool). The window pattern comes from
 * hashes so a given variant looks the same on every building that wears it.
 */
function makeFacade(base, seed) {
  const W = 128;
  const H = 256;
  const mapC = document.createElement('canvas');
  mapC.width = W;
  mapC.height = H;
  const emiC = document.createElement('canvas');
  emiC.width = W;
  emiC.height = H;
  const m = mapC.getContext('2d');
  const e = emiC.getContext('2d');
  m.fillStyle = base;
  m.fillRect(0, 0, W, H);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, W, H);
  // A grime gradient toward the street, so towers sit down into the night.
  const grad = m.createLinearGradient(0, H * 0.7, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.4)');
  m.fillStyle = grad;
  m.fillRect(0, H * 0.7, W, H * 0.3);
  const cols = 6;
  const rows = 14;
  const ww = 11;
  const wh = 9;
  const gapX = (W - cols * ww) / (cols + 1);
  const gapY = (H - rows * wh) / (rows + 1);
  for (let r = 0; r < rows; r += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = gapX + col * (ww + gapX);
      const y = gapY + r * (wh + gapY);
      const lit = hash2(seed * 31 + col, r * 7 + seed) ;
      if (lit > 0.52) {
        const warm = hash2(col * 13 + seed, r * 3) > 0.3;
        const bright = warm ? '#ffd9a0' : '#bcd4ff';
        const dim = warm ? '#8a6c42' : '#5d718c';
        m.fillStyle = dim;
        m.fillRect(x, y, ww, wh);
        e.fillStyle = bright;
        e.fillRect(x, y, ww, wh);
      } else {
        m.fillStyle = '#12161f';
        m.fillRect(x, y, ww, wh);
      }
    }
  }
  const map = new THREE.CanvasTexture(mapC);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(emiC);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

/** A neon sign texture: the place's name in glowing letters on a dark board. */
function makeSignTexture(name, colorHex) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 104;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8, 10, 16, 0.92)';
  g.beginPath();
  g.roundRect(4, 4, 504, 96, 14);
  g.fill();
  g.strokeStyle = colorHex;
  g.lineWidth = 3;
  g.globalAlpha = 0.8;
  g.stroke();
  g.globalAlpha = 1;
  g.font = '800 44px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = colorHex;
  g.shadowBlur = 22;
  g.fillStyle = '#ffffff';
  g.fillText(name, 256, 54);
  g.shadowBlur = 8;
  g.fillStyle = colorHex;
  g.fillText(name, 256, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A small floating name label (Dee, Milo) as a sprite texture. */
function makeLabelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d');
  g.font = '800 34px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)';
  g.shadowBlur = 6;
  g.fillStyle = color;
  g.fillText(text, 128, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The whole city ground in one canvas texture: asphalt streets with lane dashes
 * and crosswalks, pale block pavements, the two parks, the Skypak bay paint and a
 * sand rim where the island meets the water. One texture keeps the ground to a
 * single draw call however busy the frame above it gets.
 */
function makeGroundTexture(city) {
  const S = 2048;
  const k = S / city.size;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const px = (v) => v * k;

  g.fillStyle = '#191c22'; // asphalt everywhere first
  g.fillRect(0, 0, S, S);

  // Blocks: pavement slabs the buildings stand on.
  for (let row = 0; row < CITY.rows; row += 1) {
    for (let col = 0; col < CITY.cols; col += 1) {
      const b = blockRect(col, row);
      g.fillStyle = '#262a31';
      g.fillRect(px(b.x) - 2, px(b.y) - 2, px(b.w) + 4, px(b.h) + 4);
      g.strokeStyle = '#333842';
      g.lineWidth = 2;
      g.strokeRect(px(b.x) - 2, px(b.y) - 2, px(b.w) + 4, px(b.h) + 4);
    }
  }
  // Parks: dark night green.
  for (const park of city.parks) {
    g.fillStyle = '#15231a';
    g.fillRect(px(park.x), px(park.y), px(park.w), px(park.h));
  }

  // Lane dashes along every street centre.
  g.strokeStyle = 'rgba(232, 222, 178, 0.42)';
  g.lineWidth = Math.max(1.4, px(2.2));
  g.setLineDash([px(20), px(18)]);
  for (let i = 0; i <= CITY.cols; i += 1) {
    const x = px(streetCenterX(i));
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, S);
    g.stroke();
    const y = px(streetCenterY(i));
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(S, y);
    g.stroke();
  }
  g.setLineDash([]);

  // Crosswalks: zebra bands across each street mouth at every intersection.
  g.fillStyle = 'rgba(216, 216, 204, 0.20)';
  for (let i = 0; i <= CITY.cols; i += 1) {
    for (let j = 0; j <= CITY.rows; j += 1) {
      const cx = streetCenterX(i);
      const cy = streetCenterY(j);
      for (let s = -2; s <= 2; s += 1) {
        if (s === 0) continue;
        g.fillRect(px(cx + s * 13 - 4), px(cy - CITY.road / 2 + 3), px(8), px(CITY.road - 6));
        g.fillRect(px(cx - CITY.road / 2 + 3), px(cy + s * 13 - 4), px(CITY.road - 6), px(8));
      }
    }
  }

  // The Skypak repair bay, painted where the simulation says it is.
  const gar = city.specials.garage;
  const bayY = gar.y + GARAGE.bayOffsetY;
  g.strokeStyle = '#8fd0e0';
  g.lineWidth = 3.4;
  g.setLineDash([px(14), px(9)]);
  g.strokeRect(px(gar.x - GARAGE.bayRadius), px(bayY - GARAGE.bayRadius), px(GARAGE.bayRadius * 2), px(GARAGE.bayRadius * 2));
  g.setLineDash([]);
  g.fillStyle = 'rgba(143, 208, 224, 0.10)';
  g.fillRect(px(gar.x - GARAGE.bayRadius), px(bayY - GARAGE.bayRadius), px(GARAGE.bayRadius * 2), px(GARAGE.bayRadius * 2));
  g.font = `800 ${Math.round(px(21))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = 'rgba(143, 208, 224, 0.75)';
  g.fillText('REPAIR BAY', px(gar.x), px(bayY + GARAGE.bayRadius - 12));

  // Sand rim around the island edge.
  g.strokeStyle = '#3d362a';
  g.lineWidth = px(26);
  g.strokeRect(0, 0, S, S);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createRenderer(canvas, city) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(FOG_COLOR, 620, 3300);
  const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 7000);

  scene.add(new THREE.HemisphereLight(0x3a4a6e, 0x0a0c10, 1.05));
  const moon = new THREE.DirectionalLight(0xaec4ff, 0.85);
  moon.position.set(-900, 1500, -600);
  scene.add(moon);
  scene.add(new THREE.AmbientLight(0x1c2438, 0.7));

  const glowTex = makeGlowTexture();
  const blobTex = makeBlobTexture();

  // ---------------------------------------------------------- the static city

  // Water all around, and the island slab the city stands on.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(11000, 11000),
    new THREE.MeshLambertMaterial({ color: 0x0d2032 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(city.size / 2, -3, city.size / 2);
  scene.add(water);
  const island = new THREE.Mesh(
    new THREE.BoxGeometry(city.size + 150, 6, city.size + 150),
    new THREE.MeshLambertMaterial({ color: 0x39332a }),
  );
  island.position.set(city.size / 2, -3.05, city.size / 2);
  scene.add(island);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(city.size, city.size),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture(city) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(city.size / 2, 0, city.size / 2);
  scene.add(ground);

  // Stars and a moon, far above the fog line.
  {
    const count = 700;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = hash2(i, 41) * Math.PI * 2;
      const r = 2600 + hash2(i, 42) * 1600;
      pos[i * 3] = city.size / 2 + Math.cos(a) * r;
      pos[i * 3 + 1] = 500 + hash2(i, 43) * 2200;
      pos[i * 3 + 2] = city.size / 2 + Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xcdd8ff, size: 5.5, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8,
    }));
    scene.add(stars);
    const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xdfe8ff, fog: false, transparent: true, opacity: 0.95, depthWrite: false,
    }));
    moonSprite.position.set(city.size / 2 - 2100, 1750, city.size / 2 - 2400);
    moonSprite.scale.set(340, 340, 1);
    scene.add(moonSprite);
  }

  // Buildings: a unit box raised per building, facade variants shared, the roof
  // in the building's own (darkened) colour, a rooftop prop box where the city
  // data carries one, and a neon sign for every named place.
  const facades = ['#3b404c', '#4c4238', '#39434f', '#4a3a46', '#36423c', '#514639']
    .map((base, i) => {
      const { map, emissiveMap } = makeFacade(base, i + 3);
      return new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.95 });
    });
  const roofMats = new Map();
  const roofMat = (hex) => {
    if (!roofMats.has(hex)) roofMats.set(hex, new THREE.MeshLambertMaterial({ color: shade(hex, 0.5) }));
    return roofMats.get(hex);
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.translate(0, 0.5, 0);
  // Regroup the box so the four sides draw with the facade and top/bottom with the roof.
  unitBox.clearGroups();
  unitBox.addGroup(0, 6, 0);
  unitBox.addGroup(6, 6, 0);
  unitBox.addGroup(12, 6, 1);
  unitBox.addGroup(18, 6, 1);
  unitBox.addGroup(24, 6, 0);
  unitBox.addGroup(30, 6, 0);
  const propMat = new THREE.MeshLambertMaterial({ color: 0x23262c });
  const signGroup = new THREE.Group();
  scene.add(signGroup);
  for (const b of city.buildings) {
    const facade = facades[b.index % facades.length];
    const mesh = new THREE.Mesh(unitBox, [facade, roofMat(b.roof)]);
    mesh.position.set(b.x + b.w / 2, 0, b.y + b.h / 2);
    mesh.scale.set(b.w, b.height, b.h);
    scene.add(mesh);
    if (b.prop) {
      const prop = new THREE.Mesh(unitBox, propMat);
      prop.position.set(b.x + b.prop.fx * b.w, b.height, b.y + b.prop.fy * b.h);
      prop.scale.set(b.w * b.prop.fw, 9, b.h * b.prop.fh);
      scene.add(prop);
    }
    if (b.label) {
      const special = Object.values(city.specials).find((s) => s.building === b);
      const neon = special ? special.roof : '#ffc93e';
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(b.w * 0.92, 168), 34),
        new THREE.MeshBasicMaterial({ map: makeSignTexture(b.label, neon), transparent: true }),
      );
      sign.position.set(b.x + b.w / 2, Math.min(b.height * 0.62, 46), b.y + b.h + 1.2);
      signGroup.add(sign);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: new THREE.Color(neon), transparent: true, opacity: 0.30, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      glow.position.set(b.x + b.w / 2, Math.min(b.height * 0.62, 46), b.y + b.h + 4);
      glow.scale.set(210, 74, 1);
      signGroup.add(glow);
    }
  }

  // Streetlights: instanced posts and heads, plus an instanced pool of light on
  // the asphalt under each one.
  {
    const lamps = city.lamps;
    const postGeo = new THREE.CylinderGeometry(0.9, 1.2, 30, 6);
    postGeo.translate(0, 15, 0);
    const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0x2c3036 }), lamps.length);
    const headGeo = new THREE.SphereGeometry(2.6, 8, 6);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }), lamps.length);
    const poolGeo = new THREE.CircleGeometry(34, 20);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
      map: glowTex, color: 0xffbe78, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
    }), lamps.length);
    const dummy = new THREE.Object3D();
    lamps.forEach((lamp, i) => {
      dummy.position.set(lamp.x, 0, lamp.y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 30;
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 0.12;
      dummy.updateMatrix();
      pools.setMatrixAt(i, dummy.matrix);
    });
    scene.add(posts, heads, pools);
  }

  // Trees in the parks: instanced trunks and dark canopies.
  {
    const trees = city.trees;
    const trunkGeo = new THREE.CylinderGeometry(1.4, 2, 12, 6);
    trunkGeo.translate(0, 6, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x2e241c }), trees.length);
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: 0x14251a }), trees.length);
    const dummy = new THREE.Object3D();
    trees.forEach((tree, i) => {
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(tree.x, 0, tree.y);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 12 + tree.r * 0.8;
      dummy.scale.set(tree.r * 1.25, tree.r * 1.5, tree.r * 1.25);
      dummy.updateMatrix();
      canopies.setMatrixAt(i, dummy.matrix);
    });
    scene.add(trunks, canopies);
  }

  // ---------------------------------------------------------- dynamic things

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // Blob shadows for every car and person, one instanced mesh.
  const MAX_CARS = 72;
  const MAX_PEOPLE = 52;
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(blobGeo, new THREE.MeshBasicMaterial({
    map: blobTex, transparent: true, opacity: 0.5, depthWrite: false,
  }), MAX_CARS + MAX_PEOPLE);
  blobs.renderOrder = 1;
  scene.add(blobs);

  // Wheels for every car, one instanced mesh; each wheel's matrix is composed
  // from its car's transform plus a spin that accumulates with distance rolled.
  const wheelGeo = new THREE.CylinderGeometry(5.6, 5.6, 4.2, 12);
  wheelGeo.rotateX(Math.PI / 2);
  const wheels = new THREE.InstancedMesh(wheelGeo, new THREE.MeshLambertMaterial({ color: 0x14161a }), MAX_CARS * 4);
  scene.add(wheels);
  const yawQ = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);

  // Headlight and taillight glow points for every car, one Points cloud.
  const glowCount = MAX_CARS * 4;
  const glowPos = new Float32Array(glowCount * 3);
  const glowCol = new Float32Array(glowCount * 3);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.BufferAttribute(glowCol, 3));
  const carGlows = new THREE.Points(glowGeo, new THREE.PointsMaterial({
    map: glowTex, size: 17, transparent: true, depthWrite: false, vertexColors: true,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  carGlows.renderOrder = 3;
  scene.add(carGlows);

  // Car bodies: one pooled group per car the world can field.
  const bodyMats = new Map();
  const bodyMat = (hex) => {
    if (!bodyMats.has(hex)) bodyMats.set(hex, new THREE.MeshLambertMaterial({ color: shade(hex, 0.92) }));
    return bodyMats.get(hex);
  };
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x2a3a55, transparent: true, opacity: 0.62 });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x1d2026 });
  const goldMat = new THREE.MeshLambertMaterial({ color: 0xd9a83c, emissive: 0x694d10, emissiveIntensity: 0.6 });
  const lightBarRed = new THREE.MeshBasicMaterial({ color: 0xff4545 });
  const lightBarBlue = new THREE.MeshBasicMaterial({ color: 0x4d7cff });
  const patchMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: 0xffedb8, transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  const bodyGeo = new THREE.BoxGeometry(46, 10, 22);
  const cabinGeo = new THREE.BoxGeometry(23, 8.5, 19.5);
  const stripeGeo = new THREE.BoxGeometry(46.4, 3.6, 22.4);
  const barBaseGeo = new THREE.BoxGeometry(13, 2.6, 20);
  const barLightGeo = new THREE.BoxGeometry(11, 3, 7.5);
  const patchGeo = new THREE.PlaneGeometry(120, 52);
  patchGeo.rotateX(-Math.PI / 2);

  function makeCarMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, trimMat);
    body.position.y = 9;
    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.position.set(-1.5, 18, 0);
    const stripe = new THREE.Mesh(stripeGeo, trimMat);
    stripe.position.y = 6.2;
    stripe.visible = false;
    const barBase = new THREE.Mesh(barBaseGeo, trimMat);
    barBase.position.set(-1.5, 23.4, 0);
    barBase.visible = false;
    const barRed = new THREE.Mesh(barLightGeo, lightBarRed);
    barRed.position.set(-1.5, 24.6, -5.4);
    barRed.visible = false;
    const barBlue = new THREE.Mesh(barLightGeo, lightBarBlue);
    barBlue.position.set(-1.5, 24.6, 5.4);
    barBlue.visible = false;
    const patch = new THREE.Mesh(patchGeo, patchMat);
    patch.position.set(74, 0.14, 0);
    patch.renderOrder = 2;
    group.add(body, cabin, stripe, barBase, barRed, barBlue, patch);
    group.visible = false;
    scene.add(group);
    return { group, body, stripe, barBase, barRed, barBlue, patch };
  }
  const carMeshes = [];
  for (let i = 0; i < MAX_CARS; i += 1) carMeshes.push(makeCarMesh());

  // People: a pooled capsule body and head per pedestrian, plus the named cast.
  const personBodyGeo = new THREE.CapsuleGeometry(5.6, 11, 3, 10);
  const personHeadGeo = new THREE.SphereGeometry(4.7, 10, 8);
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc9a186 });
  function makePerson(colorHex) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(personBodyGeo, bodyMat(colorHex));
    body.position.y = 12.6;
    const head = new THREE.Mesh(personHeadGeo, skinMat);
    head.position.y = 27.4;
    group.add(body, head);
    group.visible = false;
    scene.add(group);
    return group;
  }
  const pedMeshes = [];
  for (let i = 0; i < MAX_PEOPLE; i += 1) pedMeshes.push(makePerson('#888888'));
  const playerMesh = makePerson(PALETTE.player);
  playerMesh.visible = false;
  scene.add(playerMesh);
  const deeMesh = makePerson(PALETTE.npc);
  const deeLabel = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeLabelTexture('DEE VOSS', '#ff9ec7'), transparent: true, depthWrite: false,
  }));
  deeLabel.scale.set(66, 14.5, 1);
  deeMesh.add(deeLabel);
  deeLabel.position.y = 40;
  scene.add(deeMesh);
  const miloMesh = makePerson('#4fb8c9');
  const miloLabel = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeLabelTexture('MILO', '#9fe8f4'), transparent: true, depthWrite: false,
  }));
  miloLabel.scale.set(44, 9.6, 1);
  miloMesh.add(miloLabel);
  miloLabel.position.y = 40;
  scene.add(miloMesh);
  // Heads that ride inside the player's car: Rook driving, Milo alongside.
  const driverHead = new THREE.Mesh(personHeadGeo, skinMat);
  const passengerHead = new THREE.Mesh(personHeadGeo, skinMat);
  driverHead.visible = false;
  passengerHead.visible = false;
  scene.add(driverHead, passengerHead);

  // Bullets and particles, instanced from the simulation's own pools.
  const bulletMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(17, 1.7, 1.7),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
    72,
  );
  scene.add(bulletMesh);
  const particleMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 5),
    new THREE.MeshBasicMaterial({ toneMapped: true }),
    260,
  );
  scene.add(particleMesh);

  // The mission marker: a gold beam, a pulsing ground ring and a bobbing diamond.
  const markerGroup = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, 150, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc93e, transparent: true, opacity: 0.09, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 75;
  const ringGeo = new THREE.RingGeometry(17, 23.5, 36);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
    color: 0xffc93e, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  ring.position.y = 0.18;
  ring.renderOrder = 2;
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(7.5), new THREE.MeshBasicMaterial({ color: 0xffc93e }));
  diamond.position.y = 48;
  markerGroup.add(beam, ring, diamond);
  markerGroup.visible = false;
  scene.add(markerGroup);

  // The garage ring lights up when the player's car sits in the bay.
  const bay = { x: city.specials.garage.x, y: city.specials.garage.y + GARAGE.bayOffsetY, r: GARAGE.bayRadius };
  const bayRingGeo = new THREE.RingGeometry(bay.r - 5, bay.r + 1, 44);
  bayRingGeo.rotateX(-Math.PI / 2);
  const bayRing = new THREE.Mesh(bayRingGeo, new THREE.MeshBasicMaterial({
    color: 0x8fd0e0, transparent: true, opacity: 0.3, depthWrite: false,
  }));
  bayRing.position.set(bay.x, 0.16, bay.y);
  bayRing.renderOrder = 2;
  scene.add(bayRing);

  // ---------------------------------------------------------- the camera rig

  /** Where the camera is and which way it looks, in simulation coordinates —
   *  the HUD reads this to place its off-screen marker arrow. */
  const cameraState = { x: city.size / 2, y: city.size / 2, angle: 0 };
  const camPos = new THREE.Vector3(city.size / 2, 90, city.size / 2 + 200);
  const camLook = new THREE.Vector3(city.size / 2, 0, city.size / 2);
  let rigSnapped = false;
  let lastScreen = null;
  let lastNow = performance.now();

  function placeCamera(world, ui, dt) {
    const state = world.state;
    const player = state.player;
    const spec = ui.camera ?? null;
    let tx;
    let ty;
    let tz;
    let lx;
    let ly;
    let lz;
    let snap = !rigSnapped || lastScreen !== ui.screen;
    if (spec && spec.mode === 'fixed') {
      tx = spec.x; tz = spec.y; ty = spec.height;
      lx = spec.lookX; lz = spec.lookY; ly = spec.lookHeight ?? 12;
      snap = true;
    } else if (spec && spec.mode === 'orbit') {
      const a = spec.phase + state.time * 0.045;
      tx = spec.x + Math.cos(a) * spec.radius;
      tz = spec.y + Math.sin(a) * spec.radius;
      ty = spec.height;
      lx = spec.x; lz = spec.y; ly = 26;
    } else if (ui.screen === SCREEN_TITLE) {
      const n = city.specials.noodle;
      const a = -0.65 + state.time * 0.045;
      tx = n.x + Math.cos(a) * 305;
      tz = n.y + Math.sin(a) * 305;
      ty = 128;
      lx = n.x; lz = n.y; ly = 24;
    } else if (player.inCar && player.car) {
      const car = player.car;
      const dist = spec?.dist ?? 120 + Math.abs(car.speed) * 0.05;
      const height = spec?.height ?? 54;
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      tx = car.x - fx * dist;
      tz = car.y - fy * dist;
      ty = height;
      lx = car.x + fx * (spec?.lookAhead ?? 95);
      lz = car.y + fy * (spec?.lookAhead ?? 95);
      ly = 10;
      const targetFov = 62 + Math.min(9, Math.abs(car.speed) / 48);
      if (Math.abs(camera.fov - targetFov) > 0.2) {
        camera.fov += (targetFov - camera.fov) * 0.06;
        camera.updateProjectionMatrix();
      }
    } else {
      const dist = spec?.dist ?? 88;
      const height = spec?.height ?? 46;
      const fx = Math.cos(player.angle);
      const fy = Math.sin(player.angle);
      tx = player.x - fx * dist;
      tz = player.y - fy * dist;
      ty = height;
      lx = player.x + fx * 46;
      lz = player.y + fy * 46;
      ly = 16;
      if (Math.abs(camera.fov - 62) > 0.2) {
        camera.fov += (62 - camera.fov) * 0.06;
        camera.updateProjectionMatrix();
      }
    }
    if (snap || dt <= 0) {
      camPos.set(tx, ty, tz);
      camLook.set(lx, ly, lz);
    } else {
      const kp = 1 - Math.exp(-dt * 5.2);
      const kl = 1 - Math.exp(-dt * 7.5);
      camPos.x += (tx - camPos.x) * kp;
      camPos.y += (ty - camPos.y) * kp;
      camPos.z += (tz - camPos.z) * kp;
      camLook.x += (lx - camLook.x) * kl;
      camLook.y += (ly - camLook.y) * kl;
      camLook.z += (lz - camLook.z) * kl;
    }
    // Never sink into a building or under the street.
    camPos.y = Math.max(camPos.y, 7);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    cameraState.x = camPos.x;
    cameraState.y = camPos.z;
    cameraState.angle = Math.atan2(camLook.z - camPos.z, camLook.x - camPos.x);
    rigSnapped = true;
    lastScreen = ui.screen;
  }

  // ---------------------------------------------------------- per-frame sync

  function syncCars(state, time) {
    const flashPhase = Math.floor(time * 2.6) % 2 === 0;
    lightBarRed.color.setHex(flashPhase ? 0xff4545 : 0x571616);
    lightBarBlue.color.setHex(flashPhase ? 0x27355e : 0x4d7cff);
    let wheelI = 0;
    let glowI = 0;
    state.cars.forEach((car, i) => {
      const mesh = carMeshes[i];
      if (!mesh) return;
      mesh.group.visible = true;
      mesh.group.position.set(car.x, 0, car.y);
      mesh.group.rotation.y = -car.angle;
      mesh.body.material = car.kind === 'showpiece' ? goldMat : bodyMat(car.color);
      const isPolice = car.kind === 'police';
      mesh.stripe.visible = isPolice;
      mesh.barBase.visible = isPolice;
      mesh.barRed.visible = isPolice;
      mesh.barBlue.visible = isPolice;
      mesh.patch.visible = car.health > 0;
      // A wreck sits dark and low; a healthy car rides at its full height.
      mesh.group.position.y = car.health <= 0 ? -2.2 : 0;

      car._spin = (car._spin ?? 0) + (car.speed * (1 / 60)) / 5.6;
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      const sx = -fy;
      const sy = fx;
      for (const [lx, lz] of [[15.5, 11.4], [15.5, -11.4], [-15.5, 11.4], [-15.5, -11.4]]) {
        dummy.position.set(car.x + fx * lx + sx * lz, 5.6, car.y + fy * lx + sy * lz);
        yawQ.setFromAxisAngle(Y_AXIS, -car.angle);
        spinQ.setFromAxisAngle(Z_AXIS, -car._spin);
        dummy.quaternion.copy(yawQ).multiply(spinQ);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        wheels.setMatrixAt(wheelI, dummy.matrix);
        wheelI += 1;
      }
      // Blob shadow.
      dummy.position.set(car.x, 0.09, car.y);
      dummy.quaternion.setFromAxisAngle(Y_AXIS, -car.angle);
      dummy.scale.set(56, 1, 32);
      dummy.updateMatrix();
      blobs.setMatrixAt(i, dummy.matrix);

      // Headlight (warm) and taillight (red) glow points.
      const lit = car.health > 0;
      const setGlow = (lx, lz, y, r, g, b) => {
        glowPos[glowI * 3] = car.x + fx * lx + sx * lz;
        glowPos[glowI * 3 + 1] = y;
        glowPos[glowI * 3 + 2] = car.y + fy * lx + sy * lz;
        glowCol[glowI * 3] = lit ? r : 0;
        glowCol[glowI * 3 + 1] = lit ? g : 0;
        glowCol[glowI * 3 + 2] = lit ? b : 0;
        glowI += 1;
      };
      setGlow(23.6, 7, 9, 1.0, 0.93, 0.72);
      setGlow(23.6, -7, 9, 1.0, 0.93, 0.72);
      setGlow(-23.6, 7, 9.5, 0.85, 0.12, 0.1);
      setGlow(-23.6, -7, 9.5, 0.85, 0.12, 0.1);
    });
    for (let i = state.cars.length; i < MAX_CARS; i += 1) {
      if (carMeshes[i]) carMeshes[i].group.visible = false;
      dummy.position.set(0, -50, 0);
      dummy.scale.set(0.001, 0.001, 0.001);
      dummy.quaternion.identity();
      dummy.updateMatrix();
      blobs.setMatrixAt(i, dummy.matrix);
      for (let w = 0; w < 4; w += 1) wheels.setMatrixAt(i * 4 + w, dummy.matrix);
      for (let gp = 0; gp < 4; gp += 1) {
        const gi = i * 4 + gp;
        glowPos[gi * 3 + 1] = -50;
        glowCol[gi * 3] = 0; glowCol[gi * 3 + 1] = 0; glowCol[gi * 3 + 2] = 0;
      }
    }
    wheels.count = MAX_CARS * 4;
    wheels.instanceMatrix.needsUpdate = true;
    carGlows.geometry.attributes.position.needsUpdate = true;
    carGlows.geometry.attributes.color.needsUpdate = true;
  }

  function syncPeople(state, ui, time) {
    let blobI = MAX_CARS;
    state.peds.forEach((ped, i) => {
      const mesh = pedMeshes[i];
      if (!mesh) return;
      const gone = ped.dead && ped.fade <= 0.02;
      mesh.visible = !gone;
      if (gone) return;
      mesh.children[0].material = bodyMat(ped.color);
      mesh.position.set(ped.x, 0, ped.y);
      mesh.rotation.y = -ped.angle;
      if (ped.state === 'down') {
        mesh.rotation.x = Math.PI / 2 - 0.12;
        mesh.position.y = -4;
      } else {
        mesh.rotation.x = 0;
        const moving = ped.state === 'flee' || Math.hypot(ped.targetX - ped.x, ped.targetY - ped.y) > 14;
        mesh.position.y = moving ? Math.abs(Math.sin(time * 9 + i * 1.7)) * 1.6 : 0;
      }
      dummy.position.set(ped.x, 0.1, ped.y);
      dummy.quaternion.identity();
      dummy.scale.set(15, 1, 15);
      dummy.updateMatrix();
      blobs.setMatrixAt(blobI, dummy.matrix);
      blobI += 1;
    });
    for (let i = state.peds.length; i < MAX_PEOPLE; i += 1) {
      if (pedMeshes[i]) pedMeshes[i].visible = false;
    }
    // Dee, always at her spot outside the noodle bar.
    deeMesh.position.set(state.npc.x, 0, state.npc.y);
    deeMesh.rotation.y = -state.npc.angle;
    // Milo, while he waits at the Marina.
    if (ui.cousin) {
      miloMesh.visible = true;
      miloMesh.position.set(ui.cousin.x, Math.abs(Math.sin(time * 2.2)) * 0.8, ui.cousin.y);
      miloMesh.rotation.y = -Math.PI / 2;
    } else {
      miloMesh.visible = false;
    }
    // The player: a body on foot, two heads in a car.
    const player = state.player;
    if (player.inCar && player.car) {
      playerMesh.visible = false;
      const car = player.car;
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      const sx = -fy;
      const sy = fx;
      driverHead.visible = true;
      driverHead.position.set(car.x + fx * -4 + sx * -5, 18.6, car.y + fy * -4 + sy * -5);
      passengerHead.visible = Boolean(ui.passenger);
      passengerHead.position.set(car.x + fx * -4 + sx * 5, 18.6, car.y + fy * -4 + sy * 5);
    } else {
      driverHead.visible = false;
      passengerHead.visible = false;
      playerMesh.visible = true;
      playerMesh.position.set(player.x, 0, player.y);
      playerMesh.rotation.y = -player.angle;
      const moving = player.speedMag > 12;
      playerMesh.position.y = moving ? Math.abs(Math.sin(time * 10.5)) * 1.7 : 0;
      dummy.position.set(player.x, 0.1, player.y);
      dummy.quaternion.identity();
      dummy.scale.set(15, 1, 15);
      dummy.updateMatrix();
      blobs.setMatrixAt(blobI, dummy.matrix);
      blobI += 1;
    }
    // Park any unused blob slots far below the island.
    for (let i = blobI; i < MAX_CARS + MAX_PEOPLE; i += 1) {
      dummy.position.set(0, -50, 0);
      dummy.scale.set(0.001, 0.001, 0.001);
      dummy.quaternion.identity();
      dummy.updateMatrix();
      blobs.setMatrixAt(i, dummy.matrix);
    }
    blobs.instanceMatrix.needsUpdate = true;
  }

  function syncEffects(state, ui, time) {
    // Bullets.
    let bi = 0;
    for (const b of state.bullets) {
      if (!b.active) continue;
      dummy.position.set(b.x, 11, b.y);
      dummy.quaternion.setFromAxisAngle(Y_AXIS, -Math.atan2(b.vy, b.vx));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bulletMesh.setMatrixAt(bi, dummy.matrix);
      bi += 1;
    }
    bulletMesh.count = bi;
    bulletMesh.instanceMatrix.needsUpdate = true;
    // Particles: smoke climbs as it ages, sparks hug the ground.
    let pi = 0;
    for (const p of state.particles) {
      if (!p.active) continue;
      const frac = p.life / p.maxLife;
      const smoke = p.color === '#3a3f46' || p.color === '#9aa0a6';
      dummy.position.set(p.x, (smoke ? 9 + (1 - frac) * 36 : 6), p.y);
      const s = Math.max(0.2, p.size * Math.min(1, frac * 2.2));
      dummy.scale.set(s, s, s);
      dummy.quaternion.identity();
      dummy.updateMatrix();
      particleMesh.setMatrixAt(pi, dummy.matrix);
      particleMesh.setColorAt(pi, tmpColor.set(p.color));
      pi += 1;
    }
    particleMesh.count = pi;
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    // The mission marker.
    if (ui.marker && ui.screen !== SCREEN_TITLE) {
      markerGroup.visible = true;
      markerGroup.position.set(ui.marker.x, 0, ui.marker.y);
      const pulse = 1 + Math.sin(time * 5) * 0.13;
      ring.scale.set(pulse, 1, pulse);
      diamond.position.y = 48 + Math.sin(time * 2.4) * 5;
      diamond.rotation.y = time * 1.8;
    } else {
      markerGroup.visible = false;
    }
    bayRing.material.opacity = ui.garageActive ? 0.55 + Math.sin(time * 6) * 0.25 : 0.28;
  }

  // ---------------------------------------------------------- public face

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();

  /** The simulation ground point under a client (mouse) position, or null. */
  function toGround(clientX, clientY) {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, hitPoint);
    if (!hit) return null;
    return { x: hitPoint.x, y: hitPoint.z };
  }

  /** Paint one frame. ui: {screen, marker, objective, prompt, banner, carrying,
   *  passenger, timer, meter, cousin, garageActive, muted, saveExists,
   *  saveSummary, camera?}. The HUD itself is DOM (hud.js); this draws the world. */
  function draw(world, ui) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const state = world.state;
    syncCars(state, state.time);
    syncPeople(state, ui, state.time);
    syncEffects(state, ui, state.time);
    placeCamera(world, ui, dt);
    renderer.render(scene, camera);
  }

  return { draw, cameraState, toGround };
}
