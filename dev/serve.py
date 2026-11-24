#!/usr/bin/env python3
"""Local preview for Expert Report: serves app/ and answers the same host calls the Mac app answers.
Data goes to dev/.data (or EXPERT_REPORT_DATA_DIR), never to the real app's data folder.
Usage: python3 dev/serve.py [port]
"""
import base64, http.server, json, os, re, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); APP = os.path.join(ROOT, 'app')
DATA = os.environ.get('EXPERT_REPORT_DATA_DIR') or os.path.join(HERE, '.data')
SAFE = re.compile(r'^[A-Za-z0-9_-]{1,80}$')
def safe(s):
    if not SAFE.match(str(s)): raise ValueError('bad name: %r' % s)
    return str(s)
def fname(s):
    s = re.sub(r'[/\\:\x00-\x1f]', '-', str(s)).strip().strip('.') or 'export'
    return s[:120]
def api(method, p):
    if method == 'info': return {'mode': 'server', 'dataDir': DATA, 'version': 'dev'}
    if method == 'list':
        d = os.path.join(DATA, safe(p['collection'])); out = []
        if os.path.isdir(d):
            for n in sorted(os.listdir(d)):
                if n.endswith('.json'):
                    try: out.append(json.load(open(os.path.join(d, n), encoding='utf-8')))
                    except Exception: pass
        return out
    if method == 'put':
        d = os.path.join(DATA, safe(p['collection'])); os.makedirs(d, exist_ok=True)
        path = os.path.join(d, safe(p['id']) + '.json'); tmp = path + '.tmp'
        json.dump(p['doc'], open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); os.replace(tmp, path); return True
    if method == 'remove':
        src = os.path.join(DATA, safe(p['collection']), safe(p['id']) + '.json')
        if os.path.exists(src):
            t = os.path.join(DATA, 'Removed', safe(p['collection'])); os.makedirs(t, exist_ok=True)
            os.replace(src, os.path.join(t, '%s-%d.json' % (safe(p['id']), int(time.time()))))
        return True
    if method in ('saveExport', 'saveAs'):
        d = os.path.join(DATA, 'Exports' if method == 'saveExport' else 'SavedAs'); os.makedirs(d, exist_ok=True)
        path = os.path.join(d, fname(p['name'])); open(path, 'wb').write(base64.b64decode(p['data'])); return {'path': path}
    if method == 'openInPages':
        if os.environ.get('EXPERT_REPORT_DEV_OPEN') == '1': subprocess.run(['open', '-a', 'Pages', p['path']])
        return {'ok': True, 'path': p['path']}
    if method == 'reveal': return True
    if method == 'copy':
        os.makedirs(DATA, exist_ok=True)
        open(os.path.join(DATA, 'clipboard.html'), 'w', encoding='utf-8').write(p.get('html', ''))
        open(os.path.join(DATA, 'clipboard.txt'), 'w', encoding='utf-8').write(p.get('text', '')); return True
    if method == 'pickImage':
        return {'type': 'png', 'w': 245, 'h': 116, 'data': base64.b64encode(open(os.path.join(APP, 'img', 'logo.png'), 'rb').read()).decode()}
    if method.startswith('case') or method in ('chooseFolder', 'setDropTarget'):
        return case_api(method, p)
    if method == 'aiKeyStatus': return {'set': os.environ.get('EXPERT_REPORT_DEV_NOKEY') != '1', 'mock': True}
    if method in ('aiKeySet', 'aiKeyClear'): return True
    if method == 'ai': return mock_ai(p)
    if method == 'aiTurn': return mock_turn(p)
    if method == 'voiceStart': raise ValueError('Voice input works in the Mac app, not in the preview.')
    if method == 'voiceStop': return True
    if method == 'agentWindow': return {'open': False}   # the preview opens a browser window instead
    if method == 'exportPDF': return export_pdf(p)
    raise ValueError('unknown call: ' + method)

# ---------- cases: each case is a real folder; the app's records sit in "Case data" inside it ----------
CASEDATA, REMOVED = 'Case data', 'Removed files'
FOLDERS = ['Photos', 'Emails', 'Documents', 'Field notes', 'Notes', 'Reports']
KINDS = {'image': 'jpg jpeg png heic heif tif tiff gif webp bmp', 'pdf': 'pdf', 'email': 'eml emlx msg', 'text': 'txt md rtf', 'doc': 'doc docx pages',
         'sheet': 'xls xlsx csv numbers', 'video': 'mov mp4 m4v avi'}
