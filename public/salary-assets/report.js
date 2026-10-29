/* Connectivo - PDF and Excel export for the report tabs. Uses the portal's own data helpers (DB, analyze, dayFacts...). */
(function(){
var PAL_H=function(c){return c};
function T(v){return v==null?"":String(v)}
function dname(d){return d?String(d).replace(/\s*\([^)]*\)\s*$/,"").trim()||d:""}
function dshort(d){d=d||"";if(!d)return"";var m=d.match(/\(([^)]{1,12})\)/);return d.indexOf("C&M")>=0?"C & M":d.indexOf("M&C")>=0?"M & C":d.indexOf("Admin")>=0?"Admin":m?m[1]:(d.length>14?d.slice(0,13)+"…":d)}
function statTxt(a){return a.leave?["Leave","#7c4dff"]:a.state=="pending"?["Pending","#94a3b8"]:a.state=="check"?["Check","#dc3545"]:["Confirmed","#0f9d6a"]}
function longDate(d){return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
function shortDate(d){return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}
var HEAD=["Shift","Start","End","Type","Agent","Dept.","Place","Status","IN","OUT","Late","Extra","Less","Remark"];
var HW=[13,8,8,9,11,7,9,10,8,8,7,7,7,22],HA=["l","l","l","l","l","l","l","l","l","l","r","r","r","l"];
function attCells(r){var e=emp(r.eid)||{},a=analyze(r),f=dayFacts(r),st=statTxt(a);
 return[r.shift?{t:r.shift,bg:tintOf("shift",r.shift)}:"",r.start?f12(r.start):"",r.end?f12(r.end):"",{t:r.stype,bg:tintOf("stype",r.stype)},{t:nick(e),bg:col(e.name)},dshort(e.dept),r.wfh?"Home ("+(r.wfh=="Requested"?"req.":"asg.")+")":"Office",{t:st[0]+(a.worked?" "+fhm(a.worked):""),bg:st[1]},r.in?f12(r.in):"--",r.out?f12(r.out):"--",
  f.late?{t:fdur(f.late),fg:"#dc3545",b:1}:"",f.extra?{t:fdur(f.extra),fg:"#0f9d6a",b:1}:"",f.less?{t:fdur(f.less),fg:"#d98a06",b:1}:"",r.remark||""]}
function dayStats(dr){var pp=0,ll=0,aa=0;dr.forEach(function(x){var y=analyze(x);if(y.leave)aa++;else if(y.state=="ok"||y.state=="check")pp++;if(y.late>DB.s.late_mark)ll++});return{p:pp,l:ll,a:aa}}
function dayTitle(d,dr){var s=dayStats(dr);return longDate(d)+"     Total shifts: "+dr.length+"   Present: "+s.p+"   Late: "+s.l+"   Leave: "+s.a}
function tilesFor(rows){var P=0,L=0,A=0,LS=0,OT=0,PD=0;rows.forEach(function(r){var a=analyze(r);if(a.leave)A++;else if(a.state=="ok"||a.state=="check")P++;if(a.state=="pending")PD++;if(a.late>DB.s.late_mark)L++;if(a.less>=DB.s.less_min)LS++;if(a.extra>=DB.s.ot_min)OT++});
 return[["Total shifts",rows.length,"#1b6fb5"],["Present",P,"#0f9d6a"],["Late",L,"#d98a06"],["Less time",LS,"#c2410c"],["Overtime",OT,"#0b7a50"],["On leave",A,"#7c4dff"],["Missing times",PD,"#64748b"]]}
function byDay(rows){var out=[],cur=null;rows.forEach(function(r){if(!cur||cur.d!=r.date){cur={d:r.date,rows:[]};out.push(cur)}cur.rows.push(r)});return out}
function sortRows(rows){return rows.sort(attCmp)}
function dayModel(title,sub,rows,file){var t=[];byDay(rows).forEach(function(g){t.push({k:"grp",c:[dayTitle(g.d,g.rows)]});t.push({k:"hd",c:HEAD});g.rows.forEach(function(r){t.push({c:attCells(r)})})});
 return{title:title,sub:sub,file:file,orient:"L",tiles:tilesFor(rows),tables:[{head:null,w:HW,al:HA,rows:t}],note:rows.length?"":"No shifts were recorded for this period."}}
var M={};
M.entry=function(){var d=ST.date,rows=DB.att.filter(function(r){return r.date==d&&emp(r.eid)});sortRows(rows);return dayModel("Daily Attendance",longDate(d),rows,"Attendance_"+d)};
M.sheet=function(){var to=ST.to||ST.date,from=ST.from||shiftDate(to,-3);if(from>to){var x=from;from=to;to=x}var rows=sortRows(DB.att.filter(function(r){return r.date>=from&&r.date<=to&&emp(r.eid)}));return dayModel("Attendance Sheet",from==to?longDate(from):shortDate(from)+" to "+shortDate(to)+", "+to.slice(0,4),rows,"Attendance_sheet_"+from+"_to_"+to)};
M.review=function(){var m=ST.month,F=rfo(),list=reviewList(),T0={days:0,worked:0,late_count:0,late_min:0,less:0,extra:0,wfh:0,leave:0};
 list.forEach(function(x){var s=x.s;T0.days+=s.days;T0.worked+=s.worked;T0.late_count+=s.late_count;T0.late_min+=s.late_min;T0.less+=s.less;T0.extra+=s.extra;T0.wfh+=s.wr+s.wa;T0.leave+=s.leave});
 var rows=list.map(function(x){var e=x.e,s=x.s,sl=DB.slips[e.id+"|"+m];return{c:[{t:e.name+(e.desig?" ("+e.desig+")":""),b:1},s.days,fdur(s.worked),commit(e)||"",s.late_count+"x - "+fdur(s.late_min),fdur(s.less),fdur(s.extra),s.wr+" req / "+s.wa+" asg",s.leave,(s.pending?s.pending+" missing ":"")+(s.check?s.check+" check":""),sl?sl.status:"Not started"]}});
 if(list.length>1)rows.push({k:"tot",c:["Total ("+list.length+")",T0.days,fdur(T0.worked),"",T0.late_count+"x - "+fdur(T0.late_min),fdur(T0.less),fdur(T0.extra),T0.wfh+" day(s)",T0.leave,"",""]});
 var tabs=[{head:["Employee","Days","Worked","Commit (h)","Late","Less","Extra","WFH","Leave","Alerts","Payslip"],w:[24,6,9,8,13,9,9,12,6,12,10],al:["l","r","r","r","l","r","r","l","r","l","l"],rows:rows}];
 var fl=[];if(F.emp){var fe=emp(F.emp);if(fe)fl.push(fe.name)}if(F.dept)fl.push(F.dept);if(F.type)fl.push(F.type);if(F.pay)fl.push("Payslip: "+F.pay);F.met.forEach(function(k){RM.forEach(function(r){if(r[0]==k)fl.push(r[1])})});if(F.d1||F.d2)fl.push("Days "+(F.d1||1)+" to "+(F.d2||"end"));
 if(F.met.length||F.emp){var D=reviewDays(list);tabs.push({title:(F.met.length?"Matching days":"Daily records")+" ("+D.length+")",head:["Date","Employee","Shift","IN - OUT","Worked","Late","Less","Extra","Place","Status","Remark"],w:[12,10,12,16,8,8,8,8,10,9,20],al:["l","l","l","l","r","r","r","r","l","l","l"],
  rows:D.map(function(d){var r=d.r,f=d.f,a=f.a;return{c:[shortDate(r.date),{t:nick(d.e),bg:col(d.e.name)},r.shift?{t:r.shift,bg:shiftCol(r.shift)}:"",(r.in?f12(r.in):"--")+" - "+(r.out?f12(r.out):"--"),a.worked?fdur(a.worked):"",f.late?{t:fdur(f.late),fg:"#dc3545",b:1}:"",f.less?{t:fdur(f.less),fg:"#d98a06",b:1}:"",f.extra?{t:fdur(f.extra),fg:"#0f9d6a",b:1}:"",r.wfh?"Home ("+r.wfh.toLowerCase()+")":"Office",f.leave?{t:"Leave",bg:"#7c4dff"}:f.pending?{t:"Missing",bg:"#94a3b8"}:f.check?{t:"Check",bg:"#dc3545"}:{t:"OK",bg:"#0f9d6a"},r.remark||""]}})})}
 return{title:"Monthly Time Review",sub:mlabel(m)+(fl.length?"  |  Filter: "+fl.join(", "):""),file:"Monthly_review_"+m,orient:"L",tiles:[["Employees",list.length,"#1b6fb5"],["Days",T0.days,"#475569"],["Hours worked",(T0.worked/60).toFixed(1),"#0f9d6a"],["Late times",T0.late_count,"#d98a06"],["Less time",fdur(T0.less),"#c2410c"],["Extra time",fdur(T0.extra),"#0b7a50"],["Leave days",T0.leave,"#7c4dff"]],tables:tabs}};
M.slips=function(){var m=ST.month,tn=0,rows=activeEmps().map(function(e){var s=DB.slips[e.id+"|"+m],f=s&&s.status=="Finalized";if(s)tn+=+s.net||0;return{c:[{t:e.name,b:1},e.desig||"",e.email||"",s?{t:money(s.net),v:+s.net||0}:"",s?{t:s.status,bg:f?"#0f9d6a":"#94a3b8"}:{t:"Not started",bg:"#94a3b8"},s&&s.sent?"Sent "+s.sent:(s&&s.sendStatus=="Failed"?"Failed":"")]}});
 var fin=activeEmps().filter(function(e){var s=DB.slips[e.id+"|"+m];return s&&s.status=="Finalized"}).length;
 rows.push({k:"tot",c:["Total net pay","","",{t:money(tn),v:tn},"",""]});
 return{title:"Payslips",sub:mlabel(m),file:"Payslips_"+m,orient:"L",tiles:[["Employees",activeEmps().length,"#1b6fb5"],["Finalized",fin,"#0f9d6a"],["Total net pay (Tk)",money(tn),"#7c4dff"]],tables:[{head:["Employee","Designation","Email","Net pay (Tk)","Status","Emailed"],w:[22,18,28,13,11,16],al:["l","l","l","r","l","l"],rows:rows}]}};
function empRows(list,ex){return list.map(function(e){var dn=(DB.docs||[]).filter(function(d){return d.eid==e.id}).length,st=hstart(e),en=hend(e);return{c:ex?[{t:e.name,b:1},e.desig||"",dname(e.dept),st?hdate(st):"-",e.exitDate?hdate(e.exitDate):"",st&&en?hdiff(st,en):"-",e.exitReason||"",dn]:[{t:e.name,b:1},e.roster||"-",e.desig||"",dname(e.dept),e.type||"",st?hdate(st):"-",e.email?e.email:{t:"no email",fg:"#dc3545"},e.phone||""]}})}
function empHead(){return{premium:1,orient:"L",sigImg:DB.s.adminSig||"",sigName:DB.s.adminName||"A K Fazlul Haque",sigTitle:DB.s.adminTitle||"Admin & HR",accent:"#1b6fb5"}}
M.emps=function(){var q=(ST.q||"").toLowerCase(),l=DB.emps.filter(function(e){return e.status!="Inactive"&&(e.name+" "+e.roster+" "+e.desig).toLowerCase().indexOf(q)>=0}).sort(function(a,b){return a.name.localeCompare(b.name)}),R=empHead(),dp={},ne=0;
 l.forEach(function(e){dp[dname(e.dept)||"-"]=1;if(!e.email)ne++});
 R.eyebrow="Employee directory";R.title="Employees";R.sub="Active employees with their designation, department, joining date and contact details.";R.meta=[["Scope","Active employees"],["Employees",l.length],["As of",hdate(today())]];R.file="Employees";
 R.tiles=[["Active employees",l.length,"#1b6fb5"],["Departments",Object.keys(dp).length,"#7c4dff"],["Ex-employees",exEmps().length,"#64748b"],["No email",ne,ne?"#dc3545":"#0f9d6a"]];
 R.tables=[{head:["Name","Roster name","Designation","Department","Type","Since","Email","Phone"],w:[17,12,15,13,9,11,23,12],al:["l","l","l","l","l","l","l","l"],rows:empRows(l,false)}];R.note=l.length?"":"No employees found.";return R};
M.exemps=function(){var q=(ST.q2||"").toLowerCase(),l=exEmps().filter(function(e){return(e.name+" "+e.roster+" "+e.desig).toLowerCase().indexOf(q)>=0}).sort(function(a,b){return String(b.exitDate||"").localeCompare(String(a.exitDate||""))||a.name.localeCompare(b.name)}),R=empHead();
 R.eyebrow="Employee directory";R.title="Ex-employees";R.sub="Former employees kept on file, with their service period and reason for leaving.";R.meta=[["Scope","Ex-employees"],["Employees",l.length],["As of",hdate(today())]];R.file="Ex_employees";
 R.tiles=[["Ex-employees",l.length,"#64748b"],["Active employees",DB.emps.length-exEmps().length,"#1b6fb5"]];
 R.tables=[{head:["Name","Designation","Department","Joined","Left on","Service","Reason","Docs"],w:[17,15,13,11,11,13,24,5],al:["l","l","l","l","l","l","l","r"],rows:empRows(l,true)}];R.note=l.length?"":"No ex-employees on file.";return R};

M.sched=function(){var e=emp(ST.arg);if(!e)throw new Error("Open an employee's schedule first.");var q=scState(),rng=scRange(),rows=scRows(e.id),t=scTiles(rows),wk=q.view=="week";
 var by={};rows.forEach(function(x){(by[x.date]=by[x.date]||[]).push(x)});var out=[],d=rng[0];
 while(d<=rng[1]){var L=by[d]||[],ds=new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
  if(!L.length){if(wk)out.push({c:[ds,"","Off day","","","","","",""]})}
  else L.forEach(function(x,i){var st=scStatus(x),a=analyze(x),done=st.k=="Completed";out.push({c:[i?"":{t:ds,b:1},x.stype=="Leave"?"Leave":(x.shift||""),x.stype=="Leave"?"":f12(x.start)+" - "+f12(x.end),x.stype=="Leave"?"":(x.stype||""),x.place||"",{t:st.k,fg:st.c,b:1},done?f12(x.in):"",done?f12(x.out):"",[a.late>DB.s.late_mark&&done?"Late "+fdur(a.late):"",a.extra>=DB.s.ot_min&&done?"Extra "+fdur(a.extra):"",a.less>=DB.s.less_min&&done?"Less "+fdur(a.less):"",x.wfh?"WFH":"",x.remark||""].filter(Boolean).join("; ")]})});
  d=shiftDate(d,1)}
 var lab=wk?shortDate(rng[0])+" to "+shortDate(rng[1])+", "+rng[1].slice(0,4):mlabel(q.ref.slice(0,7));
 return{title:(wk?"Weekly":"Monthly")+" Shift Schedule",sub:e.name+(e.desig?" - "+e.desig:"")+"  |  "+lab,file:"Shift_schedule_"+(wk?"week_"+rng[0]:"month_"+rng[0].slice(0,7))+"_"+e.name.replace(/[^A-Za-z0-9]+/g,"_"),orient:"L",
  tiles:[["Total shifts",rows.length,"#1b6fb5"],["Completed",t.Completed,"#0f9d6a"],["Upcoming",t.Upcoming,"#1f6fe0"],["In progress",t["In progress"],"#d98a06"],["Leave",t.Leave,"#7c4dff"],["Not recorded",t["Not recorded"],"#c2410c"]],
  tables:[{head:["Date","Shift","Time","Type","Place","Status","IN","OUT","Notes"],w:[13,13,18,9,10,11,9,9,22],al:["l","l","l","l","l","l","l","l","l"],rows:out}],note:rows.length?"":"No shifts are scheduled for this period."}};
function trModel(kind){var K=TK[kind],e=ST.arg?emp(ST.arg):null,lab=trLabel(),gen=new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}),co=(DB.s&&DB.s.company)||"Connectivo";
 if(e){var D=trData(kind,e);return{premium:1,sigImg:DB.s.adminSig||"",sigName:DB.s.adminName||"A K Fazlul Haque",sigTitle:DB.s.adminTitle||"Admin & HR",accent:K.c,eyebrow:"Employee "+K.t+" Report",title:K.t+" Report",sub:"Detailed record calculated from the attendance sheet.",meta:[["Employee",e.name],["Designation",e.desig||"-"],["Department",dname(e.dept)||"-"],["Period",lab]],file:K.t.replace(/\W+/g,"_")+"_"+e.name.replace(/[^A-Za-z0-9]+/g,"_")+"_"+trRange()[0].slice(0,10),tiles:D.tiles,tables:[{head:D.head,w:D.w,al:D.al,rows:D.rows.map(function(c){return{c:c}})}],note:"No "+K.t.toLowerCase()+" records in this period."}}
 var tn=0,tm=0,list=activeEmps(),rows=list.map(function(x){var d=trSum(kind,trRecs(kind,x.id));tn+=d.n;tm+=d.min;
  return{c:[{t:x.name,b:1},x.desig||"",dname(x.dept),kind=="leave"?d.l:kind=="wfh"?d.n+" ("+d.rq+" req / "+d.as+" asg)":d.n,kind=="leave"?d.ab:fdur(d.min)]}});
 var h3=kind=="leave"?["Leave days","Absent days"]:kind=="wfh"?["WFH days","Hours worked"]:["Days","Total time"];
 return{premium:1,sigImg:DB.s.adminSig||"",sigName:DB.s.adminName||"A K Fazlul Haque",sigTitle:DB.s.adminTitle||"Admin & HR",accent:K.c,eyebrow:"All employees "+K.t+" summary",title:K.t+" Summary",sub:"Totals per employee from the attendance sheet.",meta:[["Scope","All employees"],["Employees",list.length],["Period",lab],["Prepared on",gen]],file:K.t.replace(/\W+/g,"_")+"_all_"+trRange()[0].slice(0,10),tiles:[["Employees",list.length,"#1b6fb5"],["Records",tn,K.c]].concat(kind=="leave"?[]:[["Total time",fdur(tm),K.c]]),tables:[{head:["Employee","Designation","Department"].concat(h3),w:[22,18,18,24,18],al:["l","l","l","r","r"],rows:rows}]}}
