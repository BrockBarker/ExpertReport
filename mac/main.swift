// Expert Report for Mac: a window around the web app in Resources/web, plus the native side of the "host" bridge.
// Data lives in ~/Library/Application Support/Expert Report (or EXPERT_REPORT_DATA_DIR, which the tests use).
//
//   ExpertReport                 normal launch
//   ExpertReport --selftest      exercise the file store without a window; prints JSON and exits
//   ExpertReport --uitest <dir>  load the real page, run its self-test, save result.json and snapshot.png in <dir>, exit
//   ExpertReport --makepdf <req.json>  print a page of HTML to a PDF the way "Export PDF" does (tests and the preview use this)
//   ExpertReport --aitest <req.json>   send one drafting request to the address in the file (tests only; never the real key)

import Cocoa
import WebKit
import UniformTypeIdentifiers
import ImageIO
import Security
import Speech
import AVFoundation

let fm = FileManager.default

struct HostError: Error, LocalizedError {
    let msg: String
    init(_ m: String) { msg = m }
    var errorDescription: String? { msg }
}

final class HostStore {
    let dataDir: URL
    private let safe = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{1,80}$")

    init(dataDir: URL) {
        self.dataDir = dataDir
        try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)
    }
    func name(_ v: Any?) throws -> String {
        guard let s = v as? String, safe.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil else { throw HostError("That name is not allowed.") }
        return s
    }
    func list(_ collection: String) throws -> [Any] {
        let dir = dataDir.appendingPathComponent(collection)
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return [] }
        var out: [Any] = []
        for n in names.sorted() where n.hasSuffix(".json") {
            if let d = try? Data(contentsOf: dir.appendingPathComponent(n)), let o = try? JSONSerialization.jsonObject(with: d) { out.append(o) }
        }
        return out
    }
    func put(_ collection: String, _ id: String, _ doc: Any) throws {
        guard JSONSerialization.isValidJSONObject(doc) else { throw HostError("That record could not be saved.") }
        let dir = dataDir.appendingPathComponent(collection)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: doc, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appendingPathComponent(id + ".json"), options: .atomic)
    }
    // Nothing is ever erased: a removed record moves to a "Removed" folder with the time in its name.
    func remove(_ collection: String, _ id: String) throws {
        let src = dataDir.appendingPathComponent(collection).appendingPathComponent(id + ".json")
        guard fm.fileExists(atPath: src.path) else { return }
        let dir = dataDir.appendingPathComponent("Removed").appendingPathComponent(collection)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        try fm.moveItem(at: src, to: dir.appendingPathComponent("\(id)-\(Int(Date().timeIntervalSince1970)).json"))
    }
    static func fileName(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "[/\\\\:\\x00-\\x1f]", with: "-", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        while t.hasPrefix(".") { t.removeFirst() }
        if t.isEmpty { t = "Export" }
        return String(t.prefix(120))
    }
    var exportsDir: URL { dataDir.appendingPathComponent("Exports") }
    func saveExport(_ name: String, _ data: Data) throws -> URL {
        try fm.createDirectory(at: exportsDir, withIntermediateDirectories: true)
        let url = exportsDir.appendingPathComponent(HostStore.fileName(name))
        try data.write(to: url, options: .atomic)
        return url
    }
    func isInside(_ url: URL, _ dir: URL) -> Bool {
        let a = url.standardizedFileURL.resolvingSymlinksInPath().path, b = dir.standardizedFileURL.resolvingSymlinksInPath().path
        return a == b || a.hasPrefix(b + "/")
    }
}

// A case is an ordinary folder. The app's records for it live in "Case data" inside the folder; everything else is the user's own files.
final class CaseStore {
    static let dataDir = "Case data", removedDir = "Removed files"
    static let folders = ["Photos", "Emails", "Documents", "Field notes", "Notes", "Reports"]
    static let kinds: [(String, Set<String>)] = [("image", ["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "gif", "webp", "bmp"]), ("pdf", ["pdf"]), ("email", ["eml", "emlx", "msg"]),
        ("text", ["txt", "md", "rtf"]), ("doc", ["doc", "docx", "pages"]), ("sheet", ["xls", "xlsx", "csv", "numbers"]), ("video", ["mov", "mp4", "m4v", "avi"])]
    private let safe = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{1,80}$")

    static func kind(_ name: String) -> String {
        let ext = (name as NSString).pathExtension.lowercased()
        for (k, set) in kinds where set.contains(ext) { return k }
        return "other"
    }
    static func folder(for kind: String) -> String { kind == "image" ? "Photos" : kind == "email" ? "Emails" : kind == "video" ? "Videos" : "Documents" }

    func isCase(_ url: URL) -> Bool { fm.fileExists(atPath: url.appendingPathComponent(CaseStore.dataDir).appendingPathComponent("case.json").path) }
    func caseURL(_ v: Any?) throws -> URL {
        guard let s = v as? String, !s.isEmpty else { throw HostError("No case folder was given.") }
        let u = URL(fileURLWithPath: s).standardizedFileURL.resolvingSymlinksInPath()
        guard isCase(u) else { throw HostError("That folder is not a case.") }
        return u
    }
    func inside(_ base: URL, _ rel: Any?) throws -> URL {
        guard let r = rel as? String, !r.isEmpty, !r.hasPrefix("/"), !r.split(separator: "/").contains("..") else { throw HostError("That path is not allowed.") }
        let u = base.appendingPathComponent(r).standardizedFileURL.resolvingSymlinksInPath()
        guard u.path.hasPrefix(base.path + "/") else { throw HostError("That path is outside the case folder.") }
        return u
    }
    func rel(_ url: URL, _ base: URL) -> String { String(url.standardizedFileURL.resolvingSymlinksInPath().path.dropFirst(base.path.count + 1)) }
    func name(_ v: Any?) throws -> String {
        guard let s = v as? String, safe.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil else { throw HostError("That name is not allowed.") }
        return s
    }
    func record(_ base: URL, _ n: Any?) throws -> URL { base.appendingPathComponent(CaseStore.dataDir).appendingPathComponent(try name(n) + ".json") }
    func unique(_ dir: URL, _ name: String) -> URL {
        let stem = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
        var out = dir.appendingPathComponent(name), n = 1
        while fm.fileExists(atPath: out.path) { n += 1; out = dir.appendingPathComponent(ext.isEmpty ? "\(stem) \(n)" : "\(stem) \(n).\(ext)") }
        return out
    }
    func readJSON(_ url: URL) -> Any? { (try? Data(contentsOf: url)).flatMap { try? JSONSerialization.jsonObject(with: $0) } }
    func writeJSON(_ obj: Any, _ url: URL) throws {
        guard JSONSerialization.isValidJSONObject(obj) else { throw HostError("That record could not be saved.") }
        try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
    }
    func list(root: URL) -> [Any] {
        guard let names = try? fm.contentsOfDirectory(atPath: root.path) else { return [] }
        var out: [Any] = []
        for n in names.sorted() where !n.hasPrefix(".") {
            let d = root.appendingPathComponent(n).standardizedFileURL.resolvingSymlinksInPath()
            if isCase(d), let doc = readJSON(d.appendingPathComponent(CaseStore.dataDir).appendingPathComponent("case.json")) { out.append(["path": d.path, "folder": n, "doc": doc]) }
        }
        return out
    }
    func create(root: URL, name: String, doc: Any) throws -> URL {
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let d = unique(root, HostStore.fileName(name))
        try fm.createDirectory(at: d.appendingPathComponent(CaseStore.dataDir), withIntermediateDirectories: true)
        for f in CaseStore.folders { try fm.createDirectory(at: d.appendingPathComponent(f), withIntermediateDirectories: true) }
        try writeJSON(doc, d.appendingPathComponent(CaseStore.dataDir).appendingPathComponent("case.json"))
        return d.standardizedFileURL.resolvingSymlinksInPath()
    }
    func imageInfo(_ url: URL) -> (String?, Int, Int) {
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else { return (nil, 0, 0) }
        var w = props[kCGImagePropertyPixelWidth] as? Int ?? 0, h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
        if let o = props[kCGImagePropertyOrientation] as? Int, o >= 5 { swap(&w, &h) }
        var taken: String? = nil
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any], let d = exif[kCGImagePropertyExifDateTimeOriginal] as? String, d.count >= 19 {
            let c = Array(d)   // "2025:10:29 14:03:22"
            taken = String(c[0..<4]) + "-" + String(c[5..<7]) + "-" + String(c[8..<10]) + "T" + String(c[11..<19])
        }
        return (taken, w, h)
    }
    func scan(_ base: URL) -> [Any] {
        var rows: [[String: Any]] = []
        let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
        guard let en = fm.enumerator(at: base, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) else { return [] }
        let df = DateFormatter(); df.locale = Locale(identifier: "en_US_POSIX"); df.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        for case let u as URL in en {
            let r = rel(u, base), parts = r.split(separator: "/").map(String.init)
            if parts.first == CaseStore.dataDir || parts.first == CaseStore.removedDir { en.skipDescendants(); continue }
            guard let v = try? u.resourceValues(forKeys: Set(keys)), v.isRegularFile == true else { continue }
            let k = CaseStore.kind(u.lastPathComponent)
            var e: [String: Any] = ["rel": r, "name": u.lastPathComponent, "folder": parts.count > 1 ? parts[0] : "", "size": v.fileSize ?? 0, "modified": df.string(from: v.contentModificationDate ?? Date()), "kind": k]
            if k == "image" { let i = imageInfo(u); if let t = i.0 { e["taken"] = t }; e["w"] = i.1; e["h"] = i.2 }
            rows.append(e)
        }
        return rows.sorted { ($0["rel"] as? String ?? "").localizedStandardCompare($1["rel"] as? String ?? "") == .orderedAscending }
    }
    // Copies files into the case. Originals are never moved or changed. A folder is opened up and its files copied.
    func importFiles(_ urls: [URL], into base: URL, folder: String) throws -> [String] {
        var files: [URL] = []
        for u in urls {
            var isDir: ObjCBool = false
            guard fm.fileExists(atPath: u.path, isDirectory: &isDir) else { continue }
            if isDir.boolValue && u.pathExtension.isEmpty {
                if let en = fm.enumerator(at: u, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) { for case let f as URL in en where (try? f.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true { files.append(f) } }
            } else { files.append(u) }
        }
        var added: [String] = []
        for f in files {
            let target = folder.isEmpty ? CaseStore.folder(for: CaseStore.kind(f.lastPathComponent)) : HostStore.fileName(folder)
            let dir = base.appendingPathComponent(target)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            if f.standardizedFileURL.resolvingSymlinksInPath().path.hasPrefix(base.path + "/") { continue }   // already in this case
            let out = unique(dir, f.lastPathComponent)
            try fm.copyItem(at: f, to: out)
            added.append(rel(out, base))
        }
        return added
    }
    func jpeg(_ url: URL, maxPixel: Int) throws -> [String: Any] {
        let opts: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: max(64, min(maxPixel, 4000))]
        guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { throw HostError("That image could not be read.") }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { throw HostError("That image could not be converted.") }
        CGImageDestinationAddImage(dest, img, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw HostError("That image could not be converted.") }
        return ["type": "jpg", "w": img.width, "h": img.height, "data": (out as Data).base64EncodedString()]
    }
}

// MARK: drafting with Claude

// The API key is kept in the login keychain, never in the app's files.
struct KeyStore {
    var service = "com.davidbarker.ExpertReport"
    let account = "anthropic-api-key"
    private var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    func get() -> String? {
        var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, let s = String(data: d, encoding: .utf8), !s.isEmpty else { return nil }
        return s
    }
    func set(_ key: String) throws {
        let data = Data(key.utf8)
        var st = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if st == errSecItemNotFound {
            var q = base; q[kSecValueData as String] = data; q[kSecAttrLabel as String] = "Expert Report: Claude API key"
            st = SecItemAdd(q as CFDictionary, nil)
        }
        guard st == errSecSuccess else { throw HostError("The keychain would not save the key (error \(st)).") }
    }
    func clear() { SecItemDelete(base as CFDictionary) }
}

// Server-sent events arrive in pieces of any size; this hands back each whole event as it completes.
struct SSEParser {
    private var buf = Data()
    mutating func feed(_ chunk: Data) -> [(event: String, data: String)] {
        buf.append(chunk)
        var out: [(event: String, data: String)] = []
        while true {
            let a = buf.range(of: Data("\n\n".utf8)), b = buf.range(of: Data("\r\n\r\n".utf8))
            let cut: Range<Data.Index>
            if let a = a, let b = b { cut = a.lowerBound < b.lowerBound ? a : b } else if let a = a { cut = a } else if let b = b { cut = b } else { break }
            let block = String(decoding: buf.subdata(in: buf.startIndex..<cut.lowerBound), as: UTF8.self)
            buf.removeSubrange(buf.startIndex..<cut.upperBound)
            var event = "message", lines: [String] = []
            for raw in block.split(omittingEmptySubsequences: true, whereSeparator: { $0.isNewline }) {
                let line = String(raw)
                if line.hasPrefix("event:") { event = line.dropFirst(6).trimmingCharacters(in: .whitespaces) }
                else if line.hasPrefix("data:") { var d = line.dropFirst(5); if d.hasPrefix(" ") { d = d.dropFirst() }; lines.append(String(d)) }
            }
            if !lines.isEmpty { out.append((event, lines.joined(separator: "\n"))) }
        }
        return out
    }
}

extension SSEParser { func feedAll(_ s: String) -> [(event: String, data: String)] { var p = self; return p.feed(Data(s.utf8)) } }

// What the stream adds up to: the text, why it stopped, which model wrote it and what it used.
struct DraftStream {
    var text = "", tailStart = 0, stop: String?, detail: String?, model: String?, error: String?
    var input = 0, output = 0, fellBack = false
    // The message's content blocks, rebuilt exactly as sent, so a conversation can hand them back unchanged on its next turn.
    var blocks: [Int: [String: Any]] = [:], order: [Int] = [], partial: [Int: String] = [:], invalid: [String: String] = [:]
    mutating func take(event: String, data: String) {
        guard let d = data.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        func usage(_ u: [String: Any]) {
            let i = (u["input_tokens"] as? Int ?? 0) + (u["cache_creation_input_tokens"] as? Int ?? 0) + (u["cache_read_input_tokens"] as? Int ?? 0)
            if i > 0 { input = i }
            if let n = u["output_tokens"] as? Int, n > 0 { output = n }
        }
        switch o["type"] as? String ?? event {
        case "message_start":
            if let m = o["message"] as? [String: Any] { model = m["model"] as? String ?? model; if let u = m["usage"] as? [String: Any] { usage(u) } }
        case "content_block_start":
            // A "fallback" block marks where another model took over after the first one declined. Text after the last one is the part to prefer.
            if let b = o["content_block"] as? [String: Any], b["type"] as? String == "fallback" {
                fellBack = true; tailStart = text.count
                if let to = b["to"] as? [String: Any], let m = to["model"] as? String { model = m }
            }
            if let b = o["content_block"] as? [String: Any], let i = o["index"] as? Int {
                blocks[i] = b; if !order.contains(i) { order.append(i) }
                if b["type"] as? String == "tool_use" { partial[i] = "" }
            }
        case "content_block_stop":
            // A tool's input arrives as pieces of JSON text. It is read strictly here; anything that does not parse is reported, never guessed at.
            if let i = o["index"] as? Int, let raw = partial[i], var b = blocks[i] {
                let src = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if src.isEmpty { b["input"] = [String: Any]() }
                else if let d = src.data(using: .utf8), let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] { b["input"] = obj }
                else { b["input"] = [String: Any](); invalid[b["id"] as? String ?? ""] = raw }
                blocks[i] = b; partial[i] = nil
            }
        case "content_block_delta":
            if let dl = o["delta"] as? [String: Any], dl["type"] as? String == "text_delta", let t = dl["text"] as? String { text += t }
            if let dl = o["delta"] as? [String: Any], let i = o["index"] as? Int, var b = blocks[i] {
                switch dl["type"] as? String ?? "" {
                case "text_delta": b["text"] = (b["text"] as? String ?? "") + (dl["text"] as? String ?? "")
                case "thinking_delta": b["thinking"] = (b["thinking"] as? String ?? "") + (dl["thinking"] as? String ?? "")
                case "signature_delta": b["signature"] = dl["signature"] as? String ?? ""
                case "input_json_delta": partial[i] = (partial[i] ?? "") + (dl["partial_json"] as? String ?? "")
                default: break
                }
                blocks[i] = b
            }
        case "message_delta":
            if let dl = o["delta"] as? [String: Any] {
                if let s = dl["stop_reason"] as? String { stop = s }
                if let sd = dl["stop_details"] as? [String: Any] { detail = sd["category"] as? String ?? sd["explanation"] as? String }
            }
            if let u = o["usage"] as? [String: Any] { usage(u) }
        case "error":
            error = ((o["error"] as? [String: Any])?["message"] as? String) ?? "The service reported an error."
        default: break
        }
    }
    var result: [String: Any] {
        var r: [String: Any] = ["text": text, "stop": stop ?? "", "usage": ["input_tokens": input, "output_tokens": output], "fallback": fellBack]
        if fellBack { r["tail"] = String(text.dropFirst(tailStart)) }
        r["content"] = order.sorted().compactMap { blocks[$0] }
        if !invalid.isEmpty { r["invalid"] = invalid }
        if let m = model { r["model"] = m }
        if let d = detail { r["detail"] = d }
        return r
    }
}

