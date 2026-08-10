// A KML and KMZ reader, written for this repository rather than pulled in.
//
// There is no XML dependency here and there is not going to be one. This project vendors its engine
// and runs offline; adding a parser from a package registry to read one export from one map would be
// a worse trade than sixty lines that do exactly what KML needs and refuse the rest loudly. What it
// handles is what Google MyMaps emits: a Document, Folders, Placemarks, Points, LineStrings,
// Polygons with inner and outer boundaries, ExtendedData, and names or descriptions wrapped in
// CDATA. What it does not handle, it says so about rather than guessing.
//
// Three things about KML that cost people time, recorded here so the next person does not pay again:
//
//   1. **A downloaded KMZ from MyMaps is usually a NetworkLink stub.** The zip contains a doc.kml of
//      about two kilobytes holding a <NetworkLink> whose <href> points back at Google. There is no
//      map data in the file at all. `readMapFile` detects that exactly and returns the href, so the
//      caller can say what to do instead of failing on an empty parse. The staged copy in this
//      repository came from following that link and saving the KML it returns.
//   2. **Coordinates are lon,lat,alt.** That is the KML order and it is the opposite of the order
//      almost everything else uses. Nothing in here swaps them silently; `toLatLon` is the one place
//      that turns a KML triple into a lat and a lon, and it is named so a reader can check it.
//   3. **A coordinate block is whitespace separated and may be wrapped over many lines.** Splitting
//      on newlines rather than on whitespace loses points from a polygon quietly.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib.mjs';

export const KML_READER = { id: 'kml-reader', version: '1.0' };

// ------------------------------------------------------------------------------------------------
// XML
// ------------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Turn the five XML entities and numeric references back into characters. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9A-Fa-f]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

/**
 * Parse XML into a tree of `{ tag, attrs, children, text }`.
 *
 * Deliberately small. It understands elements, attributes, self-closing tags, comments, the XML
 * declaration, and CDATA. It does not understand namespaces beyond stripping a prefix, entities
 * inside attribute names, or DTDs, and a document that needs any of those is not a MyMaps export.
 */
export function parseXml(text) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      addText(stack[stack.length - 1], text.slice(i));
      break;
    }
    if (lt > i) addText(stack[stack.length - 1], text.slice(i, lt));

    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt);
      const body = end === -1 ? text.slice(lt + 9) : text.slice(lt + 9, end);
      const node = stack[stack.length - 1];
      node.text += body;
      node.hadCdata = true;
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const gt = text.indexOf('>', lt);
    if (gt === -1) break;
    const raw = text.slice(lt + 1, gt).trim();

    if (raw.startsWith('/')) {
      const name = localName(raw.slice(1).trim());
      // Close down to the matching open tag. An unmatched close in a malformed file is ignored
      // rather than allowed to unwind the whole stack.
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d].tag === name) { stack.length = d; break; }
      }
      i = gt + 1;
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1).trim() : raw;
    const space = body.search(/\s/);
    const name = localName(space === -1 ? body : body.slice(0, space));
    const attrs = space === -1 ? {} : parseAttrs(body.slice(space + 1));
    const node = { tag: name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  return root;
}

function localName(name) {
  const colon = name.indexOf(':');
  return (colon === -1 ? name : name.slice(colon + 1)).toLowerCase();
}

function addText(node, chunk) {
  if (!chunk) return;
  node.text += decodeEntities(chunk);
}

function parseAttrs(s) {
  const out = {};
  const rx = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = rx.exec(s)) !== null) {
    out[localName(m[1])] = decodeEntities(m[3] !== undefined ? m[3] : m[4] || '');
  }
  return out;
}

/** First direct child with this tag, or null. */
export function child(node, tag) {
  return (node.children || []).find((c) => c.tag === tag) || null;
}

/** Every direct child with this tag. */
export function children(node, tag) {
  return (node.children || []).filter((c) => c.tag === tag);
}

