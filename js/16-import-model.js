/* =========================================================================================
 * NHẬP HÌNH HỌC TỪ DXF/DWG (dữ liệu đã được dxf-parser phân tích)
 *
 *  - Hỗ trợ: LINE, LWPOLYLINE/POLYLINE (có cung "bulge" + đa tuyến đóng), ARC, CIRCLE, ELLIPSE,
 *    SPLINE, 3DFACE, SOLID, POINT, TEXT, MTEXT, ATTRIB, DIMENSION và khối INSERT (lồng nhau, có
 *    tỉ lệ/xoay/mảng). Các loại khác (HATCH, MLEADER...) được thống kê để báo cho người dùng.
 *  - Tâm bản vẽ tính theo MEDIAN của hình học thật trong Model Space (không tính định nghĩa khối
 *    nằm quanh gốc toạ độ như trước — nguyên nhân khiến nhiều bản vẽ "trống").
 *  - Chữ: giữ chiều cao thật + góc quay, bỏ mã định dạng MTEXT, đổi chữ font VNI về Unicode.
 *  - Đối tượng nhập có thể CHỌN được (click/Window/Crossing): đối tượng được chọn sẽ chuyển thành
 *    đối tượng tự vẽ thông thường (xem impPromote) nên dùng được mọi lệnh Erase/Move/Copy...
 * ========================================================================================= */

let importedModel = null; // { items, group, layerObjs: Map, origin:{x,y} } — xem renderOptimized2D

// ------------------------------------------------------------------------------------------
// 1) Ma trận biến đổi 2D affine [a,b,c,d,e,f]:  x' = a*x + c*y + e ;  y' = b*x + d*y + f
// ------------------------------------------------------------------------------------------
const IMP_IDENTITY = [1, 0, 0, 1, 0, 0];
function impMul(m, n) { // áp n trước, rồi m
    return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
}
function impInsertMatrix(ins, base) {
    const th = (ins.rotation || 0) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
    const sx = (ins.xScale === undefined || ins.xScale === 0) ? 1 : ins.xScale;
    const sy = (ins.yScale === undefined || ins.yScale === 0) ? 1 : ins.yScale;
    const px = ins.position ? ins.position.x : 0, py = ins.position ? ins.position.y : 0;
    const bx = base ? (base.x || 0) : 0, by = base ? (base.y || 0) : 0;
    const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
    return [a, b, cc, d, px - (a * bx + cc * by), py - (b * bx + d * by)];
}
const impScaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const impRotOf = m => Math.atan2(m[1], m[0]) * 180 / Math.PI;

// ------------------------------------------------------------------------------------------
// 2) Xấp xỉ đường cong thành đoạn thẳng
// ------------------------------------------------------------------------------------------
function impArcPoints(cx, cy, r, a0, a1) { // cung ngược chiều kim đồng hồ từ a0 tới a1 (radian)
    let sweep = a1 - a0;
    while (sweep <= 0) sweep += Math.PI * 2;
    const steps = Math.min(240, Math.max(4, Math.ceil(sweep / (Math.PI / 36))));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const a = a0 + sweep * i / steps;
        pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return pts; // phẳng [x,y,x,y,...]
}
function impBulgePoints(x1, y1, x2, y2, bulge, out) { // thêm điểm của cung (không gồm điểm đầu) vào out
    const dx = x2 - x1, dy = y2 - y1, chord = Math.hypot(dx, dy);
    if (chord < 1e-12 || Math.abs(bulge) < 1e-9) { out.push(x2, y2); return; }
    const theta = 4 * Math.atan(bulge);
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const off = (chord / 2) / Math.tan(theta / 2);
    const cx = (x1 + x2) / 2 + (-dy / chord) * off, cy = (y1 + y2) / 2 + (dx / chord) * off;
    const a0 = Math.atan2(y1 - cy, x1 - cx);
    const steps = Math.min(120, Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 36))));
    for (let k = 1; k < steps; k++) {
        const a = a0 + theta * k / steps;
        out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    out.push(x2, y2);
}
function impSplinePoints(e) { // trả về mảng phẳng [x,y,...] hoặc null
    const ctrl = (e.controlPoints || []).filter(p => p && isFinite(p.x) && isFinite(p.y));
    const fit = (e.fitPoints || []).filter(p => p && isFinite(p.x) && isFinite(p.y));
    const polyline = pts => { const o = []; pts.forEach(p => o.push(p.x, p.y)); return o; };
    const p = e.degreeOfSplineCurve, knots = e.knotValues, n = ctrl.length;
    if (n >= 2 && p >= 1 && knots && knots.length === n + p + 1) {
        const samples = Math.min(600, Math.max(24, n * 10));
        const t0 = knots[p], t1 = knots[n], out = [];
        for (let i = 0; i <= samples; i++) {
            let t = t0 + (t1 - t0) * i / samples;
            if (i === samples) t = t1 - 1e-9 * Math.max(1, Math.abs(t1));
            let k = p;
            while (k < n - 1 && knots[k + 1] <= t) k++;
            const d = [];
            for (let j = 0; j <= p; j++) d.push([ctrl[j + k - p].x, ctrl[j + k - p].y]);
            for (let r = 1; r <= p; r++) {
                for (let j = p; j >= r; j--) {
                    const den = knots[j + 1 + k - r] - knots[j + k - p];
                    const alpha = den === 0 ? 0 : (t - knots[j + k - p]) / den;
                    d[j] = [(1 - alpha) * d[j - 1][0] + alpha * d[j][0], (1 - alpha) * d[j - 1][1] + alpha * d[j][1]];
                }
            }
            out.push(d[p][0], d[p][1]);
        }
        return out;
    }
    if (fit.length >= 2) return polyline(fit);
    if (n >= 2) return polyline(ctrl);
    return null;
}

