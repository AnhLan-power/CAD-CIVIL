/* =========================================================================================
 * MẠNG LƯỚI CẤP THOÁT NƯỚC (kiểu Việt Nam)
 *
 *  - THOÁT NƯỚC: tuyến cống + hố ga. Mỗi hố ga có cao độ tự nhiên, cao độ nền hoàn thiện (= đỉnh ga), đáy ga, chiều cao ga;
 *    mỗi đoạn cống có đường kính DN, độ dốc i (%), chiều dài L, cao độ đáy/đỉnh cống hai đầu (đỉnh = đáy + DN).
 *  - CẤP NƯỚC: tuyến ống + phụ kiện (van, tê, co, trụ cứu hoả TNCC, đồng hồ, bịt, côn, xả cặn...). Cao độ đáy ống = cao độ
 *    via hè − chiều sâu chôn ống; hiển thị dốc dọc, khoảng cách lẻ / cộng dồn, góc quay mặt bằng.
 *  - Cao độ mặt đất lấy từ Surface (TIN) đang có hoặc nhập tay trong bảng quản lý.
 *  - Mặt bằng: hố ga có ký hiệu + chú thích tròn (tên, cao độ đỉnh đỏ / đáy xanh), cống/ống có nhãn "DN200-L=20M" + mũi tên dòng chảy.
 *  - Trắc dọc (SVG) có bảng số liệu giống bản vẽ mẫu: xem js/22-pipe-profile.js.
 *  Đơn vị: mét. Toạ độ theo hệ toạ độ cảnh (cùng hệ với các đối tượng vẽ khác).
 * ========================================================================================= */

let pipeNets = [];            // danh sách tuyến
let pnGroup = null;           // THREE.Group chứa toàn bộ đồ hoạ mặt bằng của mạng lưới
let pnSel = null;             // { net, type: 'node'|'pipe', index } đang chọn
let pnIdCounter = 1;
const PN = {
    scale: 500,               // tỉ lệ bản vẽ 1:scale -> quyết định cỡ chữ/ký hiệu trên mặt bằng
    drainColors: [0xffffff, 0xff00ff, 0xff4444, 0x00e5ff, 0xffff55, 0x66ff66],
    waterColors: { 110: 0xff00ff, 63: 0x00ff00, 50: 0x00ffff, 100: 0xffaa00 }
};
const DRAIN_DN = [150, 200, 225, 250, 300, 400, 500, 600, 800, 1000, 1200];
const WATER_DN = [32, 40, 50, 63, 75, 90, 100, 110, 125, 150, 160, 200, 225, 250, 315];
const PN_FITTINGS = {
    valve:   { name: 'Van',               label: (d, d2) => `VAN QUẢN LÝ DN${d}` },
    tee:     { name: 'Tê',                label: (d, d2) => `TÊ GANG DN${d}/DN${d2}` },
    elbow:   { name: 'Co',                label: (d, d2) => `CO GANG DN${d}` },
    hydrant: { name: 'Trụ cứu hoả (TNCC)', label: () => 'TNCC' },
    meter:   { name: 'Đồng hồ',           label: () => 'HV ĐỒNG HỒ' },
    cap:     { name: 'Bịt',               label: (d) => `BỊT HDPE DN${d}` },
    reducer: { name: 'Côn thu',           label: (d, d2) => `CÔN DN${d}/DN${d2}` },
    wash:    { name: 'Van xả cặn',        label: (d) => `VAN XẢ CẶN DN${d}` },
    air:     { name: 'Van xả khí',        label: () => 'VAN XẢ KHÍ' }
};

