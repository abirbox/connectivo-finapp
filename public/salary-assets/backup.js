/* Connectivo - Download data / Upload data (backup & restore), shared by every portal.
   Usage: CPBackup.open('finops' | 'salary' | 'invoice' | 'projects' | 'all') */
(function(){
var NAMES={finops:'FinOps',salary:'Payroll / Attendance',invoice:'Invoice',projects:'Projects',all:'All portals (everything)'};
var BIG=400*1024;
function el(h){var d=document.createElement('div');d.innerHTML=h;return d.firstElementChild}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function post(path,body){return fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Portal':'1'},body:JSON.stringify(body)}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok||j.error)throw new Error(j.error||('Error '+r.status));return j})})}
function rawGet(scope,key){return fetch('/api/backup/raw?scope='+encodeURIComponent(scope)+'&key='+encodeURIComponent(key),{credentials:'same-origin'}).then(function(r){if(!r.ok)throw new Error('Could not read a stored file.');return r.text()})}
function rawPut(scope,key,val){return fetch('/api/backup/raw?scope='+encodeURIComponent(scope)+'&key='+encodeURIComponent(key),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'text/plain','X-Portal':'1'},body:val}).then(function(r){if(!r.ok)throw new Error('Could not write a stored file.')})}
function stamp(){var d=new Date(),p=function(n){return(n<10?'0':'')+n};return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes())}
function size(n){return n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB'}
function listKeys(scope,prog){var all=[],st={pi:0,cursor:null};
  function step(){return post('/api/backup/keys',{scope:scope,pi:st.pi,cursor:st.cursor}).then(function(j){all=all.concat(j.keys);if(prog)prog('Counting stored items... '+all.length);if(j.done)return all;st={pi:j.pi,cursor:j.cursor};return step()})}
  return step()}
function css(){if(document.getElementById('cpbkCss'))return;var s=document.createElement('style');s.id='cpbkCss';
 s.textContent='#cpbk{position:fixed;inset:0;z-index:100000;background:rgba(8,16,30,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit}#cpbk .bx{background:var(--surface,var(--card,#fff));color:var(--ink,var(--text,#14233b));border:1px solid var(--line,var(--border,#dfe5ee));border-radius:16px;width:560px;max-width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35)}#cpbk .hd{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line,var(--border,#dfe5ee))}#cpbk .hd b{font-size:17px;flex:1}#cpbk .bd{padding:18px 20px}#cpbk .sec{border:1px solid var(--line,var(--border,#dfe5ee));border-radius:12px;padding:14px 16px;margin-bottom:14px}#cpbk h4{margin:0 0 4px;font-size:14.5px}#cpbk p{margin:0 0 10px;font-size:12.8px;opacity:.78;line-height:1.5}#cpbk button.b{background:#1b6fb5;color:#fff;border:0;border-radius:9px;padding:9px 16px;font:600 13px inherit;cursor:pointer}#cpbk button.b.s{background:transparent;color:inherit;border:1px solid var(--line,var(--border,#cfd8e4))}#cpbk button.b.r{background:#c0392b}#cpbk button.b:disabled{opacity:.5;cursor:default}#cpbk .st{font-size:12.8px;margin-top:10px;white-space:pre-line}#cpbk .bar{height:7px;background:var(--line,var(--border,#e3e9f1));border-radius:5px;overflow:hidden;margin-top:10px;display:none}#cpbk .bar i{display:block;height:100%;width:0;background:#1b6fb5;transition:width .2s}#cpbk .warn{background:#fff7e6;color:#7a4b00;border:1px solid #f2d49b;border-radius:10px;padding:10px 12px;font-size:12.5px;margin:10px 0}#cpbk label.ck{display:flex;gap:8px;align-items:flex-start;font-size:12.8px;margin:10px 0}';
 document.head.appendChild(s)}
function open(scope){
  css();var old=document.getElementById('cpbk');if(old)old.remove();
  var fixed=scope!=='all';
  var o=el('<div id="cpbk"><div class="bx"><div class="hd"><b>Download / Upload data</b><button class="b s" id="bkx">Close</button></div><div class="bd">'+
   '<div class="sec"><h4>Download data - '+esc(NAMES[scope])+'</h4><p>Saves every record'+(scope==='all'?' of all portals':' of this portal')+' (including receipts, documents and settings) into one file. Keep the file safe: it contains private company information'+(scope==='all'||scope==='salary'||scope==='finops'?', sign-in details and email settings':'')+'.</p><button class="b" id="bkdl">Download data</button><div class="bar" id="bkbar1"><i></i></div><div class="st" id="bkst1"></div></div>'+
   '<div class="sec"><h4>Upload data</h4><p>Use this on the new website (for example your company domain) to load a downloaded file. <b>It replaces the current data</b> of the same portal(s) and everything works immediately.</p><input type="file" id="bkfile" accept=".json,application/json"><div class="st" id="bkinfo"></div><div id="bkgo" style="display:none"><div class="warn" id="bkwarn"></div><label class="ck"><input type="checkbox" id="bkck"> <span>I understand this will replace the current data.</span></label><button class="b r" id="bkup" disabled>Upload and restore</button></div><div class="bar" id="bkbar2"><i></i></div><div class="st" id="bkst2"></div></div>'+
   '</div></div></div>');
  document.body.appendChild(o);
  var $=function(id){return o.querySelector('#'+id)};
  $('bkx').onclick=function(){o.remove()};
  function bar(n,f){var b=$('bkbar'+n);b.style.display='block';b.firstChild.style.width=Math.round(f*100)+'%'}
  /* ---------- download ---------- */
  $('bkdl').onclick=function(){
    var btn=$('bkdl');btn.disabled=true;var st=$('bkst1');st.textContent='Starting...';
    var items=[],total=0,bytes=0;
    listKeys(scope,function(t){st.textContent=t}).then(function(keys){
      total=keys.length;var q=keys.slice();
      function next(){
        if(!q.length)return;
        var batch=q.splice(0,25);
        return post('/api/backup/get',{scope:scope,keys:batch}).then(function(j){
          Object.keys(j.items).forEach(function(k){items.push([k,j.items[k]]);bytes+=j.items[k].length});
          (j.left||[]).forEach(function(k){q.unshift(k)});
          var bigs=(j.big||[]).slice();
          return bigs.reduce(function(p,k){return p.then(function(){return rawGet(scope,k).then(function(v){items.push([k,v]);bytes+=v.length})})},Promise.resolve());
        }).then(function(){st.textContent='Reading data... '+items.length+' of '+total+' ('+size(bytes)+')';bar(1,total?items.length/total:1);return next()})}
      return next()}).then(function(){
        var head={format:'connectivo-backup',version:1,scope:scope,created:new Date().toISOString(),count:items.length,items:null};
        var parts=['{"format":"connectivo-backup","version":1,"scope":'+JSON.stringify(scope)+',"created":'+JSON.stringify(head.created)+',"count":'+items.length+',"items":[\n'];
        items.forEach(function(it,i){parts.push((i?',\n':'')+JSON.stringify(it))});parts.push('\n]}');
        var blob=new Blob(parts,{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='connectivo-'+scope+'-backup-'+stamp()+'.json';document.body.appendChild(a);a.click();setTimeout(function(){a.remove()},800);
        bar(1,1);st.textContent='Done. '+items.length+' items saved ('+size(blob.size)+'). Check your Downloads folder.';btn.disabled=false;
      }).catch(function(e){st.textContent='Could not download: '+e.message;btn.disabled=false})};
  /* ---------- upload ---------- */
  var DATA=null;
  $('bkfile').onchange=function(){
    DATA=null;$('bkgo').style.display='none';var f=this.files[0];if(!f)return;$('bkinfo').textContent='Reading file...';
    var r=new FileReader();r.onload=function(){
      try{var j=JSON.parse(r.result);if(j.format!=='connectivo-backup'||!j.items||!NAMES[j.scope])throw 0;DATA=j}catch(e){$('bkinfo').textContent='This is not a Connectivo backup file.';return}
      var n=DATA.items.length;$('bkinfo').innerHTML='File: <b>'+esc(NAMES[DATA.scope])+'</b> - '+n+' items - saved '+esc(new Date(DATA.created).toLocaleString())+' ('+size(f.size)+')';
      var w='Restoring replaces the current <b>'+esc(NAMES[DATA.scope])+'</b> data on this website with the data in this file. Download the current data first if you may need it.';
      if(n>900)w+='<br><br>This file has '+n+' items. The free Cloudflare plan allows about 1,000 writes per day, so a restore this big may stop part-way; if it does, simply run the upload again tomorrow.';
      $('bkwarn').innerHTML=w;$('bkgo').style.display='block';$('bkck').checked=false;$('bkup').disabled=true};
    r.readAsText(f)};
  $('bkck').onchange=function(){$('bkup').disabled=!this.checked};
  $('bkup').onclick=function(){
    if(!DATA)return;var st=$('bkst2'),btn=$('bkup'),sc=DATA.scope;btn.disabled=true;$('bkfile').disabled=true;st.textContent='Preparing...';
    var items=DATA.items,have={};items.forEach(function(it){have[it[0]]=1});
    listKeys(sc,function(t){st.textContent=t}).then(function(cur){
      var del=cur.filter(function(k){return!have[k]}),steps=del.length+items.length,done=0;
      function tick(n){done+=n;bar(2,steps?done/steps:1);st.textContent='Restoring... '+done+' of '+steps}
      function dels(){if(!del.length)return Promise.resolve();var b=del.splice(0,30);return post('/api/backup/delete',{scope:sc,keys:b}).then(function(){tick(b.length);return dels()})}
      var q=items.slice();
      function puts(){
        if(!q.length)return Promise.resolve();
        var b=[],bytes=0;
        while(q.length&&b.length<25&&bytes<900*1024){var it=q[0];if(it[1].length>BIG){if(b.length)break;q.shift();return rawPut(sc,it[0],it[1]).then(function(){tick(1);return puts()})}b.push(q.shift());bytes+=it[1].length}
        return post('/api/backup/put',{scope:sc,items:b}).then(function(){tick(b.length);return puts()})}
      return dels().then(puts)
    }).then(function(){bar(2,1);st.innerHTML='Done. The data was restored.<br><br><button class="b" id="bkre">Reload now</button>';o.querySelector('#bkre').onclick=function(){try{top.location.reload()}catch(e){location.reload()}}})
     .catch(function(e){st.textContent='Upload stopped: '+e.message+'\nNothing is lost: you can run the upload again.';btn.disabled=false;$('bkfile').disabled=false})};
}
window.CPBackup={open:open};
})();