// ------------------------------------------------------------------------------------------
// 3) Chữ: mã định dạng MTEXT, font VNI -> Unicode
// ------------------------------------------------------------------------------------------
const VNI_MAP = (() => {
    const lower = [
        ['aø', 'à'], ['aù', 'á'], ['aû', 'ả'], ['aõ', 'ã'], ['aï', 'ạ'],
        ['aê', 'ă'], ['aè', 'ằ'], ['aé', 'ắ'], ['aú', 'ẳ'], ['aü', 'ẵ'], ['aë', 'ặ'],
        ['aâ', 'â'], ['aà', 'ầ'], ['aá', 'ấ'], ['aå', 'ẩ'], ['aã', 'ẫ'], ['aä', 'ậ'],
        ['eø', 'è'], ['eù', 'é'], ['eû', 'ẻ'], ['eõ', 'ẽ'], ['eï', 'ẹ'],
        ['eâ', 'ê'], ['eà', 'ề'], ['eá', 'ế'], ['eå', 'ể'], ['eã', 'ễ'], ['eä', 'ệ'],
        ['oø', 'ò'], ['où', 'ó'], ['oû', 'ỏ'], ['oõ', 'õ'], ['oï', 'ọ'],
        ['oâ', 'ô'], ['oà', 'ồ'], ['oá', 'ố'], ['oå', 'ổ'], ['oã', 'ỗ'], ['oä', 'ộ'],
        ['ôø', 'ờ'], ['ôù', 'ớ'], ['ôû', 'ở'], ['ôõ', 'ỡ'], ['ôï', 'ợ'],
        ['uø', 'ù'], ['uù', 'ú'], ['uû', 'ủ'], ['uõ', 'ũ'], ['uï', 'ụ'],
        ['öø', 'ừ'], ['öù', 'ứ'], ['öû', 'ử'], ['öõ', 'ữ'], ['öï', 'ự'],
        ['yø', 'ỳ'], ['yù', 'ý'], ['yû', 'ỷ'], ['yõ', 'ỹ'],
        // ký tự đơn
        ['ô', 'ơ'], ['ö', 'ư'], ['ñ', 'đ'], ['ì', 'ì'], ['í', 'í'], ['æ', 'ỉ'], ['ó', 'ĩ'], ['ò', 'ị'], ['î', 'ỵ']
    ];
    const m = new Map();
    lower.forEach(([k, v]) => { m.set(k, v); m.set(k.toUpperCase(), v.toUpperCase()); });
    return m;
})();
function vniToUnicode(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
        const two = s.substr(i, 2);
        if (two.length === 2 && VNI_MAP.has(two)) { out += VNI_MAP.get(two); i++; continue; }
        out += VNI_MAP.has(s[i]) ? VNI_MAP.get(s[i]) : s[i];
    }
    return out;
}
const isVniName = n => !!n && /vni/i.test(n);

function impSpecialCodes(s) { // %%c %%d %%p %%u %%o
    if (s.indexOf('%%') === -1) return s;
    return s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoO]/g, '').replace(/%%%/g, '%');
}

/** Chuyển nội dung MTEXT (có mã \P, {\fArial|b1;...}, \C1; ...) thành chữ thuần.
 *  defaultVni: font mặc định của style có phải VNI không; mã \f trong chuỗi sẽ ghi đè từng đoạn. */
function impParseMText(raw, defaultVni) {
    const s = impSpecialCodes(String(raw));
    let out = '', piece = '', vni = !!defaultVni;
    const stack = [];
    const flush = () => { out += vni ? vniToUnicode(piece) : piece; piece = ''; };
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') {
            const n = s[i + 1];
            if (n === undefined) break;
            if (n === '\\' || n === '{' || n === '}') { piece += n; i++; }
            else if (n === 'P' || n === 'X') { piece += '\n'; i++; }
            else if (n === '~') { piece += ' '; i++; }
            else if (n === 'U' && s[i + 2] === '+') {
                const hex = s.substr(i + 3, 4);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) { piece += String.fromCharCode(parseInt(hex, 16)); i += 6; } else { i++; }
            } else if (n === 'f' || n === 'F') {
                const end = s.indexOf(';', i);
                const params = end === -1 ? '' : s.slice(i + 2, end);
                flush();
                vni = isVniName(params.split('|')[0]);
                i = end === -1 ? s.length : end;
            } else if (n === 'S') { // phân số xếp chồng: \S1/2;
                const end = s.indexOf(';', i);
                if (end === -1) { i++; } else { piece += s.slice(i + 2, end).replace(/\^/g, '/'); i = end; }
            } else if ('HhWwQqTtCcAapP'.indexOf(n) !== -1) { // lệnh có tham số kết thúc bằng ';'
                const end = s.indexOf(';', i);
                i = end === -1 ? s.length : end;
            } else if ('LlOoKk'.indexOf(n) !== -1) { i++; } // bật/tắt gạch chân, gạch ngang...
            else { piece += n; i++; }
        } else if (c === '{') { flush(); stack.push(vni); }
        else if (c === '}') { flush(); if (stack.length) vni = stack.pop(); }
        else piece += c;
    }
    flush();
    return out;
}

/** Quét raw DXF lấy: font của từng STYLE, style của từng TEXT/MTEXT/ATTRIB (theo handle).
 *  Chỉ chạy khi trong file có chữ "vni" (nhanh), để biết chữ nào dùng font VNI. */
function impScanTextStyles(rawText) {
    const handleStyle = new Map(), styleFont = new Map();
    if (!rawText || !/vni/i.test(rawText)) return { handleStyle, styleFont, hasVni: false };
    const reStyle = /\n\s*0\r?\nSTYLE\r?\n([\s\S]*?)(?=\n\s*0\r?\n[A-Z])/g;
    let m;
    while ((m = reStyle.exec(rawText)) !== null) {
        const body = m[1];
        const name = /\n?\s*2\r?\n([^\r\n]*)/.exec('\n' + body), font = /\n\s*3\r?\n([^\r\n]*)/.exec('\n' + body);
        if (name) styleFont.set(name[1].trim().toUpperCase(), font ? font[1].trim() : '');
    }
    const reText = /\n\s*0\r?\n(?:TEXT|MTEXT|ATTRIB|ATTDEF)\r?\n([\s\S]*?)(?=\n\s*0\r?\n[A-Z])/g;
    while ((m = reText.exec(rawText)) !== null) {
        const body = '\n' + m[1];
        const h = /\n\s*5\r?\n([0-9A-Fa-f]+)/.exec(body), st = /\n\s*7\r?\n([^\r\n]*)/.exec(body);
        if (h && st) handleStyle.set(h[1].toUpperCase(), st[1].trim());
    }
    return { handleStyle, styleFont, hasVni: true };
}