// One streaming request to the Messages API. Raw HTTPS, because there is no official Swift SDK.
final class AIClient: NSObject, URLSessionDataDelegate {
    static var endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    static let models: Set<String> = ["claude-opus-5-5", "claude-fable-5-2", "claude-sonnet-5-5"]
    private let key: String, body: [String: Any]
    private let progress: (Int) -> Void, completion: (Result<[String: Any], Error>) -> Void
    private let live: ((String) -> Void)?
    private var parser = SSEParser(), stream = DraftStream(), status = 0, errorBody = Data(), lastProgress = Date.distantPast
    private var withFallbacks = true, finished = false

    init(key: String, body: [String: Any], progress: @escaping (Int) -> Void, live: ((String) -> Void)? = nil, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        self.key = key; self.body = body; self.progress = progress; self.live = live; self.completion = completion
    }
    func start() { send() }
    private func send() {
        parser = SSEParser(); stream = DraftStream(); status = 0; errorBody = Data()
        var b = body
        var req = URLRequest(url: AIClient.endpoint)
        req.httpMethod = "POST"; req.timeoutInterval = 900
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2026-10-21", forHTTPHeaderField: "anthropic-version")
        // If a safety filter declines the request on the chosen model, the service retries it on another model in the same call.
        if withFallbacks { b["fallbacks"] = "default"; req.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta") }
        guard let data = try? JSONSerialization.data(withJSONObject: b) else { finish(.failure(HostError("The request could not be put together."))); return }
        req.httpBody = data
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 900; cfg.timeoutIntervalForResource = 3600
        let session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
        session.dataTask(with: req).resume()
    }
    private func finish(_ r: Result<[String: Any], Error>) { if finished { return }; finished = true; completion(r) }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if status != 200 { if errorBody.count < 200_000 { errorBody.append(data) }; return }
        for e in parser.feed(data) { stream.take(event: e.event, data: e.data) }
        if Date().timeIntervalSince(lastProgress) > (live == nil ? 0.4 : 0.12) { lastProgress = Date(); progress(stream.text.count); live?(stream.text) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        session.finishTasksAndInvalidate()
        if let e = error { finish(.failure(HostError(AIClient.explain(e)))); return }
        if status != 200 {
            let msg = AIClient.apiMessage(errorBody)
            // An account without the fallback feature rejects the header; the draft still works without it.
            if status == 400, withFallbacks, msg.contains("anthropic-beta") || msg.contains("fallbacks") { withFallbacks = false; send(); return }
            finish(.failure(HostError(AIClient.describe(status: status, message: msg)))); return
        }
        if let e = stream.error { finish(.failure(HostError("Anthropic reported a problem part way through: \(e) Nothing in the case was changed."))); return }
        guard stream.stop != nil else { finish(.failure(HostError("The connection closed before the draft was finished. Try again."))); return }
        finish(.success(stream.result))
    }
    static func apiMessage(_ body: Data) -> String {
        if let o = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any], let e = o["error"] as? [String: Any], let m = e["message"] as? String { return m }
        return String(decoding: body.prefix(300), as: UTF8.self)
    }
    static func describe(status: Int, message: String) -> String {
        let tail = message.isEmpty ? "" : " (Anthropic said: \(message))"
        switch status {
        case 401: return "Anthropic did not accept the API key. Check it in Settings." + tail
        case 403: return "This API key is not allowed to do that." + tail
        case 413: return "The case material is too large for one request. Choose fewer photos or PDFs and try again." + tail
        case 429: return "Your Anthropic account’s rate limit was reached. Wait a minute and try again." + tail
        case 500...599: return "Anthropic’s service is having trouble or is busy right now. Try again in a few minutes." + tail
        default: return message.isEmpty ? "Anthropic refused the request (error \(status))." : "Anthropic refused the request: \(message)"
        }
    }
    static func explain(_ e: Error) -> String {
        let n = e as NSError
        if n.domain == NSURLErrorDomain {
            switch n.code {
            case NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed: return "Could not reach Anthropic. Check that this Mac is connected to the internet and try again."
            case NSURLErrorTimedOut: return "Anthropic took too long to answer. Try again."
            case NSURLErrorCancelled: return "The draft was cancelled."
            default: break
            }
        }
        return "The request did not go through: \(e.localizedDescription)"
    }
}

