/* =========================================================================================
 * CÔNG CỤ & BẢNG QUẢN LÝ MẠNG LƯỚI CẤP THOÁT NƯỚC (xem js/21-pipe-network.js)
 *  - Tuyến thoát nước (net-drain): click từng hố ga theo chiều dòng chảy.
 *  - Tuyến cấp nước (net-water): click các điểm gãy của tuyến ống.
 *  - Thêm hố ga (net-mh) / Phụ kiện (net-fit-*): click lên đoạn cống/ống (hoặc lên điểm có sẵn).
 *  - Enter / chuột phải / double-click: kết thúc tuyến; Backspace: bỏ điểm vừa vẽ; Esc: kết thúc.
 *  - Chọn bằng công cụ Select: click hố ga/cống/ống/phụ kiện -> bảng quản lý hiện đúng dòng.
 * ========================================================================================= */

let pnDraw = null;       // { net, tool } khi đang vẽ
let pnPreview = null;    // đường nối từ điểm cuối tới con trỏ

(function registerHints() {
    Object.assign(TOOL_HINTS, {
        'net-drain': 'Chọn tuyến/thông số rồi click các vị trí hố ga theo chiều dòng chảy (Enter / chuột phải / double-click: kết thúc, Backspace: bỏ điểm cuối, Esc: huỷ):',
        'net-water': 'Chọn tuyến/thông số rồi click các điểm gãy của tuyến ống cấp nước (Enter / chuột phải / double-click: kết thúc, Backspace: bỏ điểm cuối):',
        'net-mh': 'Click lên đoạn cống để thêm hố ga (hoặc lên 1 điểm của tuyến):'
    });
    Object.keys(PN_FITTINGS).forEach(k => { TOOL_HINTS['net-fit-' + k] = `Phụ kiện "${PN_FITTINGS[k].name}": click lên đoạn ống cấp nước (hoặc lên điểm của tuyến) để đặt:`; });
})();

// ---- Tiện ích hình học màn hình ----
function pnPxWorld() {
    const dist = camera.position.distanceTo(controls.target) || 1;
    return 2 * Math.tan(camera.fov * Math.PI / 360) * dist / Math.max(1, renderer.domElement.getBoundingClientRect().height);
}
function pnScreenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z || 0).project(camera), r = renderer.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top };
}
function pnSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy;
    return { d: Math.hypot(px - qx, py - qy), x: qx, y: qy, t };
}
/** Tìm node/đoạn gần điểm world (x,y) trong số các tuyến thuộc kind (hoặc mọi kind nếu null). */
function pnNearest(x, y, kind, tolWorld) {
    let best = null;
    pipeNets.forEach(net => {
        if (kind && net.kind !== kind) return;
        net.nodes.forEach((n, i) => {
            const d = Math.hypot(n.x - x, n.y - y);
            if (d <= tolWorld && (!best || d < best.d)) best = { net, type: 'node', index: i, d, x: n.x, y: n.y };
        });
    });
    if (best) return best;
    pipeNets.forEach(net => {
        if (kind && net.kind !== kind) return;
        net.pipes.forEach((p, i) => {
            const a = net.nodes[i], b = net.nodes[i + 1];
            const r = pnSegDist(x, y, a.x, a.y, b.x, b.y);
            if (r.d <= tolWorld && (!best || r.d < best.d)) best = { net, type: 'pipe', index: i, d: r.d, x: r.x, y: r.y, t: r.t };
        });
    });
    return best;
}

