/* Moteful · compare.js · V0.4 功能一
   预览/对比模态框 + 实时对比滑块。
   独立模块，与 tool.js 通过 window.MFCompare 接口通信。
   可改文件。零外部依赖。 */
(function(){
'use strict';

var $=function(s,c){return (c||document).querySelector(s)};
var $$=function(s,c){return Array.prototype.slice.call((c||document).querySelectorAll(s))};
var on=function(el,ev,fn,opt){if(el)el.addEventListener(ev,fn,opt)};

/* ========== 状态 ========== */
var state={
  open:false,
  mode:'preview',       /* preview / compare */
  currentIndex:0,
  sliderPos:50,         /* 0-100 */
  items:[],             /* {id,name,origSize,newSize,rateText,rateClass,dim,beforeUrl,afterUrl} */
  dragging:false,
  dragStartX:0,
  dragStartPos:0,
  rafId:null,
  pendingPos:null,
  triggerEl:null
};

/* V0.4 功能二：缩放状态 */
var zoom={
  scale:1,           /* 当前缩放比例（1 = 原始像素，不是适应屏幕） */
  baseScale:1,       /* 适应屏幕时的基础比例（图片原始尺寸 → 容器尺寸的比例） */
  translateX:0,      /* 水平平移（px） */
  translateY:0,      /* 垂直平移 */
  panning:false,     /* 是否正在拖动平移 */
  panStartX:0,       /* 拖动起始指针 X */
  panStartY:0,       /* 拖动起始指针 Y */
  panStartTX:0,      /* 拖动起始 translateX */
  panStartTY:0,      /* 拖动起始 translateY */
  rafId:null,
  pendingScale:null,
  pendingTX:null,
  pendingTY:null,
  userInteracted:false  /* 用户是否操作过缩放（滚轮/按钮/双击/拖动） */
};

/* ========== DOM 引用 ========== */
var modal,mask,box,previewImg,compareArea,compareBefore,compareAfter,
    divider,handle,navPrev,navNext,infoName,infoSize,infoRate,modeBtns,
    zoomControls,zoomOut,zoomVal,zoomIn,zoomReset;

/* ========== 初始化 ========== */
function init(){
  modal=$('#previewModal');
  if(!modal)return;
  mask=modal.querySelector('.modal-mask');
  box=modal.querySelector('.modal-box');
  previewImg=modal.querySelector('#previewImg');
  compareArea=modal.querySelector('#compareArea');
  compareBefore=modal.querySelector('#compareBefore');
  compareAfter=modal.querySelector('#compareAfter');
  divider=modal.querySelector('#compareDivider');
  handle=modal.querySelector('#compareHandle');
  navPrev=modal.querySelector('#navPrev');
  navNext=modal.querySelector('#navNext');
  infoName=modal.querySelector('#infoName');
  infoSize=modal.querySelector('#infoSize');
  infoRate=modal.querySelector('#infoRate');
  modeBtns=$$('.seg-btn',modal);

  /* V0.4 功能二：缩放控件 */
  zoomControls=modal.querySelector('#zoomControls');
  zoomOut=modal.querySelector('#zoomOut');
  zoomVal=modal.querySelector('#zoomVal');
  zoomIn=modal.querySelector('#zoomIn');
  zoomReset=modal.querySelector('#zoomReset');

  /* 关闭：遮罩点击 + 关闭按钮（data-dclose） */
  $$('[data-dclose]',modal).forEach(function(el){
    on(el,'click',closeModal);
  });

  /* 模式切换 */
  modeBtns.forEach(function(btn){
    on(btn,'click',function(){
      var mode=btn.getAttribute('data-mode');
      switchMode(mode);
    });
  });

  /* 左右切换 */
  on(navPrev,'click',function(){showItem(state.currentIndex-1)});
  on(navNext,'click',function(){showItem(state.currentIndex+1)});

  /* 滑块拖动：Pointer Events 统一鼠标+触摸 */
  on(compareArea,'pointerdown',startDrag);
  on(handle,'pointerdown',function(e){e.stopPropagation();startDrag(e)});

  /* 双击复位 */
  on(compareArea,'dblclick',function(){updateSlider(50)});

  /* 键盘 */
  on(document,'keydown',onKeyDown);

  /* 防止拖动时选中文字/图片 */
  on(compareArea,'dragstart',function(e){e.preventDefault()});

  /* V0.4 功能二：缩放/平移事件 */
  /* 滚轮缩放 */
  on(previewImg,'wheel',onWheel,{passive:false});
  /* 拖动平移 */
  on(previewImg,'pointerdown',startPan);
  /* 双击切换 1:1 / 适应屏幕 */
  on(previewImg,'dblclick',onDblClick);
  /* 缩放按钮 */
  on(zoomOut,'click',function(){zoomBy(0.75)});
  on(zoomIn,'click',function(){zoomBy(1.25)});
  on(zoomReset,'click',resetZoom);
  /* 图片加载完成后 */
  on(previewImg,'load',function(){
    if(state.open&&state.mode==='preview'){
      /* 如果用户还没操作过缩放，自动适应屏幕 */
      if(!zoom.userInteracted){
        resetZoom();
      }else{
        applyZoom();
      }
    }
  });
}

/* ========== 公开 API（给 tool.js 调用） ========== */
window.MFCompare={
  open:openModal,
  close:closeModal,
  clearAll:clearAll,
  removeItem:removeItem,
  isOpen:function(){return state.open},
  onClose:null  /* 关闭时回调，用于外部释放 blob URL */
};

/* ========== 打开模态框 ========== */
function openModal(items,index,triggerEl){
  if(!items||!items.length)return;
  state.items=items;
  state.currentIndex=Math.max(0,Math.min(index||0,items.length-1));
  state.sliderPos=50;
  state.triggerEl=triggerEl||null;
  state.open=true;

  modal.hidden=false;
  modal.style.removeProperty('display');
  document.body.style.overflow='hidden';

  showItem(state.currentIndex);
  switchMode('preview');

  /* 焦点移到手柄（对比模式）或模态框（预览模式） */
  setTimeout(function(){
    if(state.mode==='compare')handle.focus();
    else box.focus();
  },50);
}

/* ========== 关闭模态框 ========== */
function closeModal(){
  if(!state.open)return;
  state.open=false;
  state.dragging=false;
  if(state.rafId){cancelAnimationFrame(state.rafId);state.rafId=null}
  /* V0.4 功能二：取消平移状态 */
  zoom.panning=false;
  if(zoom.rafId){cancelAnimationFrame(zoom.rafId);zoom.rafId=null}
  previewImg.classList.remove('panning');
  off(document,'pointermove',onPan);
  off(document,'pointerup',endPan);
  off(document,'pointercancel',endPan);
  modal.hidden=true;
  modal.style.display='none';
  document.body.style.overflow='';
  /* 焦点回到触发元素 */
  if(state.triggerEl&&state.triggerEl.focus)state.triggerEl.focus();
  /* 通知外部释放资源 */
  if(window.MFCompare.onClose){
    var cb=window.MFCompare.onClose;
    window.MFCompare.onClose=null;
    cb();
  }
}

/* ========== 模式切换 ========== */
function switchMode(mode){
  state.mode=mode;
  modeBtns.forEach(function(btn){
    var m=btn.getAttribute('data-mode');
    btn.classList.toggle('on',m===mode);
  });
  if(mode==='compare'){
    previewImg.hidden=true;
    previewImg.style.display='none';
    compareArea.hidden=false;
    compareArea.style.removeProperty('display');
    updateSlider(state.sliderPos);
    handle.focus();
    /* 对比模式隐藏缩放控件 */
    if(zoomControls)zoomControls.style.display='none';
  }else{
    compareArea.hidden=true;
    compareArea.style.display='none';
    previewImg.hidden=false;
    previewImg.style.removeProperty('display');
    /* 预览模式显示缩放控件 */
    if(zoomControls)zoomControls.style.removeProperty('display');
    applyZoom();
  }
}

/* ========== 显示某张图片 ========== */
function showItem(index){
  if(index<0||index>=state.items.length)return;
  state.currentIndex=index;
  var item=state.items[index];

  /* 预览图 */
  previewImg.src=item.afterUrl;
  previewImg.alt=item.name;

  /* 对比图 */
  compareBefore.src=item.beforeUrl;
  compareAfter.src=item.afterUrl;
  compareBefore.alt=item.name;
  compareAfter.alt=item.name;

  /* 底部信息 */
  infoName.textContent=item.name;
  /* 标注/预览等不改变尺寸的场景：newSize 缺失或与 origSize 相同时只显示一组尺寸 */
  infoSize.textContent=(item.newSize&&item.newSize!==item.origSize)
    ?(item.origSize+' → '+item.newSize)
    :(item.origSize||'');
  if(infoRate){
    infoRate.textContent=item.rateText||'';
    infoRate.className='info-rate'+(item.rateClass?' '+item.rateClass:'');
  }

  /* 左右切换按钮显隐 */
  navPrev.hidden=index<=0;
  navNext.hidden=index>=state.items.length-1;

  /* 滑块位置保持（不重置） */
  updateSlider(state.sliderPos);

  /* V0.4 功能二：切换图片时重置缩放状态 */
  resetZoom();
}

/* ========== 滑块拖动 ========== */
function startDrag(e){
  if(state.mode!=='compare')return;
  e.preventDefault();
  state.dragging=true;
  state.dragStartX=e.clientX;
  state.dragStartPos=state.sliderPos;
  handle.setPointerCapture&&handle.setPointerCapture(e.pointerId);
  compareArea.setPointerCapture&&compareArea.setPointerCapture(e.pointerId);

  /* 如果点在手柄外，直接跳到点击位置 */
  var rect=compareArea.getBoundingClientRect();
  var pos=((e.clientX-rect.left)/rect.width)*100;
  updateSlider(Math.max(0,Math.min(100,pos)));

  on(document,'pointermove',onDrag);
  on(document,'pointerup',endDrag);
  on(document,'pointercancel',endDrag);
}

function onDrag(e){
  if(!state.dragging)return;
  e.preventDefault();
  var rect=compareArea.getBoundingClientRect();
  var deltaX=e.clientX-state.dragStartX;
  var deltaPos=(deltaX/rect.width)*100;
  var pos=state.dragStartPos+deltaPos;
  state.pendingPos=Math.max(0,Math.min(100,pos));
  if(!state.rafId){
    state.rafId=requestAnimationFrame(function(){
      state.rafId=null;
      if(state.pendingPos!==null){
        updateSlider(state.pendingPos);
        state.pendingPos=null;
      }
    });
  }
}

function endDrag(){
  state.dragging=false;
  off(document,'pointermove',onDrag);
  off(document,'pointerup',endDrag);
  off(document,'pointercancel',endDrag);
}

function off(el,ev,fn){if(el)el.removeEventListener(ev,fn)}

/* ========== 更新滑块位置 ========== */
function updateSlider(pos){
  state.sliderPos=pos;
  /* 上层图（原图）用 clip-path 控制显示宽度 */
  compareBefore.style.clipPath='inset(0 '+(100-pos)+'% 0 0)';
  /* 分割线和手柄位置 */
  divider.style.left=pos+'%';
  handle.style.left=pos+'%';
  /* 无障碍属性 */
  handle.setAttribute('aria-valuenow',Math.round(pos));
}

/* ========== V0.4 功能二：缩放/平移 ========== */

/* 应用缩放状态到 DOM */
function applyZoom(){
  if(!previewImg)return;
  previewImg.style.transform='translate('+zoom.translateX+'px,'+zoom.translateY+'px) scale('+zoom.scale+')';
  var isZoomed=zoom.scale>1.001;
  previewImg.classList.toggle('zoomed',isZoomed);
  /* 更新缩放比例显示 */
  if(zoomVal){
    zoomVal.textContent=Math.round(zoom.scale*100)+'%';
  }
}

/* 以指定位置为中心缩放（clientX, clientY 是鼠标位置） */
function zoomAt(clientX,clientY,newScale){
  if(!previewImg.naturalWidth)return;
  zoom.userInteracted=true;
  var bodyRect=previewImg.parentElement.getBoundingClientRect();
  /* 鼠标相对于容器的位置 */
  var mx=clientX-bodyRect.left;
  var my=clientY-bodyRect.top;
  /* 鼠标指向的图片原始像素坐标 */
  var imgX=(mx-zoom.translateX)/zoom.scale;
  var imgY=(my-zoom.translateY)/zoom.scale;
  /* 限制缩放范围：1（占满容器）到 5（500%） */
  var minScale=1;
  var maxScale=5;
  newScale=Math.max(minScale,Math.min(maxScale,newScale));
  /* 计算新的 translate，使鼠标指向的像素保持在鼠标下方 */
  zoom.translateX=mx-imgX*newScale;
  zoom.translateY=my-imgY*newScale;
  zoom.scale=newScale;
  /* 边界限制 */
  clampTranslate();
  applyZoom();
}

/* 以容器中心为锚点按比例缩放（按钮用） */
function zoomBy(factor){
  var bodyRect=previewImg.parentElement.getBoundingClientRect();
  var cx=bodyRect.left+bodyRect.width/2;
  var cy=bodyRect.top+bodyRect.height/2;
  zoomAt(cx,cy,zoom.scale*factor);
}

/* 滚轮缩放 */
function onWheel(e){
  if(state.mode!=='preview')return;
  e.preventDefault();
  var factor=e.deltaY<0?1.15:0.87;  /* 每次 15% */
  zoomAt(e.clientX,e.clientY,zoom.scale*factor);
}

/* 开始拖动平移 */
function startPan(e){
  if(state.mode!=='preview')return;
  /* 未放大时不允许拖动 */
  if(zoom.scale<=1.001)return;
  e.preventDefault();
  zoom.userInteracted=true;
  zoom.panning=true;
  zoom.panStartX=e.clientX;
  zoom.panStartY=e.clientY;
  zoom.panStartTX=zoom.translateX;
  zoom.panStartTY=zoom.translateY;
  previewImg.classList.add('panning');
  previewImg.setPointerCapture&&previewImg.setPointerCapture(e.pointerId);
  on(document,'pointermove',onPan);
  on(document,'pointerup',endPan);
  on(document,'pointercancel',endPan);
}

/* 拖动中 */
function onPan(e){
  if(!zoom.panning)return;
  e.preventDefault();
  var deltaX=e.clientX-zoom.panStartX;
  var deltaY=e.clientY-zoom.panStartY;
  zoom.pendingTX=zoom.panStartTX+deltaX;
  zoom.pendingTY=zoom.panStartTY+deltaY;
  if(!zoom.rafId){
    zoom.rafId=requestAnimationFrame(function(){
      zoom.rafId=null;
      if(zoom.pendingTX!==null){
        zoom.translateX=zoom.pendingTX;
        zoom.translateY=zoom.pendingTY;
        clampTranslate();
        applyZoom();
        zoom.pendingTX=null;
        zoom.pendingTY=null;
      }
    });
  }
}

/* 结束拖动 */
function endPan(){
  zoom.panning=false;
  previewImg.classList.remove('panning');
  off(document,'pointermove',onPan);
  off(document,'pointerup',endPan);
  off(document,'pointercancel',endPan);
}

/* 双击切换 1:1 / 适应屏幕 */
function onDblClick(e){
  if(state.mode!=='preview')return;
  e.preventDefault();
  if(zoom.scale>zoom.baseScale+0.001){
    /* 当前已放大 → 回到适应屏幕 */
    resetZoom();
  }else{
    /* 当前适应屏幕 → 放大到 1:1，以双击位置为中心 */
    zoomAt(e.clientX,e.clientY,1);
  }
}

/* 重置到适应屏幕 */
function resetZoom(){
  zoom.scale=1;
  zoom.translateX=0;
  zoom.translateY=0;
  zoom.userInteracted=false;
  applyZoom();
}

/* 边界限制：图片边缘不超出容器 */
function clampTranslate(){
  var bodyRect=previewImg.parentElement.getBoundingClientRect();
  /* 图片元素占满容器，缩放后尺寸 = 容器尺寸 * scale */
  var imgW=bodyRect.width*zoom.scale;
  var imgH=bodyRect.height*zoom.scale;
  /* 水平方向：图片左边缘≤容器左，图片右边缘≥容器右 */
  var minTX=bodyRect.width-imgW;
  var maxTX=0;
  if(imgW<=bodyRect.width){
    zoom.translateX=(bodyRect.width-imgW)/2;
  }else{
    zoom.translateX=Math.max(minTX,Math.min(maxTX,zoom.translateX));
  }
  /* 垂直方向 */
  var minTY=bodyRect.height-imgH;
  var maxTY=0;
  if(imgH<=bodyRect.height){
    zoom.translateY=(bodyRect.height-imgH)/2;
  }else{
    zoom.translateY=Math.max(minTY,Math.min(maxTY,zoom.translateY));
  }
}

/* ========== 键盘操作 ========== */
function onKeyDown(e){
  if(!state.open)return;
  switch(e.key){
    case 'Escape':
      e.preventDefault();
      if(state.dragging){
        /* 拖动中按 ESC：取消拖动，回到起始位置 */
        updateSlider(state.dragStartPos);
        endDrag();
      }else if(zoom.panning){
        /* 平移中按 ESC：取消平移，回到起始位置 */
        zoom.translateX=zoom.panStartTX;
        zoom.translateY=zoom.panStartTY;
        endPan();
        applyZoom();
      }else{
        closeModal();
      }
      break;
    case 'ArrowLeft':
      if(state.mode==='compare'){
        e.preventDefault();
        var step=e.shiftKey?10:2;
        updateSlider(Math.max(0,state.sliderPos-step));
      }else if(e.shiftKey||e.ctrlKey||e.metaKey){
        /* 预览模式 + 修饰键：平移 */
        e.preventDefault();
        panBy(-20,0);
      }else if(!e.shiftKey){
        showItem(state.currentIndex-1);
      }
      break;
    case 'ArrowRight':
      if(state.mode==='compare'){
        e.preventDefault();
        var step2=e.shiftKey?10:2;
        updateSlider(Math.min(100,state.sliderPos+step2));
      }else if(e.shiftKey||e.ctrlKey||e.metaKey){
        e.preventDefault();
        panBy(20,0);
      }else if(!e.shiftKey){
        showItem(state.currentIndex+1);
      }
      break;
    case 'ArrowUp':
      if(state.mode==='preview'&&(e.shiftKey||e.ctrlKey||e.metaKey)){
        e.preventDefault();
        panBy(0,-20);
      }
      break;
    case 'ArrowDown':
      if(state.mode==='preview'&&(e.shiftKey||e.ctrlKey||e.metaKey)){
        e.preventDefault();
        panBy(0,20);
      }
      break;
    case 'Home':
      if(state.mode==='compare'){e.preventDefault();updateSlider(0)}
      break;
    case 'End':
      if(state.mode==='compare'){e.preventDefault();updateSlider(100)}
      break;
    case '+':
    case '=':
      if(state.mode==='preview'){e.preventDefault();zoomBy(1.25)}
      break;
    case '-':
    case '_':
      if(state.mode==='preview'){e.preventDefault();zoomBy(0.75)}
      break;
    case '0':
      if(state.mode==='preview'){e.preventDefault();resetZoom()}
      break;
    case 'Tab':
      /* 模态框内 Tab 循环 */
      if(!modal.contains(e.target)){
        e.preventDefault();
        handle.focus();
      }
      break;
  }
}

/* 键盘平移辅助 */
function panBy(dx,dy){
  if(zoom.scale<=1.001)return;
  zoom.translateX+=dx;
  zoom.translateY+=dy;
  clampTranslate();
  applyZoom();
}

/* ========== 内存管理（与 V0.3 自动清除联动） ========== */
function clearAll(){
  /* 清除所有图片数据，关闭模态框 */
  state.items.forEach(function(item){
    if(item.beforeUrl)URL.revokeObjectURL(item.beforeUrl);
    if(item.afterUrl)URL.revokeObjectURL(item.afterUrl);
  });
  state.items=[];
  if(state.open)closeModal();
}

function removeItem(id){
  /* 清除单张图片数据 */
  var idx=state.items.findIndex(function(it){return it.id===id});
  if(idx<0)return;
  var item=state.items[idx];
  if(item.beforeUrl)URL.revokeObjectURL(item.beforeUrl);
  if(item.afterUrl)URL.revokeObjectURL(item.afterUrl);
  state.items.splice(idx,1);
  if(state.open){
    if(state.items.length===0){
      closeModal();
    }else if(state.currentIndex>=state.items.length){
      showItem(state.items.length-1);
    }else if(state.currentIndex===idx){
      showItem(Math.min(idx,state.items.length-1));
    }
  }
}

/* ========== i18n 刷新（语种切换时调用） ========== */
function refreshI18n(){
  /* 模态框内 data-i18n 元素由全局 i18n 系统统一处理，这里只刷新动态内容 */
  if(state.open&&state.items.length){
    showItem(state.currentIndex);
  }
}
window.MFCompare.refreshI18n=refreshI18n;

/* ========== 启动 ========== */
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}

})();