/** Every descendant with this tag, in document order. */
export function descendants(node, tag, out = []) {
  for (const c of node.children || []) {
    if (c.tag === tag) out.push(c);
    descendants(c, tag, out);
  }
  return out;
}

/** The text of a child element, trimmed. CDATA and entities are already decoded. */
export function textOf(node, tag) {
  const c = tag ? child(node, tag) : node;
  return c ? c.text.trim() : '';
}

// ------------------------------------------------------------------------------------------------
// KMZ
// ------------------------------------------------------------------------------------------------

/**
 * Pull the first .kml entry out of a KMZ, which is a zip file.
 *
 * Reads the end-of-central-directory record, walks the central directory, and inflates the one
 * entry it wants. Only the two storage methods a KMZ ever uses are supported: stored and deflate.
 * Anything else is reported rather than guessed at.
 */
export function unzipKml(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('this file is not a zip archive, so it is not a KMZ');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let e = 0; e < count; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.kml$/i.test(name)) continue;

    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    if (method === 0) return { name, text: raw.toString('utf8') };
    if (method === 8) return { name, text: zlib.inflateRawSync(raw).toString('utf8') };
    throw new Error(`the KML inside this KMZ uses zip compression method ${method}, which this reader does not implement`);
  }
  throw new Error('this KMZ contains no .kml entry');
}

// ------------------------------------------------------------------------------------------------
// Reading a map file
// ------------------------------------------------------------------------------------------------

/**
 * Read a .kml or .kmz off disk and say honestly what is in it.
 *
 * Returns `{ kind, text, note, networkLink }`. `kind` is `kml`, `kmz` or `network-link-stub`. The
 * stub case is the one the owner will hit again: MyMaps hands out a KMZ that contains no map data,
 * only a link back to Google, and a tool that parses it happily and reports nought placemarks is
 * telling a person their map is empty when it is not.
 */
export function readMapFile(file) {
  const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
  const buf = fs.readFileSync(full);
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const inner = isZip ? unzipKml(buf) : null;
  const text = inner ? inner.text : buf.toString('utf8');
  const kind = isZip ? 'kmz' : 'kml';

  const doc = parseXml(text);
  const links = descendants(doc, 'networklink');
  const placemarks = descendants(doc, 'placemark');
  if (links.length && !placemarks.length) {
    const href = textOf(child(links[0], 'link') || child(links[0], 'url') || links[0], 'href');
    return {
      kind: 'network-link-stub',
      text,
      networkLink: href,
      note: 'This file carries a NetworkLink and no Placemarks, which is what Google MyMaps hands '
        + 'back when you use Download KMZ. There is no map data in it. Open the map, use the three '
        + 'dot menu, choose Export to KML/KMZ, tick "Export as KML instead of KMZ", and save that '
        + 'file. If you already have the stub, the same data is at the NetworkLink href recorded '
        + 'beside this note, and following it once and saving the result is a fetch, not a runtime '
        + 'call: nothing in the running twin ever touches it.'
    };
  }
  return { kind, text, networkLink: null, note: inner ? `read from ${inner.name} inside the KMZ` : '' };
}

// ------------------------------------------------------------------------------------------------
// KML to placemarks
// ------------------------------------------------------------------------------------------------

/** One KML coordinate triple to a lat and a lon, in that order, from lon,lat,alt in that order. */
export function toLatLon(triple) {
  return { lat: triple[1], lon: triple[0], alt: triple.length > 2 ? triple[2] : 0 };
}

/** Parse a <coordinates> block. Whitespace separated, often wrapped over many lines. */
export function parseCoordinates(raw) {
  const out = [];
  for (const tok of String(raw).trim().split(/\s+/)) {
    if (!tok) continue;
    const parts = tok.split(',').map(Number);
    if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) continue;
    out.push([parts[0], parts[1], Number.isFinite(parts[2]) ? parts[2] : 0]);
  }
  return out;
}

