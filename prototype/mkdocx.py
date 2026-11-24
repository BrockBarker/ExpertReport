#!/usr/bin/env python3
"""Prototype of the app's hand-off: write a Word file in the report layout, with no third-party libraries."""
import sys, zipfile, subprocess
from xml.sax.saxutils import escape
import xml.dom.minidom

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"')
EMU = 914400

def dims(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path], capture_output=True, text=True).stdout
    w = h = 0
    for line in out.splitlines():
        if 'pixelWidth' in line: w = int(line.split()[-1])
        if 'pixelHeight' in line: h = int(line.split()[-1])
    return w, h

_id = [10]
def image(rid, path, width_in=None, height_in=None):
    w, h = dims(path)
    if width_in: cx = int(width_in * EMU); cy = int(cx * h / w)
    else: cy = int(height_in * EMU); cx = int(cy * w / h)
    _id[0] += 1; i = _id[0]
    return ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Picture %d"/>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="Picture %d"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>') % (cx, cy, i, i, i, i, rid, cx, cy)

def run(text, bold=False, size=None):
    rpr = ('<w:b/>' if bold else '') + ('<w:sz w:val="%d"/>' % int(size * 2) if size else '')
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % ('<w:rPr>%s</w:rPr>' % rpr if rpr else '', escape(text))

def para(content='', style=None, align=None, bullet=False, keep=False, after=None):
    ppr = ''
    if style: ppr += '<w:pStyle w:val="%s"/>' % style
    if keep: ppr += '<w:keepNext/>'
    if bullet: ppr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    if after is not None: ppr += '<w:spacing w:after="%d"/>' % after
    if align: ppr += '<w:jc w:val="%s"/>' % align
    return '<w:p>%s%s</w:p>' % ('<w:pPr>%s</w:pPr>' % ppr if ppr else '', content)

def text(t, **kw): return para(run(t), **kw)
def heading(t): return para(run(t), style='Heading1')
def pagebreak(): return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

def field(code, size=8):
    rpr = '<w:rPr><w:sz w:val="%d"/></w:rPr>' % (size * 2)
    return ('<w:r>%s<w:fldChar w:fldCharType="begin"/></w:r><w:r>%s<w:instrText xml:space="preserve"> %s </w:instrText></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="separate"/></w:r><w:r>%s<w:t>1</w:t></w:r><w:r>%s<w:fldChar w:fldCharType="end"/></w:r>') % (rpr, rpr, code, rpr, rpr, rpr)

def table(header, rows, widths, total=None, right=()):
    def cell(t, w, shade=None, bold=False, r=False):
        tcpr = '<w:tcW w:w="%d" w:type="dxa"/>' % w
        if shade: tcpr += '<w:shd w:val="clear" w:color="auto" w:fill="%s"/>' % shade
        return '<w:tc><w:tcPr>%s</w:tcPr>%s</w:tc>' % (tcpr, para(run(t, bold=bold, size=9), align='right' if r else None, after=0))
    out = '<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/><w:tblBorders>' % sum(widths)
    for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        out += '<w:%s w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>' % side
    out += ('</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/>'
            '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>')
    out += ''.join('<w:gridCol w:w="%d"/>' % w for w in widths) + '</w:tblGrid>'
    out += '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + ''.join(cell(h, w, shade='BFBFBF', bold=True) for h, w in zip(header, widths)) + '</w:tr>'
    for n, r_ in enumerate(rows):
        out += '<w:tr>' + ''.join(cell(c, w, shade='F2F2F2' if n % 2 else None, r=(i in right)) for i, (c, w) in enumerate(zip(r_, widths))) + '</w:tr>'
    if total:
        out += '<w:tr>' + ''.join(cell(c, w, bold=True, r=(i in right)) for i, (c, w) in enumerate(zip(total, widths))) + '</w:tr>'
    return out + '</w:tbl>' + para('')