/** Đoạn văn bản của section ENTITIES trong file DXF thô (hoặc null). */
function impEntitiesSegment(rawText) {
    if (!rawText) return null;
    const a = rawText.search(/\n\s*2\r?\nENTITIES\r?\n/);
    if (a === -1) return null;
    let b = rawText.indexOf('ENDSEC', a);
    if (b === -1) b = rawText.length;
    return rawText.slice(a, b);
}

/** Thống kê các loại đối tượng trong ENTITIES của file DXF thô (để báo loại chưa hỗ trợ). */
function impScanRawEntityTypes(rawText) {
    const counts = {};
    const seg = impEntitiesSegment(rawText);
    if (!seg) return counts;
    const re = /\n\s*0\r?\n([A-Z0-9_]+)\r?(?=\n)/g;
    let m;
    while ((m = re.exec(seg)) !== null) counts[m[1]] = (counts[m[1]] || 0) + 1;
    return counts;
}

/** HATCH: dxf-parser không đọc loại này nên tự đọc đường biên từ DXF thô (vẽ viền, không tô màu).
 *  Trả về mảng {layer, handle, xy:[x,y,...], closed:true} — mỗi đường biên (boundary path) là 1 vòng kín. */
function impParseRawHatches(rawText) {
    const out = [];
    const seg = impEntitiesSegment(rawText);
    if (!seg) return out;
    const re = /\n\s*0\r?\nHATCH\r?\n([\s\S]*?)(?=\n\s*0\r?\n[A-Z])/g;
    let m;
    while ((m = re.exec(seg)) !== null) {
        const L = m[1].split(/\r?\n/), P = [];
        for (let i = 0; i + 1 < L.length; i += 2) P.push([parseInt(L[i], 10), L[i + 1]]);
        let layer = '0', handle = '';
        for (const [c, v] of P) { if (c === 8 && layer === '0') layer = v.trim(); if (c === 5 && !handle) handle = v.trim(); }
        let idx = P.findIndex(q => q[0] === 91);
        if (idx < 0) continue;
        const nPaths = parseInt(P[idx][1], 10); idx++;
        const seek = code => { while (idx < P.length && P[idx][0] !== code) idx++; return idx < P.length; };
        const num = code => (seek(code) ? parseFloat(P[idx++][1]) : NaN);
        for (let pi = 0; pi < nPaths; pi++) {
            if (!seek(92)) break;
            const flags = parseInt(P[idx++][1], 10);
            let pts = [];
            if (flags & 2) { // đường biên dạng polyline (có thể có bulge)
                let hasBulge = 0;
                while (idx < P.length && P[idx][0] !== 93) { if (P[idx][0] === 72) hasBulge = parseInt(P[idx][1], 10); idx++; }
                const n = parseInt((P[idx++] || [0, '0'])[1], 10);
                const vx = [], vy = [], vb = [];
                while (vx.length < n && idx < P.length) {
                    if (P[idx][0] === 10) {
                        vx.push(parseFloat(P[idx++][1]));
                        vy.push(idx < P.length && P[idx][0] === 20 ? parseFloat(P[idx++][1]) : 0);
                        vb.push(hasBulge && idx < P.length && P[idx][0] === 42 ? parseFloat(P[idx++][1]) : 0);
                    } else idx++;
                }
                if (vx.length >= 2) {
                    pts = [vx[0], vy[0]];
                    for (let k = 0; k < vx.length; k++) {
                        const k2 = (k + 1) % vx.length;
                        if (vb[k]) impBulgePoints(vx[k], vy[k], vx[k2], vy[k2], vb[k], pts); else pts.push(vx[k2], vy[k2]);
                    }
                }
            } else { // đường biên gồm các cạnh (line / arc / ellipse / spline)
                if (!seek(93)) break;
                const ne = parseInt(P[idx++][1], 10);
                for (let e = 0; e < ne; e++) {
                    if (!seek(72)) break;
                    const type = parseInt(P[idx++][1], 10);
                    let ep = [];
                    if (type === 1) { const x1 = num(10), y1 = num(20), x2 = num(11), y2 = num(21); ep = [x1, y1, x2, y2]; }
                    else if (type === 2) {
                        const cx = num(10), cy = num(20), r = num(40), a0 = num(50) * Math.PI / 180, a1 = num(51) * Math.PI / 180, ccw = num(73);
                        ep = impArcPoints(cx, cy, r, a0, a1);
                        if (ccw === 0) { // đảo thứ tự điểm (x,y) cho cung ngược chiều kim đồng hồ
                            const fwd = impArcPoints(cx, cy, r, a1, a0), rev = [];
                            for (let k = fwd.length - 2; k >= 0; k -= 2) rev.push(fwd[k], fwd[k + 1]);
                            ep = rev;
                        }
                    } else if (type === 3) {
                        const cx = num(10), cy = num(20), mx = num(11), my = num(21), ratio = num(40), a0 = num(50) * Math.PI / 180, a1 = num(51) * Math.PI / 180;
                        const nx = -my * ratio, ny = mx * ratio;
                        let t1 = a1; if (t1 <= a0) t1 += Math.PI * 2;
                        const steps = Math.max(8, Math.ceil(72 * (t1 - a0) / (Math.PI * 2)));
                        for (let k = 0; k <= steps; k++) { const t = a0 + (t1 - a0) * k / steps; ep.push(cx + Math.cos(t) * mx + Math.sin(t) * nx, cy + Math.cos(t) * my + Math.sin(t) * ny); }
                    } else if (type === 4) { // spline: xấp xỉ bằng đa giác điều khiển
                        seek(95); const nk = parseInt(P[idx++][1], 10);
                        seek(96); const nc = parseInt(P[idx++][1], 10);
                        for (let k = 0; k < nk; k++) { if (!seek(40)) break; idx++; }
                        for (let k = 0; k < nc; k++) { const x = num(10), y = num(20); ep.push(x, y); }
                    }
                    if (ep.length >= 2) {
                        if (pts.length >= 2 && Math.abs(pts[pts.length - 2] - ep[0]) < 1e-9 && Math.abs(pts[pts.length - 1] - ep[1]) < 1e-9) ep = ep.slice(2);
                        pts = pts.concat(ep);
                    }
                }
            }
            if (pts.length >= 6 && pts.every(Number.isFinite)) {
                if (Math.abs(pts[0] - pts[pts.length - 2]) < 1e-9 && Math.abs(pts[1] - pts[pts.length - 1]) < 1e-9) pts.length -= 2;
                out.push({ layer, handle, xy: pts, closed: true });
            }
        }
    }
    return out;
}

