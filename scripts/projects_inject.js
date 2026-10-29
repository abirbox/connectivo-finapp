/* ===== Projects portal additions (injected by scripts/build-projects.py) ===== */
(function(){var of=window.fetch;window.fetch=function(u,o){try{if(typeof u==='string'){if(u==='/api/data'||u==='/api/upload')u='/projects-api/'+u.slice(5);else if(u.indexOf('/api/file')===0)u='/projects-api/file'+u.slice(9);}}catch(e){}return of.call(this,u,o);};})();
const PRJ_ST = ['Planned','Ongoing','On hold','Completed','Cancelled'];
const PRJ_COL = {Planned:'#64748b', Ongoing:'#1b6fb5', 'On hold':'#d98a06', Completed:'#0f9d6a', Cancelled:'#dc3545'};
function prjStats(id){
  let inc=0, exp=0, n=0;
  S.transactions.forEach(t=>{
    if(t.status==='voided' || t.businessUnitId!==id) return;
    if(t.type==='income') inc += Number(t.amount)||0; else if(t.type==='expense') exp += Number(t.amount)||0; else return;
    n++;
  });
  return {inc, exp, net:inc-exp, n};
}
function prjLabel(){
  const id = S.reportFilters && S.reportFilters.bu;
  if(!id) return 'All Projects';
  const b = S.businessUnits.find(x=>x.id===id);
  return b ? 'Project: '+b.name : 'All Projects';
}
function usdNote(t){ return (t && t.origCur==='USD') ? `$${Number(t.usd).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} @ ${t.rate}` : ''; }
function prjPill(st){ const c = PRJ_COL[st]||'#64748b'; return `<span style="display:inline-block; padding:2px 9px; border-radius:20px; font-size:11px; font-weight:700; color:${c}; background:${c}1a; border:1px solid ${c}40;">${esc(st||'Ongoing')}</span>`; }
function prjBar(pct, color){ pct = Math.max(0, Math.min(100, pct||0)); return `<div style="height:7px; border-radius:6px; background:var(--border); overflow:hidden; margin-top:5px;"><div style="height:100%; width:${pct}%; background:${color}; border-radius:6px;"></div></div>`; }
function renderProjectsPage(){
  setTitle('Projects', 'Financial status of every project, calculated separately from the FinOps central books');
  const q = (S.prjQ||'').toLowerCase(), st = S.prjSt||'';
  let list = S.businessUnits.filter(b=>b.active!==false).filter(b=> (!st || (b.status||'Ongoing')===st) && (!q || (b.name+' '+(b.client||'')+' '+(b.code||'')).toLowerCase().includes(q)));
  list = list.slice().sort((a,b)=> (a.name||'').localeCompare(b.name||''));
  const all = S.businessUnits.filter(b=>b.active!==false);
  let tInc=0, tExp=0, unInc=0, unExp=0, unN=0;
  all.forEach(b=>{ const s=prjStats(b.id); tInc+=s.inc; tExp+=s.exp; });
  S.transactions.forEach(t=>{ if(t.status==='voided'||t.businessUnitId||t.type==='transfer') return; unN++; if(t.type==='income') unInc+=Number(t.amount)||0; else unExp+=Number(t.amount)||0; });
  const ongoing = all.filter(b=>(b.status||'Ongoing')==='Ongoing').length;
  $('#content').innerHTML = `
    <div class="grid grid-4" style="margin-bottom:14px;">
      <div class="card metric"><div class="mtop"><div class="label">Projects</div><span class="chip neutral">${ICONS('tag')}</span></div><div class="val num">${all.length}</div><div class="delta">${ongoing} ongoing</div></div>
      <div class="card metric"><div class="mtop"><div class="label">Total Income (BDT)</div><span class="chip success">${ICONS('arrowDown')}</span></div><div class="val num" style="color:var(--success)">${money(tInc)}</div></div>
      <div class="card metric"><div class="mtop"><div class="label">Total Expenditure (BDT)</div><span class="chip danger">${ICONS('arrowUp')}</span></div><div class="val num" style="color:var(--danger)">${money(tExp)}</div></div>
      <div class="card metric"><div class="mtop"><div class="label">Net Result (BDT)</div><span class="chip neutral">${ICONS('chart')}</span></div><div class="val num" style="color:${tInc-tExp<0?'var(--danger)':'var(--success)'}">${money(tInc-tExp)}</div></div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:10px;">
      <div class="filters">
        <input id="fprjq" placeholder="Search projects…" value="${esc(S.prjQ||'')}" style="width:190px;">
        <select id="fprjst"><option value="">All statuses</option>${PRJ_ST.map(s=>`<option ${st===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost btn-sm" id="prjPdf">${ICONS('download')} Projects PDF</button>
        <button class="btn btn-primary btn-sm" id="addPrj">${ICONS('plus')} Add Project</button>
      </div>
    </div>
    ${list.length? `<div class="grid grid-3">${list.map(b=>{
      const s = prjStats(b.id), con = Number(b.contract)||0, bud = Number(b.budget)||0;
      const coll = con? Math.round(s.inc/con*100):0, used = bud? Math.round(s.exp/bud*100):0;
      return `<div class="card card-pad">
        <div class="acc-top">
          <div class="acc-id"><span class="acc-ico cash">${ICONS('tag')}</span>
            <div><div style="font-weight:700; font-size:14.5px;">${esc(b.name)}</div>
            <div style="font-size:12px; color:var(--ink-soft);">${esc(b.client||'No client set')}${b.code?' · '+esc(b.code):''}</div></div></div>
          <button class="icon-btn" data-edit-prj="${b.id}" aria-label="Edit project">✎</button>
        </div>
        <div style="margin:6px 0 10px;">${prjPill(b.status)}${b.start?` <span style="font-size:11.5px; color:var(--ink-soft); margin-left:6px;">${esc(fmtDate(b.start))}${b.end?' – '+esc(fmtDate(b.end)):''}</span>`:''}</div>
        <div class="acc-bal" style="color:${s.net<0?'var(--danger)':'var(--success)'}">${money(s.net)}</div>
        <div class="acc-cap">Net result (BDT)</div>
        <div class="divider"></div>
        <div class="kv" style="font-size:12px;">
          <dt>Income (BDT)</dt><dd>${money(s.inc)}</dd>
          <dt>Expenditure (BDT)</dt><dd>${money(s.exp)}</dd>
          <dt>Transactions</dt><dd>${s.n}</dd>
          ${con?`<dt>Contract value (BDT)</dt><dd>${money(con)}</dd><dt>Still to receive (BDT)</dt><dd>${money(Math.max(0,con-s.inc))}</dd>`:''}
          ${bud?`<dt>Cost budget (BDT)</dt><dd>${money(bud)}</dd><dt>Budget left (BDT)</dt><dd style="color:${bud-s.exp<0?'var(--danger)':'inherit'}">${money(bud-s.exp)}</dd>`:''}
        </div>
        ${con?`<div style="font-size:11.5px; color:var(--ink-soft); margin-top:10px;">Contract collected · ${coll}%</div>${prjBar(coll,'var(--success)')}`:''}
        ${bud?`<div style="font-size:11.5px; color:var(--ink-soft); margin-top:8px;">Budget used · ${used}%</div>${prjBar(used, used>100?'var(--danger)':'#d98a06')}`:''}
        <div style="display:flex; gap:8px; margin-top:14px; flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-prj-tx="${b.id}">${ICONS('list')} Transactions</button>
          <button class="btn btn-ghost btn-sm" data-prj-pdf="${b.id}">${ICONS('download')} Statement PDF</button>
        </div>
      </div>`; }).join('')}</div>` : `<div class="empty"><h3>${all.length?'No projects match':'No projects yet'}</h3><p>${all.length?'Adjust your filters.':'Add your first project, then record its income and expenditure.'}</p></div>`}
    ${unN? `<div class="card card-pad" style="margin-top:14px; font-size:12.5px; color:var(--ink-soft);">${unN} income/expenditure entr${unN===1?'y is':'ies are'} not assigned to any project (income ${money(unInc)}, expenditure ${money(unExp)} BDT). Edit those transactions to give them a project.</div>`:''}
  `;
  $('#addPrj').onclick = ()=> openProjectModal(null);
  $('#prjPdf').onclick = downloadProjectsPdf;
  $$('[data-edit-prj]').forEach(b=> b.onclick = ()=> openProjectModal(S.businessUnits.find(x=>x.id===b.dataset.editPrj)));
  $$('[data-prj-tx]').forEach(b=> b.onclick = ()=>{ S.filters.bu = b.dataset.prjTx; S.filters.page = 1; location.hash = '#/transactions'; });
  $$('[data-prj-pdf]').forEach(b=> b.onclick = ()=> downloadProjectStatementPdf(b.dataset.prjPdf));
  $('#fprjq').oninput = debounce(e=>{ S.prjQ=e.target.value; renderProjectsPage(); refocusInput('fprjq'); },250);
  $('#fprjst').onchange = e=>{ S.prjSt=e.target.value; renderProjectsPage(); };
}
function openProjectModal(p){
  if(!canWrite()){ toast('Your account is view-only.','error'); return; }
  const v = (k,d)=> p && p[k]!=null ? esc(p[k]) : (d||'');
  showModal(`
    <div class="modal-head"><h3>${p?'Edit Project':'Add Project'}</h3><button class="modal-close" data-close>${ICONS('x')}</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="field"><label>Project Name *</label><input id="p_name" value="${v('name')}" placeholder="e.g. Website for Acme"></div>
        <div class="field"><label>Client</label><input id="p_client" value="${v('client')}" placeholder="e.g. Acme Ltd"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Project Code</label><input id="p_code" value="${v('code')}" placeholder="Optional"></div>
        <div class="field"><label>Status</label><select id="p_status">${PRJ_ST.map(s=>`<option ${((p&&p.status)||'Ongoing')===s?'selected':''}>${s}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Contract Value (BDT)</label><input type="number" step="0.01" min="0" id="p_contract" value="${v('contract')}" placeholder="Optional"></div>
        <div class="field"><label>Cost Budget (BDT)</label><input type="number" step="0.01" min="0" id="p_budget" value="${v('budget')}" placeholder="Optional"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Start Date</label><input type="date" id="p_start" value="${v('start')}"></div>
        <div class="field"><label>End Date</label><input type="date" id="p_end" value="${v('end')}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="p_notes" rows="2" placeholder="Optional">${v('notes')}</textarea></div>
      <div id="pErr" class="err" style="display:none;"></div>
    </div>
    <div class="modal-foot">
      ${p? `<button class="btn btn-ghost" id="delPrj" style="color:var(--danger); margin-right:auto;">Delete</button>`:''}
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="savePrj">Save</button>
    </div>
  `);
  $('#savePrj').onclick = async ()=>{
    const name = $('#p_name').value.trim();
    if(!name){ $('#pErr').textContent='Please enter the project name.'; $('#pErr').style.display='block'; return; }
    if(S.businessUnits.some(b=>b.id!==(p&&p.id) && (b.name||'').toLowerCase()===name.toLowerCase())){ $('#pErr').textContent='A project with this name already exists.'; $('#pErr').style.display='block'; return; }
    const data = {name, active:true, client:$('#p_client').value.trim(), code:$('#p_code').value.trim(), status:$('#p_status').value,
      contract: parseFloat($('#p_contract').value)||0, budget: parseFloat($('#p_budget').value)||0,
      start:$('#p_start').value, end:$('#p_end').value, notes:$('#p_notes').value.trim()};
    try{
      const id = p? p.id : uuid();
      await dbSet('businessUnits', id, data);
      await logAudit(p?'PROJECT_UPDATED':'PROJECT_CREATED','project', id, name);
      closeModal(); toast('Project saved.','success'); await refetchAll(); renderRoute();
    }catch(e){ toast('Unable to save project.','error'); }
  };
  const d = $('#delPrj');
  if(d) d.onclick = async ()=>{
    const used = S.transactions.filter(t=>t.businessUnitId===p.id).length;
    if(used){ $('#pErr').textContent=`This project has ${used} transaction${used===1?'':'s'}, so it cannot be deleted. Set its status to Completed or Cancelled instead.`; $('#pErr').style.display='block'; return; }
    try{ await dbDelete('businessUnits', p.id); await logAudit('PROJECT_DELETED','project',p.id,p.name); closeModal(); toast('Project deleted.','success'); await refetchAll(); renderRoute(); }
    catch(e){ toast('Unable to delete project.','error'); }
  };
}
async function downloadProjectsPdf(){
  const doc = PDF.new('portrait');
  let y = PDF.header(doc, 'Projects Overview', 'As of '+fmtDate(todayISO()));
  const all = S.businessUnits.filter(b=>b.active!==false).slice().sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  let ti=0, te=0;
  const rows = all.map(b=>{ const s=prjStats(b.id); ti+=s.inc; te+=s.exp; return [b.name, b.status||'Ongoing', money(s.inc), money(s.exp), money(s.net)]; });
  rows.push(['Total','',money(ti),money(te),money(ti-te)]);
  y = PDF.table(doc, {title:'Project financial status (BDT)', startY:y,
    columns:[{label:'Project',width:62},{label:'Status',width:24},{label:'Income',width:32,align:'right'},{label:'Expenditure',width:32,align:'right'},{label:'Net',width:32,align:'right'}], rows});
  const con = all.filter(b=>Number(b.contract)||Number(b.budget));
  if(con.length){
    const r2 = con.map(b=>{ const s=prjStats(b.id), c=Number(b.contract)||0, bu=Number(b.budget)||0; return [b.name, c?money(c):'—', c?money(Math.max(0,c-s.inc)):'—', bu?money(bu):'—', bu?money(bu-s.exp):'—']; });
    PDF.table(doc, {title:'Contract and budget position (BDT)', startY:y+6,
      columns:[{label:'Project',width:62},{label:'Contract',width:32,align:'right'},{label:'To receive',width:32,align:'right'},{label:'Budget',width:28,align:'right'},{label:'Budget left',width:28,align:'right'}], rows:r2});
  }
  finalizePdf(doc);
  await PDF.download(doc, `connectivo-projects-overview-${todayISO()}.pdf`);
}
async function downloadProjectStatementPdf(id){
  const keep = {...S.reportFilters}, keepP = S.reportPeriod;
  S.reportFilters = {category:'', bu:id, account:'', q:''}; S.reportPeriod = 'all';
  try{ await downloadSummaryPdf(); }finally{ S.reportFilters = keep; S.reportPeriod = keepP; }
}

/* ---- one-time import of data entered in the first-version Projects portal ---- */
async function prjMigrateLegacy(){
  try{
    const flag = await dbGetDoc('counters','legacyImport');
    if(flag && flag.done) return;
    const r = await fetch('/projects-api/legacy', {credentials:'include'});
    if(!r.ok) return;
    const j = await r.json();
    const old = j && j.db;
    const has = old && ((old.projects||[]).length || (old.tx||[]).length || (old.docs||[]).length);
    if(!has){ await dbSet('counters','legacyImport', {done:true, at:new Date().toISOString(), imported:0}); return; }
    const exists = (list, id)=> list.some(x=>x.id===id);
    const nowIso = new Date().toISOString();
    // projects
    for(const p of (old.projects||[])){
      const id = 'm'+p.id; if(exists(S.businessUnits,id)) continue;
      await dbSet('businessUnits', id, {name:p.name, active:true, client:p.client||'', code:p.code||'', status:p.status||'Ongoing', contract:Number(p.contract)||0, budget:Number(p.budget)||0, start:p.start||'', end:p.end||'', notes:[p.manager?('Manager: '+p.manager):'', p.desc||''].filter(Boolean).join('. ')});
    }
    // accounts (match by name, otherwise create)
    const accMap = {};
    for(const a of (old.accts||[])){
      let f = S.accounts.find(x=>(x.name||'').toLowerCase()===(a.name||'').toLowerCase());
      if(!f){ const id='m'+a.id; await dbSet('accounts', id, {name:a.name, type:(a.type==='Cash'?'cash':'bank'), openingBalance:0, currency:'BDT', active:true}); f={id}; }
      accMap[a.id] = f.id;
    }
    // categories (match by kind+name, otherwise create)
    const catId = async (kind,name)=>{
      let f = S.categories.find(c=>c.kind===kind && (c.name||'').toLowerCase()===(name||'').toLowerCase());
      if(f) return f.id;
      const old1 = (old.cats||[]).find(c=>c.kind===kind && c.name===name);
      const id = uuid(); await dbSet('categories', id, {name, group:(old1&&old1.group)||'Other', kind, active:true});
      S.categories.push({id, name, group:(old1&&old1.group)||'Other', kind, active:true});
      return id;
    };
    // transactions, oldest first so vouchers run in date order
    const txs = (old.tx||[]).slice().sort((a,b)=> (a.date||'')<(b.date||'')?-1:1);
    const voucherOf = {};
    for(const t of txs){
      const id = 'm'+t.id; if(exists(S.transactions,id)){ voucherOf[t.id]=(S.transactions.find(x=>x.id===id)||{}).voucher; continue; }
      const type = t.type; const voucher = await nextVoucher(type);
      voucherOf[t.id] = voucher;
      const payload = {voucher, type, date:t.date, amount:Number(t.amt)||0, currency:'BDT', accountId:accMap[t.acct]||null,
        toAccountId: type==='transfer' ? (accMap[t.to]||null) : null,
        categoryId: type==='transfer' ? null : await catId(type, t.cat),
        businessUnitId: type==='transfer' ? null : ('m'+t.pid),
        party: type==='transfer' ? null : (t.party||null), reference:t.ref||'', description:t.note||'',
        status:'recorded', createdBy:S.uid, createdByName:t.by||'Imported', createdAt:t.created||nowIso, imported:true};
      if(t.cur==='USD'){ payload.origCur='USD'; payload.usd=Number(t.usd)||0; payload.rate=Number(t.rate)||0; }
      const docIds = [];
      for(const f of (t.files||[])){
        try{
          const cr = await fetch('/projects-api/legacy-file', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:f.id})});
          const cj = await cr.json(); if(!cr.ok||!cj.ok) continue;
          await dbSet('documents', f.id, {name:f.name||cj.name, contentType:cj.contentType, sizeBytes:cj.size, transactionId:id, voucher, uploadedBy:S.uid, uploadedByName:t.by||'Imported', uploadedAt:t.created||nowIso});
          docIds.push(f.id);
        }catch(e){ console.error('legacy file', e); }
      }
      if(docIds.length) payload.documentIds = docIds;
      await dbSet('transactions', id, payload);
    }
    // project documents (contracts, work orders ...)
    for(const d of (old.docs||[])){
      const f = d.file; if(!f) continue;
      try{
        const cr = await fetch('/projects-api/legacy-file', {method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:f.id})});
        const cj = await cr.json(); if(!cr.ok||!cj.ok) continue;
        await dbSet('documents', f.id, {name:f.name||cj.name, title:d.title||'', docType:d.type||'', businessUnitId:d.pid?('m'+d.pid):null, contentType:cj.contentType, sizeBytes:cj.size, transactionId:null, voucher:null, uploadedBy:S.uid, uploadedByName:d.by||'Imported', uploadedAt:d.at||nowIso});
      }catch(e){ console.error('legacy doc', e); }
    }
    await dbSet('counters','legacyImport', {done:true, at:nowIso, imported:(old.tx||[]).length});
    await logAudit('LEGACY_IMPORT','system','', `Imported ${(old.projects||[]).length} projects, ${(old.tx||[]).length} transactions and ${(old.docs||[]).length} documents from the first Projects portal.`);
    await refetchAll();
    toast('Your earlier project data has been imported.','success');
  }catch(e){ console.error('legacy import failed', e); }
}

