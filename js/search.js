// ── SHARED SEARCH / FILTER ENGINE ───────────────────────────────────────
// Included after camps-data.js by index.html, camps.html and weekly-classes.html.
// Keeping this in one file means the homepage hero search, the /camps page
// and the /weekly-classes page all filter identically.

const COLS = [{bg:'#CFE8F6',ink:'#3D77A3'},{bg:'#C9F0DA',ink:'#1D8A52'},{bg:'#E7E1F8',ink:'#5B4FCA'},{bg:'#FBE1EB',ink:'#C6567F'}];

// Halloween camp treatment — any listing with "Halloween" in its name gets
// an orange card band with a black silhouette icon instead of its usual
// rotating pastel colour, matching the orange hero banner on its listing
// page. Same three hand-drawn silhouettes used there (pumpkin/ghost/bat).
const HW_ORANGE = {bg:'#FCE3C6', ink:'#E8791E'};
const HW_PUMPKIN_ICON = '<svg class="hw-icon" viewBox="0 0 24 24" style="width:34px;height:34px;opacity:.3;"><path d="M11 8.2c0-1.8.9-2.9 1-4.2.1 1.3 1 2.4 1 4.2" stroke="#000" stroke-width="1.3" fill="none" stroke-linecap="round"/><ellipse cx="8.3" cy="14.5" rx="3.1" ry="5.2" fill="#000"/><ellipse cx="12" cy="14.5" rx="3.6" ry="5.8" fill="#000"/><ellipse cx="15.7" cy="14.5" rx="3.1" ry="5.2" fill="#000"/></svg>';
const HW_BAT_ICON = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;"><path fill="#fff" d="M12 8.3c-.6-2-1.9-3.3-3.4-3.8.4 1 .5 1.9.3 2.8-2.1-2-4.9-2.5-7.4-1.3 1.5.5 2.5 1.4 3 2.5-1.8.6-3.2 2-4 3.8 1.7-.9 3.2-1 4.4-.4-.5 1.2-.5 2.5 0 3.6 1-1.3 2.1-2.4 3.7-2.8.4 1.6 1.4 2.8 3.4 3.3 2-.5 3-1.7 3.4-3.3 1.6.4 2.7 1.5 3.7 2.8.5-1.1.5-2.4 0-3.6 1.2-.6 2.7-.5 4.4.4-.8-1.8-2.2-3.2-4-3.8.5-1.1 1.5-2 3-2.5-2.5-1.2-5.3-.7-7.4 1.3-.2-.9-.1-1.8.3-2.8-1.5.5-2.8 1.8-3.4 3.8z"/></svg>';

const ALL_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ── Activity/category chips ─────────────────────────────────────────────
// Nine clean segments, hand-mapped from the 31 raw values in the Airtable
// Category field (lots of duplicates in there — e.g. "Sport", "Sport —
// Tennis", "Tennis" all roll up into Sport). Each segment matches any raw
// category value containing one of its keywords; several selected chips
// are OR'd together, not AND'd, so "Sport + STEM" means either one.
const ACTIVITY_SEGMENTS = [
  {key:'sport', label:'Sport', icon:'ti-ball-football', ac:'#3D77A3', tint:'#CFE8F6', match:['sport','tennis','football','gaa']},
  {key:'stem', label:'STEM', icon:'ti-circuit-board', ac:'#3D77A3', tint:'#CFE8F6', match:['stem','coding','lego']},
  {key:'multi', label:'Multi-Activity', icon:'ti-stars', ac:'#3D77A3', tint:'#CFE8F6', match:['multi-activity','multi activity']},
  {key:'outdoor', label:'Outdoor & Adventure', icon:'ti-mountain', ac:'#1D8A52', tint:'#C9F0DA', match:['outdoor','adventure']},
  {key:'language', label:'Language', icon:'ti-language', ac:'#1D8A52', tint:'#C9F0DA', match:['language']},
  {key:'drama', label:'Drama & Performing Arts', icon:'ti-masks-theater', ac:'#5B4FCA', tint:'#E7E1F8', match:['drama','performing']},
  {key:'arts', label:'Arts & Crafts', icon:'ti-palette', ac:'#5B4FCA', tint:'#E7E1F8', match:['art']},
  {key:'music', label:'Music', icon:'ti-music', ac:'#C6567F', tint:'#FBE1EB', match:['music']},
  {key:'dance', label:'Dance', icon:'ti-music', ac:'#C6567F', tint:'#FBE1EB', match:['dance']},
];