// MARK: speaking to the assistant

// Turns speech into text for the assistant's text box. The microphone is open only between start and stop.
// Where this Mac can transcribe speech by itself, nothing that is said leaves it.
final class Dictation {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?, task: SFSpeechRecognitionTask?, recognizer: SFSpeechRecognizer?, quiet: Timer?
    private(set) var running = false
    private var heard = "", closed = true
    var onUpdate: ((String, Bool) -> Void)?      // the words so far, and whether listening has ended
    var onError: ((String) -> Void)?

    func start(words: [String], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        if running { completion(.success(["ok": true])); return }
        SFSpeechRecognizer.requestAuthorization { st in DispatchQueue.main.async {
            guard st == .authorized else { completion(.failure(HostError("Speech recognition is not allowed for Expert Report. Turn it on in System Settings, under Privacy & Security, Speech Recognition."))); return }
            AVCaptureDevice.requestAccess(for: .audio) { ok in DispatchQueue.main.async {
                guard ok else { completion(.failure(HostError("The microphone is not allowed for Expert Report. Turn it on in System Settings, under Privacy & Security, Microphone."))); return }
                do { completion(.success(try self.begin(words))) } catch { self.shut(); completion(.failure(error)) }
            } }
        } }
    }
    private func begin(_ words: [String]) throws -> [String: Any] {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: "en-US")) ?? SFSpeechRecognizer(), r.isAvailable else { throw HostError("Speech recognition is not available on this Mac right now.") }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        let onDevice = r.supportsOnDeviceRecognition
        if onDevice { req.requiresOnDeviceRecognition = true }
        req.addsPunctuation = true
        req.contextualStrings = Array(words.prefix(90))      // tree names and trade terms, so they are heard correctly
        let input = engine.inputNode, fmt = input.outputFormat(forBus: 0)
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else { throw HostError("No microphone was found.") }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak req] buffer, _ in req?.append(buffer) }
        engine.prepare()
        try engine.start()
        recognizer = r; request = req; running = true; closed = false; heard = ""
        task = r.recognitionTask(with: req) { [weak self] result, error in DispatchQueue.main.async {
            guard let self = self, !self.closed else { return }
            if let res = result {
                self.heard = res.bestTranscription.formattedString
                if res.isFinal { self.finish() } else { self.onUpdate?(self.heard, false); if self.running { self.wait(3.0) } }
            } else if error != nil {
                if self.heard.isEmpty && self.running { self.shut(); self.onError?("Nothing was heard. Click the microphone and try again.") } else { self.finish() }
            }
        } }
        wait(9.0)      // with nothing said at all, listening ends by itself
        return ["ok": true, "onDevice": onDevice]
    }
    // Listening ends after a pause in speech, or when the user clicks the button again.
    private func wait(_ seconds: TimeInterval) { quiet?.invalidate(); quiet = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in self?.stop() } }
    func stop() {
        guard running else { return }
        running = false; quiet?.invalidate()
        engine.stop(); engine.inputNode.removeTap(onBus: 0); request?.endAudio()
        // The last words usually arrive a moment after the audio ends. If they do not, what was heard so far stands.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in self?.finish() }
    }
    private func finish() { if closed { return }; let text = heard; shut(); onUpdate?(text, true) }
    private func shut() {
        closed = true; running = false; quiet?.invalidate(); quiet = nil
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        task?.cancel(); task = nil; request = nil
    }
}

// MARK: the report as a PDF

// Prints a page of HTML to Letter paper, then stamps the logo, short title and "Page X of Y" at the top of every page, as the Pages layout has them.
final class PDFMaker: NSObject, WKNavigationDelegate {
    private static var live: [PDFMaker] = []
    private let out: URL, title: String, logo: Data?, completion: (Result<Int, Error>) -> Void
    private let tmp = fm.temporaryDirectory.appendingPathComponent("expert-report-pdf-\(UUID().uuidString)")
    private var web: WKWebView!, win: NSWindow!, finished = false
    private(set) var planned = 0          // pages the page itself laid out; the printed count should match
    static var lastPlanned = 0

    static func make(html: String, to out: URL, title: String, logo: Data?, completion: @escaping (Result<Int, Error>) -> Void) {
        let m = PDFMaker(out: out, title: title, logo: logo, completion: completion)
        live.append(m); m.start(html)
    }
    private init(out: URL, title: String, logo: Data?, completion: @escaping (Result<Int, Error>) -> Void) { self.out = out; self.title = title; self.logo = logo; self.completion = completion }
    private func finish(_ r: Result<Int, Error>) {
        if finished { return }; finished = true
        PDFMaker.lastPlanned = planned
        web?.navigationDelegate = nil; win?.orderOut(nil)
        try? fm.removeItem(at: tmp)
        PDFMaker.live.removeAll { $0 === self }
        completion(r)
    }
    private func start(_ html: String) {
        do {
            try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
            let page = tmp.appendingPathComponent("report.html")
            try Data(html.utf8).write(to: page)
            let cfg = WKWebViewConfiguration()
            if #available(macOS 13.3, *) { cfg.preferences.shouldPrintBackgrounds = true }
            let frame = NSRect(x: 0, y: 0, width: 624, height: 883)   // the printable area of the page, in CSS pixels
            web = WKWebView(frame: frame, configuration: cfg)
            web.navigationDelegate = self
            win = NSWindow(contentRect: frame.offsetBy(dx: -8000, dy: -8000), styleMask: [.borderless], backing: .buffered, defer: false)
            win.isReleasedWhenClosed = false
            win.contentView = web
            web.loadFileURL(page, allowingReadAccessTo: tmp)
            DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in self?.finish(.failure(HostError("Making the PDF took too long. Try again."))) }
        } catch { finish(.failure(error)) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finish(.failure(error)) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Wait until every photo is decoded, or the first pages can print with empty frames.
        // The page then cuts itself into pages (see "paginate" in casereport.js); the print engine only has to follow the breaks.
        webView.callAsyncJavaScript("await Promise.all(Array.from(document.images).map(i => i.decode().catch(() => 0))); return window.__paginate ? window.__paginate() : 0", arguments: [:], in: nil, in: .page) { [weak self] r in
            if case .success(let v) = r, let n = v as? Int { self?.planned = n }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self?.printNow() }
        }
    }
    private func printNow() {
        if finished { return }
        let raw = tmp.appendingPathComponent("raw.pdf")
        let info = NSPrintInfo(dictionary: [.jobDisposition: NSPrintInfo.JobDisposition.save, .jobSavingURL: raw])
        info.paperSize = NSSize(width: 612, height: 792); info.orientation = .portrait
        info.topMargin = 95; info.bottomMargin = 65; info.leftMargin = 72; info.rightMargin = 72
        info.horizontalPagination = .fit; info.verticalPagination = .automatic
        info.isHorizontallyCentered = false; info.isVerticallyCentered = false
        let op = web.printOperation(with: info)
        op.showsPrintPanel = false; op.showsProgressPanel = false
        op.view?.frame = NSRect(x: 0, y: 0, width: 612, height: 792)
        op.runModal(for: win, delegate: self, didRun: #selector(printed(_:success:contextInfo:)), contextInfo: nil)
    }
    @objc private func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        // The print job reports back on its own thread; everything after this belongs on the main one.
        DispatchQueue.main.async {
            let raw = self.tmp.appendingPathComponent("raw.pdf")
            guard success, fm.fileExists(atPath: raw.path) else { self.finish(.failure(HostError("The PDF could not be made."))); return }
            do { self.finish(.success(try self.stamp(raw))) } catch { self.finish(.failure(error)) }
        }
    }
    private func stamp(_ raw: URL) throws -> Int {
        guard let doc = CGPDFDocument(raw as CFURL), doc.numberOfPages > 0 else { throw HostError("The PDF could not be read back.") }
        let n = doc.numberOfPages, staged = tmp.appendingPathComponent("stamped.pdf")
        var box = CGRect(x: 0, y: 0, width: 612, height: 792)
        guard let ctx = CGContext(staged as CFURL, mediaBox: &box, [kCGPDFContextTitle: title, kCGPDFContextCreator: "Expert Report"] as CFDictionary) else { throw HostError("The PDF could not be written.") }
        let image = logo.flatMap { NSImage(data: $0) }
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont(name: "Helvetica", size: 8) ?? NSFont.systemFont(ofSize: 8), .foregroundColor: NSColor.black]
        for i in 1...n {
            guard let page = doc.page(at: i) else { continue }
            var mb = page.getBoxRect(.mediaBox)
            ctx.beginPage(mediaBox: &mb)
            ctx.drawPDFPage(page)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: ctx, flipped: false)
            var baseline = mb.maxY - 46
            if let img = image, img.size.width > 0 {
                let w: CGFloat = 75.6, h = w * img.size.height / img.size.width   // 1.05 in wide, as in the Pages layout
                img.draw(in: NSRect(x: mb.minX + 72, y: mb.maxY - 28 - h, width: w, height: h))
                baseline = mb.maxY - 28 - h
            }
            let t = title as NSString, ts = t.size(withAttributes: attrs)
            t.draw(at: NSPoint(x: mb.midX - ts.width / 2, y: baseline), withAttributes: attrs)
            let pn = "Page \(i) of \(n)" as NSString, ps = pn.size(withAttributes: attrs)
            pn.draw(at: NSPoint(x: mb.maxX - 72 - ps.width, y: baseline), withAttributes: attrs)
            NSGraphicsContext.restoreGraphicsState()
            ctx.endPage()
        }
        ctx.closePDF()
        try fm.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fm.fileExists(atPath: out.path) { _ = try fm.replaceItemAt(out, withItemAt: staged) } else { try fm.moveItem(at: staged, to: out) }
        return n
    }
}

