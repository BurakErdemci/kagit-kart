// Shader blocks for the printed track surfaces (materials.surface(kind, params)). Each block runs right
// after <map_fragment> and writes diffuseColor.rgb; the shared paper grain, dot screen and toon lighting
// follow, so every kind still reads as the same paper. Per-vertex data arrives in aKkA / aKkB.

// Helpers shared by every paper material (unused ones are stripped by the compiler).
export const HELPERS = /* glsl */`
float kkHash( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float kkNoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = kkHash( i ), b = kkHash( i + vec2( 1.0, 0.0 ) ), c = kkHash( i + vec2( 0.0, 1.0 ) ), d = kkHash( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
// Pixel-antialiased coverage of x inside [a, b].
float kkBand( float x, float a, float b ) {
  float w = max( fwidth( x ), 1e-4 );
  return clamp( min( x - a, b - x ) / w + 0.5, 0.0, 1.0 );
}
// Amplitude-modulated print screen at 45 deg: ink coverage for tone 0..1 with cells of 'cell' metres.
// Above 50 % it flips to paper dots on ink; below ~3 px per cell it settles to the flat tone.
float kkScreen( vec2 p, float cell, float tone ) {
  vec2 sp = p / cell;
  sp = vec2( sp.x + sp.y, sp.y - sp.x ) * 0.70710678;
  float d = length( fract( sp ) - 0.5 );
  float inv = step( 0.5, tone );
  float r = sqrt( mix( tone, 1.0 - tone, inv ) / 3.14159 );
  float w = max( fwidth( d ), 1e-4 );
  float m = 1.0 - smoothstep( r - w, r + w, d );
  m = mix( m, 1.0 - m, inv );
  return mix( m, tone, smoothstep( 0.18, 0.45, length( fwidth( sp ) ) ) );
}
// The same screen as printed by a worn press: each dot's size and centre wander a little (ink spread).
float kkScreenRough( vec2 p, float cell, float tone ) {
  vec2 sp = p / cell;
  sp = vec2( sp.x + sp.y, sp.y - sp.x ) * 0.70710678;
  vec2 ci = floor( sp );
  vec2 f = fract( sp ) - 0.5 - ( vec2( kkHash( ci + 7.1 ), kkHash( ci + 3.3 ) ) - 0.5 ) * 0.14;
  float d = length( f );
  float r = sqrt( min( tone, 0.5 ) / 3.14159 ) * ( 0.82 + 0.34 * kkHash( ci ) );
  float w = max( fwidth( d ), 1e-4 );
  float m = 1.0 - smoothstep( r - w, r + w, d );
  // settles to flat tone a little earlier than kkScreen: the road scrolls fast under the camera
  return mix( m, tone, smoothstep( 0.14, 0.32, length( fwidth( sp ) ) ) );
}
// An engraver's line screen across x (metres): lines every period covering tone of the width;
// below ~4 px between lines it settles to the flat tone. Read along the lines it never forms the
// ellipses a dot screen does at grazing angles.
float kkLines( float x, float period, float tone ) {
  float q = x / period;
  float f = abs( fract( q ) - 0.5 ) * 2.0;
  float w = max( fwidth( q ), 1e-4 ) * 2.0;
  float tt = tone * ( 1.0 + 2.0 * w );
  float m = 1.0 - smoothstep( tt - w, tt + w, f );
  return mix( m, tone, smoothstep( 0.18, 0.4, fwidth( q ) ) );
}
float kkBox( vec2 p, vec2 b, float r ) {
  vec2 q = abs( p ) - b + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
`;

// Per-kind uniforms (declared for every kind; each material binds its own values).
export const KIND_PARS = /* glsl */`
#ifdef KK_KIND
  uniform vec3 uKkC0;
  uniform vec3 uKkC1;
  uniform vec3 uKkC2;
  uniform vec3 uKkC3;
  uniform vec3 uKkC4;
  uniform vec3 uKkC5;
  uniform vec4 uKkV0;
  uniform vec4 uKkV1;
  uniform vec4 uKkV2;
  uniform sampler2D uKkTex0;
  uniform sampler2D uKkTex1;
  varying vec4 vKkA;
  varying vec4 vKkB;
#endif
#ifdef KK_HOLE
  uniform mat4 projectionMatrix;
#endif
`;