// ------------------------------------------------------------------------------------------
// Hộp thiết lập tuyến
// ------------------------------------------------------------------------------------------
function pnCloseSetup() { const el = document.getElementById('pn-setup'); if (el) el.remove(); }
function pnOpenSetup(kind) {
    pnCloseSetup();
    const drain = kind === 'drain';
    const existing = pipeNets.filter(n => n.kind === kind);
    const defNet = pnNewNetDefaults(kind);
    const opt = (arr, cur) => arr.map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${v}</option>`).join('');
    const box = document.createElement('div');
    box.id = 'pn-setup';
    box.className = 'pn-setup';
    box.innerHTML = `
        <div class="pn-setup-title">${drain ? '🕳 Tuyến thoát nước (cống + hố ga)' : '🚰 Tuyến cấp nước (ống + phụ kiện)'}</div>
        <div class="pn-setup-grid">
            <label>Tuyến</label><select id="pn-s-net"><option value="">+ Tuyến mới</option>${existing.map(n => `<option value="${n.id}">Nối tiếp: ${n.name}</option>`).join('')}</select>
            <label>Tên tuyến</label><input id="pn-s-name" type="text" value="${defNet.name}">
            <label>${drain ? 'Tiền tố hố ga' : 'Tiền tố cọc'}</label><input id="pn-s-prefix" type="text" value="${defNet.prefix}">
            <label>Đường kính DN (mm)</label><select id="pn-s-dn">${opt(drain ? DRAIN_DN : WATER_DN, drain ? 225 : 110)}</select>
            ${drain ? `
            <label>Độ dốc i (%)</label><input id="pn-s-slope" type="number" step="0.01" value="0.5">
            <label>Độ phủ tối thiểu (m)</label><input id="pn-s-cover" type="number" step="0.05" value="0.7">
            <label>Cao độ đáy cống đầu tuyến (m)</label><input id="pn-s-start" type="number" step="0.01" placeholder="để trống = tự tính theo độ phủ">
            <label>Độ sụt tại hố ga (m)</label><input id="pn-s-drop" type="number" step="0.01" value="0">
            <label>Nền hoàn thiện − tự nhiên (m)</label><input id="pn-s-fin" type="number" step="0.05" value="0">` : `
            <label>Vật liệu</label><input id="pn-s-mat" type="text" value="HDPE">
            <label>Chiều sâu chôn ống (m)</label><input id="pn-s-depth" type="number" step="0.05" value="0.8">`}
            <label>Cao độ nền nếu chưa có Surface (m)</label><input id="pn-s-base" type="number" step="0.01" value="0">
        </div>
        <div class="pn-setup-note">Cao độ mặt đất lấy tự động từ Surface (TIN) đang có; chưa có thì dùng giá trị trên và chỉnh từng điểm trong bảng quản lý.</div>
        <div class="pn-setup-btns"><button id="pn-s-ok">▶ Bắt đầu vẽ</button><button id="pn-s-cancel">Huỷ</button></div>`;
    document.body.appendChild(box);
    const g = id => document.getElementById(id);
    const sel = g('pn-s-net');
    sel.addEventListener('change', () => { const n = pipeNets.find(x => String(x.id) === sel.value); g('pn-s-name').disabled = !!n; g('pn-s-prefix').disabled = !!n; });
    g('pn-s-cancel').onclick = () => { pnCloseSetup(); setTool('select'); };
    g('pn-s-ok').onclick = () => {
        const num = id => { const v = parseFloat((g(id).value || '').replace(',', '.')); return isNaN(v) ? null : v; };
        let net = pipeNets.find(x => String(x.id) === sel.value);
        const params = { dn: parseInt(g('pn-s-dn').value, 10), baseGround: num('pn-s-base') || 0 };
        if (drain) Object.assign(params, { slope: num('pn-s-slope') || 0.5, minCover: num('pn-s-cover') || 0.7, startInvert: num('pn-s-start'), drop: num('pn-s-drop') || 0, finishOffset: num('pn-s-fin') || 0 });
        else Object.assign(params, { material: g('pn-s-mat').value || 'HDPE', depth: num('pn-s-depth') || 0.8 });
        if (!net) { net = pnNewNet(kind, { name: g('pn-s-name').value || undefined, params }); net.params.prefix = g('pn-s-prefix').value || net.params.prefix; }
        else Object.assign(net.params, { dn: params.dn });
        pnCloseSetup();
        pnDraw = { net, tool: activeTool };
        setCommandText(`Command: Vẽ "${net.name}" — click điểm ${net.nodes.length + 1}. (Enter/chuột phải: kết thúc, Backspace: bỏ điểm cuối)`);
    };
}
function pnNewNetDefaults(kind) {
    const idx = pipeNets.filter(n => n.kind === kind).length + 1;
    return { name: kind === 'drain' ? `Tuyến thoát nước ${idx}` : `Tuyến cấp nước ${idx}`, prefix: kind === 'drain' ? `GT${idx}.` : `T${idx}-` };
}

// ------------------------------------------------------------------------------------------
// Vẽ tuyến / thêm hố ga / phụ kiện
// ------------------------------------------------------------------------------------------
function pnClearPreview() { if (pnPreview) { scene.remove(pnPreview); pnPreview.geometry.dispose(); pnPreview = null; } }
function pnFinishDraw() {
    pnClearPreview();
    const d = pnDraw; pnDraw = null;
    if (d && d.net.nodes.length < 2) { pnDeleteNet(d.net); pnRefresh(); setTool('select'); setCommandText('Command: Tuyến cần ít nhất 2 điểm — đã huỷ.'); return; }
    setTool('select');
    if (d) {
        pnRefresh();
        pnSel = { net: d.net, type: 'node', index: 0 };
        pnOpenManager(d.net);
        setCommandText(`Command: Đã vẽ "${d.net.name}": ${d.net.nodes.length} điểm, dài ${d.net.calc.total.toFixed(1)} m. Chỉnh số liệu trong bảng quản lý hoặc bấm "Trắc dọc".`);
    }
}
function pnHandleClick(p, ev) {
    const tool = activeTool;
    if (tool === 'net-drain' || tool === 'net-water') {
        if (!pnDraw) return; // đang chờ hộp thiết lập
        const net = pnDraw.net, last = net.nodes[net.nodes.length - 1];
        if (last && Math.hypot(last.x - p.x, last.y - p.y) < pnPxWorld() * 2) return; // double-click: bỏ điểm trùng
        pnAddPoint(net, p.x, p.y);
        pnRefresh(true);
        const n = net.nodes.length;
        setCommandText(`Command: Đã thêm ${net.nodes[n - 1].name}${n > 1 ? ` — đoạn ${n - 1}: L=${net.calc.pipes[n - 2].len.toFixed(2)} m` : ''}. Click điểm kế tiếp (Enter: kết thúc).`);
        return;
    }
    const tol = pnPxWorld() * 12;
    if (tool === 'net-mh') {
        const hit = pnNearest(p.x, p.y, 'drain', tol);
        if (!hit) { setCommandText('Command: Không có đoạn cống nào gần đó — click lên đoạn cống.'); return; }
        if (hit.type === 'pipe') { pnSplitPipe(hit.net, hit.index, hit.x, hit.y, { kind: 'manhole' }); setCommandText('Command: Đã thêm hố ga.'); }
        else setCommandText('Command: Vị trí này đã là hố ga.');
        pnRefresh(true);
        return;
    }
    if (tool.indexOf('net-fit-') === 0) {
        const type = tool.slice(8);
        const hit = pnNearest(p.x, p.y, 'water', tol);
        if (!hit) { setCommandText('Command: Không có đoạn ống nào gần đó — click lên tuyến ống cấp nước.'); return; }
        if (hit.type === 'pipe') pnSplitPipe(hit.net, hit.index, hit.x, hit.y, { kind: 'fitting', fitting: type });
        else { const n = hit.net.nodes[hit.index]; n.kind = 'fitting'; n.fitting = type; n.label = ''; }
        pnRefresh(true);
        setCommandText(`Command: Đã đặt ${PN_FITTINGS[type].name}. Click tiếp để đặt thêm, Esc để thoát.`);
    }
}

// Chặn click mặc định của app khi đang dùng công cụ mạng lưới
renderer.domElement.addEventListener('click', ev => {
    if (!activeTool || activeTool.indexOf('net-') !== 0) return;
    ev.stopImmediatePropagation(); ev.preventDefault();
    const p = getWorldPoint(ev);
    if (p) pnHandleClick(p, ev);
}, true);
renderer.domElement.addEventListener('dblclick', ev => {
    if (activeTool === 'net-drain' || activeTool === 'net-water') { ev.stopImmediatePropagation(); pnFinishDraw(); }
}, true);
renderer.domElement.addEventListener('contextmenu', ev => {
    if (activeTool && activeTool.indexOf('net-') === 0) { ev.preventDefault(); ev.stopImmediatePropagation(); if (pnDraw) pnFinishDraw(); else setTool('select'); }
}, true);
renderer.domElement.addEventListener('pointermove', ev => {
    if (!pnDraw || (activeTool !== 'net-drain' && activeTool !== 'net-water')) return;
    const net = pnDraw.net, last = net.nodes[net.nodes.length - 1];
    if (!last) return;
    const p = getWorldPoint(ev);
    if (!p) return;
    pnClearPreview();
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(last.x, last.y, 0.05), new THREE.Vector3(p.x, p.y, 0.05)]);
    pnPreview = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffff00, dashSize: pnTextH(), gapSize: pnTextH() * 0.6, depthTest: false }));
    pnPreview.computeLineDistances(); pnPreview.renderOrder = 40;
    scene.add(pnPreview);
});
window.addEventListener('keydown', ev => {
    if (!activeTool || activeTool.indexOf('net-') !== 0) return;
    const t = ev.target && ev.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if (ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); if (pnDraw) pnFinishDraw(); else setTool('select'); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); if (pnDraw) pnFinishDraw(); else setTool('select'); }
    else if (ev.key === 'Backspace' && pnDraw) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        const net = pnDraw.net;
        if (net.nodes.length) { net.nodes.pop(); if (net.pipes.length) net.pipes.pop(); pnRefresh(true); setCommandText('Command: Đã bỏ điểm cuối.'); }
    }
}, true);

// Đổi công cụ: dọn trạng thái vẽ, mở hộp thiết lập khi chọn công cụ vẽ tuyến
(function wrapSetTool() {
    const orig = setTool;
    setTool = function (tool) {
        if (tool !== 'net-drain' && tool !== 'net-water') pnCloseSetup();
        if (pnDraw && tool !== pnDraw.tool) { pnClearPreview(); const d = pnDraw; pnDraw = null; if (d.net.nodes.length < 2) { pnDeleteNet(d.net); pnRefresh(); } }
        orig(tool);
        if (tool === 'net-drain') pnOpenSetup('drain');
        else if (tool === 'net-water') pnOpenSetup('water');
    };
})();

// ------------------------------------------------------------------------------------------
// Chọn bằng công cụ Select
// ------------------------------------------------------------------------------------------
function pnSelectAt(event) {
    if (!pipeNets.length) return false;
    const mx = event.clientX, my = event.clientY;
    let best = null;
    pipeNets.forEach(net => {
        net.nodes.forEach((n, i) => { const s = pnScreenOf(n.x, n.y, 0.04), d = Math.hypot(s.x - mx, s.y - my); if (d <= 14 && (!best || d < best.d)) best = { net, type: 'node', index: i, d }; });
    });
    if (!best) pipeNets.forEach(net => net.pipes.forEach((p, i) => {
        const a = pnScreenOf(net.nodes[i].x, net.nodes[i].y, 0.02), b = pnScreenOf(net.nodes[i + 1].x, net.nodes[i + 1].y, 0.02);
        const r = pnSegDist(mx, my, a.x, a.y, b.x, b.y);
        if (r.d <= 8 && (!best || r.d < best.d)) best = { net, type: 'pipe', index: i, d: r.d };
    }));
    if (!best) { if (pnSel) { pnSel = null; pnRebuildGraphics(); pnRenderManager(); } return false; }
    pnSel = { net: best.net, type: best.type, index: best.index };
    pnRebuildGraphics();
    pnOpenManager(best.net);
    const what = best.type === 'node' ? `${best.net.kind === 'drain' ? 'hố ga' : 'điểm'} ${best.net.nodes[best.index].name}` : `đoạn ${best.index + 1}`;
    setCommandText(`Command: Đã chọn ${what} của "${best.net.name}" (xem bảng quản lý).`);
    return true;
}

// ------------------------------------------------------------------------------------------
// Bảng quản lý mạng lưới
// ------------------------------------------------------------------------------------------
let pnMgrNet = null;
function pnRefresh(keepSel) {
    pipeNets.forEach(pnCompute);
    pnRebuildGraphics();
    pnRenderManager();
    if (typeof pnProfileRefresh === 'function') pnProfileRefresh();
}
function pnEnsureManager() {
    let el = document.getElementById('pn-panel');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pn-panel';
    el.innerHTML = `<div class="panel-header"><span>🚰 Mạng lưới cấp thoát nước</span><button class="close-btn" id="pn-close" title="Đóng">✕</button></div><div class="panel-body" id="pn-body"></div>`;
    document.body.appendChild(el);
    document.getElementById('pn-close').onclick = () => { el.style.display = 'none'; };
    el.addEventListener('keydown', e => e.stopPropagation());
    if (window.cadMakeFloating) window.cadMakeFloating(el);
    el.addEventListener('change', pnOnManagerChange);
    el.addEventListener('click', pnOnManagerClick);
    return el;
}
function pnOpenManager(net) {
    const el = pnEnsureManager();
    el.style.display = 'flex';
    if (window.cadBringToFront) cadBringToFront(el);
    if (net) pnMgrNet = net;
    pnRenderManager();
}
const pnInput = (f, i, v, ph, w) => `<input class="pn-in" data-f="${f}" data-i="${i}" value="${v === null || v === undefined ? '' : v}" placeholder="${ph || ''}" style="width:${w || 64}px">`;
function pnRenderManager() {
    const el = document.getElementById('pn-panel'), body = document.getElementById('pn-body');
    if (!el || !body || el.style.display === 'none') return;
    if (!pipeNets.length) { body.innerHTML = '<div class="pn-empty">Chưa có tuyến nào. Dùng tab <b>Cấp thoát nước</b> → "Tuyến thoát nước" hoặc "Tuyến cấp nước" để vẽ.</div>'; return; }
    if (!pnMgrNet || !pipeNets.includes(pnMgrNet)) pnMgrNet = pipeNets[0];
    const net = pnMgrNet, P = net.params, C = net.calc || pnCompute(net), drain = net.kind === 'drain';
    const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const dnList = drain ? DRAIN_DN : WATER_DN;
    let h = `<div class="pn-bar">
        <label>Tuyến <select id="pn-net-sel">${pipeNets.map(n => `<option value="${n.id}"${n === net ? ' selected' : ''}>${esc(n.name)} (${n.kind === 'drain' ? 'thoát nước' : 'cấp nước'})</option>`).join('')}</select></label>
        <button data-act="profile">📈 Trắc dọc</button><button data-act="recalc" title="Bỏ cao độ nhập tay, lấy lại từ Surface">↻ Lấy cao độ từ Surface</button>
        <button data-act="delnet">🗑 Xoá tuyến</button>
        <label style="margin-left:auto">Tỉ lệ vẽ 1:<input class="pn-in" id="pn-scale" value="${PN.scale}" style="width:52px"></label>
        <button data-act="save">💾 Lưu .json</button><button data-act="load">📂 Mở .json</button><input type="file" id="pn-file" accept=".json" style="display:none">
    </div>
    <div class="pn-params"><label>Tên <input class="pn-in" data-f="net.name" value="${esc(net.name)}" style="width:150px"></label>
        <label>Tiền tố <input class="pn-in" data-f="net.prefix" value="${esc(P.prefix)}" style="width:52px"></label>`;
    if (drain) h += `<label>Phủ tối thiểu <input class="pn-in" data-f="net.minCover" value="${P.minCover}" style="width:48px"> m</label>
        <label>Đáy cống đầu tuyến <input class="pn-in" data-f="net.startInvert" value="${P.startInvert === null ? '' : P.startInvert}" placeholder="auto" style="width:58px"> m</label>
        <label>Nền HT − tự nhiên <input class="pn-in" data-f="net.finishOffset" value="${P.finishOffset || 0}" style="width:48px"> m</label>`;
    else h += `<label>Chiều sâu chôn <input class="pn-in" data-f="net.depth" value="${P.depth}" style="width:48px"> m</label>`;
    h += `<label>Nền mặc định <input class="pn-in" data-f="net.baseGround" value="${P.baseGround || 0}" style="width:48px"> m</label></div>`;
    if (C.warn.length) h += `<div class="pn-warn">⚠ ${C.warn.map(esc).join(' · ')}</div>`;

    // ---- bảng node ----
    h += `<div class="pn-sec">${drain ? 'Hố ga' : 'Điểm / phụ kiện'}</div><div class="pn-wrap"><table class="pn-table"><tr><th>#</th><th>Tên</th><th>X</th><th>Y</th>`;
    h += drain ? '<th>Tự nhiên</th><th>Nền hoàn thiện</th><th>Đỉnh ga</th><th>Đáy ga</th><th>Cao ga</th><th>Độ sụt</th><th>Góc</th>'
               : '<th>Phụ kiện</th><th>Nhãn</th><th>Via hè</th><th>Sâu chôn</th><th>Đáy ống</th><th>Cộng dồn</th><th>Góc</th>';
    h += '<th></th></tr>';
    net.nodes.forEach((n, i) => {
        const c = C.nodes[i], sel = pnSel && pnSel.net === net && pnSel.type === 'node' && pnSel.index === i;
        h += `<tr class="${sel ? 'sel' : ''}" data-row="node:${i}"><td>${i + 1}</td><td>${pnInput('n.name', i, esc(n.name), '', 66)}</td><td>${n.x.toFixed(2)}</td><td>${n.y.toFixed(2)}</td>`;
        if (drain) h += `<td>${pnInput('n.natural', i, n.natural, c.nat === null ? '' : c.nat.toFixed(2))}</td><td>${pnInput('n.finished', i, n.finished, pnFmt(c.fin))}</td>
            <td class="ro">${pnFmt(c.top)}</td><td class="ro">${pnFmt(c.bottom)}</td><td class="ro">${pnFmt(c.height)}</td><td>${pnInput('n.drop', i, n.drop || 0, '', 44)}</td><td class="ro">${c.angle.toFixed(0)}°</td>`;
        else h += `<td><select class="pn-in" data-f="n.fitting" data-i="${i}"><option value="">(điểm gãy)</option>${Object.keys(PN_FITTINGS).map(k => `<option value="${k}"${n.fitting === k ? ' selected' : ''}>${PN_FITTINGS[k].name}</option>`).join('')}</select></td>
            <td>${pnInput('n.label', i, esc(n.label), n.fitting ? PN_FITTINGS[n.fitting].label((net.pipes[Math.min(i, net.pipes.length - 1)] || {}).dn || P.dn, n.dn2 || (net.pipes[Math.min(i, net.pipes.length - 1)] || {}).dn || P.dn) : '', 150)}</td>
            <td>${pnInput('n.finished', i, n.finished, pnFmt(c.fin))}</td><td>${pnInput('n.depth', i, n.depth, c.depth.toFixed(2), 52)}</td><td class="ro">${pnFmt(c.inv)}</td><td class="ro">${c.station.toFixed(2)}</td><td class="ro">${c.angle.toFixed(0)}°</td>`;
        h += `<td class="pn-act"><span data-act="zoom" data-i="${i}" title="Phóng tới điểm">🔍</span><span data-act="delnode" data-i="${i}" title="Xoá điểm">🗑</span></td></tr>`;
    });
    h += '</table></div>';

    // ---- bảng đoạn ----
    h += `<div class="pn-sec">${drain ? 'Đoạn cống' : 'Đoạn ống'}</div><div class="pn-wrap"><table class="pn-table"><tr><th>#</th><th>Từ → Đến</th><th>DN</th>${drain ? '<th>Dốc i (%)</th>' : '<th>Dốc (%)</th>'}<th>Vật liệu</th><th>L (m)</th><th>Đáy đầu</th><th>Đáy cuối</th>${drain ? '<th>Đỉnh đầu</th><th>Đỉnh cuối</th><th>Phủ min</th>' : ''}</tr>`;
    net.pipes.forEach((p, i) => {
        const c = C.pipes[i], sel = pnSel && pnSel.net === net && pnSel.type === 'pipe' && pnSel.index === i, bad = drain && c.cover < P.minCover - 1e-9;
        h += `<tr class="${sel ? 'sel' : ''}" data-row="pipe:${i}"><td>${i + 1}</td><td>${esc(net.nodes[i].name)} → ${esc(net.nodes[i + 1].name)}</td>
            <td><select class="pn-in" data-f="p.dn" data-i="${i}">${dnList.map(d => `<option value="${d}"${d === p.dn ? ' selected' : ''}>${d}</option>`).join('')}</select></td>
            <td>${drain ? pnInput('p.slope', i, p.slope, '', 52) : `<span class="ro">${Math.abs(c.slope).toFixed(2)}</span>`}</td>
            <td>${pnInput('p.material', i, esc(p.material), '', 56)}</td><td class="ro">${c.len.toFixed(2)}</td><td class="ro">${pnFmt(c.invA)}</td><td class="ro">${pnFmt(c.invB)}</td>
            ${drain ? `<td class="ro">${pnFmt(c.crownA)}</td><td class="ro">${pnFmt(c.crownB)}</td><td class="ro" style="color:${bad ? '#ff6b5b' : '#8f8'}">${pnFmt(c.cover)}</td>` : ''}</tr>`;
    });
    h += '</table></div>';
    body.innerHTML = h;
}
function pnOnManagerChange(e) {
    const el = e.target;
    if (el.id === 'pn-net-sel') { pnMgrNet = pipeNets.find(n => String(n.id) === el.value); pnSel = null; pnRebuildGraphics(); pnRenderManager(); return; }
    if (el.id === 'pn-scale') { const v = parseFloat(el.value); if (v > 0) { PN.scale = v; pnRefresh(); } return; }
    if (el.id === 'pn-file') { const f = el.files[0]; if (f) pnImportFile(f); el.value = ''; return; }
    const f = el.dataset.f; if (!f) return;
    const net = pnMgrNet, i = parseInt(el.dataset.i, 10), v = el.value.trim();
    const num = v === '' ? null : parseFloat(v.replace(',', '.'));
    const numOk = num === null || !isNaN(num);
    if (f === 'net.name') net.name = v || net.name;
    else if (f === 'net.prefix') { net.params.prefix = v; pnRenumber(net); }
    else if (f.indexOf('net.') === 0 && numOk) { const k = f.slice(4); net.params[k] = (k === 'startInvert') ? num : (num === null ? 0 : num); }
    else if (f === 'n.name') { net.nodes[i].name = v || net.nodes[i].name; net.nodes[i].custom = true; }
    else if (f === 'n.label') net.nodes[i].label = v;
    else if (f === 'n.fitting') { const n = net.nodes[i]; n.fitting = v || null; n.kind = v ? 'fitting' : 'node'; n.label = ''; }
    else if (f === 'p.dn') net.pipes[i].dn = parseInt(v, 10);
    else if (f === 'p.material') net.pipes[i].material = v;
    else if (f === 'p.slope' && numOk && num !== null) net.pipes[i].slope = num;
    else if (f.indexOf('n.') === 0 && numOk) net.nodes[i][f.slice(2)] = (f === 'n.drop') ? (num === null ? 0 : num) : num;
    pnRefresh();
}
function pnOnManagerClick(e) {
    const act = e.target.dataset && e.target.dataset.act;
    const net = pnMgrNet;
    if (act === 'profile') { if (typeof pnOpenProfile === 'function') pnOpenProfile(net); return; }
    if (act === 'recalc') { net.nodes.forEach(n => { n.natural = null; n.finished = null; }); pnRefresh(); return; }
    if (act === 'delnet') { pnDeleteNet(net); pnMgrNet = pipeNets[0] || null; pnRefresh(); return; }
    if (act === 'save') { pnExportFile(); return; }
    if (act === 'load') { document.getElementById('pn-file').click(); return; }
    if (act === 'zoom') { const n = net.nodes[parseInt(e.target.dataset.i, 10)]; pnZoomTo(n.x, n.y); return; }
    if (act === 'delnode') { pnDeleteNode(net, parseInt(e.target.dataset.i, 10)); pnMgrNet = pipeNets.includes(net) ? net : (pipeNets[0] || null); pnSel = null; pnRefresh(); return; }
    const tr = e.target.closest && e.target.closest('tr[data-row]');
    if (tr && !(e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        const [type, idx] = tr.dataset.row.split(':');
        pnSel = { net, type, index: parseInt(idx, 10) };
        pnRebuildGraphics(); pnRenderManager();
    }
}
function pnZoomTo(x, y) {
    const d = Math.max(30, camera.position.distanceTo(controls.target));
    controls.target.set(x, y, 0);
    camera.position.set(x, y - d * 0.0001, d);
    controls.update();
}

// ---- Lưu / mở JSON ----
function pnExportFile() {
    const data = { version: 1, scale: PN.scale, nets: pipeNets.map(n => ({ kind: n.kind, name: n.name, color: n.color, params: n.params, nodes: n.nodes, pipes: n.pipes })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = 'mang-luoi-cap-thoat-nuoc.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function pnImportFile(file) {
    file.text().then(t => {
        try {
            const d = JSON.parse(t);
            pipeNets = d.nets.map(n => ({ id: pnIdCounter++, kind: n.kind, name: n.name, color: n.color, params: n.params, nodes: n.nodes, pipes: n.pipes }));
            if (d.scale) PN.scale = d.scale;
            pnMgrNet = pipeNets[0] || null; pnSel = null;
            pnRefresh();
            setCommandText(`Command: Đã mở ${pipeNets.length} tuyến từ ${file.name}.`);
        } catch (err) { setCommandText('Command: File không hợp lệ: ' + err.message); }
    });
}