// ------------------------------------------------------------------------------------------
// 1) Mô hình dữ liệu
// ------------------------------------------------------------------------------------------
function pnNewNet(kind, opts) {
    opts = opts || {};
    const idx = pipeNets.filter(n => n.kind === kind).length + 1;
    const net = {
        id: pnIdCounter++, kind,
        name: opts.name || (kind === 'drain' ? `Tuyến thoát nước ${idx}` : `Tuyến cấp nước ${idx}`),
        color: kind === 'drain' ? PN.drainColors[(idx - 1) % PN.drainColors.length] : null,
        nodes: [], pipes: [],
        params: Object.assign({
            prefix: kind === 'drain' ? `GT${idx}.` : `T${idx}-`,
            dn: kind === 'drain' ? 225 : 110, slope: 0.5, material: kind === 'drain' ? 'BTCT' : 'HDPE',
            minCover: 0.7, startInvert: null, drop: 0, depth: 0.8, baseGround: 0, finishOffset: 0
        }, opts.params || {})
    };
    pipeNets.push(net);
    return net;
}
function pnNewNode(net, x, y, extra) {
    return Object.assign({ id: pnIdCounter++, name: '', x, y, kind: net.kind === 'drain' ? 'manhole' : 'node', fitting: null, label: '', dn2: null,
        natural: null, finished: null, depth: null, invert: null, drop: 0, custom: false, off: null }, extra || {});
}
function pnNewPipe(net, src) {
    return { dn: src ? src.dn : net.params.dn, slope: src ? src.slope : net.params.slope, material: src ? src.material : net.params.material };
}
/** Đặt lại tên theo thứ tự tuyến (trừ tên đã được người dùng tự đặt). */
function pnRenumber(net) {
    net.nodes.forEach((n, i) => { if (!n.custom) n.name = net.kind === 'water' && i === 0 ? 'KM0' : `${net.params.prefix}${i + (net.kind === 'water' ? 0 : 1)}`; });
}
function pnAddPoint(net, x, y) {
    const node = pnNewNode(net, x, y);
    if (net.nodes.length) net.pipes.push(pnNewPipe(net, net.pipes[net.pipes.length - 1]));
    net.nodes.push(node);
    pnRenumber(net);
    return node;
}
/** Chèn node vào giữa đoạn segIndex tại (x,y) — dùng cho phụ kiện / hố ga thêm. */
function pnSplitPipe(net, segIndex, x, y, extra) {
    const node = pnNewNode(net, x, y, extra);
    const old = net.pipes[segIndex];
    net.nodes.splice(segIndex + 1, 0, node);
    net.pipes.splice(segIndex, 1, pnNewPipe(net, old), pnNewPipe(net, old));
    pnRenumber(net);
    return node;
}
function pnDeleteNode(net, i) {
    if (net.nodes.length <= 2) { pnDeleteNet(net); return; }
    net.nodes.splice(i, 1);
    if (i === 0) net.pipes.splice(0, 1);
    else if (i >= net.pipes.length) net.pipes.splice(net.pipes.length - 1, 1);
    else net.pipes.splice(i - 1, 2, pnNewPipe(net, net.pipes[i - 1]));
    pnRenumber(net);
}
function pnDeleteNet(net) {
    pipeNets = pipeNets.filter(n => n !== net);
    if (pnSel && pnSel.net === net) pnSel = null;
}