// The printed page: faint tint patches (hard edges, fine screen) and scattered hatching. The book's
// gutter is a line (V1.xy a point on it, V1.zw its unit normal) whose tone deepens over V0.w metres;
// page, band and road all print it, so the spine's fold runs right under the track.
export const PAGE_PRINT = /* glsl */`
#ifdef KK_KIND
float kkGutterT( vec2 wp ) {
  if ( uKkV0.w <= 0.0 ) return 0.0;
  float g = 1.0 - smoothstep( 0.0, uKkV0.w, abs( dot( wp - uKkV1.xy, uKkV1.zw ) ) );
  return g * g;
}
vec3 kkGutterFold( vec2 wp, vec3 col ) {
  if ( uKkV0.w <= 0.0 ) return col;
  float gx = abs( dot( wp - uKkV1.xy, uKkV1.zw ) );
  col = mix( col, col * 1.07, kkBand( gx, 0.3, 0.7 ) * 0.8 );
  return mix( col, uInk, kkBand( gx, -1.0, 0.1 ) * 0.8 );
}
vec3 kkPagePrint( vec2 wp, vec3 paper ) {
  vec3 col = paper;
  float b = kkNoise( wp * 0.011 ) * 0.65 + kkNoise( wp * 0.037 + 5.0 ) * 0.35;
  col = mix( col, mix( paper, uInk, 0.14 ), kkScreen( wp, 0.9, kkBand( b, 0.6, 9.0 ) * 0.22 ) );
  float hm = texture2D( uKkTex0, wp / 6.0 ).r * kkBand( kkNoise( wp * 0.045 + 11.0 ), 0.64, 9.0 );
  col = mix( col, mix( paper, uInk, 0.3 ), hm * 0.45 );
  col = mix( col, uInk, kkScreen( wp, 0.75, kkGutterT( wp ) * 0.7 ) * 0.55 );
  return kkGutterFold( wp, col );
}
#endif
`;

export const KIND_VERTEX_PARS = /* glsl */`
#ifdef KK_KIND
  attribute vec4 aKkA;
  attribute vec4 aKkB;
  varying vec4 vKkA;
  varying vec4 vKkB;
#endif
`;

export const KIND_VERTEX = /* glsl */`
#ifdef KK_KIND
  vKkA = aKkA;
  vKkB = aKkB;
#endif
`;