// The assistant in a window of its own, so it can sit beside the main window or on another screen instead of covering the work.
// The main page stays in charge: it sends this window what to draw, and whatever is clicked or typed here is passed back to it.
final class AssistantWindow: NSObject, WKScriptMessageHandler, NSWindowDelegate {
    private var panel: NSPanel?
    private var view: WKWebView?
    private var silent = false
    weak var main: WKWebView?
    weak var owner: NSWindow?
    var quiet = false   // tests: the window is made, but off screen and never brought forward
    var isOpen: Bool { panel != nil }
    var state: [String: Any] { ["open": panel != nil, "floating": panel?.isFloatingPanel ?? false, "canType": panel?.canBecomeKey ?? false, "following": timer != nil, "grabX": Double(grabX), "x": Double(target.x), "top": Double(target.y + (panel?.frame.height ?? 0))] }
    // Dragged out of the main window: the new window stays under the pointer, held by its title bar, until the mouse button is let go.
    var mouse: () -> NSPoint = { NSEvent.mouseLocation }
    var held: () -> Bool = { NSEvent.pressedMouseButtons & 1 == 1 }
    private var timer: Timer?
    private var grabX: CGFloat = 0
    private var target = NSPoint.zero   // where the pointer puts the window; in tests the window itself stays off screen
    private func underPointer(_ p: NSPanel) { let m = mouse(); target = NSPoint(x: m.x - grabX, y: m.y + 14 - p.frame.height); if !quiet { p.setFrameOrigin(target) } }
    private func follow() {
        timer?.invalidate()
        let t = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] t in
            guard let self = self, let p = self.panel, self.held() else { t.invalidate(); self?.timer = nil; return }
            self.underPointer(p)
        }
        RunLoop.main.add(t, forMode: .common); timer = t
    }
    // Where the window goes the first time: beside the main window where there is room, otherwise against the right edge of its screen.
    static func firstOrigin(size: NSSize, main mf: NSRect, visible vf: NSRect) -> NSPoint {
        NSPoint(x: max(vf.minX, min(mf.maxX + 12, vf.maxX - size.width - 12)), y: max(vf.minY + 12, min(mf.maxY, vf.maxY) - size.height))
    }

    private func toMain(_ m: Any) {
        guard JSONSerialization.isValidJSONObject([m]), let d = try? JSONSerialization.data(withJSONObject: [m]), let s = String(data: d, encoding: .utf8) else { return }
        main?.evaluateJavaScript("window.__agentRemote && window.__agentRemote(\(s)[0])")
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if let m = message.body as? [String: Any] { toMain(m) }
    }
    // grab: where on the panel the pointer was holding it when it was dragged out of the main window (nil when a button opened it).
    func open(grab: NSPoint? = nil) throws {
        if let p = panel { if !quiet { p.makeKeyAndOrderFront(nil) }; return }
        guard let webDir = Bundle.main.resourceURL?.appendingPathComponent("web"), fm.fileExists(atPath: webDir.appendingPathComponent("assistant.html").path) else { throw HostError("The assistant window's files are missing. Rebuild the app with mac/build.sh.") }
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "panel")
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let size = NSSize(width: 440, height: 660)
        let w = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: cfg)
        w.autoresizingMask = [.width, .height]
        let p = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        p.title = "Assistant"
        p.minSize = NSSize(width: 320, height: 380)
        p.isReleasedWhenClosed = false
        p.isFloatingPanel = true          // stays above the main window, so a click on the work does not bury it
        p.hidesOnDeactivate = true        // and steps aside while another app is in front
        p.collectionBehavior = [.fullScreenAuxiliary]
        p.contentView = w
        p.delegate = self
        if quiet {
            p.setFrameOrigin(NSPoint(x: -4000, y: -4000)); p.orderBack(nil)
            if grab != nil { var pts = [NSPoint(x: -3000, y: -3000), NSPoint(x: -2900, y: -2950)]   // a made-up pointer, far off screen: one move, then let go
                mouse = { pts[0] }; held = { if pts.count > 1 { pts.removeFirst(); return true }; return false } }
        } else {
            // After the first time it opens wherever it was left (and at the size it was left).
            let had = p.setFrameUsingName("ExpertReportAssistant")
            p.setFrameAutosaveName("ExpertReportAssistant")
            if grab == nil && !had {
                let vf = (owner?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
                p.setFrameOrigin(AssistantWindow.firstOrigin(size: p.frame.size, main: owner?.frame ?? vf, visible: vf))
            }
        }
        panel = p; view = w
        if let g = grab {
            grabX = max(24, min(g.x * (main?.pageZoom ?? 1), p.frame.width - 60))
            underPointer(p); follow()
        }
        if !quiet { p.makeKeyAndOrderFront(nil) }
        w.loadFileURL(webDir.appendingPathComponent("assistant.html"), allowingReadAccessTo: webDir)
    }
    func post(_ m: [String: Any]) {
        guard let v = view, JSONSerialization.isValidJSONObject([m]), let d = try? JSONSerialization.data(withJSONObject: [m]), let s = String(data: d, encoding: .utf8) else { return }
        v.evaluateJavaScript("window.__panel && window.__panel(\(s)[0])")
    }
    func front() { if !quiet { panel?.makeKeyAndOrderFront(nil) } }
    // tell: report the closing to the main page, as when the user clicks the window's close button.
    func close(tell: Bool = false) { silent = !tell; panel?.close(); silent = false }
    func windowWillClose(_ notification: Notification) {
        timer?.invalidate(); timer = nil
        view?.configuration.userContentController.removeScriptMessageHandler(forName: "panel")
        view = nil; panel?.delegate = nil; panel = nil
        if !silent { toMain(["t": "closed"]) }
    }
}

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    let store: HostStore
    let cases = CaseStore()
    var dropTarget: (URL, String)?   // the open case and the folder in it that dropped files should go to
    weak var window: NSWindow?
    var quiet = false   // tests: never show panels or open other apps
    var pasteboard = NSPasteboard.general   // tests use a private one so the user's clipboard is left alone
    var keys = KeyStore()
    lazy var dictation: Dictation = {
        let d = Dictation()
        func tell(_ o: [String: Any]) { if let j = try? JSONSerialization.data(withJSONObject: o), let s = String(data: j, encoding: .utf8) { self.web?.evaluateJavaScript("window.__voice && window.__voice(\(s))") } }
        d.onUpdate = { text, done in tell(["text": text, "done": done]) }
        d.onError = { msg in tell(["error": msg, "done": true]) }
        return d
    }()
    weak var web: WKWebView?
    let assistant = AssistantWindow()
    private var drafting = false
    init(store: HostStore) { self.store = store }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let method = body["method"] as? String else { replyHandler(["error": "Unreadable request."], nil); return }
        let p = body["params"] as? [String: Any] ?? [:]
        // Two requests take a while and answer later: a draft from Claude, and printing the report to a PDF.
        func later(_ r: Result<[String: Any], Error>) {
            switch r {
            case .success(let v): replyHandler(["result": v], nil)
            case .failure(let e): replyHandler(["error": e.localizedDescription], nil)
            }
        }
        if method == "ai" || method == "aiTurn" { draft(p, completion: later); return }
        if method == "exportPDF" { exportPDF(p, completion: later); return }
        if method == "voiceStart" {
            if quiet { later(.failure(HostError("Voice input is switched off while the app is being tested."))); return }
            dictation.start(words: p["words"] as? [String] ?? [], completion: later); return
        }
        do { replyHandler(["result": try handle(method, p) ?? NSNull()], nil) }
        catch { replyHandler(["error": error.localizedDescription], nil) }
    }

    // Turns the page's request into the body the Messages API takes. Photos and PDFs are named by their place in the case and read here,
    // so the page can only ever attach files that are inside the open case folder.
    func draftBody(_ p: [String: Any]) throws -> [String: Any] {
        let base = try cases.caseURL(p["path"])
        guard let model = p["model"] as? String, AIClient.models.contains(model) else { throw HostError("That is not a model this app uses.") }
        guard let system = p["system"] as? String, !system.isEmpty, let blocks = p["content"] as? [[String: Any]], !blocks.isEmpty, let schema = p["schema"] as? [String: Any] else { throw HostError("The drafting request was incomplete.") }
        var content: [[String: Any]] = [], bytes = 0
        for b in blocks {
            switch b["type"] as? String ?? "" {
            case "text":
                let t = b["text"] as? String ?? ""; bytes += t.utf8.count
                content.append(["type": "text", "text": t])
            case "case_image":
                let j = try cases.jpeg(try cases.inside(base, b["rel"]), maxPixel: b["max"] as? Int ?? 1200), d = j["data"] as? String ?? ""
                bytes += d.utf8.count
                content.append(["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": d]])
            case "case_pdf":
                let u = try cases.inside(base, b["rel"])
                guard CaseStore.kind(u.lastPathComponent) == "pdf" else { throw HostError("Only PDFs can be attached as documents.") }
                let d = try Data(contentsOf: u).base64EncodedString(); bytes += d.utf8.count
                content.append(["type": "document", "source": ["type": "base64", "media_type": "application/pdf", "data": d]])
            default: throw HostError("The drafting request had a part the app does not understand.")
            }
        }
        guard bytes < 30_000_000 else { throw HostError("This case material comes to about \(bytes / 1_000_000) MB, more than one request can carry (32 MB). Choose fewer photos for the report, or untick some PDFs as reviewed, and try again.") }
        let effort = ["low", "medium", "high"].contains(p["effort"] as? String ?? "") ? p["effort"] as? String ?? "high" : "high"
        return ["model": model, "max_tokens": min(max(p["maxTokens"] as? Int ?? 64000, 1024), 128000), "stream": true, "system": system,
                "output_config": ["effort": effort, "format": ["type": "json_schema", "schema": schema]], "messages": [["role": "user", "content": content]]]
    }
    // One turn of the assistant's conversation: the whole history so far and the tools it may ask the page to run.
    // Pictures are named by their place in the open case and read here, as for a draft.
    func turnBody(_ p: [String: Any]) throws -> [String: Any] {
        let base = try? cases.caseURL(p["path"])
        guard let model = p["model"] as? String, AIClient.models.contains(model) else { throw HostError("That is not a model this app uses.") }
        guard let system = p["system"] as? String, !system.isEmpty, let messages = p["messages"] as? [[String: Any]], !messages.isEmpty else { throw HostError("The request was incomplete.") }
        var bytes = 0
        func fix(_ b: [String: Any]) throws -> [String: Any] {
            if b["type"] as? String == "case_image" {
                guard let base = base else { throw HostError("No case is open, so there is no picture to look at.") }
                let j = try cases.jpeg(try cases.inside(base, b["rel"]), maxPixel: b["max"] as? Int ?? 1600), d = j["data"] as? String ?? ""
                bytes += d.utf8.count
                return ["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": d]]
            }
            if b["type"] as? String == "tool_result", let inner = b["content"] as? [[String: Any]] { var c = b; c["content"] = try inner.map(fix); return c }
            return b
        }
        let fixed: [[String: Any]] = try messages.map { m in
            guard let role = m["role"] as? String, role == "user" || role == "assistant" else { throw HostError("The conversation had a part the app does not understand.") }
            if let s = m["content"] as? String { bytes += s.utf8.count; return ["role": role, "content": s] }
            guard let blocks = m["content"] as? [[String: Any]] else { throw HostError("The conversation had a part the app does not understand.") }
            return ["role": role, "content": try blocks.map(fix)]
        }
        guard bytes < 28_000_000 else { throw HostError("This conversation now carries more pictures than one request can hold. Start a new conversation.") }
        let effort = ["low", "medium", "high"].contains(p["effort"] as? String ?? "") ? p["effort"] as? String ?? "medium" : "medium"
        var body: [String: Any] = ["model": model, "max_tokens": min(max(p["maxTokens"] as? Int ?? 16000, 1024), 64000), "stream": true, "system": system,
                                   "output_config": ["effort": effort], "messages": fixed, "cache_control": ["type": "ephemeral"]]
        if let tools = p["tools"] as? [[String: Any]], !tools.isEmpty { body["tools"] = tools }
        guard JSONSerialization.isValidJSONObject(body) else { throw HostError("The conversation could not be put together.") }
        return body
    }
    func draft(_ p: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard !drafting else { completion(.failure(HostError("A draft is already being written. Wait for it to finish."))); return }
        guard let key = keys.get() else { completion(.failure(HostError("Add your Claude API key in Settings first."))); return }
        drafting = true
        // Reading and shrinking the photos can take a few seconds, so it happens off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            let built = Result { p["messages"] != nil ? try self.turnBody(p) : try self.draftBody(p) }
            DispatchQueue.main.async {
                switch built {
                case .failure(let e): self.drafting = false; completion(.failure(e))
                case .success(let body):
                    AIClient(key: key, body: body, progress: { [weak self] n in self?.web?.evaluateJavaScript("window.__aiProgress && window.__aiProgress(\(n))") }, live: p["messages"] == nil ? nil : { [weak self] t in
                        if let d = try? JSONSerialization.data(withJSONObject: [t]), let s = String(data: d, encoding: .utf8) { self?.web?.evaluateJavaScript("window.__aiLive && window.__aiLive(\(s)[0])") }
                    }, completion: { r in self.drafting = false; completion(r) }).start()
                }
            }
        }
    }
    func exportPDF(_ p: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        do {
            let base = try cases.caseURL(p["path"]), dir = base.appendingPathComponent("Reports")
            guard let html = p["html"] as? String, !html.isEmpty else { throw HostError("There is nothing to export.") }
            var name = HostStore.fileName(p["name"] as? String ?? "Report.pdf")
            if !name.lowercased().hasSuffix(".pdf") { name += ".pdf" }
            let out = dir.appendingPathComponent(name)
            let logo = ((p["logo"] as? [String: Any])?["data"] as? String).flatMap { Data(base64Encoded: $0) }
            PDFMaker.make(html: html, to: out, title: p["title"] as? String ?? "", logo: logo) { r in
                switch r {
                case .failure(let e): completion(.failure(e))
                case .success(let pages):
                    if !self.quiet { NSWorkspace.shared.open(out) }
                    completion(.success(["path": out.path, "rel": self.cases.rel(out, base), "pages": pages, "planned": PDFMaker.lastPlanned]))
                }
            }
        } catch { completion(.failure(error)) }
    }

    func data(_ p: [String: Any]) throws -> Data {
        guard let s = p["data"] as? String, let d = Data(base64Encoded: s) else { throw HostError("The file contents did not arrive.") }
        return d
    }

    func handle(_ method: String, _ p: [String: Any]) throws -> Any? {
        switch method {
        case "info":
            return ["mode": "app", "dataDir": store.dataDir.path, "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"]
        case "list":
            return try store.list(try store.name(p["collection"]))
        case "put":
            guard let doc = p["doc"] else { throw HostError("Nothing to save.") }
            try store.put(try store.name(p["collection"]), try store.name(p["id"]), doc)
            return true
        case "remove":
            try store.remove(try store.name(p["collection"]), try store.name(p["id"]))
            return true
        case "saveExport":
            let url = try store.saveExport(p["name"] as? String ?? "Export", try data(p))
            return ["path": url.path]
        case "openInPages":
            guard let path = p["path"] as? String else { throw HostError("No file to open.") }
            let url = URL(fileURLWithPath: path)
            let parent = url.deletingLastPathComponent()
            let inCase = parent.lastPathComponent == "Reports" && cases.isCase(parent.deletingLastPathComponent())
            guard store.isInside(url, store.exportsDir) || inCase, fm.fileExists(atPath: url.path) else { throw HostError("That file is not one of this app's exports.") }
            if quiet { return ["ok": true, "path": path] }
            if let pages = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.iWork.Pages") {
                NSWorkspace.shared.open([url], withApplicationAt: pages, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
                return ["ok": true, "path": path]
            }
            NSWorkspace.shared.open(url)
            return ["ok": true, "path": path, "note": "Pages was not found, so the file was opened with its default app."]
        case "saveAs":
            let d = try data(p), name = HostStore.fileName(p["name"] as? String ?? "Export")
            if quiet { let u = try store.saveExport(name, d); return ["path": u.path] }
            let panel = NSSavePanel()
            panel.nameFieldStringValue = name
            panel.canCreateDirectories = true
            guard panel.runModal() == .OK, let url = panel.url else { return NSNull() }
            try d.write(to: url, options: .atomic)
            return ["path": url.path]
        case "reveal":
            guard let path = p["path"] as? String else { return false }
            let url = URL(fileURLWithPath: path)
            guard store.isInside(url, store.dataDir) else { return false }
            if !quiet { NSWorkspace.shared.activateFileViewerSelecting([url]) }
            return true
        case "copy":
            let html = p["html"] as? String ?? "", text = p["text"] as? String ?? ""
            let pb = pasteboard
            pb.clearContents()
            var types: [NSPasteboard.PasteboardType] = [.string]
            if !html.isEmpty { types.insert(.html, at: 0) }
            pb.declareTypes(types, owner: nil)
            if !html.isEmpty {
                pb.setString(html, forType: .html)
                // Pages takes a table most reliably from rich text, so offer that too.
                if let hd = html.data(using: .utf8), let attr = NSAttributedString(html: hd, options: [.characterEncoding: String.Encoding.utf8.rawValue], documentAttributes: nil),
                   let rtf = attr.rtf(from: NSRange(location: 0, length: attr.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtf]) {
                    pb.addTypes([.rtf], owner: nil)
                    pb.setData(rtf, forType: .rtf)
                }
            }
            pb.setString(text, forType: .string)
            return true
        case "pickImage":
            if quiet { return NSNull() }
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [.png, .jpeg]
            panel.allowsMultipleSelection = false
            guard panel.runModal() == .OK, let url = panel.url, let img = NSImage(contentsOf: url), let rep0 = img.representations.first else { return NSNull() }
            // Keep the logo small: it is embedded in every export.
            let pw = max(rep0.pixelsWide, 1), ph = max(rep0.pixelsHigh, 1), w = min(pw, 600), h = Int((Double(ph) * Double(w) / Double(pw)).rounded())
            guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return NSNull() }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            img.draw(in: NSRect(x: 0, y: 0, width: w, height: h))
            NSGraphicsContext.restoreGraphicsState()
            guard let png = rep.representation(using: .png, properties: [:]) else { return NSNull() }
            return ["type": "png", "w": w, "h": h, "data": png.base64EncodedString()]
        case "chooseFolder":
            if quiet {
                guard let dir = ProcessInfo.processInfo.environment["EXPERT_REPORT_CASES_DIR"] else { return NSNull() }
                try fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
                return ["path": dir]
            }
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true; panel.allowsMultipleSelection = false
            panel.message = p["prompt"] as? String ?? "Choose a folder"; panel.prompt = "Choose"
            guard panel.runModal() == .OK, let url = panel.url else { return NSNull() }
            return ["path": url.path]
        case "setDropTarget":
            if let u = try? cases.caseURL(p["path"]) { dropTarget = (u, p["folder"] as? String ?? "") } else { dropTarget = nil }
            return true
        case "caseList":
            guard let root = p["root"] as? String, !root.isEmpty else { throw HostError("No cases folder was given.") }
            return cases.list(root: URL(fileURLWithPath: root))
        case "caseCreate":
            guard let root = p["root"] as? String, !root.isEmpty, let doc = p["doc"] else { throw HostError("Nothing to create.") }
            let d = try cases.create(root: URL(fileURLWithPath: root), name: p["name"] as? String ?? "Case", doc: doc)
            return ["path": d.path, "folder": d.lastPathComponent]
        case "caseGet":
            return cases.readJSON(try cases.record(try cases.caseURL(p["path"]), p["name"])) ?? NSNull()
        case "casePut":
            guard let doc = p["doc"] else { throw HostError("Nothing to save.") }
            try cases.writeJSON(doc, try cases.record(try cases.caseURL(p["path"]), p["name"]))
            return true
        case "caseRemove":
            let base = try cases.caseURL(p["path"]), src = try cases.record(base, p["name"])
            if fm.fileExists(atPath: src.path) {
                let dir = base.appendingPathComponent(CaseStore.dataDir).appendingPathComponent("Removed")
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                try fm.moveItem(at: src, to: dir.appendingPathComponent("\(try cases.name(p["name"]))-\(Int(Date().timeIntervalSince1970)).json"))
            }
            return true
        case "caseNames":
            let base = try cases.caseURL(p["path"]), pre = p["prefix"] as? String ?? ""
            let names = (try? fm.contentsOfDirectory(atPath: base.appendingPathComponent(CaseStore.dataDir).path)) ?? []
            return names.filter { $0.hasSuffix(".json") && $0.hasPrefix(pre) }.map { String($0.dropLast(5)) }.sorted()
        case "caseScan":
            return cases.scan(try cases.caseURL(p["path"]))
        case "caseAddFiles":
            let base = try cases.caseURL(p["path"]), folder = p["folder"] as? String ?? ""
            var urls: [URL] = []
            if quiet {
                if let dir = ProcessInfo.processInfo.environment["EXPERT_REPORT_TEST_FILES"] { urls = [URL(fileURLWithPath: dir)] }
            } else {
                let panel = NSOpenPanel()
                panel.canChooseFiles = true; panel.canChooseDirectories = true; panel.allowsMultipleSelection = true
                panel.message = "Choose files to copy into this case"; panel.prompt = "Add"
                guard panel.runModal() == .OK else { return [] as [String] }
                urls = panel.urls
            }
            return try cases.importFiles(urls, into: base, folder: folder)
        case "caseUpload":
            let base = try cases.caseURL(p["path"]), n = HostStore.fileName(p["name"] as? String ?? "File"), folder = p["folder"] as? String ?? ""
            let dir = base.appendingPathComponent(folder.isEmpty ? CaseStore.folder(for: CaseStore.kind(n)) : HostStore.fileName(folder))
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let out = cases.unique(dir, n)
            try data(p).write(to: out, options: .atomic)
            return ["rel": cases.rel(out, base)]
        case "caseWriteText":
            let base = try cases.caseURL(p["path"]), u = try cases.inside(base, p["rel"])
            guard CaseStore.kind(u.lastPathComponent) == "text" else { throw HostError("Only text notes can be written.") }
            try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            try (p["text"] as? String ?? "").write(to: u, atomically: true, encoding: .utf8)
            return true
        case "caseReadText":
            let base = try cases.caseURL(p["path"]), u = try cases.inside(base, p["rel"])
            let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size <= 2_000_000 else { throw HostError("That file is too large to show here. Open it instead.") }
            let d = try Data(contentsOf: u)
            return String(data: d, encoding: .utf8) ?? String(decoding: d, as: UTF8.self)
        case "caseThumb", "caseImage":
            let base = try cases.caseURL(p["path"]), u = try cases.inside(base, p["rel"])
            return try cases.jpeg(u, maxPixel: p["max"] as? Int ?? (method == "caseThumb" ? 360 : 1600))
        case "caseOpen":
            let base = try cases.caseURL(p["path"])
            let u = (p["rel"] as? String).map { $0.isEmpty ? base : (try? cases.inside(base, $0)) ?? base } ?? base
            if !quiet { NSWorkspace.shared.open(u) }
            return true
        case "caseTrash":
            let base = try cases.caseURL(p["path"]), u = try cases.inside(base, p["rel"])
            let dir = base.appendingPathComponent(CaseStore.removedDir)
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            try fm.moveItem(at: u, to: cases.unique(dir, u.lastPathComponent))
            return true
        case "caseRename":
            let base = try cases.caseURL(p["path"]), u = try cases.inside(base, p["rel"])
            let out = cases.unique(u.deletingLastPathComponent(), HostStore.fileName(p["name"] as? String ?? u.lastPathComponent))
            try fm.moveItem(at: u, to: out)
            return ["rel": cases.rel(out, base)]
        case "voiceStop":
            if !quiet { dictation.stop() }
            return true
        case "agentWindow":
            assistant.main = web; assistant.owner = window; assistant.quiet = quiet
            switch p["op"] as? String ?? "" {
            case "open":
                let g = p["grab"] as? [String: Any]
                try assistant.open(grab: g.flatMap { d in (d["x"] as? Double).map { NSPoint(x: $0, y: d["y"] as? Double ?? 0) } })
            case "close": assistant.close(tell: p["tell"] as? Bool ?? false)
            case "post": if let m = p["msg"] as? [String: Any] { assistant.post(m) }
            case "front": assistant.front()
            case "main": if !quiet { window?.makeKeyAndOrderFront(nil) }
            case "state": break
            default: throw HostError("Unknown request for the assistant window.")
            }
            return assistant.state
        case "aiKeyStatus":
            return ["set": keys.get() != nil, "mock": false]
        case "aiKeySet":
            let k = (p["key"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard k.count >= 20, k.count < 400, k.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { throw HostError("That does not look like an API key. Copy the whole key from the Anthropic Console and paste it again.") }
            try keys.set(k)
            return true
        case "aiKeyClear":
            keys.clear()
            return true
        case "caseSaveReport":
            let base = try cases.caseURL(p["path"]), dir = base.appendingPathComponent("Reports")
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let out = dir.appendingPathComponent(HostStore.fileName(p["name"] as? String ?? "Report.docx"))
            try data(p).write(to: out, options: .atomic)
            return ["path": out.path, "rel": cases.rel(out, base)]
        default:
            throw HostError("Unknown request: \(method)")
        }
    }
}