function activityChipsHtml(idPrefix){
  return ACTIVITY_SEGMENTS.map(a=>(
    '<label class="actchip" style="--ac:'+a.ac+'; --tint:'+a.tint+'"><input type="checkbox" value="'+a.key+'" id="'+idPrefix+'-'+a.key+'"><span><i class="ti '+a.icon+'"></i>'+a.label+'</span></label>'
  )).join('');
}
function readSelectedActivities(idPrefix){
  const set = new Set();
  ACTIVITY_SEGMENTS.forEach(a=>{
    const el = document.getElementById(idPrefix+'-'+a.key);
    if(el && el.checked) set.add(a.key);
  });
  return set;
}
function setSelectedActivities(idPrefix, keys){
  ACTIVITY_SEGMENTS.forEach(a=>{
    const el = document.getElementById(idPrefix+'-'+a.key);
    if(el) el.checked = keys.includes(a.key);
  });
}
// A listing matches if its (freeform) category contains a keyword for ANY
// selected segment — OR logic, same spirit as matchesDays() below.
function matchesActivities(category, selectedKeys){
  if(!selectedKeys || !selectedKeys.size) return true;
  const c = (category||'').toLowerCase();
  return ACTIVITY_SEGMENTS.some(a => selectedKeys.has(a.key) && a.match.some(m => c.includes(m)));
}

// Freeform category string → accent colour + icon. Real category values are
// hand-typed free text (e.g. "Sport — Multi-activity", "STEM / LEGO"), not a
// clean enum, so this is a best-effort keyword match, not exact taxonomy —
// worth cleaning up the Airtable category field into a fixed picklist later.
function categoryStyle(cat){
  const c = (cat||'').toLowerCase();
  if(c.includes('tennis')) return {cc:'#3D77A3', icon:'ti-ball-tennis'};
  if(c.includes('football')||c.includes('gaa')) return {cc:'#1D8A52', icon:'ti-ball-football'};
  if(c.includes('adventure')||c.includes('outdoor')) return {cc:'#1D8A52', icon:'ti-mountain'};
  if(c.includes('drama')||c.includes('performing')) return {cc:'#5B4FCA', icon:'ti-masks-theater'};
  if(c.includes('dance')||c.includes('music')) return {cc:'#C6567F', icon:'ti-music'};
  if(c.includes('art')) return {cc:'#5B4FCA', icon:'ti-palette'};
  if(c.includes('stem')||c.includes('coding')||c.includes('lego')||c.includes('science')) return {cc:'#3D77A3', icon:'ti-circuit-board'};
  if(c.includes('language')) return {cc:'#1D8A52', icon:'ti-language'};
  if(c.includes('additional needs')) return {cc:'#5B4FCA', icon:'ti-heart'};
  if(c.includes('academic')) return {cc:'#3D77A3', icon:'ti-book'};
  if(c.includes('multi')||c.includes('sport')) return {cc:'#3D77A3', icon:'ti-stars'};
  return {cc:'#3D77A3', icon:'ti-star'};
}

