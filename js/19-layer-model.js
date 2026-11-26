/* =========================================================================================
 * MÔ HÌNH LAYER ĐẦY ĐỦ — giống bảng Layer Properties Manager của AutoCAD
 *
 *  Mỗi layer có: tên, On (bật/tắt), Freeze (đóng băng), Lock (khoá), Plot (in), Color (màu), Linetype (kiểu nét),
 *  Lineweight (độ dày nét), Transparency (độ trong suốt), Description (mô tả).
 *  - Dữ liệu được nạp từ bảng LAYER/LTYPE của file DXF/DWG (xem js/16-import-model.js).
 *  - Màu, kiểu nét (nét đứt/đứt chấm/... theo định nghĩa trong file × LTSCALE) và độ trong suốt được áp lên hình vẽ;
 *    Lineweight lưu và hiển thị trong bảng (WebGL không vẽ nét dày thật như AutoCAD khi tắt hiển thị độ dày).
 *  - Layer.visible là cờ HIỆU LỰC (= On && !Freeze) mà toàn bộ code cũ vẫn dùng.
 * ========================================================================================= */

const LAYER_LINEWEIGHTS = [-3, 0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
const LAYER_ACI_NAMES = { 1: 'red', 2: 'yellow', 3: 'green', 4: 'cyan', 5: 'blue', 6: 'magenta', 7: 'white' };
const LAYER_RGB_NAMES = { 0xff0000: 'red', 0xffff00: 'yellow', 0x00ff00: 'green', 0x00ffff: 'cyan', 0x0000ff: 'blue', 0xff00ff: 'magenta', 0xffffff: 'white' };
const LAYER_NEW_COLORS = [0xff5555, 0x55ff55, 0x5599ff, 0xffff55, 0xff55ff, 0x55ffff, 0xff9944];

// Kiểu nét chuẩn (đơn vị acad.lin; dương = nét, âm = khoảng trống, 0 = chấm)
const LINETYPE_PRESETS = {
    'DASHED': [0.5, -0.25], 'HIDDEN': [0.25, -0.125], 'CENTER': [1.25, -0.25, 0.25, -0.25],
    'PHANTOM': [1.25, -0.25, 0.25, -0.25, 0.25, -0.25], 'DOT': [0, -0.25], 'DASHDOT': [0.5, -0.25, 0, -0.25],
    'DIVIDE': [0.5, -0.25, 0, -0.25, 0, -0.25], 'BORDER': [0.5, -0.25, 0.5, -0.25, 0, -0.25]
};
const LINETYPE_PRESET_NAMES = ['Continuous', 'DASHED', 'HIDDEN', 'CENTER', 'PHANTOM', 'DOT', 'DASHDOT', 'DIVIDE', 'BORDER'];

let impLinetypes = new Map(); // TÊN_VIẾT_HOA -> { name, desc, pattern:[...] }  (nạp từ bảng LTYPE của file)
let impLtScale = 1;           // $LTSCALE của bản vẽ (người dùng chỉnh được trong bảng Layer)
let lyrFilter = '';

// ------------------------------------------------------------------------------------------
// Thuộc tính layer & nhãn hiển thị
// ------------------------------------------------------------------------------------------
function layerEnsure(layer) {
    if (layer.on === undefined) layer.on = layer.visible !== false;
    if (layer.frozen === undefined) layer.frozen = false;
    if (layer.locked === undefined) layer.locked = false;
    if (layer.plot === undefined) layer.plot = true;
    if (!layer.linetype) layer.linetype = 'Continuous';
    if (layer.lineweight === undefined) layer.lineweight = -3;
    if (layer.transparency === undefined) layer.transparency = 0;
    if (layer.description === undefined) layer.description = '';
    if (layer.aci === undefined) layer.aci = null;
    layer.visible = layer.on !== false && !layer.frozen;
    return layer;
}
function lineweightLabel(v) {
    if (v === undefined || v === null || v === -3) return 'Default';
    if (v === -2) return 'ByLayer';
    if (v === -1) return 'ByBlock';
    return (v / 100).toFixed(2) + ' mm';
}
function layerColorLabel(layer) {
    if (layer.aci && LAYER_ACI_NAMES[layer.aci]) return LAYER_ACI_NAMES[layer.aci];
    if (layer.aci) return String(layer.aci);
    const c = layer.color;
    if (LAYER_RGB_NAMES[c]) return LAYER_RGB_NAMES[c];
    return `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`;
}
const layerHex = c => '#' + (c & 0xffffff).toString(16).padStart(6, '0');

function layerLinetypeNames() {
    const set = new Set(LINETYPE_PRESET_NAMES.map(n => n.toUpperCase()));
    const out = LINETYPE_PRESET_NAMES.slice();
    impLinetypes.forEach(d => { if (!set.has(d.name.toUpperCase()) && !/^(bylayer|byblock)$/i.test(d.name)) { set.add(d.name.toUpperCase()); out.push(d.name); } });
    layers.forEach(l => { if (l.linetype && !set.has(String(l.linetype).toUpperCase())) { set.add(String(l.linetype).toUpperCase()); out.push(l.linetype); } });
    return out;
}

function presetPattern(name) {
    const up = String(name).toUpperCase();
    if (LINETYPE_PRESETS[up]) return LINETYPE_PRESETS[up];
    let m = /^(.*)X2$/.exec(up);
    if (m && LINETYPE_PRESETS[m[1]]) return LINETYPE_PRESETS[m[1]].map(v => v * 2);
    m = /^(.*)2$/.exec(up);
    if (m && LINETYPE_PRESETS[m[1]]) return LINETYPE_PRESETS[m[1]].map(v => v * 0.5);
    return null;
}
/** Mẫu nét [dương/âm/0...] hoặc null nếu nét liền. */
function getLinetypePattern(name) {
    if (!name) return null;
    const key = String(name).trim();
    if (/^(continuous|bylayer|byblock)$/i.test(key)) return null;
    const def = impLinetypes.get(key.toUpperCase());
    const pat = def ? def.pattern : presetPattern(key);
    if (!pat || pat.length < 2 || !pat.some(v => v < 0) || !pat.some(v => v >= 0)) return null;
    return pat;
}

// ------------------------------------------------------------------------------------------
// Vật liệu nét vẽ: màu + độ trong suốt + mẫu nét (shader nét đứt tổng quát, tối đa 12 phần tử)
// ------------------------------------------------------------------------------------------
const layerDashMaterials = new Set();
function makeLayerMaterial(layer, vertexColors) {
    const opacity = 1 - (layer.transparency || 0) / 100;
    const base = { color: vertexColors ? 0xffffff : layer.color, vertexColors: !!vertexColors, transparent: opacity < 1, opacity };
    const pat = getLinetypePattern(layer.linetype);
    if (!pat) return new THREE.LineBasicMaterial(base);
    // Chấm (0) -> nét ngắn; ghép thành mảng phẳng (dương = bật, âm = tắt) đã nhân LTSCALE
    const nonZero = pat.filter(v => v !== 0).map(Math.abs);
    const dot = 0.1 * Math.min(...nonZero);
    const elems = pat.slice(0, 12).map(v => (v === 0 ? dot : v) * impLtScale);
    const period = elems.reduce((s, v) => s + Math.abs(v), 0);
    if (!(period > 0)) return new THREE.LineBasicMaterial(base);
    const arr = new Array(12).fill(0);
    elems.forEach((v, i) => { arr[i] = v; });
    const mat = new THREE.LineDashedMaterial(Object.assign({ dashSize: 1, gapSize: 1 }, base));
    mat.userData.dash = { count: elems.length, period };
    mat.onBeforeCompile = shader => {
        shader.uniforms.uPat = { value: arr };
        shader.uniforms.uCount = { value: elems.length };
        shader.uniforms.uPeriod = { value: period };
        shader.uniforms.uPxWorld = { value: 0 };
        shader.fragmentShader = 'uniform float uPat[12];\nuniform int uCount;\nuniform float uPeriod;\nuniform float uPxWorld;\n' +
            shader.fragmentShader.replace(/if\s*\(\s*mod\s*\(\s*vLineDistance\s*,\s*totalSize\s*\)\s*>\s*dashSize\s*\)\s*\{\s*discard;\s*\}/,
                `float ld = mod(vLineDistance, uPeriod);
                if (uPeriod > uPxWorld * 3.0) {
                    float acc = 0.0; bool on = true;
                    for (int i = 0; i < 12; i++) {
                        if (i >= uCount) break;
                        float len = abs(uPat[i]);
                        if (ld < acc + len || i == uCount - 1) { on = uPat[i] > 0.0; break; }
                        acc += len;
                    }
                    if (!on) discard;
                }`);
        mat.userData.shader = shader;
    };
    mat.customProgramCacheKey = () => 'lyrdash';
    layerDashMaterials.add(mat);
    return mat;
}
function layerDisposeMaterial(mat) { if (mat) { layerDashMaterials.delete(mat); mat.dispose(); } }

/** Mỗi khung hình: cập nhật kích thước 1 pixel (đơn vị bản vẽ) để nét đứt quá nhỏ so với pixel thì vẽ liền (tránh nhiễu). */
function layerUpdateDashPixel() {
    if (!layerDashMaterials.size) return;
    const dist = camera.position.distanceTo(controls.target) || 1;
    const px = 2 * Math.tan(camera.fov * Math.PI / 360) * dist / Math.max(1, window.innerHeight);
    layerDashMaterials.forEach(m => { if (m.userData.shader) m.userData.shader.uniforms.uPxWorld.value = px; });
}

// ------------------------------------------------------------------------------------------
// Áp thuộc tính layer lên hình nhập + đối tượng tự vẽ
// ------------------------------------------------------------------------------------------
function layerRecolorImport(layer) {
    const ls = layer.importObject3D;
    if (!ls || !ls.userData.hasColors || typeof importedModel === 'undefined' || !importedModel) return;
    const geo = ls.geometry, owner = geo.userData.owner, col = geo.attributes.color.array;
    const lc = new THREE.Color(layer.color), tmp = new THREE.Color();
    for (let s = 0; s < owner.length; s++) {
        const it = importedModel.items[owner[s]];
        const c = (it && it.color != null) ? tmp.set(it.color) : lc;
        const b = s * 6;
        col[b] = c.r; col[b + 1] = c.g; col[b + 2] = c.b; col[b + 3] = c.r; col[b + 4] = c.g; col[b + 5] = c.b;
    }
    geo.attributes.color.needsUpdate = true;
}
function layerUpdateImportMaterial(layer) {
    const ls = layer.importObject3D;
    if (!ls) return;
    layerDisposeMaterial(ls.material);
    ls.material = makeLayerMaterial(layer, !!ls.userData.hasColors);
    if (getLinetypePattern(layer.linetype)) ls.computeLineDistances();
    layerRecolorImport(layer);
}
function layerApplyVisual(layer) {
    layerEnsure(layer);
    if (layer.importObject3D) { layer.importObject3D.visible = layer.visible; layerUpdateImportMaterial(layer); }
    entities.forEach(e => {
        if (e.layerName !== layer.name) return;
        e.object.visible = layer.visible;
        if (e.object.isLine) {
            const selected = selectedIds.has(e.id);
            const col = selected ? SELECT_COLOR : (e.object.userData.baseColor !== undefined ? e.object.userData.baseColor : layer.color);
            layerDisposeMaterial(e.object.material);
            e.object.material = makeLayerMaterial(layer, false);
            if (getLinetypePattern(layer.linetype)) e.object.computeLineDistances();
            setEntityColor(e.object, col);
        } else if (!selectedIds.has(e.id) && e.object.userData.baseColor === undefined) {
            setEntityColor(e.object, layer.color);
        }
    });
    rebuildSnapCandidates();
    impTextVersion++;
}

// Tạo layer mới theo thuộc tính đã cho (dùng khi nhập file / tạo layer thủ công)
function layerCreate(name, attrs) {
    const layer = layerEnsure(Object.assign({ name, color: 0xffffff, visible: true, locked: false, importObject3D: null }, attrs || {}));
    layers.set(name, layer);
    return layer;
}

// ------------------------------------------------------------------------------------------
// Các hàm thao tác layer (thay thế bản cũ trong 03-layers-panel.js)
// ------------------------------------------------------------------------------------------
function setCurrentLayer(layerName) {
    const layer = layers.get(layerName);
    if (!layer) return;
    currentLayerName = layerName;
    currentDrawColor = layer.color;
    renderLayersPanel();
    setCommandText(`Command: Layer hiện hành = "${layerName}".`);
}
function setLayerVisible(layerName, visible) { const l = layers.get(layerName); if (!l) return; l.on = !!visible; l.userEdited = true; layerApplyVisual(l); }
function setLayerFrozen(layerName, frozen) { const l = layers.get(layerName); if (!l) return; l.frozen = !!frozen; l.userEdited = true; layerApplyVisual(l); }
function setLayerLocked(layerName, locked) { const l = layers.get(layerName); if (!l) return; l.locked = !!locked; l.userEdited = true; }
function setLayerPlot(layerName, plot) { const l = layers.get(layerName); if (!l) return; l.plot = !!plot; l.userEdited = true; }
function setLayerColor(layerName, hexColor) {
    const l = layers.get(layerName); if (!l) return;
    l.color = hexColor; l.aci = null; l.userEdited = true;
    if (currentLayerName === layerName) currentDrawColor = hexColor;
    layerApplyVisual(l);
}
function setLayerLinetype(layerName, linetype) { const l = layers.get(layerName); if (!l) return; l.linetype = linetype; l.userEdited = true; layerApplyVisual(l); }
function setLayerLineweight(layerName, lw) { const l = layers.get(layerName); if (!l) return; l.lineweight = lw; l.userEdited = true; }
function setLayerTransparency(layerName, t) { const l = layers.get(layerName); if (!l) return; l.transparency = Math.max(0, Math.min(90, Math.round(t) || 0)); l.userEdited = true; layerApplyVisual(l); }
function setLayerDescription(layerName, d) { const l = layers.get(layerName); if (!l) return; l.description = d; l.userEdited = true; }
function setGlobalLtScale(v) {
    if (!(v > 0)) return;
    impLtScale = v;
    layers.forEach(l => { if (l.importObject3D && getLinetypePattern(l.linetype)) layerUpdateImportMaterial(l); });
    entities.forEach(e => { const l = layers.get(e.layerName); if (l && e.object.isLine && getLinetypePattern(l.linetype)) layerApplyVisual(l); });
}

function addNewLayer() {
    let n = layers.size, name;
    do { name = `Layer${n++}`; } while (layers.has(name));
    const color = LAYER_NEW_COLORS[layers.size % LAYER_NEW_COLORS.length];
    layerCreate(name, { color });
    setCurrentLayer(name);
}
function deleteLayer(layerName) {
    if (layerName === '0') { setCommandText('Command: Không thể xoá layer 0.'); return; }
    entities.forEach(e => { if (e.layerName === layerName) e.layerName = '0'; }); // dồn entity về layer 0
    const layer = layers.get(layerName);
    if (layer && layer.importObject3D) layer.importObject3D.visible = false;
    if (currentLayerName === layerName) setCurrentLayer('0');
    layers.delete(layerName);
    renderLayersPanel();
}
function renameLayer(oldName, newName) {
    newName = newName.trim().replace(/['"<>]/g, '');
    if (!newName || oldName === '0' || layers.has(newName)) { renderLayersPanel(); return; }
    const layer = layers.get(oldName);
    layer.name = newName;
    layers.delete(oldName);
    layers.set(newName, layer);
    entities.forEach(e => { if (e.layerName === oldName) e.layerName = newName; });
    if (currentLayerName === oldName) currentLayerName = newName;
    if (typeof importedModel !== 'undefined' && importedModel) {
        const ls = importedModel.layerObjs.get(oldName);
        if (ls) { importedModel.layerObjs.delete(oldName); importedModel.layerObjs.set(newName, ls); }
        importedModel.items.forEach(it => { if (it.layer === oldName) it.layer = newName; });
    }
    textElements.forEach(t => { if (t.layer === oldName) t.layer = newName; });
    impTextVersion++;
    renderLayersPanel();
}

// ------------------------------------------------------------------------------------------
// Bảng Layer Properties Manager
// ------------------------------------------------------------------------------------------
function renderLayersPanel() {
    const body = document.getElementById('layers-panel-body');
    if (!body) return;
    const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const all = Array.from(layers.values());
    all.forEach(layerEnsure);
    const shown = all.filter(l => !lyrFilter || l.name.toLowerCase().includes(lyrFilter.toLowerCase()))
        .sort((a, b) => (a.name === '0' ? -1 : b.name === '0' ? 1 : a.name.localeCompare(b.name, 'vi', { numeric: true })));
    const ltNames = layerLinetypeNames();
    const lwOpts = cur => LAYER_LINEWEIGHTS.concat(LAYER_LINEWEIGHTS.includes(cur) ? [] : [cur]).map(v => `<option value="${v}"${v === cur ? ' selected' : ''}>${lineweightLabel(v)}</option>`).join('');

    let html = `<div class="lyr-toolbar">
        <button id="lyr-new" title="Tạo layer mới">＋ New Layer</button>
        <input id="lyr-search" type="text" placeholder="Search for layer" value="${esc(lyrFilter)}">
        <label class="lyr-lts" title="Tỉ lệ nét (LTSCALE): tăng/giảm để nét đứt dài/ngắn hơn">LTSCALE <input id="lyr-ltscale" type="number" step="any" min="0" value="${impLtScale}"></label>
    </div>
    <div class="lyr-table-wrap"><table class="lyr-table"><thead><tr>
        <th>S.</th><th>Name</th><th>On</th><th>Freeze</th><th>Lock</th><th>Plot</th><th>Color</th><th>Linetype</th><th>Lineweight</th><th>Transparency</th><th>Description</th><th></th>
    </tr></thead><tbody>`;
    shown.forEach(l => {
        const cur = l.name === currentLayerName;
        const n = esc(l.name);
        html += `<tr data-layer="${n}" class="${cur ? 'lyr-current' : ''}">
            <td class="lyr-c" data-act="current" title="Đặt làm layer hiện hành">${cur ? '<span class="lyr-check">✔</span>' : '▱'}</td>
            <td><input class="lyr-name" data-act="rename" value="${n}"${l.name === '0' ? ' disabled' : ''}></td>
            <td class="lyr-c" data-act="on" title="Bật/tắt layer">${l.on ? '💡' : '<span class="lyr-dim">💡</span>'}</td>
            <td class="lyr-c" data-act="freeze" title="Đóng băng/rã đông">${l.frozen ? '❄' : '☀'}</td>
            <td class="lyr-c" data-act="lock" title="Khoá/mở khoá">${l.locked ? '🔒' : '🔓'}</td>
            <td class="lyr-c" data-act="plot" title="In/không in">${l.plot ? '🖨' : '⛔'}</td>
            <td class="lyr-color"><label><input type="color" data-act="color" value="${layerHex(l.color)}"><span class="lyr-swatch" style="background:${layerHex(l.color)}"></span><span class="lyr-cname">${esc(layerColorLabel(l))}</span></label></td>
            <td><select data-act="linetype">${ltNames.map(t => `<option value="${esc(t)}"${t.toUpperCase() === String(l.linetype).toUpperCase() ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
            <td><select data-act="lineweight">${lwOpts(l.lineweight)}</select></td>
            <td><input class="lyr-num" type="number" min="0" max="90" step="1" data-act="transparency" value="${l.transparency}"></td>
            <td><input class="lyr-desc" data-act="description" value="${esc(l.description)}"></td>
            <td class="lyr-c" data-act="delete" title="Xoá layer">${l.name === '0' ? '' : '🗑'}</td></tr>`;
    });
    html += `</tbody></table></div><div class="lyr-footer">${lyrFilter ? 'Filtered' : 'All'}: ${shown.length} layers displayed of ${all.length} total layers</div>`;
    body.innerHTML = html;

    const nameOf = el => el.closest('tr') && el.closest('tr').dataset.layer;
    body.querySelectorAll('td.lyr-c').forEach(td => td.addEventListener('click', ev => {
        const name = nameOf(td), act = td.dataset.act, l = layers.get(name);
        if (!l) return;
        ev.stopPropagation();
        if (act === 'current') setCurrentLayer(name);
        else if (act === 'on') { setLayerVisible(name, !l.on); renderLayersPanel(); }
        else if (act === 'freeze') { setLayerFrozen(name, !l.frozen); renderLayersPanel(); }
        else if (act === 'lock') { setLayerLocked(name, !l.locked); renderLayersPanel(); }
        else if (act === 'plot') { setLayerPlot(name, !l.plot); renderLayersPanel(); }
        else if (act === 'delete') deleteLayer(name);
    }));
    body.querySelectorAll('[data-act]').forEach(el => {
        const act = el.dataset.act;
        if (el.tagName === 'TD') return;
        el.addEventListener('change', () => {
            const name = nameOf(el);
            if (act === 'rename') renameLayer(name, el.value);
            else if (act === 'color') { setLayerColor(name, parseInt(el.value.slice(1), 16)); renderLayersPanel(); }
            else if (act === 'linetype') { setLayerLinetype(name, el.value); renderLayersPanel(); }
            else if (act === 'lineweight') { setLayerLineweight(name, parseInt(el.value, 10)); }
            else if (act === 'transparency') { setLayerTransparency(name, parseFloat(el.value)); renderLayersPanel(); }
            else if (act === 'description') setLayerDescription(name, el.value);
        });
        el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); });
    });
    document.getElementById('lyr-new').onclick = addNewLayer;
    const search = document.getElementById('lyr-search');
    search.addEventListener('input', () => {
        lyrFilter = search.value;
        const pos = search.selectionStart;
        renderLayersPanel();
        const s2 = document.getElementById('lyr-search'); s2.focus(); s2.setSelectionRange(pos, pos);
    });
    search.addEventListener('keydown', e => e.stopPropagation());
    const lts = document.getElementById('lyr-ltscale');
    lts.addEventListener('change', () => setGlobalLtScale(parseFloat(lts.value)));
    lts.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') lts.blur(); });
}