const IMP_SUPPORTED_TYPES = new Set(['HATCH', 'LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE',
    '3DFACE', 'SOLID', 'POINT', 'TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF', 'INSERT', 'DIMENSION']);

// ------------------------------------------------------------------------------------------
// 4) Duỗi phẳng toàn bộ bản vẽ thành: items (hình học), labels (chữ), elevPts (điểm cao độ)
// ------------------------------------------------------------------------------------------
function impFlatten(dxf, rawText) {
    const items = [], labels = [], elevPts = [];
    const stats = { missingBlocks: new Set(), budgetHit: false, pointZ: 0 };
    const blocks = dxf.blocks || {};
    const styleInfo = impScanTextStyles(rawText);
    const MAX_ITEMS = 3000000;
    let instanceBudget = 400000; // tổng số lần mở rộng khối (chống nổ bộ nhớ khi khối lồng nhau)

    const addItem = (kind, layer, handle, xy, closed) => {
        if (xy.length < 4 || items.length >= MAX_ITEMS) { if (items.length >= MAX_ITEMS) stats.budgetHit = true; return; }
        items.push({ idx: items.length, kind, layer, handle, xy, closed: !!closed, segStart: 0, segCount: 0, promoted: false });
    };
    const tx = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const txList = (m, pts) => { const o = new Array(pts.length); for (let i = 0; i < pts.length; i += 2) { o[i] = m[0] * pts[i] + m[2] * pts[i + 1] + m[4]; o[i + 1] = m[1] * pts[i] + m[3] * pts[i + 1] + m[5]; } return o; };

    const addLabel = (e, m, layer, isAttrib) => {
        let textVal = e.text !== undefined ? e.text : (e.string !== undefined ? e.string : e.value);
        if (textVal === undefined || textVal === null || String(textVal).trim() === '') return;
        const isM = e.type === 'MTEXT';
        let pos;
        if (isM) pos = e.position;
        else if ((e.halign || e.valign) && e.endPoint && e.endPoint.x !== undefined) pos = e.endPoint;
        else pos = e.startPoint || e.position || e.insertionPoint;
        if (!pos || pos.x === undefined) return;
        const p = tx(m, pos.x, pos.y);
        // font VNI? (theo style của chữ, hoặc mã \f trong MTEXT)
        let vni = false;
        if (styleInfo.hasVni) {
            const st = e.handle ? styleInfo.handleStyle.get(String(e.handle).toUpperCase()) : null;
            const font = st ? styleInfo.styleFont.get(st.toUpperCase()) : null;
            vni = isVniName(font) || isVniName(st);
        }
        const txt = isM ? impParseMText(textVal, vni) : (() => { const t = impSpecialCodes(String(textVal)); return vni ? vniToUnicode(t) : t; })();
        const clean = txt.trim();
        if (!clean) return;
        const sc = impScaleOf(m);
        let height = isM ? e.height : e.textHeight;
        if (!(height > 0)) height = 2.5;
        let fx = 0, fy = -0.5; // hệ số dịch (-0 trái / -0.5 giữa / -1 phải ; 0 trên / -0.5 giữa / -1 dưới)
        if (isM) {
            const ap = e.attachmentPoint || 1;
            fx = [0, -0.5, -1][(ap - 1) % 3]; fy = [0, -0.5, -1][Math.floor((ap - 1) / 3)];
        } else {
            const ha = e.halign || 0, va = e.valign || 0;
            fx = (ha === 1 || ha === 4) ? -0.5 : (ha === 2 ? -1 : 0);
            fy = va === 3 ? 0 : (va === 2 ? -0.5 : (va === 1 ? -1 : -0.85));
        }
        labels.push({ text: clean, x: p[0], y: p[1], height: height * sc, rotation: (e.rotation || 0) + impRotOf(m), layer, fx, fy });
        if (/^-?\d+([.,]\d+)?$/.test(clean)) {
            const z = parseFloat(clean.replace(',', '.'));
            if (!isNaN(z)) elevPts.push({ x: p[0], y: p[1], z });
        }
    };

    const expandBlock = (name, m, layer, depth, ent) => {
        const blk = blocks[name];
        if (!blk || !blk.entities || blk.entities.length === 0) { stats.missingBlocks.add(name); return; }
        if (depth > 8) return;
        if (--instanceBudget < 0) { stats.budgetHit = true; return; }
        walk(blk.entities, m, layer, depth + 1);
    };

    const walk = (list, m, parentLayer, depth) => {
        for (let i = 0; i < list.length; i++) {
            const e = list[i];
            let layer = e.layer || '0';
            if (layer === '0' && parentLayer) layer = parentLayer; // ByBlock: lớp "0" trong khối lấy theo lớp của INSERT
            const h = e.handle !== undefined ? String(e.handle) : '';
            switch (e.type) {
                case 'LINE':
                    if (e.vertices && e.vertices.length >= 2) {
                        addItem('LINE', layer, h, txList(m, [e.vertices[0].x, e.vertices[0].y, e.vertices[1].x, e.vertices[1].y]), false);
                    }
                    break;
                case 'LWPOLYLINE':
                case 'POLYLINE': {
                    const v = e.vertices || [];
                    if (v.length < 2) break;
                    if (e.isPolyfaceMesh || e.is3dPolygonMesh) break;
                    const pts = [v[0].x, v[0].y];
                    const n = e.shape ? v.length : v.length - 1;
                    for (let k = 0; k < n; k++) {
                        const a = v[k], b = v[(k + 1) % v.length];
                        if (a.bulge) impBulgePoints(a.x, a.y, b.x, b.y, a.bulge, pts); else pts.push(b.x, b.y);
                    }
                    // đa tuyến đóng: điểm cuối trùng điểm đầu -> bỏ bớt để vẽ "đóng" đúng
                    if (e.shape && pts.length > 4) pts.length -= 2;
                    addItem('POLYLINE', layer, h, txList(m, pts), !!e.shape);
                    break;
                }
                case 'ARC':
                    if (e.center && e.radius > 0) addItem('ARC', layer, h, txList(m, impArcPoints(e.center.x, e.center.y, e.radius, e.startAngle || 0, e.endAngle === undefined ? Math.PI * 2 : e.endAngle)), false);
                    break;
                case 'CIRCLE':
                    if (e.center && e.radius > 0) {
                        const pts = impArcPoints(e.center.x, e.center.y, e.radius, 0, Math.PI * 2 - 1e-9);
                        pts.length -= 2; // bỏ điểm cuối trùng điểm đầu
                        addItem('CIRCLE', layer, h, txList(m, pts), true);
                    }
                    break;
                case 'ELLIPSE': {
                    if (!e.center || !e.majorAxisEndPoint) break;
                    const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y, ratio = e.axisRatio || 1;
                    const nx = -my * ratio, ny = mx * ratio;
                    let t0 = e.startAngle || 0, t1 = e.endAngle === undefined ? Math.PI * 2 : e.endAngle;
                    if (t1 <= t0) t1 += Math.PI * 2;
                    const full = (t1 - t0) > Math.PI * 2 - 1e-6;
                    const steps = Math.max(12, Math.ceil(72 * (t1 - t0) / (Math.PI * 2)));
                    const pts = [];
                    for (let k = 0; k <= steps; k++) {
                        const t = t0 + (t1 - t0) * k / steps;
                        pts.push(e.center.x + Math.cos(t) * mx + Math.sin(t) * nx, e.center.y + Math.cos(t) * my + Math.sin(t) * ny);
                    }
                    if (full) pts.length -= 2;
                    addItem('ELLIPSE', layer, h, txList(m, pts), full);
                    break;
                }
                case 'SPLINE': {
                    const pts = impSplinePoints(e);
                    if (pts) addItem('SPLINE', layer, h, txList(m, pts), !!e.closed);
                    break;
                }
                case '3DFACE': {
                    const v = (e.vertices || []).filter(p => p && isFinite(p.x));
                    if (v.length >= 3) {
                        const pts = [];
                        v.forEach((p, k) => { if (k < 3 || p.x !== v[2].x || p.y !== v[2].y) pts.push(p.x, p.y); });
                        addItem('3DFACE', layer, h, txList(m, pts), true);
                    }
                    break;
                }
                case 'SOLID': {
                    const p = (e.points || []).filter(q => q && isFinite(q.x));
                    if (p.length >= 3) {
                        const order = p.length === 4 ? [0, 1, 3, 2] : [0, 1, 2];
                        const pts = []; order.forEach(k => pts.push(p[k].x, p[k].y));
                        addItem('SOLID', layer, h, txList(m, pts), true);
                    }
                    break;
                }
                case 'POINT': {
                    const p = e.position;
                    if (p && isFinite(p.x) && Math.abs(p.z || 0) > 1e-9) {
                        const q = tx(m, p.x, p.y);
                        elevPts.push({ x: q[0], y: q[1], z: p.z });
                        stats.pointZ++;
                    }
                    break;
                }
                case 'TEXT':
                case 'MTEXT':
                case 'ATTRIB':
                    addLabel(e, m, layer, false);
                    break;
                case 'INSERT': {
                    const base = blocks[e.name] ? blocks[e.name].position : null;
                    const cols = Math.max(1, e.columnCount || 1), rows = Math.max(1, e.rowCount || 1);
                    const cnt = Math.min(cols * rows, 10000);
                    for (let q = 0; q < cnt; q++) {
                        const ci = q % cols, ri = Math.floor(q / cols);
                        const ins = { rotation: e.rotation, xScale: e.xScale, yScale: e.yScale, position: e.position };
                        let mi = impInsertMatrix(ins, base);
                        if (ci || ri) { // mảng MINSERT: lệch theo hệ trục đã xoay của khối
                            const th = (e.rotation || 0) * Math.PI / 180;
                            const ox = (e.columnSpacing || 0) * ci, oy = (e.rowSpacing || 0) * ri;
                            mi = [mi[0], mi[1], mi[2], mi[3], mi[4] + ox * Math.cos(th) - oy * Math.sin(th), mi[5] + ox * Math.sin(th) + oy * Math.cos(th)];
                        }
                        expandBlock(e.name, impMul(m, mi), layer, depth, e);
                        // thuộc tính của khối (VD số hiệu/cao độ điểm khảo sát)
                        const atts = e.attributes || e.attribs;
                        if (atts) atts.forEach(a => addLabel(a, m, layer, true));
                    }
                    break;
                }
                case 'DIMENSION':
                    if (e.block) expandBlock(e.block, m, layer, depth, e);
                    break;
                default:
                    break;
            }
        }
    };

    walk(dxf.entities || [], IMP_IDENTITY, null, 0);
    return { items, labels, elevPts, stats };
}