// Sport-specific icon for a listing's card banner. Almost every sport
// listing has the generic Airtable category "Sport", so the actual sport
// is read from the listing's name + provider + category text instead.
// Order matters: GAA before soccer (Gaelic *football*), rugby before soccer
// (rugby clubs are often "... FC"). Returns '' when no sport is recognised,
// so non-sport cards keep their plain pastel banner.
// All icons are hand-drawn inline SVG (48px grid, thin 1.5px line, single
// colour via currentColor) so they render without any icon-font lookup.
const SPORT_SVG = {
  gaa: '<path d="M6 6l2.5-1.5 15 21-3 2z"/><path d="M8.6 9.6l2.4-1.5M10.4 12.2l2.4-1.5"/><path d="M20.5 27.5c-2 4.5-.5 11 5.5 13 5 1.5 11-.5 11.5-4 .5-3-2.5-5-6.5-6-3.5-.8-5.8-2.5-7.5-5"/><path d="M22.5 31.5c2 1.8 5 3 8 3.5" opacity=".6"/><circle cx="35" cy="12" r="6"/><path d="M29.6 9.6c3.4 2 7.4 2 10.8 0M29.6 14.4c3.4-2 7.4-2 10.8 0"/>',
  tennis: '<g transform="rotate(-35 24 24)"><ellipse cx="24" cy="16" rx="9.5" ry="12"/><g opacity=".55" stroke-width="1"><path d="M19 5.5v21M24 4v24M29 5.5v21M15.5 10h17M14.5 16h19M15.5 22h17"/></g><path d="M19.5 26.5l2.9 6.5M28.5 26.5l-2.9 6.5M20.5 27.5q3.5 2 7 0"/><rect x="21.6" y="33" width="4.8" height="12" rx="2.2"/><path d="M21.6 36.5h4.8M21.6 39.5h4.8M21.6 42.5h4.8" opacity=".6"/></g><circle cx="39" cy="10" r="5"/><path d="M34.8 7.8c2.6 1.3 2.6 3.1 0 4.4M43.2 7.8c-2.6 1.3-2.6 3.1 0 4.4"/>',
  rugby: '<g transform="rotate(-40 24 24)"><ellipse cx="24" cy="24" rx="18" ry="11"/><path d="M6 24q18-12 36 0M6 24q18 12 36 0" opacity=".6"/><path d="M17.5 24h13M19 21.8v4.4M22 21.8v4.4M25 21.8v4.4M28 21.8v4.4"/></g>',
  swim: '<circle cx="33" cy="12" r="3.5"/><path d="M12 22c4-8 12-10 17-5"/><path d="M18 27l9-5 8 3"/><path d="M4 32c3 0 3-2.5 6-2.5s3 2.5 6 2.5 3-2.5 6-2.5 3 2.5 6 2.5 3-2.5 6-2.5 3 2.5 6 2.5"/><path d="M4 39c3 0 3-2.5 6-2.5s3 2.5 6 2.5 3-2.5 6-2.5 3 2.5 6 2.5 3-2.5 6-2.5 3 2.5 6 2.5" opacity=".6"/><circle cx="9" cy="17" r="1"/><circle cx="6" cy="22" r=".8"/>',
  soccer: '<circle cx="24" cy="24" r="18"/><path d="M24 18l5.7 4.1-2.2 6.8h-7l-2.2-6.8z" fill="currentColor" fill-opacity=".18"/><path d="M24 18v-6M29.7 22.1l11.4-1.8M27.5 28.9l3.6 4.8M20.5 28.9l-3.6 4.8M18.3 22.1l-11.4-1.8" opacity=".9"/><path d="M15 8.4l9 3.6 9-3.6M36 10.6l-.6 9.7 6.2 7.4M40.4 31.3l-9.3 2.4-5.2 8.2M22.1 41.9l-5.2-8.2-9.3-2.4M6.4 27.7l6.2-7.4-.6-9.7" opacity=".55"/>',
  basketball: '<circle cx="24" cy="24" r="18"/><path d="M24 6v36M6 24h36"/><path d="M11.3 11.3c5.7 5.7 5.7 19.7 0 25.4M36.7 11.3c-5.7 5.7-5.7 19.7 0 25.4"/>',
  martial: '<path d="M6 18q18 4 36 0M6 23q18 4 36 0"/><rect x="20" y="16.5" width="8" height="8" rx="1.5"/><path d="M21.5 24.5L16 38l4.5 1.5L24 25M26.5 24.5L32 38l-4.5 1.5L24.5 25"/><path d="M17.2 35l4.2 1.2M30.8 35l-4.2 1.2" opacity=".6"/>',
  gym: '<path d="M8 4h32"/><path d="M16 4v21M32 4v21"/><path d="M14.5 25h3M30.5 25h3"/><circle cx="16" cy="31" r="5.5"/><circle cx="32" cy="31" r="5.5"/><path d="M8 4l-2 2M40 4l2 2" opacity=".6"/>',
  run: '<circle cx="30" cy="8" r="3.5"/><path d="M28.5 12.5L22 25"/><path d="M27 15.5l7 3.5 4-3M27 15.5l-7.5 1.5-4 5"/><path d="M22 25l7 6-2 9M22 25l-6 7-8-1"/><path d="M3 14h8M1 20h8M5 26h6" opacity=".5"/><path d="M4 44h40" opacity=".4"/>',
  hockey: '<path d="M7 6l2.5-1.5L31 33.5c2 2.5 5 3 7 1.5 2.5-1.5 4 1 2 3.5-3 3.5-9 3-12-1.5z"/><path d="M10.2 9.4l2.4-1.6M12 12l2.4-1.6" opacity=".7"/><circle cx="14" cy="38" r="3.8"/><circle cx="13" cy="37" r=".6"/><circle cx="15.3" cy="38.8" r=".6"/>',
  golf: '<path d="M18 6v32M18 6l14 4.5L18 15z"/><ellipse cx="18" cy="39" rx="8" ry="2.5"/><circle cx="33" cy="34" r="3.5"/><path d="M38 41l1-3M41 41l.5-2.5" opacity=".6"/>',
  bike: '<circle cx="12" cy="32" r="8"/><circle cx="36" cy="32" r="8"/><path d="M12 32l8-12h12l4 12M20 20l4 12 8-12M17 16h6M20 16v4M30 15h4M32 15v5"/><circle cx="24" cy="32" r="1.5"/>',
  horse: '<path d="M13 40C6 32 6 14 15 8c4-2.5 14-2.5 18 0 9 6 9 24 2 32l-4.5-2.5C36 31 36 17 30 12.5c-3-2-9-2-12 0-6 4.5-6 18.5-.5 25z"/><circle cx="11" cy="22" r=".9"/><circle cx="12" cy="29" r=".9"/><circle cx="37" cy="22" r=".9"/><circle cx="36" cy="29" r=".9"/><circle cx="16" cy="13" r=".9"/><circle cx="32" cy="13" r=".9"/>',
  sail: '<path d="M8 34h32l-5 6H13z"/><path d="M24 6v28M24 8l13 22H24M22 11l-10 19h10"/><path d="M4 43c3 0 3-2 6-2s3 2 6 2 3-2 6-2 3 2 6 2 3-2 6-2 3 2 6 2" opacity=".6"/>',
  kayak: '<path d="M4 30c10-6 30-6 40 0-10 4-30 4-40 0z"/><ellipse cx="24" cy="29" rx="4" ry="1.5"/><path d="M10 12l28 28"/><ellipse cx="8.5" cy="10.5" rx="2" ry="4.5" transform="rotate(-45 8.5 10.5)"/><ellipse cx="39.5" cy="41.5" rx="2" ry="4.5" transform="rotate(-45 39.5 41.5)"/>',
  multi: '<g transform="translate(9 9) scale(.68)"><circle cx="30" cy="8" r="3.5"/><path d="M28.5 12.5L22 25"/><path d="M27 15.5l7 3.5 4-3M27 15.5l-7.5 1.5-4 5"/><path d="M22 25l7 6-2 9M22 25l-6 7-8-1"/></g><circle cx="8" cy="10" r="4.5"/><path d="M8 5.5v9M3.5 10h9M4.8 6.8c2 2 2 4.4 0 6.4M11.2 6.8c-2 2-2 4.4 0 6.4" opacity=".7"/><circle cx="41" cy="12" r="3.8"/><path d="M37.9 10.3c1.9 1 1.9 2.4 0 3.4M44.1 10.3c-1.9 1-1.9 2.4 0 3.4" opacity=".7"/><circle cx="39" cy="38" r="5"/><path d="M39 35.4l2.4 1.8-.9 2.8h-3l-.9-2.8z" opacity=".7"/><path d="M4 44h28" opacity=".4"/>'
};
const SPORT_ICONS = [
  {match:['gaa','gaelic','hurling','camogie','gfc','clg','gaels','cumann'], svg:'gaa'},
  {match:['rugby','rugbytots','rfc'], svg:'rugby'},
  {match:['tennis'], svg:'tennis'},
  {match:['basketball'], svg:'basketball'},
  {match:['hockey'], svg:'hockey'},
  {match:['swim','aquatic','splash'], svg:'swim'},
  {match:['karate','taekwondo','martial','judo','capoeira','kickboxing','jiu'], svg:'martial'},
  {match:['gymnastic','trampolin','tumbl'], svg:'gym'},
  {match:['athletics','athletic club',' ac ','running'], svg:'run'},
  {match:['soccer','football',' fc','kickers','afc'], svg:'soccer'},
  {match:['golf'], svg:'golf'},
  {match:['cycling','bike','bmx'], svg:'bike'},
  {match:['horse','pony','equestrian','riding'], svg:'horse'},
  {match:['sailing','sail '], svg:'sail'},
  {match:['kayak','canoe'], svg:'kayak'},
  // Multi-sport / anything else filed under Sport
  {match:['playball','multisport','multi-sport','sport'], svg:'multi'}
];
function sportIconHtml(c){
  const h = (' '+[c.name,c.provider,c.category].join(' ')+' ').toLowerCase();
  for(const s of SPORT_ICONS){
    if(s.match.some(m => h.includes(m))){
      return '<svg class="sport-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+SPORT_SVG[s.svg]+'</svg>';
    }
  }
  return '';
}

