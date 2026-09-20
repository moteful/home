/*
 * Moteful 拼接核心计算管线（V0.5）
 * 职责：尺寸计算、画布绘制、流式拼接防崩、导出
 * 纯函数模块，零 DOM 依赖、零文案、零外部请求。
 * 单向拼接（纵向/横向）与网格拼图共用此模块。
 *
 * 所有函数接收纯数据，返回纯数据/ Promise，不修改输入对象。
 */
(function () {
  'use strict';

  /* ---------- 工具函数 ---------- */
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* ---------- 单向拼接：尺寸计算 ---------- */
  /* images: [{width, height, ...}]
   * params: {direction, gap, margin, unified, align}
   * returns: {totalWidth, totalHeight, positions:[{x,y,w,h}]}
   */
  function calcVerticalLayout(images, params) {
    var gap = params.gap || 0, margin = params.margin || 0;
    var unified = params.unified !== false;
    var align = params.align || 'center';

    var targetWidth;
    if (unified) {
      targetWidth = 0;
      images.forEach(function (img) { if (img.width > targetWidth) targetWidth = img.width; });
    }

    var drawn = images.map(function (img) {
      if (unified && targetWidth > 0) {
        var scale = targetWidth / img.width;
        return { w: targetWidth, h: Math.round(img.height * scale) };
      }
      return { w: img.width, h: img.height };
    });

    var contentWidth = unified ? targetWidth : 0;
    if (!unified) {
      drawn.forEach(function (d) { if (d.w > contentWidth) contentWidth = d.w; });
    }

    var totalHeight = 0;
    drawn.forEach(function (d) { totalHeight += d.h; });
    totalHeight += gap * (images.length - 1);

    var cursorY = margin;
    var positions = drawn.map(function (d, i) {
      var x;
      if (align === 'start') x = margin;
      else if (align === 'end') x = margin + contentWidth - d.w;
      else x = margin + (contentWidth - d.w) / 2;
      var pos = { x: Math.round(x), y: cursorY, w: d.w, h: d.h };
      cursorY += d.h + gap;
      return pos;
    });

    return {
      totalWidth: contentWidth + margin * 2,
      totalHeight: totalHeight + margin * 2,
      positions: positions
    };
  }

  function calcHorizontalLayout(images, params) {
    var gap = params.gap || 0, margin = params.margin || 0;
    var unified = params.unified !== false;
    var align = params.align || 'center';

    var targetHeight;
    if (unified) {
      targetHeight = 0;
      images.forEach(function (img) { if (img.height > targetHeight) targetHeight = img.height; });
    }

    var drawn = images.map(function (img) {
      if (unified && targetHeight > 0) {
        var scale = targetHeight / img.height;
        return { w: Math.round(img.width * scale), h: targetHeight };
      }
      return { w: img.width, h: img.height };
    });

    var contentHeight = unified ? targetHeight : 0;
    if (!unified) {
      drawn.forEach(function (d) { if (d.h > contentHeight) contentHeight = d.h; });
    }

    var totalWidth = 0;
    drawn.forEach(function (d) { totalWidth += d.w; });
    totalWidth += gap * (images.length - 1);

    var cursorX = margin;
    var positions = drawn.map(function (d, i) {
      var y;
      if (align === 'start') y = margin;
      else if (align === 'end') y = margin + contentHeight - d.h;
      else y = margin + (contentHeight - d.h) / 2;
      var pos = { x: cursorX, y: Math.round(y), w: d.w, h: d.h };
      cursorX += d.w + gap;
      return pos;
    });

    return {
      totalWidth: totalWidth + margin * 2,
      totalHeight: contentHeight + margin * 2,
      positions: positions
    };
  }

  /* ---------- 网格拼图：尺寸计算 ---------- */
  /* cells: [{index, row, col, ...}]
   * images: [{id, width, height, ...}]
   * params: {rows, cols, gap, margin, cellRatio}
   * cellRatio: '1:1'|'4:3'|'3:4'|'16:9'|'9:16'|'free'
   */
  var RATIO_MAP = {
    '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '16:9': 16 / 9, '9:16': 9 / 16
  };

  function calcGridSize(cells, images, params) {
    var rows = params.rows, cols = params.cols;
    var gap = params.gap || 0, margin = params.margin || 0;
    var ratio = RATIO_MAP[params.cellRatio] || 1;

    // 单格宽度 = 最宽图宽度（保证不放大失真），至少 800
    var cellW = 800;
    images.forEach(function (img) { if (img.width > cellW) cellW = img.width; });
    var cellH = Math.round(cellW / ratio);

    var totalWidth = cols * cellW + (cols - 1) * gap + margin * 2;
    var totalHeight = rows * cellH + (rows - 1) * gap + margin * 2;

    var positions = cells.map(function (cell) {
      return {
        index: cell.index, row: cell.row, col: cell.col,
        imageId: cell.imageId, fillMode: cell.fillMode,
        x: margin + cell.col * (cellW + gap),
        y: margin + cell.row * (cellH + gap),
        w: cellW, h: cellH
      };
    });

    return { totalWidth: totalWidth, totalHeight: totalHeight, positions: positions };
  }

  function calcGridSizeFree(cells, images, params) {
    var rows = params.rows, cols = params.cols;
    var gap = params.gap || 0, margin = params.margin || 0;

    var cellW = 800;
    images.forEach(function (img) { if (img.width > cellW) cellW = img.width; });

    // 按行计算每行高度
    var rowHeights = [];
    for (var r = 0; r < rows; r++) {
      var maxH = 0;
      for (var c = 0; c < cols; c++) {
        var cell = null;
        for (var k = 0; k < cells.length; k++) {
          if (cells[k].row === r && cells[k].col === c) { cell = cells[k]; break; }
        }
        var img = null;
        if (cell && cell.imageId) {
          for (var j = 0; j < images.length; j++) {
            if (images[j].id === cell.imageId) { img = images[j]; break; }
          }
        }
        if (img) {
          var scaledH = Math.round(img.height * (cellW / img.width));
          if (scaledH > maxH) maxH = scaledH;
        } else {
          if (cellW > maxH) maxH = cellW;
        }
      }
      rowHeights.push(maxH);
    }

    var totalWidth = cols * cellW + (cols - 1) * gap + margin * 2;
    var totalHeight = 0;
    rowHeights.forEach(function (h) { totalHeight += h; });
    totalHeight += (rows - 1) * gap + margin * 2;

    var cursorY = margin;
    var positions = [];
    for (var r2 = 0; r2 < rows; r2++) {
      for (var c2 = 0; c2 < cols; c2++) {
        var cell2 = null;
        for (var k2 = 0; k2 < cells.length; k2++) {
          if (cells[k2].row === r2 && cells[k2].col === c2) { cell2 = cells[k2]; break; }
        }
        if (cell2) {
          positions.push({
            index: cell2.index, row: r2, col: c2,
            imageId: cell2.imageId, fillMode: cell2.fillMode,
            x: margin + c2 * (cellW + gap),
            y: cursorY, w: cellW, h: rowHeights[r2]
          });
        }
      }
      cursorY += rowHeights[r2] + gap;
    }

    return { totalWidth: totalWidth, totalHeight: totalHeight, positions: positions };
  }

  /* ---------- 填充方式：计算 drawImage 参数 ---------- */
  function calcDrawRect(img, cell, fillMode) {
    var mode = fillMode || 'cover';
    if (mode === 'stretch') {
      return { sx: 0, sy: 0, sw: img.width, sh: img.height, dx: cell.x, dy: cell.y, dw: cell.w, dh: cell.h };
    }
    if (mode === 'contain') {
      var scaleC = Math.min(cell.w / img.width, cell.h / img.height);
      var dwC = Math.round(img.width * scaleC);
      var dhC = Math.round(img.height * scaleC);
      return {
        sx: 0, sy: 0, sw: img.width, sh: img.height,
        dx: cell.x + (cell.w - dwC) / 2, dy: cell.y + (cell.h - dhC) / 2,
        dw: dwC, dh: dhC
      };
    }
    // cover（默认）
    var scaleV = Math.max(cell.w / img.width, cell.h / img.height);
    var sw = Math.round(cell.w / scaleV);
    var sh = Math.round(cell.h / scaleV);
    return {
      sx: (img.width - sw) / 2, sy: (img.height - sh) / 2, sw: sw, sh: sh,
      dx: cell.x, dy: cell.y, dw: cell.w, dh: cell.h
    };
  }

  /* ---------- 绘制 ---------- */
  function drawCell(ctx, img, cell, fillMode, radius) {
    if (!img || !img.img) return;
    var rect = calcDrawRect(img, cell, fillMode);
    if (radius > 0) {
      ctx.save();
      roundRectPath(ctx, cell.x, cell.y, cell.w, cell.h, radius);
      ctx.clip();
    }
    ctx.drawImage(img.img, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
    if (radius > 0) ctx.restore();
  }

  function fillBackground(ctx, width, height, bgColor) {
    if (bgColor === 'transparent') return;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  }

  /* 单向拼接绘制（普通模式） */
  function drawStitch(canvas, images, positions, params) {
    var ctx = canvas.getContext('2d');
    fillBackground(ctx, canvas.width, canvas.height, params.bgColor);
    var radius = params.radius || 0;
    positions.forEach(function (pos, i) {
      var img = images[i];
      if (!img || !img.img) return;
      if (radius > 0) {
        ctx.save();
        roundRectPath(ctx, pos.x, pos.y, pos.w, pos.h, radius);
        ctx.clip();
      }
      ctx.drawImage(img.img, pos.x, pos.y, pos.w, pos.h);
      if (radius > 0) ctx.restore();
    });
  }

  /* 网格绘制（普通模式） */
  function drawGrid(canvas, cells, images, positions, params) {
    var ctx = canvas.getContext('2d');
    fillBackground(ctx, canvas.width, canvas.height, params.bgColor);
    var radius = params.radius || 0;
    var globalFill = params.fillMode || 'cover';
    var imgMap = {};
    images.forEach(function (img) { imgMap[img.id] = img; });
    positions.forEach(function (pos) {
      if (!pos.imageId) return;
      var img = imgMap[pos.imageId];
      if (!img) return;
      var fill = pos.fillMode || globalFill;
      drawCell(ctx, img, pos, fill, radius);
    });
  }

  /* ---------- 流式拼接防崩 ---------- */
  function shouldUseStream(images, layout) {
    if (images.length > 10) return true;
    if (layout.totalWidth > 8000 || layout.totalHeight > 8000) return true;
    return false;
  }

  function shouldUseGridStream(cells, layout) {
    if (cells.length > 16) return true;
    if (layout.totalWidth > 8000 || layout.totalHeight > 8000) return true;
    return false;
  }

  /* 单向流式：按图片分批（每批最多5张或2000px） */
  function drawStitchStream(canvas, images, positions, params, onProgress) {
    var ctx = canvas.getContext('2d');
    fillBackground(ctx, canvas.width, canvas.height, params.bgColor);
    var radius = params.radius || 0;
    var direction = params.direction || 'vertical';

    // 分批
    var batches = [];
    var currentBatch = [];
    var currentSize = 0;
    positions.forEach(function (pos, i) {
      var size = direction === 'vertical' ? pos.h : pos.w;
      if (currentBatch.length > 0 && (currentBatch.length >= 5 || currentSize + size > 2000)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentSize = 0;
      }
      currentBatch.push(i);
      currentSize += size;
    });
    if (currentBatch.length > 0) batches.push(currentBatch);

    var bi = 0;
    function nextBatch() {
      if (bi >= batches.length) {
        if (onProgress) onProgress(1);
        return Promise.resolve();
      }
      var batch = batches[bi];
      var minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
      batch.forEach(function (idx) {
        var p = positions[idx];
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + p.w > maxX) maxX = p.x + p.w;
        if (p.y + p.h > maxY) maxY = p.y + p.h;
      });
      var box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

      var tmp = document.createElement('canvas');
      tmp.width = box.w; tmp.height = box.h;
      var tctx = tmp.getContext('2d');
      batch.forEach(function (idx) {
        var pos = positions[idx];
        var img = images[idx];
        if (!img || !img.img) return;
        var shifted = { x: pos.x - box.x, y: pos.y - box.y, w: pos.w, h: pos.h };
        if (radius > 0) {
          tctx.save();
          roundRectPath(tctx, shifted.x, shifted.y, shifted.w, shifted.h, radius);
          tctx.clip();
        }
        tctx.drawImage(img.img, shifted.x, shifted.y, shifted.w, shifted.h);
        if (radius > 0) tctx.restore();
      });
      ctx.drawImage(tmp, box.x, box.y);
      tmp.width = 0; tmp.height = 0;

      bi++;
      if (onProgress) onProgress(bi / batches.length);

      // 内存护栏
      var memMB = (canvas.width * canvas.height * 4) / 1048576;
      if (memMB > 500) {
        return sleep(50).then(nextBatch);
      }
      return Promise.resolve().then(nextBatch);
    }
    return nextBatch();
  }

  /* 网格流式：按行分批 */
  function drawGridStream(canvas, cells, images, positions, params, onProgress) {
    var ctx = canvas.getContext('2d');
    fillBackground(ctx, canvas.width, canvas.height, params.bgColor);
    var radius = params.radius || 0;
    var globalFill = params.fillMode || 'cover';
    var imgMap = {};
    images.forEach(function (img) { imgMap[img.id] = img; });

    var rowsPerBatch = params.rows > 4 ? 1 : 2;
    var batches = [];
    for (var r = 0; r < params.rows; r += rowsPerBatch) {
      var batch = positions.filter(function (p) { return p.row >= r && p.row < r + rowsPerBatch; });
      if (batch.length > 0) batches.push(batch);
    }

    var bi = 0;
    function nextBatch() {
      if (bi >= batches.length) {
        if (onProgress) onProgress(1);
        return Promise.resolve();
      }
      var batch = batches[bi];
      var minY = Infinity, maxY = 0;
      batch.forEach(function (p) {
        if (p.y < minY) minY = p.y;
        if (p.y + p.h > maxY) maxY = p.y + p.h;
      });
      var box = { x: 0, y: minY, w: canvas.width, h: maxY - minY };

      var tmp = document.createElement('canvas');
      tmp.width = box.w; tmp.height = box.h;
      var tctx = tmp.getContext('2d');
      batch.forEach(function (pos) {
        if (!pos.imageId) return;
        var img = imgMap[pos.imageId];
        if (!img) return;
        var shifted = { x: pos.x, y: pos.y - box.y, w: pos.w, h: pos.h };
        var fill = pos.fillMode || globalFill;
        drawCell(tctx, img, shifted, fill, radius);
      });
      ctx.drawImage(tmp, 0, box.y);
      tmp.width = 0; tmp.height = 0;

      bi++;
      if (onProgress) onProgress(bi / batches.length);

      var memMB = (canvas.width * canvas.height * 4) / 1048576;
      if (memMB > 500) {
        return sleep(50).then(nextBatch);
      }
      return Promise.resolve().then(nextBatch);
    }
    return nextBatch();
  }

  /* ---------- 导出 ---------- */
  function exportBlob(canvas, format, quality) {
    var mime = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    var q = format === 'png' ? undefined : (quality || 92) / 100;
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('toBlob failed'));
      }, mime, q);
    });
  }

  function genFileName(prefix, format) {
    var ext = format === 'jpeg' ? '.jpg' : '.' + format;
    var d = new Date();
    var ts = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '_' +
      String(d.getHours()).padStart(2, '0') +
      String(d.getMinutes()).padStart(2, '0') +
      String(d.getSeconds()).padStart(2, '0');
    return prefix + '_' + ts + ext;
  }

  /* ---------- 暴露全局 ---------- */
  window.MFStitchCore = {
    calcVerticalLayout: calcVerticalLayout,
    calcHorizontalLayout: calcHorizontalLayout,
    calcGridSize: calcGridSize,
    calcGridSizeFree: calcGridSizeFree,
    calcDrawRect: calcDrawRect,
    drawCell: drawCell,
    drawStitch: drawStitch,
    drawGrid: drawGrid,
    drawStitchStream: drawStitchStream,
    drawGridStream: drawGridStream,
    shouldUseStream: shouldUseStream,
    shouldUseGridStream: shouldUseGridStream,
    exportBlob: exportBlob,
    genFileName: genFileName,
    fillBackground: fillBackground,
    roundRectPath: roundRectPath
  };
})();
