#!/usr/bin/env python3
"""Tests the Mac app's drafting client against a stand-in for the Claude API running on this Mac.
Nothing leaves the machine and no real key is used. Needs a built app:  mac/build.sh  then  python3 dev/test-ai-client.py
It checks that the app sends a well-formed streaming request (headers, model, structured output, photos and PDFs as base64),
reads a stream that arrives in small pieces, retries without the fallback header when an account rejects it, and turns
errors, refusals and dropped connections into plain messages instead of a half-finished draft."""
import base64, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
EXE = os.path.join(ROOT, 'build', 'Expert Report.app', 'Contents', 'MacOS', 'ExpertReport')
DRAFT = {'letter': 'Café letter.', 'sections': [{'id': 's1', 'text': 'First paragraph.\n\n- one\n- two'}], 'captions': [{'photo': 1, 'caption': 'A stump.'}], 'field_notes': [], 'questions': ['When was the visit?']}
seen = []   # what each request looked like

def sse(event, data): return ('event: %s\ndata: %s\n\n' % (event, json.dumps(data))).encode()

class Mock(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *a): pass
    def do_POST(self):
        scenario = self.path.strip('/').split('/')[0]
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        seen.append({'scenario': scenario, 'headers': {k.lower(): v for k, v in self.headers.items()}, 'body': body})
        def fail(status, kind, message):
            data = json.dumps({'type': 'error', 'error': {'type': kind, 'message': message}}).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        if scenario == 'unauthorized': return fail(401, 'authentication_error', 'invalid x-api-key')
        if scenario == 'busy': return fail(529, 'overloaded_error', 'Overloaded')
        if scenario == 'nobeta' and 'anthropic-beta' in self.headers: return fail(400, 'invalid_request_error', 'Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header.')
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.send_header('Transfer-Encoding', 'chunked'); self.end_headers()
        def write(b):
            # deliberately awkward pieces: the app must not depend on where the network cuts the stream
            for i in range(0, len(b), 37):
                piece = b[i:i + 37]; self.wfile.write(b'%x\r\n' % len(piece) + piece + b'\r\n'); self.wfile.flush(); time.sleep(0.002)
        text = json.dumps(DRAFT)
        write(sse('message_start', {'type': 'message_start', 'message': {'id': 'msg_test', 'type': 'message', 'role': 'assistant', 'model': body.get('model'), 'content': [], 'usage': {'input_tokens': 4321, 'output_tokens': 1}}}))
        write(sse('ping', {'type': 'ping'}))
        if scenario == 'tools':
            # a turn of the assistant: thinking with its signature, a sentence, one good tool call sent in pieces, one whose input is not valid JSON
            write(sse('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'thinking', 'thinking': '', 'signature': ''}}))
            write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'thinking_delta', 'thinking': 'Check the '}}))
            write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'thinking_delta', 'thinking': 'tree list.'}}))
            write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'signature_delta', 'signature': 'SIG+abc/123=='}}))
            write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 0}))
            write(sse('content_block_start', {'type': 'content_block_start', 'index': 1, 'content_block': {'type': 'text', 'text': ''}}))
            for piece in ('Adding ', 'tree 4 \u2014 caf\u00e9.'): write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': piece}}))
            write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 1}))
            write(sse('content_block_start', {'type': 'content_block_start', 'index': 2, 'content_block': {'type': 'tool_use', 'id': 'toolu_good', 'name': 'update_trees', 'input': {}}}))
            for piece in ('{"trees": [{"tr', 'ee": "4", "species": "Water oak", "diam', 'eter": "21+24", "note": "said \\"fair\\""}]}'): write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 2, 'delta': {'type': 'input_json_delta', 'partial_json': piece}}))
            write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 2}))
            write(sse('content_block_start', {'type': 'content_block_start', 'index': 3, 'content_block': {'type': 'tool_use', 'id': 'toolu_bad', 'name': 'look', 'input': {}}}))
            write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 3, 'delta': {'type': 'input_json_delta', 'partial_json': '{"what": "case'}}))
            write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 3}))
            write(sse('content_block_start', {'type': 'content_block_start', 'index': 4, 'content_block': {'type': 'tool_use', 'id': 'toolu_empty', 'name': 'look', 'input': {}}}))
            write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 4}))
            write(sse('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'tool_use'}, 'usage': {'output_tokens': 77}}))
            write(sse('message_stop', {'type': 'message_stop'})); self.wfile.write(b'0\r\n\r\n'); return
        write(sse('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'thinking', 'thinking': ''}}))
        write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'thinking_delta', 'thinking': 'This must not end up in the draft.'}}))
        write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 0}))
        if scenario == 'refusal':
            write(sse('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'refusal', 'stop_details': {'category': 'bio'}}, 'usage': {'output_tokens': 3}}))
            write(sse('message_stop', {'type': 'message_stop'})); self.wfile.write(b'0\r\n\r\n'); return
        write(sse('content_block_start', {'type': 'content_block_start', 'index': 1, 'content_block': {'type': 'text', 'text': ''}}))
        half = len(text) // 2
        for i in range(0, half, 11): write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': text[i:min(i + 11, half)]}}))
        if scenario == 'error-midway':
            write(sse('error', {'type': 'error', 'error': {'type': 'overloaded_error', 'message': 'Overloaded'}})); self.wfile.write(b'0\r\n\r\n'); return
        if scenario == 'cutoff':
            self.wfile.write(b'0\r\n\r\n'); return
        time.sleep(0.6)   # long enough that the app reports progress at least once
        for i in range(half, len(text), 11): write(sse('content_block_delta', {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': text[i:i + 11]}}))
        write(sse('content_block_stop', {'type': 'content_block_stop', 'index': 1}))
        write(sse('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'max_tokens' if scenario == 'toolong' else 'end_turn'}, 'usage': {'output_tokens': 987}}))
        write(sse('message_stop', {'type': 'message_stop'})); self.wfile.write(b'0\r\n\r\n')

def main():
    if not os.path.exists(EXE): sys.exit('Build the app first: mac/build.sh')
    tmp = tempfile.mkdtemp(prefix='expert-report-aitest-'); case = os.path.join(tmp, 'Case'); os.makedirs(os.path.join(case, 'Case data')); os.makedirs(os.path.join(case, 'Photos')); os.makedirs(os.path.join(case, 'Documents'))
    json.dump({'id': 'c1', 'name': 'AI test'}, open(os.path.join(case, 'Case data', 'case.json'), 'w'))
    shutil.copy(os.path.join(HERE, 'fixtures', 'sample-files', sorted(n for n in os.listdir(os.path.join(HERE, 'fixtures', 'sample-files')) if n.lower().endswith(('.jpg', '.png')))[0]), os.path.join(case, 'Photos', 'photo.jpg'))
    open(os.path.join(case, 'Documents', 'Estimate.pdf'), 'wb').write(b'%PDF-1.4\n% stand-in\n')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Mock); port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def run(scenario, **over):
        req = {'url': 'http://127.0.0.1:%d/%s/v1/messages' % (port, scenario), 'key': 'test-key', 'path': case, 'model': 'claude-opus-5-5', 'effort': 'high', 'maxTokens': 64000, 'system': 'You are helping a consulting arborist.',
               'schema': {'type': 'object', 'additionalProperties': False, 'required': ['letter'], 'properties': {'letter': {'type': 'string'}}},
               'content': [{'type': 'text', 'text': 'CASE FACTS'}, {'type': 'text', 'text': 'PDF: Documents/Estimate.pdf'}, {'type': 'case_pdf', 'rel': 'Documents/Estimate.pdf'},
                           {'type': 'text', 'text': 'Photo 1 | needs a caption'}, {'type': 'case_image', 'rel': 'Photos/photo.jpg', 'max': 600}, {'type': 'text', 'text': 'Draft the report sections now.'}]}
        req.update(over); f = os.path.join(tmp, scenario + '.json'); json.dump(req, open(f, 'w'))
        r = subprocess.run([EXE, '--aitest', f], capture_output=True, text=True, timeout=60)
        try: return json.loads(r.stdout.strip().splitlines()[-1])
        except Exception: return {'error': 'no answer: ' + (r.stdout + r.stderr)[:300]}
    passed = failed = 0
    def ok(name, cond, got=None):
        nonlocal passed, failed
        if cond: passed += 1
        else: failed += 1; print('FAIL  ' + name + ('   got: ' + json.dumps(got)[:400] if got is not None else ''))

    out = run('ok'); q = seen[-1]; h = q['headers']; b = q['body']; blocks = b['messages'][0]['content']
    ok('the draft arrives whole', out.get('text') == json.dumps(DRAFT) and json.loads(out['text'])['letter'] == 'Café letter.', out)
    ok('thinking is left out of the draft', 'must not end up' not in out.get('text', ''))
    ok('stop reason, model and usage are reported', out.get('stop') == 'end_turn' and out.get('model') == 'claude-opus-5-5' and out.get('usage') == {'input_tokens': 4321, 'output_tokens': 987}, out)
    ok('progress was reported while it streamed', out.get('progressCalls', 0) >= 1, out)
    ok('headers', h.get('x-api-key') == 'test-key' and h.get('anthropic-version') == '2026-10-21' and h.get('anthropic-beta') == 'server-side-fallback-2026-07-01' and h.get('content-type') == 'application/json', h)
    ok('request shape', b.get('model') == 'claude-opus-5-5' and b.get('stream') is True and b.get('max_tokens') == 64000 and b.get('fallbacks') == 'default' and b.get('system', '').startswith('You are helping')
       and b.get('output_config', {}).get('effort') == 'high' and b['output_config']['format']['type'] == 'json_schema' and b['output_config']['format']['schema']['required'] == ['letter'], {k: v for k, v in b.items() if k != 'messages'})
    ok('nothing the current models reject', not any(k in b for k in ('thinking', 'temperature', 'top_p', 'top_k', 'tool_choice')) and len(b['messages']) == 1 and b['messages'][0]['role'] == 'user')
    ok('blocks in order', [x['type'] for x in blocks] == ['text', 'text', 'document', 'text', 'image', 'text'], [x['type'] for x in blocks])
    pdf = blocks[2]['source']; img = blocks[4]['source']
    ok('the PDF goes as a base64 document', pdf['type'] == 'base64' and pdf['media_type'] == 'application/pdf' and base64.b64decode(pdf['data']).startswith(b'%PDF'))
    ok('the photo goes as a JPEG no larger than asked', img['type'] == 'base64' and img['media_type'] == 'image/jpeg' and base64.b64decode(img['data'])[:2] == b'\xff\xd8', img.get('media_type'))

    n = len(seen); out = run('nobeta'); tries = seen[n:]
    ok('an account without the fallback feature still gets a draft', out.get('stop') == 'end_turn' and len(tries) == 2 and 'anthropic-beta' in tries[0]['headers'] and 'anthropic-beta' not in tries[1]['headers'] and 'fallbacks' not in tries[1]['body'], [out, len(tries)])
    out = run('unauthorized'); ok('a wrong key is explained', 'did not accept the API key' in out.get('error', '') and 'text' not in out, out)
    out = run('busy'); ok('a busy service is explained', 'busy' in out.get('error', ''), out)
    out = run('error-midway'); ok('an error part way through gives no draft', 'part way through' in out.get('error', '') and 'text' not in out, out)
    out = run('cutoff'); ok('a dropped connection gives no draft', 'closed before the draft was finished' in out.get('error', '') and 'text' not in out, out)
    out = run('refusal'); ok('a refusal is passed on as a refusal', out.get('stop') == 'refusal' and out.get('detail') == 'bio' and out.get('text') == '', out)
    out = run('toolong'); ok('a draft cut off at the length limit says so', out.get('stop') == 'max_tokens', out)
    n = len(seen)
    out = run('ok', content=[{'type': 'case_image', 'rel': '../../../etc/hosts'}]); ok('a path outside the case is refused before anything is sent', 'error' in out and len(seen) == n, out)
    out = run('ok', model='some-other-model'); ok('an unknown model is refused before anything is sent', 'error' in out and len(seen) == n, out)
    # the assistant's conversation call: history in, content blocks out exactly as sent
    tools = [{'name': 'update_trees', 'description': 'd', 'eager_input_streaming': True, 'input_schema': {'type': 'object', 'properties': {'trees': {'type': 'array'}}, 'required': ['trees']}}, {'name': 'look', 'description': 'd', 'input_schema': {'type': 'object'}}]
    history = [{'role': 'user', 'content': [{'type': 'text', 'text': 'look at photo 1'}]},
               {'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': 'earlier', 'signature': 'OLDSIG'}, {'type': 'tool_use', 'id': 'toolu_prev', 'name': 'look', 'input': {'what': 'case'}}]},
               {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'toolu_prev', 'content': [{'type': 'text', 'text': 'Photos/photo.jpg'}, {'type': 'case_image', 'rel': 'Photos/photo.jpg', 'max': 400}]}]}]
    n = len(seen); out = run('tools', messages=history, tools=tools, effort='medium', maxTokens=16000); b = seen[-1]['body'] if len(seen) > n else {}
    c = out.get('content') or []
    ok('a turn comes back as its content blocks, in order', [x.get('type') for x in c] == ['thinking', 'text', 'tool_use', 'tool_use', 'tool_use'], out)
    ok('thinking keeps its text and signature for the next turn', c and c[0] == {'type': 'thinking', 'thinking': 'Check the tree list.', 'signature': 'SIG+abc/123=='}, c[:1])
    ok('text is joined', len(c) > 1 and c[1] == {'type': 'text', 'text': 'Adding tree 4 \u2014 caf\u00e9.'}, c[1:2])
    ok('a tool call sent in pieces is put back together', len(c) > 2 and c[2] == {'type': 'tool_use', 'id': 'toolu_good', 'name': 'update_trees', 'input': {'trees': [{'tree': '4', 'species': 'Water oak', 'diameter': '21+24', 'note': 'said "fair"'}]}}, c[2:3])
    ok('a tool call whose input is not valid JSON is reported, not guessed at', len(c) > 3 and c[3].get('input') == {} and out.get('invalid') == {'toolu_bad': '{"what": "case'}, [c[3:4], out.get('invalid')])
    ok('a tool call with no input is an empty object', len(c) > 4 and c[4].get('input') == {} and 'toolu_empty' not in (out.get('invalid') or {}))
    ok('the stop reason says tools are wanted', out.get('stop') == 'tool_use' and out.get('usage', {}).get('output_tokens') == 77, out.get('stop'))
    ok('the request carries the tools and the history unchanged', b.get('tools') == tools and b.get('messages', [{}])[1:2] == history[1:2] and b.get('stream') is True and b.get('cache_control') == {'type': 'ephemeral'} and b.get('output_config') == {'effort': 'medium'} and 'thinking' not in b, {k: v for k, v in b.items() if k not in ('messages', 'tools', 'system')})
    tr = (b.get('messages') or [{}, {}, {'content': [{}]}])[2]['content'][0]
    ok('a picture inside a tool result is read from the case', tr.get('tool_use_id') == 'toolu_prev' and tr['content'][0] == {'type': 'text', 'text': 'Photos/photo.jpg'} and tr['content'][1]['source']['media_type'] == 'image/jpeg' and base64.b64decode(tr['content'][1]['source']['data'])[:2] == b'\xff\xd8', str(tr)[:200])
    n = len(seen); out = run('tools', messages=[{'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'x', 'content': [{'type': 'case_image', 'rel': '../../etc/hosts'}]}]}], tools=tools)
    ok('a picture outside the case is refused before anything is sent', 'error' in out and len(seen) == n, out)
    bad = os.path.join(tmp, 'elsewhere.json'); json.dump({'url': 'https://example.com/v1/messages', 'path': case}, open(bad, 'w'))
    r = subprocess.run([EXE, '--aitest', bad], capture_output=True, text=True, timeout=30)
    ok('the test mode only talks to this Mac', r.returncode == 2 and 'not on this Mac' in r.stdout, r.stdout[:200])
    server.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    print('%d passed, %d failed' % (passed, failed)); sys.exit(1 if failed else 0)

if __name__ == '__main__': main()
