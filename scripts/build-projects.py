#!/usr/bin/env python3
"""Builds public/projects/index.html from public/index.html (the FinOps app).
The Projects portal is FinOps with: its own data store, "Business Unit" = "Project",
a USD->BDT converter on transactions, and only the pages that make sense per project."""
import re, sys, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(root, 'public/index.html'), encoding='utf8').read()
inj = open(os.path.join(root, 'scripts/projects_inject.js'), encoding='utf8').read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n == 0 or (count and n != count):
        sys.exit('PATCH FAILED (found %d, wanted %s): %s' % (n, count, old[:90]))
    s = s.replace(old, new)

# --- identity
rep('<title>Connectivo FinOps</title>', '<title>Connectivo Projects</title>')
rep('content="FinOps">', 'content="Projects">')
rep('<small>FinOps — Financial Operations &amp; Control</small>', '<small>Projects — Project-wise Finance</small>')
rep('<dt>Product</dt><dd>Connectivo FinOps — Financial Operations &amp; Control</dd>', '<dt>Product</dt><dd>Connectivo Projects — Project-wise Finance</dd>')
rep("connectivo-finops-transactions-", "connectivo-projects-transactions-")
for k in ['profit-loss','journal','cash-flow','balance-sheet','historical-analysis','financial-summary','cashbook']:
    rep('`connectivo-%s-${todayISO()}.pdf`' % k, '`connectivo-projects-%s-${todayISO()}.pdf`' % k)
rep("doc.text('Confidential — Connectivo Internal Financial Record', m, H-8);", "doc.text('Confidential — Connectivo Internal Project Financial Record', m, H-8);")

# --- navigation: only what a project ledger needs
a = s.index('const ROUTES = [')
b = s.index('];', a) + 2
s = s[:a] + """const ROUTES = [
  {hash:'#/dashboard', label:'Overview', group:null, icon:'grid'},
  {hash:'#/projects', label:'Projects', group:null, icon:'tag'},
  {hash:'#/transactions', label:'All Transactions', group:'Transactions', icon:'list'},
  {hash:'#/income', label:'Income', group:'Transactions', icon:'arrowDown'},
  {hash:'#/expense', label:'Expenditure', group:'Transactions', icon:'arrowUp'},
  {hash:'#/transfers', label:'Transfers', group:'Transactions', icon:'swap'},
  {hash:'#/accounts', label:'Cash & Bank', group:'Accounts', icon:'wallet'},
  {hash:'#/categories', label:'Categories', group:'Accounts', icon:'tag'},
  {hash:'#/documents', label:'Documents', group:'Accounts', icon:'paperclip'},
  {hash:'#/reports/summary', label:'Financial Summary', group:'Reports', icon:'chart'},
  {hash:'#/reports/pl', label:'Profit & Loss', group:'Reports', icon:'chart'},
  {hash:'#/reports/journal', label:'Journal', group:'Reports', icon:'book'},
  {hash:'#/reports/cashflow', label:'Cash Flow Statement', group:'Reports', icon:'swap'},
  {hash:'#/reports/balancesheet', label:'Balance Sheet', group:'Reports', icon:'wallet'},
  {hash:'#/reports/cashbook', label:'Cash & Bank Book', group:'Reports', icon:'book'},
  {hash:'#/reports/income', label:'Income Analysis', group:'Reports', icon:'chart'},
  {hash:'#/reports/expense', label:'Expenditure Analysis', group:'Reports', icon:'chart'},
  {hash:'#/reports/historical', label:'Historical Analysis', group:'Reports', icon:'clock'},
  {hash:'#/audit', label:'Audit & Activity', group:null, icon:'shield'},
  {hash:'#/backup', label:'Download / Upload Data', group:'Administration', icon:'download'},
];""" + s[b:]

