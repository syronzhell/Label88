(async () => {
  'use strict';
  const $ = id => document.getElementById(id);
  const decode = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const assets = JSON.parse($('pdf-assets').textContent);
  class OfflineBinaryDataFactory {
    async fetch({kind, filename}) {
      const content = assets[kind]?.[filename];
      if (!content) throw new Error('Aset PDF tidak tersedia: ' + filename);
      return decode(content);
    }
  }
  let pdfjs;
  try {
    pdfjs = await import('./vendor/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
  } catch (e) {
    $('status').textContent = 'Tool belum bisa dimuat. Gunakan Safari 18 / iOS 18 atau browser terbaru, lalu muat ulang.';
    return;
  }
  const { PDFDocument, degrees, rgb } = PDFLib;
  const files = [];
  let labels = [], busy = false, nextId = 0, croppingFile = null;
  let outputFile = null, outputUrl = null;
  let cropArea = [0,0,1,1], dragStart = null, cropRenderToken = 0;
  const MM = 72/25.4;
  const layouts = {
    '2x2':'4 label · 2 × 2', '1x4':'4 label · ke bawah',
    '2x1':'2 label · kiri / kanan', '1x2':'2 label · atas / bawah',
    '1x1':'1 label · seluruh halaman', manual:'Crop manual'
  };
  const breathe = () => new Promise(resolve => requestAnimationFrame(resolve));
  function status(message, progress) {
    $('status').textContent = message;
    $('progress').hidden = progress === undefined;
    if (progress !== undefined) $('progress').value = progress;
  }
  function error(message) {
    const box = document.createElement('div'); box.textContent = message; $('errors').append(box);
  }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('aside button, aside input, aside select, .selection button, #example, .rotate').forEach(el => el.disabled = value);
    $('dropzone').classList.toggle('busy', value);
    updateSummary();
  }
  function settings() {
    const width = Number($('width').value), margin = Number($('margin').value);
    const fixed = $('heightMode').value === 'fixed';
    const height = fixed ? Number($('height').value) : null;
    if (!Number.isFinite(width) || width<30 || width>220) throw new Error('Lebar kertas harus 30–220 mm.');
    if (!Number.isFinite(margin) || margin<0 || margin>15 || width <= 2*margin) throw new Error('Margin harus 0–15 mm dan menyisakan area cetak.');
    if (fixed && (!Number.isFinite(height) || height<30 || height>500 || height<=2*margin)) throw new Error('Tinggi kertas harus 30–500 mm dan lebih besar dari total margin.');
    return {width, margin, height, fixed};
  }
  function geometry(label, opts) {
    const rot = (label.sourceRotation + label.rotation) % 360;
    const bw = label.box.right - label.box.left, bh = label.box.top - label.box.bottom;
    const visibleW = rot%180 ? bh : bw, visibleH = rot%180 ? bw : bh;
    const paperW = opts.width*MM, margin = opts.margin*MM;
    const paperH = opts.fixed ? opts.height*MM : (paperW-2*margin)*visibleH/visibleW+2*margin;
    const scale = Math.min((paperW-2*margin)/visibleW,(paperH-2*margin)/visibleH);
    const drawW = visibleW*scale, drawH = visibleH*scale;
    return {rot,bw,bh,paperW,paperH,scale,drawW,drawH,x:(paperW-drawW)/2,y:(paperH-drawH)/2};
  }
  function updateSummary() {
    const chosen = labels.filter(l => l.selected);
    $('empty').hidden = files.length>0;
    $('clear').hidden = !files.length;
    $('selectAll').disabled = $('selectNone').disabled = busy || !labels.length;
    $('counter').textContent = labels.length ? chosen.length + ' dari ' + labels.length + ' label dipilih' : (files.length ? 'Belum ada label' : 'Belum ada label');
    let opts;
    try { opts = settings(); } catch (e) {
      $('outputDetail').textContent=e.message; $('download').disabled=true; return;
    }
    $('download').disabled = busy || !chosen.length;
    $('outputSummary').textContent = chosen.length ? chosen.length + ' label → 1 PDF gabungan' : 'PDF siap untuk printer label';
    let sizeText = 'Lebar ' + opts.width + ' mm · margin ' + opts.margin + ' mm';
    if (opts.fixed) sizeText += ' · tinggi ' + opts.height + ' mm';
    else if (chosen.length) {
      const heights = chosen.map(l => geometry(l,opts).paperH/MM);
      const min=Math.min(...heights), max=Math.max(...heights);
      sizeText += ' · tinggi ' + min.toFixed(1) + (max-min>0.15 ? '–'+max.toFixed(1) : '') + ' mm';
    } else sizeText += ' · tinggi otomatis';
    $('outputDetail').textContent = sizeText;
    for (const label of labels) {
      if (!label.card) continue;
      const g=geometry(label,opts), paper=label.card.querySelector('.label-paper'), img=paper.querySelector('img');
      paper.style.aspectRatio = g.paperW + '/' + g.paperH;
      // Keep extremely tall labels fully visible rather than cutting off their preview.
      paper.style.width = 'min(100%, '+(420*g.paperW/g.paperH).toFixed(1)+'px)';
      img.style.left = (g.x/g.paperW*100)+'%';
      img.style.top = (g.y/g.paperH*100)+'%';
      img.style.width = (g.drawW/g.paperW*100)+'%';
      img.style.height = (g.drawH/g.paperH*100)+'%';
      label.card.querySelector('.card-size').textContent = opts.width + ' × ' + (g.paperH/MM).toFixed(1) + ' mm' + (label.blank ? ' · kosong' : '');
      label.card.classList.toggle('selected',label.selected);
      label.card.querySelector('input').checked = label.selected;
    }
  }
  function effectiveLayout(file) { return file.layout || $('layout').value; }
  function renderFileList() {
    $('fileList').replaceChildren();
    for (const file of files) {
      const row = document.createElement('div'); row.className='file-row';
      const heading=document.createElement('div'); heading.className='file-heading';
      const name=document.createElement('div'); name.className='file-name'; name.textContent=file.name; name.title=file.name;
      const remove=document.createElement('button'); remove.className='icon-button'; remove.textContent='×'; remove.title='Hapus '+file.name; remove.setAttribute('aria-label',remove.title);
      remove.onclick=async()=> {if(busy)return;setBusy(true);const index=files.indexOf(file);files.splice(index,1);await file.doc.destroy();renderFileList();await rebuild(true);};
      heading.append(name,remove);
      const info=document.createElement('div'); info.className='file-info'; info.textContent=file.doc.numPages+' halaman · '+(file.bytes.length/1048576).toFixed(1)+' MB';
      const select=document.createElement('select'); select.setAttribute('aria-label','Pola untuk '+file.name);
      const inherited=document.createElement('option'); inherited.value=''; inherited.textContent='Ikuti pola utama'; select.append(inherited);
      for (const [value,title] of Object.entries(layouts)) {const op=document.createElement('option'); op.value=value; op.textContent=title; select.append(op);}
      select.value=file.layout;
      select.onchange=async()=>{file.layout=select.value; renderFileList();await rebuild();if(effectiveLayout(file)==='manual' && !file.crop)await openCrop(file);};
      row.append(heading,info,select);
      if (effectiveLayout(file)==='manual') {
        const crop=document.createElement('button'); crop.className='secondary crop-button'; crop.textContent=file.crop?'Ubah area crop':'Pilih area crop';
        crop.onclick=()=>openCrop(file); row.append(crop);
      }
      $('fileList').append(row);
    }
  }
  async function addFiles(input) {
    if (busy) return;
    const incoming=Array.from(input); if(!incoming.length)return;
    $('errors').replaceChildren(); setBusy(true);
    let total=files.reduce((sum,f)=>sum+f.bytes.length,0);
    for (let i=0;i<incoming.length;i++) {
      const item=incoming[i]; status('Membaca '+item.name+'…',100*i/incoming.length);
      if (!/\.pdf$/i.test(item.name) && item.type!=='application/pdf') {error(item.name+': bukan file PDF.'); continue;}
      if (item.size>100*1048576 || total+item.size>300*1048576) {error(item.name+': batas 100 MB per file / 300 MB per sesi. Proses file besar dalam beberapa batch.');continue;}
      let doc;
      try {
        const bytes=new Uint8Array(await item.arrayBuffer());
        // Keep the original bytes: PDF.js transfers its copy to the worker.
        doc=await pdfjs.getDocument({data:bytes.slice(),BinaryDataFactory:OfflineBinaryDataFactory,useWorkerFetch:false,isEvalSupported:false,verbosity:0}).promise;
        const lib=await PDFDocument.load(bytes);
        // Form fields are annotations; embedPage only copies page drawing streams.
        // Flatten their existing appearances so filled label values survive export.
        const form=lib.getForm();
        if(form.getFields().length)form.flatten();
        if (doc.numPages!==lib.getPageCount()) throw new Error('jumlah halaman tidak konsisten');
        files.push({id:++nextId,name:item.name,bytes,doc,lib,layout:'',crop:null}); total+=item.size;
      } catch (e) {
        if(doc) await doc.destroy();
        const msg=/password|encrypt/i.test(e.message) ? 'PDF terkunci. Ekspor salinan tanpa password dulu.' : 'PDF tidak dapat dibaca. Coba unduh ulang dari ekspedisi.';
        error(item.name+': '+msg);
      }
      await breathe();
    }
    renderFileList();
    await rebuild(true);
  }
  function cellRects(file) {
    const mode=effectiveLayout(file);
    if (mode==='manual') return file.crop?[file.crop]:[];
    const [cols,rows]=mode.split('x').map(Number), result=[];
    for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) result.push([col/cols,row/rows,1/cols,1/rows]);
    return result;
  }
  function inkBounds(canvas) {
    const {width:w,height:h}=canvas, ctx=canvas.getContext('2d',{willReadFrequently:true});
    const data=ctx.getImageData(0,0,w,h).data;
    let left=w,top=h,right=-1,bottom=-1,count=0;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      const i=(y*w+x)*4;
      if (data[i+3]>0 && (data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)<242) {
        count++; if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;
      }
    }
    return {left,top,right,bottom,blank:count<4};
  }
  async function thumbnail(source, rotation) {
    const img=new Image(); img.src=source; await img.decode();
    const swapped=rotation%180!==0;
    const canvas=document.createElement('canvas'); canvas.width=swapped?img.height:img.width;canvas.height=swapped?img.width:img.height;
    const ctx=canvas.getContext('2d'); ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(img,-img.width/2,-img.height/2);
    return canvas.toDataURL('image/png');
  }
  async function rebuild(alreadyBusy=false) {
    if (busy && !alreadyBusy) return;
    setBusy(true);
    invalidateResult();
    const prior=new Map(labels.map(l=>[l.key,l]));
    labels=[]; $('labels').replaceChildren();
    const total=files.reduce((sum,f)=>sum+f.doc.numPages,0);let done=0, skipped=0,failed=0;
    for(const file of files) {
      const cells=cellRects(file);
      if(!cells.length){skipped+=file.doc.numPages;continue;}
      for(let n=1;n<=file.doc.numPages;n++) {
        status('Membuat preview · '+file.name+' · halaman '+n+'/'+file.doc.numPages,100*done/Math.max(total,1));
        try {
          const page=await file.doc.getPage(n), view=page.getViewport({scale:1});
          const scale=Math.min(1.7,1600/Math.max(view.width,view.height));
          const viewport=page.getViewport({scale});
          const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
          for(let c=0;c<cells.length;c++) {
            const [rx,ry,rw,rh]=cells[c];
            const sx=Math.round(rx*viewport.width),sy=Math.round(ry*viewport.height);
            const sw=Math.min(canvas.width-sx,Math.round((rx+rw)*viewport.width)-sx);
            const sh=Math.min(canvas.height-sy,Math.round((ry+rh)*viewport.height)-sy);
            const tile=document.createElement('canvas');tile.width=sw;tile.height=sh;
            tile.getContext('2d').drawImage(canvas,sx,sy,sw,sh,0,0,sw,sh);
            const bounds=inkBounds(tile);
            // Preserve a safety buffer around all detected ink, including barcode quiet zones.
            let tx=0,ty=0,tw=sw,th=sh;
            if($('trim').checked && !bounds.blank) {
              const pad=Math.ceil(2*MM*scale); // 2 mm at original page scale
              tx=Math.max(0,bounds.left-pad);ty=Math.max(0,bounds.top-pad);
              tw=Math.min(sw,bounds.right+pad+1)-tx; th=Math.min(sh,bounds.bottom+pad+1)-ty;
            }
            const x=(sx+tx)/scale,y=(sy+ty)/scale,w=tw/scale,h=th/scale;
            const corners=[view.convertToPdfPoint(x,y),view.convertToPdfPoint(x+w,y),view.convertToPdfPoint(x,y+h),view.convertToPdfPoint(x+w,y+h)];
            const box={left:Math.min(...corners.map(p=>p[0])),right:Math.max(...corners.map(p=>p[0])),bottom:Math.min(...corners.map(p=>p[1])),top:Math.max(...corners.map(p=>p[1]))};
            const thumb=document.createElement('canvas');const ratio=Math.min(1,260/tw,540/th);
            thumb.width=Math.max(1,Math.round(tw*ratio));thumb.height=Math.max(1,Math.round(th*ratio));
            thumb.getContext('2d').drawImage(tile,tx,ty,tw,th,0,0,thumb.width,thumb.height);
            const key=file.id+':'+n+':'+c, old=prior.get(key);
            const label={key,file,page:n,cell:c,box,sourceRotation:((page.rotate%360)+360)%360,rotation:old?.rotation||0,selected:old?old.selected:!bounds.blank,blank:bounds.blank,baseImage:thumb.toDataURL('image/png')};
            label.image=label.rotation?await thumbnail(label.baseImage,label.rotation):label.baseImage;
            labels.push(label);
            tile.width=tile.height=thumb.width=thumb.height=1;
          }
          canvas.width=canvas.height=1;
          page.cleanup();
        } catch(e) {failed++;error(file.name+' · halaman '+n+': preview gagal. Halaman ini dilewati; jangan anggap PDF hasilnya lengkap.');}
        done++; await breathe();
      }
    }
    renderLabels();setBusy(false);
    const blank=labels.filter(l=>l.blank).length;
    status(labels.length ? 'Siap · '+files.length+' file · '+labels.length+' potongan'+(blank?' · '+blank+' potongan kosong tidak dipilih otomatis':'')+(skipped?' · '+skipped+' halaman menunggu crop manual':'')+(failed?' · '+failed+' halaman gagal':'') : skipped ? 'Pilih area crop manual pada daftar file untuk membuat preview.' : 'Siap. Tambahkan PDF ekspedisi untuk mulai.');
  }
  function renderLabels() {
    $('labels').replaceChildren();
    for(const [index,label] of labels.entries()) {
      const card=document.createElement('article');card.className='label-card'+(label.blank?' blank':'');label.card=card;
      const top=document.createElement('div');top.className='card-top';
      const checkLabel=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=label.selected;
      input.onchange=()=>{if(busy){input.checked=label.selected;return;}label.selected=input.checked;invalidateResult();updateSummary();};
      checkLabel.append(input,document.createTextNode('Label '+(index+1)));
      const rotate=document.createElement('button');rotate.className='rotate';rotate.textContent='↻';rotate.title='Putar label 90°';rotate.setAttribute('aria-label',rotate.title);
      rotate.onclick=async()=>{if(busy)return;rotate.disabled=true;invalidateResult();label.rotation=(label.rotation+90)%360;label.image=await thumbnail(label.baseImage,label.rotation);card.querySelector('img').src=label.image;updateSummary();rotate.disabled=false;};
      top.append(checkLabel,rotate);
      const paper=document.createElement('div');paper.className='label-paper';const img=new Image();img.src=label.image;img.alt='Preview label '+(index+1);paper.append(img);
      const source=document.createElement('div');source.className='card-source';source.textContent=label.file.name+' · hlm '+label.page+' · bagian '+(label.cell+1);source.title=source.textContent;
      const size=document.createElement('div');size.className='card-size';card.append(top,paper,source,size);$('labels').append(card);
    }
    updateSummary();
  }
  function invalidateResult() {
    $('result').hidden = true;
    if(outputUrl) URL.revokeObjectURL(outputUrl);
    outputFile = outputUrl = null;
  }
  function saveBlob(bytes,name) {
    invalidateResult();
    outputFile = new File([bytes],name,{type:'application/pdf'});
    outputUrl = URL.createObjectURL(outputFile);
    $('resultLink').href = outputUrl;
    $('resultLink').download = name;
    $('viewPdf').href = outputUrl;
    $('resultName').textContent = name;
    $('shareOutput').hidden = !navigator.canShare?.({files:[outputFile]});
    $('result').hidden = false;
    $('result').scrollIntoView({behavior:'smooth',block:'center'});
  }
  $('shareOutput').onclick = async () => {
    if(!outputFile)return;
    try { await navigator.share({files:[outputFile],title:'Label PDF 88 mm'}); }
    catch(e) {if(e.name!=='AbortError')error('Bagikan file belum berhasil. Pilih Download atau Buka PDF, lalu simpan dari Safari.');}
  };
  async function exportPDF() {
    if(busy)return;
    let opts;
    try{opts=settings();}catch(e){error(e.message);return;}
    const chosen=labels.filter(l=>l.selected);if(!chosen.length)return;
    setBusy(true);
    try {
      const out=await PDFDocument.create();out.setTitle('BQQT Label '+opts.width+' mm');out.setCreator('BQQT Label Tools - offline');out.setSubject('Satu label per halaman; cetak Actual size 100%');
      for(let i=0;i<chosen.length;i++) {
        const label=chosen[i],g=geometry(label,opts);
        status('Menggabungkan label '+(i+1)+'/'+chosen.length+'…',100*i/chosen.length);
        const sourcePage=label.file.lib.getPages()[label.page-1];
        const page=out.addPage([g.paperW,g.paperH]);
        let x=g.x,y=g.y;
        if(g.rot===90)y+=g.drawH;
        else if(g.rot===180){x+=g.drawW;y+=g.drawH;}
        else if(g.rot===270)x+=g.drawW;
        if (!label.blank) {
          const embedded=await out.embedPage(sourcePage,label.box);
          page.drawPage(embedded,{x,y,width:g.bw*g.scale,height:g.bh*g.scale,rotate:degrees(-g.rot)});
        }
        await breathe();
      }
      const bytes=await out.save();
      const stamp=new Date().toISOString().slice(0,10);
      saveBlob(bytes,'BQQT_LABEL_'+opts.width+'mm_'+chosen.length+'pcs_'+stamp+'.pdf');
      status('Selesai · '+chosen.length+' label. Pilih Download PDF atau Bagikan untuk simpan ke Files.');
    } catch(e) {error('PDF belum berhasil dibuat. '+e.message);status('Ekspor gagal. File asli tetap aman; cek pesan di atas.');}
    finally{setBusy(false);}
  }
  function showCropArea() {
    const rect=$('cropRect');rect.style.left=(cropArea[0]*100)+'%';rect.style.top=(cropArea[1]*100)+'%';rect.style.width=(cropArea[2]*100)+'%';rect.style.height=(cropArea[3]*100)+'%';
  }
  async function openCrop(file) {
    if(busy)return;
    croppingFile=file;cropArea=file.crop?[...file.crop]:[0,0,1,1];
    $('cropName').textContent=file.name+' · halaman pertama';
    $('saveCrop').disabled=true;$('cropDialog').showModal();
    const token=++cropRenderToken;
    const page=await file.doc.getPage(1),viewport=page.getViewport({scale:1.3});
    const canvas=$('cropCanvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try {await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;if(token===cropRenderToken){showCropArea();$('saveCrop').disabled=false;}}
    catch(e){error('Preview crop gagal: '+file.name);$('cropDialog').close();}
  }
  function point(event) {
    const rect=$('cropCanvas').getBoundingClientRect();
    return [Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width)),Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height))];
  }
  $('cropSurface').onpointerdown=e=>{if($('saveCrop').disabled)return;dragStart=point(e);$('cropSurface').setPointerCapture(e.pointerId);};
  $('cropSurface').onpointermove=e=>{if(!dragStart)return;const end=point(e);cropArea=[Math.min(dragStart[0],end[0]),Math.min(dragStart[1],end[1]),Math.abs(end[0]-dragStart[0]),Math.abs(end[1]-dragStart[1])];showCropArea();};
  $('cropSurface').onpointerup=()=>{dragStart=null;};
  $('cropSurface').onpointercancel=()=>{dragStart=null;};
  $('resetCrop').onclick=()=>{cropArea=[0,0,1,1];showCropArea();};
  $('saveCrop').onclick=async()=>{
    if(cropArea[2]<.01||cropArea[3]<.01){alert('Area crop terlalu kecil. Tarik kotak mengelilingi label.');return;}
    croppingFile.crop=[...cropArea];$('cropDialog').close();renderFileList();await rebuild();
  };
  $('closeCrop').onclick=()=>{$('cropDialog').close();updateSummary();};
  $('files').onchange=async e=>{await addFiles(e.target.files);e.target.value='';};
  $('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!busy)$('files').click();}};
  for(const type of ['dragenter','dragover'])$('dropzone').addEventListener(type,e=>{e.preventDefault();if(!busy)$('dropzone').classList.add('drag');});
  for(const type of ['dragleave','drop'])$('dropzone').addEventListener(type,e=>{e.preventDefault();$('dropzone').classList.remove('drag');});
  $('dropzone').addEventListener('drop',e=>addFiles(e.dataTransfer.files));
  // Avoid accidental navigation if a PDF is dropped outside the upload area.
  window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
  $('clear').onclick=async()=>{if(busy)return;setBusy(true);for(const file of files)await file.doc.destroy();files.length=0;renderFileList();$('errors').replaceChildren();await rebuild(true);};
  $('layout').onchange=async()=>{renderFileList();await rebuild();if($('layout').value==='manual'){const needsCrop=files.find(f=>!f.layout&&!f.crop);if(needsCrop)await openCrop(needsCrop);}};
  $('trim').onchange=()=>rebuild();
  for(const id of ['width','margin','height'])$(id).oninput=()=>{invalidateResult();updateSummary();};
  $('heightMode').onchange=()=>{$('heightField').hidden=$('heightMode').value!=='fixed';invalidateResult();updateSummary();};
  $('selectAll').onclick=()=>{for(const label of labels)label.selected=!label.blank;invalidateResult();updateSummary();};
  $('selectNone').onclick=()=>{for(const label of labels)label.selected=false;invalidateResult();updateSummary();};
  $('download').onclick=exportPDF;
  $('example').onclick=async()=>{
    if(busy)return;setBusy(true);
    try {
      const doc=await PDFDocument.create(),page=doc.addPage([210*MM,297*MM]);
      for(let row=0;row<2;row++)for(let col=0;col<2;col++){
        const x=col*105*MM+9*MM,y=(1-row)*148.5*MM+12*MM,w=87*MM,h=124.5*MM;
        page.drawRectangle({x,y,width:w,height:h,borderColor:rgb(.1,.1,.1),borderWidth:.7});
        page.drawText('CONTOH RESI '+(row*2+col+1),{x:x+12,y:y+h-25,size:13});
        page.drawText('BQQT Store - Magelang',{x:x+12,y:y+h-49,size:10});
        page.drawText('Penerima: Buyer '+(row*2+col+1),{x:x+12,y:y+h-78,size:10});
        page.drawText('Jl. Contoh No. 88, Magelang',{x:x+12,y:y+h-95,size:9});
        page.drawText('1 kaos / size L / 0.3 kg',{x:x+12,y:y+h-128,size:10});
        for(let k=0;k<68;k++){if(k%4!==1)page.drawRectangle({x:x+12+k*3.1,y:y+48,width:k%3===0?1.1:2,height:42});}
        page.drawText('DEMO - BUKAN RESI ASLI',{x:x+12,y:y+30,size:9});
      }
      const bytes=await doc.save();setBusy(false);await addFiles([new File([bytes],'CONTOH_A4_4_LABEL.pdf',{type:'application/pdf'})]);
    } catch(e){setBusy(false);error('Contoh gagal dibuat: '+e.message);}
  };
  if(document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    const register = tool => {try {Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch(e){}};
    register({name:'get_label_summary',title:'Lihat ringkasan label',description:'Read the currently loaded files, selected label count, and paper settings. Does not access PDF contents.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({files:files.length,labels:labels.length,selected:labels.filter(l=>l.selected).length,busy,paper:settings()})});
    register({name:'configure_label_paper',title:'Atur kertas label',description:'Set the visible paper width, margin, and optional fixed height. Does not generate, download, or print a PDF.',inputSchema:{type:'object',properties:{width:{type:'number',minimum:30,maximum:220},margin:{type:'number',minimum:0,maximum:15},height:{type:['number','null'],minimum:30,maximum:500}},required:['width','margin'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:input=>{
      if(busy)throw new Error('Sedang memproses PDF.');
      const {width,margin,height=null}=input||{};
      if(typeof width!=='number'||!Number.isFinite(width)||width<30||width>220||typeof margin!=='number'||!Number.isFinite(margin)||margin<0||margin>15||width<=margin*2||height!==null&&(typeof height!=='number'||!Number.isFinite(height)||height<30||height>500||height<=margin*2))throw new Error('Ukuran kertas tidak valid.');
      $('width').value=width;$('margin').value=margin;$('heightMode').value=height===null?'auto':'fixed';if(height!==null)$('height').value=height;$('heightField').hidden=height===null;invalidateResult();updateSummary();return {paper:settings(),selected:labels.filter(l=>l.selected).length};
    }});
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }
  window.__labelToolReady=true;
  status('Siap. Tambahkan PDF ekspedisi untuk mulai.');
  updateSummary();
})();