// ------------------------------------------------------------------------------------------
// 2) Tính toán cao độ
// ------------------------------------------------------------------------------------------
function pnSurfaceZ(x, y) {
    try { return (typeof sampleSurfaceElevationAt === 'function') ? sampleSurfaceElevationAt(x, y) : null; } catch (e) { return null; }
}
const pnHyp = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
/** Tính toàn bộ số liệu dẫn xuất của 1 tuyến -> net.calc. */
function pnCompute(net) {
    const P = net.params, nodes = net.nodes, pipes = net.pipes;
    const calc = { nodes: [], pipes: [], total: 0, warn: [] };
    let st = 0;
    nodes.forEach((n, i) => {
        if (i > 0) st += pnHyp(nodes[i - 1], n);
        let nat = n.natural !== null && n.natural !== undefined ? n.natural : pnSurfaceZ(n.x, n.y);
        if (nat === undefined) nat = null;
        let fin = n.finished !== null && n.finished !== undefined ? n.finished : (nat !== null ? nat + (P.finishOffset || 0) : null);
        const missing = fin === null || fin === undefined;
        // góc quay mặt bằng: góc trong giữa 2 đoạn (180° = thẳng)
        let ang = 180;
        if (i > 0 && i < nodes.length - 1) {
            const a = nodes[i - 1], c = nodes[i + 1];
            const v1 = [a.x - n.x, a.y - n.y], v2 = [c.x - n.x, c.y - n.y];
            const d = Math.hypot(...v1) * Math.hypot(...v2);
            if (d > 1e-9) ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI;
        }
        calc.nodes[i] = { station: st, nat: nat === undefined ? null : nat, fin, missing, angle: ang };
    });
    calc.total = st;
    // Điểm chưa có cao độ (không có Surface, chưa nhập): nội suy theo cọc giữa các điểm đã có; không có điểm nào thì dùng "nền mặc định"
    const fill = (key, fallback) => {
        const known = calc.nodes.map((c, i) => i).filter(i => calc.nodes[i][key] !== null && calc.nodes[i][key] !== undefined);
        if (!known.length) { if (fallback !== null) calc.nodes.forEach(c => { c[key] = fallback; }); return; }
        calc.nodes.forEach((c, i) => {
            if (c[key] !== null && c[key] !== undefined) return;
            const l = known.filter(k => k < i).pop(), r = known.find(k => k > i);
            if (l !== undefined && r !== undefined) { const a = calc.nodes[l], b = calc.nodes[r], t = (c.station - a.station) / ((b.station - a.station) || 1); c[key] = a[key] + t * (b[key] - a[key]); }
            else c[key] = calc.nodes[l !== undefined ? l : r][key];
        });
    };
    fill('nat', null); fill('fin', P.baseGround || 0);
    if (net.kind === 'drain') {
        let inv = (P.startInvert !== null && P.startInvert !== undefined && !isNaN(P.startInvert))
            ? P.startInvert : (nodes.length ? calc.nodes[0].fin - P.minCover - (pipes[0] ? pipes[0].dn / 1000 : 0.2) : 0);
        pipes.forEach((p, i) => {
            const len = pnHyp(nodes[i], nodes[i + 1]), D = p.dn / 1000;
            const invA = inv, invB = inv - len * p.slope / 100;
            const cA = calc.nodes[i].fin - (invA + D), cB = calc.nodes[i + 1].fin - (invB + D);
            calc.pipes[i] = { len, invA, invB, crownA: invA + D, crownB: invB + D, cover: Math.min(cA, cB) };
            if (calc.pipes[i].cover < P.minCover - 1e-9) calc.warn.push(`Đoạn ${i + 1}: phủ ${calc.pipes[i].cover.toFixed(2)} m < ${P.minCover} m`);
            inv = invB - (nodes[i + 1].drop || 0);
        });
        nodes.forEach((n, i) => {
            const c = calc.nodes[i];
            c.invIn = i > 0 ? calc.pipes[i - 1].invB : null;  c.crownIn = i > 0 ? calc.pipes[i - 1].crownB : null;
            c.invOut = i < pipes.length ? calc.pipes[i].invA : null; c.crownOut = i < pipes.length ? calc.pipes[i].crownA : null;
            c.top = c.fin;
            c.bottom = Math.min(...[c.invIn, c.invOut].filter(v => v !== null)) - (n.sump || 0);
            c.height = c.top - c.bottom;
        });
    } else {
        nodes.forEach((n, i) => {
            const c = calc.nodes[i];
            c.depth = n.depth !== null && n.depth !== undefined ? n.depth : P.depth;
            c.inv = n.invert !== null && n.invert !== undefined ? n.invert : c.fin - c.depth;
            c.depth = c.fin - c.inv;
        });
        pipes.forEach((p, i) => {
            const len = pnHyp(nodes[i], nodes[i + 1]), a = calc.nodes[i], b = calc.nodes[i + 1];
            calc.pipes[i] = { len, invA: a.inv, invB: b.inv, slope: len > 0 ? (b.inv - a.inv) / len * 100 : 0 };
        });
    }
    net.calc = calc;
    return calc;
}