// Road: a strip of the page printed in one ink wash (or, style 1, a strip of ruled notebook paper).
// aKkA = (lateral m, distance m, halfWidth m, curvature -1..1), aKkB = (dip 0..1, ice 0/1, sand 0/1, -).
// C0 wash / sheet, C1 line colour (reserved paper; notebook: pen), C2 ice, C3 sand, C4 notebook rules,
// C5 notebook margin; V0 = (dash period m, style, rule spacing m, gutter width), V1 the page's gutter
// (see PAGE_PRINT).
const ROAD = /* glsl */`
#ifdef KK_ROAD
{
  float lat = vKkA.x, dist = vKkA.y, hw = vKkA.z, curv = vKkA.w;
  float side = lat < 0.0 ? -1.0 : 1.0;
  float e = hw - abs( lat );
  vec2 wp = vPaperWorld.xz;
  bool notebook = uKkV0.y > 0.5;
  // pen-pressure wobble shared by the edge lines
  float wob = 0.045 * sin( dist * 0.11 + side * 1.7 ) + 0.025 * sin( dist * 0.47 + side ) + 0.02 * kkNoise( vec2( dist * 0.8, side * 5.0 ) );
  // One flat layer of wash dragged along the strip by a wide brush (long faint streaks, a slow bloom), a
  // little deeper where it pooled against the edge. No second glaze: its blotches read as wet asphalt.
  // Near the camera the paper itself shows through: its fibres (Tex0: R took more ink, G stayed light) and
  // the cloudy formation of the sheet; both fade out before they could shimmer in the distance.
  float near = 1.0 - smoothstep( 0.015, 0.06, length( fwidth( wp ) ) );
  float drag = kkNoise( vec2( lat * 1.1, dist * 0.045 ) ) - 0.5;
  float bloom = kkNoise( wp * 0.03 + 7.0 ) * 0.5 + kkNoise( wp * 0.21 + 2.0 ) * 0.5 - 0.5;
  float cloud = ( kkNoise( wp * 1.2 ) - 0.5 ) * near;
  vec2 fib = texture2D( uKkTex0, wp / 4.5 ).rg;
  vec3 col = uKkC0 * ( 1.0 + ( notebook ? 0.02 : 0.06 ) * drag + ( notebook ? 0.015 : 0.07 ) * bloom + 0.04 * cloud );
  // fibres mostly lift the wash (paper showing through); dark ones alone would read as cracks
  col *= 1.0 - 0.06 * fib.r + ( notebook ? 0.06 : 0.12 ) * fib.g;
  float edgeT = 1.0 - smoothstep( 0.35, 1.6, e - wob );
  col *= 1.0 - ( notebook ? 0.03 : 0.07 ) * edgeT;
  if ( notebook ) {
    // ruled paper: rules along the strip that stop short of the cut, a red double margin on the left
    float rl = abs( fract( ( lat + hw ) / uKkV0.z + 0.5 ) - 0.5 ) * uKkV0.z;
    float rule = ( 1.0 - smoothstep( 0.025, 0.025 + max( fwidth( rl ), 1e-4 ) * 1.5, rl ) ) * smoothstep( 0.5, 0.9, e );
    col = mix( col, uKkC4, rule * 0.62 );
    float mx = lat + hw - 2.4;
    col = mix( col, uKkC5, min( 1.0, kkBand( mx, -0.035, 0.035 ) + kkBand( mx, 0.14, 0.2 ) ) * 0.85 );
  }
  // The printer's screen: a flat tint of about 6 % on open road; dots only where the tone rises (dips,
  // the edge falloff, the gutter), so the open road never shows a regular dot grid.
  float gut = kkGutterT( wp );
  float tone = ( notebook ? 0.03 : 0.06 ) + 0.2 * edgeT + 0.3 * vKkB.x + 0.24 * gut;
  float dotsOn = smoothstep( 0.1, 0.45, max( max( edgeT, vKkB.x * 1.5 ), gut * 1.5 ) );
  float cov = mix( tone, kkScreenRough( wp, 0.24, clamp( tone, 0.0, 0.5 ) ), dotsOn );
  col = mix( col, col * vec3( 0.74, 0.77, 0.86 ), cov );
  if ( vKkB.y > 0.01 ) {
    // ice: short printed glint strokes at 45 deg, a few per square metre
    vec2 gp = vec2( wp.x + wp.y, wp.x - wp.y ) * 0.70710678;
    float row = floor( gp.y / 1.3 ), ph = kkHash( vec2( row, 5.0 ) );
    float cellX = floor( gp.x / 2.6 + ph );
    float glint = kkBand( fract( gp.y / 1.3 ), 0.0, 0.05 ) * kkBand( fract( gp.x / 2.6 + ph ), 0.15, 0.5 )
      * step( 0.84, kkHash( vec2( row, cellX ) ) );
    col = mix( col, uKkC2, 0.65 * vKkB.y );
    col = mix( col, vec3( 1.0 ), glint * 0.6 * vKkB.y );
  }
  if ( vKkB.z > 0.01 ) {
    col = mix( col, uKkC3, 0.62 * vKkB.z );
    col *= 1.0 - 0.25 * vKkB.z * kkScreen( wp + kkNoise( wp * 0.7 ) * 0.4, 0.22, 0.14 );
  }
  // tyre scuffs on the racing line through corners, printed through a fine screen
  float ac = smoothstep( 0.22, 0.8, abs( curv ) );
  if ( ac > 0.001 ) {
    float x = lat + sign( curv ) * 0.36 * hw;
    float t1 = kkBand( abs( abs( x ) - 0.66 ), 0.0, 0.13 );
    float x2 = x - sign( curv ) * 1.9;
    float t2 = kkBand( abs( abs( x2 ) - 0.66 ), 0.0, 0.09 );
    float brk = smoothstep( 0.28, 0.55, kkNoise( vec2( dist * 0.3, floor( x * 2.0 ) ) ) );
    float dry = 0.4 + 0.6 * texture2D( uGrainTex, vec2( lat * 1.7, dist * 0.017 ) ).r;
    float scuff = ( t1 + 0.55 * t2 ) * ac * brk * dry;
    col = mix( col, mix( uInk, col, 0.3 ), scuff * 0.62 * kkScreenRough( wp, 0.11, 0.45 ) );
  }
  // centre line: tapered pen strokes, each one a little different
  float k = floor( dist / uKkV0.x ), s = fract( dist / uKkV0.x );
  if ( s < 0.34 ) {
    float q = s / 0.34;
    float w = ( notebook ? 0.1 : 0.17 ) * pow( sin( 3.14159 * q ), 0.35 ) * ( 0.85 + 0.3 * kkHash( vec2( k, 1.0 ) ) );
    float c = 0.12 * ( kkHash( vec2( k, 2.0 ) ) - 0.5 ) + ( q - 0.5 ) * 0.28 * ( kkHash( vec2( k, 3.0 ) ) - 0.5 );
    float lc = kkBand( lat - c, -w, w ) * smoothstep( 0.1, 0.3, kkNoise( vec2( dist * 2.1, lat * 8.0 ) ) + 0.12 );
    col = mix( col, uKkC1, lc );
  }
  // edges: the painter's wash stops short of the inked border, leaving a margin of bare paper whose
  // width wanders (the edge line), with a faint dried rim where the wash ended (notebook: the inked cut
  // alone). Both sit clear of the strip's edge so the wobble never clips them.
  if ( !notebook ) {
    float stop = 0.3 + 0.12 * sin( dist * 0.07 + side * 2.3 ) + 0.1 * ( kkNoise( vec2( dist * 0.21, side * 7.0 ) ) - 0.5 );
    float bare = 1.0 - kkBand( e - wob, stop, 99.0 );
    col = mix( col, col * 0.92, kkBand( e - wob, stop, stop + 0.06 ) * 0.8 );
    col = mix( col, uKkC1, bare * ( 0.82 + 0.18 * kkNoise( vec2( dist * 3.1, lat ) ) ) );
  }
  float press = notebook ? 0.06 + 0.015 * sin( dist * 0.13 + side * 2.0 ) : 0.19 + 0.06 * sin( dist * 0.13 + side * 2.0 );
  col = mix( col, uInk, kkBand( e - wob * 0.8, 0.08, 0.08 + press ) * 0.95 );
  if ( !notebook ) {
    // now and then the pen went round twice: a thinner stroke wandering just inside the first
    float o2 = 0.08 + press + 0.1 + 0.07 * sin( dist * 0.05 + side * 3.1 );
    float on = smoothstep( 0.5, 0.62, kkNoise( vec2( dist * 0.06, side * 11.0 ) ) );
    col = mix( col, uInk, kkBand( e - wob, o2, o2 + 0.05 ) * on * 0.7 );
  }
  diffuseColor.rgb = kkGutterFold( wp, col );
}
#endif
`;

