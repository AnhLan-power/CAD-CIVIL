//! dwg_bridge — cầu nối DWG → DXF chạy trong trình duyệt (WebAssembly).
//!
//! JavaScript đưa byte của file .dwg vào, Rust dùng thư viện `acadrust` đọc DWG rồi trả về chuỗi
//! DXF (ASCII). Phần còn lại của app CAD dùng lại đúng luồng nhập DXF sẵn có.
//!
//! Giao diện C đơn giản (không cần wasm-bindgen):
//!   dwg_alloc(len) -> ptr            cấp vùng nhớ để JS ghi byte DWG vào
//!   dwg_convert(ptr, len, failsafe)  -> 0 = OK, khác 0 = lỗi
//!   dwg_out_ptr()/dwg_out_len()      DXF (khi OK) hoặc thông báo lỗi (khi lỗi)
//!   dwg_notes_ptr()/dwg_notes_len()  cảnh báo khi đọc (đối tượng bỏ qua/không hỗ trợ...)
//!   dwg_entity_count()               số đối tượng đọc được
//!   dwg_free(ptr, len)               giải phóng vùng nhớ đã cấp

use std::cell::RefCell;
use std::io::Cursor;

use acadrust::{DwgReadOptions, DwgReader, DxfWriter};

/// Kết quả chuyển đổi (dùng chung cho cả test native và giao diện WASM).
pub struct Converted {
    pub dxf: Vec<u8>,
    pub notes: Vec<String>,
    pub entity_count: usize,
}

/// Đọc DWG từ bộ nhớ và ghi ra DXF (ASCII).
/// `failsafe = true`: cố cứu tối đa dữ liệu từ file hỏng/đọc lệch thay vì báo lỗi ngay.
pub fn convert_bytes(bytes: &[u8], failsafe: bool) -> Result<Converted, String> {
    if bytes.len() < 6 || &bytes[0..2] != b"AC" {
        return Err("Không phải file DWG hợp lệ (thiếu tiêu đề \"AC....\").".to_string());
    }
    let options = if failsafe { DwgReadOptions::failsafe() } else { DwgReadOptions::default() };
    let mut reader = DwgReader::from_stream_with_options(Cursor::new(bytes), options);
    let doc = reader.read().map_err(|e| format!("Lỗi đọc DWG: {e}"))?;

    let mut notes: Vec<String> = reader.notifications.iter().map(|n| n.to_string()).collect();
    let entity_count = doc.entities().count();
    // Giới hạn số cảnh báo trả về để không làm phình bộ nhớ khi file có hàng nghìn đối tượng lạ
    const MAX_NOTES: usize = 200;
    if notes.len() > MAX_NOTES {
        let extra = notes.len() - MAX_NOTES;
        notes.truncate(MAX_NOTES);
        notes.push(format!("... và {extra} cảnh báo khác"));
    }

    let dxf = DxfWriter::new(&doc)
        .write_to_vec()
        .map_err(|e| format!("Lỗi ghi DXF: {e}"))?;
    let dxf = patch_layer_true_colors(&doc, dxf);
    Ok(Converted { dxf, notes, entity_count })
}