// ------------------------------------------------------------------------------------------
// 5) Tâm bền vững + loại điểm "rác" nằm quá xa (VD đối tượng lạc ở gốc toạ độ)
// ------------------------------------------------------------------------------------------
function impRobustCenter(items, labels) {
    const stride = 1; let total = 0;
    items.forEach(it => { total += it.xy.length / 2; });
    total += labels.length;
    if (total === 0) return null;
    const step = Math.max(1, Math.floor(total / 200000));
    const xs = [], ys = [];
    let c = 0;
    const take = (x, y) => { if (c++ % step === 0) { xs.push(x); ys.push(y); } };
    items.forEach(it => { for (let i = 0; i < it.xy.length; i += 2) take(it.xy[i], it.xy[i + 1]); });
    labels.forEach(l => take(l.x, l.y));
    const fx = Float64Array.from(xs).sort(), fy = Float64Array.from(ys).sort();
    const cx = fx[fx.length >> 1], cy = fy[fy.length >> 1];
    const d = new Float64Array(fx.length);
    for (let i = 0; i < xs.length; i++) d[i] = Math.hypot(xs[i] - cx, ys[i] - cy);
    d.sort();
    const d98 = d[Math.floor(d.length * 0.98)] || 0;
    return { x: cx, y: cy, radius: Math.max(100000, d98 * 1.5) };
}

