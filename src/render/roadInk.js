// What each chapter prints its road with (QA-1 #6). A def can override any field with
// theme.roadPrint { style: 'wash'|'notebook', wash, line, rule, margin, ruleSpacing, warm }; otherwise the
// chapter's own recipe below, else a wash derived from theme.road.
import * as THREE from 'three';

const CHAPTERS = {
  meadow: { wash: '#a7aa92' }, // warm grey-green
  bosphorus: { wash: '#9296ad' }, // a lighter slate, clear of the navy quay and water
  glacier: { wash: '#97a3b7' }, // cool blue-grey
  // the reader's desk: a strip torn from a ruled notebook, pen strokes down the middle
  desk: { style: 'notebook', wash: '#f2ead6', line: '#33509a', rule: '#8eb0d6', margin: '#d8766b', ruleSpacing: 1.7 },
};

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// → { style: 0 wash | 1 notebook, wash, line, rule, margin (THREE.Color), ruleSpacing (m) }
export function roadPrint(def) {
  const th = def.theme;
  const r = { ...(CHAPTERS[def.id] || {}), ...(th.roadPrint || {}) };
  const notebook = r.style === 'notebook';
  const line = new THREE.Color(r.line || th.roadLine || '#fbf6e9');
  const wash = new THREE.Color(r.wash || th.road);
  // A wash takes on the paper it soaks into: warm it toward the page, or on a dark night page toward the
  // light the page prints with.
  if (!notebook) wash.lerp(lum(new THREE.Color(th.paper)) > 0.3 ? new THREE.Color(th.paper) : line, r.warm ?? 0.13);
  return {
    style: notebook ? 1 : 0,
    wash,
    line,
    rule: new THREE.Color(r.rule || '#8eb0d6'),
    margin: new THREE.Color(r.margin || '#d8766b'),
    ruleSpacing: r.ruleSpacing || 1.7,
  };
}
