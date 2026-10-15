// The drifting network mesh behind the page, after the one on
// mostro.network: nodes that wander around a home position and link to their
// neighbours. It takes the tone of the page (--tone-rgb, set from the banner
// state), so the whole field turns red when Mostros are down. Decoration
// only: it draws nothing a visitor needs, and under prefers-reduced-motion it
// draws a single still frame.

const NODE_DENSITY = 0.00004; // nodes per square pixel
const MAX_NODES = 110;
const LINK_DISTANCE = 200;
const LINE_ALPHA = 0.14;
const NODE_ALPHA = 0.4;
const MAX_PIXEL_RATIO = 2;

/** Nodes for a `width` × `height` field, each with its own wander. */
function makeNodes(width, height, random) {
  const count = Math.min(MAX_NODES, Math.floor(width * height * NODE_DENSITY));
  return Array.from({ length: count }, () => {
    const x = random() * (width + 100) - 50;
    const y = random() * (height + 100) - 50;
    return {
      x, y, homeX: x, homeY: y,
      radius: 1.2 + random() * 1.6,
      range: 25 + random() * 40,
      phase: random() * Math.PI * 2,
      speed: 0.3 + random() * 0.7,
    };
  });
}

function moveNodes(nodes, seconds) {
  for (const n of nodes) {
    const t = seconds * n.speed;
    n.x = n.homeX + Math.sin(t + n.phase) * n.range * 0.6 + Math.cos(t * 0.7 + n.phase * 1.3) * n.range * 0.4;
    n.y = n.homeY + Math.cos(t * 0.8 + n.phase * 0.7) * n.range * 0.6 + Math.sin(t * 0.6 + n.phase * 1.1) * n.range * 0.4;
  }
}

function drawNodes(context, nodes, width, height, rgb) {
  context.clearRect(0, 0, width, height);
  const limit = LINK_DISTANCE * LINK_DISTANCE;
  context.lineWidth = 0.6;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const distance2 = dx * dx + dy * dy;
      if (distance2 >= limit) continue;
      context.strokeStyle = `rgba(${rgb}, ${(1 - Math.sqrt(distance2) / LINK_DISTANCE) * LINE_ALPHA})`;
      context.beginPath();
      context.moveTo(nodes[i].x, nodes[i].y);
      context.lineTo(nodes[j].x, nodes[j].y);
      context.stroke();
    }
  }
  context.fillStyle = `rgba(${rgb}, ${NODE_ALPHA})`;
  for (const n of nodes) {
    context.beginPath();
    context.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
    context.fill();
  }
}

/**
 * Starts the mesh on `canvas`. Its colour is read from --tone-rgb on the
 * root element whenever the page's data-state changes.
 */
export function startMesh(canvas, win = window) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const doc = canvas.ownerDocument;
  const still = win.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0;
  let height = 0;
  let nodes = [];
  let rgb = '140, 198, 63';

  const readTone = () => {
    rgb = win.getComputedStyle(doc.documentElement).getPropertyValue('--tone-rgb').trim() || rgb;
  };
  const resize = () => {
    const ratio = Math.min(win.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    width = win.innerWidth;
    height = win.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    nodes = makeNodes(width, height, Math.random);
  };
  const frame = (time) => {
    moveNodes(nodes, time / 1000);
    drawNodes(context, nodes, width, height, rgb);
    if (!still.matches) win.requestAnimationFrame(frame);
  };

  readTone();
  resize();
  new win.MutationObserver(() => {
    readTone();
    if (still.matches) drawNodes(context, nodes, width, height, rgb);
  }).observe(doc.documentElement, { attributes: true, attributeFilter: ['data-state', 'data-theme'] });
  let resizeTimer = null;
  win.addEventListener('resize', () => {
    win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(() => {
      resize();
      if (still.matches) frame(0);
    }, 200);
  });
  still.addEventListener('change', () => win.requestAnimationFrame(frame));
  win.requestAnimationFrame(frame);
}
