import { deckle } from './dom.js';

// All UI CSS, injected once as a <style> element. Sizes are in em of the overlay root, whose font-size
// scales with the viewport (≈20px at 1080p, never below 11px so phone text and thumb targets stay usable).
export function buildCSS(bodyFont) {
  const body = bodyFont || 'system-ui, sans-serif';
  const dk = [11, 23, 37, 51, 67].map((s, i) => `.kk-ui .kk-dk${i}{clip-path:${deckle(s)}}`).join('\n');
  const dkFine = `.kk-ui .kk-dkf{clip-path:${deckle(91, 2, 3.2)}}`;

  return `
#kk-root{touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.kk-ui{
  --ink:#2d2a32; --ink2:rgba(45,42,50,.72); --ink3:rgba(45,42,50,.45);
  --paper:#f3ead3; --paper-hi:#faf4e4; --paper-lo:#e4d6b2; --kraft:#c9a06b;
  --cloth:#2e4f58; --cloth-lo:#1f363d; --cloth-hi:#3d6671;
  --gold:#d8ad4c; --red:#d9483b; --blue:#5f7fa3; --mustard:#f2c14e; --rose:#e56b6f; --green:#6f9a58;
  --p1:#e3a623; --p2:#7d97b8; --p3:#c8693a;
  --fb:${body};
  --sat:env(safe-area-inset-top,0px); --sab:env(safe-area-inset-bottom,0px);
  --sal:env(safe-area-inset-left,0px); --sar:env(safe-area-inset-right,0px);
  --shadow:.28em .32em 0 rgba(45,42,50,.88);
  position:absolute; inset:0; z-index:10; overflow:hidden; pointer-events:none;
  font-family:var(--fb); font-weight:600; color:var(--ink); line-height:1.2;
  font-size:clamp(11px, min(1.04vw, 1.95vh), 20px);
  -webkit-font-smoothing:antialiased; -webkit-user-select:none; user-select:none;
  -webkit-touch-callout:none; touch-action:none; -webkit-tap-highlight-color:transparent;
}
.kk-ui *{box-sizing:border-box}
:where(.kk-ui) button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:inherit;-webkit-tap-highlight-color:transparent}
:where(.kk-ui) button:focus{outline:none}
.kk-layer{position:absolute; inset:0; pointer-events:none}
.kk-layer[hidden]{display:none!important}
.kk-hit{pointer-events:auto}
.kk-svg{display:inline-block; line-height:0}
.kk-svg svg{width:100%; height:100%; display:block; overflow:visible}
${dk}
${dkFine}

/* ---------------------------------------------------------------- paper primitives */
.kk-sheet{position:relative; filter:drop-shadow(var(--shadow)); transition:transform .16s cubic-bezier(.3,1.6,.5,1), filter .16s}
.kk-paper{position:relative; background:
    repeating-linear-gradient(115deg, rgba(45,42,50,.022) 0 1px, transparent 1px 7px),
    repeating-linear-gradient(23deg, rgba(255,255,255,.07) 0 2px, transparent 2px 11px),
    var(--paper)}
.kk-dots{background-image:radial-gradient(currentColor 34%, transparent 37%); background-size:.42em .42em;
  -webkit-mask-image:linear-gradient(160deg, #000 10%, transparent 85%); mask-image:linear-gradient(160deg, #000 10%, transparent 85%)}
.kk-lt{display:inline-block; line-height:1; white-space:nowrap}
.kk-lt svg{display:inline-block}
/* index.html sizes every canvas under #kk-root to the full screen (meant for WebGL); lettering canvases opt out */
#kk-root .kk-ltc{display:block; position:relative; inset:auto; width:auto; height:auto}
.kk-h{display:block; line-height:1.1; color:var(--ink)}
/* A cut-paper word cannot wrap: when a heading is wider than its card it scales down instead of spilling */
.kk-h>.kk-lt{display:block; max-width:100%}
.kk-h>.kk-lt>svg{max-width:100%}
.kk-kicker{font-weight:800; font-size:.78em; letter-spacing:.14em; color:var(--ink2)}
.kk-label{position:absolute; padding:.7em 1.4em .8em; transform:rotate(-1.6deg)}
.kk-label .kk-paper{padding:.55em 1.1em .7em}

/* focus: the card lifts, straightens and grows a ribbon bookmark */
.kk-focusable{outline:none}
.kk-focusable.is-focus>.kk-sheet, .kk-focusable.is-focus.kk-sheet{
  transform:translateY(-.5em) rotate(0deg) scale(1.035)!important; filter:drop-shadow(.42em .62em 0 rgba(45,42,50,.9))}
.kk-ribbon{position:absolute; top:-.5em; right:1.2em; width:1.3em; height:2.8em; z-index:3; pointer-events:none;
  background:linear-gradient(90deg, #b9362c, var(--red) 40%, #e8685c 55%, var(--red) 70%);
  clip-path:polygon(0 0,100% 0,100% 100%,50% 78%,0 100%); transform-origin:top; transform:scaleY(0);
  transition:transform .18s cubic-bezier(.3,1.6,.5,1)}
.kk-focusable.is-focus .kk-ribbon{transform:scaleY(1)}

/* pop-up entrance: cards fold up from a hinge on the page */
@keyframes kk-popup{0%{transform:perspective(60em) rotateX(-92deg)}55%{transform:perspective(60em) rotateX(9deg)}
  78%{transform:perspective(60em) rotateX(-3deg)}100%{transform:perspective(60em) rotateX(0)}}
@keyframes kk-fold{to{transform:perspective(60em) rotateX(-92deg)}}
.kk-pop{transform-origin:50% 100%; animation:kk-popup .62s cubic-bezier(.25,.8,.3,1) both}
.kk-folding .kk-pop{animation:kk-fold .16s ease-in both}
.kk-rm .kk-pop, .kk-rm .kk-folding .kk-pop{animation:none}

/* keycaps and pad buttons */
.kk-key{display:inline-flex; align-items:center; justify-content:center; min-width:1.9em; height:1.75em; padding:0 .45em;
  font:800 .82em/1 var(--fb); color:var(--ink); background:var(--paper-hi); border:.12em solid var(--ink);
  border-radius:.3em; box-shadow:0 .2em 0 var(--ink); transform:translateY(-.1em); white-space:nowrap}
.kk-padb{display:inline-flex; align-items:center; justify-content:center; width:1.85em; height:1.85em; border-radius:50%;
  font:800 .82em/1 var(--fb); color:var(--paper-hi); background:var(--ink); box-shadow:0 .16em 0 rgba(45,42,50,.5)}
.kk-padb.kk-wide{width:auto; padding:0 .55em; border-radius:.9em}
.kk-prompts{position:absolute; right:calc(2.2em + var(--sar)); bottom:calc(1.6em + var(--sab)); display:flex; gap:1.3em;
  align-items:center; font-weight:700; color:var(--ink); pointer-events:none}
.kk-prompts>span{display:flex; gap:.45em; align-items:center; background:rgba(250,244,228,.86); padding:.35em .7em .35em .45em;
  border-radius:.2em; box-shadow:.14em .16em 0 rgba(45,42,50,.5)}
.kk-touch-ui .kk-prompts{display:none}

/* ---------------------------------------------------------------- title cover */
.kk-coverwrap{position:absolute; inset:0; perspective:1800px; perspective-origin:30% 50%; pointer-events:auto; cursor:pointer}
.kk-cover{position:absolute; inset:0; transform-origin:0 50%; transform-style:preserve-3d; overflow:hidden;
  background:
    radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,.34)),
    repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(0,0,0,.09) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(45deg, rgba(255,255,255,.02) 0 2px, transparent 2px 5px),
    var(--cloth)}
.kk-cover-shade{position:absolute; inset:0; background:linear-gradient(90deg, rgba(0,0,0,.5), rgba(0,0,0,0) 60%); opacity:0; pointer-events:none}
.kk-hinge{position:absolute; top:0; bottom:0; left:0; width:5.2%;
  background:linear-gradient(90deg, var(--cloth-lo), var(--cloth) 70%, rgba(0,0,0,.35) 88%, var(--cloth-hi) 94%, var(--cloth) 100%)}
.kk-frame{position:absolute; inset:5.5% 6% 5.5% 10%; border:.18em solid rgba(20,38,43,.85);
  box-shadow:.1em .1em 0 rgba(255,255,255,.1), inset .1em .1em 0 rgba(255,255,255,.1)}
.kk-frame::before{content:''; position:absolute; inset:.7em; border:.08em solid rgba(20,38,43,.75); box-shadow:.08em .08em 0 rgba(255,255,255,.08)}
.kk-corner{position:absolute; width:4.5em; height:4.5em; border:.18em solid rgba(216,173,76,.55); border-radius:50%}
.kk-cover-inner{position:absolute; inset:5.5% 6% 5.5% 10%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1.1em}
.kk-cover-kicker{font:800 .95em var(--fb); letter-spacing:.42em; color:var(--gold); opacity:.85;
  filter:drop-shadow(0 -1px 0 rgba(0,0,0,.5)) drop-shadow(0 1px 0 rgba(255,255,255,.12))}
.kk-cover-title{font-size:8em; line-height:1; white-space:nowrap}
.kk-cover-rule{width:14em; height:.9em}
.kk-cover-emblem{width:9em; height:5em; opacity:.95}
.kk-cover-cta{margin-top:1.2em; transform:rotate(-1.2deg)}
.kk-cover-cta .kk-paper{padding:.6em 1.6em .7em; font:800 1.25em var(--fb); letter-spacing:.02em; display:flex; gap:.8em; align-items:center}
.kk-cover-cta .kk-sheet{animation:kk-breathe 2.4s ease-in-out infinite}
@keyframes kk-breathe{50%{transform:translateY(-.18em)}}
.kk-rm .kk-cover-cta .kk-sheet{animation:none}
.kk-bookmark{position:absolute; top:-1%; right:8.5%; width:3.4em; height:44%; transform-origin:50% 0; transform:rotate(2.5deg);
  animation:kk-sway 5s ease-in-out infinite; filter:drop-shadow(.3em .35em 0 rgba(8,20,24,.55))}
.kk-bookmark i{position:absolute; inset:0; clip-path:polygon(0 0,100% 0,100% 100%,50% 91%,0 100%);
  background:linear-gradient(90deg, #a52f27, #d9483b 30%, #ef7c6f 46%, #d9483b 60%, #b3362d)}
.kk-bookmark i::after{content:''; position:absolute; inset:0 .45em; border-left:.08em dashed rgba(255,230,210,.5); border-right:.08em dashed rgba(255,230,210,.5)}
@keyframes kk-sway{50%{transform:rotate(1deg)}}
.kk-rm .kk-bookmark{animation:none}
.kk-cover.is-opening{animation:kk-open .9s cubic-bezier(.55,.02,.4,1) forwards}
.kk-cover.is-opening .kk-cover-shade{animation:kk-shade .9s forwards}
.kk-cover.is-closing{animation:kk-open .7s cubic-bezier(.4,0,.3,1) reverse both}
@keyframes kk-open{0%{transform:rotateY(0)}100%{transform:rotateY(-104deg)}}
@keyframes kk-shade{to{opacity:1}}
.kk-coverwrap.is-open{opacity:0; visibility:hidden; transition:opacity .2s .75s, visibility 0s .95s}
.kk-rm .kk-cover.is-opening, .kk-rm .kk-cover.is-closing{animation:none}
.kk-rm .kk-coverwrap.is-open{transition:none}

/* ---------------------------------------------------------------- menu chrome */
.kk-screen{position:absolute; inset:0; pointer-events:none}
.kk-screen::before{content:''; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(180deg, rgba(45,42,50,.16), transparent 22%, transparent 58%, rgba(45,42,50,.28))}
.kk-head{position:absolute; left:calc(3em + var(--sal)); top:calc(2.2em + var(--sat)); rotate:-1.5deg; pointer-events:none}
.kk-head .kk-paper{padding:.6em 1.5em .85em 1.3em}
.kk-head .kk-h{font-size:2.9em}
.kk-back{position:absolute; left:calc(3em + var(--sal)); top:calc(2.2em + var(--sat)); pointer-events:auto}
.kk-hasback .kk-head{left:calc(7.6em + var(--sal))}
.kk-back .kk-paper{width:3.6em; height:3.6em; display:flex; align-items:center; justify-content:center; background:var(--ink); color:var(--paper)}
.kk-back svg{width:1.7em; height:1.7em}
.kk-steps{position:absolute; right:0; top:calc(7em + var(--sat)); display:flex; flex-direction:column; gap:.45em; pointer-events:none}
.kk-step{padding:.55em 1.4em .55em 1em; margin-right:-.4em; border-radius:.45em 0 0 .45em; font-weight:800; font-size:.9em;
  background:var(--paper-lo); color:var(--ink2); box-shadow:.16em .2em 0 rgba(45,42,50,.55); transform:translateX(.6em)}
.kk-step b{margin-right:.55em; font-size:1.2em}
.kk-step.is-done{background:var(--paper); color:var(--ink)}
.kk-step.is-now{background:var(--ink); color:var(--paper-hi); transform:translateX(-.4em)}
.kk-step.is-now b{color:var(--mustard)}

/* mode cards */
.kk-row{position:absolute; left:0; right:0; bottom:calc(5.2em + var(--sab)); display:flex; justify-content:center; gap:2.2em; align-items:flex-end; pointer-events:none}
.kk-card{pointer-events:auto; width:17.5em; position:relative}
.kk-card .kk-paper{padding:1em 1.3em 1.2em; min-height:18.5em; display:flex; flex-direction:column}
.kk-art{position:relative; height:8.6em; display:flex; align-items:center; justify-content:center; margin:-.2em -.4em .6em}
.kk-art .kk-dots{position:absolute; inset:0; opacity:.55}
.kk-art .kk-svg{position:relative; width:7.4em; height:7.4em}
.kk-card .kk-h{font-size:1.8em; white-space:nowrap}
.kk-card p{margin:.45em 0 0; font-weight:500; font-size:1em; color:var(--ink2); line-height:1.25}
.kk-meta{margin-top:auto; padding-top:.8em; display:flex; gap:.5em; flex-wrap:wrap}
.kk-tag{font-weight:800; font-size:.74em; letter-spacing:.1em; padding:.3em .6em; border:.12em solid var(--ink); border-radius:.2em}
.kk-mini{position:absolute; top:calc(2.4em + var(--sat)); right:calc(3em + var(--sar)); display:flex; gap:1.2em; pointer-events:none}
.kk-minibtn{pointer-events:auto}
.kk-minibtn .kk-paper{padding:.55em 1.1em .6em; font-weight:800; display:flex; gap:.55em; align-items:center}
.kk-minibtn svg{width:1.3em; height:1.3em}

/* class swatches */
.kk-swatch{pointer-events:auto; width:15em; position:relative}
.kk-swatch .kk-face{position:relative; height:16em; padding:1.1em 1.3em; display:flex; flex-direction:column; border-radius:.12em}
.kk-swatch .kk-w{font-size:4.2em; line-height:1; display:flex; align-items:baseline}
.kk-swatch .kk-w small{font:800 .3em var(--fb); margin-left:.18em; color:var(--ink2)}
.kk-swatch .kk-name{font-weight:800; font-size:1.25em; margin-top:.5em}
.kk-swatch p{margin:.3em 0 0; font-weight:500; color:var(--ink2)}
.kk-gauge{margin-top:auto; display:flex; align-items:center; gap:.5em; font-weight:800; font-size:.8em; letter-spacing:.12em}
.kk-gauge i{width:1.5em; height:.7em; border:.14em solid var(--ink); transform:skewX(-18deg)}
.kk-gauge i.on{background:var(--ink)}
.kk-swatch .kk-face{transition:transform .16s cubic-bezier(.3,1.6,.5,1)}
.kk-swatch.is-focus .kk-face{transform:translateY(-.55em) rotate(0deg)!important}
.kk-swatch .kk-ribbon{right:1.6em}
.kk-curl{position:absolute; right:0; bottom:0; width:3.2em; height:3.2em;
  background:linear-gradient(135deg, transparent 50%, #e9dfc8 50%, #fffaf0 70%, #d9ceb4); box-shadow:-.2em -.2em .3em rgba(0,0,0,.12)}

/* character select */
.kk-charinfo{position:absolute; left:calc(3em + var(--sal)); top:calc(9.2em + var(--sat)); width:22em; rotate:-.8deg; pointer-events:none}
.kk-charinfo .kk-paper{padding:1.2em 1.5em 1.4em}
.kk-charinfo .kk-h{font-size:2.6em; margin:.1em 0 .1em}
.kk-animal{font-weight:600; color:var(--ink2); font-size:1.05em}
.kk-stats{margin-top:1em; display:grid; grid-template-columns:auto 1fr; gap:.55em 1em; align-items:center}
.kk-stats span{font-weight:700; font-size:.95em}
.kk-ticks{display:flex; gap:.3em}
.kk-ticks i{width:1.25em; height:.95em; border:.13em solid var(--ink); transform:skewX(-14deg); transition:background .15s}
.kk-ticks i.on{background:var(--ink)}
.kk-roster{position:absolute; left:0; right:0; bottom:calc(5em + var(--sab)); display:flex; justify-content:center; gap:1em; pointer-events:none}
.kk-chip{pointer-events:auto; width:7.2em; position:relative}
.kk-chip .kk-paper{padding:.5em .5em .45em; display:flex; flex-direction:column; align-items:center}
.kk-chip .kk-svg{width:5.4em; height:5.4em}
.kk-chip b{font-weight:800; font-size:.86em; margin-top:.15em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%}
.kk-chip .kk-ribbon{right:.6em; width:1em; height:2.2em}
.kk-swatch .kk-face.is-lined{padding-left:2.5em}

/* track select: chapter tabs on the fore-edge */
.kk-chapters{position:absolute; right:0; top:calc(8em + var(--sat)); display:flex; flex-direction:column; gap:.8em; pointer-events:none}
.kk-chtab{pointer-events:auto; position:relative; width:17em; translate:2.8em 0; transition:translate .18s cubic-bezier(.3,1.5,.5,1)}
.kk-chtab.is-focus{translate:.4em 0}
.kk-chtab.is-focus>.kk-sheet{transform:none!important}
.kk-chtab.is-focus .kk-paper{background:var(--paper-hi)}
.kk-chtab .kk-paper{padding:.8em 1.2em .85em 1.2em; display:flex; align-items:center; gap:1em; border-radius:.5em 0 0 .5em; clip-path:none}
.kk-chtab .kk-num{font-size:2.2em; line-height:1; width:1.2em; text-align:center}
.kk-chtab b{font-weight:800; font-size:1.15em; display:block}
.kk-chtab small{font-weight:500; color:var(--ink2)}
.kk-chapter{position:absolute; left:calc(3em + var(--sal)); bottom:calc(5.5em + var(--sab)); width:38em; max-width:calc(100% - 26em); rotate:1deg; pointer-events:none}
.kk-chapter .kk-paper{padding:1.3em 1.6em 1.5em; display:grid; grid-template-columns:minmax(0,1fr) 9em; gap:1.2em; align-items:center}
.kk-chapter .kk-h{font-size:2.3em; margin:.15em 0 .15em}
.kk-chapter p{margin:0; font-weight:500; color:var(--ink2)}
.kk-chapter .kk-svg{width:9em; height:9em; color:var(--ink)}
.kk-best{margin-top:.8em; font-weight:700; display:flex; gap:.8em}
.kk-best span{color:var(--ink2); font-weight:600}

/* settings & controls */
.kk-form{position:absolute; left:50%; top:50%; width:40em; max-width:calc(100% - 4em); translate:-50% -46%; rotate:-.6deg; pointer-events:none}
.kk-form>.kk-sheet>.kk-paper{padding:1.4em 2em 1.6em}
.kk-form .kk-h{font-size:2.4em}
.kk-rows{margin-top:.9em; display:flex; flex-direction:column}
.kk-srow{pointer-events:auto; display:grid; grid-template-columns:12em 1fr; align-items:center; gap:1em; padding:.5em .6em;
  border-bottom:.08em solid rgba(45,42,50,.18); position:relative}
.kk-srow>span{font-weight:700; font-size:1.05em}
.kk-srow.is-focus{background:rgba(242,193,78,.28)}
.kk-srow.is-focus::before{content:''; position:absolute; left:-1.1em; top:50%; width:.7em; height:.9em; margin-top:-.45em;
  background:var(--red); clip-path:polygon(0 0,100% 50%,0 100%)}
.kk-opts{display:flex; gap:.7em; flex-wrap:wrap}
.kk-opt{position:relative; padding:.3em .7em .35em; font-weight:700; color:var(--ink2); pointer-events:auto}
.kk-opt.is-on{color:var(--ink)}
.kk-opt .kk-circle{position:absolute; inset:-.32em -.5em; pointer-events:none; opacity:0}
.kk-opt.is-on .kk-circle{opacity:1}
.kk-circle svg{width:100%; height:100%}
.kk-range{display:flex; align-items:center; gap:.6em}
.kk-range .kk-bars{display:flex; gap:.22em}
.kk-range .kk-bars i{width:1.05em; height:1.2em; border:.13em solid var(--ink); transform:skewX(-14deg); pointer-events:auto; cursor:pointer}
.kk-range .kk-bars i.on{background:var(--ink)}
.kk-arrow{width:1.7em; height:1.7em; display:flex; align-items:center; justify-content:center; font-weight:800; opacity:.35; pointer-events:auto}
.kk-srow.is-focus .kk-arrow{opacity:1}
.kk-devtabs{display:flex; gap:.5em; margin-top:.9em}
.kk-devtab{pointer-events:auto; padding:.45em 1em .5em; font-weight:800; border-radius:.35em .35em 0 0; background:var(--paper-lo); color:var(--ink2); position:relative}
.kk-devtab.is-on{background:var(--ink); color:var(--paper-hi)}
.kk-devtab.is-focus{box-shadow:0 0 0 .15em var(--red)}
.kk-crow{display:grid; grid-template-columns:12em 1fr; gap:1em; padding:.5em .4em; border-bottom:.08em solid rgba(45,42,50,.18); align-items:center}
.kk-crow>span{font-weight:700}
.kk-crow>div{display:flex; gap:.4em; align-items:center; flex-wrap:wrap; color:var(--ink2); font-weight:600}

/* ---------------------------------------------------------------- intro chapter card */
.kk-intro{position:absolute; left:calc(3em + var(--sal)); bottom:calc(3.5em + var(--sab)); min-width:26em; max-width:calc(100% - 16em); rotate:-1.2deg}
.kk-intro .kk-paper{padding:1.3em 1.8em 1.5em}
.kk-intro .kk-h{font-size:3.1em; margin:.15em 0 .1em}
.kk-intro p{margin:0; font-weight:500; color:var(--ink2); font-size:1.1em}
.kk-intro-rule{display:block; width:12em; height:.8em; margin:.3em 0 .5em}
.kk-skip{position:absolute; right:calc(2.2em + var(--sar)); bottom:calc(1.6em + var(--sab)); pointer-events:auto}
.kk-skip .kk-paper{padding:.5em 1em; font-weight:800; display:flex; gap:.5em; align-items:center}

/* ---------------------------------------------------------------- HUD */
.kk-hud{position:absolute; inset:0; pointer-events:none}
.kk-hud-tl{position:absolute; left:calc(1.6em + var(--sal)); top:calc(1.4em + var(--sat)); display:flex; gap:1.2em; align-items:flex-start}
.kk-hud-tr{position:absolute; right:calc(1.8em + var(--sar)); top:calc(1.4em + var(--sat)); display:flex; flex-direction:column; align-items:flex-end; gap:.5em}
.kk-hud-bl{position:absolute; left:calc(1.6em + var(--sal)); bottom:calc(1.4em + var(--sab))}
.kk-hud-br{position:absolute; right:calc(2em + var(--sar)); bottom:calc(.8em + var(--sab))}

.kk-slot{position:relative; width:7.4em; height:7.4em; transform:rotate(-2deg)}
.kk-slot .kk-paper{position:absolute; inset:0}
.kk-window{position:absolute; inset:1.05em; overflow:hidden; background:rgba(45,42,50,.2);
  box-shadow:inset .32em .32em 0 rgba(45,42,50,.55), inset -.08em -.08em 0 rgba(255,255,255,.5)}
.kk-reel{position:absolute; left:0; right:0; top:0; will-change:transform}
.kk-reel .kk-svg{display:block; width:100%; aspect-ratio:1; padding:.5em}
.kk-held-icon{position:absolute; inset:0; padding:.5em; display:none}
.kk-slot.is-held .kk-window{background:rgba(242,193,78,.35)}
.kk-slot.is-held::after{content:''; position:absolute; inset:.6em; border:.16em dashed var(--ink); border-radius:.2em; animation:kk-march 1s linear infinite}
@keyframes kk-march{to{transform:rotate(-2deg) scale(1.02)}}
.kk-slot.is-thud{animation:kk-thud .34s cubic-bezier(.2,1.8,.4,1)}
@keyframes kk-thud{0%{transform:rotate(-2deg) scale(1.22)}60%{transform:rotate(-4deg) scale(.95)}100%{transform:rotate(-2deg) scale(1)}}
.kk-rm .kk-slot.is-thud{animation:none}
.kk-count{position:absolute; right:-.7em; bottom:-.5em; min-width:2.2em; height:2.2em; padding:0 .4em; border-radius:1.1em;
  background:var(--ink); color:var(--paper-hi); font:800 1.05em/2.2em var(--fb); text-align:center; display:none}
.kk-slot-name{position:absolute; left:50%; top:100%; margin-top:.5em; translate:-50% 0; rotate:1.5deg; white-space:nowrap; font-weight:800; font-size:.8em;
  color:var(--ink); background:var(--paper-hi); padding:.15em .55em .2em; box-shadow:.12em .14em 0 rgba(45,42,50,.75); opacity:0; transition:opacity .2s}
.kk-slot.has-item .kk-slot-name{opacity:1}

.kk-panel{position:relative; transform:rotate(1.2deg)}
.kk-panel .kk-paper{padding:.5em 1em .55em; display:flex; align-items:center; gap:.7em}
.kk-lap{font-size:2.3em; line-height:1; display:flex; align-items:center}
.kk-lap small{font:800 .36em var(--fb); letter-spacing:.14em; margin-right:.4em; color:var(--ink2)}
#kk-root .kk-clockc{width:7.4em; height:2.3em}
.kk-split{font:800 1.1em var(--fb); padding:.25em .7em; border-radius:.2em; color:var(--paper-hi); opacity:0; transform:translateY(-.4em); transition:opacity .2s, transform .2s}
.kk-split.is-on{opacity:1; transform:none}
.kk-split.is-ahead{background:var(--blue)}
.kk-split.is-behind{background:var(--red)}

/* place: an ink stamp pressed onto a torn paper card, the field count printed small beside it */
.kk-place{position:relative; font-size:6.2em; line-height:1; transform:rotate(-3.5deg); transform-origin:60% 60%}
.kk-place .kk-sheet{filter:drop-shadow(.045em .055em 0 rgba(45,42,50,.85))}
.kk-place .kk-paper{padding:.1em .42em .06em .14em}
.kk-place .kk-num{display:block}
.kk-place .kk-of{position:absolute; right:.1em; bottom:.1em; font:800 .17em var(--fb); letter-spacing:.04em; color:var(--ink2)}
.kk-place.is-stamp{animation:kk-stamp .3s cubic-bezier(.2,1.6,.45,1)}
@keyframes kk-stamp{0%{transform:rotate(-9deg) scale(1.25)}100%{transform:rotate(-3.5deg) scale(1)}}
.kk-rm .kk-place.is-stamp{animation:none}

.kk-map{position:relative; width:14em; height:14em; transform:rotate(1.5deg)}
.kk-map .kk-paper{position:absolute; inset:0; background:rgba(243,234,211,.62)}
.kk-map svg{position:absolute; inset:.6em; width:calc(100% - 1.2em); height:calc(100% - 1.2em); overflow:visible}

.kk-center{position:absolute; left:50%; top:22%; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:.8em}
.kk-banner{position:relative; padding:.3em 1.9em .38em; font-size:3.4em; white-space:nowrap;
  background:var(--red); clip-path:polygon(0 0,100% 0,95% 50%,100% 100%,0 100%,5% 50%)}
.kk-banner-wrap{filter:drop-shadow(.14em .18em 0 rgba(45,42,50,.85))}
.kk-slam{animation:kk-slam .95s cubic-bezier(.2,.9,.3,1) both}
@keyframes kk-slam{0%{transform:scale(3.2) rotate(-12deg); opacity:0}18%{transform:scale(.94) rotate(-3deg); opacity:1}
  26%{transform:scale(1.04) rotate(-3deg)}34%,100%{transform:scale(1) rotate(-3deg)}}
.kk-away{animation:kk-away .35s ease-in forwards}
@keyframes kk-away{to{transform:translateY(-3em) rotate(-3deg); opacity:0}}
.kk-rm .kk-slam, .kk-rm .kk-away{animation:none}

.kk-wrong{display:flex; flex-direction:column; align-items:center; transform-origin:50% 100%; animation:kk-wobble 1.6s ease-in-out infinite}
.kk-wrong .kk-sign{width:8.5em; height:8.5em}
.kk-wrong b{margin-top:.4em; font-size:1.9em; background:var(--paper-hi); padding:.18em .6em .22em; transform:rotate(-2deg)}
.kk-wrong-wrap{filter:drop-shadow(.2em .25em 0 rgba(45,42,50,.85))}
@keyframes kk-wobble{50%{transform:rotate(3deg)}}
.kk-rm .kk-wrong{animation:none}

.kk-count-num{font-size:13em; line-height:1; position:relative;
  transform-origin:50% 88%; animation:kk-cutout .5s cubic-bezier(.2,.9,.3,1.25) both}
@keyframes kk-cutout{0%{transform:perspective(40em) rotateX(-95deg)}60%{transform:perspective(40em) rotateX(12deg)}100%{transform:perspective(40em) rotateX(0)}}
.kk-count-num.is-go{font-size:7.5em}
.kk-rm .kk-count-num{animation:none}
.kk-grade{font-size:2.2em; padding:.28em .75em .32em; background:var(--ink); transform:rotate(-4deg);
  box-shadow:.12em .14em 0 rgba(45,42,50,.45); animation:kk-slam .9s cubic-bezier(.2,.9,.3,1) both}
.kk-grade.is-meh{background:var(--paper-hi); box-shadow:.12em .14em 0 var(--ink)}
.kk-wait{font-weight:800; font-size:1.1em; padding:.4em .9em; background:rgba(250,244,228,.9); box-shadow:.14em .16em 0 rgba(45,42,50,.6)}

.kk-flip{position:absolute; right:0; top:0; width:30em; height:30em; pointer-events:none; perspective:1400px; overflow:hidden}
.kk-flip i{position:absolute; right:0; top:0; width:100%; height:100%; transform-origin:100% 0;
  background:linear-gradient(225deg, var(--paper-hi) 0 38%, #d7c9a6 49%, transparent 50%); clip-path:polygon(0 0,100% 0,100% 100%);
  filter:drop-shadow(-.4em .5em 0 rgba(45,42,50,.35)); animation:kk-peel 1.1s cubic-bezier(.4,0,.2,1) both}
.kk-flip b{position:absolute; right:4.4em; top:4.4em; font-size:2.4em; white-space:nowrap;
  translate:50% -50%; rotate:45deg; animation:kk-peelt 1.1s both}
@keyframes kk-peel{0%{transform:scale(0)}28%,68%{transform:scale(1)}100%{transform:scale(0)}}
@keyframes kk-peelt{0%,15%{opacity:0}30%,62%{opacity:1}78%,100%{opacity:0}}
.kk-rm .kk-flip i, .kk-rm .kk-flip b{animation-timing-function:steps(1)}

.kk-threat{position:absolute; width:6em; height:6em; margin:-3em 0 0 -3em; pointer-events:none; display:none}
.kk-threat .kk-disc{position:absolute; inset:0; border-radius:50%; background:var(--paper-hi); box-shadow:.16em .2em 0 var(--ink), inset 0 0 0 .22em var(--ink)}
.kk-threat .kk-svg{position:absolute; inset:.9em}
.kk-threat svg.kk-eta{position:absolute; inset:-.35em; width:calc(100% + .7em); height:calc(100% + .7em); transform:rotate(-90deg)}
.kk-threat .kk-bang{position:absolute; right:-.6em; top:-.7em; width:2.4em; height:2.4em; border-radius:50%; background:var(--red); color:var(--paper-hi);
  font:800 1.3em/1 var(--fb); display:flex; align-items:center; justify-content:center; box-shadow:.1em .12em 0 var(--ink)}
.kk-threat.is-near .kk-disc{background:#ffd9d2}
.kk-threat.is-near{animation:kk-pulse .25s ease-in-out infinite alternate}
@keyframes kk-pulse{to{transform:scale(1.12)}}
.kk-rm .kk-threat.is-near{animation:none}

.kk-inkl{position:absolute; inset:0; pointer-events:none}
.kk-inkl svg{position:absolute; inset:0; width:100%; height:100%}
.kk-drip{animation:kk-drip 3.2s cubic-bezier(.3,0,.6,1) both}
@keyframes kk-drip{from{transform:scaleY(.15)}to{transform:scaleY(1)}}
.kk-rm .kk-drip{animation:none}

.kk-finish{display:flex; flex-direction:column; align-items:center; gap:.3em}
.kk-checker{padding:.32em .9em; font-size:4.2em; position:relative;
  background:conic-gradient(var(--ink) 25%, var(--paper-hi) 0 50%, var(--ink) 0 75%, var(--paper-hi) 0) 0 0/.5em .5em}
.kk-checker .kk-lt{background:var(--paper-hi); padding:.12em .35em .16em; box-shadow:.06em .07em 0 var(--ink)}
.kk-checker-wrap{filter:drop-shadow(.12em .15em 0 rgba(45,42,50,.8)); transform:rotate(-3deg)}

/* ---------------------------------------------------------------- panels: pause, results, standings, podium */
.kk-dim{position:absolute; inset:0; pointer-events:auto;
  background:radial-gradient(rgba(45,42,50,.5) 30%, transparent 33%) 0 0/7px 7px, rgba(45,42,50,.3)}
.kk-pause{position:absolute; left:50%; top:50%; width:25em; translate:-50% -50%; rotate:-1.2deg}
.kk-pause>.kk-sheet>.kk-paper{padding:1.5em 2em 1.7em}
.kk-pause .kk-h{font-size:2.5em}
.kk-toc{margin-top:.8em; display:flex; flex-direction:column}
.kk-tocrow{pointer-events:auto; display:flex; align-items:baseline; gap:.5em; padding:.5em .4em .5em 1.2em; font-weight:700; font-size:1.25em; position:relative}
.kk-tocrow .kk-lead{flex:1; border-bottom:.12em dotted var(--ink3); transform:translateY(-.25em)}
.kk-tocrow .kk-pg{font-size:.95em}
.kk-tocrow.is-focus{color:var(--ink)}
.kk-tocrow.is-focus::before{content:''; position:absolute; left:0; top:.2em; bottom:.2em; width:.55em; background:var(--red);
  clip-path:polygon(0 0,100% 0,100% 100%,50% 82%,0 100%)}
.kk-tocrow.is-focus .kk-lab{text-decoration:underline; text-decoration-thickness:.12em; text-underline-offset:.2em; text-decoration-color:var(--red)}
.kk-note{margin-top:.6em; font-weight:600; font-size:.9em; color:var(--red); min-height:1.2em}

.kk-board{position:absolute; left:50%; top:50%; width:52em; max-width:calc(100% - 3em); translate:-50% -50%; rotate:-.5deg}
.kk-board>.kk-sheet>.kk-paper{padding:1.4em 2.2em 1.6em}
.kk-board .kk-h{font-size:2.6em}
.kk-board-top{display:flex; justify-content:space-between; align-items:flex-end; gap:1em}
.kk-table{margin-top:.8em; display:flex; flex-direction:column}
.kk-tr{display:grid; grid-template-columns:3.2em 2.6em 1fr 6.5em 6.5em 4.6em; align-items:center; gap:.8em; padding:.28em .4em;
  border-bottom:.08em solid rgba(45,42,50,.2); position:relative}
.kk-tr.kk-th{font-weight:800; font-size:.78em; letter-spacing:.12em; color:var(--ink2); border-bottom:.14em solid var(--ink); white-space:nowrap}
.kk-tr .kk-pl{font-size:1.75em; line-height:1}
.kk-tr .kk-svg{width:2.4em; height:2.4em}
.kk-tr .kk-nm{font-weight:800; font-size:1.12em}
.kk-tr .kk-t{font-weight:700; text-align:right}
.kk-tr .kk-t.is-est{color:var(--ink2)}
.kk-tr .kk-pts{text-align:right; font-size:1.35em; display:flex; justify-content:flex-end; align-items:center}
.kk-tr .kk-plus{color:var(--red); font-weight:800; font-size:.8em; margin-left:.3em}
.kk-tr.is-me::before{content:''; position:absolute; inset:.12em -.6em .08em -.6em; z-index:-1; background:rgba(242,193,78,.55);
  clip-path:polygon(0 12%,3% 0,99% 6%,100% 88%,97% 100%,1% 92%); transform:skewX(-8deg)}
.kk-rows-in .kk-tr:not(.kk-th){animation:kk-rowin .32s cubic-bezier(.2,1.4,.4,1) both}
@keyframes kk-rowin{from{transform:translateX(-1.2em); opacity:0}}
.kk-rm .kk-rows-in .kk-tr{animation:none}
.kk-bar{height:1.1em; background:var(--ink); transform:skewX(-14deg); min-width:.2em; box-shadow:inset 0 0 0 .12em var(--ink)}
.kk-move{font-weight:800; font-size:.85em; text-align:center}
.kk-move.up{color:var(--green)} .kk-move.down{color:var(--red)}
.kk-std .kk-tr{grid-template-columns:3.2em 2.6em 11em 1fr 3.6em 2em}
.kk-rekor{position:absolute; right:1.6em; top:.5em; rotate:-6deg; padding:.2em .5em .25em; font-size:1.9em;
  border:.08em solid var(--red); border-radius:.14em; opacity:.92; animation:kk-stamp .35s cubic-bezier(.2,1.6,.45,1) .6s both}
.kk-tr .kk-tag{justify-self:end; border-color:var(--blue); color:var(--blue)}
.kk-tr.is-total{border-bottom:0; border-top:.14em solid var(--ink)}
.kk-actions{margin-top:1.2em; display:flex; gap:1em; justify-content:flex-end; flex-wrap:wrap}
.kk-btn{pointer-events:auto; position:relative}
.kk-btn .kk-paper{padding:.6em 1.3em .65em; font-weight:800; font-size:1.1em; display:flex; gap:.6em; align-items:center}
.kk-btn .kk-paper{background:var(--paper-lo)}
.kk-btn.is-primary .kk-paper{background:var(--ink); color:var(--paper-hi)}
.kk-btn .kk-sheet{filter:drop-shadow(.18em .22em 0 rgba(45,42,50,.8))}
.kk-btn.is-focus .kk-sheet{transform:translateY(-.25em)!important; filter:drop-shadow(.24em .4em 0 rgba(45,42,50,.9))}
.kk-btn.is-focus .kk-paper{box-shadow:inset 0 -.22em 0 var(--red)}

.kk-podium{position:absolute; left:0; right:0; bottom:calc(2.2em + var(--sab)); display:flex; justify-content:center; align-items:flex-end; gap:1.4em; pointer-events:none}
/* podium captions: low paper tags, so the podium itself (cinematics) stays in view */
.kk-cap{position:relative}
.kk-cap .kk-paper{padding:.45em 1.1em .5em .8em; display:flex; align-items:center; gap:.6em}
.kk-cap .kk-pl{font-size:2.4em; line-height:1}
.kk-cap b{display:block; font-weight:800; font-size:1.15em; white-space:nowrap}
.kk-cap span{color:var(--ink2); font-weight:600; white-space:nowrap}
.kk-cap.c1{order:2; translate:0 -.8em; rotate:-1deg} .kk-cap.c2{order:1; rotate:1.5deg} .kk-cap.c3{order:3; rotate:-1.8deg}
.kk-podium-head{position:absolute; left:50%; top:calc(2.2em + var(--sat)); translate:-50% 0; rotate:-1.5deg}
.kk-podium-head .kk-paper{padding:.6em 1.8em .8em; text-align:center}
.kk-podium-head .kk-h{font-size:3.2em}
.kk-podium-go{position:absolute; right:calc(2.2em + var(--sar)); bottom:calc(2.2em + var(--sab))}

/* ---------------------------------------------------------------- touch */
.kk-touch{position:absolute; inset:0; pointer-events:none}
.kk-tzone{position:absolute; pointer-events:auto; touch-action:none}
.kk-steer{left:0; bottom:0; width:42%; height:62%}
.kk-track{position:absolute; left:calc(1.6em + var(--sal)); bottom:calc(1.8em + var(--sab)); width:17em; height:5.2em; border-radius:2.6em;
  background:rgba(250,244,228,.55); box-shadow:inset 0 0 0 .18em rgba(45,42,50,.75), .16em .2em 0 rgba(45,42,50,.45)}
.kk-track::before, .kk-track::after{position:absolute; top:50%; margin-top:-.6em; font:800 1.2em/1 var(--fb); color:var(--ink2)}
.kk-track::before{content:'◀'; left:.9em} .kk-track::after{content:'▶'; right:.9em}
.kk-knob{position:absolute; left:50%; top:50%; width:5.6em; height:5.6em; margin:-2.8em 0 0 -2.8em; border-radius:50%;
  background:var(--paper-hi); box-shadow:inset 0 0 0 .2em var(--ink), .18em .24em 0 rgba(45,42,50,.8)}
.kk-knob::after{content:''; position:absolute; inset:1.6em; border-radius:50%; border:.16em dashed var(--ink3)}
.kk-tbtn{position:absolute; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:rgba(250,244,228,.8); box-shadow:inset 0 0 0 .2em var(--ink), .2em .26em 0 rgba(45,42,50,.8);
  font:800 1em/1 var(--fb); letter-spacing:.06em; color:var(--ink); pointer-events:auto; touch-action:none}
.kk-tbtn.is-down{transform:translate(.14em,.18em); box-shadow:inset 0 0 0 .2em var(--ink), .06em .08em 0 rgba(45,42,50,.8); background:var(--mustard)}
.kk-tbtn .kk-svg{width:55%; height:55%}
.kk-tgas{right:calc(1.2em + var(--sar)); bottom:calc(1.4em + var(--sab)); width:8em; height:8em; border-radius:1.6em}
.kk-tgas.is-auto{background:rgba(242,193,78,.55)}
.kk-tdrift{right:calc(10.2em + var(--sar)); bottom:calc(1.2em + var(--sab)); width:7.4em; height:7.4em}
.kk-titem{right:calc(11.1em + var(--sar)); bottom:calc(9.9em + var(--sab)); width:5.6em; height:5.6em}
.kk-tbrake{right:calc(2.5em + var(--sar)); bottom:calc(10.6em + var(--sab)); width:5.4em; height:5.4em}
.kk-tlook{left:calc(1.6em + var(--sal)); bottom:calc(8.6em + var(--sab)); width:6.4em; height:3.2em; border-radius:1.6em}
.kk-tauto{left:calc(50% + 2.6em); top:calc(1.1em + var(--sat)); height:3em; padding:0 .9em; border-radius:.6em; flex-direction:row; gap:.4em}
.kk-tbtn>small{font-size:.8em; letter-spacing:.04em}
.kk-tpause{left:50%; top:calc(.8em + var(--sat)); width:3.6em; height:3.6em; margin-left:-1.8em; border-radius:.6em}
.kk-tpause .kk-svg{width:1.6em; height:1.6em}
.kk-tbtn.is-armed{background:rgba(242,193,78,.9)}

/* ---------------------------------------------------------------- hints */
.kk-fps{position:absolute; left:50%; bottom:calc(.35em + var(--sab)); translate:-50% 0; padding:.1em .55em; font:700 .8em var(--fb); color:var(--ink2);
  background:rgba(250,244,228,.72); font-variant-numeric:tabular-nums; pointer-events:none; z-index:5}
.kk-hint{position:absolute; left:50%; bottom:calc(4.5% + var(--sab)); translate:-50% 0; rotate:-1.2deg; max-width:34em}
.kk-hint .kk-paper{padding:.7em 1.3em .8em; font-weight:700; font-size:1.2em; display:flex; gap:.6em; align-items:center; flex-wrap:wrap; justify-content:center}
.kk-hint .kk-tape{position:absolute; left:50%; top:-.7em; width:4.4em; height:1.4em; margin-left:-2.2em; background:rgba(242,193,78,.7); transform:rotate(-3deg); z-index:2}
.kk-hint .kk-rot{width:2.2em; height:2.2em}
.kk-hint-in{animation:kk-popup .5s cubic-bezier(.25,.8,.3,1) both; transform-origin:50% 100%}
.kk-rm .kk-hint-in{animation:none}
.kk-teach{position:absolute; right:calc(2em + var(--sar)); top:50%; translate:0 -50%; rotate:1.4deg; width:25em}
.kk-teach .kk-paper{padding:1em 1.3em 1.2em}
.kk-teach .kk-h{font-size:1.7em; margin-bottom:.4em}
.kk-teach .kk-crow{grid-template-columns:6.8em 1fr; padding:.35em .2em; font-size:.95em}

/* ---------------------------------------------------------------- compact (phones in landscape) */
@media (max-height:520px){
  .kk-head .kk-h{font-size:2.2em}
  .kk-head{top:calc(1em + var(--sat))} .kk-back{top:calc(1em + var(--sat))}
  .kk-hasback .kk-head{left:calc(7em + var(--sal))}
  .kk-row{bottom:calc(1.6em + var(--sab)); gap:1.4em}
  .kk-card{width:15em} .kk-card .kk-paper{min-height:0; padding:.7em 1em .9em} .kk-art{height:5.6em; margin-bottom:.3em} .kk-art .kk-svg{width:5.2em; height:5.2em}
  .kk-card p{font-size:.95em}
  .kk-swatch{width:13em} .kk-swatch .kk-face{height:14.5em}
  .kk-steps{display:none}
  .kk-mini{top:calc(1em + var(--sat)); right:calc(1.6em + var(--sar))}
  .kk-charinfo{top:calc(6.4em + var(--sat)); width:19em} .kk-charinfo .kk-paper{padding:.8em 1.1em 1em} .kk-charinfo .kk-h{font-size:2em}
  .kk-stats{margin-top:.5em; gap:.3em .8em}
  .kk-roster{bottom:calc(1.2em + var(--sab)); gap:.5em} .kk-chip{width:6em} .kk-chip .kk-svg{width:4.2em; height:4.2em}
  .kk-chapters{top:calc(1em + var(--sat)); gap:.5em} .kk-chtab .kk-paper{padding:.5em 1em .55em}
  .kk-chapter{bottom:calc(1.4em + var(--sab)); width:32em} .kk-chapter .kk-paper{padding:.9em 1.2em 1em; grid-template-columns:minmax(0,1fr) 6.5em} .kk-chapter .kk-svg{width:6.5em; height:6.5em}
  .kk-chapter .kk-h{font-size:1.8em}
  .kk-card .kk-h{font-size:1.55em}
  .kk-form{top:calc(50% + 1.2em)} .kk-form>.kk-sheet>.kk-paper{padding:.8em 1.4em 1em} .kk-form .kk-h{font-size:1.8em}
  .kk-form{width:68em; max-width:calc(100% - 2em)}
  .kk-form .kk-rows{display:grid; grid-auto-flow:column; grid-template-rows:repeat(5,auto); column-gap:2.2em}
  .kk-srow{padding:.2em .5em; min-height:3.4em; grid-template-columns:7.8em 1fr} .kk-rows{margin-top:.4em} .kk-crow{padding:.3em .4em; grid-template-columns:7.8em 1fr}
  .kk-opt{padding:.55em .6em} .kk-arrow{width:2.4em; height:2.4em}
  .kk-btn .kk-paper{padding:.8em 1.5em .85em; font-size:1.15em}
  .kk-flip{width:20em; height:20em} .kk-flip b{right:3.6em; top:3.6em; font-size:1.8em}
  .kk-board{width:60em} .kk-board>.kk-sheet>.kk-paper{padding:.8em 1.4em 1em} .kk-board .kk-h{font-size:1.9em}
  .kk-tr{padding:.12em .3em} .kk-tr .kk-pl{font-size:1.4em} .kk-tr .kk-svg{width:1.9em; height:1.9em} .kk-actions{margin-top:.6em}
  .kk-place{font-size:5em}
  .kk-map{width:10em; height:10em}
  .kk-slot{width:6em; height:6em} .kk-window{inset:.85em}
  .kk-count-num{font-size:10em} .kk-count-num.is-go{font-size:6.5em}
  .kk-banner{font-size:2.6em} .kk-center{top:14%}
  .kk-intro{min-width:22em; bottom:calc(1.6em + var(--sab))}
  .kk-cover-title{font-size:6.2em} .kk-cover-cta{margin-top:.4em}
  .kk-pause{width:23em} .kk-pause>.kk-sheet>.kk-paper{padding:1em 1.5em 1.1em} .kk-tocrow{padding:.32em .4em .32em 1.2em; font-size:1.1em}
  .kk-podium-head .kk-h{font-size:2.4em}
  .kk-flip b{display:none}
  .kk-teach{width:19em}
}
/* touch race layout: controls own the bottom corners, so the map and place move up */
.kk-touch-race .kk-hud-bl{left:auto; bottom:auto; right:calc(1.4em + var(--sar)); top:calc(7.8em + var(--sat))}
.kk-touch-race .kk-map{width:8.4em; height:8.4em}
.kk-touch-race .kk-hud-br{right:auto; left:calc(9.6em + var(--sal)); top:calc(.4em + var(--sat)); bottom:auto}
.kk-touch-race .kk-place{font-size:4.2em}
.kk-touch-race .kk-place .kk-of{font-size:.24em}
.kk-touch-race .kk-flip b{display:none}
.kk-touch-race .kk-hud-tl{left:calc(1em + var(--sal)); top:calc(1em + var(--sat))}
.kk-touch-race .kk-slot{width:6.8em; height:6.8em; pointer-events:auto}
.kk-touch-race .kk-mapmini{display:block}
.kk-touch-race .kk-teach{top:calc(9.4em + var(--sat)); translate:none; right:auto; left:calc(1em + var(--sal)); width:26em}
@media (orientation:portrait){
  .kk-row{flex-direction:column; align-items:center; bottom:calc(2em + var(--sab)); gap:1em}
  .kk-card{width:min(24em, 86vw)} .kk-card .kk-paper{min-height:0} .kk-art{height:4.6em} .kk-art .kk-svg{width:4.4em; height:4.4em}
  .kk-roster{flex-wrap:wrap; padding:0 1em} .kk-charinfo{width:calc(100% - 6em)}
  .kk-steps{display:none} .kk-cover-title{font-size:4.2em}
  .kk-board .kk-tr{grid-template-columns:2.4em 2em 1fr 5.4em 0 3.6em}
  .kk-bookmark{right:3%; height:30%}
  .kk-mini{top:calc(9.4em + var(--sat)); right:auto; left:calc(3em + var(--sal))}
  .kk-touch-race .kk-tauto{left:calc(1em + var(--sal)); top:calc(11.4em + var(--sat))}
  /* portrait race: the top row only fits slot, place and lap; pause goes under the lap panel, the map below it */
  .kk-touch-race .kk-tpause{left:auto; right:calc(1.2em + var(--sar)); top:calc(6.4em + var(--sat)); margin-left:0}
  .kk-touch-race .kk-hud-bl{top:calc(11em + var(--sat))}
  .kk-touch-race .kk-teach{top:calc(20.5em + var(--sat)); width:calc(100% - 2em)}
  .kk-touch-race .kk-hint, .kk-hint{bottom:auto; top:32%}
  .kk-track{width:14em}
}
`;
}