M.ot=function(){return trModel("ot")};M.leave=function(){return trModel("leave")};M.late=function(){return trModel("late")};M.wfh=function(){return trModel("wfh")};

function hSig(){return{premium:1,orient:"L",sigImg:DB.s.adminSig||"",sigName:DB.s.adminName||"A K Fazlul Haque",sigTitle:DB.s.adminTitle||"Admin & HR"}}
function hDoc(h){var d=h.docId&&(DB.docs||[]).filter(function(x){return x.id==h.docId})[0];return d?(d.title||d.orig):"-"}
function hOrd(t,i){return["Increment","Show-cause","Warning","Promotion"].indexOf(t)>=0?hord(i+1)+" "+t.toLowerCase():t}
M.hist=function(){var q=(ST.hq||"").toLowerCase(),T=ST.hc||"",ex=ST.hx!==false,gen=hdate(today()),
 list=DB.emps.filter(function(e){return(ex||e.status!="Inactive")&&(e.name+" "+(e.desig||"")).toLowerCase().indexOf(q)>=0}).sort(function(a,b){return a.name.localeCompare(b.name)});
 function nmc(e){return{t:e.name+(e.status=="Inactive"?" (ex)":""),b:1}}
 var n=function(t){var c=0;list.forEach(function(e){c+=hev(e,t).length});return c},R=hSig();
 R.accent="#1b6fb5";R.eyebrow="Employment history";R.sub=T?"Every "+T.toLowerCase()+" entry on record, with the attached document.":"Service record summary of every employee.";
 R.meta=[["Scope",T||"Overview"],["Employees",list.length],["As of",gen]];R.file="Employment_History_"+(T||"Overview").replace(/\W+/g,"_")+"_"+today();
 if(!T){R.title="Employment History";
  R.tiles=[["Employees",list.length,"#1b6fb5"],["Increments",n("Increment"),"#0f9d6a"],["Promotions",n("Promotion"),"#7c4dff"],["Show-cause",n("Show-cause"),"#d98a06"],["Warnings",n("Warning"),"#dc3545"]];
  R.tables=[{head:["Employee","Working since","With company","Confirmed","Increments","Last increment","Last promotion","Show-cause","Warnings"],w:[18,11,13,11,8,12,12,8,8],al:["l","l","l","l","r","l","l","r","r"],rows:list.map(function(e){var st=hstart(e),en=hend(e),cf=hev(e,"Confirmation").pop(),ic_=hev(e,"Increment"),li=ic_[ic_.length-1],lp=hev(e,"Promotion").pop();
   return{c:[nmc(e),st?hdate(st):"-",st?hdiff(st,en||today()):"-",cf?hdate(cf.date):"-",ic_.length,li?hdate(li.date):"-",lp?hdate(lp.date):"-",hev(e,"Show-cause").length,hev(e,"Warning").length]}})}];
  R.note=list.length?"":"No employees found.";return R}
 R.title=T;var rows=[],emps=0;
 list.forEach(function(e){var L=hev(e,T);if(!L.length)return;emps++;L.forEach(function(h,i){rows.push({c:[i?"":nmc(e),hOrd(T,i),hdate(h.date),[h.title||"",h.amount?"Tk "+money(h.amount):"",h.note||""].filter(Boolean).join(" - ")||"-",hdiff(h.date)+" ago",hDoc(h)]})})});
 R.tiles=[["Employees",emps,"#1b6fb5"],["Entries",rows.length,"#0f9d6a"]];
 R.tables=[{head:["Employee","Entry","Date","Details","Time since","Document"],w:[18,13,12,24,13,20],al:["l","l","l","l","l","l"],rows:rows}];R.note=rows.length?"":"No "+T.toLowerCase()+" entries recorded.";return R};