// ------------------------------------------------------------------------------------------
// 3) Đồ hoạ mặt bằng
// ------------------------------------------------------------------------------------------
const pnTextH = () => 2.5 * PN.scale / 1000;       // chiều cao chữ (m) tại tỉ lệ vẽ hiện tại
const pnCss = c => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

function pnLabel(text, x, y, h, color, rot, cx, cy) {
    const FONT = 64, PAD = 8, CAP = 46;
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    ctx.font = `bold ${FONT}px Arial, sans-serif`;
    const w = Math.max(1, Math.ceil(ctx.measureText(text).width));
    cv.width = w + PAD * 2; cv.height = Math.round(FONT * 1.25) + PAD * 2;
    ctx.font = `bold ${FONT}px Arial, sans-serif`;
    ctx.fillStyle = pnCss(color); ctx.textBaseline = 'middle'; ctx.fillText(text, PAD, cv.height / 2);
    const tex = new THREE.CanvasTexture(cv);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    const per = h / CAP;
    sp.scale.set(cv.width * per, cv.height * per, 1);
    sp.center.set(cx === undefined ? 0.5 : cx, cy === undefined ? 0.5 : cy);
    sp.position.set(x, y, 0.05);
    sp.material.rotation = rot || 0;
    sp.renderOrder = 30;
    sp.userData.pn = true;
    return sp;
}
function pnQuad(ax, ay, bx, by, w, color, z) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * w / 2, ny = dx / L * w / 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([ax + nx, ay + ny, z, ax - nx, ay - ny, z, bx - nx, by - ny, z, bx + nx, by + ny, z], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false }));
    m.renderOrder = 10;
    return m;
}
function pnLine(pts, color, closed, z) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], p[1], z === undefined ? 0.04 : z)));
    const l = closed ? new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, depthTest: false })) : new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
    l.renderOrder = 20;
    return l;
}
const pnCircle = (cx, cy, r, n) => { const pts = []; for (let i = 0; i < (n || 40); i++) { const a = i / (n || 40) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return pts; };
function pnReadable(angle) { let a = angle; while (a > Math.PI / 2) a -= Math.PI; while (a < -Math.PI / 2) a += Math.PI; return a; }
// Làm tròn 2 số lẻ kiểu "half up" có hiệu chỉnh sai số nhị phân (3.175 -> 3.18, không phải 3.17)
const pnRound2 = v => Math.round(v * 100 + (v >= 0 ? 1e-6 : -1e-6)) / 100;
const pnFmt = v => (v === null || v === undefined || isNaN(v)) ? '-' : pnRound2(v).toFixed(2);

function pnDrawDrain(net) {
    const h = pnTextH(), s = h * 0.8, rc = h * 1.5, W = h * 0.18;
    const calc = net.calc, nodes = net.nodes;
    // cống: dải rộng + nhãn + mũi tên dòng chảy
    net.pipes.forEach((p, i) => {
        const a = nodes[i], b = nodes[i + 1], sel = pnSel && pnSel.net === net && pnSel.type === 'pipe' && pnSel.index === i;
        pnGroup.add(pnQuad(a.x, a.y, b.x, b.y, W, sel ? 0xffff00 : net.color, 0.02));
        const ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = -Math.sin(ang), ny = Math.cos(ang);
        const txt = `DN${p.dn}-L=${calc.pipes[i].len.toFixed(1)}M`;
        pnGroup.add(pnLabel(txt, mx - nx * h * 1.1, my - ny * h * 1.1, h * 0.9, 0xffffff, pnReadable(ang)));
        // mũi tên theo chiều dòng chảy (từ node i -> i+1)
        const ax = mx - nx * h * 2.6, ay = my - ny * h * 2.6, ux = Math.cos(ang), uy = Math.sin(ang), L = h * 1.2;
        pnGroup.add(pnLine([[ax - ux * L, ay - uy * L], [ax + ux * L, ay + uy * L]], 0xffffff));
        pnGroup.add(pnLine([[ax + ux * L - ux * h * 0.5 + nx * h * 0.3, ay + uy * L - uy * h * 0.5 + ny * h * 0.3], [ax + ux * L, ay + uy * L], [ax + ux * L - ux * h * 0.5 - nx * h * 0.3, ay + uy * L - uy * h * 0.5 - ny * h * 0.3]], 0xffffff));
    });
    // hố ga: ô vuông + X, chú thích tròn (tên) + cao độ đỉnh (đỏ) / đáy (xanh)
    nodes.forEach((n, i) => {
        const c = calc.nodes[i], sel = pnSel && pnSel.net === net && pnSel.type === 'node' && pnSel.index === i;
        const col = sel ? 0xffff00 : 0x3b8bff;
        pnGroup.add(pnLine([[n.x - s / 2, n.y - s / 2], [n.x + s / 2, n.y - s / 2], [n.x + s / 2, n.y + s / 2], [n.x - s / 2, n.y + s / 2]], col, true));
        pnGroup.add(pnLine([[n.x - s / 2, n.y - s / 2], [n.x + s / 2, n.y + s / 2]], 0xff3333));
        pnGroup.add(pnLine([[n.x - s / 2, n.y + s / 2], [n.x + s / 2, n.y - s / 2]], 0xff3333));
        // hướng chú thích: vuông góc tuyến
        const pa = nodes[Math.max(0, i - 1)], pb = nodes[Math.min(nodes.length - 1, i + 1)];
        const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const off = n.off || { dx: -Math.sin(ang) * rc * 2.6, dy: Math.cos(ang) * rc * 2.6 };
        const cx = n.x + off.dx, cy = n.y + off.dy;
        pnGroup.add(pnLine([[n.x, n.y], [cx - off.dx / Math.hypot(off.dx, off.dy) * rc, cy - off.dy / Math.hypot(off.dx, off.dy) * rc]], 0x3b8bff));
        pnGroup.add(pnLine(pnCircle(cx, cy, rc), sel ? 0xffff00 : 0x3b8bff, true));
        pnGroup.add(pnLabel(n.name, cx, cy, Math.min(h * 0.8, 2.1 * rc / Math.max(1, n.name.length)), 0xffffff, 0));
        pnGroup.add(pnLabel(pnFmt(c.top), cx + rc * 1.15, cy + h * 0.6, h * 0.85, 0xff3333, 0, 0, 0.5));
        pnGroup.add(pnLabel(pnFmt(c.bottom), cx + rc * 1.15, cy - h * 0.6, h * 0.85, 0x33ff66, 0, 0, 0.5));
    });
}

function pnFittingSymbol(type, x, y, ang, s, color) {
    const g = new THREE.Group(), u = [Math.cos(ang), Math.sin(ang)], n = [-u[1], u[0]];
    const P = (a, b) => [x + u[0] * a + n[0] * b, y + u[1] * a + n[1] * b];
    const add = o => g.add(o);
    if (type === 'valve') { add(pnLine([P(-s, -s * 0.6), P(0, 0), P(-s, s * 0.6)], color, true)); add(pnLine([P(s, -s * 0.6), P(0, 0), P(s, s * 0.6)], color, true)); }
    else if (type === 'hydrant') { add(pnLine(pnCircle(x, y, s * 0.9), color, true)); add(pnLine([P(-s * 0.9, 0), P(s * 0.9, 0)], color)); add(pnLine([P(0, -s * 0.9), P(0, s * 0.9)], color)); }
    else if (type === 'meter') { add(pnLine([P(-s * 0.8, -s * 0.8), P(s * 0.8, -s * 0.8), P(s * 0.8, s * 0.8), P(-s * 0.8, s * 0.8)], color, true)); add(pnLine([P(-s * 0.8, -s * 0.8), P(s * 0.8, s * 0.8)], color)); }
    else if (type === 'cap') { add(pnLine([P(0, -s * 0.9), P(0, s * 0.9)], color)); add(pnLine([P(s * 0.3, -s * 0.9), P(s * 0.3, s * 0.9)], color)); }
    else if (type === 'reducer') { add(pnLine([P(-s, -s * 0.7), P(s, -s * 0.25), P(s, s * 0.25), P(-s, s * 0.7)], color, true)); }
    else if (type === 'tee') { add(pnLine(pnCircle(x, y, s * 0.7), color, true)); add(pnLine([P(0, 0), P(0, s * 1.8)], color)); }
    else if (type === 'elbow') { add(pnLine(pnCircle(x, y, s * 0.6), color, true)); }
    else { add(pnLine(pnCircle(x, y, s * 0.8), color, true)); add(pnLine(pnCircle(x, y, s * 0.2, 12), color, true)); }
    return g;
}

function pnWaterColor(dn) {
    if (PN.waterColors[dn] !== undefined) return PN.waterColors[dn];
    return dn >= 100 ? 0xff00ff : (dn >= 63 ? 0x00ff00 : 0x00ffff);
}
function pnDrawWater(net) {
    const h = pnTextH(), s = h * 0.7, W = h * 0.16;
    const nodes = net.nodes, calc = net.calc;
    net.pipes.forEach((p, i) => {
        const a = nodes[i], b = nodes[i + 1], sel = pnSel && pnSel.net === net && pnSel.type === 'pipe' && pnSel.index === i;
        pnGroup.add(pnQuad(a.x, a.y, b.x, b.y, W, sel ? 0xffff00 : pnWaterColor(p.dn), 0.02));
        const ang = Math.atan2(b.y - a.y, b.x - a.x), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        pnGroup.add(pnLabel(`D${p.dn}`, mx - Math.sin(ang) * h * 0.9, my + Math.cos(ang) * h * 0.9, h * 0.8, pnWaterColor(p.dn), pnReadable(ang)));
    });
    nodes.forEach((n, i) => {
        const sel = pnSel && pnSel.net === net && pnSel.type === 'node' && pnSel.index === i;
        const pa = nodes[Math.max(0, i - 1)], pb = nodes[Math.min(nodes.length - 1, i + 1)];
        const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const color = sel ? 0xffff00 : 0x00e5ff;
        if (n.kind === 'fitting' && n.fitting) {
            pnGroup.add(pnFittingSymbol(n.fitting, n.x, n.y, ang, s, color));
            const d = n.dn2 || (net.pipes[Math.min(i, net.pipes.length - 1)] || {}).dn || net.params.dn;
            const dn = (net.pipes[Math.min(i, net.pipes.length - 1)] || {}).dn || net.params.dn;
            const text = n.label || PN_FITTINGS[n.fitting].label(dn, d);
            const off = n.off || { dx: -Math.sin(ang) * h * 3.2 + Math.cos(ang) * h * 1.0, dy: Math.cos(ang) * h * 3.2 + Math.sin(ang) * h * 1.0 };
            pnGroup.add(pnLine([[n.x, n.y], [n.x + off.dx, n.y + off.dy]], color));
            pnGroup.add(pnLabel(text, n.x + off.dx, n.y + off.dy, h * 0.85, 0x00e5ff, 0, off.dx >= 0 ? 0 : 1, 0));
        } else {
            pnGroup.add(pnLine(pnCircle(n.x, n.y, s * 0.35, 16), color, true));
            pnGroup.add(pnLabel(n.name, n.x - Math.sin(ang) * h * 1.2, n.y + Math.cos(ang) * h * 1.2 - h * 0.0, h * 0.7, 0xaaaaaa, 0));
        }
    });
}

function pnRebuildGraphics() {
    if (!pnGroup) { pnGroup = new THREE.Group(); pnGroup.name = 'pipe-networks'; scene.add(pnGroup); }
    while (pnGroup.children.length) {
        const c = pnGroup.children.pop();
        c.traverse && c.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
    }
    pipeNets.forEach(net => {
        if (net.nodes.length === 0) return;
        pnCompute(net);
        if (net.kind === 'drain') pnDrawDrain(net); else pnDrawWater(net);
    });
}
