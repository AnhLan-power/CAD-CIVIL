/* =========================================================================================
 * SỬA NHANH CHỮ / CAO ĐỘ bằng double-click (công cụ Select)
 *  - Double-click chữ (TEXT/MTEXT nhập từ DXF/DWG hoặc chữ tự vẽ): sửa nội dung ngay tại chỗ.
 *  - Double-click điểm khảo sát/chữ cao độ: sửa cao độ (Z). Chữ số khảo sát nhập từ bản vẽ được chuyển thành
 *    điểm POINT nên dùng cho Surface như điểm thường.
 *  Có Undo/Redo. (Sửa thêm chiều cao chữ, góc quay: xem bảng Properties khi chọn chữ.)
 * ========================================================================================= */
function makePointZCommand(entity, newZ) {
    const obj = entity.object, oldZ = obj.userData.elevation;
    const xy = () => obj.userData.pointXY;
    return {
        do() { updatePointGeometry(entity, xy().x, xy().y, newZ); },
        undo() { updatePointGeometry(entity, xy().x, xy().y, oldZ); }
    };
}

(function () {
    const popup = document.createElement('div');
    popup.id = 'text-edit-popup';
    popup.style.cssText = 'display:none;position:fixed;z-index:50;background:#1e1e1e;border:1px solid var(--accent-color,#0098ff);border-radius:3px;padding:6px 8px;gap:6px;align-items:center;box-shadow:0 2px 10px rgba(0,0,0,.6);';
    popup.innerHTML = '<span id="text-edit-label" style="font-size:12px;color:#7fffd4;white-space:nowrap"></span>' +
        '<input id="text-edit-input" type="text" style="width:260px;background:#2a2a2a;border:1px solid #444;color:#fff;font-size:13px;padding:4px 6px;border-radius:2px;outline:none">' +
        '<span style="font-size:11px;color:#888;white-space:nowrap">Enter = lưu, Esc = huỷ</span>';
    document.body.appendChild(popup);
    const input = popup.querySelector('#text-edit-input'), label = popup.querySelector('#text-edit-label');
    let current = null;

    function open(entity, x, y) {
        current = entity;
        if (entity.type === 'POINT') { label.textContent = 'Cao độ (Z):'; input.value = String(entity.object.userData.elevation); }
        else { label.textContent = 'Nội dung:'; input.value = String(entity.object.userData.text || '').replace(/\n/g, '\\n'); }
        popup.style.display = 'flex';
        popup.style.left = Math.max(8, Math.min(window.innerWidth - 460, x - 20)) + 'px';
        popup.style.top = Math.max(8, Math.min(window.innerHeight - 50, y + 14)) + 'px';
        input.focus(); input.select();
    }
    function close() { popup.style.display = 'none'; current = null; }
    function commit() {
        const ent = current;
        if (!ent) return;
        const val = input.value;
        if (ent.type === 'TEXT') {
            const t = val.replace(/\\n/g, '\n').trim();
            if (t) { execute(makeTextEditCommand(ent, { text: t })); setCommandText('Command: Đã sửa nội dung chữ.'); }
        } else if (ent.type === 'POINT') {
            const z = parseFloat(val.replace(',', '.'));
            if (!isNaN(z)) { execute(makePointZCommand(ent, z)); setCommandText(`Command: Đã sửa cao độ = ${z}. (Nếu đã tạo Surface, hãy tạo lại để cập nhật.)`); }
            else setCommandText('Command: Cao độ phải là số.');
        }
        close();
        updatePropertiesPanel();
    }
    input.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') commit(); else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 150));

    renderer.domElement.addEventListener('dblclick', event => {
        if (activeTool !== 'select') return;
        let ent = pickEntityAt(event);
        if (!ent) {
            const t = impPickLabelAt(event.clientX, event.clientY);
            ent = t ? impPromoteLabel(t) : null;
        }
        if (ent && (ent.type === 'TEXT' || ent.type === 'POINT')) {
            selectEntity(ent.id, false);
            open(ent, event.clientX, event.clientY);
        }
    });
})();
