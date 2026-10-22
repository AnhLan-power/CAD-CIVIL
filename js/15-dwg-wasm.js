/* =========================================================================================
 * DwgWasm — đọc file DWG NGAY TRONG TRÌNH DUYỆT (WebAssembly, viết bằng Rust, dùng thư viện
 * `acadrust`), trả về chuỗi DXF để đưa vào đúng luồng nhập DXF sẵn có của app. Không cần server.
 *
 * File WebAssembly cần có: wasm/dwg_bridge.wasm (cùng thư mục với index.html).
 * Nguồn Rust nằm ở thư mục dwg-bridge/ (xem README-DWG.md để tự build lại).
 * ========================================================================================= */
const DwgWasm = (function () {
    let wasmSource = 'wasm/dwg_bridge.wasm';
    let compiled = null; // WebAssembly.Module đã biên dịch — dùng lại cho mọi lần mở file

    // Cho phép đổi nguồn (đường dẫn khác, hoặc ArrayBuffer/Module khi chạy test)
    function setSource(src) { wasmSource = src; compiled = null; }

    async function loadModule() {
        if (compiled) return compiled;
        if (wasmSource instanceof WebAssembly.Module) {
            compiled = wasmSource;
        } else if (wasmSource instanceof ArrayBuffer || ArrayBuffer.isView(wasmSource)) {
            compiled = await WebAssembly.compile(wasmSource);
        } else {
            const resp = await fetch(wasmSource);
            if (!resp.ok) {
                throw new Error(`Không tải được bộ đọc DWG (${resp.status}). Hãy kiểm tra file "${wasmSource}" đã được tải lên cùng thư mục với index.html chưa, và app phải chạy qua http(s) (không mở trực tiếp file://).`);
            }
            const type = resp.headers.get('content-type') || '';
            if (WebAssembly.compileStreaming && type.includes('application/wasm')) {
                compiled = await WebAssembly.compileStreaming(resp);
            } else {
                compiled = await WebAssembly.compile(await resp.arrayBuffer());
            }
        }
        return compiled;
    }

    // DWG đời cũ (R2000/R2004) lưu chữ theo bảng mã nên chữ có dấu có thể ra dạng &#7901; hoặc \U+1EDD
    // — đổi lại thành ký tự Unicode thật để chữ tiếng Việt hiển thị đúng.
    function decodeTextEscapes(text) {
        if (text.indexOf('&#') === -1 && text.indexOf('\\U+') === -1) return text;
        return text
            .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => safeCodePoint(parseInt(h, 16), m))
            .replace(/&#(\d+);/g, (m, d) => safeCodePoint(parseInt(d, 10), m))
            .replace(/\\U\+([0-9a-fA-F]{4})/g, (m, h) => safeCodePoint(parseInt(h, 16), m));
    }
    function safeCodePoint(cp, fallback) {
        try { return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : fallback; } catch (e) { return fallback; }
    }

    /**
     * Chuyển DWG -> DXF.
     * @param {ArrayBuffer} arrayBuffer nội dung file .dwg
     * @param {{failsafe?: boolean}} [options] failsafe (mặc định true): cố cứu tối đa dữ liệu từ file đọc lệch/hỏng
     * @returns {Promise<{dxfText: string, notes: string[], entityCount: number}>}
     */
    async function convert(arrayBuffer, options) {
        const failsafe = !(options && options.failsafe === false);
        const module = await loadModule();
        // Mỗi lần mở file dùng 1 instance MỚI: bộ nhớ sạch, và nếu file lỗi làm WASM dừng đột ngột
        // thì không ảnh hưởng lần mở sau.
        const instance = await WebAssembly.instantiate(module, {});
        const ex = instance.exports;
        const bytes = new Uint8Array(arrayBuffer);
        try {
            const ptr = ex.dwg_alloc(bytes.length);
            new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes); // lấy lại ex.memory.buffer SAU khi cấp phát (bộ nhớ có thể đã nở ra)
            const status = ex.dwg_convert(ptr, bytes.length, failsafe ? 1 : 0);
            const decoder = new TextDecoder('utf-8');
            const out = decoder.decode(new Uint8Array(ex.memory.buffer, ex.dwg_out_ptr(), ex.dwg_out_len()));
            if (status !== 0) throw new Error(out);
            const notesText = decoder.decode(new Uint8Array(ex.memory.buffer, ex.dwg_notes_ptr(), ex.dwg_notes_len()));
            return {
                dxfText: decodeTextEscapes(out),
                notes: notesText ? notesText.split('\n') : [],
                entityCount: ex.dwg_entity_count()
            };
        } catch (e) {
            if (typeof WebAssembly.RuntimeError === 'function' && e instanceof WebAssembly.RuntimeError) {
                throw new Error('Bộ đọc DWG bị dừng đột ngột khi xử lý file này (file có cấu trúc chưa được hỗ trợ hoặc bị hỏng). Thử xuất file sang DXF từ AutoCAD/Civil 3D.');
            }
            throw e;
        }
    }

    return { setSource, convert, decodeTextEscapes };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DwgWasm; // để test bằng Node