// Offroad band: flat printed colour that thins out toward the page in engraved lines running with the
// road. aKkA = (0 at the road edge .. 1 at the band's outer edge, distance m, band width m, -).
// C0 band, C1 page, C2 hatch; Tex0 hatch mask; V0.w / V1 the page's gutter.
const BAND = /* glsl */`
#ifdef KK_BAND
{
  float t = vKkA.x;
  vec2 wp = vPaperWorld.xz;
  float tone = 1.0 - smoothstep( 0.45, 0.96, t + ( kkNoise( wp * 0.09 ) - 0.5 ) * 0.1 );
  // across-band metres; each line wanders a little along its length, like a hand-cut plate
  float x = t * vKkA.z;
  x += 0.07 * ( kkNoise( vec2( vKkA.y * 0.12, floor( x / 0.55 ) * 3.1 ) ) - 0.5 );
  float cov = kkLines( x, 0.55, tone );
  vec3 col = mix( kkPagePrint( wp, uKkC1 ), uKkC0, cov );
  float h = texture2D( uKkTex0, wp / 4.6 ).r * ( 1.0 - smoothstep( 0.3, 0.9, t ) );
  col = mix( col, uKkC2, h * 0.55 * cov );
  // a dotted cut line just inside the outer edge keeps the offroad's end readable on pale chapters
  float along = vKkA.y / 0.9;
  vec2 q = vec2( ( fract( along ) - 0.5 ) * 0.9, ( t - 0.975 ) * vKkA.z );
  float dotL = 1.0 - smoothstep( 0.08, 0.08 + max( fwidth( q.y ), 1e-3 ) * 1.5, length( q ) );
  col = mix( col, uInk, dotL * 0.45 * ( 1.0 - smoothstep( 0.15, 0.4, fwidth( along ) ) ) );
  col = mix( col, uInk, kkScreen( wp, 0.75, kkGutterT( wp ) * 0.7 ) * 0.55 * cov );
  diffuseColor.rgb = kkGutterFold( wp, col );
}
#endif
`;