/* ---- Documents: project documents + upload ---- */
const PRJ_DOCT = ['Contract','Work Order','Proposal / Quotation','Invoice','Receipt','Agreement','Report','Other'];
function docProjLabel(d){
  let id = d.businessUnitId;
  if(!id && d.transactionId){ const t = S.transactions.find(x=>x.id===d.transactionId); id = t && t.businessUnitId; }
  const b = id && S.businessUnits.find(x=>x.id===id);
  return b ? ' · '+esc(b.name) : '';
}
function openDocUploadModal(){
  if(!canWrite()){ toast('Your account is view-only.','error'); return; }
  if(!S.businessUnits.length){ toast('Add a project first.','error'); return; }
  showModal(`
    <div class="modal-head"><h3>Upload Project Document</h3><button class="modal-close" data-close>${ICONS('x')}</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="field"><label>Project *</label><select id="du_p">${S.businessUnits.map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Document Type</label><select id="du_t">${PRJ_DOCT.map(x=>`<option>${x}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Title</label><input id="du_n" placeholder="e.g. Signed contract"></div>
      <div class="field"><label>File *</label><input type="file" id="du_f" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.xlsx,.csv,.docx"><div class="hint">PDF, image or spreadsheet, up to 4 MB.</div></div>
      <div id="duErr" class="err" style="display:none;"></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="duSave">Upload</button></div>
  `);
  $('#duSave').onclick = async ()=>{
    const f = $('#du_f').files[0], err = $('#duErr');
    if(!f){ err.textContent='Please choose a file.'; err.style.display='block'; return; }
    $('#duSave').disabled = true; $('#duSave').textContent = 'Uploading…';
    try{
      const id = await uploadAttachment(f, null, null);
      await dbUpdate('documents', id, {businessUnitId:$('#du_p').value, docType:$('#du_t').value, title:$('#du_n').value.trim()});
      await logAudit('DOCUMENT_UPLOADED','document', id, f.name);
      closeModal(); toast('Document uploaded.','success'); renderRoute();
    }catch(e){ err.textContent = e.message || 'Upload failed.'; err.style.display='block'; $('#duSave').disabled=false; $('#duSave').textContent='Upload'; }
  };
}

function renderBackupPage(){
  setTitle('Download / Upload Data', 'Move all project data to a new website or company domain');
  $('#content').innerHTML = `
    <div class="card card-pad" style="max-width:620px;">
      <div class="card-title" style="margin-bottom:6px;">Download data / Upload data</div>
      <p style="font-size:12.8px; color:var(--ink-soft); margin:0 0 14px; line-height:1.55;">Download every project record (projects, transactions, accounts, categories, receipts, documents and the activity log) as one file. On the new website, open this page and upload that file: everything appears immediately. Only CEO / developer accounts can do this.</p>
      <button class="btn btn-primary" id="bkOpen">${ICONS('download')} Download / Upload data</button>
    </div>`;
  $('#bkOpen').onclick = ()=> CPBackup.open('projects');
}
