/* =========================================================================================
 * BẢNG NỔI — kéo di chuyển bằng thanh tiêu đề, đổi kích thước bằng góc dưới bên phải (giống bảng XR)
 * Áp dụng cho: Toolspace, Layer Properties Manager, Surfaces, Points, Assembly, Properties.
 * Vị trí/kích thước được nhớ trong trình duyệt (localStorage) cho lần mở sau.
 * ========================================================================================= */
(function () {
    const IDS = ['toolspace', 'layers-panel', 'surface-panel', 'points-panel', 'assembly-panel', 'properties'];
    const KEY = 'cadPanelGeom_v1';
    let zTop = 15;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* không lưu được thì thôi */ } };

    function toFixedPosition(panel) {
        // Chuyển các panel đang neo bằng right/bottom/calc sang left/top tuyệt đối để kéo được
        const r = panel.getBoundingClientRect();
        panel.style.left = r.left + 'px';
        panel.style.top = r.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }
    function clampIntoView(panel) {
        const r = panel.getBoundingClientRect();
        const maxL = Math.max(0, window.innerWidth - 60), maxT = Math.max(0, window.innerHeight - 40);
        const left = Math.min(Math.max(-r.width + 80, r.left), maxL), top = Math.min(Math.max(0, r.top), maxT);
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        // Bảng cao hơn khoảng còn lại bên dưới (VD kéo Toolspace xuống) -> co chiều cao để góc đổi cỡ luôn nằm trong màn hình
        const room = window.innerHeight - top - 64; // chừa chỗ cho dòng lệnh và thanh trạng thái phía dưới
        if (r.height > room && room >= 120) panel.style.height = room + 'px';
    }
    function makeFloating(panel) {
        const header = panel.querySelector('.panel-header');
        if (!header || panel.dataset.floating) return;
        panel.dataset.floating = '1';
        panel.classList.add('floating-panel');
        const geom = saved[panel.id];
        if (geom) {
            panel.style.left = geom.left + 'px'; panel.style.top = geom.top + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto';
            if (geom.width) panel.style.width = geom.width + 'px';
            if (geom.height) panel.style.height = geom.height + 'px';
            panel.dataset.moved = '1';
        }
        const bringToFront = () => { panel.style.zIndex = String(Math.min(++zTop, 24)); };
        const remember = () => {
            const r = panel.getBoundingClientRect();
            if (r.width < 20) return; // đang ẩn
            saved[panel.id] = { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
            persist();
        };
        let drag = null;
        header.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('button, input, select, textarea, a')) return;
            bringToFront();
            if (!panel.dataset.moved) { toFixedPosition(panel); panel.dataset.moved = '1'; }
            const r = panel.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            header.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        header.addEventListener('pointermove', e => {
            if (!drag) return;
            panel.style.left = (e.clientX - drag.dx) + 'px';
            panel.style.top = Math.max(0, e.clientY - drag.dy) + 'px';
        });
        const end = () => { if (drag) { drag = null; clampIntoView(panel); remember(); } };
        header.addEventListener('pointerup', end);
        header.addEventListener('pointercancel', end);
        panel.addEventListener('pointerdown', () => bringToFront(), true);
        // Đổi kích thước bằng góc resize -> nhớ lại kích thước mới
        if (typeof ResizeObserver !== 'undefined') {
            let first = true;
            new ResizeObserver(() => { if (first) { first = false; return; } if (panel.dataset.moved) remember(); }).observe(panel);
        }
    }
    function init() { IDS.forEach(id => { const el = document.getElementById(id); if (el) makeFloating(el); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
    window.addEventListener('resize', () => IDS.forEach(id => { const el = document.getElementById(id); if (el && el.dataset.moved) clampIntoView(el); }));
})();