def kind_of(name):
    ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
    for k, v in KINDS.items():
        if ext in v.split(): return k
    return 'other'
def folder_for(kind): return {'image': 'Photos', 'email': 'Emails', 'video': 'Videos'}.get(kind, 'Documents')
def is_case(path): return os.path.isfile(os.path.join(path, CASEDATA, 'case.json'))
def case_dir(v):
    path = os.path.realpath(str(v))
    if not is_case(path): raise ValueError('That folder is not a case.')
    return path
def inside(base, rel):
    rel = str(rel)
    if not rel or rel.startswith('/') or '..' in rel.split('/'): raise ValueError('That path is not allowed.')
    full = os.path.realpath(os.path.join(base, rel))
    if not full.startswith(base + os.sep): raise ValueError('That path is outside the case folder.')
    return full
def unique(d, name):
    base, ext = os.path.splitext(name); n = 1; out = os.path.join(d, name)
    while os.path.exists(out):
        n += 1; out = os.path.join(d, '%s %d%s' % (base, n, ext))
    return out
def sips_info(path):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'creation', path], capture_output=True, text=True).stdout
    info = {}
    for line in out.splitlines():
        if ':' in line:
            k, v = line.split(':', 1); info[k.strip()] = v.strip()
    return info
def jpeg(path, maxpx):
    import tempfile
    with tempfile.TemporaryDirectory() as t:
        o = os.path.join(t, 'o.jpg')
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', str(int(maxpx)), path, '--out', o], capture_output=True)
        if not os.path.exists(o): raise ValueError('That image could not be read.')
        i = sips_info(o)
        return {'type': 'jpg', 'w': int(i.get('pixelWidth', 0)), 'h': int(i.get('pixelHeight', 0)), 'data': base64.b64encode(open(o, 'rb').read()).decode()}
def scan(base):
    out = []
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (root == base and d in (CASEDATA, REMOVED)))
        for n in sorted(files):
            if n.startswith('.'): continue
            full = os.path.join(root, n); rel = os.path.relpath(full, base); st = os.stat(full); k = kind_of(n)
            e = {'rel': rel, 'name': n, 'folder': rel.split(os.sep)[0] if os.sep in rel else '', 'size': st.st_size, 'modified': time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(st.st_mtime)), 'kind': k}
            if k == 'image':
                i = sips_info(full); c = i.get('creation', '')
                if len(c) >= 19 and c[4] == ':': e['taken'] = c[:4] + '-' + c[5:7] + '-' + c[8:10] + 'T' + c[11:19]
                e['w'] = int(i.get('pixelWidth', 0) or 0); e['h'] = int(i.get('pixelHeight', 0) or 0)
            out.append(e)
    return out