function ageOverlap(ageMin, ageMax, lo, hi){
  const effMin = ageMin==null ? 0 : ageMin;
  const effMax = ageMax==null ? 99 : ageMax;
  return !(hi < effMin || lo > effMax);
}

// Approximate day match against the freeform `days` string (e.g. "Mon–Fri",
// "Tuesdays", "Monday–Friday"). Good enough for a quick filter, not exact
// parsing — flagged as a known limitation.
function dayTextMatches(daysStr, day){
  const d = (daysStr||'').toLowerCase();
  const short = day.slice(0,3).toLowerCase();
  if(d.includes(short)) return true;
  if(/mon.*fri/.test(d) && ['monday','tuesday','wednesday','thursday','friday'].includes(day)) return true;
  return false;
}

// `selectedDays` is a Set of day names (checkboxes) — a listing matches if
// it runs on ANY of the selected days (OR logic), or if no days are selected.
function matchesDays(daysStr, selectedDays){
  if(!selectedDays || !selectedDays.size) return true;
  for(const day of selectedDays){
    if(dayTextMatches(daysStr, day)) return true;
  }
  return false;
}

// "Eircode or area" free-text field. Matches a real Eircode (routing key
// like "K36"/"D13", or a full code like "K36 TD90") against each listing's
// `postcode`, and falls back to a substring match against area/county/name
// for a plain place name like "Malahide". There's still no lat/long-based
// radius search — this is a prefix/substring match, not "nearest first" —
// flagged to Rachel as a possible follow-up if she wants true proximity
// results (would need a geocoding step per listing).
function matchesEircodeOrArea(listing, query){
  if(!query) return true;
  const qRaw = query.trim();
  // Pad an unpadded Dublin routing key ("D5" -> "D05") so it matches the
  // stored format, same as the padding applied to postcodes on import.
  let qCode = qRaw.replace(/\s+/g, '').toUpperCase();
  qCode = qCode.replace(/^D(\d)(?!\d)/, 'D0$1');
  // "Dublin 15" / "Dublin 6W" typed as words -> the D15 / D6W routing key,
  // since Area now holds the plain place name (Blanchardstown) and the
  // district lives in the postcode.
  const dm = qRaw.match(/^(?:co\.?\s*)?dublin\s*(\d{1,2})\s*(w?)$/i);
  if (dm) qCode = dm[2] ? 'D' + dm[1] + 'W' : 'D' + dm[1].padStart(2, '0');
  if(listing.postcode){
    const pcCode = listing.postcode.replace(/\s+/g, '').toUpperCase();
    if(pcCode.startsWith(qCode) || qCode.startsWith(pcCode)) return true;
  }
  const q = qRaw.toLowerCase();
  const h = [listing.area, listing.county, listing.name].join(' ').toLowerCase();
  return h.includes(q);
}