# --- routing: drop the other portals / admin pages, add the Projects page
s = re.sub(r"  \{ const pk=S\.route==='#/salary'.*?S\.lastPortal=pk; \}\n", "", s, count=1, flags=re.S)
s = s.replace("  if(S.route!=='#/salary') closeSalary();\n  if(S.route!=='#/invoice') closeInvoice();\n  if(S.route!=='#/projects') closeProjects();\n", "")
rep("  else if(S.route==='#/salary' && ['ceo','developer','admin'].includes(S.me.role)) renderSalary();\n  else if(S.route==='#/invoice' && ['ceo','developer','admin'].includes(S.me.role)) renderInvoice();\n  else if(S.route==='#/projects' && ['ceo','developer','admin'].includes(S.me.role)) renderProjects();\n  else if(S.route==='#/payroll' && hasCeoAccess()) renderPayroll();\n",
    "  else if(S.route==='#/projects') renderProjectsPage();\n  else if(S.route==='#/backup') renderBackupPage();\n")
rep("  else if(S.route==='#/users' && hasCeoAccess()) renderUsers();\n  else if(S.route==='#/settings' && hasCeoAccess()) renderSettings();\n  else if(S.route==='#/dev' && S.me.role==='developer') renderDevConsole();\n", "")

# --- shell: sign-out is handled by the FinOps window around this page
s = re.sub(r"\n        <button class=\"navlink\" id=\"signOutBtn\"[^\n]*</button>", "", s, count=1)

# --- Business Unit -> Project
for old, new in [('All business units','All projects'),('By Business Unit','By Project'),('Business Unit','Project'),('Business unit','Project'),
                 ('business units','projects'),('business unit','project')]:
    s = s.replace(old, new)
rep("  businessUnits: ['Security Operations','Digital Agency','Back-Office & Support','Corporate / Administration','Other'],", "  businessUnits: [],")
rep("Default categories, projects and accounts created.", "Default categories and accounts created.") if "Default categories, projects and accounts created." in s else None
rep("{name:'Bank — Corporate Account', type:'bank', openingBalance:0},", "{name:'Bank — Project Account', type:'bank', openingBalance:0},")
rep("<option value=\"\">—</option>${buOpts}</select></div>` : `<div class=\"field\"><label>Reference</label>", "<option value=\"\">Select project…</option>${buOpts}</select></div>` : `<div class=\"field\"><label>Reference</label>")
rep("<label>Project</label><select id=\"f_bu\">", "<label>Project *</label><select id=\"f_bu\">")
rep("      businessUnitId = $('#f_bu').value;\n", "      businessUnitId = $('#f_bu').value;\n      if(!businessUnitId) return setErr('Please choose the project this belongs to.');\n")

# --- USD -> BDT converter in the record dialog
rep("""<div class="field"><label>Amount (BDT) *</label><input type="number" step="0.01" min="0" id="f_amount" placeholder="0.00" value="${isEdit?existingTx.amount:''}"></div>""",
"""<div class="field"><label>Amount *</label><div style="display:flex; gap:6px;"><select id="f_cur" style="width:108px; flex:none;"><option value="BDT" ${isEdit&&existingTx.origCur==='USD'?'':'selected'}>Tk (BDT)</option><option value="USD" ${isEdit&&existingTx.origCur==='USD'?'selected':''}>$ (USD)</option></select><input type="number" step="0.01" min="0" id="f_amount" placeholder="0.00" value="${isEdit?(existingTx.origCur==='USD'?existingTx.usd:existingTx.amount):''}"></div>
          <div id="f_rwrap" style="display:none; margin-top:8px;"><label style="font-size:11.5px;">USD to BDT rate (1 USD = Tk) *</label><input type="number" step="0.0001" min="0" id="f_rate" value="${isEdit&&existingTx.origCur==='USD'?existingTx.rate:(prjRate()||'')}"><div id="f_conv" style="font-size:12px; font-weight:700; margin-top:5px;"></div></div></div>""")
rep("""  $('#submitTx').onclick = async ()=>{
    const date = $('#f_date').value;
    const amount = parseFloat($('#f_amount').value);""",
"""  const curChg = ()=>{ const u=$('#f_cur').value==='USD'; $('#f_rwrap').style.display=u?'':'none'; const a=parseFloat($('#f_amount').value)||0, r=parseFloat($('#f_rate').value)||0; $('#f_conv').innerHTML = u ? (a>0&&r>0 ? `$${a.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} × ${r} = <span style="color:var(--success)">Tk ${money(a*r)}</span>` : 'Enter the rate to see the value in Tk.') : ''; };
  $('#f_cur').onchange = curChg; $('#f_amount').oninput = curChg; $('#f_rate').oninput = curChg; curChg();
  $('#submitTx').onclick = async ()=>{
    const date = $('#f_date').value;
    const isUsd = $('#f_cur').value==='USD';
    const rawAmt = parseFloat($('#f_amount').value);
    const rate = isUsd ? parseFloat($('#f_rate').value) : 0;
    if(isUsd && !(rate>0)) return $('#formErr') && (($('#formErr').textContent='Please enter the USD to BDT rate.'), ($('#formErr').style.display='block'));
    const amount = isUsd ? Math.round(rawAmt*rate*100)/100 : rawAmt;
    const curFields = isUsd ? {origCur:'USD', usd:Math.round(rawAmt*100)/100, rate} : {origCur:null, usd:null, rate:null};
    if(isUsd) prjSaveRate(rate);""")
