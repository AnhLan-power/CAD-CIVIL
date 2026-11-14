/* =========================================================================================
 * QUẢN LÝ XREF (tham chiếu ngoài) — lệnh XR / XREF, giống bảng External References của AutoCAD
 *
 *  - Nhận diện xref trong DWG/DXF (khối có cờ xref hoặc khối rỗng bị chèn), liệt kê trạng thái,
 *    đường dẫn lưu, số lần chèn; xref lồng trong xref hiển thị thụt vào.
 *  - Trình duyệt KHÔNG đọc được đường dẫn trên máy (D:\...), nên người dùng chọn file xref (DWG/DXF) hoặc cả
 *    thư mục; app tự ghép theo tên file rồi đưa hình học vào đúng vị trí chèn (lớp "TênXref|TênLớp").
 *  - Thao tác: Attach (thêm xref mới), Nạp file/thư mục (tự ghép tên), Đổi file, Reload, Detach (gỡ).
 *  Mọi thay đổi dựng lại bản vẽ nhập nhưng GIỮ khung nhìn và các đối tượng đã chỉnh sửa.
 * ========================================================================================= */

let xrefSelected = new Set();
let xrefBusy = '';

const xrefNorm = s => String(s || '').replace(/^.*[\\/]/, '').replace(/\.(dwg|dxf)$/i, '').toLowerCase().replace(/[\s_\-]+/g, ' ').trim();

function xrefVisibleList() {
    if (!importSession) return [];
    const all = Array.from(importSession.xrefs.values()).filter(r => !importSession.detached.has(r.name));
    // Xref gốc trước, xref lồng ngay sau xref cha
    const roots = all.filter(r => !r.parent || !importSession.xrefs.has(r.parent));
    const out = [];
    const add = (r, level) => { out.push({ rec: r, level }); all.filter(c => c.parent === r.name).forEach(c => add(c, level + 1)); };
    roots.forEach(r => add(r, 0));
    all.forEach(r => { if (!out.some(o => o.rec === r)) out.push({ rec: r, level: 0 }); });
    return out;
}

async function xrefLoadFile(rec, file) {
    rec.error = '';
    try {
        const buf = await file.arrayBuffer();
        let text;
        if (/\.dwg$/i.test(file.name)) {
            if (typeof DwgWasm === 'undefined') throw new Error('Chưa có bộ đọc DWG (thiếu js/15-dwg-wasm.js / wasm/dwg_bridge.wasm).');
            text = (await DwgWasm.convert(buf)).dxfText;
        } else {
            text = new TextDecoder('utf-8').decode(buf);
        }
        rec.dxf = new DxfParser().parseSync(text);
        rec.raw = text; rec.file = file; rec.fileName = file.name; rec.loaded = true; rec.scope = null;
    } catch (e) {
        rec.loaded = false; rec.error = e.message || String(e);
        console.error('Lỗi nạp xref', rec.name, e);
    }
}

function xrefApply(message) {
    if (!importSession) return;
    renderOptimized2D(null, null, null, null, { session: importSession, keepView: true });
    xrefRender();
    if (message) setCommandText('Command: ' + message);
}

function xrefStatus(msg) { xrefBusy = msg || ''; const el = document.getElementById('xref-status'); if (el) el.textContent = xrefBusy; }

/** Ghép danh sách file với các xref chưa nạp (theo tên), nạp, dựng lại; lặp lại để bắt cả xref lồng. */
async function xrefResolveFiles(files) {
    files = Array.from(files).filter(f => /\.(dwg|dxf)$/i.test(f.name));
    if (!importSession || !files.length) return;
    let loadedCount = 0;
    for (let round = 0; round < 6; round++) {
        const pending = Array.from(importSession.xrefs.values()).filter(r => !r.loaded && !importSession.detached.has(r.name));
        let progress = 0;
        for (const rec of pending) {
            const keys = [xrefNorm(rec.name), xrefNorm(rec.path)].filter(Boolean);
            const f = files.find(file => keys.includes(xrefNorm(file.name)));
            if (f) { xrefStatus(`Đang nạp ${f.name}...`); await new Promise(r => setTimeout(r, 20)); await xrefLoadFile(rec, f); if (rec.loaded) { progress++; loadedCount++; } }
        }
        if (!progress) break;
        xrefApply();
    }
    xrefStatus('');
    const left = Array.from(importSession.xrefs.values()).filter(r => !r.loaded && !importSession.detached.has(r.name)).length;
    xrefApply(loadedCount ? `Đã nạp ${loadedCount} xref${left ? `, còn ${left} xref chưa tìm thấy file` : ''}.` : 'Không file nào khớp tên với xref chưa nạp.');
}

