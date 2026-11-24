#!/usr/bin/env python3
"""Read-only text extraction from a .pages package (zip of snappy-framed protobuf .iwa files)."""
import sys, zipfile

def varint(b, p):
    v = 0; s = 0
    while True:
        c = b[p]; p += 1
        v |= (c & 0x7f) << s
        if not c & 0x80: return v, p
        s += 7

def unsnappy(d):
    _, p = varint(d, 0)
    out = bytearray(); n = len(d)
    while p < n:
        tag = d[p]; p += 1; t = tag & 3
        if t == 0:
            ln = tag >> 2
            if ln < 60: ln += 1
            else:
                nb = ln - 59; ln = int.from_bytes(d[p:p+nb], 'little') + 1; p += nb
            out += d[p:p+ln]; p += ln
        else:
            if t == 1:
                ln = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | d[p]; p += 1
            elif t == 2:
                ln = (tag >> 2) + 1; off = d[p] | (d[p+1] << 8); p += 2
            else:
                ln = (tag >> 2) + 1; off = int.from_bytes(d[p:p+4], 'little'); p += 4
            st = len(out) - off
            if off >= ln: out += out[st:st+ln]
            else:
                for i in range(ln): out.append(out[st+i])
    return bytes(out)

def iwa(raw):
    p = 0; out = bytearray()
    while p < len(raw):
        ln = raw[p+1] | (raw[p+2] << 8) | (raw[p+3] << 16); p += 4
        out += unsnappy(raw[p:p+ln]); p += ln
    return bytes(out)

def fields(b):
    p = 0; n = len(b)
    while p < n:
        key, p = varint(b, p); f = key >> 3; w = key & 7
        if w == 0: v, p = varint(b, p)
        elif w == 1: v = b[p:p+8]; p += 8
        elif w == 2:
            ln, p = varint(b, p); v = b[p:p+ln]; p += ln
        elif w == 5: v = b[p:p+4]; p += 4
        else: raise ValueError('wire %d' % w)
        yield f, w, v

def messages(data):
    p = 0
    while p < len(data):
        ln, p = varint(data, p); info = data[p:p+ln]; p += ln
        ident = None; infos = []
        for f, w, v in fields(info):
            if f == 1 and w == 0: ident = v
            elif f == 2 and w == 2:
                typ = None; length = 0
                for f2, w2, v2 in fields(v):
                    if f2 == 1 and w2 == 0: typ = v2
                    elif f2 == 3 and w2 == 0: length = v2
                infos.append((typ, length))
        for typ, length in infos:
            yield ident, typ, data[p:p+length]; p += length

def main(path):
    z = zipfile.ZipFile(path)
    storages = []; cells = []
    for name in z.namelist():
        if not name.endswith('.iwa'): continue
        try: data = iwa(z.read(name))
        except Exception as e:
            print('!! %s: %s' % (name, e)); continue
        try:
            for ident, typ, payload in messages(data):
                if typ == 2001:
                    kind = None; texts = []
                    for f, w, v in fields(payload):
                        if f == 1 and w == 0: kind = v
                        if f == 3 and w == 2: texts.append(v.decode('utf-8', 'replace'))
                    t = ''.join(texts)
                    if t.strip(): storages.append((name, ident, kind, t))
                elif typ == 6005:
                    for f, w, v in fields(payload):
                        if f == 3 and w == 2:
                            try:
                                for f2, w2, v2 in fields(v):
                                    if f2 == 3 and w2 == 2:
                                        s = v2.decode('utf-8', 'replace')
                                        if s.strip(): cells.append(s)
                            except Exception: pass
        except Exception as e:
            print('!! parse %s: %s' % (name, e))
    storages.sort(key=lambda s: -len(s[3]))
    print('===== %s =====' % path)
    for name, ident, kind, t in storages:
        print('\n----- storage %s kind=%s (%d chars) -----' % (ident, kind, len(t)))
        print(t.replace('￼', '[obj]').replace(' ', '\n'))
    if cells:
        print('\n----- table cell strings -----')
        for c in cells: print(' | ' + c.replace('\n', ' / '))

if __name__ == '__main__':
    main(sys.argv[1])