def case_api(method, p):
    if method == 'chooseFolder':
        d = os.path.join(DATA, 'Cases'); os.makedirs(d, exist_ok=True); return {'path': d}
    if method == 'setDropTarget': return True
    if method == 'caseList':
        root = os.path.realpath(str(p['root'])); out = []
        if os.path.isdir(root):
            for n in sorted(os.listdir(root)):
                d = os.path.join(root, n)
                if is_case(d):
                    try: out.append({'path': d, 'folder': n, 'doc': json.load(open(os.path.join(d, CASEDATA, 'case.json'), encoding='utf-8'))})
                    except Exception: pass
        return out
    if method == 'caseCreate':
        root = os.path.realpath(str(p['root'])); os.makedirs(root, exist_ok=True)
        d = unique(root, fname(p['name'])); os.makedirs(os.path.join(d, CASEDATA))
        for f in FOLDERS: os.makedirs(os.path.join(d, f), exist_ok=True)
        json.dump(p['doc'], open(os.path.join(d, CASEDATA, 'case.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        return {'path': d, 'folder': os.path.basename(d)}
    base = case_dir(p['path'])
    if method == 'caseGet':
        f = os.path.join(base, CASEDATA, safe(p['name']) + '.json')
        return json.load(open(f, encoding='utf-8')) if os.path.exists(f) else None
    if method == 'casePut':
        f = os.path.join(base, CASEDATA, safe(p['name']) + '.json'); tmp = f + '.tmp'
        json.dump(p['doc'], open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=1); os.replace(tmp, f); return True
    if method == 'caseRemove':
        f = os.path.join(base, CASEDATA, safe(p['name']) + '.json')
        if os.path.exists(f):
            t = os.path.join(base, CASEDATA, 'Removed'); os.makedirs(t, exist_ok=True); os.replace(f, os.path.join(t, '%s-%d.json' % (safe(p['name']), int(time.time()))))
        return True
    if method == 'caseNames':
        d = os.path.join(base, CASEDATA); pre = str(p.get('prefix', ''))
        return sorted(n[:-5] for n in os.listdir(d) if n.endswith('.json') and n.startswith(pre))
    if method == 'caseScan': return scan(base)
    if method == 'caseAddFiles':
        src = os.path.join(HERE, 'fixtures', 'sample-files'); added = []
        if os.path.isdir(src):
            import shutil
            for n in sorted(os.listdir(src)):
                if n.startswith('.'): continue
                d = os.path.join(base, p.get('folder') or folder_for(kind_of(n))); os.makedirs(d, exist_ok=True)
                out = unique(d, n); shutil.copy2(os.path.join(src, n), out); added.append(os.path.relpath(out, base))
        return added
    if method == 'caseUpload':
        name = fname(p['name']); d = os.path.join(base, fname(p.get('folder') or folder_for(kind_of(name)))); os.makedirs(d, exist_ok=True)
        out = unique(d, name); open(out, 'wb').write(base64.b64decode(p['data'])); return {'rel': os.path.relpath(out, base)}
    if method == 'caseWriteText':
        full = inside(base, p['rel'])
        if kind_of(full) != 'text': raise ValueError('Only text notes can be written.')
        os.makedirs(os.path.dirname(full), exist_ok=True); open(full, 'w', encoding='utf-8').write(p.get('text', '')); return True
    if method == 'caseReadText':
        full = inside(base, p['rel'])
        if os.path.getsize(full) > 2000000: raise ValueError('That file is too large to show.')
        return open(full, encoding='utf-8', errors='replace').read()
    if method == 'caseThumb': return jpeg(inside(base, p['rel']), p.get('max', 360))
    if method == 'caseImage': return jpeg(inside(base, p['rel']), p.get('max', 1600))
    if method == 'caseOpen':
        target = inside(base, p['rel']) if p.get('rel') else base
        if os.environ.get('EXPERT_REPORT_DEV_OPEN') == '1': subprocess.run(['open', target])
        return True
    if method == 'caseTrash':
        full = inside(base, p['rel']); t = os.path.join(base, REMOVED); os.makedirs(t, exist_ok=True)
        os.replace(full, unique(t, os.path.basename(full))); return True
    if method == 'caseRename':
        full = inside(base, p['rel']); out = unique(os.path.dirname(full), fname(p['name'])); os.replace(full, out); return {'rel': os.path.relpath(out, base)}
    if method == 'caseSaveReport':
        d = os.path.join(base, 'Reports'); os.makedirs(d, exist_ok=True); out = os.path.join(d, fname(p['name']))
        open(out, 'wb').write(base64.b64decode(p['data'])); return {'path': out, 'rel': os.path.relpath(out, base)}
    raise ValueError('unknown call: ' + method)

# ---------- preview stand-ins for the two things only the Mac app really does ----------
def mock_ai(p):
    """Checks the request the way the Mac app would, then returns a made-up draft so the screens can be tried. Nothing is sent anywhere."""
    base = case_dir(p['path']); text = []; photos = []; notes = []; sizes = 0
    for b in p.get('content') or []:
        t = b.get('type')
        if t == 'text':
            text.append(b['text'])
            m = re.match(r'Photo (\d+) \|.*\| needs a caption', b['text'])
            if m: photos.append(int(m.group(1)))
            m = re.match(r'Field note page (\d+) \|', b['text'])
            if m and 'typed copy' not in b['text']: notes.append(int(m.group(1)))
        elif t == 'case_image':
            sizes += len(jpeg(inside(base, b['rel']), b.get('max', 1200))['data'])
        elif t == 'case_pdf':
            full = inside(base, b['rel'])
            if kind_of(full) != 'pdf': raise ValueError('Only PDFs can be attached as documents.')
            sizes += os.path.getsize(full) * 4 // 3
        else: raise ValueError('unknown content block: %r' % t)
    if not p.get('system') or not p.get('schema') or not p.get('model'): raise ValueError('The request is missing its instructions.')
    if os.environ.get('EXPERT_REPORT_DEV_AI') == 'refuse': return {'text': '', 'stop': 'refusal', 'detail': 'preview refusal', 'usage': {}, 'model': p['model']}
    if 'trees' in (p['schema'].get('properties') or {}):
        out = {'trees': [{'tag': '1', 'species': 'Pecan', 'diameter': '17', 'condition': '70', 'condition_guess': '', 'location_guess': '75', 'rating_basis': 'Preview guess: front yard tree.', 'notes': 'Preview entry. Cut at ground level. Photo 1 shows the stump.', 'source': 'field note page 1', 'unsure': False},
                         {'tag': '2', 'species': 'Water oak', 'diameter': '21+24', 'condition': '', 'condition_guess': '60', 'location_guess': '75', 'rating_basis': 'Preview guess: no information.', 'notes': 'Preview entry. Two stems.', 'source': 'field note page 1', 'unsure': True}],
               'pages': [{'image': 'Photo 3', 'text': 'Preview typed copy.\n1  Pecan  17"  cut @ grade\n2  WO  21 + 24[?]'}], 'visit_date': '2026-10-29',
               'questions': ['Tree 2: is the second stem 24 or 27 inches? (field note page 1)']}
        time.sleep(0.8)
        return {'text': json.dumps(out), 'stop': 'end_turn', 'usage': {'input_tokens': 2000, 'output_tokens': 300}, 'model': p['model']}
    joined = '\n'.join(text); sections = re.findall(r'^- id (\S+) \| ([^|\n]+)', joined, re.M)
    out = {'letter': 'You asked me to inspect the trees at the property and report what I found. This report is based on my site visit of [date of visit], the photographs taken that day, and the documents listed under Materials Reviewed.',
           'sections': [{'id': i, 'text': 'PREVIEW DRAFT for "%s". The live app writes this from the case material.\n\nThe subject trees stood along the north property line (Photo 1). [Your observation of the stumps and their diameters.]\n\n- First observation from the notes.\n- Second observation from the notes.' % t.strip()} for i, t in sections],
           'captions': [{'photo': n, 'caption': 'Preview caption for photo %d. Describes only what is visible.' % n} for n in photos],
           'field_notes': [{'page': n, 'text': 'Preview transcription of page %d. 24 in [?] water oak.' % n} for n in notes],
           'questions': ['What was the date of your site visit?', 'Who told you the trees were cut in March? The email and the notes disagree.']}
    time.sleep(float(os.environ.get('EXPERT_REPORT_DEV_AI_DELAY', '1.2')))
    return {'text': json.dumps(out), 'stop': 'end_turn', 'usage': {'input_tokens': (len(joined) + sizes // 300) // 4, 'output_tokens': 900}, 'model': p['model']}
def mock_turn(p):
    """Stand-in for one turn of the assistant: checks the conversation's shape, then answers by rule so the panel and its tools can be tried."""
    msgs = p.get('messages') or []; names = [t['name'] for t in p.get('tools') or []]
    if not msgs or msgs[-1].get('role') != 'user' or not p.get('system'): raise ValueError('The conversation was not well formed.')
    for i, m in enumerate(msgs):
        if m['role'] != ('user' if i % 2 == 0 else 'assistant'): raise ValueError('The turns do not alternate.')
        for b in (m['content'] if isinstance(m['content'], list) else []):
            for inner in (b.get('content') if b.get('type') == 'tool_result' and isinstance(b.get('content'), list) else []):
                if inner.get('type') == 'case_image': jpeg(inside(case_dir(p['path']), inner['rel']), inner.get('max', 1600))
    last = msgs[-1]['content']; time.sleep(0.5)
    def say(blocks, stop): return {'content': blocks, 'stop': stop, 'usage': {'input_tokens': 1500, 'output_tokens': 120}, 'model': p['model']}
    if isinstance(last, list) and any(b.get('type') == 'tool_result' for b in last):
        errs = [b for b in last if b.get('is_error')]
        return say([{'type': 'text', 'text': 'Preview assistant: ' + ('that did not work: ' + str(errs[0].get('content'))[:200] if errs else 'done. (A stand-in answers here in the preview; the real assistant replies in the app.)')}], 'end_turn')
    text = ' '.join(b.get('text', '') for b in last if b.get('type') == 'text') if isinstance(last, list) else str(last)
    m = re.search(r'add tree (\S+): ([a-z ]+?), (\d+)(?: inches)?(?:, condition (\d+))?', text, re.I)
    if m and 'update_trees' in names:
        tree = {'tree': m.group(1), 'species': m.group(2).strip(), 'diameter': m.group(3)}
        if m.group(4): tree['condition'] = m.group(4)
        return say([{'type': 'text', 'text': 'Adding that tree.'}, {'type': 'tool_use', 'id': 'toolu_preview%d' % len(msgs), 'name': 'update_trees', 'input': {'trees': [tree]}}], 'tool_use')
    if re.search(r'photo (\d+)', text, re.I) and 'view_image' in names:
        return say([{'type': 'tool_use', 'id': 'toolu_preview%d' % len(msgs), 'name': 'view_image', 'input': {'file': 'Photo ' + re.search(r'photo (\d+)', text, re.I).group(1)}}], 'tool_use')
    if re.search(r'bad tool', text, re.I): return say([{'type': 'tool_use', 'id': 'toolu_preview%d' % len(msgs), 'name': 'update_trees', 'input': {'trees': 'not a list'}}], 'tool_use')
    return say([{'type': 'text', 'text': 'Let me look at the case.'}, {'type': 'tool_use', 'id': 'toolu_preview%d' % len(msgs), 'name': 'look', 'input': {'what': 'case'}}], 'tool_use')
def export_pdf(p):
    """The Mac app prints the page to a PDF. In the preview, the built app does it if it is there; otherwise the page is saved as HTML."""
    base = case_dir(p['path']); d = os.path.join(base, 'Reports'); os.makedirs(d, exist_ok=True)
    name = fname(p.get('name') or 'Report.pdf'); src = os.path.join(d, name[:-4] + '.html') if name.lower().endswith('.pdf') else os.path.join(d, name + '.html')
    open(src, 'w', encoding='utf-8').write(p.get('html', ''))
    exe = os.path.join(ROOT, 'build', 'Expert Report.app', 'Contents', 'MacOS', 'ExpertReport')
    if os.path.exists(exe) and os.environ.get('EXPERT_REPORT_DEV_PDF') != '0' and b'expert-report-pdf-' in open(exe, 'rb').read():   # an older build would open its window instead
        out = os.path.join(d, name); req = src + '.json'
        json.dump({'html': src, 'out': out, 'title': p.get('title') or '', 'logo': p.get('logo')}, open(req, 'w', encoding='utf-8'))
        r = subprocess.run([exe, '--makepdf', req], capture_output=True, text=True, timeout=120)
        os.remove(req)
        if r.returncode == 0 and os.path.exists(out):
            os.remove(src)
            try: info = json.loads(r.stdout.strip().splitlines()[-1])
            except Exception: info = {}
            return {'path': out, 'rel': os.path.relpath(out, base), 'pages': info.get('pages', 0), 'planned': info.get('planned', 0)}
    return {'path': src, 'rel': os.path.relpath(src, base), 'pages': 0, 'note': 'Preview: saved as a web page, not a PDF.'}

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=APP, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def do_POST(self):
        if self.path != '/api': self.send_response(404); self.end_headers(); return
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            body = {'result': api(req.get('method'), req.get('params') or {})}
        except Exception as e:
            body = {'error': str(e)}
        data = json.dumps(body).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, fmt, *args):
        if 'POST /api' not in (args[0] if args else ''): super().log_message(fmt, *args)
if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8830
    print('Expert Report preview on http://127.0.0.1:%d  (data in %s)' % (port, DATA), flush=True)
    http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