async function xrefChangeFile(rec, file) {
    xrefStatus(`Đang nạp ${file.name}...`);
    await new Promise(r => setTimeout(r, 20));
    await xrefLoadFile(rec, file);
    xrefStatus('');
    xrefApply(rec.loaded ? `Đã nạp xref "${rec.name}" từ ${file.name}.` : `Lỗi nạp xref "${rec.name}": ${rec.error}`);
}

async function xrefAttachFiles(files) {
    files = Array.from(files).filter(f => /\.(dwg|dxf)$/i.test(f.name));
    if (!importSession) { setCommandText('Command: Hãy mở 1 bản vẽ (DXF/DWG) trước rồi mới Attach xref.'); return; }
    for (const file of files) {
        let name = file.name.replace(/\.(dwg|dxf)$/i, ''), base = name, k = 2;
        while (importSession.xrefs.has(name)) name = `${base} (${k++})`;
        const rec = impNewXrefRec(name, file.name, 'Attach', null, false);
        rec.manual = true;
        importSession.xrefs.set(name, rec);
        importSession.detached.delete(name);
        importSession.extraInserts.push({ name, position: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0 });
        xrefStatus(`Đang nạp ${file.name}...`);
        await new Promise(r => setTimeout(r, 20));
        await xrefLoadFile(rec, file);
    }
    xrefStatus('');
    xrefApply(`Đã Attach ${files.length} xref (chèn tại 0,0, tỉ lệ 1, góc 0).`);
}

async function xrefReloadSelected() {
    const targets = xrefVisibleList().map(o => o.rec).filter(r => xrefSelected.size ? xrefSelected.has(r.name) : true).filter(r => r.file);
    if (!targets.length) { setCommandText('Command: Không có xref nào đã nạp file để Reload (chọn file bằng "Nạp file…" trước).'); return; }
    for (const rec of targets) { xrefStatus(`Reload ${rec.name}...`); await new Promise(r => setTimeout(r, 20)); await xrefLoadFile(rec, rec.file); }
    xrefStatus('');
    xrefApply(`Đã Reload ${targets.length} xref.`);
}

function xrefDetachSelected() {
    if (!importSession || !xrefSelected.size) { setCommandText('Command: Chọn xref cần Detach trong bảng.'); return; }
    xrefSelected.forEach(name => {
        importSession.detached.add(name);
        importSession.extraInserts = importSession.extraInserts.filter(i => i.name !== name);
    });
    const n = xrefSelected.size;
    xrefSelected.clear();
    xrefApply(`Đã Detach ${n} xref.`);
}