function filterListings(listings, opts){
  const { type, text, eircode, ageBucket, days, sort, activities } = opts;
  let res = listings.filter(c=>{
    if(type && c.type !== type) return false;
    if(text){
      const h = [c.name,c.provider,c.area,c.county,c.category].join(' ').toLowerCase();
      if(!h.includes(text.toLowerCase().trim())) return false;
    }
    if(!matchesActivities(c.category, activities)) return false;
    if(!matchesEircodeOrArea(c, eircode)) return false;
    if(ageBucket){
      const [lo,hi] = ageBucket;
      if(!ageOverlap(c.ageMin,c.ageMax,lo,hi)) return false;
    }
    if(!matchesDays(c.days, days)) return false;
    return true;
  });
  if(sort==='name') res.sort((a,b)=>a.name.localeCompare(b.name));
  else if(sort==='price_lo') res.sort((a,b)=>(a.costValue||0)-(b.costValue||0));
  else if(sort==='price_hi') res.sort((a,b)=>(b.costValue||999)-(a.costValue||999));
  else if(sort==='age_lo') res.sort((a,b)=>(a.ageMin||99)-(b.ageMin||99));
  return res;
}

// Availability badge, driven by the Airtable "Availability" field
// (Open / Limited spaces / Waitlist; blank = Open). Once the generator
// writes an `availability` key onto every listing, that is the only source.
// Until then (key absent) fall back to the old Notes check, but only for
// the unambiguous phrases, so a note like "waiting lists recently reopened"
// no longer flags a listing as waitlist.
function availabilityOf(c){
  if ('availability' in c) return c.availability || 'Open';
  const n = (c.notes||'').toLowerCase();
  return (n.includes('fully booked') || n.includes('waiting list only')) ? 'Waitlist' : 'Open';
}