M.histemp=function(){var e=emp(ST.arg),T=ST.he||"",R=hSig(),_o=(R.orient="P"),st=hstart(e),en=hend(e),inc=hev(e,"Increment"),L=hlist(e).filter(function(h){return!T||h.type==T}),seq={};
 ["Increment","Show-cause","Warning","Promotion"].forEach(function(t){hev(e,t).forEach(function(h,i){seq[h.id]=hord(i+1)+" "+t.toLowerCase()})});
 R.accent="#1b6fb5";R.eyebrow="Employment history";R.title=e.name;R.sub="Service record"+(T?" - "+T:"")+" with the attached documents.";
 R.meta=[["Employee",e.name],["Designation",e.desig||"-"],["Department",dname(e.dept)||"-"],["Working since",st?hdate(st):"-"],["Status",e.status=="Inactive"?"Inactive"+(e.exitDate?" ("+hdate(e.exitDate)+")":""):"Active"]];
 R.file="Employment_History_"+e.name.replace(/[^A-Za-z0-9]+/g,"_")+"_"+today();
 R.tiles=[["With company",st?hdiff(st,en||today()):"-","#1b6fb5"],["Increments",inc.length,"#0f9d6a"],["Promotions",hev(e,"Promotion").length,"#7c4dff"],["Show-cause",hev(e,"Show-cause").length,"#d98a06"],["Warnings",hev(e,"Warning").length,"#dc3545"]];
 R.tables=[{head:["Date","Event","Position / details","New gross","Time since","Document"],w:[12,17,25,12,14,20],al:["l","l","l","r","l","l"],rows:L.map(function(h){return{c:[{t:hdate(h.date),b:1},h.type+(seq[h.id]?" ("+seq[h.id]+")":""),[h.title||"",h.note||""].filter(Boolean).join(" - ")||"-",h.amount?"Tk "+money(h.amount):"",hdiff(h.date)+" ago",hDoc(h)]}})}];
 R.note=L.length?"":"No events recorded.";return R};