/// acadrust ghi màu layer dạng RGB thành chỉ số ACI 7 (trắng) và bỏ mã 420 (true color). Hàm này bổ sung lại mã 420
/// vào đúng bản ghi LAYER (cùng thứ tự với `doc.layers.iter()` — thứ tự mà bộ ghi DXF dùng), để giao diện web dựng
/// đúng màu RGB của layer.
pub fn patch_layer_true_colors(doc: &acadrust::CadDocument, dxf: Vec<u8>) -> Vec<u8> {
    let rgb: Vec<Option<i32>> = doc.layers.iter().map(|l| l.color.to_true_color_value()).collect();
    if rgb.iter().all(|c| c.is_none()) {
        return dxf;
    }
    let text = match String::from_utf8(dxf) {
        Ok(t) => t,
        Err(e) => return e.into_bytes(),
    };
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let layer_line = format!("{eol}LAYER{eol}");
    let lw_line = format!("{eol}370{eol}");
    let mut out = String::with_capacity(text.len() + 16 * rgb.len());
    let mut pos = 0usize;
    let mut idx = 0usize;
    let mut search = 0usize;
    while let Some(rel) = text[search..].find(&layer_line) {
        let at = search + rel;
        search = at + layer_line.len();
        // Chỉ nhận dòng "LAYER" đứng sau mã nhóm 0 (bỏ qua "2 / LAYER" của tiêu đề bảng và "8 / LAYER" của đối tượng)
        let prev_line_start = text[..at].rfind('\n').map(|i| i + 1).unwrap_or(0);
        if text[prev_line_start..at].trim_end_matches('\r').trim() != "0" {
            continue;
        }
        if let Some(Some(tc)) = rgb.get(idx) {
            if let Some(p) = text[search..].find(&lw_line) {
                let ins = search + p;
                out.push_str(&text[pos..ins]);
                out.push_str(&format!("{eol}420{eol}{tc}"));
                pos = ins;
            }
        }
        idx += 1;
    }
    out.push_str(&text[pos..]);
    out.into_bytes()
}

// ---------------------------------------------------------------------------------------------
// Giao diện C cho WebAssembly
// ---------------------------------------------------------------------------------------------
#[derive(Default)]
struct State {
    out: Vec<u8>,
    notes: Vec<u8>,
    entity_count: usize,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

#[no_mangle]
pub extern "C" fn dwg_alloc(len: usize) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(len.max(1));
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` phải là con trỏ do `dwg_alloc(len)` trả về, với đúng `len` đã dùng khi cấp.
#[no_mangle]
pub unsafe extern "C" fn dwg_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
    }
}

/// # Safety
/// `ptr..ptr+len` phải là vùng nhớ hợp lệ (đã ghi byte DWG vào).
#[no_mangle]
pub unsafe extern "C" fn dwg_convert(ptr: *const u8, len: usize, failsafe: i32) -> i32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let result = convert_bytes(bytes, failsafe != 0);
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        match result {
            Ok(c) => {
                s.out = c.dxf;
                s.notes = c.notes.join("\n").into_bytes();
                s.entity_count = c.entity_count;
                0
            }
            Err(msg) => {
                s.out = msg.into_bytes();
                s.notes.clear();
                s.entity_count = 0;
                1
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn dwg_out_ptr() -> *const u8 { STATE.with(|s| s.borrow().out.as_ptr()) }
#[no_mangle]
pub extern "C" fn dwg_out_len() -> usize { STATE.with(|s| s.borrow().out.len()) }
#[no_mangle]
pub extern "C" fn dwg_notes_ptr() -> *const u8 { STATE.with(|s| s.borrow().notes.as_ptr()) }
#[no_mangle]
pub extern "C" fn dwg_notes_len() -> usize { STATE.with(|s| s.borrow().notes.len()) }
#[no_mangle]
pub extern "C" fn dwg_entity_count() -> usize { STATE.with(|s| s.borrow().entity_count) }

// ---------------------------------------------------------------------------------------------
// Nguồn "ngẫu nhiên" cho getrandom trên WASM (không có OS). Chỉ dùng để rải khóa băm (HashMap),
// không phục vụ mật mã nên dùng bộ sinh splitmix64 đơn giản là đủ.
// ---------------------------------------------------------------------------------------------
#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
#[no_mangle]
unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), getrandom::Error> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static STATE: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    let buf = std::slice::from_raw_parts_mut(dest, len);
    for chunk in buf.chunks_mut(8) {
        let mut z = STATE.fetch_add(0x9E37_79B9_7F4A_7C15, Ordering::Relaxed).wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        let bytes = z.to_le_bytes();
        chunk.copy_from_slice(&bytes[..chunk.len()]);
    }
    Ok(())
}