rep("""          reference: $('#f_ref')? $('#f_ref').value.trim() : '',
          description: $('#f_desc').value.trim(),
          editedBy""", """          reference: $('#f_ref')? $('#f_ref').value.trim() : '',
          description: $('#f_desc').value.trim(), ...curFields,
          editedBy""")
rep("""        reference: $('#f_ref')? $('#f_ref').value.trim() : '',
        description: $('#f_desc').value.trim(),
        status:'recorded'""", """        reference: $('#f_ref')? $('#f_ref').value.trim() : '',
        description: $('#f_desc').value.trim(), ...curFields,
        status:'recorded'""")

# --- show the original dollar amount next to Tk figures
rep("""<td class="right mono-amt v4-amt" style="color:${colr}">${sign}${money(t.amount)}</td>""", """<td class="right mono-amt v4-amt" style="color:${colr}">${sign}${money(t.amount)}${usdNote(t)?`<div style="font-size:10.5px; font-weight:600; color:var(--ink-soft);">${usdNote(t)}</div>`:''}</td>""")
rep("""<dt>Amount</dt><dd class="mono-amt" style="font-weight:700;">${money(t.amount)}</dd>""", """<dt>Amount</dt><dd class="mono-amt" style="font-weight:700;">${money(t.amount)}${usdNote(t)?` <span style="font-weight:600; color:var(--ink-soft); font-size:12px;">(${usdNote(t)})</span>`:''}</dd>""")
rep("const header = ['Date','Voucher','Type','Party','Category','Project','Account','Amount','Currency','Reference','Status','Description'];", "const header = ['Date','Voucher','Type','Party','Category','Project','Account','Amount','Currency','Original Currency','Original Amount','Rate','Reference','Status','Description'];")
rep("t.amount,t.currency||'BDT',t.reference||''", "t.amount,t.currency||'BDT',t.origCur||'BDT',t.origCur==='USD'?t.usd:t.amount,t.origCur==='USD'?t.rate:'',t.reference||''")

# --- report subtitle names the project
rep("function concretePeriodLabel(per){", "function concretePeriodLabel(per){ return _cpl(per) + '  ·  ' + prjLabel(); }\nfunction _cpl(per){")


# --- Financial Summary follows the project / category / account filters like the other reports
def patch_fn(start, end_marker, fn):
    global s
    a = s.index(start); b = s.index(end_marker, a)
    s = s[:a] + fn(s[a:b]) + s[b:]
def sum_fix(seg):
    seg = seg.replace('S.transactions', 'applyReportFilters(S.transactions)')
    return seg
patch_fn('function renderReportSummary(){', '\nfunction renderCashbook', sum_fix) if False else None
a = s.index('function renderReportSummary(){'); b = s.index('async function downloadSummaryPdf', a)
seg = s[a:s.index('\n}\n', a)+3]
seg2 = seg.replace('S.transactions', 'applyReportFilters(S.transactions)')
seg2 = seg2.replace("${reportPeriodControls()}\n      <button class=\"btn btn-ghost btn-sm\" id=\"pdfBtn\">", "<div class=\"filters\">${reportPeriodControls()}${reportFilterControlsHtml(null)}</div>\n      <button class=\"btn btn-ghost btn-sm\" id=\"pdfBtn\">")
seg2 = seg2.replace("bindReportPeriodControls(renderReportSummary);", "bindReportPeriodControls(renderReportSummary); bindReportFilterControls(renderReportSummary);")
assert seg2 != seg and 'reportFilterControlsHtml' in seg2 and 'bindReportFilterControls' in seg2
s = s.replace(seg, seg2, 1)
a = s.index('async function downloadSummaryPdf'); e = s.index('\n}\n', a)+3
seg = s[a:e]; seg2 = seg.replace('S.transactions', 'applyReportFilters(S.transactions)'); assert seg2!=seg
s = s[:a] + seg2 + s[e:]