window.attModel=function(eid,m){var e=emp(eid),R=hSig(),rr=[m+"-01",trLast(m)],K=["ot","late","leave","wfh"],T={ot:["Overtime","#d98a06"],late:["Late","#dc3545"],leave:["Leave / Absent","#7c4dff"],wfh:["Work From Home","#1b6fb5"]},D={};
 K.forEach(function(k){D[k]=trData(k,e,rr)});D.wfh.rows=D.wfh.rows.filter(function(r){return r[2]&&r[2].t=="Requested"});D.wfh.t=trSum("wfh",D.wfh.recs.filter(function(x){return x.type=="Requested"}));R.orient="P";R.accent="#1b6fb5";R.eyebrow="Monthly Attendance Report";R.title=e.name;R.sub="Attendance details for "+mlabel(m)+": overtime, late, leave/absent and work from home.";
 R.meta=[["Employee",e.name],["Designation",e.desig||"-"],["Department",dname(e.dept)||"-"],["Month",mlabel(m)],["Prepared on",hdate(today())]];
 R.file="Attendance_Report_"+e.name.replace(/[^A-Za-z0-9]+/g,"_")+"_"+m;
 R.tiles=[["Overtime",D.ot.t.n?fdur(D.ot.t.min)+" ("+D.ot.t.n+"d)":"None","#d98a06"],["Late",D.late.t.n?D.late.t.n+"d / "+fdur(D.late.t.min):"None","#dc3545"],["Leave",D.leave.t.l+" day"+(D.leave.t.l==1?"":"s"),"#7c4dff"],["Absent",D.leave.t.ab+" day"+(D.leave.t.ab==1?"":"s"),"#c2410c"],["WFH",D.wfh.t.n+" day"+(D.wfh.t.n==1?"":"s"),"#1b6fb5"]];
 R.tables=K.map(function(k,i){var d=D[k],rows=d.rows.map(function(r){return{c:r}});if(!rows.length){var c=d.head.map(function(){return""});c[0]="No records this month";rows=[{c:c}]}
  return{title:(i+1)+". "+T[k][0]+(d.rows.length?"  -  "+(k=="leave"?d.t.l+" leave, "+d.t.ab+" absent":k=="wfh"?d.t.n+" day(s)":d.t.n+" day(s), "+fdur(d.t.min)):""),head:d.head,w:d.w,al:d.al,rows:rows}});
 R.note="Overtime, late and leave/absent entries are taken from the attendance sheet. Final payable amounts are shown on the payslip.";return R};
