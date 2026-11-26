use acadrust::{tables::Layer, types::Color, CadDocument, DxfWriter};

#[test]
fn rgb_layer_colors_survive_dxf_export() {
    let mut doc = CadDocument::new();
    let mut a = Layer::new("NET RGB");
    a.color = Color::Rgb { r: 255, g: 128, b: 0 };
    let mut b = Layer::new("NET ACI");
    b.color = Color::Index(5);
    let mut c = Layer::new("NET RGB 2");
    c.color = Color::Rgb { r: 0, g: 0, b: 1 };
    doc.layers.add(a).unwrap();
    doc.layers.add(b).unwrap();
    doc.layers.add(c).unwrap();
    let raw = DxfWriter::new(&doc).write_to_vec().unwrap();
    let raw_text = String::from_utf8(raw.clone()).unwrap();
    assert!(!raw_text.contains("\n420\r\n16744448") && !raw_text.contains("\n420\n16744448"), "bản gốc không được có 420 cho layer");
    let patched = dwg_bridge::patch_layer_true_colors(&doc, raw);
    let text = String::from_utf8(patched).unwrap();
    let norm = text.replace("\r\n", "\n");
    // đúng bản ghi: mã 420 nằm giữa tên layer "NET RGB" và bản ghi kế tiếp
    let i = norm.find("\n  2\nNET RGB\n").expect("không thấy layer NET RGB");
    let rec = &norm[i..i + 400];
    assert!(rec.contains("\n420\n16744448\n"), "thiếu 420 cho NET RGB: {rec}");
    let j = norm.find("\n  2\nNET ACI\n").expect("không thấy layer NET ACI");
    let rec2 = &norm[j..j + 200];
    let next = rec2.find("\n  0\n").unwrap_or(rec2.len());
    assert!(!rec2[..next].contains("420"), "layer ACI không được có 420");
    let k = norm.find("\n  2\nNET RGB 2\n").expect("không thấy layer NET RGB 2");
    assert!(norm[k..k + 400].contains("\n420\n1\n"), "thiếu 420 cho NET RGB 2");
    println!("OK: 2 layer RGB được bổ sung mã 420, layer ACI giữ nguyên");
}
