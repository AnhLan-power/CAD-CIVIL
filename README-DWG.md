# Mở file DWG trong app (không cần server)

App đọc DWG **ngay trong trình duyệt**: Rust (thư viện `acadrust`) biên dịch ra WebAssembly,
đổi DWG → DXF rồi đưa vào đúng luồng nhập DXF sẵn có. Hỗ trợ DWG R2000 → R2018 (AC1015 … AC1032).

## Cấu trúc thư mục khi tải lên GitHub (giữ nguyên)

```
index.html
style.css
js/            01-… đến 14-… (như cũ) + 15-dwg-wasm.js + 16-import-model.js + 17-xref-manager.js + 18-text-edit.js   ← MỚI
wasm/
  dwg_bridge.wasm                                         ← MỚI (đã build sẵn, ~1,2 MB)
dwg-bridge/    mã nguồn Rust (chỉ cần khi muốn build lại)
```

Chỉ cần `index.html`, `js/`, `wasm/` là chạy. Thư mục `dwg-bridge/` là mã nguồn để cậu build lại khi cần.

## Chạy thử trên máy

Không mở trực tiếp `index.html` bằng đường dẫn `file://` (trình duyệt chặn nạp WebAssembly). Chạy:

```
python -m http.server 8000      # trong thư mục chứa index.html
# rồi mở http://localhost:8000
```

Trên GitHub Pages thì chạy bình thường (Pages phục vụ `.wasm` đúng kiểu `application/wasm`).

## Build lại file .wasm (tuỳ chọn)

Cần Rust ≥ 1.85 (cài từ rustup.rs):

```
rustup target add wasm32-unknown-unknown
cd dwg-bridge
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/dwg_bridge.wasm ../wasm/
```

Chạy test (đọc/ghi vòng kín qua các đời DWG): `cargo test --release`

Lưu ý: file `.wasm` đi kèm được build trong môi trường thử nghiệm bằng Rust 1.91 (Ubuntu) với `-Zbuild-std`;
đường build bằng rustup ở trên là cách chuẩn nhưng chưa được kiểm thử ở đó.

## Khi mở file DWG

- Dòng Command hiển thị số đối tượng đọc được và số cảnh báo; chi tiết cảnh báo xem ở Console (F12).
- Chế độ "failsafe" luôn bật: file bị lệch/hỏng một phần vẫn cố cứu phần đọc được.
- Nếu file làm bộ đọc dừng đột ngột, app báo lỗi (không treo) — khi đó xuất file sang DXF từ AutoCAD/Civil 3D.

## Nhập bản vẽ (DXF/DWG) — `js/16-import-model.js`

- **Hiển thị:** LINE, LWPOLYLINE/POLYLINE (có cung bulge, đa tuyến đóng), ARC, CIRCLE, ELLIPSE, SPLINE, 3DFACE, SOLID,
  HATCH (vẽ đường biên, chưa tô màu), khối INSERT (lồng nhau, tỉ lệ/xoay/mảng), DIMENSION, TEXT/MTEXT/ATTRIB.
  POINT có cao độ và chữ số được dùng làm điểm cao độ cho Surface.
- **Chữ:** hiển thị theo chiều cao chữ thật (to/nhỏ theo zoom như AutoCAD, tự ẩn khi quá nhỏ), xoay theo góc của chữ;
  bỏ mã định dạng MTEXT; chữ dùng font **VNI** (VD "MAËT BAÈNG") được đổi về Unicode. Font TCVN3 (.Vn...) chưa hỗ trợ.
- **Chọn đối tượng:** click / Window / Crossing chọn được cả đối tượng nhập. Đối tượng được chọn sẽ chuyển thành đối tượng
  tự vẽ thông thường (dùng được Erase/Move/Copy/Rotate/Scale/Offset...).
- **Báo cáo:** dòng Command và bảng Properties liệt kê loại đối tượng chưa hỗ trợ, khối không có dữ liệu (xref chưa nhúng),
  đối tượng bị bỏ qua vì nằm quá xa cụm bản vẽ chính.
- **Chưa hỗ trợ:** tô màu HATCH, MLEADER/LEADER, ảnh nền (IMAGE), solid 3D; xref phải được nạp qua bảng XR (lệnh XR).

## Quản lý xref — lệnh XR (`js/17-xref-manager.js`)

- Gõ **X** rồi **R** (hoặc `XREF`) rồi Enter, hoặc tab **Insert → External References**, để mở bảng quản lý xref giống AutoCAD.
- Nhận diện xref trong DWG/DXF (khối có cờ xref hoặc khối rỗng bị chèn), hiển thị: tên, trạng thái (Loaded / Not found), loại,
  số lần chèn, đường dẫn lưu, file đã nạp; xref lồng trong xref hiển thị thụt vào.
