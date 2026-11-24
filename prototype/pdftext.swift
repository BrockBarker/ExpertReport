import Foundation
import PDFKit
let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: pdftext in.pdf out.txt"); exit(1) }
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { print("cannot open \(args[1])"); exit(2) }
var out = "===== \(args[1]) (\(doc.pageCount) pages) =====\n"
for i in 0..<doc.pageCount {
    out += "\n----- page \(i+1) -----\n"
    out += doc.page(at: i)?.string ?? ""
    out += "\n"
}
try! out.write(toFile: args[2], atomically: true, encoding: .utf8)
print("\(doc.pageCount) pages, \(out.count) chars -> \(args[2])")