def build(out, logo, photo, sig1, sig2):
    short = 'Sample Client Report'
    b = []
    b += [para('', after=600), para(run('Sample Client Tree Damage Report', size=14), align='center', after=400)]
    for line in ('Submitted to:', 'Mr. John Sample', '100 Example St.', 'Lafayette, Louisiana 70501'):
        b.append(para(run(line, size=13), align='center'))
    b.append(para('', after=300))
    for line in ('Submitted by:', 'Frank Thibodeaux and David Brock Barker, Consulting Arborists', 'Bob’s Tree Preservation Co.', 'P.O. Box 1884', 'Scott, LA 70583'):
        b.append(para(run(line, size=13), align='center'))
    b += [para('', after=300), para(run('Report date:', size=9)), para(run('November 12, 2026', size=9)), pagebreak()]
    for line in ('Mr. John Sample', '100 Example St.', 'Lafayette, LA 70501'): b.append(text(line))
    b += [para(''), text('Dear Mr. Sample,'),
          text('Thank you for your request for a professional evaluation of damages to trees on your property. This sample letter stands in for the transmittal letter so the layout can be checked in Pages.'),
          text('Please contact our office if you have any questions, or if we may be of further service regarding this matter.'),
          text('Respectfully submitted,'), para(''), text('Frank Thibodeaux'), para(''), text('David Brock Barker'), pagebreak()]
    b += [heading('Summary'), text('This is placeholder text in the report’s body style. It runs a few lines so that paragraph spacing, line length and justification can be compared with a finished report. Damages incurred reach a total of $20,500.'),
          heading('Qualifications'), text('Placeholder qualifications paragraph.'),
          heading('Observations')]
    for line in ('Three tree stumps along the southern boundary. (Photo 1)', 'Two trees with recent improper pruning cuts on them. (Photo 2)', 'Patches of missing grass recently damaged by heavy equipment.'):
        b.append(para(run(line), bullet=True, after=0))
    b += [para(''), heading('Determination of Appraisal Value'), text('The table below is generated by the app from the tree list.'),
          table(['Tree # and Species', 'Tree Diameter in inches', 'Replacement Cost'],
                [['Tree 1   Pecan', '17”', '$7,500'], ['Tree 2   Water oak', '24”', '$7,500'], ['Tree 3   Pecan', '8”', '$5,000']],
                [3600, 3160, 2600], total=['Total', '', '$20,000'], right=(2,)),
          heading('Conclusion'), text('Placeholder conclusion paragraph.'),
          table(['Damage', 'Cost'], [['Replacement of 3 removed trees', '$20,000'], ['Stump grinding', '$500']], [6360, 3000], total=['Total', '$20,500'], right=(1,)),
          heading('Certification of Performance'), text('We, Frank Thibodeaux and David Brock Barker, certify that:')]
    for line in ('We have personally inspected the subject trees and site referred to in this report, and have stated our findings accurately.',
                 'We have no current or prospective interest in the vegetation or the property that is the subject of this report.'):
        b.append(para(run(line), bullet=True))
    b += [para(''), para(run('Frank Thibodeaux, ISA Certified Arborist'), keep=True), para(image('rId5', sig1, height_in=0.32)),
          para(run('David Brock Barker, Louisiana Licensed Arborist'), keep=True), para(image('rId6', sig2, height_in=0.36)), pagebreak(),
          text('APPENDIX A          PHOTOS'), para(image('rId4', photo, height_in=6.2), align='center', keep=True),
          text('Photo 1: Sample caption under a portrait photo, sized the way the photo appendix pages are laid out.'), pagebreak(),
          para(image('rId4', photo, height_in=3.4) + run('   ') + image('rId4', photo, height_in=3.4), align='center', keep=True),
          text('Photos 2, 3: Two photos side by side with one caption.')]
    body = ''.join(b) + ('<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/>'
                         '<w:pgMar w:top="1900" w:right="1440" w:bottom="1300" w:left="1440" w:header="560" w:footer="600" w:gutter="0"/></w:sectPr>')
    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s</w:body></w:document>' % (NS, body)
    header = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr %s><w:p><w:pPr><w:pStyle w:val="Header"/><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>'
              '%s<w:r><w:tab/></w:r>%s<w:r><w:tab/></w:r>%s%s%s%s</w:p></w:hdr>') % (NS, image('rId1', logo, width_in=0.95), run(short, size=8), run('Page ', size=8), field('PAGE'), run(' of ', size=8), field('NUMPAGES'))
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
              '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica" w:eastAsia="Helvetica" w:cs="Helvetica"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>'
              '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="140"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>'
              '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>'
              '</w:styles>')
    numbering = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                 '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:lvlJc w:val="left"/>'
                 '<w:pPr><w:ind w:left="300" w:hanging="240"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>')
    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    rels = lambda items: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % ''.join(
        '<Relationship Id="%s" Type="%s" Target="%s"/>' % i for i in items)
    ctypes = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
              '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>'
              '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
              '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
              '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
              '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>')
    for name, x in (('document', document), ('header', header), ('styles', styles), ('numbering', numbering)):
        xml.dom.minidom.parseString(x.encode('utf-8'))  # well-formedness check
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ctypes)
        z.writestr('_rels/.rels', rels([('rId1', R + '/officeDocument', 'word/document.xml')]))
        z.writestr('word/document.xml', document)
        z.writestr('word/styles.xml', styles)
        z.writestr('word/numbering.xml', numbering)
        z.writestr('word/header1.xml', header)
        z.writestr('word/_rels/document.xml.rels', rels([('rId1', R + '/styles', 'styles.xml'), ('rId2', R + '/numbering', 'numbering.xml'), ('rId3', R + '/header', 'header1.xml'),
                                                        ('rId4', R + '/image', 'media/photo1.jpg'), ('rId5', R + '/image', 'media/sig1.png'), ('rId6', R + '/image', 'media/sig2.png')]))
        z.writestr('word/_rels/header1.xml.rels', rels([('rId1', R + '/image', 'media/logo.png')]))
        z.write(logo, 'word/media/logo.png'); z.write(photo, 'word/media/photo1.jpg'); z.write(sig1, 'word/media/sig1.png'); z.write(sig2, 'word/media/sig2.png')
    print('wrote', out)

if __name__ == '__main__':
    build(*sys.argv[1:6])