// Accepts files dragged from Finder, and items other apps hand over on request (a message dragged from Mail, a picture from Photos).
final class DropWebView: WKWebView {
    var canDrop: (() -> Bool)?
    var onFiles: (([URL]) -> Void)?
    private func urls(_ s: NSDraggingInfo) -> [URL] { (s.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? [] }
    private func promises(_ s: NSDraggingInfo) -> [NSFilePromiseReceiver] { (s.draggingPasteboard.readObjects(forClasses: [NSFilePromiseReceiver.self], options: nil) as? [NSFilePromiseReceiver]) ?? [] }
    private func wants(_ s: NSDraggingInfo) -> Bool { (canDrop?() ?? false) && (!urls(s).isEmpty || !promises(s).isEmpty) }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { wants(sender) ? .copy : super.draggingEntered(sender) }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { wants(sender) ? .copy : super.draggingUpdated(sender) }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard wants(sender) else { return super.performDragOperation(sender) }
        let u = urls(sender)
        if !u.isEmpty { onFiles?(u); return true }
        let tmp = fm.temporaryDirectory.appendingPathComponent("expert-report-drop-\(UUID().uuidString)")
        try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        for p in promises(sender) { p.receivePromisedFiles(atDestination: tmp, options: [:], operationQueue: .main) { [weak self] url, error in if error == nil { self?.onFiles?([url]) } } }
        return true
    }
}