function listingCard(c, i, showType){
  const isHalloween = /halloween/i.test(c.name||'');
  const col = isHalloween ? HW_ORANGE : COLS[i % COLS.length];
  const ageStr = c.ageMin!=null && c.ageMax!=null ? 'Ages '+c.ageMin+'–'+c.ageMax : c.ageMin!=null ? 'Ages '+c.ageMin+'+' : '';
  const weeksStr = (c.weeks||[]).slice(0,2).join(', ');
  const avail = availabilityOf(c);
  const isWait = avail === 'Waitlist';
  const isLimited = avail === 'Limited spaces';
  const sportIcon = sportIconHtml(c);
  return '<div class="camp-card">'
  +'<div class="card-img" style="background:'+col.bg+'">'
  +(isHalloween?HW_PUMPKIN_ICON:'')
  +(!isHalloween&&sportIcon?'<div class="card-sport" style="color:'+col.ink+'">'+sportIcon+'</div>':'')
  +'<div class="card-status '+(isWait?'s-wait':isLimited?'s-limited':'s-open')+'">'+(isWait?'WAITLIST':isLimited?'LIMITED SPACES':'LIVE NOW')+'</div>'
  +'<button class="card-save" data-save-id="'+c.id+'" aria-label="Save for later" aria-pressed="false" onclick="event.preventDefault();window.SortdSaved&&window.SortdSaved.toggle(\''+c.id+'\',this);"><i class="ti ti-heart"></i></button>'
  +'</div>'
  +'<div class="card-body">'
  +(c.category?'<div class="card-cat" style="color:'+col.ink+'">'+c.category+'</div>':'')
  +'<div class="card-name">'+c.name+'</div>'
  +(c.provider&&c.provider!==c.name?'<div class="card-prov">'+c.provider+'</div>':'')
  // Order follows how a parent actually decides: age/location first (is
  // this even in the running), then day/time (does it fit our week),
  // then price — same priority the optimisation brief asked for.
  +'<div class="card-meta">'
  // Only shown on the combined /find-an-activity results, where camps and
  // classes sit in the same grid and need a quick way to tell apart —
  // /camps and /weekly-classes are each already one type, so this would
  // just be noise there.
  +(showType?'<span class="cm cm-type">'+(c.type==='weekly'?'Class':'Camp')+'</span>':'')
  +(ageStr?'<span class="cm">'+ageStr+'</span>':'')
  +(c.area?'<span class="cm">📍 '+c.area+'</span>':'')
  +(c.days?'<span class="cm">'+c.days.split('\n')[0].substring(0,18)+'</span>':'')
  +(c.times?'<span class="cm">'+c.times.split('\n')[0].substring(0,20)+'</span>':'')
  +(weeksStr?'<span class="cm">'+weeksStr+'</span>':'')
  +'</div>'
  +(c.cost?'<div class="card-cost">'+c.cost.split('\n')[0].substring(0,30)+'</div>':'')
  +'<a href="'+c.listingUrl+'" class="card-link">Find out more ↗</a>'
  +'</div></div>';
}