// ---------------------------------- Giao diện bảng XR ----------------------------------
function xrefEnsurePanel() {
    let panel = document.getElementById('xref-panel');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'xref-panel';
    panel.className = 'xref-panel';
    panel.innerHTML = `
        <div class="xref-header" id="xref-header"><span>External References — Tham chiếu ngoài (XR)</span><button id="xref-close" title="Đóng">✕</button></div>
        <div class="xref-toolbar">
            <button id="xref-attach" title="Thêm 1 file DWG/DXF làm xref mới (chèn tại 0,0)">➕ Attach…</button>
            <button id="xref-load-files" title="Chọn nhiều file xref — tự ghép theo tên">📄 Nạp file xref…</button>
            <button id="xref-load-folder" title="Chọn cả thư mục chứa xref — tự ghép theo tên">📁 Nạp từ thư mục…</button>
            <button id="xref-change" title="Chọn file khác cho xref đang chọn">🔁 Đổi file…</button>
            <button id="xref-reload" title="Đọc lại file của xref đang chọn (hoặc tất cả)">⟳ Reload</button>
            <button id="xref-detach" title="Gỡ xref đang chọn khỏi bản vẽ">🗑 Detach</button>
            <span id="xref-status" class="xref-status"></span>
        </div>
        <div class="xref-table-wrap"><table class="xref-table" id="xref-table"></table></div>
        <div class="xref-details" id="xref-details"></div>
        <input type="file" id="xref-input-attach" accept=".dwg,.dxf" multiple style="display:none">
        <input type="file" id="xref-input-files" accept=".dwg,.dxf" multiple style="display:none">
        <input type="file" id="xref-input-folder" webkitdirectory multiple style="display:none">
        <input type="file" id="xref-input-change" accept=".dwg,.dxf" style="display:none">`;
    document.body.appendChild(panel);

    document.getElementById('xref-close').onclick = xrefClosePanel;
    const pick = id => document.getElementById(id);
    pick('xref-attach').onclick = () => pick('xref-input-attach').click();
    pick('xref-load-files').onclick = () => pick('xref-input-files').click();
    pick('xref-load-folder').onclick = () => pick('xref-input-folder').click();
    pick('xref-change').onclick = () => {
        if (xrefSelected.size !== 1) { setCommandText('Command: Chọn đúng 1 xref trong bảng để đổi file.'); return; }
        pick('xref-input-change').click();
    };
    pick('xref-reload').onclick = xrefReloadSelected;
    pick('xref-detach').onclick = xrefDetachSelected;
    pick('xref-input-attach').addEventListener('change', e => { const f = e.target.files; if (f.length) xrefAttachFiles(f); e.target.value = ''; });
    pick('xref-input-files').addEventListener('change', e => { const f = e.target.files; if (f.length) xrefResolveFiles(f); e.target.value = ''; });
    pick('xref-input-folder').addEventListener('change', e => { const f = e.target.files; if (f.length) xrefResolveFiles(f); e.target.value = ''; });
    pick('xref-input-change').addEventListener('change', e => {
        const f = e.target.files[0]; e.target.value = '';
        const rec = importSession && importSession.xrefs.get(Array.from(xrefSelected)[0]);
        if (f && rec) xrefChangeFile(rec, f);
    });

    // Kéo bảng bằng thanh tiêu đề
    const header = pick('xref-header');
    let drag = null;
    header.addEventListener('pointerdown', e => {
        if (e.target.id === 'xref-close') return;
        const r = panel.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', e => { if (drag) { panel.style.left = (e.clientX - drag.dx) + 'px'; panel.style.top = (e.clientY - drag.dy) + 'px'; } });
    header.addEventListener('pointerup', () => { drag = null; });
    // Không để phím tắt/chuột của bản vẽ bắt nhầm khi thao tác trong bảng
    panel.addEventListener('keydown', e => e.stopPropagation());
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    return panel;
}

function xrefOpenPanel() {
    const panel = xrefEnsurePanel();
    panel.style.display = 'flex';
    xrefRender();
}
function xrefClosePanel() {
    const panel = document.getElementById('xref-panel');
    if (panel) panel.style.display = 'none';
}

function xrefRender() {
    const panel = document.getElementById('xref-panel');
    if (!panel || panel.style.display === 'none') return;
    const table = document.getElementById('xref-table');
    const list = xrefVisibleList();
    const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    if (!importSession) {
        table.innerHTML = '<tr><td class="xref-empty">Chưa mở bản vẽ nào. Hãy mở file DXF/DWG (nút "Mở File DWG/DXF") rồi gõ XR.</td></tr>';
        document.getElementById('xref-details').textContent = '';
        return;
    }
    // Giữ lựa chọn hợp lệ
    xrefSelected = new Set(Array.from(xrefSelected).filter(n => list.some(o => o.rec.name === n)));
    let html = '<tr><th>Tên tham chiếu</th><th>Trạng thái</th><th>Loại</th><th>Số lần chèn</th><th>Đường dẫn lưu trong bản vẽ</th><th>File đã nạp</th></tr>';
    if (!list.length) html += '<tr><td colspan="6" class="xref-empty">Bản vẽ này không có tham chiếu ngoài. Dùng "Attach…" để thêm.</td></tr>';
    list.forEach(({ rec, level }) => {
        const state = rec.loaded ? '<span class="xref-ok">● Loaded</span>' : (rec.error ? '<span class="xref-bad">▲ Lỗi</span>' : '<span class="xref-bad">▲ Not found</span>');
        const guess = rec.guess ? ' <span class="xref-hint-tag" title="Khối rỗng được chèn trong bản vẽ — có thể là xref bị tách dữ liệu">(khối rỗng)</span>' : '';
        html += `<tr data-name="${esc(rec.name)}" class="${xrefSelected.has(rec.name) ? 'sel' : ''}">
            <td style="padding-left:${8 + level * 18}px">${level ? '↳ ' : ''}${esc(rec.name)}${guess}</td>
            <td>${state}</td><td>${rec.kind}</td><td>${rec.instances}</td>
            <td class="xref-path" title="${esc(rec.path)}">${esc(rec.path) || '—'}</td>
            <td class="xref-path" title="${esc(rec.fileName)}">${esc(rec.fileName) || '—'}</td></tr>`;
    });
    table.innerHTML = html;
    table.querySelectorAll('tr[data-name]').forEach(tr => {
        tr.addEventListener('click', e => {
            const n = tr.dataset.name;
            if (e.ctrlKey || e.metaKey) { if (xrefSelected.has(n)) xrefSelected.delete(n); else xrefSelected.add(n); }
            else { xrefSelected = new Set([n]); }
            xrefRender();
        });
        tr.addEventListener('dblclick', () => { xrefSelected = new Set([tr.dataset.name]); document.getElementById('xref-input-change').click(); });
    });
    const det = document.getElementById('xref-details');
    const one = xrefSelected.size === 1 ? importSession.xrefs.get(Array.from(xrefSelected)[0]) : null;
    if (one) {
        det.innerHTML = `<b>${esc(one.name)}</b> — ${one.loaded ? 'đã nạp từ <b>' + esc(one.fileName) + '</b>' : 'chưa tìm thấy file'}<br>` +
            `Đường dẫn lưu: ${esc(one.path) || '(không có)'}` + (one.parent ? `<br>Nằm trong xref: ${esc(one.parent)}` : '') +
            (one.error ? `<br><span class="xref-bad">Lỗi: ${esc(one.error)}</span>` : '') +
            (one.loaded ? '' : '<br>Trình duyệt không đọc được đường dẫn trên máy — dùng <b>Nạp file xref…</b> / <b>Nạp từ thư mục…</b> (tự ghép theo tên) hoặc <b>Đổi file…</b>.');
    } else {
        const missing = list.filter(o => !o.rec.loaded).length;
        det.innerHTML = list.length
            ? `${list.length} xref, <b>${missing}</b> chưa nạp file. Chọn thư mục chứa các file xref để nạp tự động (ghép theo tên file). Ctrl+click để chọn nhiều dòng.`
            : '';
    }
    const st = document.getElementById('xref-status'); if (st) st.textContent = xrefBusy;
}

// Lệnh XR / XREF từ dòng lệnh phím tắt (xem js/14-trim-and-events.js) và nút ribbon
function runXrefCommand() {
    xrefOpenPanel();
    setCommandText(importSession ? 'Command: XREF — bảng quản lý tham chiếu ngoài.' : 'Command: XREF — hãy mở 1 bản vẽ DXF/DWG trước.');
}

// ---------------------------------- Lệnh nhiều chữ cái (XR, XREF) ----------------------------------
// Phím tắt cũ là 1 chữ cái (L, P, C, R...). Lệnh bắt đầu bằng "X" dùng bộ đệm: gõ X rồi R, tự chạy sau ~1 giây,
// hoặc nhấn Enter ngay. Trả về true nếu phím đã được bộ đệm xử lý (không chuyển cho phím tắt thường).
let xrCmdBuf = '', xrCmdTimer = null;
const XR_COMMANDS = { xr: runXrefCommand, xref: runXrefCommand };
function xrCmdReset() { xrCmdBuf = ''; if (xrCmdTimer) { clearTimeout(xrCmdTimer); xrCmdTimer = null; } }
function xrCmdRun() {
    const fn = XR_COMMANDS[xrCmdBuf];
    const buf = xrCmdBuf;
    xrCmdReset();
    if (fn) fn(); else if (buf.length > 1) setCommandText(`Command: Lệnh "${buf.toUpperCase()}" không tồn tại.`);
    else setCommandText('Command:');
}
function xrCmdKey(event) {
    if (event.ctrlKey || event.altKey || event.metaKey) return false;
    const k = event.key;
    if (!xrCmdBuf) {
        if (k.length === 1 && k.toLowerCase() === 'x') {
            xrCmdBuf = 'x';
            setCommandText('Command: X');
            xrCmdTimer = setTimeout(xrCmdRun, 1100);
            return true;
        }
        return false;
    }
    if (k.length === 1 && /[a-z]/i.test(k)) {
        xrCmdBuf += k.toLowerCase();
        setCommandText('Command: ' + xrCmdBuf.toUpperCase());
        if (xrCmdTimer) clearTimeout(xrCmdTimer);
        xrCmdTimer = setTimeout(xrCmdRun, 1100);
        return true;
    }
    if (k === 'Enter') { xrCmdRun(); return true; }
    if (k === 'Backspace') {
        xrCmdBuf = xrCmdBuf.slice(0, -1);
        if (!xrCmdBuf) { xrCmdReset(); setCommandText('Command:'); } else setCommandText('Command: ' + xrCmdBuf.toUpperCase());
        return true;
    }
    if (k === 'Escape') { xrCmdReset(); setCommandText('Command:'); return true; }
    xrCmdReset();
    return false;
}
