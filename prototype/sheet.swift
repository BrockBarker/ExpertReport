import Foundation
import PDFKit
import AppKit
// usage: sheet in.pdf out.jpg cols cellWidth pages   (pages like "1-4,9,12")
let a = CommandLine.arguments
guard a.count >= 6, let doc = PDFDocument(url: URL(fileURLWithPath: a[1])) else { print("usage/open error"); exit(1) }
let cols = Int(a[3])!, cellW = CGFloat(Double(a[4])!)
var pages: [Int] = []
for part in a[5].split(separator: ",") {
    if part.contains("-") { let b = part.split(separator: "-").map { Int($0)! }; pages += Array(b[0]...b[1]) } else { pages.append(Int(part)!) }
}
pages = pages.filter { $0 >= 1 && $0 <= doc.pageCount }
let cellH = (cellW * 11.0 / 8.5).rounded()
let rows = Int(ceil(Double(pages.count) / Double(cols)))
let gap: CGFloat = 10
let W = Int(CGFloat(cols) * cellW + CGFloat(cols + 1) * gap), H = Int(CGFloat(rows) * cellH + CGFloat(rows + 1) * gap)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
NSColor(white: 0.45, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill()
for (i, p) in pages.enumerated() {
    guard let page = doc.page(at: p - 1) else { continue }
    let col = i % cols, row = i / cols
    let x = gap + CGFloat(col) * (cellW + gap)
    let y = CGFloat(H) - gap - cellH - CGFloat(row) * (cellH + gap)
    let cell = NSRect(x: x, y: y, width: cellW, height: cellH)
    NSColor.white.setFill(); cell.fill()
    let b = page.bounds(for: .mediaBox)
    let s = min(cellW / b.width, cellH / b.height)
    ctx.cgContext.saveGState()
    ctx.cgContext.translateBy(x: x + (cellW - b.width * s) / 2, y: y + (cellH - b.height * s) / 2)
    ctx.cgContext.scaleBy(x: s, y: s)
    page.draw(with: .mediaBox, to: ctx.cgContext)
    ctx.cgContext.restoreGState()
}
ctx.flushGraphics()
let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82])!
try! data.write(to: URL(fileURLWithPath: a[2]))
print("wrote \(a[2]) \(W)x\(H) pages \(pages)")