function featuredCard(c){
  const isHalloween = /halloween/i.test(c.name||'');
  const s = isHalloween ? {cc:HW_ORANGE.ink} : categoryStyle(c.category);
  const typeLabel = c.type === 'weekly' ? 'Class' : 'Holiday camp';
  const iconHtml = isHalloween ? HW_BAT_ICON : (sportIconHtml(c) || '<i class="ti '+s.icon+'"></i>');
  return '<a href="'+c.listingUrl+'" class="fcard" style="--cc:'+s.cc+'">'
  +'<div class="fcard-top"><div class="fcard-icon">'+iconHtml+'</div><div class="fcard-type">'+typeLabel+'</div></div>'
  +'<div class="fcard-name">'+c.name+'</div>'
  +'<div class="fcard-provider">'+c.provider+'</div>'
  +(c.days?'<div class="fcard-meta"><i class="ti ti-calendar"></i>'+c.days+(c.times?' · '+c.times:'')+'</div>':'')
  +(c.area?'<div class="fcard-meta"><i class="ti ti-map-pin"></i>'+c.area+', '+c.county+'</div>':'')
  +(c.cost?'<div class="fcard-cost">'+c.cost.split('\n')[0]+'</div>':'')
  +'</a>';
}

// ── Reusable day-checkbox widget ────────────────────────────────────────
function dayCheckboxesHtml(idPrefix){
  return ALL_DAYS.map(d=>(
    '<label class="daychip"><input type="checkbox" value="'+d+'" id="'+idPrefix+'-'+d+'"><span>'+d.slice(0,3)+'</span></label>'
  )).join('');
}
function readSelectedDays(idPrefix){
  const set = new Set();
  ALL_DAYS.forEach(d=>{
    const el = document.getElementById(idPrefix+'-'+d);
    if(el && el.checked) set.add(d);
  });
  return set;
}
function setSelectedDays(idPrefix, dayNames){
  ALL_DAYS.forEach(d=>{
    const el = document.getElementById(idPrefix+'-'+d);
    if(el) el.checked = dayNames.includes(d);
  });
}

function ageBucketFromKey(key){
  if(!key) return null;
  const [lo,hi] = key.split('-').map(Number);
  return [lo,hi];
}

// ── Query-string helpers for cross-page handoff (hero search → /camps etc.) ─
function buildSearchQuery({eircode, ageKey, days, text, activities}){
  const p = new URLSearchParams();
  if(eircode) p.set('q', eircode);
  if(ageKey) p.set('age', ageKey);
  if(days && days.size) p.set('days', Array.from(days).join(','));
  if(text) p.set('text', text);
  if(activities && activities.size) p.set('cats', Array.from(activities).join(','));
  return p.toString();
}
function readSearchQuery(){
  const p = new URLSearchParams(window.location.search);
  return {
    eircode: p.get('q') || '',
    ageKey: p.get('age') || '',
    days: new Set((p.get('days')||'').split(',').filter(Boolean)),
    text: p.get('text') || '',
    activities: new Set((p.get('cats')||'').split(',').filter(Boolean)),
  };
}
