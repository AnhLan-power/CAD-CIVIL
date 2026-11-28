/* =========================================================================================
 * TRẮC DỌC CẤP THOÁT NƯỚC (SVG) — bảng số liệu giống bản vẽ mẫu
 *
 *  THOÁT NƯỚC: Cao độ nền hoàn thiện / tự nhiên / đỉnh ga / đáy ga / đỉnh cống / đáy cống / chiều cao ga /
 *              chiều dài - đường kính - độ dốc / góc quay mặt bằng / tên hố ga.
 *  CẤP NƯỚC:   Cao độ via hè / đáy ống / chiều sâu chôn / dốc dọc đáy ống (ô chéo i% & L) / đường kính ống /
 *              khoảng cách lẻ / cộng dồn / tên cọc / góc quay mặt bằng; phụ kiện ghi chú phía trên mặt đất.
 *  Tỉ lệ ngang (1/X), đứng (1/Y) chỉnh được; xuất SVG / PNG; nền tối hoặc nền trắng (để in).
 * ========================================================================================= */

let pnProfileNet = null;
const pnProfOpts = { sx: 1000, sy: 200, zoom: 8, white: false };
const PNP_THEMES = {
    dark:  { bg: '#1c2530', text: '#e8eef5', grid: '#19d419', yellow: '#ffe74c', red: '#ff4545', cyan: '#31c5ff', green: '#55ff6a', gray: '#8a96a3', blue: '#4aa3ff', pipeFill: 'rgba(255,231,76,0.12)' },
    light: { bg: '#ffffff', text: '#111111', grid: '#0a8a0a', yellow: '#8a6d00', red: '#c62828', cyan: '#0277bd', green: '#1b7f2a', gray: '#777777', blue: '#1155cc', pipeFill: 'rgba(138,109,0,0.10)' }
};
const pnXml = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pnF2 = v => (v === null || v === undefined || isNaN(v)) ? '-' : pnRound2(v).toFixed(2);
function pnDegMin(deg) { const d = Math.floor(deg + 1e-9), m = Math.round((deg - d) * 60); return m === 60 ? `${d + 1}d00'` : `${d}d${String(m).padStart(2, '0')}'`; }