M.attrep=function(){return window.attModel(ST.arg||activeEmps()[0].id,ST.month)};
M.log=function(){return{title:"Activity Log",sub:"Last "+DB.log.length+" change(s)",file:"Activity_log",orient:"P",tiles:[],tables:[{head:["#","Activity"],w:[5,95],al:["r","l"],rows:DB.log.map(function(l,i){return{c:[i+1,l]}})}]}};
// ---------- Excel
function xnum(c){return typeof c=="object"&&c&&c.v!=null}
function xlsxReport(R,company){var fonts=['<font><sz val="10"/><name val="Century Gothic"/></font>'],fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'],borders=['<border><left/><right/><top/><bottom/><diagonal/></border>','<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>'],xfs=[],map={};
 function idx(a,x){var i=a.indexOf(x);if(i<0){a.push(x);i=a.length-1}return i}
 function hx(c,d){c=String(c||"");if(/^#[0-9a-f]{6}$/i.test(c))return c.slice(1).toUpperCase();var m=/^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/.exec(c);if(m){var H=+m[1],S=+m[2]/100,L=+m[3]/100,a=S*Math.min(L,1-L),f=function(n){var k=(n+H/30)%12;return Math.round((L-a*Math.max(-1,Math.min(k-3,9-k,1)))*255).toString(16).padStart(2,"0")};return(f(0)+f(8)+f(4)).toUpperCase()}return d}
 function xf(o){var k=JSON.stringify(o);if(map[k]!=null)return map[k];
  var fo=idx(fonts,'<font>'+(o.b?'<b/>':'')+(o.i?'<i/>':'')+'<sz val="'+(o.sz||10)+'"/><color rgb="FF'+(o.fg||"0F172A")+'"/><name val="Century Gothic"/></font>'),fi=o.bg?idx(fills,'<fill><patternFill patternType="solid"><fgColor rgb="FF'+o.bg+'"/><bgColor indexed="64"/></patternFill></fill>'):0,bo=o.ln?1:0;
  xfs.push('<xf numFmtId="'+(o.nf==2?4:o.nf==1?3:0)+'" fontId="'+fo+'" fillId="'+fi+'" borderId="'+bo+'" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"'+(o.nf?' applyNumberFormat="1"':"")+'><alignment horizontal="'+(o.al=="r"?"right":o.al=="c"?"center":"left")+'" vertical="center"'+(o.wr?' wrapText="1"':"")+'/></xf>');map[k]=xfs.length-1;return map[k]}
 xf({});
 var rows=[],merges=[],ncols=1,rn=0,freeze=0,filt=null;
 R.tables.forEach(function(t){ncols=Math.max(ncols,t.head?t.head.length:(t.rows[0]?t.rows[0].c.length:1))});
 function push(cells,ht){rn++;rows.push({n:rn,cells:cells,ht:ht});return rn}
 function cellX(i,c,o){var ref=xcol(i)+rn;var s=xf(o);if(c===""||c==null)return'<c r="'+ref+'" s="'+s+'"/>';return'<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+xe(c)+'</t></is></c>'}
 // title block
 rn++;rows.push({n:rn,cells:[cellX(0,company||"Connectivo",{b:1,sz:15,fg:"0F172A"})],ht:24});
 rn++;rows.push({n:rn,cells:[cellX(0,R.title,{b:1,sz:13,fg:"1B6FB5"})],ht:20});
 if(R.sub){rn++;rows.push({n:rn,cells:[cellX(0,R.sub,{sz:10,fg:"475569"})]})}
 rn++;rows.push({n:rn,cells:[cellX(0,"Generated "+new Date().toLocaleString("en-GB"),{sz:8,i:1,fg:"64748B"})]});
 if(R.tiles&&R.tiles.length){rn++;rows.push({n:rn,cells:[]});var lr=rn+1,vr=rn+2;var lab=[],val=[];R.tiles.forEach(function(t,i){lab.push(null);val.push(null)});
  rn++;var cl=[];R.tiles.forEach(function(t,i){cl.push('<c r="'+xcol(i)+rn+'" s="'+xf({sz:8,fg:"64748B",bg:"F8FAFC",al:"c"})+'" t="inlineStr"><is><t>'+xe(t[0])+'</t></is></c>')});rows.push({n:rn,cells:cl});
  rn++;var cv=[];R.tiles.forEach(function(t,i){cv.push('<c r="'+xcol(i)+rn+'" s="'+xf({b:1,sz:14,fg:hx(t[2],"1B6FB5"),bg:"F8FAFC",al:"c"})+'" t="inlineStr"><is><t>'+xe(t[1])+'</t></is></c>')});rows.push({n:rn,cells:cv,ht:24})}
 var single=R.tables.length==1;
 R.tables.forEach(function(t){rn++;rows.push({n:rn,cells:[]});
  if(t.title){rn++;rows.push({n:rn,cells:[cellX(0,t.title,{b:1,sz:12})],ht:20})}
  var nc=t.head?t.head.length:ncols;
  function put(row){var k=row.k;rn++;var cs=[];
   if(k=="grp"){cs.push(cellX(0,(row.c[0]&&row.c[0].t!=null)?row.c[0].t:row.c[0],{b:1,sz:11,bg:"E8EEF6"}));for(var i=1;i<nc;i++)cs.push(cellX(i,"",{bg:"E8EEF6"}));merges.push("A"+rn+":"+xcol(nc-1)+rn);rows.push({n:rn,cells:cs,ht:20});return}
   row.c.forEach(function(c,i){var o=(c&&typeof c=="object")?c:{t:c},al=(t.al||[])[i]||"l";
    var st={ln:1,al:al,b:o.b||k=="tot"||k=="hd"||!!o.bg,fg:k=="hd"?"475569":o.bg?"FFFFFF":hx(o.fg,"0F172A"),bg:o.bg?hx(o.bg,"64748B"):k=="hd"?"F1F5F9":k=="tot"?"EEF2F7":null,sz:k=="hd"?9:10,wr:1};if(o.bg)st.al="c";
    if(o.v!=null){st.nf=2;rows.length;var ref=xcol(i)+rn;cs.push('<c r="'+ref+'" s="'+xf(st)+'"><v>'+o.v+'</v></c>')}else cs.push(cellX(i,o.t,st))});
   rows.push({n:rn,cells:cs,ht:k=="hd"?20:null})}
  if(t.head){var hr=rn+1;put({k:"hd",c:t.head});if(single&&!R.tiles.length||single)freeze=hr;if(single&&t.rows.length)filt="A"+hr+":"+xcol(nc-1)+(hr+t.rows.length)}
  t.rows.forEach(put)});
 var ws=R.tables.reduce(function(a,t){t.w.forEach(function(w,i){a[i]=Math.max(a[i]||0,w)});return a},[]);
 var total=ws.reduce(function(a,b){return a+b},0)||1,f=Math.max(1.1,Math.min(2.2,(R.orient=="P"?100:150)/total));
 var cols=ws.map(function(w,i){return'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+Math.max(9,Math.round(w*f*1.15))+'" customWidth="1"/>'}).join("");
 var sd=rows.map(function(r){return'<row r="'+r.n+'"'+(r.ht?' ht="'+r.ht+'" customHeight="1"':"")+'>'+r.cells.join("")+'</row>'}).join("");
 var X='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',orient=R.orient=="P"?"portrait":"landscape";
 var pane=freeze?'<pane ySplit="'+freeze+'" topLeftCell="A'+(freeze+1)+'" activePane="bottomLeft" state="frozen"/>':"";
 var files=[{n:"[Content_Types].xml",d:X+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
  {n:"_rels/.rels",d:X+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
  {n:"xl/workbook.xml",d:X+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+xe(R.title.replace(/[\\\/?*\[\]:]/g," ").slice(0,31))+'" sheetId="1" r:id="rId1"/></sheets>'+(filt?'<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\''+xe(R.title.replace(/[\\\/?*\[\]:]/g," ").slice(0,31))+'\'!'+filt.replace(/([A-Z]+)(\d+)/g,"$$$1$$$2")+'</definedName></definedNames>':"")+'</workbook>'},
  {n:"xl/_rels/workbook.xml.rels",d:X+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
  {n:"xl/styles.xml",d:X+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="'+fonts.length+'">'+fonts.join("")+'</fonts><fills count="'+fills.length+'">'+fills.join("")+'</fills><borders count="'+borders.length+'">'+borders.join("")+'</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="'+xfs.length+'">'+xfs.join("")+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'},
  {n:"xl/worksheets/sheet1.xml",d:X+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView showGridLines="0" workbookViewId="0">'+pane+'</sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols>'+cols+'</cols><sheetData>'+sd+'</sheetData>'+(filt?'<autoFilter ref="'+filt+'"/>':"")+(merges.length?'<mergeCells count="'+merges.length+'">'+merges.map(function(x){return'<mergeCell ref="'+x+'"/>'}).join("")+'</mergeCells>':"")+'<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="'+orient+'" fitToWidth="1" fitToHeight="0"/></worksheet>'}];
 return zipStore(files)}
function save(blob,name){var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){a.remove()},500)}
window.doExp=function(kind,key){var go_=function(){var R=M[key]();var nm=(R.file||key)+(kind=="pdf"?".pdf":".xlsx");
  if(kind=="xlsx"){try{save(xlsxReport(R,DB.s.company),nm);toast("Excel file downloaded")}catch(e){alert("Could not create the Excel file: "+e.message)}return}
  toast("Preparing PDF...");PDFKIT.report(R,DB.s.company,DB.s.logo||"").then(function(u8){save(new Blob([u8],{type:"application/pdf"}),nm);toast("PDF downloaded")}).catch(function(e){alert("Could not create the PDF: "+e.message)})};
  if(window.flush)flush().then(go_,go_);else go_()};
window.expBtns=function(key,small){return'<span class="expb"><button class="btn sec sm" onclick="doExp(\'pdf\',\''+key+'\')">'+ic("download")+'PDF</button><button class="btn sec sm" onclick="doExp(\'xlsx\',\''+key+'\')">'+ic("download")+'Excel</button></span>'};
window.RPT={models:M,xlsx:xlsxReport};
})();