// ------------------------------------------------------------------------------------------
// 6) Dựng cảnh 3D từ dữ liệu đã duỗi phẳng
// ------------------------------------------------------------------------------------------
let impTextVersion = 0, impLastTextKey = '';

function renderOptimized2D(dxf, filename, rawText, extraNote) {
    if (currentModel) scene.remove(currentModel);
    removeSurface();
    textOverlay.innerHTML = '';
    textElements = [];
    importedElevationPoints = [];
    importedModel = null;
    impTextVersion++;

    const flat = impFlatten(dxf, rawText);
    let items = flat.items, labels = flat.labels, elevPts = flat.elevPts;
    const rawTypes = impScanRawEntityTypes(rawText);
    const hatches = impParseRawHatches(rawText);
    hatches.forEach(h => items.push({ idx: 0, kind: 'HATCH', layer: h.layer, handle: h.handle, xy: h.xy, closed: true, segStart: 0, segCount: 0, promoted: false }));
    const unsupported = Object.entries(rawTypes).filter(([t]) => !IMP_SUPPORTED_TYPES.has(t)).sort((a, b) => b[1] - a[1]);
    const unsupportedText = unsupported.slice(0, 6).map(([t, n]) => `${t} ×${n.toLocaleString()}`).join(', ');
    const missing = Array.from(flat.stats.missingBlocks);

    const rc = impRobustCenter(items, labels);
    const infoPanel = document.getElementById('prop-content');
    if (!rc) {
        const why = `Không dựng được hình nào từ "${filename}".` +
            (unsupportedText ? ` Bản vẽ chứa các loại chưa hỗ trợ: ${unsupportedText}.` : '') +
            (missing.length ? ` Có ${missing.length} khối chèn không có dữ liệu (thường là tham chiếu ngoài/xref chưa nhúng): ${missing.slice(0, 3).join(', ')}.` : '');
        document.getElementById('command-line').innerText = 'Command: ' + why;
        infoPanel.innerHTML = `<b>Bản vẽ:</b> ${filename}<br>${why}`;
        console.warn(why, rawTypes);
        alert(why);
        return null;
    }

    // Loại đối tượng "rác" nằm quá xa cụm hình học chính (VD lạc ở gốc toạ độ)
    const R = rc.radius;
    let dropped = 0;
    items = items.filter(it => {
        for (let i = 0; i < it.xy.length; i += 2) if (Math.hypot(it.xy[i] - rc.x, it.xy[i + 1] - rc.y) > R) { dropped++; return false; }
        return true;
    });
    items.forEach((it, k) => { it.idx = k; });
    labels = labels.filter(l => Math.hypot(l.x - rc.x, l.y - rc.y) <= R);
    elevPts = elevPts.filter(p => Math.hypot(p.x - rc.x, p.y - rc.y) <= R);

    // Toạ độ trong bộ đệm lưu theo gốc "origin" (gần tâm) để tránh mất độ chính xác float32 với toạ độ lớn
    const origin = { x: Math.round(rc.x), y: Math.round(rc.y) };
    const layerBuffers = new Map();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
    let segTotal = 0;
    items.forEach(it => {
        let buf = layerBuffers.get(it.layer);
        if (!buf) { buf = { pos: [], owner: [] }; layerBuffers.set(it.layer, buf); }
        const n = it.xy.length / 2, segs = it.closed ? n : n - 1;
        it.segStart = buf.owner.length; it.segCount = segs;
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (let i = 0; i < n; i++) {
            const x = it.xy[2 * i], y = it.xy[2 * i + 1];
            if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        }
        it.bx0 = bx0; it.by0 = by0; it.bx1 = bx1; it.by1 = by1;
        grow(bx0 - origin.x, by0 - origin.y); grow(bx1 - origin.x, by1 - origin.y);
        for (let s = 0; s < segs; s++) {
            const a = s, b = (s + 1) % n;
            buf.pos.push(it.xy[2 * a] - origin.x, it.xy[2 * a + 1] - origin.y, 0, it.xy[2 * b] - origin.x, it.xy[2 * b + 1] - origin.y, 0);
            buf.owner.push(it.idx);
        }
        segTotal += segs;
    });
    labels.forEach(l => grow(l.x - origin.x, l.y - origin.y));
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }

    const group = new THREE.Group();
    layers.forEach(l => { l.importObject3D = null; }); // đánh dấu layer cũ (nếu nhập lại) là không còn được import
    const layerObjs = new Map();
    layerBuffers.forEach((buf, layerName) => {
        let layer = layers.get(layerName);
        if (!layer) {
            layer = { name: layerName, color: 0x00e5ff, visible: true, locked: false, importObject3D: null };
            layers.set(layerName, layer);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
        geo.userData.owner = Int32Array.from(buf.owner);
        const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: layer.color }));
        ls.visible = layer.visible;
        layer.importObject3D = ls;
        group.add(ls);
        layerObjs.set(layerName, ls);
    });
    renderLayersPanel();

    const cxRel = (minX + maxX) / 2, cyRel = (minY + maxY) / 2;
    const size = new THREE.Vector3(maxX - minX, maxY - minY, 0);
    group.position.set(-cxRel, -cyRel, 0);
    scene.add(group);
    currentModel = group;
    const off = { x: origin.x + cxRel, y: origin.y + cyRel }; // tâm tuyệt đối (toạ độ bản vẽ) -> gốc của cảnh
    importedModel = { items, group, layerObjs, origin, off };

    // Chữ: nhãn DOM, kích thước theo chiều cao chữ thật (xem updateTextPositions)
    const MAX_LABELS = 40000;
    labels.slice(0, MAX_LABELS).forEach(l => {
        const div = document.createElement('div');
        div.className = 'cad-text';
        div.textContent = l.text;
        if (l.text.indexOf('\n') !== -1) { div.style.whiteSpace = 'pre'; div.style.lineHeight = '1.15'; }
        div.style.display = 'none';
        textOverlay.appendChild(div);
        textElements.push({ element: div, position: new THREE.Vector3(l.x - off.x, l.y - off.y, 0), height: l.height, rotation: l.rotation, fx: l.fx, fy: l.fy, layer: l.layer });
    });
    importedElevationPoints = elevPts.map(p => ({ x: p.x - off.x, y: p.y - off.y, z: p.z }));

    resetCameraToModel(size);
    rebuildSnapCandidates();

    const notes = [];
    if (unsupportedText) notes.push(`chưa hỗ trợ hiển thị: ${unsupportedText}`);
    if (missing.length) notes.push(`${missing.length} khối không có dữ liệu (xref chưa nhúng?)`);
    if (dropped) notes.push(`bỏ qua ${dropped.toLocaleString()} đối tượng nằm quá xa`);
    if (labels.length > MAX_LABELS) notes.push(`chỉ hiển thị ${MAX_LABELS.toLocaleString()}/${labels.length.toLocaleString()} nhãn chữ`);
    if (flat.stats.budgetHit) notes.push('bản vẽ quá lớn, đã dừng mở rộng khối ở mức giới hạn');
    if (notes.length) console.warn('Ghi chú khi nhập bản vẽ:', notes.join('; '), rawTypes);

    document.getElementById('command-line').innerText =
        `Command: Loaded ${filename}. Đoạn: ${segTotal.toLocaleString()}, Chữ: ${textElements.length.toLocaleString()}, Điểm cao độ: ${importedElevationPoints.length.toLocaleString()}` +
        (extraNote ? ` — ${extraNote}` : '') + (notes.length ? ` — Lưu ý: ${notes.join('; ')}` : '');
    infoPanel.innerHTML = `
        <b>Bản vẽ:</b> ${filename}<br>
        <b>Số đối tượng hình học:</b> ${items.length.toLocaleString()} (${segTotal.toLocaleString()} đoạn)<br>
        <b>Số nhãn chữ:</b> ${textElements.length.toLocaleString()}<br>
        <b>Điểm dùng được cho Surface:</b> ${importedElevationPoints.length.toLocaleString()}<br>
        <b>Kích thước X:</b> ${size.x.toFixed(1)}m<br>
        <b>Kích thước Y:</b> ${size.y.toFixed(1)}m` +
        (notes.length ? `<br><br><b>Lưu ý:</b><br>${notes.map(n => '• ' + n).join('<br>')}` : '');
    renderSurfacePanel();
    renderPointsPanel();
    return { segments: segTotal, items: items.length, labels: textElements.length, notes };
}