function geometryOf(placemark) {
  const point = child(placemark, 'point');
  if (point) {
    const c = parseCoordinates(textOf(point, 'coordinates'));
    return c.length ? { type: 'Point', outer: c, inner: [] } : null;
  }
  const line = child(placemark, 'linestring');
  if (line) {
    const c = parseCoordinates(textOf(line, 'coordinates'));
    return c.length ? { type: 'LineString', outer: c, inner: [] } : null;
  }
  const poly = child(placemark, 'polygon');
  if (poly) {
    const outerRing = child(poly, 'outerboundaryis');
    const outer = outerRing ? parseCoordinates(textOf(child(outerRing, 'linearring') || outerRing, 'coordinates')) : [];
    const inner = children(poly, 'innerboundaryis')
      .map((r) => parseCoordinates(textOf(child(r, 'linearring') || r, 'coordinates')))
      .filter((r) => r.length);
    return outer.length ? { type: 'Polygon', outer, inner } : null;
  }
  const multi = child(placemark, 'multigeometry');
  if (multi) {
    // A MultiGeometry is reported rather than flattened. Flattening it would put one record on the
    // map where the author drew several shapes, and nothing would say that had happened.
    return { type: 'MultiGeometry', outer: [], inner: [], parts: (multi.children || []).map((c) => c.tag) };
  }
  return null;
}

/** Strip the HTML that MyMaps allows inside a description, and report what was taken out. */
export function stripHtml(html) {
  const media = [];
  let s = String(html);
  s = s.replace(/<img\b[^>]*src\s*=\s*"([^"]*)"[^>]*>/gi, (whole, src) => { media.push(src); return ' '; });
  s = s.replace(/<img\b[^>]*>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr)>/gi, '\n');
  s = s.replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (whole, href, label) => {
    const text = label.replace(/<[^>]+>/g, '').trim();
    return text && text !== href ? `${text} (${href})` : href;
  });
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { text: s, media };
}

/**
 * Every placemark in a parsed KML, with the folder it sits in.
 *
 * Folders are the author's own categories and they carry meaning that nothing else in the file
 * does: a pin in "Private Mine Leases" and a pin in "Local Businesses" are different kinds of claim
 * even when they look identical. The folder travels with the placemark for that reason.
 */
export function placemarks(text) {
  const doc = parseXml(text);
  const kml = child(doc, 'kml') || doc;
  const document = child(kml, 'document') || kml;
  const out = [];
  const folders = [];

  const walk = (node, folderName) => {
    for (const c of node.children || []) {
      if (c.tag === 'folder') {
        const name = textOf(c, 'name') || '(unnamed folder)';
        const before = out.length;
        walk(c, name);
        folders.push({ name, placemarks: out.length - before });
        continue;
      }
      if (c.tag === 'placemark') {
        const rawName = child(c, 'name');
        const rawDesc = child(c, 'description');
        const desc = rawDesc ? stripHtml(rawDesc.text) : { text: '', media: [] };
        const extended = {};
        for (const d of descendants(c, 'data')) {
          const key = d.attrs.name || '';
          if (key) extended[key] = textOf(d, 'value');
        }
        for (const key of Object.keys(extended)) {
          if (/media|image|photo|icon/i.test(key) && /^https?:/i.test(extended[key])) {
            desc.media.push(extended[key]);
            delete extended[key];
          }
        }
        out.push({
          index: out.length,
          folder: folderName,
          name: (rawName ? rawName.text : '').trim(),
          name_was_cdata: !!(rawName && rawName.hadCdata),
          description: desc.text,
          description_was_cdata: !!(rawDesc && rawDesc.hadCdata),
          media: desc.media,
          extended,
          styleUrl: textOf(c, 'styleurl'),
          geometry: geometryOf(c)
        });
        continue;
      }
      if (c.tag === 'document' || c.tag === '#root' || c.tag === 'kml') walk(c, folderName);
    }
  };
  walk(document, '(no folder)');

  return {
    documentName: textOf(document, 'name'),
    documentDescription: (child(document, 'description') ? stripHtml(child(document, 'description').text).text : ''),
    folders,
    placemarks: out
  };
}
