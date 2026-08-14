// The contributed map, on the ground.
//
// WHAT THIS DRAWS, AND WHY IT IS THE THING THAT WAS MISSING
//   Forty-two public features that an islander walked to and pinned himself: twenty bus stops on the
//   two routes this twin already runs buses along, three water treatment plants, the tip and its
//   metal and green waste bays, the council depot, the ambulance station, two toilet blocks, the
//   fishing jetty, the skate park, the BMX track, the courts, Myora Springs and the shark-proof
//   swimming enclosure in the bay at Amity Point.
//
//   All of it was already in a data pack, screened, reconciled and provenanced to a standard nothing
//   else in this repository reaches, and none of it was on screen. A critic flew the island, opened
//   four screenshots and found no jetty, no boat ramp, no bus stop, no swimming enclosure and no
//   toilet block, and said the correct thing: everything the slice did well was invisible and
//   everything it did not do was what a player experiences.
//
// HOW IT READS AS A MARKER RATHER THAN AS A BUILDING
//   These are not scanned objects and this project does not know what any of them look like. So they
//   are drawn as what they are: survey markers. A slender post with a canted plate on top, sized in
//   real metres up close and held to a floor of a few pixels from far away, so from orbit they read
//   as pins on the island and at head height they stand next to you at the right size. Nothing here
//   pretends to be a model of a building, because inventing the shape of a real shed on a real
//   island is exactly the kind of small lie this project does not tell.
//
//   Bus stops get their own shape, because a bus stop is the one piece of street furniture on this
//   island a person navigates by: a pole with a flag panel facing the road. The flag warms when a
//   published departure from that stop is inside ten minutes, and goes out again when the bus has
//   gone, which is a thing a player can notice without being told.
//
// TELLING FORTY-TWO THINGS APART, WHICH IS WHAT THIS LAYER FAILED AT
//   A critic flew the island at five hundred metres and found nine identical yellow squares. Every
//   bus stop wore `--sun`, the interface's attention colour, all day and all night, twenty of them
//   in a row along one road, including the fifteen with no bus for hours. So the brightest colour in
//   the palette meant "bus stop" rather than "look at this", and an island of different public
//   things read as one repeated thing.
//
//   Three changes, and they work together. Every marker takes the quiet colour of the family the
//   contributor filed it under, out of his own folders, so the four families that reach the world
//   are four colours and four plate shapes. Every kind wears a pictogram of itself, drawn into an
//   atlas at boot in vector paths with no font and no file, so a water treatment plant is a drop and
//   a tip is a bin and neither is a dot. And `--sun` is spent on exactly one state: a stop with a
//   published departure inside ten minutes, which grows a quarter and becomes the brightest thing in
//   the view because it is the only thing on this layer that is about to matter.
//
// NAMING THEM
//   `TWIN.shot()` captures the canvas and the canvas cannot contain text this project would trust,
//   so the names are DOM nameplates projected onto the canvas: the nearest fourteen, inside two and
//   a half kilometres, sorted so the selected one always survives. Same technique as the cutaway
//   overlay in src/render/layers/underground.js and for the same reason.
//
// WHAT IT NEVER SHOWS
//   Open, closed, running, staffed, serviced or safe. Every one of these records says in its own
//   fields that current state is the one thing the contributor could not vouch for. The marker says
//   the thing is there. The panel says who put it there and when. Nothing says how it is today.
//
// Reads: contributed, daylight, weather, selection, world.island. Draws nothing headless.

const B = (typeof window !== 'undefined' && window.BABYLON) ? window.BABYLON : null;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Marker tints, from src/ui/design.css. The same seven words the rest of the interface uses.
 *
 * A fall-back only. The colour a marker actually wears comes off its own record as `plate`, set by
 * the family the contributor filed it under, in src/systems/infrastructure/contributed.js. This
 * table stays so that a record arriving without one still lands on a sensible colour.
 */
const TONE = {
  sea: [0.247, 0.714, 0.769],
  sun: [0.941, 0.706, 0.161],
  coral: [0.886, 0.447, 0.357],
  leaf: [0.561, 0.749, 0.353],
  heath: [0.706, 0.541, 0.769],
  iron: [0.549, 0.600, 0.639],
  sand: [0.910, 0.863, 0.769]
};

/** `--sun`. Spent on one state and no other: a stop with a published bus inside ten minutes. */
const SUN = TONE.sun;

const POST = [0.28, 0.30, 0.32];      // galvanised post
const PLATE_BACK = [0.16, 0.17, 0.18];

const CAP = 96;                        // there are 42. The ceiling is headroom, not a target.
const LABELS = 16;
/**
 * How many pixels across a pin head is, whatever the zoom.
 *
 * Twenty-four, of which the sign itself is about twenty-one: the same legible dot as before, with
 * the extra three pixels of transparent margin the atlas cell needs so bilinear filtering has
 * something to fade into rather than the next cell along.
 */
const PIN_PX = 24;

/* ------------------------------------------------------------------ geometry

Built in metres with the pivot on the ground, so an instance scale of 1 is the real thing. Same
mesh helpers as src/render/layers/eventsite.js, kept local because a shared geometry module would
couple two layers that have no business knowing about each other. */

function mesh() { return { pos: [], nrm: [], col: [], uv: [], idx: [] }; }