// The page: paper with faint printed tint patches and scattered hatching. C0 paper; the print itself is
// kkPagePrint (shared with the band so the halftone fade meets the page without a seam).
const PAGE = /* glsl */`
#ifdef KK_PAGE
  diffuseColor.rgb = kkPagePrint( vPaperWorld.xz, uKkC0 );
#endif
`;

// Boost pad: a die-cut foil sticker. aKkA = (x from pad centre m, z from pad start m, halfWidth, length).
// C0 foil, C1 arrows, C2 border, C3 offset shadow; V0.x arrow scroll speed.
const FOIL = /* glsl */`
#ifdef KK_FOIL
{
  vec2 hs = vec2( vKkA.z, vKkA.w * 0.5 );
  vec2 p = vec2( vKkA.x, vKkA.y - hs.y );
  float sd = kkBox( p, hs, 0.55 );
  float sdS = kkBox( p - vec2( 0.22, -0.26 ), hs, 0.55 );
  if ( sd > 0.0 && sdS > 0.0 ) discard;
  vec3 V = normalize( cameraPosition - vPaperWorld );
  float f = dot( V.xz, vec2( 0.8, 0.6 ) ) * 2.4 + V.y * 1.6 + p.x * 0.16 + p.y * 0.1;
  float band = floor( fract( f ) * 5.0 ) / 5.0;
  vec3 pal = 0.55 + 0.45 * cos( 6.2832 * ( band + vec3( 0.0, 0.33, 0.67 ) ) );
  vec3 foil = mix( uKkC0, uKkC0 * pal * 1.6, 0.35 );
  float spec = kkBand( fract( f * 0.5 + 0.1 ), 0.0, 0.07 );
  foil = mix( foil, vec3( 1.0 ), spec * 0.65 );
  float ch = fract( p.y / 1.5 - uTime * uKkV0.x + abs( p.x ) * 0.3 );
  float arrow = kkBand( ch, 0.0, 0.34 ) * kkBand( abs( p.x ), -1.0, hs.x - 0.6 ) * kkBand( abs( p.y ), -1.0, hs.y - 0.5 );
  vec3 col = mix( foil, uKkC1, arrow );
  float inner = 1.0 - smoothstep( -0.3, -0.27, sd );
  kkGlow = uKkC0 * ( 0.18 + 0.45 * spec ) * inner * ( 1.0 - arrow );
  col = mix( col, uKkC2, 1.0 - inner );
  col = mix( col, uInk, kkBand( sd, -0.07, 0.0 ) * 0.75 );
  col = mix( col, uKkC3, step( 0.0, sd ) );
  diffuseColor.rgb = col;
}
#endif
`;

