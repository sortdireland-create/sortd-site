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

function listingCard(c, i, showType){
  const isHalloween = /halloween/i.test(c.name||'');
  const col = isHalloween ? HW_ORANGE : COLS[i % COLS.length];
  const ageStr = c.ageMin!=null && c.ageMax!=null ? 'Ages '+c.ageMin+'–'+c.ageMax : c.ageMin!=null ? 'Ages '+c.ageMin+'+' : '';
  const weeksStr = (c.weeks||[]).slice(0,2).join(', ');
  const isWait = (c.notes||'').toLowerCase().includes('waiting list') || (c.notes||'').toLowerCase().includes('fully booked');
  return '<div class="camp-card">'
  +'<div class="card-img" style="background:'+col.bg+'">'
  +(isHalloween?HW_PUMPKIN_ICON:'')
  +'<div class="card-status '+(isWait?'s-wait':'s-open')+'">'+(isWait?'WAITLIST':'LIVE NOW')+'</div>'
  +'</div>'
  +'<div class="card-body">'
  +(c.category?'<div class="card-cat" style="color:'+col.ink+'">'+c.category+'</div>':'')
  +'<div class="card-name">'+c.name+'</div>'
  +(c.provider&&c.provider!==c.name?'<div class="card-prov">'+c.provider+'</div>':'')
  +'<div class="card-meta">'
  // Only shown on the combined /find-an-activity results, where camps and
  // classes sit in the same grid and need a quick way to tell apart —
  // /camps and /weekly-classes are each already one type, so this would
  // just be noise there.
  +(showType?'<span class="cm cm-type">'+(c.type==='weekly'?'Class':'Camp')+'</span>':'')
  +(ageStr?'<span class="cm">'+ageStr+'</span>':'')
  +(c.area?'<span class="cm">📍 '+c.area+'</span>':'')
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
  const iconHtml = isHalloween ? HW_BAT_ICON : '<i class="ti '+s.icon+'"></i>';
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
