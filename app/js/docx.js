/* Expert Report: writes a Word file that Pages opens cleanly. No libraries.
 * A .docx is a zip of XML files; the zip here is written uncompressed ("stored"), which Word and Pages both accept.
 * Layout follows the user's reports: logo, short title and "Page X of Y" in the header, Helvetica body, shaded tables.
 */
(function (root) {
  'use strict';

  var enc = new TextEncoder();
  var NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  var EMU = 914400;

  function x(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }

  // ---------- zip (stored) ----------
  var crcTable = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    var parts = [], central = [], offset = 0, d = new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]), total = all.reduce(function (s, p) { return s + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    all.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  // ---------- pieces of a document ----------
  function run(text, o) {
    o = o || {};
    var rpr = (o.bold ? '<w:b/>' : '') + (o.italic ? '<w:i/>' : '') + (o.size ? '<w:sz w:val="' + Math.round(o.size * 2) + '"/><w:szCs w:val="' + Math.round(o.size * 2) + '"/>' : '') + (o.underline ? '<w:u w:val="single"/>' : '');
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + x(text) + '</w:t></w:r>';
  }
  function para(content, o) {
    o = o || {};
    var ppr = (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') + (o.keep ? '<w:keepNext/>' : '') +
      (o.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : o.num ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + o.num + '"/></w:numPr>' : '') +
      (o.after !== undefined || o.before !== undefined ? '<w:spacing' + (o.before !== undefined ? ' w:before="' + o.before + '"' : '') + (o.after !== undefined ? ' w:after="' + o.after + '"' : '') + '/>' : '') +
      (o.align ? '<w:jc w:val="' + o.align + '"/>' : '');
    return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + (content || '') + '</w:p>';
  }
  function field(code, size) {
    var rpr = '<w:rPr><w:sz w:val="' + size * 2 + '"/></w:rPr>';
    return '<w:r>' + rpr + '<w:fldChar w:fldCharType="begin"/></w:r><w:r>' + rpr + '<w:instrText xml:space="preserve"> ' + code + ' </w:instrText></w:r>' +
      '<w:r>' + rpr + '<w:fldChar w:fldCharType="separate"/></w:r><w:r>' + rpr + '<w:t>1</w:t></w:r><w:r>' + rpr + '<w:fldChar w:fldCharType="end"/></w:r>';
  }
  var picId = 10;
  function image(rid, wpx, hpx, widthIn) {
    var cx = Math.round(widthIn * EMU), cy = Math.round(cx * hpx / wpx), i = ++picId;
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + i + '" name="Picture ' + i + '"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + i + '" name="Picture ' + i + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }
  // t: { head:[..], rows:[[..]], total:[..]|null, widths:[twips..], align:['l'|'r'|'c'..], size:pt }
  function table(t) {
    var size = t.size || 9, W = t.widths, sum = W.reduce(function (s, w) { return s + w; }, 0);
    function cell(text, i, o) {
      o = o || {};
      var tcpr = '<w:tcW w:w="' + W[i] + '" w:type="dxa"/>' + (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>' : '');
      var al = (t.align && t.align[i]) || 'l';
      return '<w:tc><w:tcPr>' + tcpr + '</w:tcPr>' + para(run(text, { bold: o.bold, size: size }), { after: 0, align: o.head ? (al === 'r' ? 'right' : null) : al === 'r' ? 'right' : al === 'c' ? 'center' : null }) + '</w:tc>';
    }
    var out = '<w:tbl><w:tblPr><w:tblW w:w="' + sum + '" w:type="dxa"/><w:tblBorders>';
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach(function (s) { out += '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>'; });
    out += '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="50" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>';
    W.forEach(function (w) { out += '<w:gridCol w:w="' + w + '"/>'; });
    out += '</w:tblGrid>';
    // Pages starts a table that runs past the page on a fresh page, which would strand a heading above it.
    // A long table therefore carries its heading as a first row that repeats with the column headings.
    if (t.caption) out += '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="' + sum + '" w:type="dxa"/><w:gridSpan w:val="' + W.length + '"/>' +
      '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>' + para(run(t.caption, { bold: true, size: 12 }), { after: 60 }) + '</w:tc></w:tr>';
    out += '<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + t.head.map(function (h, i) { return cell(h, i, { shade: 'BFBFBF', bold: true, head: true }); }).join('') + '</w:tr>';
    t.rows.forEach(function (r, n) {
      var o = r._bold ? { bold: true } : {};
      if (n % 2) o.shade = 'F2F2F2';
      out += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + t.head.map(function (_, i) { return cell(r[i], i, o); }).join('') + '</w:tr>';
    });
    if (t.total) out += '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + t.head.map(function (_, i) { return cell(t.total[i], i, { bold: true }); }).join('') + '</w:tr>';
    return out + '</w:tbl>';
  }

  // blocks: {t:'title'|'h'|'p'|'small'|'bullets'|'table'|'break'|'space', ...}
  // ctx.img(key, maxWidthIn, maxHeightIn) places one of the document's images; ctx.has(key) says whether it exists.
  function body(blocks, ctx) {
    return blocks.map(function (b) {
      switch (b.t) {
        case 'rich': return para(b.runs.map(function (r) { return run(r.text, r); }).join(''), { style: b.style, bullet: b.bullet, num: b.num, align: b.align, after: b.after, keep: b.keep });
        case 'image': return para(ctx.img(b.key, b.maxW || 6.5, b.maxH || 6.2), { align: b.align || 'center', keep: true, after: 100 });
        case 'left': return para(run(b.text, { size: b.size, bold: b.bold }), { after: b.after });
        case 'sig': return para(run(b.text), { keep: true, after: 40 }) + (b.key && ctx.has(b.key) ? para(ctx.img(b.key, 2.4, 0.45), { after: 200 }) : para('', { after: 360 }));
        case 'title': return para(run(b.text, { size: 14 }), { align: 'center', after: 240 });
        case 'center': return para(run(b.text, { size: b.size || 12 }), { align: 'center', after: b.after === undefined ? 60 : b.after });
        case 'h': return para(run(b.text), { style: 'Heading1' });
        case 'p': return para(run(b.text, { bold: b.bold, italic: b.italic }), { after: b.after, keep: b.keep });
        case 'small': return para(run(b.text, { size: 9, italic: b.italic }), { after: b.after === undefined ? 120 : b.after });
        case 'bullets': return b.items.map(function (i) { return para(run(i), { bullet: true, after: 60 }); }).join('');
        case 'table': return table(b) + para('', { after: b.after === undefined ? 120 : b.after });
        case 'break': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        case 'space': return para('', { after: b.after || 120 });
        default: return '';
      }
    }).join('');
  }

  function b64ToBytes(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(b) { var s = ''; for (var i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }

  // o: { shortTitle, logo: {type:'png'|'jpg', w, h, data(base64)} | null, blocks: [...] }
  function build(o) {
    picId = 10;
    var logo = o.logo && o.logo.data ? o.logo : null, ext = logo ? (logo.type === 'jpg' || logo.type === 'jpeg' ? 'jpg' : 'png') : null;
    var media = [], images = o.images || {}, nums = [];
    o.blocks.forEach(function (b) { if (b.num && nums.indexOf(b.num) < 0) nums.push(b.num); });
    var ctx = {
      has: function (k) { return !!(images[k] && images[k].data); },
      img: function (k, maxW, maxH) {
        var im = images[k]; if (!im || !im.data || !im.w || !im.h) return '';
        var n = media.length + 1, e = im.type === 'png' ? 'png' : 'jpg';
        media.push({ rid: 'rIdM' + n, name: 'media/image' + n + '.' + e, data: im.data });
        return image('rIdM' + n, im.w, im.h, Math.min(maxW, maxH * im.w / im.h));
      }
    };
    var document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body(o.blocks, ctx) +
      '<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1900" w:right="1440" w:bottom="1300" w:left="1440" w:header="560" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>';
    var header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ' + NS + '><w:p><w:pPr><w:pStyle w:val="Header"/><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>' +
      (logo ? image('rId1', logo.w, logo.h, 1.05) : '') + '<w:r><w:tab/></w:r>' + run(o.shortTitle || '', { size: 8 }) + '<w:r><w:tab/></w:r>' + run('Page ', { size: 8 }) + field('PAGE', 8) + run(' of ', { size: 8 }) + field('NUMPAGES', 8) + '</w:p></w:hdr>';
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica" w:eastAsia="Helvetica" w:cs="Helvetica"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="180" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style></w:styles>';
    var numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="300" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="360" w:hanging="300"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      nums.map(function (n) { return '<w:num w:numId="' + n + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'; }).join('') + '</w:numbering>';
    var R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    function rels(items) { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.map(function (i) { return '<Relationship Id="' + i[0] + '" Type="' + R + '/' + i[1] + '" Target="' + i[2] + '"/>'; }).join('') + '</Relationships>'; }
    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>';
    var files = [
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rels([['rId1', 'officeDocument', 'word/document.xml']]) },
      { name: 'word/document.xml', data: document },
      { name: 'word/styles.xml', data: styles },
      { name: 'word/numbering.xml', data: numbering },
      { name: 'word/header1.xml', data: header },
      { name: 'word/_rels/document.xml.rels', data: rels([['rId1', 'styles', 'styles.xml'], ['rId2', 'numbering', 'numbering.xml'], ['rId3', 'header', 'header1.xml']].concat(media.map(function (m) { return [m.rid, 'image', m.name]; }))) },
      { name: 'word/_rels/header1.xml.rels', data: rels(logo ? [['rId1', 'image', 'media/logo.' + ext]] : []) }
    ];
    if (logo) files.push({ name: 'word/media/logo.' + ext, data: b64ToBytes(logo.data) });
    media.forEach(function (m) { files.push({ name: 'word/' + m.name, data: b64ToBytes(m.data) }); });
    return zip(files);
  }

  root.Docx = { build: build, zip: zip, crc32: crc32, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes };
})(typeof window !== 'undefined' ? window : globalThis);