// ------------------------------------------------------------------------------------------
// 7) Chữ: cỡ chữ theo chiều cao thật (to/nhỏ theo zoom như AutoCAD), tự ẩn khi quá nhỏ
// ------------------------------------------------------------------------------------------
function updateTextPositions() {
    const n = textElements.length;
    if (!n) return;
    const W = window.innerWidth, H = window.innerHeight;
    let hiddenLayers = '';
    layers.forEach((l, name) => { if (!l.visible) hiddenLayers += name + ','; });
    const key = camera.matrixWorldInverse.elements.join(',') + '|' + camera.projectionMatrix.elements[0] + '|' +
        camera.projectionMatrix.elements[5] + '|' + W + 'x' + H + '|' + n + '|' + impTextVersion + '|' + hiddenLayers;
    if (key === impLastTextKey) return; // camera không đổi -> khỏi tính lại
    impLastTextKey = key;

    // Hướng trục X/Y thế giới trên màn hình (để xoay chữ đúng theo góc nhìn)
    const target = controls.target;
    const s = Math.max(1e-3, camera.position.distanceTo(target)) * 0.05;
    const p0 = target.clone().project(camera);
    const pxv = target.clone().add(new THREE.Vector3(s, 0, 0)).project(camera);
    const pyv = target.clone().add(new THREE.Vector3(0, s, 0)).project(camera);
    const ux = (pxv.x - p0.x) * W / 2 / s, uy = -(pxv.y - p0.y) * H / 2 / s;
    const wx = (pyv.x - p0.x) * W / 2 / s, wy = -(pyv.y - p0.y) * H / 2 / s;
    const tanHalf = Math.tan(camera.fov * Math.PI / 360);
    const v = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
        const t = textElements[i], el = t.element;
        v.copy(t.position).project(camera);
        let show = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.1;
        if (show && hiddenLayers && t.layer && hiddenLayers.indexOf(t.layer + ',') !== -1) show = false; // lớp chứa chữ đang tắt
        let fs = 11, ang = 0;
        if (show && t.height) {
            const dist = camera.position.distanceTo(t.position);
            fs = t.height * H / (2 * tanHalf * dist) / 0.7; // chiều cao chữ (cap height ~0.7 em) -> cỡ chữ px
            if (fs < 4.5) show = false;
            else {
                if (fs > 220) fs = 220;
                const r = (t.rotation || 0) * Math.PI / 180;
                const vx = Math.cos(r) * ux + Math.sin(r) * wx, vy = Math.cos(r) * uy + Math.sin(r) * wy;
                ang = Math.atan2(vy, vx);
                if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI; // luôn đọc xuôi
            }
        }
        if (!show) { if (t._vis !== false) { el.style.display = 'none'; t._vis = false; } continue; }
        const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
        const fsI = Math.round(fs * 2) / 2;
        const fx = t.fx === undefined ? -0.5 : t.fx, fy = t.fy === undefined ? -0.5 : t.fy;
        const tr = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${ang.toFixed(3)}rad) translate(${fx * 100}%,${fy * 100}%)`;
        if (t._t !== tr) { el.style.transform = tr; t._t = tr; }
        if (t._fs !== fsI) { el.style.fontSize = fsI + 'px'; t._fs = fsI; }
        if (t._vis !== true) { el.style.display = 'block'; t._vis = true; }
    }
}

// ------------------------------------------------------------------------------------------
// 8) Chọn đối tượng nhập từ file (click / Window / Crossing)
//    Đối tượng được chọn sẽ được "chuyển" thành đối tượng tự vẽ thông thường (nằm trong `entities`),
//    nhờ vậy dùng được mọi lệnh Erase/Move/Copy/Rotate/Scale/Offset/Trim...; đoạn tương ứng trong
//    bản vẽ nhập được ẩn đi để không bị vẽ trùng.
// ------------------------------------------------------------------------------------------
function impPickAt(event) {
    if (!importedModel) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit)) return null;
    const dist = camera.position.distanceTo(hit);
    const tol = (2 * Math.tan(camera.fov * Math.PI / 360) * dist / rect.height) * 7; // ~7 pixel
    const gp = importedModel.group.position;
    const hx = hit.x - gp.x, hy = hit.y - gp.y;
    let best = null, bestD2 = tol * tol;
    importedModel.layerObjs.forEach((ls, name) => {
        const layer = layers.get(name);
        if (!ls.visible || (layer && layer.locked)) return;
        const arr = ls.geometry.attributes.position.array, owner = ls.geometry.userData.owner;
        for (let s = 0, cnt = owner.length; s < cnt; s++) {
            const b = s * 6;
            const x1 = arr[b], y1 = arr[b + 1], x2 = arr[b + 3], y2 = arr[b + 4];
            if (hx < (x1 < x2 ? x1 : x2) - tol || hx > (x1 > x2 ? x1 : x2) + tol ||
                hy < (y1 < y2 ? y1 : y2) - tol || hy > (y1 > y2 ? y1 : y2) + tol) continue;
            const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
            let u = l2 > 0 ? ((hx - x1) * dx + (hy - y1) * dy) / l2 : 0;
            u = u < 0 ? 0 : (u > 1 ? 1 : u);
            const qx = x1 + u * dx - hx, qy = y1 + u * dy - hy, d2 = qx * qx + qy * qy;
            if (d2 < bestD2) {
                const it = importedModel.items[owner[s]];
                if (it.promoted) continue;
                bestD2 = d2; best = it;
            }
        }
    });
    return best;
}

function impPromote(item) {
    if (!importedModel) return null;
    if (item.promoted) return item.promotedId ? entities.get(item.promotedId) : null;
    const gp = importedModel.group.position, o = importedModel.origin;
    const pts = [];
    for (let i = 0; i < item.xy.length; i += 2) pts.push(new THREE.Vector3(item.xy[i] - o.x + gp.x, item.xy[i + 1] - o.y + gp.y, 0));
    const layer = layers.get(item.layer);
    const obj = buildLineObject(pts, item.closed);
    setEntityColor(obj, layer ? layer.color : 0x00e5ff);
    const type = item.kind === 'LINE' ? 'LINE' : (item.kind === 'CIRCLE' ? 'CIRCLE' : 'POLYLINE');
    makeAddCommand(type, obj, item.layer).do(); // không đưa vào lịch sử Undo: chỉ là đổi dạng đối tượng
    const ent = entities.get(obj.userData.entityId);
    if (!ent) return null;
    obj.visible = layer ? layer.visible : true;
    // Ẩn các đoạn gốc (thu về độ dài 0) để không vẽ trùng
    const ls = importedModel.layerObjs.get(item.layer);
    if (ls) {
        const arr = ls.geometry.attributes.position.array;
        for (let s = 0; s < item.segCount; s++) {
            const b = (item.segStart + s) * 6;
            arr[b + 3] = arr[b]; arr[b + 4] = arr[b + 1]; arr[b + 5] = arr[b + 2];
        }
        ls.geometry.attributes.position.needsUpdate = true;
    }
    item.promoted = true; item.promotedId = ent.id;
    return ent;
}

/** Chọn các đối tượng nhập nằm trong khung (toạ độ màn hình). Trả về số đối tượng đã chọn. */
function impSelectInBox(minX, minY, maxX, maxY, windowMode) {
    if (!importedModel) return 0;
    const MAX = 4000;
    const rect = renderer.domElement.getBoundingClientRect();
    const gp = importedModel.group.position, o = importedModel.origin;
    // Khung chọn -> hộp bao trong toạ độ bản vẽ (nếu chiếu được xuống mặt phẳng z=0) để lọc nhanh
    let wb = null;
    {
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), ray = new THREE.Raycaster(), hit = new THREE.Vector3();
        const xs = [], ys = [];
        for (const [cx, cy] of [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]) {
            ray.setFromCamera(new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1), camera);
            if (!ray.ray.intersectPlane(plane, hit)) { xs.length = 0; break; }
            xs.push(hit.x - gp.x + o.x); ys.push(hit.y - gp.y + o.y);
        }
        if (xs.length === 4) wb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    }
    const toScreen = (ax, ay) => worldToScreen(new THREE.Vector3(ax - o.x + gp.x, ay - o.y + gp.y, 0));
    let picked = 0;
    const items = importedModel.items;
    for (let k = 0; k < items.length && picked < MAX; k++) {
        const it = items[k];
        if (it.promoted) continue;
        if (wb && (it.bx1 < wb.x0 || it.bx0 > wb.x1 || it.by1 < wb.y0 || it.by0 > wb.y1)) continue;
        const layer = layers.get(it.layer);
        if (layer && (!layer.visible || layer.locked)) continue;
        const sp = [];
        for (let i = 0; i < it.xy.length; i += 2) sp.push(toScreen(it.xy[i], it.xy[i + 1]));
        let match;
        if (windowMode) {
            match = sp.every(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
        } else {
            match = sp.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY);
            if (!match) {
                const segs = it.closed ? sp.length : sp.length - 1;
                for (let i = 0; i < segs && !match; i++) if (segmentIntersectsRect(sp[i], sp[(i + 1) % sp.length], minX, minY, maxX, maxY)) match = true;
            }
        }
        if (match) {
            const ent = impPromote(it);
            if (ent) { selectEntity(ent.id, true); picked++; }
        }
    }
    if (picked >= MAX) setCommandText(`Command: Đã chọn tối đa ${MAX.toLocaleString()} đối tượng từ bản vẽ nhập — hãy thu hẹp vùng chọn nếu cần thêm.`);
    return picked;
}