/** Dựng SVG trắc dọc của 1 tuyến. Trả về { svg, width, height }. */
function pnProfileSVG(net, o) {
    const th = PNP_THEMES[o.white ? 'light' : 'dark'];
    const calc = pnCompute(net), nodes = net.nodes, pipes = net.pipes, N = nodes.length, drain = net.kind === 'drain';
    const mm = o.zoom, ppmX = mm * 1000 / o.sx, ppmY = mm * 1000 / o.sy;
    const L0 = 230, padL = 70, padR = 70, x0 = L0 + padL;
    const dataW = Math.max(200, calc.total * ppmX);
    const W = x0 + dataW + padR;
    const xs = calc.nodes.map(c => x0 + c.station * ppmX);
    // ---- khoảng cao độ ----
    let zs = [];
    calc.nodes.forEach((c, i) => { zs.push(c.fin); if (c.nat !== null) zs.push(c.nat); if (drain) { zs.push(c.bottom); } else zs.push(c.inv); });
    const zmin = Math.min(...zs), zmax = Math.max(...zs);
    const step = (zmax - zmin) > 12 ? 2 : 1;
    const aMin = Math.floor((zmin - 0.8) / step) * step, aMax = Math.ceil((zmax + (drain ? 0.8 : 2.2)) / step) * step;
    const titleH = 86, chartTop = titleH, chartH = (aMax - aMin) * ppmY, chartBot = chartTop + chartH;
    const yOf = z => chartTop + (aMax - z) * ppmY;
    const out = [];
    const T = (x, y, txt, p) => {
        p = p || {};
        out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${p.fill || th.text}" font-size="${p.size || 12}" text-anchor="${p.anchor || 'middle'}"${p.weight ? ` font-weight="${p.weight}"` : ''}${p.rot !== undefined ? ` transform="rotate(${p.rot} ${x.toFixed(1)} ${y.toFixed(1)})"` : ''} dominant-baseline="${p.base || 'central'}">${pnXml(txt)}</text>`);
    };
    const Ln = (x1, y1, x2, y2, c, w, dash) => out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${c}" stroke-width="${w || 1}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    const Rc = (x, y, w, h, stroke, fill, sw, rx) => out.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill || 'none'}" stroke="${stroke || 'none'}" stroke-width="${sw || 1}"${rx ? ` rx="${rx}"` : ''}/>`);
    const Pl = (pts, c, w, dash, fill) => out.push(`<polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="${fill || 'none'}" stroke="${c}" stroke-width="${w || 1}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);

    // ---- tiêu đề ----
    const midX = x0 + dataW / 2;
    Rc(midX - 170, 14, 340, 52, '#ff7a7a', 'none', 1.5);
    T(midX, 31, `Trắc dọc ${drain ? 'thoát nước' : 'cấp nước'} ${net.name.replace(/^Tuyến (thoát|cấp) nước\s*/i, 'tuyến ')}`, { fill: '#ff8a8a', size: 15, weight: 'bold' });
    T(midX, 52, `Tỷ lệ X: 1/${o.sx}  Y: 1/${o.sy}`, { fill: '#ff8a8a', size: 13, weight: 'bold' });

    // ---- trục cao độ ----
    Ln(x0 - 24, chartTop, x0 - 24, chartBot, th.green, 1);
    for (let z = aMin; z <= aMax + 1e-9; z += step) {
        const y = yOf(z);
        Ln(x0 - 28, y, x0 - 20, y, th.green, 1);
        T(x0 - 32, y, String(z), { anchor: 'end', fill: th.green, size: 12 });
    }
    T(L0 - 20, chartTop + chartH / 2, 'Cao độ (m)', { fill: th.blue, size: 14, rot: -90 });

    // ---- đường dóng đứng qua bảng ----
    // (vẽ sau khi biết chiều cao bảng) -> lưu lại chỉ số để chèn
    const vertIdx = out.length;

    // ---- mặt đất / ống ----
    const natPts = [], finPts = [];
    calc.nodes.forEach((c, i) => { if (c.nat !== null) natPts.push([xs[i], yOf(c.nat)]); finPts.push([xs[i], yOf(c.fin)]); });
    const legend = [];
    if (drain) {
        if (natPts.length > 1) Pl(natPts, th.green, 1.5, '6 4');
        Pl(finPts, th.red, 1.8);
        // cống: 2 đường (đỉnh/đáy) + nền mờ
        const mhw = 14;
        pipes.forEach((p, i) => {
            const c = calc.pipes[i], xa = xs[i] + mhw / 2, xb = xs[i + 1] - mhw / 2;
            const ya1 = yOf(c.crownA), yb1 = yOf(c.crownB), ya2 = yOf(c.invA), yb2 = yOf(c.invB);
            out.push(`<polygon points="${xa},${ya1} ${xb},${yb1} ${xb},${yb2} ${xa},${ya2}" fill="${th.pipeFill}" stroke="none"/>`);
            Ln(xa, ya1, xb, yb1, th.yellow, 1.4); Ln(xa, ya2, xb, yb2, th.green, 1.4);
        });
        calc.nodes.forEach((c, i) => {
            Rc(xs[i] - mhw / 2, yOf(c.top), mhw, Math.max(2, yOf(c.bottom) - yOf(c.top)), th.cyan, 'none', 1.6);
            out.push(`<circle cx="${xs[i].toFixed(1)}" cy="${yOf(c.top).toFixed(1)}" r="2.5" fill="${th.red}"/>`);
        });
        legend.push([th.yellow, 'Đường đỉnh cống'], [th.green, 'Đường đáy cống'], [th.red, 'Mặt đất hoàn thiện'], [th.green, 'Mặt đất tự nhiên (nét đứt)']);
    } else {
        if (natPts.length > 1) Pl(natPts, th.green, 1.5, '6 4');
        Pl(finPts, th.green, 1.5, '6 4');
        Pl(calc.nodes.map((c, i) => [xs[i], yOf(c.inv)]), th.yellow, 2.2);
        // phụ kiện: đường dóng + nhãn xen kẽ độ cao để không chồng nhau
        let k = 0;
        nodes.forEach((n, i) => {
            const c = calc.nodes[i], yTop = yOf(c.fin);
            out.push(`<circle cx="${xs[i].toFixed(1)}" cy="${yOf(c.inv).toFixed(1)}" r="3" fill="${th.red}"/>`);
            if (n.kind === 'fitting' && n.fitting) {
                const dn = (pipes[Math.min(i, pipes.length - 1)] || {}).dn || net.params.dn, d2 = n.dn2 || dn;
                const text = n.label || PN_FITTINGS[n.fitting].label(dn, d2);
                const yl = yTop - 22 - (k++ % 3) * 20;
                Ln(xs[i], yTop, xs[i], yl, th.text, 0.8);
                Ln(xs[i], yl, xs[i] + 20, yl, th.text, 0.8);
                T(xs[i] + 22, yl, text, { anchor: 'start', size: 11, fill: th.text });
            }
        });
        legend.push([th.yellow, 'Đáy ống'], [th.green, 'Mặt đất / via hè (nét đứt)']);
    }
    // chú giải
    legend.forEach((lg, i) => { const lx = W - padR - 200, ly = 20 + i * 17; Ln(lx, ly, lx + 22, ly, lg[0], 2); T(lx + 28, ly, lg[1], { anchor: 'start', size: 11 }); });

    // ---- bảng số liệu ----
    const rows = [];
    const vals = (get, fill, fmt) => ({ vals: get, fill, fmt: fmt || pnF2 });
    if (drain) {
        rows.push({ label: 'CAO ĐỘ NỀN HOÀN THIỆN (m)', h: 60, kind: 'vals', get: i => [calc.nodes[i].fin], fill: th.red });
        rows.push({ label: 'CAO ĐỘ TỰ NHIÊN (m)', h: 60, kind: 'vals', get: i => [calc.nodes[i].nat], fill: th.yellow });
        rows.push({ label: 'CAO ĐỘ ĐỈNH GA (m)', h: 60, kind: 'vals', get: i => [calc.nodes[i].top], fill: th.yellow });
        rows.push({ label: 'CAO ĐỘ ĐÁY GA (m)', h: 60, kind: 'vals', get: i => [calc.nodes[i].bottom], fill: th.yellow });
        rows.push({ label: 'CAO ĐỘ ĐỈNH CỐNG (m)', h: 66, kind: 'pair', a: i => calc.nodes[i].crownIn, b: i => calc.nodes[i].crownOut, fill: th.yellow });
        rows.push({ label: 'CAO ĐỘ ĐÁY CỐNG (m)', h: 66, kind: 'pair', a: i => calc.nodes[i].invIn, b: i => calc.nodes[i].invOut, fill: th.yellow });
        rows.push({ label: 'CHIỀU CAO GA (m)', h: 54, kind: 'vals', get: i => [calc.nodes[i].height], fill: th.yellow });
        rows.push({ label: 'CHIỀU DÀI (m) - ĐƯỜNG KÍNH (mm) \\ ĐỘ DỐC (%)', h: 104, kind: 'pipeinfo' });
        rows.push({ label: 'GÓC QUAY MẶT BẰNG (°)', h: 44, kind: 'angle' });
        rows.push({ label: 'TÊN HỐ GA', h: 46, kind: 'names' });
    } else {
        rows.push({ label: 'Cao độ via hè (m)', h: 60, kind: 'vals', get: i => [calc.nodes[i].fin], fill: th.yellow });
        rows.push({ label: 'Cao độ đáy ống (m)', h: 60, kind: 'vals', get: i => [calc.nodes[i].inv], fill: th.cyan });
        rows.push({ label: 'Chiều sâu chôn ống (m)', h: 54, kind: 'vals', get: i => [-calc.nodes[i].depth], fill: th.text });
        rows.push({ label: 'Dốc dọc đáy ống (%)', h: 56, kind: 'diag' });
        rows.push({ label: 'Đường kính ống (mm)', h: 38, kind: 'dn' });
        rows.push({ label: 'Khoảng cách lẻ (m)', h: 50, kind: 'seglen' });
        rows.push({ label: 'Khoảng cách cộng dồn (m)', h: 62, kind: 'vals', get: i => [calc.nodes[i].station], fill: th.green });
        rows.push({ label: 'Tên cọc', h: 62, kind: 'names2' });
        rows.push({ label: 'Góc quay mặt bằng', h: 52, kind: 'angle2' });
    }
    let y = chartBot + 8;
    const tableTop = y;
    const gridC = th.grid;
    const xEnd = x0 + dataW + padR - 20, xL = L0 - 230 + 30;
    rows.forEach(r => {
        const y1 = y, y2 = y + r.h, yc = (y1 + y2) / 2;
        Ln(xL, y1, xEnd, y1, gridC, 1.3);
        T(xL + 8, yc, r.label, { anchor: 'start', size: 12, fill: th.green });
        if (r.kind === 'vals') {
            xs.forEach((x, i) => { const v = r.get(i)[0]; if (v !== null && v !== undefined) T(x, yc, pnF2(v), { rot: -90, fill: r.fill, size: 12, weight: 'bold' }); });
        } else if (r.kind === 'pair') {
            xs.forEach((x, i) => {
                const a = r.a(i), b = r.b(i);
                if (a !== null && a !== undefined) T(x - 7, yc, pnF2(a), { rot: -90, fill: r.fill, size: 12, weight: 'bold' });
                if (b !== null && b !== undefined) T(x + 7, yc, pnF2(b), { rot: -90, fill: r.fill, size: 12, weight: 'bold' });
            });
        } else if (r.kind === 'pipeinfo') {
            xs.forEach(x => Ln(x, y1, x, y2, '#ff9a4d', 1.2));
            pipes.forEach((p, i) => {
                const c = calc.pipes[i], mx = (xs[i] + xs[i + 1]) / 2;
                // 2 dòng song song, nghiêng -62° (như bản vẽ mẫu): L-D ở dòng trên, độ dốc ở dòng dưới
                T(mx - 6, yc + 3, `L=${c.len.toFixed(2)}m-D${p.dn}`, { rot: -62, fill: th.blue, size: 11, weight: 'bold' });
                T(mx + 7, yc - 3, `i=${p.slope.toFixed(2)}%`, { rot: -62, fill: th.blue, size: 11, weight: 'bold' });
            });
        } else if (r.kind === 'angle') {
            xs.forEach((x, i) => T(x, yc, `G:${calc.nodes[i].angle.toFixed(0)}°`, { fill: th.text, size: 12, weight: 'bold' }));
        } else if (r.kind === 'names') {
            xs.forEach((x, i) => {
                const w = Math.max(54, nodes[i].name.length * 7.5 + 16);
                Rc(x - w / 2, yc - 11, w, 22, th.red, 'none', 1.4, 11);
                T(x, yc, nodes[i].name, { fill: th.red, size: 12, weight: 'bold' });
            });
        } else if (r.kind === 'diag') {
            pipes.forEach((p, i) => {
                const xa = xs[i], xb = xs[i + 1], c = calc.pipes[i];
                Ln(xa, y2, xb, y1, th.text, 1);
                T(xa + (xb - xa) * 0.30, y1 + r.h * 0.28, `${Math.abs(c.slope).toFixed(2)}%`, { size: 11, fill: th.yellow });
                T(xa + (xb - xa) * 0.68, y2 - r.h * 0.26, c.len.toFixed(2), { size: 11, fill: th.text });
            });
            xs.forEach(x => Ln(x, y1, x, y2, th.text, 0.8));
        } else if (r.kind === 'dn') {
            // gộp các đoạn liên tiếp cùng DN + vật liệu
            let i = 0;
            while (i < pipes.length) {
                let j = i;
                while (j + 1 < pipes.length && pipes[j + 1].dn === pipes[i].dn && pipes[j + 1].material === pipes[i].material) j++;
                T((xs[i] + xs[j + 1]) / 2, yc, `ỐNG ${pipes[i].material} DN${pipes[i].dn}`, { fill: th.text, size: 12, weight: 'bold' });
                Ln(xs[i], y1, xs[i], y2, th.text, 0.8); Ln(xs[j + 1], y1, xs[j + 1], y2, th.text, 0.8);
                i = j + 1;
            }
        } else if (r.kind === 'seglen') {
            pipes.forEach((p, i) => {
                const wpx = xs[i + 1] - xs[i], txt = calc.pipes[i].len.toFixed(2);
                if (wpx > 44) T((xs[i] + xs[i + 1]) / 2, yc, txt, { size: 12, fill: th.text });
                else T((xs[i] + xs[i + 1]) / 2, yc, txt, { size: 11, fill: th.text, rot: -90 });
            });
            xs.forEach(x => Ln(x, y1, x, y2, th.text, 0.8));
        } else if (r.kind === 'names2') {
            xs.forEach((x, i) => T(x, yc, nodes[i].name, { rot: -90, fill: th.green, size: 12, weight: 'bold' }));
        } else if (r.kind === 'angle2') {
            Ln(x0, yc + 8, xs[N - 1], yc + 8, th.green, 2);
            for (let i = 1; i < N - 1; i++) {
                const a = nodes[i - 1], b = nodes[i], c = nodes[i + 1];
                const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
                const dev = 180 - calc.nodes[i].angle;
                if (dev < 0.01) continue;
                const up = cross > 0 ? -1 : 1;
                Pl([[xs[i] - 12, yc + 8], [xs[i], yc + 8 + up * 16], [xs[i] + 12, yc + 8]], th.green, 2);
                T(xs[i], yc + 8 + up * 28, pnDegMin(dev), { size: 11, fill: th.text });
            }
        }
        y = y2;
    });
    const tableBot = y;
    Ln(xL, tableBot, xEnd, tableBot, gridC, 1.3);
    Ln(xL, tableTop, xL, tableBot, gridC, 1.3);
    Ln(xEnd, tableTop, xEnd, tableBot, gridC, 1.3);
    Ln(L0 + 10, tableTop, L0 + 10, tableBot, gridC, 1.3);
    // đường dóng đứng từ chart xuống bảng (chèn dưới các nét khác)
    const vlines = xs.map(x => `<line x1="${x.toFixed(1)}" y1="${chartTop}" x2="${x.toFixed(1)}" y2="${tableBot}" stroke="${th.gray}" stroke-width="0.8"/>`);
    out.splice(vertIdx, 0, ...vlines);
    const H = tableBot + 30;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" font-family="Arial, 'Times New Roman', sans-serif"><rect width="100%" height="100%" fill="${th.bg}"/>${out.join('')}</svg>`;
    return { svg, width: Math.ceil(W), height: Math.ceil(H) };
}