s = s.replace('Company-wide financial position', 'Financial position across all projects').replace('Company-wide income, expenditure and fund position', 'Project income, expenditure and fund position')
rep('Revenue by Business Area', 'Revenue by Project')

# --- bug fixes: record type chooser, documents page, legacy import hook
rep("""    <div class="modal-body">
      <div class="form-section-label">Basic Information</div>""", """    <div class="modal-body">
      ${isEdit ? '' : `<div style="display:flex; gap:6px; margin-bottom:14px;">${[['income','Income'],['expense','Expenditure'],['transfer','Transfer']].map(([k,l])=>`<button type="button" class="btn btn-sm ${k===type?'btn-primary':'btn-ghost'}" data-rectype="${k}" style="flex:1;">${l}</button>`).join('')}</div>`}
      <div class="form-section-label">Basic Information</div>""")
rep("""  const curChg = ()=>{""", """  $$('[data-rectype]').forEach(b=> b.onclick = ()=>{ if(b.dataset.rectype!==type){ closeModal(); openRecordModal(b.dataset.rectype); } });
  const curChg = ()=>{""")
rep('<div class="doc-search"><input id="docSearch"', '''<button class="btn btn-primary btn-sm" id="docUp">${ICONS('plus')} Upload Document</button><div class="doc-search"><input id="docSearch"''')
rep("""<div class="empty"><h3>No documents yet</h3><p>Attach supporting documents when recording income or expenditure. They'll be filed here by month.</p></div></div>`;""", """<div class="empty"><h3>No documents yet</h3><p>Attach receipts when recording income or expenditure, or upload a project document (contract, work order…). They'll be filed here by month.</p><button class="btn btn-primary btn-sm" id="docUp">${ICONS('plus')} Upload Document</button></div></div>`;
      const u0 = $('#docUp'); if(u0) u0.onclick = openDocUploadModal;""")
rep("""<div class="dsub">${esc(docExt(d))} file</div>""", """<div class="dsub">${esc(docExt(d))} file${d.docType?' · '+esc(d.docType):''}${docProjLabel(d)}${d.title?' · '+esc(d.title):''}</div>""")
rep("""    $$('[data-folder]').forEach(b=> b.onclick = ()=>{ S.docMonth = b.dataset.folder; renderDocuments(); });""", """    const u1 = $('#docUp'); if(u1) u1.onclick = openDocUploadModal;
    $$('[data-folder]').forEach(b=> b.onclick = ()=>{ S.docMonth = b.dataset.folder; renderDocuments(); });""")
rep("""    await refetchAll();
    await seedIfEmpty();
    await refetchAll();""", """    await refetchAll();
    await seedIfEmpty();
    await refetchAll();
    await prjMigrateLegacy();""")

rep("  else if(S.route==='#/profile') renderProfile();\n", "  else if(S.route==='#/profile') renderDashboard();\n")
rep("setTitle('Documents', 'Every file attached to a transaction, organised by month');", "setTitle('Documents', 'Receipts and project documents, organised by month');")
rep("`connectivo-${kind}-analysis-${todayISO()}.pdf`", "`connectivo-projects-${kind}-analysis-${todayISO()}.pdf`")
# --- extra code (page, fetch redirect, rate memory)
inj += """
function prjRate(){ try{ return localStorage.getItem('prj_usd_rate')||''; }catch(e){ return ''; } }
function prjSaveRate(r){ try{ localStorage.setItem('prj_usd_rate', String(r)); }catch(e){} }
"""
rep("function renderAccounts(){", inj + "\nfunction renderAccounts(){")

# receipts open from the Projects store
rep("'/api/file?id='+encodeURIComponent(d.id)", "'/projects-api/file?id='+encodeURIComponent(d.id)")

out = os.path.join(root, 'public/projects/index.html')
open(out, 'w', encoding='utf8').write(s)
print('built', out, len(s))