// Stands in for a real drag in the UI test, so the drop code runs exactly as it would for a file dragged from Finder.
final class FakeDrag: NSObject, NSDraggingInfo {
    let pb: NSPasteboard
    weak var win: NSWindow?
    init(pasteboard: NSPasteboard, window: NSWindow?) { pb = pasteboard; win = window }
    var draggingDestinationWindow: NSWindow? { win }
    var draggingSourceOperationMask: NSDragOperation { .copy }
    var draggingLocation: NSPoint { NSPoint(x: 200, y: 200) }
    var draggedImageLocation: NSPoint { NSPoint(x: 200, y: 200) }
    var draggedImage: NSImage? { nil }
    var draggingPasteboard: NSPasteboard { pb }
    var draggingSource: Any? { nil }
    var draggingSequenceNumber: Int { 1 }
    func slideDraggedImage(to screenPoint: NSPoint) {}
    override func namesOfPromisedFilesDropped(atDestination dropDestination: URL) -> [String]? { nil }
    var draggingFormation: NSDraggingFormation = .default
    var animatesToDestination: Bool = false
    var numberOfValidItemsForDrop: Int = 1
    func enumerateDraggingItems(options enumOpts: NSDraggingItemEnumerationOptions = [], for view: NSView?, classes classArray: [AnyClass], searchOptions: [NSPasteboard.ReadingOptionKey: Any] = [:], using block: @escaping (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void) {}
    var springLoadingHighlight: NSSpringLoadingHighlight { .none }
    func resetSpringLoading() {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: DropWebView!
    var bridge: Bridge!
    var uitestDir: URL?
    var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let env = ProcessInfo.processInfo.environment
        let dataDir = env["EXPERT_REPORT_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Expert Report")
        bridge = Bridge(store: HostStore(dataDir: dataDir))
        bridge.quiet = uitestDir != nil
        if bridge.quiet { bridge.keys.service = "com.davidbarker.ExpertReport.test" }   // tests never see the real key

        let cfg = WKWebViewConfiguration()
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "host")
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = DropWebView(frame: NSRect(x: 0, y: 0, width: 1360, height: 880), configuration: cfg)
        web.registerForDraggedTypes([.fileURL] + NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) })
        web.canDrop = { [weak self] in self?.bridge.dropTarget != nil }
        web.onFiles = { [weak self] urls in
            guard let self = self, let t = self.bridge.dropTarget else { return }
            let added = (try? self.bridge.cases.importFiles(urls, into: t.0, folder: t.1)) ?? []
            self.web.evaluateJavaScript("window.__caseFilesChanged && window.__caseFilesChanged(\(added.count))")
        }
        web.navigationDelegate = self
        web.autoresizingMask = [.width, .height]
        bridge.web = web

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 880), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Expert Report"
        window.minSize = NSSize(width: 1040, height: 640)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("ExpertReportMain")
        window.isReleasedWhenClosed = false
        bridge.window = window
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in self?.bridge.assistant.close() }
        buildMenu()

        guard let webDir = Bundle.main.resourceURL?.appendingPathComponent("web"), fm.fileExists(atPath: webDir.appendingPathComponent("index.html").path) else {
            let a = NSAlert(); a.messageText = "Expert Report is missing its files."; a.informativeText = "Rebuild the app with mac/build.sh."; a.runModal(); NSApp.terminate(nil); return
        }
        web.loadFileURL(webDir.appendingPathComponent("index.html"), allowingReadAccessTo: webDir)
        if uitestDir == nil { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
        else { window.setFrameOrigin(NSPoint(x: -4000, y: -4000)); window.orderBack(nil) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        bridge.assistant.close()   // a reloaded page starts with the assistant inside the main window again
        guard let dir = uitestDir else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.web.callAsyncJavaScript("return await window.__selfTest()", arguments: [:], in: nil, in: .page) { result in
                var out: [String: Any] = [:]
                switch result {
                case .success(let v): out["result"] = v
                case .failure(let e): out["error"] = "\(e)"
                }
                // Drop a file on the window the way Finder would, and see that a copy lands in the open case.
                if let t = self.bridge.dropTarget {
                    let src = fm.temporaryDirectory.appendingPathComponent("expert-report-droptest-\(ProcessInfo.processInfo.processIdentifier)")
                    try? fm.createDirectory(at: src, withIntermediateDirectories: true)
                    let f = src.appendingPathComponent("Dropped note.txt")
                    try? Data("dropped".utf8).write(to: f)
                    let pb = NSPasteboard.withUniqueName()
                    pb.clearContents(); pb.writeObjects([f as NSURL])
                    let drag = FakeDrag(pasteboard: pb, window: self.window)
                    let entered = self.web.draggingEntered(drag) == .copy
                    let performed = self.web.performDragOperation(drag)
                    out["dropTest"] = ["entered": entered, "performed": performed, "landed": fm.fileExists(atPath: t.0.appendingPathComponent("Documents/Dropped note.txt").path), "originalKept": fm.fileExists(atPath: f.path)]
                    pb.releaseGlobally()
                } else { out["dropTest"] = ["skipped": "no case was open"] }
                try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
                if let d = try? JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys]) { try? d.write(to: dir.appendingPathComponent("result.json")) }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    self.web.takeSnapshot(with: nil) { image, _ in
                        if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) { try? png.write(to: dir.appendingPathComponent("snapshot.png")) }
                        exit(out["error"] == nil ? 0 : 1)
                    }
                }
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // Let the page finish writing any edit that is still waiting to be saved.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting || web == nil { return .terminateNow }
        quitting = true
        var replied = false
        let done = { if !replied { replied = true; NSApp.reply(toApplicationShouldTerminate: true) } }
        web.callAsyncJavaScript("if (window.__app) await window.__app.flush(); return true", arguments: [:], in: nil, in: .page) { _ in done() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { done() }
        return .terminateLater
    }

    @objc func newAppraisal(_ sender: Any?) { web.evaluateJavaScript("(function(){var h=document.querySelector('.brand');if(h)h.click();setTimeout(function(){var b=document.querySelector('[data-act=new]');if(b)b.click();},60);})()") }
    @objc func reloadPage(_ sender: Any?) { web.reload() }
    @objc func zoomIn(_ sender: Any?) { web.pageZoom = min(web.pageZoom + 0.1, 2.0) }
    @objc func zoomOut(_ sender: Any?) { web.pageZoom = max(web.pageZoom - 0.1, 0.6) }
    @objc func zoomReset(_ sender: Any?) { web.pageZoom = 1.0 }
    @objc func showData(_ sender: Any?) { NSWorkspace.shared.activateFileViewerSelecting([bridge.store.dataDir]) }

    func buildMenu() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) { let m = NSMenu(title: title); items.forEach { m.addItem($0) }; let i = NSMenuItem(); i.submenu = m; main.addItem(i) }
        func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem { let i = NSMenuItem(title: title, action: action, keyEquivalent: key); i.keyEquivalentModifierMask = mods; return i }
        add("Expert Report", [item("About Expert Report", #selector(NSApplication.orderFrontStandardAboutPanel(_:))), .separator(), item("Show Data in Finder", #selector(showData(_:))), .separator(),
                               item("Hide Expert Report", #selector(NSApplication.hide(_:)), "h"), item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]), item("Show All", #selector(NSApplication.unhideAllApplications(_:))), .separator(),
                               item("Quit Expert Report", #selector(NSApplication.terminate(_:)), "q")])
        add("File", [item("New Appraisal", #selector(newAppraisal(_:)), "n"), .separator(), item("Close Window", #selector(NSWindow.performClose(_:)), "w")])
        add("Edit", [item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(), item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"),
                     item("Paste", #selector(NSText.paste(_:)), "v"), item("Select All", #selector(NSText.selectAll(_:)), "a")])
        add("View", [item("Actual Size", #selector(zoomReset(_:)), "0"), item("Zoom In", #selector(zoomIn(_:)), "+"), item("Zoom Out", #selector(zoomOut(_:)), "-"), .separator(), item("Reload", #selector(reloadPage(_:)), "r")])
        let win = NSMenu(title: "Window"); win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")); win.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        let wi = NSMenuItem(); wi.submenu = win; main.addItem(wi)
        NSApp.mainMenu = main; NSApp.windowsMenu = win
    }
}

// MARK: entry point
let args = CommandLine.arguments
if args.contains("--selftest") {
    let dir = fm.temporaryDirectory.appendingPathComponent("expert-report-selftest-\(ProcessInfo.processInfo.processIdentifier)")
    let store = HostStore(dataDir: dir), bridge = Bridge(store: store)
    bridge.quiet = true
    var report: [String: Any] = [:]
    do {
        _ = try bridge.handle("put", ["collection": "appraisals", "id": "a1", "doc": ["id": "a1", "title": "Test", "trees": [["size": "17"]]]])
        _ = try bridge.handle("put", ["collection": "appraisals", "id": "a2", "doc": ["id": "a2"]])
        let list1 = try bridge.handle("list", ["collection": "appraisals"]) as? [Any] ?? []
        report["listAfterPut"] = list1.count
        _ = try bridge.handle("remove", ["collection": "appraisals", "id": "a2"])
        report["listAfterRemove"] = (try bridge.handle("list", ["collection": "appraisals"]) as? [Any] ?? []).count
        report["removedKept"] = ((try? fm.contentsOfDirectory(atPath: dir.appendingPathComponent("Removed/appraisals").path)) ?? []).count
        let exp = try bridge.handle("saveExport", ["name": "A/B: test.docx", "data": Data("hello".utf8).base64EncodedString()]) as? [String: Any]
        report["exportName"] = URL(fileURLWithPath: exp?["path"] as? String ?? "").lastPathComponent
        report["openInsideExports"] = (try? bridge.handle("openInPages", ["path": exp?["path"] as? String ?? ""])) != nil
        report["openOutsideRefused"] = (try? bridge.handle("openInPages", ["path": "/etc/hosts"])) == nil
        report["badNameRefused"] = (try? bridge.handle("put", ["collection": "../x", "id": "a", "doc": [:] as [String: Any]])) == nil
        report["badIdRefused"] = (try? bridge.handle("list", ["collection": "a/b"])) == nil
        report["info"] = (try bridge.handle("info", [:]) as? [String: Any])?["mode"] ?? ""
        let pb = NSPasteboard.withUniqueName(); bridge.pasteboard = pb
        let html = "<table style=\"border-collapse:collapse\"><thead><tr><th style=\"border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica;background:#bfbfbf;font-weight:bold;text-align:left\">Tree</th><th style=\"border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica;background:#bfbfbf;font-weight:bold;text-align:right\">Appraised value</th></tr></thead><tbody><tr><td style=\"border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica\">1</td><td style=\"border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica;text-align:right\">$23,300</td></tr><tr><td style=\"border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica\">2</td><td style=\"border:1px solid #a6a6a6;padding:3px 6px;font:9pt Helvetica;text-align:right\">$940</td></tr></tbody></table>"
        _ = try bridge.handle("copy", ["html": html, "text": "Tree\tAppraised value\n1\t$23,300\n2\t$940"])
        report["copyTypes"] = (pb.types ?? []).map { $0.rawValue }
        let rtf = pb.data(forType: .rtf)
        report["copyRtfHasTable"] = rtf.flatMap { String(data: $0, encoding: .ascii) }?.contains("\\trowd") ?? false
        if let out = ProcessInfo.processInfo.environment["SELFTEST_RTF_OUT"], let rtf = rtf { try? rtf.write(to: URL(fileURLWithPath: out)) }
        pb.releaseGlobally()
        // cases: a real folder with the app's records inside it
        let root = dir.appendingPathComponent("Cases")
        let made = try bridge.handle("caseCreate", ["root": root.path, "name": "Test: case/1", "doc": ["id": "c1", "name": "Test"]]) as? [String: Any]
        let cpath = made?["path"] as? String ?? ""
        report["caseFolder"] = made?["folder"] ?? ""
        report["caseSubfolders"] = CaseStore.folders.allSatisfy { fm.fileExists(atPath: cpath + "/" + $0) }
        report["caseListed"] = (try bridge.handle("caseList", ["root": root.path]) as? [Any] ?? []).count
        _ = try bridge.handle("casePut", ["path": cpath, "name": "appraisal-a1", "doc": ["id": "a1"]])
        report["caseNames"] = try bridge.handle("caseNames", ["path": cpath, "prefix": "appraisal-"]) ?? []
        report["caseGet"] = ((try bridge.handle("caseGet", ["path": cpath, "name": "appraisal-a1"])) as? [String: Any])?["id"] ?? ""
        let src = dir.appendingPathComponent("incoming"); try fm.createDirectory(at: src, withIntermediateDirectories: true)
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 80, pixelsHigh: 40, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        try rep.representation(using: .png, properties: [:])!.write(to: src.appendingPathComponent("photo.png"))
        try Data("From: a@example.com\n\nhello".utf8).write(to: src.appendingPathComponent("mail.eml"))
        report["imported"] = try bridge.cases.importFiles([src], into: try bridge.cases.caseURL(cpath), folder: "").sorted()
        report["originalsKept"] = fm.fileExists(atPath: src.appendingPathComponent("photo.png").path)
        let scan = try bridge.handle("caseScan", ["path": cpath]) as? [[String: Any]] ?? []
        report["scanKinds"] = scan.map { "\($0["rel"] ?? ""):\($0["kind"] ?? "")" }
        let th = try bridge.handle("caseThumb", ["path": cpath, "rel": "Photos/photo.png", "max": 64]) as? [String: Any]
        report["thumb"] = "\(th?["w"] ?? 0)x\(th?["h"] ?? 0)"
        _ = try bridge.handle("caseWriteText", ["path": cpath, "rel": "Notes/Call.txt", "text": "note text"])
        report["noteRead"] = try bridge.handle("caseReadText", ["path": cpath, "rel": "Notes/Call.txt"]) ?? ""
        report["renamed"] = (try bridge.handle("caseRename", ["path": cpath, "rel": "Notes/Call.txt", "name": "Call with counsel.txt"]) as? [String: Any])?["rel"] ?? ""
        report["escapeRefused"] = (try? bridge.handle("caseReadText", ["path": cpath, "rel": "../../etc/hosts"])) == nil
        report["writeNonTextRefused"] = (try? bridge.handle("caseWriteText", ["path": cpath, "rel": "Notes/x.sh", "text": "x"])) == nil
        report["nonCaseRefused"] = (try? bridge.handle("caseScan", ["path": dir.path])) == nil
        _ = try bridge.handle("caseTrash", ["path": cpath, "rel": "Emails/mail.eml"])
        report["trashKept"] = fm.fileExists(atPath: cpath + "/Removed files/mail.eml") && !fm.fileExists(atPath: cpath + "/Emails/mail.eml")
        let rp = try bridge.handle("caseSaveReport", ["path": cpath, "name": "Report.docx", "data": Data("x".utf8).base64EncodedString()]) as? [String: Any]
        report["reportOpens"] = (try? bridge.handle("openInPages", ["path": rp?["path"] as? String ?? ""])) != nil
        let casesOK = report["caseFolder"] as? String == "Test- case-1" && report["caseSubfolders"] as? Bool == true && report["caseListed"] as? Int == 1 && report["caseGet"] as? String == "a1"
            && (report["imported"] as? [String] ?? []) == ["Emails/mail.eml", "Photos/photo.png"] && report["originalsKept"] as? Bool == true && report["thumb"] as? String == "64x32"
            && report["noteRead"] as? String == "note text" && report["renamed"] as? String == "Notes/Call with counsel.txt" && report["escapeRefused"] as? Bool == true
            && report["writeNonTextRefused"] as? Bool == true && report["nonCaseRefused"] as? Bool == true && report["trashKept"] as? Bool == true && report["reportOpens"] as? Bool == true
        report["casesOK"] = casesOK

        // drafting: the stream reader, fed in awkward pieces
        let sse = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-opus-5-5\",\"usage\":{\"input_tokens\":1200,\"cache_read_input_tokens\":300,\"output_tokens\":1}}}\n\nevent: ping\ndata: {\"type\":\"ping\"}\n\n"
            + "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"not part of the answer\"}}\n\n"
            + "event: content_block_delta\r\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"{\\\"letter\\\":\\\"Caf\u{00e9} \"}}\r\n\r\n"
            + "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"oak\\\"}\"}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":420}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        var parser = SSEParser(), stream = DraftStream(), events = 0
        let bytes = [UInt8](sse.utf8)
        var at = 0
        while at < bytes.count { let n = min(7, bytes.count - at); for e in parser.feed(Data(bytes[at..<at + n])) { stream.take(event: e.event, data: e.data); events += 1 }; at += n }
        report["sseEvents"] = events
        report["sseText"] = stream.text
        report["sseStop"] = stream.stop ?? ""
        report["sseUsage"] = "\(stream.input)/\(stream.output)"
        var refused = DraftStream()
        for e in SSEParser().feedAll("data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-fable-5-2\"}}\n\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"partial\"}}\n\ndata: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"fallback\",\"from\":{\"model\":\"claude-fable-5-2\"},\"to\":{\"model\":\"claude-opus-4-8\"}}}\n\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"{}\"}}\n\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"refusal\",\"stop_details\":{\"category\":\"bio\"}}}\n\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n") { refused.take(event: e.event, data: e.data) }
        report["sseRefusal"] = "\(refused.stop ?? "")/\(refused.detail ?? "")/\(refused.result["tail"] as? String ?? "")/\(refused.model ?? "")/\(refused.error ?? "")"
        // drafting: the request the app would send, built from files in the test case
        try Data("%PDF-1.4 test".utf8).write(to: URL(fileURLWithPath: cpath + "/Documents/Estimate.pdf"))
        let ask: [String: Any] = ["path": cpath, "model": "claude-opus-5-5", "effort": "high", "maxTokens": 64000, "system": "sys", "schema": ["type": "object"],
            "content": [["type": "text", "text": "facts"], ["type": "case_pdf", "rel": "Documents/Estimate.pdf"], ["type": "case_image", "rel": "Photos/photo.png", "max": 64], ["type": "text", "text": "go"]]]
        let body = try bridge.draftBody(ask)
        let msg = ((body["messages"] as? [[String: Any]])?.first?["content"] as? [[String: Any]]) ?? []
        let blockKinds = msg.map { ($0["source"] as? [String: Any])?["media_type"] as? String ?? $0["type"] as? String ?? "" }
        report["draftBlocks"] = blockKinds
        let fmtType = ((body["output_config"] as? [String: Any])?["format"] as? [String: Any])?["type"] as? String ?? ""
        report["draftShape"] = "\(body["model"] ?? "")/\(body["max_tokens"] ?? "")/\(body["stream"] ?? "")/\(fmtType)/\(body["thinking"] == nil)/\(body["temperature"] == nil)/\(JSONSerialization.isValidJSONObject(body))"
        func refuses(_ change: (inout [String: Any]) -> Void) -> Bool { var a = ask; change(&a); return (try? bridge.draftBody(a)) == nil }
        report["draftRefusals"] = [refuses { $0["model"] = "gpt-x" }, refuses { $0["content"] = [["type": "case_image", "rel": "../../etc/hosts"]] }, refuses { $0["content"] = [["type": "case_pdf", "rel": "Photos/photo.png"]] },
                                   refuses { $0["content"] = [["type": "image", "source": ["type": "url", "url": "http://x"]]] }, refuses { $0["path"] = dir.path }]
        report["errorWording"] = AIClient.describe(status: 401, message: "invalid x-api-key").hasPrefix("Anthropic did not accept the API key") && AIClient.apiMessage(Data("{\"type\":\"error\",\"error\":{\"type\":\"x\",\"message\":\"boom\"}}".utf8)) == "boom"
        // the key: saved under a name only this test uses, read back, replaced, removed
        var ks = KeyStore(); ks.service = "com.davidbarker.ExpertReport.selftest-\(ProcessInfo.processInfo.processIdentifier)"
        bridge.keys = ks
        let k0 = (try bridge.handle("aiKeyStatus", [:]) as? [String: Any])?["set"] as? Bool
        report["keyShortRefused"] = (try? bridge.handle("aiKeySet", ["key": "short"])) == nil
        _ = try bridge.handle("aiKeySet", ["key": "  test-key-000000000000000000000001\n"])
        let k1 = ks.get()
        _ = try bridge.handle("aiKeySet", ["key": "test-key-000000000000000000000002"])
        let k2 = ks.get()
        _ = try bridge.handle("aiKeyClear", [:])
        report["keychain"] = "\(k0 == false)/\(k1 == "test-key-000000000000000000000001")/\(k2 == "test-key-000000000000000000000002")/\(ks.get() == nil)"
        let draftOK = report["sseEvents"] as? Int == 8 && report["sseText"] as? String == "{\"letter\":\"Caf\u{00e9} oak\"}" && report["sseStop"] as? String == "end_turn" && report["sseUsage"] as? String == "1500/420"
            && report["sseRefusal"] as? String == "refusal/bio/{}/claude-opus-4-8/Overloaded" && blockKinds == ["text", "application/pdf", "image/jpeg", "text"]
            && report["draftShape"] as? String == "claude-opus-5-5/64000/true/json_schema/true/true/true" && (report["draftRefusals"] as? [Bool] ?? []) == [true, true, true, true, true]
            && report["errorWording"] as? Bool == true && report["keyShortRefused"] as? Bool == true && report["keychain"] as? String == "true/true/true/true"
        report["draftOK"] = draftOK
        // the assistant's own window: beside the main window when there is room, otherwise inside the right edge of the screen
        let scr = NSRect(x: 0, y: 0, width: 1920, height: 1055), sz = NSSize(width: 440, height: 688)
        let beside = AssistantWindow.firstOrigin(size: sz, main: NSRect(x: 100, y: 200, width: 1100, height: 760), visible: scr)
        let full = AssistantWindow.firstOrigin(size: sz, main: scr, visible: scr)
        report["assistantPlace"] = "\(Int(beside.x)),\(Int(beside.y)) \(Int(full.x)),\(Int(full.y))"
    } catch { report["error"] = error.localizedDescription }
    try? fm.removeItem(at: dir)
    let ok = report["error"] == nil && report["assistantPlace"] as? String == "1212,272 1468,367" && report["casesOK"] as? Bool == true && report["draftOK"] as? Bool == true && report["listAfterPut"] as? Int == 2 && report["listAfterRemove"] as? Int == 1 && report["removedKept"] as? Int == 1 && report["exportName"] as? String == "A-B- test.docx"
        && report["copyRtfHasTable"] as? Bool == true && report["openInsideExports"] as? Bool == true && report["openOutsideRefused"] as? Bool == true && report["badNameRefused"] as? Bool == true && report["badIdRefused"] as? Bool == true
    report["ok"] = ok
    if let d = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { print(String(data: d, encoding: .utf8) ?? "") }
    exit(ok ? 0 : 1)
}

// Small jobs that need the app's run loop but not its window.
final class ToolDelegate: NSObject, NSApplicationDelegate {
    let job: () -> Void
    init(_ job: @escaping () -> Void) { self.job = job }
    func applicationDidFinishLaunching(_ notification: Notification) { job() }
}
func runTool(_ job: @escaping () -> Void) -> Never {
    let app = NSApplication.shared, d = ToolDelegate(job)
    app.delegate = d
    app.setActivationPolicy(.accessory)
    withExtendedLifetime(d) { app.run() }
    exit(0)
}
func printJSON(_ o: [String: Any]) { if let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]) { print(String(data: d, encoding: .utf8) ?? "{}") } }
func toolRequest(_ flag: String) -> [String: Any]? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count, let d = try? Data(contentsOf: URL(fileURLWithPath: args[i + 1])), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
    return o
}
if args.contains("--makepdf") {
    guard let r = toolRequest("--makepdf"), let src = r["html"] as? String, let out = r["out"] as? String, let html = try? String(contentsOfFile: src, encoding: .utf8) else { print("{\"error\":\"unreadable request\"}"); exit(2) }
    let logo = ((r["logo"] as? [String: Any])?["data"] as? String).flatMap { Data(base64Encoded: $0) }
    runTool {
        PDFMaker.make(html: html, to: URL(fileURLWithPath: out), title: r["title"] as? String ?? "", logo: logo) { res in
            switch res {
            case .success(let n): printJSON(["pages": n, "planned": PDFMaker.lastPlanned, "path": out]); exit(0)
            case .failure(let e): printJSON(["error": e.localizedDescription]); exit(1)
            }
        }
    }
}
if args.contains("--aitest") {
    // Sends one request to the address in the file, which must be on this Mac. Used with a stand-in server; the real key is never read.
    guard let r = toolRequest("--aitest"), let u = (r["url"] as? String).flatMap({ URL(string: $0) }), u.host == "127.0.0.1" || u.host == "localhost" else { print("{\"error\":\"unreadable request, or the address is not on this Mac\"}"); exit(2) }
    AIClient.endpoint = u
    let bridge = Bridge(store: HostStore(dataDir: fm.temporaryDirectory.appendingPathComponent("expert-report-aitest-\(ProcessInfo.processInfo.processIdentifier)")))
    bridge.quiet = true
    runTool {
        do {
            let body = r["messages"] != nil ? try bridge.turnBody(r) : try bridge.draftBody(r)
            var ticks = 0
            AIClient(key: r["key"] as? String ?? "test-key", body: body, progress: { _ in ticks += 1 }, completion: { res in
                switch res {
                case .success(var v): v["progressCalls"] = ticks; printJSON(v); exit(0)
                case .failure(let e): printJSON(["error": e.localizedDescription]); exit(1)
                }
            }).start()
        } catch { printJSON(["error": error.localizedDescription]); exit(1) }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
if let i = args.firstIndex(of: "--uitest"), i + 1 < args.count { delegate.uitestDir = URL(fileURLWithPath: args[i + 1]) }
app.delegate = delegate
app.setActivationPolicy(delegate.uitestDir == nil ? .regular : .accessory)
app.run()