- Trình duyệt không đọc được đường dẫn trên máy (VD `D:\...`), nên: **Nạp từ thư mục…** (chọn cả thư mục chứa xref) hoặc
  **Nạp file xref…** — app tự ghép theo tên file, kể cả xref lồng. **Đổi file…** gán file khác cho 1 xref.
- **Attach…** thêm xref mới (chèn tại 0,0, tỉ lệ 1, góc 0); **Reload** đọc lại file; **Detach** gỡ xref khỏi bản vẽ.
- Hình học xref nằm đúng vị trí chèn, lớp đặt tên `TênXref|TênLớp`. Đổi xref không làm mất khung nhìn hay các đối tượng đã sửa.
- Bản vẽ chính không có hình (chỉ chứa xref) vẫn mở được: bảng XR tự hiện để nạp file.
- File xref DWG được đọc bằng cùng bộ đọc WebAssembly; chưa hỗ trợ tự tìm theo đường dẫn tuyệt đối trên máy.

## Chọn và sửa chữ / cao độ (`js/18-text-edit.js`)

- Click / Window / Crossing chọn được cả **chữ nhập từ DXF/DWG** (TEXT, MTEXT).
  - Chữ thường → đối tượng **TEXT** (giữ chiều cao thật, góc quay, nhiều dòng).
  - Chữ **số khảo sát** (cao độ) → điểm khảo sát **POINT**: sửa Z, dùng cho Surface như điểm thường (không bị tính trùng).
- **Double-click** chữ để sửa nội dung ngay tại chỗ; double-click điểm cao độ để sửa Z (Enter lưu, Esc huỷ). Có Undo/Redo.
- Bảng **Properties** của TEXT có thêm Chiều cao chữ và Góc quay (gõ `\n` để xuống dòng).
- Sau khi sửa cao độ, nếu đã tạo Surface thì tạo lại Surface để cập nhật.

## Layer giống AutoCAD (`js/19-layer-model.js`)

- Bảng **Layer Properties Manager** có đủ cột: S., Name, On, Freeze, Lock, Plot, Color, Linetype, Lineweight, Transparency,
  Description; có ô Search, nút New Layer, chân bảng "All: N layers displayed of M total layers".
- Khi nhập DXF/DWG, app đọc **toàn bộ bảng LAYER/LTYPE** (kể cả layer chưa dùng): màu ACI và màu RGB (true color), kiểu nét,
  độ dày nét, trong suốt, cờ đóng băng/khoá/tắt/không in, mô tả; xref có layer dạng `TênXref|TênLớp`.
- **Áp lên bản vẽ:** màu layer, màu riêng từng đối tượng (ByLayer / ByBlock / ACI / RGB), kiểu nét (DASHED, PHANTOM... theo định
  nghĩa trong file × LTSCALE), độ trong suốt, bật/tắt/đóng băng. Chữ lấy màu layer. Có ô **LTSCALE** để chỉnh độ dài nét đứt.
- Chỉnh trực tiếp trong bảng: đổi màu (bảng chọn màu), kiểu nét, độ dày, trong suốt, mô tả, đổi tên, xoá layer.
  Layer đã chỉnh tay không bị ghi đè khi nạp thêm xref.
- Độ dày nét (Lineweight) được lưu và hiển thị trong bảng nhưng không vẽ nét dày trong khung nhìn (giống AutoCAD khi tắt LWDISPLAY).
- **Giới hạn của file DWG:** bộ đọc DWG không cung cấp độ trong suốt và mô tả layer (file DXF thì đọc đủ). Màu RGB của layer được
  giữ nhờ bước hậu xử lý trong `dwg-bridge/src/lib.rs` (cần dùng bản `wasm/dwg_bridge.wasm` mới).

## Bảng nổi (`js/20-floating-panels.js`)

- Toolspace, Layer Properties Manager, Surfaces, Points, Assembly, Properties: **kéo bằng thanh tiêu đề**, **đổi kích thước bằng
  góc dưới bên phải** (như bảng XR). Vị trí và kích thước được nhớ cho lần mở sau (xoá dữ liệu trình duyệt để về mặc định).

## Giấy phép

Thư viện `acadrust` (https://github.com/hakanaktt/acadrust) dùng giấy phép **MPL-2.0**. File `.wasm` có chứa thư viện này;
mã nguồn thư viện công khai ở địa chỉ trên. Mã `dwg-bridge/` là của dự án này.