// Cut-paper wave rows standing in the water: scalloped tops that slide along the edge.
// aKkA = (along m, height 0..1, row index, row height m). C0..C2 row colours, C3 crest.
const WAVE = /* glsl */`
#ifdef KK_WAVE
{
  float along = vKkA.x, h = vKkA.y * vKkA.w, row = vKkA.z;
  float dir = mod( row, 2.0 ) < 0.5 ? 1.0 : -1.0;
  float ph = along / ( 3.4 + row * 1.2 ) + uTime * dir * ( 0.11 + 0.05 * row );
  float top = vKkA.w * ( 0.68 + 0.32 * pow( abs( sin( 3.14159 * ph ) ), 0.55 ) );
  if ( h > top ) discard;
  vec3 col = row < 0.5 ? uKkC0 : row < 1.5 ? uKkC1 : uKkC2;
  col = mix( col, uKkC3, kkBand( top - h, 0.0, 0.08 ) * 0.9 );
  col = mix( col, uInk, kkBand( top - h, -1.0, 0.025 ) * 0.6 );
  diffuseColor.rgb = col;
}
#endif
`;

// Void: the page is cut and the desk lies far below. The strip sits at page height and ray-casts a
// trench (walls of stacked page edges, desk floor lit only through the cut) and writes that depth, so
// karts falling in stay visible and the post pass inks the cut. aKkA = (across m from the cut, width, -, -),
// aKkB.xy = across direction. C0 desk, C1 wood grain, C2 page-edge paper, C3 page lines;
// V0 = (floorY, -, -, -), V1.xyz = direction toward the sun; Tex0 wood, Tex1 stack.
const HOLE = /* glsl */`
#ifdef KK_HOLE
{
  if ( cameraPosition.y < vPaperWorld.y + 0.05 ) discard;
  vec3 P = vPaperWorld;
  vec3 V = normalize( P - cameraPosition );
  vec2 ad = normalize( vKkB.xy );
  float a0 = vKkA.x, W = vKkA.y;
  float sF = ( uKkV0.x - P.y ) / min( V.y, -1e-4 );
  float va = dot( V.xz, ad );
  float sW = va < 0.0 ? -a0 / min( va, -1e-5 ) : ( W - a0 ) / max( va, 1e-5 );
  vec3 col;
  vec3 hit;
  if ( sW < sF ) {
    hit = P + V * sW;
    float depth = P.y - hit.y;
    float line = texture2D( uKkTex1, vec2( dot( hit.xz, vec2( -ad.y, ad.x ) ) / 4.0, depth / 8.0 ) ).r;
    col = mix( uKkC2, uKkC3, line * 0.85 );
    col *= ( va < 0.0 ? 0.78 : 1.0 ) * ( 1.0 - 0.3 * smoothstep( 0.0, 7.0, depth ) );
  } else {
    hit = P + V * sF;
    col = mix( uKkC0, uKkC1, texture2D( uKkTex0, hit.xz / 40.0 ).r * 0.8 );
    float up = ( P.y - hit.y ) / max( uKkV1.y, 0.05 );
    float aTop = a0 + dot( hit.xz + uKkV1.xz * up - P.xz, ad );
    float lit = step( 0.0, aTop ) * step( aTop, W );
    col = mix( mix( col, uInk, 0.45 * kkScreen( hit.xz, 0.5, 0.5 ) ) * 0.7, col, lit );
  }
  vec4 clip = projectionMatrix * viewMatrix * vec4( hit, 1.0 );
  gl_FragDepth = clamp( 0.5 * clip.z / clip.w + 0.5, 0.0, 1.0 );
  diffuseColor.rgb = col;
}
#endif
`;

export const KIND_FRAGMENT = ROAD + BAND + PAGE + FOIL + WAVE + HOLE;

export const KINDS = {
  road: { define: 'KK_ROAD' },
  band: { define: 'KK_BAND' },
  page: { define: 'KK_PAGE' },
  foil: { define: 'KK_FOIL' },
  wave: { define: 'KK_WAVE' },
  hole: { define: 'KK_HOLE' },
};