// ------------------------------------------------------------------------------------------
// Bảng hiển thị trắc dọc (nổi, kéo/đổi cỡ được)
// ------------------------------------------------------------------------------------------
function pnEnsureProfilePanel() {
    let el = document.getElementById('pn-profile');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pn-profile';
    el.innerHTML = `<div class="panel-header"><span id="pn-prof-title">📈 Trắc dọc</span><button class="close-btn" id="pn-prof-close" title="Đóng">✕</button></div>
        <div class="pn-prof-bar">
            <label>Tỉ lệ X 1/<input id="pn-prof-sx" class="pn-in" value="${pnProfOpts.sx}" style="width:52px"></label>
            <label>Y 1/<input id="pn-prof-sy" class="pn-in" value="${pnProfOpts.sy}" style="width:46px"></label>
            <label>Phóng <input id="pn-prof-zoom" class="pn-in" value="${pnProfOpts.zoom}" style="width:34px" title="px trên mỗi mm giấy"></label>
            <label><input type="checkbox" id="pn-prof-white"> Nền trắng</label>
            <button id="pn-prof-svg">⬇ SVG</button><button id="pn-prof-png">⬇ PNG</button>
        </div>
        <div class="pn-prof-view" id="pn-prof-view"></div>`;
    document.body.appendChild(el);
    el.addEventListener('keydown', e => e.stopPropagation());
    document.getElementById('pn-prof-close').onclick = () => { el.style.display = 'none'; };
    const upd = () => {
        const sx = parseFloat(document.getElementById('pn-prof-sx').value), sy = parseFloat(document.getElementById('pn-prof-sy').value), z = parseFloat(document.getElementById('pn-prof-zoom').value);
        if (sx > 0) pnProfOpts.sx = sx; if (sy > 0) pnProfOpts.sy = sy; if (z > 0) pnProfOpts.zoom = z;
        pnProfOpts.white = document.getElementById('pn-prof-white').checked;
        pnProfileRefresh();
    };
    ['pn-prof-sx', 'pn-prof-sy', 'pn-prof-zoom', 'pn-prof-white'].forEach(id => document.getElementById(id).addEventListener('change', upd));
    document.getElementById('pn-prof-svg').onclick = () => pnProfileDownload('svg');
    document.getElementById('pn-prof-png').onclick = () => pnProfileDownload('png');
    if (window.cadMakeFloating) window.cadMakeFloating(el);
    return el;
}
function pnOpenProfile(net) {
    if (!net || net.nodes.length < 2) { setCommandText('Command: Tuyến cần ít nhất 2 điểm để vẽ trắc dọc.'); return; }
    pnProfileNet = net;
    const el = pnEnsureProfilePanel();
    el.style.display = 'flex';
    if (window.cadBringToFront) cadBringToFront(el);
    pnProfileRefresh();
}
function pnProfileRefresh() {
    const el = document.getElementById('pn-profile');
    if (!el || el.style.display === 'none' || !pnProfileNet) return;
    if (!pipeNets.includes(pnProfileNet) || pnProfileNet.nodes.length < 2) { document.getElementById('pn-prof-view').innerHTML = '<div class="pn-empty">Tuyến không còn đủ điểm.</div>'; return; }
    const r = pnProfileSVG(pnProfileNet, pnProfOpts);
    document.getElementById('pn-prof-title').textContent = `📈 Trắc dọc — ${pnProfileNet.name}`;
    document.getElementById('pn-prof-view').innerHTML = r.svg;
    pnProfileNet._lastSvg = r;
}
function pnProfileDownload(fmt) {
    const net = pnProfileNet; if (!net) return;
    const r = pnProfileSVG(net, pnProfOpts), name = 'trac-doc-' + net.name.replace(/[^\w\-]+/g, '_');
    const save = (blob, fn) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
    if (fmt === 'svg') { save(new Blob([r.svg], { type: 'image/svg+xml' }), name + '.svg'); return; }
    const img = new Image();
    img.onload = () => {
        const sc = 2, cv = document.createElement('canvas');
        cv.width = r.width * sc; cv.height = r.height * sc;
        const ctx = cv.getContext('2d'); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0);
        cv.toBlob(b => save(b, name + '.png'), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
}