function box(m, cx, cy, cz, w, h, d, col) {
  const faces = [
    { o: [0, 0, -0.5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
    { o: [0, 0, 0.5], u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
    { o: [-0.5, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
    { o: [0.5, 0, 0], u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
    { o: [0, 0.5, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
    { o: [0, -0.5, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0] }
  ];
  for (const f of faces) {
    const base = m.pos.length / 3;
    for (const [su, sv] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      m.pos.push(
        cx + f.o[0] * w + f.u[0] * su * w + f.v[0] * sv * w,
        cy + f.o[1] * h + f.u[1] * su * h + f.v[1] * sv * h,
        cz + f.o[2] * d + f.u[2] * su * d + f.v[2] * sv * d
      );
      m.nrm.push(f.n[0], f.n[1], f.n[2]);
      m.col.push(col[0], col[1], col[2]);
      // A post carries no sign, so it samples the transparent corner of its cell and comes out as
      // galvanised pipe. Only the plate faces below are given real coordinates.
      m.uv.push(0, 0);
    }
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/**
 * A flat quad from four corners, both sides given the same colour.
 *
 * `uvs` is four pairs in the same corner order, and it is what turns a blank plate into a sign: the
 * fragment shader prints that patch of the glyph atlas onto it. Omit it and the quad is plain.
 */
function quad(m, p0, p1, p2, p3, n, col, uvs) {
  const base = m.pos.length / 3;
  const corners = [p0, p1, p2, p3];
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    m.pos.push(p[0], p[1], p[2]);
    m.nrm.push(n[0], n[1], n[2]);
    m.col.push(col[0], col[1], col[2]);
    m.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
  }
  m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function finish(m) {
  return {
    pos: new Float32Array(m.pos), nrm: new Float32Array(m.nrm),
    col: new Float32Array(m.col), uv: new Float32Array(m.uv), idx: new Uint16Array(m.idx)
  };
}

/**
 * The survey marker: a 60 mm post to 2.4 m with a 420 mm plate canted back off the top, and a
 * small collar at the base so it reads as driven into the ground rather than resting on it. The
 * plate face carries the instance tint; its back and the post do not, so a marker reads as a marker
 * from behind and as a coloured disc from in front.
 */
function markerMesh() {
  const m = mesh();
  const h = 2.4;
  box(m, 0, h / 2, 0, 0.06, h, 0.06, POST);
  box(m, 0, 0.10, 0, 0.30, 0.20, 0.30, PLATE_BACK);
  // The plate: two quads back to back, canted 14 degrees so it catches the sun from above. The
  // front one is square and takes the whole cell, so the pictogram on it is the same drawing you
  // read as a dot from orbit, at 420 mm instead of twenty pixels.
  const y0 = h - 0.02, w = 0.21, tilt = 0.052;
  quad(m,
    [-w, y0 - w + tilt, -0.035], [w, y0 - w + tilt, -0.035],
    [w, y0 + w - tilt, 0.035], [-w, y0 + w - tilt, 0.035],
    [0, 0.26, -0.97], [1, 1, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  quad(m,
    [w, y0 - w + tilt, -0.045], [-w, y0 - w + tilt, -0.045],
    [-w, y0 + w - tilt, 0.025], [w, y0 + w - tilt, 0.025],
    [0, -0.26, 0.97], PLATE_BACK);
  return finish(m);
}

/**
 * A bus stop: a 2.9 m pole with a 300 by 460 flag panel at the top, the plate that carries the route
 * number on a real one. The panel takes the tint and the lamp, so a stop with a bus due lights its
 * flag. There is no seat and no shelter: most stops on this island have neither, and drawing one
 * would be inventing street furniture.
 *
 * The panel is taller than it is wide, so the atlas cell is sampled over a centred band rather than
 * stretched: a round sign on a tall sign face has to stay round. Both faces carry the glyph, the
 * back one mirrored, so the stop reads as a stop from either side of the road.
 */
function busStopMesh() {
  const m = mesh();
  const h = 2.9;
  box(m, 0, h / 2, 0, 0.07, h, 0.07, POST);
  box(m, 0, 0.09, 0, 0.34, 0.18, 0.34, PLATE_BACK);
  const top = h - 0.06, w = 0.15, hh = 0.23;
  const inset = (1 - (w * 2) / (hh * 2)) / 2;          // keeps the cell square on a 300 by 460 face
  const lo = inset, hi = 1 - inset;
  quad(m, [-w, top - hh * 2, 0.045], [w, top - hh * 2, 0.045], [w, top, 0.045], [-w, top, 0.045],
    [0, 0, 1], [1, 1, 1], [[0, hi], [1, hi], [1, lo], [0, lo]]);
  quad(m, [w, top - hh * 2, -0.045], [-w, top - hh * 2, -0.045], [-w, top, -0.045], [w, top, -0.045],
    [0, 0, -1], [1, 1, 1], [[1, hi], [0, hi], [0, lo], [1, lo]]);
  return finish(m);
}

/**
 * The pin head: a unit quad, turned to face the camera in the vertex shader and sized in pixels
 * rather than in metres.
 *
 * This exists because a post cannot win an argument with a 39 km island. The planner camera opens
 * sixteen kilometres up, where a metre is a fifteenth of a pixel, and a 2.4 m marker post scaled up
 * enough to be eight pixels tall is still a fifth of a pixel wide, which is nothing at all. So from
 * a distance the marker is a map pin: a coloured disc of a fixed size on screen, exactly the way an
 * atlas marks a town, and it fades out as you come down so that what you are standing next to at
 * head height is a real post at its real size and not a floating badge.
 */
function pinMesh() {
  const m = mesh();
  quad(m, [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1], [1, 1, 1]);
  return finish(m);
}

/* ================================================================== the glyph atlas

WHY THERE IS A TEXTURE IN A LAYER THAT HAD NONE

A critic flew this at five hundred metres and found nine identical yellow squares where an island of
different public things should have been. Twenty bus stops, three water treatment plants, a tip, an
ambulance station and a swimming enclosure all reduced to the same dot, and the brightest colour in
the palette spent on every one of them including the fifteen with no bus for hours.

Colour alone cannot carry eighteen kinds. Four families of colour can carry four families, and shape
can carry a bit more, but the thing that actually tells a person a plant from a tip from a jetty is
a picture of it. So the layer draws its own: nineteen pictograms, in vector paths on a canvas, at
boot, offline, into one 512 by 256 texture. No font is used, because a font is a file this project
does not have and a glyph that arrives differently on two machines is a glyph that cannot be trusted.

HOW THE CHANNELS WORK
  alpha  where the sign is at all
  red    1 where the family colour goes, 0 where the ink goes

One texture then serves both the map pin, where the sign is a coloured dot with a dark picture in
it, and the physical plate on the post at head height, where it is the same picture at 420 mm. When
a stop has a bus inside ten minutes the same cell is drawn in `--sun` instead, which is how the
attention colour gets spent on the one thing that has earned it. */

const CELL = 64;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;
const ATLAS_W = CELL * ATLAS_COLS;
const ATLAS_H = CELL * ATLAS_ROWS;
const R = 26;                     // sign radius inside the cell, leaving a margin for bilinear
const BORDER = 0.20;              // the dark rim, as a fraction of R
const U = R * (1 - BORDER) * 0.68; // the glyph half-extent, inside the coloured core

const TINT = 'rgba(255,0,0,1)';   // red channel high: the family colour lands here
const INK = 'rgba(0,0,0,1)';      // red channel zero: stays dark whatever the family is

/**
 * How much room a plate shape leaves the pictogram inside it.
 *
 * A diamond of radius r has an inscribed square only 0.7 r across, so a glyph drawn to the edge of
 * its own box lands outside the plate at the corners: ink on nothing, which reads as a broken sign
 * rather than a picture. Written per shape rather than fixed per glyph, so a glyph that moves
 * family keeps working.
 */
const SHAPE_ROOM = { circle: 1, square: 1, hex: 0.95, diamond: 0.80 };

/** The four plate shapes, one per family, because shape reads before colour at twenty pixels. */
function platePath(g, r, shape) {
  g.beginPath();
  if (shape === 'square') {
    const k = r * 0.34;
    g.moveTo(-r + k, -r);
    g.arcTo(r, -r, r, -r + k, k); g.arcTo(r, r, r - k, r, k);
    g.arcTo(-r, r, -r, r - k, k); g.arcTo(-r, -r, -r + k, -r, k);
    g.closePath();
  } else if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.94;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  } else if (shape === 'diamond') {
    g.moveTo(0, -r); g.lineTo(r * 0.92, 0); g.lineTo(0, r); g.lineTo(-r * 0.92, 0);
    g.closePath();
  } else {
    g.arc(0, 0, r, 0, Math.PI * 2);
  }
}

/* The pictograms. Each draws inside a box of plus or minus one, scaled by U, with the origin at the
   centre of the sign. Ink is the drawing; painting in TINT over ink puts the family colour back,
   which is how a bus gets windows without a second texture. */

const rect = (g, x0, y0, x1, y1) => { g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.fill(); };
const disc = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const poly = (g, pts) => {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath(); g.fill();
};

const GLYPH = {
  dot(g) { disc(g, 0, 0, 0.52); },

  bus(g) {
    g.fillStyle = INK;
    g.beginPath();
    const k = 0.22;
    g.moveTo(-0.72 + k, -0.66);
    g.arcTo(0.72, -0.66, 0.72, -0.66 + k, k); g.arcTo(0.72, 0.5, 0.72 - k, 0.5, k);
    g.arcTo(-0.72, 0.5, -0.72, 0.5 - k, k); g.arcTo(-0.72, -0.66, -0.72 + k, -0.66, k);
    g.closePath(); g.fill();
    disc(g, -0.44, 0.62, 0.24); disc(g, 0.44, 0.62, 0.24);
    g.fillStyle = TINT;
    rect(g, -0.5, -0.42, -0.05, -0.02); rect(g, 0.05, -0.42, 0.5, -0.02);
    rect(g, -0.5, 0.16, 0.5, 0.3);
  },

  plane(g) {
    poly(g, [[0, -0.92], [0.16, -0.5], [0.16, -0.1], [0.92, 0.32], [0.92, 0.5], [0.16, 0.3],
      [0.16, 0.62], [0.4, 0.82], [0.4, 0.94], [0, 0.82], [-0.4, 0.94], [-0.4, 0.82],
      [-0.16, 0.62], [-0.16, 0.3], [-0.92, 0.5], [-0.92, 0.32], [-0.16, -0.1], [-0.16, -0.5]]);
  },

  jetty(g) {
    rect(g, -0.92, -0.42, 0.92, -0.18);
    for (const x of [-0.62, -0.1, 0.42]) rect(g, x, -0.18, x + 0.16, 0.42);
    g.lineWidth = 0.17; g.strokeStyle = INK; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.92, 0.72); g.quadraticCurveTo(-0.46, 0.42, 0, 0.72); g.quadraticCurveTo(0.46, 1.0, 0.92, 0.72);
    g.stroke();
  },

  drop(g) {
    g.beginPath();
    g.moveTo(0, -0.95);
    g.bezierCurveTo(0.66, -0.16, 0.72, 0.34, 0, 0.92);
    g.bezierCurveTo(-0.72, 0.34, -0.66, -0.16, 0, -0.95);
    g.fill();
  },

  spring(g) {
    disc(g, 0, -0.5, 0.3);
    g.lineWidth = 0.16; g.strokeStyle = INK; g.lineCap = 'round';
    for (const r of [0.34, 0.62, 0.9]) {
      g.beginPath(); g.arc(0, 0.02, r, Math.PI * 0.14, Math.PI * 0.86); g.stroke();
    }
  },

  bin(g) {
    g.fillStyle = INK;
    rect(g, -0.8, -0.76, 0.8, -0.5);
    rect(g, -0.22, -0.95, 0.22, -0.76);
    poly(g, [[-0.62, -0.42], [0.62, -0.42], [0.48, 0.9], [-0.48, 0.9]]);
    g.fillStyle = TINT;
    rect(g, -0.28, -0.24, -0.1, 0.68); rect(g, 0.1, -0.24, 0.28, 0.68);
  },

  bays(g) {
    // Two open-topped bays side by side, which is the shape of a separated bay at a transfer
    // station and, at twenty pixels, is not the shape of the courts.
    g.lineWidth = 0.17; g.strokeStyle = INK; g.lineJoin = 'miter';
    for (const x of [-0.48, 0.48]) {
      g.beginPath();
      g.moveTo(x - 0.38, -0.52); g.lineTo(x - 0.38, 0.56);
      g.lineTo(x + 0.38, 0.56); g.lineTo(x + 0.38, -0.52);
      g.stroke();
    }
  },

  shed(g) {
    g.fillStyle = INK;
    poly(g, [[-0.96, -0.1], [0, -0.88], [0.96, -0.1]]);
    rect(g, -0.76, -0.1, 0.76, 0.86);
    g.fillStyle = TINT;
    rect(g, -0.34, 0.16, 0.34, 0.86);
  },

  cross(g) { rect(g, -0.27, -0.9, 0.27, 0.9); rect(g, -0.9, -0.27, 0.9, 0.27); },

  phone(g) {
    // A handset: flared at both ends, narrow through the middle, tilted the way one sits in a
    // cradle. Drawn as one outline rather than two circles and a bar, which came out as a bone.
    g.save(); g.rotate(-0.7);
    poly(g, [[-0.92, -0.36], [-0.3, -0.36], [-0.22, -0.06], [0.22, -0.06], [0.3, -0.36],
      [0.92, -0.36], [0.92, 0.22], [0.36, 0.22], [0.22, 0.38], [-0.22, 0.38], [-0.36, 0.22],
      [-0.92, 0.22]]);
    g.restore();
  },

  toilet(g) {
    disc(g, -0.44, -0.6, 0.24);
    poly(g, [[-0.68, -0.24], [-0.2, -0.24], [-0.28, 0.9], [-0.6, 0.9]]);
    disc(g, 0.44, -0.6, 0.24);
    poly(g, [[0.2, -0.24], [0.68, -0.24], [0.8, 0.42], [0.08, 0.42]]);
    rect(g, 0.26, 0.42, 0.62, 0.9);
    rect(g, -0.03, -0.86, 0.03, 0.9);
  },

  net(g) {
    g.lineWidth = 0.16; g.strokeStyle = INK;
    g.beginPath(); g.arc(0, 0, 0.82, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 0.11;
    for (const d of [-0.4, 0.4]) {
      g.beginPath(); g.moveTo(d, -0.72); g.lineTo(d, 0.72); g.stroke();
      g.beginPath(); g.moveTo(-0.72, d); g.lineTo(0.72, d); g.stroke();
    }
  },

  court(g) {
    // A court seen from above, with the net across it and a ball on one side. Thin lines: the first
    // version drew a thick outline with three thick verticals inside and read as a barcode.
    g.lineWidth = 0.13; g.strokeStyle = INK;
    g.strokeRect(-0.8, -0.54, 1.6, 1.08);
    g.beginPath(); g.moveTo(0, -0.74); g.lineTo(0, 0.74); g.stroke();
    disc(g, 0.42, 0, 0.16);
  },

  posts(g) {
    rect(g, -0.5, -0.95, -0.28, 0.9);
    rect(g, 0.28, -0.95, 0.5, 0.9);
    rect(g, -0.5, -0.34, 0.5, -0.14);
  },

  ramp(g) {
    g.beginPath();
    g.moveTo(-0.95, 0.9); g.lineTo(0.95, 0.9); g.lineTo(0.95, -0.75);
    g.quadraticCurveTo(0.3, 0.55, -0.95, 0.62);
    g.closePath(); g.fill();
  },

  bike(g) {
    g.lineWidth = 0.16; g.strokeStyle = INK;
    g.beginPath(); g.arc(-0.5, 0.32, 0.5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0.5, 0.32, 0.5, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 0.13; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.5, 0.32); g.lineTo(-0.06, -0.42); g.lineTo(0.5, 0.32);
    g.moveTo(-0.06, -0.42); g.lineTo(0.42, -0.42);
    g.stroke();
  },

  tree(g) {
    rect(g, -0.15, 0.06, 0.15, 0.9);
    disc(g, 0, -0.34, 0.56);
    disc(g, -0.4, 0.02, 0.36); disc(g, 0.4, 0.02, 0.36);
  },

  wave(g) {
    g.lineWidth = 0.2; g.strokeStyle = INK; g.lineCap = 'round';
    for (const y of [-0.5, 0.02]) {
      g.beginPath();
      g.moveTo(-0.78, y); g.quadraticCurveTo(-0.39, y - 0.36, 0, y);
      g.quadraticCurveTo(0.39, y + 0.36, 0.78, y);
      g.stroke();
    }
    g.lineWidth = 0.24;
    g.beginPath(); g.moveTo(-0.78, 0.56); g.lineTo(0.78, 0.56); g.stroke();
  }
};

/**
 * Draw the whole atlas once and hand back the pixels plus the cell each sign landed in.
 *
 * `wanted` is the list of shape-and-glyph pairs actually on the ground, so an island that grows a
 * new kind gets a new cell and an island that has none of something spends no texture on it.
 */
function buildAtlas(wanted) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const index = new Map();
  let cell = 0;
  for (const key of wanted) {
    if (cell >= ATLAS_COLS * ATLAS_ROWS) break;
    const [shape, glyph] = key.split(':');
    const cx = (cell % ATLAS_COLS) * CELL + CELL / 2;
    const cy = Math.floor(cell / ATLAS_COLS) * CELL + CELL / 2;
    g.save();
    g.translate(cx, cy);
    // The plate: an ink shape with a slightly smaller tinted one inside it, which gives the rim
    // without a stroke and therefore without a stroke's half-outside-the-path surprise.
    g.fillStyle = INK;
    platePath(g, R, shape);
    g.fill();
    g.fillStyle = TINT;
    platePath(g, R * (1 - BORDER), shape);
    g.fill();
    // The pictogram, in a box of plus or minus one, shrunk to whatever this plate shape can hold.
    g.save();
    g.scale(U * (SHAPE_ROOM[shape] || 1), U * (SHAPE_ROOM[shape] || 1));
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.lineJoin = 'round';
    (GLYPH[glyph] || GLYPH.dot)(g);
    g.restore();
    g.restore();
    index.set(key, cell);
    cell++;
  }
  const px = g.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
  return { data: new Uint8Array(px), index, cells: cell };
}

/* ------------------------------------------------------------------ shaders

The same light model the marquees, the houses and the people use, so a marker standing beside a
house is lit by the same sun and sits in the same haze. */

const COMMON_LIGHT = `
uniform vec3 uCam;
uniform vec4 uSun;
uniform vec4 uSunCol;
uniform vec4 uSky;
uniform vec4 uSkyHz;
uniform vec4 uTune;
vec3 litColour(vec3 base, vec3 N, vec3 P) {
  float ndl = max(dot(N, uSun.xyz), 0.0);
  ndl = ndl * 0.86 + pow(max(dot(N, uSun.xyz) * 0.5 + 0.5, 0.0), 2.0) * 0.14;
  vec3 sun = uSunCol.rgb * uSunCol.a * ndl;
  vec3 sky = mix(uSkyHz.rgb, uSky.rgb, 0.30) * (0.42 + 0.34 * clamp(N.y, 0.0, 1.0));
  float sideways = clamp(1.0 - abs(N.y), 0.0, 1.0);
  vec3 bounce = vec3(0.88, 0.82, 0.70) * uSunCol.rgb * uSunCol.a
    * (0.09 + 0.24 * sideways + 0.20 * clamp(-N.y, 0.0, 1.0));
  return base * (sun + sky + bounce);
}
vec3 hazed(vec3 col, vec3 P) {
  float dist = length(P - uCam);
  float fog = 1.0 - exp(-dist * uTune.x);
  vec3 hz = mix(uSkyHz.rgb, uSky.rgb, 0.3);
  return mix(col, hz, fog * 0.86);
}
`;

/** Cell index to the patch of atlas it occupies. Shared by both shaders, in one place. */
const CELL_UV = `
uniform vec4 uAtlas;    // cols, rows, 0, 0
vec2 cellUv(float cell, vec2 within) {
  float col = mod(cell, uAtlas.x);
  float row = floor(cell / uAtlas.x + 0.0001);
  return (vec2(col, row) + within) / uAtlas.xy;
}
`;

const MARK_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec2 uv;      // 0..1 across the sign face, (0,0) on everything else
attribute vec4 iPos;    // x, y, z, yaw
attribute vec4 iSize;   // x uniform scale, y selected 0..1, z hover 0..1, w atlas cell
attribute vec4 iTint;   // rgb plate tint, a lamp 0..1
uniform mat4 viewProjection;
${CELL_UV}
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec2 vUv;
varying float vLamp;
varying float vMark;
varying float vPlate;

void main(void) {
  vec3 p = position * iSize.x;
  float c = cos(iPos.w), s = sin(iPos.w);
  vec3 pr = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 n = normal;
  vec3 nr = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  vPos = pr + iPos.xyz;
  vNrm = normalize(nr);
  // The plate is the only white-vertex part of either mesh, so the tint lands on the plate and
  // nowhere else. One mesh, two materials' worth of look, no second draw call.
  float isPlate = step(0.995, min(min(colour.r, colour.g), colour.b));
  vCol = mix(colour, iTint.rgb, isPlate);
  vLamp = iTint.a * isPlate;
  vMark = max(iSize.y, iSize.z * 0.55);
  vPlate = isPlate;
  vUv = cellUv(iSize.w, uv);
  gl_Position = viewProjection * vec4(vPos, 1.0);
}
`;

const MARK_FRAG = `
precision highp float;
uniform sampler2D uAtlasTex;
varying vec3 vPos;
varying vec3 vNrm;
varying vec3 vCol;
varying vec2 vUv;
varying float vLamp;
varying float vMark;
varying float vPlate;
${COMMON_LIGHT}
void main(void) {
  // The pictogram, printed on the sign face. Red high in the atlas means the family colour goes
  // there and red low means ink, so the picture stays dark whatever colour the sign is, including
  // when a stop turns --sun because a bus is coming.
  vec4 sign_ = texture2D(uAtlasTex, vUv);
  float on = sign_.a * vPlate;
  vec3 base = mix(vCol, mix(vec3(0.05, 0.07, 0.08), vCol, sign_.r), on);
  vec3 col = litColour(base, normalize(vNrm), vPos);
  // After dark a lit plate is the only thing you can see of a marker, and a bus stop with a bus due
  // lifts further. Off in daylight: at noon a marker is lit by the sun like everything else.
  col += base * vec3(1.0, 0.92, 0.72) * vLamp * (1.0 - uSun.w) * 1.1;
  // Selected or hovered: a cool rim, the same --sea the selection band uses.
  col += vec3(0.247, 0.714, 0.769) * vMark * 0.55;
  gl_FragColor = vec4(hazed(col, vPos), 1.0);
}
`;

const PIN_VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec3 colour;
attribute vec2 uv;
attribute vec4 iPos;    // x, y, z, unused
attribute vec4 iSize;   // x size in metres, y selected, z hover, w alpha
attribute vec4 iTint;   // rgb, a atlas cell
uniform mat4 viewProjection;
uniform vec3 uRight;
uniform vec3 uUp;
${CELL_UV}
varying vec2 vUv;
varying vec3 vCol;
varying float vMark;
varying float vAlpha;
void main(void) {
  // The quad runs from -0.5 to 0.5. The atlas runs top down, so v is flipped once here rather than
  // at upload, where it would flip the whole sheet and every cell with it.
  vUv = cellUv(iTint.a, vec2(position.x + 0.5, 0.5 - position.y));
  vCol = iTint.rgb;
  vMark = max(iSize.y, iSize.z * 0.6);
  vAlpha = iSize.w;
  vec3 p = iPos.xyz + (uRight * position.x + uUp * position.y) * iSize.x;
  gl_Position = viewProjection * vec4(p, 1.0);
}
`;

const PIN_FRAG = `
precision highp float;
uniform sampler2D uAtlasTex;
varying vec2 vUv;
varying vec3 vCol;
varying float vMark;
varying float vAlpha;
void main(void) {
  // One texture read is the whole pin: the family's plate shape, its dark rim, and the pictogram
  // for the kind knocked out of it. Nineteen different things at twenty pixels, from one draw call.
  vec4 sign_ = texture2D(uAtlasTex, vUv);
  float a = sign_.a * vAlpha;
  if (a < 0.02) discard;
  vec3 col = mix(vec3(0.04, 0.07, 0.09), vCol, sign_.r);
  col = mix(col, vec3(0.247, 0.714, 0.769), vMark * 0.7);
  col += vec3(1.0) * vMark * 0.25;
  gl_FragColor = vec4(col, a);
}
`;

/* ================================================================== the layer */

export function registerContributedLayer(world) {
  const state = world.publish('contributedlayer', {
    rendered: false,
    markers: 0,
    busStops: 0,
    /** Distinct signs drawn into the glyph atlas: one per family shape and kind pictogram in use. */
    signs: 0,
    lit: 0,
    labels: 0,
    drawCalls: 0,
    scale: 1,
    camAltM: 0,
    notes: []
  });

  world.register({
    id: 'contributedlayer',
    phase: 'presentation',
    order: 42,
    describe() {
      return {
        rendered: state.rendered,
        markers: state.markers,
        busStops: state.busStops,
        signs: state.signs,
        lit: state.lit,
        labels: state.labels,
        camAltM: state.camAltM,
        drawCalls: state.drawCalls
      };
    }
  });

  if (!world.stage || !B) return;

  const stage = world.stage;
  const island = world.island;

  const blank = () => ({
    pos: new Float32Array(CAP * 4), size: new Float32Array(CAP * 4),
    tint: new Float32Array(CAP * 4), mat: new Float32Array(CAP * 16), n: 0
  });
  const buf = { marker: blank(), stop: blank(), pin: blank() };
  for (const k of Object.keys(buf)) {
    for (let i = 0; i < CAP; i++) {
      const o = i * 16;
      buf[k].mat[o] = 1; buf[k].mat[o + 5] = 1; buf[k].mat[o + 10] = 1; buf[k].mat[o + 15] = 1;
    }
  }

  const meshes = {};
  const mats = {};
  let ready = false;
  let overlay = null;
  const labelPool = [];

  const vCam = new B.Vector3();
  const vSun = new B.Vector4(0, 1, 0, 1);
  const vSunCol = new B.Vector4(1, 1, 1, 1);
  const vSky = new B.Vector4(0.3, 0.5, 0.8, 0.2);
  const vSkyHz = new B.Vector4(0.6, 0.7, 0.8, 0.4);
  const vTune = new B.Vector4(1e-5, 0, 0, 0);
  const vRight = new B.Vector3(1, 0, 0);
  const vUp = new B.Vector3(0, 1, 0);

  const ATTRS = ['position', 'normal', 'colour', 'uv', 'world0', 'world1', 'world2', 'world3', 'iPos', 'iSize', 'iTint'];
  const vAtlas = new B.Vector4(ATLAS_COLS, ATLAS_ROWS, 0, 0);
  let atlasTex = null;

  function material(name) {
    return new B.ShaderMaterial(name, stage.scene,
      { vertexSource: MARK_VERT, fragmentSource: MARK_FRAG },
      {
        attributes: ATTRS,
        uniforms: ['viewProjection', 'uCam', 'uSun', 'uSunCol', 'uSky', 'uSkyHz', 'uTune', 'uAtlas'],
        samplers: ['uAtlasTex']
      });
  }

  function pinMaterial(name) {
    const m = new B.ShaderMaterial(name, stage.scene,
      { vertexSource: PIN_VERT, fragmentSource: PIN_FRAG },
      {
        attributes: ATTRS,
        uniforms: ['viewProjection', 'uRight', 'uUp', 'uAtlas'],
        samplers: ['uAtlasTex']
      });
    m.backFaceCulling = false;
    m.needAlphaBlending = () => true;
    // Drawn last and writing no depth, so a pin never punches a hole in the sea behind it, and
    // still tested against depth, so a pin behind a ridge is behind the ridge.
    m.disableDepthWrite = true;
    return m;
  }

  function realise(name, data, material_) {
    const m = new B.Mesh(name, stage.scene);
    const vd = new B.VertexData();
    vd.positions = data.pos;
    vd.normals = data.nrm;
    vd.uvs = data.uv;
    vd.indices = data.idx;
    vd.applyToMesh(m, false);
    m.setVerticesData('colour', data.col, false, 3);
    m.material = material_;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    return m;
  }

  /**
   * Which way a marker faces.
   *
   * A bus stop faces the road, because that is where a person reads it from and because a flag panel
   * seen edge on is a stick. The road is the nearest point on the navigation graph if there is one,
   * and the fall-back is the downhill direction, which on this island points at the water and is
   * where somebody standing at a jetty or an enclosure would be. Deterministic either way: no
   * hashing, no randomness, the same yaw in every replay.
   */
  function yawFor(f) {
    const net = world.read('roadNetwork');
    if (net && typeof net.nearestPoint === 'function') {
      const near = net.nearestPoint(f.x, f.z);
      if (near && near.distanceM < 90) {
        const dx = near.x - f.x, dz = near.z - f.z;
        if (dx || dz) return Math.atan2(dx, dz);
      }
    }
    if (!island) return 0;
    const e = 12;
    const gx = island.height(f.x + e, f.z) - island.height(f.x - e, f.z);
    const gz = island.height(f.x, f.z + e) - island.height(f.x, f.z - e);
    return (gx || gz) ? Math.atan2(-gx, -gz) : 0;
  }

  const items = [];

  function build() {
    const c = world.read('contributed');
    if (!c || !c.ready) return false;
    if (!c.features.length) {
      state.notes.push('The contributed pack is loaded and holds nothing this build may draw.');
      return false;
    }
    // Which signs this island actually needs, in a stable order so the atlas is the same sheet on
    // every run. Sorted by the key rather than by encounter order, because encounter order is pack
    // order and a pack edit would silently reshuffle every cell.
    const wanted = new Set();
    for (const f of c.features) wanted.add(`${f.shape || 'circle'}:${f.glyph || 'dot'}`);
    const atlas = buildAtlas([...wanted].sort());
    atlasTex = new B.RawTexture(atlas.data, ATLAS_W, ATLAS_H, B.Engine.TEXTUREFORMAT_RGBA,
      stage.scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
    atlasTex.wrapU = atlasTex.wrapV = B.Texture.CLAMP_ADDRESSMODE;
    state.signs = atlas.cells;

    for (const f of c.features) {
      if (items.length >= CAP * 2) break;
      const isStop = f.kind === 'bus_stop';
      items.push({
        f,
        bucket: isStop ? 'stop' : 'marker',
        yaw: yawFor(f),
        // Ground it against the heightfield rather than the record's own y: the pack carries a
        // latitude and a longitude and nothing about elevation, and the terrain is what a player
        // sees a post standing on.
        y: island ? island.height(f.x, f.z) - 0.06 : 0,
        // The family's own quiet colour, from his own folder, out of the read model. The attention
        // colour is not in this table: it is applied per frame, to a stop with a bus due, and to
        // nothing else on the island.
        tint: Array.isArray(f.plate) ? f.plate : (TONE[f.tone] || TONE.sand),
        cell: atlas.index.get(`${f.shape || 'circle'}:${f.glyph || 'dot'}`) || 0
      });
    }
    items.sort((a, b) => (a.f.id < b.f.id ? -1 : 1));
    state.markers = items.filter((i) => i.bucket === 'marker').length;
    state.busStops = items.filter((i) => i.bucket === 'stop').length;
    return true;
  }

  /* ---------------------------------------------------------------- the overlay */

  function buildOverlay() {
    if (overlay) return;
    injectCss();
    const root = document.createElement('div');
    root.id = 'cm-labels';
    root.setAttribute('aria-hidden', 'true');
    const host = document.getElementById('ui-root') || document.body;
    host.append(root);
    overlay = root;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const _proj = new B.Vector3();
  const _lab = new B.Vector3();
  const _ident = B.Matrix.Identity();
  const _shown = [];

  /**
   * How far out a nameplate is worth putting up.
   *
   * Not a constant. The planner camera opens sixteen kilometres above the island, so a fixed range
   * of two and a half kilometres named nothing at all in the view a player actually opens on, which
   * is the view a critic screenshots. It scales with how far the camera is from what it is looking
   * at: close in you get the things around you, from orbit you get the sixteen nearest to the eye,
   * which is what a map does.
   */
  function labelRange(camAlt) {
    return clamp(camAlt * 3.2 + 700, 1400, 46000);
  }

  function paintLabels(perMetre, camAlt) {
    if (!overlay) return;
    const scene = stage.scene;
    const cam = scene.activeCamera;
    if (!cam) return;
    const eng = stage.engine;
    const vp = cam.viewport.toGlobal(eng.getRenderWidth(), eng.getRenderHeight());
    const tm = scene.getTransformMatrix();
    const camPos = cam.globalPosition || cam.position;
    const sel = world.read('selection');
    const contributed = world.read('contributed');
    const range = labelRange(camAlt);
    const near = range * 0.16;

    _shown.length = 0;
    for (const it of items) {
      const d = Math.hypot(camPos.x - it.f.x, camPos.y - it.y, camPos.z - it.f.z);
      if (d > range) continue;
      _shown.push({ it, d, near: d < near, sel: sel && sel.kind === 'facility' && sel.id === it.f.id });
    }
    _shown.sort((a, b) => (b.sel ? 1 : 0) - (a.sel ? 1 : 0) || a.d - b.d);
    const take = _shown.slice(0, LABELS);
    state.labels = take.length;

    while (labelPool.length < LABELS) {
      const el = document.createElement('div');
      el.className = 'cm-label';
      overlay.append(el);
      labelPool.push(el);
    }
    for (let i = 0; i < labelPool.length; i++) {
      const el = labelPool[i];
      const row = take[i];
      if (!row) { el.style.display = 'none'; continue; }
      const it = row.it;
      // Anchored to the pin head, which is where the eye already is.
      const scale = clamp(perMetre * row.d * 3.4, 1, 8);
      _lab.set(it.f.x, it.y + Math.max(3.4, 2.9 * scale) + perMetre * row.d * (PIN_PX * 0.6), it.f.z);
      B.Vector3.ProjectToRef(_lab, _ident, tm, vp, _proj);
      if (_proj.z < 0 || _proj.z > 1) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${Math.round(_proj.x)}px, ${Math.round(_proj.y)}px)`;
      // A departure, when there is a published one for this stop. Nothing else is live, because
      // nothing else about these records is known to be current.
      let sub = it.f.kindLabel;
      let due = false;
      if (it.bucket === 'stop' && contributed) {
        if (typeof contributed.departuresAt === 'function' && contributed.hasBoard(it.f.id)) {
          const next = contributed.departuresAt(it.f.id, 1)[0];
          if (next) {
            sub = `${next.routeLabel} ${next.at_text} towards ${next.towards}`;
            due = next.inMinutes <= 10;
          }
        } else if (typeof contributed.runsAt === 'function') {
          // A stop the timetable does not name gets the run rather than a minute, because the run
          // is published and the minute is not. A range reads as a range.
          const run = contributed.runsAt(it.f.id, 1)[0];
          if (run) sub = `${run.routeLabel} run ${run.calls[0].at_text} to ${run.calls[run.calls.length - 1].at_text}`;
        }
      }
      el.className = 'cm-label' + (row.sel ? ' on' : '') + (due ? ' due' : '')
        + (row.near || row.sel || due ? '' : ' far');
      el.innerHTML = `<b>${esc(it.f.name)}</b><span>${esc(sub)}</span>`;
    }
  }

  /* ---------------------------------------------------------------- the layer */

  stage.addLayer({
    id: 'contributed',
    order: 44,

    /**
     * Nothing is built here.
     *
     * `stage.addLayer` runs a layer's init the moment it is added, which is while the manifest is
     * still being walked and long before `world.boot()` has run a single system's init. So a layer
     * that reads a read model in its own init reads an empty one, and the first version of this file
     * did exactly that and drew nothing while reporting itself rendered. The meshes are built on the
     * first frame after the system publishes, which is one branch and no ordering assumption.
     */
    init() {
      buildOverlay();
    },

    frame(st, w, dt) {
      if (!ready) {
        const c = w.read('contributed');
        if (!c || !c.ready || !c.features.length) return;
        if (!build()) return;
        mats.mark = material('contributed-mark');
        mats.pin = pinMaterial('contributed-pin');
        for (const m of [mats.mark, mats.pin]) {
          m.setVector4('uAtlas', vAtlas);
          m.setTexture('uAtlasTex', atlasTex);
        }
        meshes.marker = realise('contributed-markers', markerMesh(), mats.mark);
        meshes.stop = realise('contributed-busstops', busStopMesh(), mats.mark);
        meshes.pin = realise('contributed-pins', pinMesh(), mats.pin);
        meshes.pin.alphaIndex = 20;
        for (const k of Object.keys(meshes)) {
          meshes[k].thinInstanceSetBuffer('matrix', buf[k].mat, 16, false);
          meshes[k].thinInstanceSetBuffer('iPos', buf[k].pos, 4, false);
          meshes[k].thinInstanceSetBuffer('iSize', buf[k].size, 4, false);
          meshes[k].thinInstanceSetBuffer('iTint', buf[k].tint, 4, false);
          meshes[k].thinInstanceCount = 0;
        }
        ready = true;
        state.rendered = true;
        state.drawCalls = 3;
        console.info(`[contributed] ${state.markers} markers and ${state.busStops} bus stops, `
          + `${state.signs} different signs in one atlas: three draw calls.`);
      }

      const cam = st.scene.activeCamera;
      vCam.copyFrom(cam.globalPosition || cam.position);
      const dl = w.read('daylight');
      const wx = w.read('weather');
      const alt = dl ? dl.altitude : 0.9;
      const az = dl ? dl.azimuth : 0.4;
      const sy = Math.sin(alt), cy = Math.cos(alt);
      vSun.set(cy * Math.sin(az), sy, cy * Math.cos(az), clamp((sy + 0.06) / 0.22, 0, 1));
      const cloud = wx ? wx.cloud : 0.2;
      const warm = clamp((sy - 0.02) / 0.30, 0, 1);
      const dayF = vSun.w;
      vSunCol.set(1.0, 0.40 + 0.56 * warm, 0.16 + 0.74 * warm, (0.06 + 1.14 * dayF) * (1 - cloud * 0.55));
      vSky.set(0.012 + 0.19 * dayF, 0.024 + 0.40 * dayF, 0.055 + 0.72 * dayF, cloud);
      vSkyHz.set(
        0.030 + (0.60 + 0.36 * (1 - warm)) * dayF,
        0.045 + (0.70 - 0.16 * (1 - warm)) * dayF,
        0.085 + (0.86 - 0.52 * (1 - warm)) * dayF,
        0.4
      );
      const visKm = wx ? clamp(wx.visibilityKm, 2, 60) : 30;
      vTune.set(clamp(0.62 / (visKm * 1000), 6.0e-6, 4e-4), 0, 0, island ? island.seaLevel : 0);
      mats.mark.setVector3('uCam', vCam);
      mats.mark.setVector4('uSun', vSun);
      mats.mark.setVector4('uSunCol', vSunCol);
      mats.mark.setVector4('uSky', vSky);
      mats.mark.setVector4('uSkyHz', vSkyHz);
      mats.mark.setVector4('uTune', vTune);

      /* --- how big a marker is on screen ---

      Real metres up close, and a screen-size floor from far away, because a 2.4 m post seen from the
      sixteen kilometres the planner camera opens at is a tenth of a pixel and the island would show
      none of its public things in the one view everybody looks at first. Walk in and it shrinks back
      to a real 2.4 m post standing on real ground beside you.

      Per marker, from that marker's own distance to the eye, not once for the whole layer from the
      camera's distance to the world origin. The first version did the latter, and flying to Amity
      Point left every marker there sized for a camera seventeen kilometres away, because the origin
      of the projection is off the west coast and the camera had not moved relative to it. */
      const h = st.engine.getRenderHeight() || 900;
      const perMetre = (2 * Math.tan((cam.fov || 0.8) * 0.5)) / h;   // metres per pixel, per metre of range
      const camAlt = Math.max(20, vCam.y - (island ? island.height(vCam.x, vCam.z) : 0));
      let nearestScale = 1;
      let nearestD = Infinity;

      // The billboard basis for the pin heads: the camera's own X and Y axes in world space, out of
      // its world matrix. Not the view matrix, which the scene does not always have to hand.
      const wm = cam.getWorldMatrix().m;
      vRight.set(wm[0], wm[1], wm[2]);
      vUp.set(wm[4], wm[5], wm[6]);
      mats.pin.setVector3('uRight', vRight);
      mats.pin.setVector3('uUp', vUp);

      const sel = w.read('selection');
      const contributed = w.read('contributed');
      const dark = 1 - dayF;
      let lit = 0;

      for (const k of Object.keys(buf)) buf[k].n = 0;
      for (const it of items) {
        const b = buf[it.bucket];
        if (b.n >= CAP) continue;
        const d = Math.max(20, Math.hypot(vCam.x - it.f.x, vCam.y - (it.y + 2.4), vCam.z - it.f.z));
        const mpp = perMetre * d;

        /* --- the one thing wearing the attention colour ---

        Every marker on this island now carries its family's own quiet plate, and exactly one state
        takes `--sun`: a bus stop with a published departure inside ten minutes. Before this, all
        twenty stops wore it all day, so the colour that means look here meant bus stop, which is
        the same as meaning nothing. A stop that is about to be useful is now the brightest thing
        in the view and the only one, and it grows a quarter so it carries at five hundred metres. */
        let tint = it.tint;
        let lamp = dark * 0.35;
        let due = false;
        if (it.bucket === 'stop' && contributed && typeof contributed.departuresAt === 'function'
          && contributed.hasBoard(it.f.id)) {
          const next = contributed.departuresAt(it.f.id, 1)[0];
          if (next && next.inMinutes <= 10) {
            tint = SUN; lamp = Math.max(lamp, 0.9); due = true; lit++;
          }
        }

        // Capped low on purpose. Beyond a few hundred metres the pin head takes over the job of
        // being seen, and a post that kept growing would stand a hundred metres over the township
        // like a mast, which is a different and much worse picture than a marker.
        const scale = clamp(mpp * 3.4, 1, 8);
        if (d < nearestD) { nearestD = d; nearestScale = scale; }
        const o = b.n * 4;
        b.pos[o] = it.f.x; b.pos[o + 1] = it.y; b.pos[o + 2] = it.f.z; b.pos[o + 3] = it.yaw;
        const selected = sel && sel.kind === 'facility' && sel.id === it.f.id ? 1 : 0;
        const hovered = sel && sel.hover && sel.hover.kind === 'facility' && sel.hover.id === it.f.id ? 1 : 0;
        b.size[o] = scale; b.size[o + 1] = selected; b.size[o + 2] = hovered; b.size[o + 3] = it.cell;
        b.tint[o] = tint[0]; b.tint[o + 1] = tint[1]; b.tint[o + 2] = tint[2]; b.tint[o + 3] = lamp;
        b.n++;

        // The pin head, per marker, sized in pixels and faded out as you walk up to the thing.
        const p = buf.pin;
        if (p.n >= CAP) continue;
        const q = p.n * 4;
        // Fades in from about fifty metres out. Closer than that a 2.9 m post beside a road is the
        // right size and the honest picture; further out a bus stop is four pixels of galvanised
        // pipe and the pin is the only thing that can be seen at all.
        const alpha = clamp((d - 55) / 130, 0, 1) * (selected || hovered ? 1 : 0.92);
        p.pos[q] = it.f.x; p.pos[q + 1] = it.y + Math.max(3.4, 2.9 * scale); p.pos[q + 2] = it.f.z; p.pos[q + 3] = 0;
        p.size[q] = Math.max(0.6, mpp * PIN_PX * (due ? 1.26 : 1));
        p.size[q + 1] = selected; p.size[q + 2] = hovered; p.size[q + 3] = alpha;
        p.tint[q] = tint[0]; p.tint[q + 1] = tint[1]; p.tint[q + 2] = tint[2];
        p.tint[q + 3] = it.cell;
        p.n++;
      }
      state.lit = lit;
      state.scale = Math.round(nearestScale * 100) / 100;
      state.camAltM = Math.round(camAlt);

      for (const k of Object.keys(meshes)) {
        meshes[k].thinInstanceBufferUpdated('iPos');
        meshes[k].thinInstanceBufferUpdated('iSize');
        meshes[k].thinInstanceBufferUpdated('iTint');
        meshes[k].thinInstanceCount = buf[k].n;
      }

      paintLabels(perMetre, camAlt);
    },

    dispose() {
      for (const k of Object.keys(meshes)) meshes[k].dispose();
      for (const k of Object.keys(mats)) mats[k].dispose();
      if (atlasTex) { atlasTex.dispose(); atlasTex = null; }
      if (overlay) { overlay.remove(); overlay = null; labelPool.length = 0; }
      ready = false;
    }
  });
}

/* ------------------------------------------------------------------ css */

function injectCss() {
  if (document.getElementById('cm-css')) return;
  const s = document.createElement('style');
  s.id = 'cm-css';
  s.textContent = `
#cm-labels { position: absolute; inset: 0; pointer-events: none; z-index: 3; }
.cm-label {
  position: absolute; transform-origin: 0 0; will-change: transform;
  margin: -34px 0 0 10px; padding: 3px 7px 4px;
  background: rgba(6, 14, 18, .72); border: 1px solid rgba(232, 220, 196, .18);
  border-left: 2px solid var(--sand, #e8dcc4); border-radius: 3px;
  font: 500 11px/1.25 var(--font, system-ui, sans-serif); color: #e8dcc4;
  white-space: nowrap; letter-spacing: .01em;
  text-shadow: 0 1px 2px rgba(0,0,0,.8);
}
.cm-label b { display: block; font-weight: 650; }
.cm-label span { display: block; color: #9aa3a8; font-size: 10px; }
.cm-label.far { opacity: .55; }
.cm-label.far span { display: none; }
.cm-label.on { border-left-color: var(--sea, #3fb6c4); background: rgba(10, 30, 36, .88); color: #fff; }
.cm-label.on span { color: #cfe9ee; }
/* The same rule the ground follows: --sun means a bus inside ten minutes and means nothing else. */
.cm-label.due { border-left-color: var(--sun, #f0b429); }
.cm-label.due span { color: var(--sun, #f0b429); }
@media (prefers-reduced-motion: no-preference) { .cm-label { transition: opacity .18s linear; } }
`;
  document.head.append(s);
}
