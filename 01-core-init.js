        /* ====================================================================================
         * CỔNG DÙNG THỬ 30 NGÀY — dùng Supabase để lưu tập trung (ngày bắt đầu dùng thử + trạng thái
         * kích hoạt lưu theo email trên server, không bị mất/reset khi người dùng xoá dữ liệu trình
         * duyệt như bản localStorage trước đây). Cần điền SUPABASE_URL/SUPABASE_ANON_KEY bên dưới —
         * xem hướng dẫn tạo Supabase project + bảng "trial_users" đi kèm.
         * LƯU Ý: mã kích hoạt vẫn được so khớp ở PHÍA TRÌNH DUYỆT (xem trong mã nguồn trang là thấy),
         * nên chỉ đủ chặn người dùng phổ thông. Muốn chặt hơn, cần chuyển việc so khớp mã sang 1
         * Supabase Edge Function (server thật, người dùng không xem được mã đúng).
         * ==================================================================================== */
        const SUPABASE_URL = 'https://lojanbbemfjnmwomxtzy.supabase.co'; // <-- điền Project URL của cậu
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvamFuYmJlbWZqbm13b214dHp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1OTU5NzcsImV4cCI6MjEwNDE3MTk3N30.DTCuemto85TStn47iMylVitT0tu6S1m_tlzfQK2w2yk'; // <-- điền anon public key của cậu
        const TRIAL_DURATION_DAYS = 30;
        const TRIAL_ACTIVATION_CODE = 'CADCIVIL-ALAN'; // <-- đổi mã kích hoạt ở đây
        const TRIAL_EMAIL_CACHE_KEY = 'cadTrialEmail'; // chỉ cache EMAIL để khỏi hỏi lại, KHÔNG cache hạn dùng/kích hoạt

        const supabaseClient = (window.supabase && SUPABASE_URL.startsWith('http'))
            ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
            : null;

        function daysSince(isoTimestamp) {
            return (Date.now() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60 * 24);
        }
        function showTrialBanner(text) {
            const el = document.getElementById('trial-status-banner');
            el.textContent = text;
            el.style.display = 'block';
        }
        function applyTrialRecord(record) {
            if (record.activated) { showTrialBanner('Đã kích hoạt — cảm ơn bạn!'); return; }
            const elapsed = daysSince(record.first_used_at);
            if (elapsed > TRIAL_DURATION_DAYS) {
                document.getElementById('trial-expired-overlay').style.display = 'flex';
            } else {
                const daysLeft = Math.max(0, Math.ceil(TRIAL_DURATION_DAYS - elapsed));
                showTrialBanner(`Dùng thử — ${record.name} — còn ${daysLeft} ngày`);
            }
        }
        async function submitTrialLogin() {
            const name = document.getElementById('trial-login-name').value.trim();
            const email = document.getElementById('trial-login-email').value.trim().toLowerCase();
            const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            if (!name || !emailOk) {
                document.getElementById('trial-login-error').style.display = 'block';
                return;
            }
            if (!supabaseClient) {
                console.warn('Chưa cấu hình Supabase (SUPABASE_URL/SUPABASE_ANON_KEY) — cho qua tạm, không kiểm tra hạn dùng thử.');
                document.getElementById('trial-login-overlay').style.display = 'none';
                return;
            }
            try {
                let { data: existing } = await supabaseClient.from('trial_users').select('*').eq('email', email).maybeSingle();
                if (!existing) {
                    const { data: inserted, error } = await supabaseClient.from('trial_users').insert({ name, email }).select().single();
                    if (error) throw error;
                    existing = inserted;
                }
                localStorage.setItem(TRIAL_EMAIL_CACHE_KEY, email);
                document.getElementById('trial-login-overlay').style.display = 'none';
                applyTrialRecord(existing);
            } catch (e) {
                console.error('Lỗi kết nối Supabase:', e);
                document.getElementById('trial-login-error').textContent = 'Không kết nối được máy chủ, thử lại sau.';
                document.getElementById('trial-login-error').style.display = 'block';
            }
        }
        async function submitTrialActivation() {
            const code = document.getElementById('trial-activation-code').value.trim();
            if (code !== TRIAL_ACTIVATION_CODE) {
                document.getElementById('trial-activation-error').style.display = 'block';
                return;
            }
            const email = localStorage.getItem(TRIAL_EMAIL_CACHE_KEY);
            if (supabaseClient && email) {
                try { await supabaseClient.from('trial_users').update({ activated: true }).eq('email', email); }
                catch (e) { console.error('Lỗi cập nhật kích hoạt lên Supabase:', e); }
            }
            document.getElementById('trial-expired-overlay').style.display = 'none';
            showTrialBanner('Đã kích hoạt — cảm ơn bạn!');
        }
        (async function initTrialGate() {
            const email = localStorage.getItem(TRIAL_EMAIL_CACHE_KEY);
            if (!email) {
                document.getElementById('trial-login-overlay').style.display = 'flex';
                return;
            }
            if (!supabaseClient) {
                console.warn('Chưa cấu hình Supabase — cho qua tạm, không kiểm tra hạn dùng thử.');
                return;
            }
            try {
                const { data: record, error } = await supabaseClient.from('trial_users').select('*').eq('email', email).maybeSingle();
                if (error) throw error;
                if (!record) { document.getElementById('trial-login-overlay').style.display = 'flex'; return; }
                applyTrialRecord(record);
            } catch (e) {
                console.error('Lỗi kết nối Supabase, cho qua tạm:', e);
            }
        })();
        document.getElementById('trial-login-email').addEventListener('keydown', e => { if (e.key === 'Enter') submitTrialLogin(); });
        document.getElementById('trial-login-name').addEventListener('keydown', e => { if (e.key === 'Enter') submitTrialLogin(); });
        document.getElementById('trial-activation-code').addEventListener('keydown', e => { if (e.key === 'Enter') submitTrialActivation(); });

        const container = document.getElementById('canvas-container');
        const textOverlay = document.getElementById('text-overlay');
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0a);

        const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500000);
        // QUAN TRỌNG: bản vẽ dùng trục Z làm phương thẳng đứng thật (cao độ) — X,Y là mặt bằng.
        // OrbitControls dùng camera.up làm trục xoay chính (azimuth quay quanh trục này), nên PHẢI đặt
        // up = Z, không để mặc định Y của three.js, nếu không xoay ngang (thứ người dùng thao tác
        // nhiều nhất) sẽ bị lệch quanh trục Y (vốn là 1 trục NẰM NGANG trong bản vẽ này) thay vì quanh
        // đúng trục thẳng đứng Z — đây là nguyên nhân "xoay 3D không quay 360 được" mượt như kỳ vọng.
        camera.up.set(0, 0, 1);
        // Nhích nhẹ khỏi đúng đỉnh trục Z (thay vì (0,0,1000) tuyệt đối) để tránh suy biến toán học
        // (gimbal lock) ngay tại điểm khởi tạo khi up cũng là Z và camera nhìn thẳng dọc theo đúng Z.
        camera.position.set(0, -0.01, 1000);

        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        renderer.setSize(window.innerWidth, window.innerHeight);
        container.appendChild(renderer.domElement);

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        // Tắt damping/inertia: Civil 3D phản hồi tức thời, dừng ngay khi dừng rê chuột,
        // không "trôi" thêm sau khi thả tay như hiệu ứng damping mặc định của OrbitControls.
        controls.enableDamping = false;
        controls.screenSpacePanning = true;
        controls.panSpeed = 1.2;
        controls.rotateSpeed = 1.0;
        controls.zoomSpeed = 1.2;

        // Điều khiển chuột kiểu AutoCAD/Civil 3D:
        // - Chuột trái: dành riêng cho Select/Draw (không dùng để xoay/pan view)
        // - Giữ chuột giữa + rê: Pan
        // - Shift (hoặc Ctrl) + giữ chuột giữa + rê: Xoay 3D (Orbit)
        // - Lăn chuột: Zoom (mặc định của OrbitControls)
        //
        // QUAN TRỌNG: OrbitControls (three.js) đã tự có sẵn cơ chế hoán đổi Pan <-> Rotate khi
        // giữ Shift/Ctrl/Meta ngay trong hàm onMouseDown nội bộ của nó:
        //   case THREE.MOUSE.PAN:
        //       if (event.ctrlKey || event.metaKey || event.shiftKey) state = STATE.ROTATE;
        //       else state = STATE.PAN;
        // => Chỉ cần khai báo MIDDLE: THREE.MOUSE.PAN một lần duy nhất là ĐỦ, thư viện sẽ tự
        // xoay khi phát hiện Shift/Ctrl đang giữ. TUYỆT ĐỐI không được tự ý đổi
        // controls.mouseButtons.MIDDLE thành ROTATE bằng tay khi Shift được giữ (cách làm cũ),
        // vì làm vậy sẽ khiến logic nội bộ ở trên nhìn thấy "MIDDLE=ROTATE + đang giữ Shift" và
        // lại hoán đổi NGƯỢC LẠI thành PAN — hai lớp logic đá nhau, đây chính là lý do xoay
        // "lúc được lúc không" trước đây.
        controls.mouseButtons = {
            LEFT: null,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: null
        };
        controls.enableRotate = true;
        controls.enablePan = true;
        controls.enableZoom = true;

        // Không hiện menu chuột phải của trình duyệt (chuột phải hiện không dùng cho thao tác nào)
        renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

        const gridHelper = new THREE.GridHelper(5000, 50, 0x333333, 0x1a1a1a);
        gridHelper.rotation.x = Math.PI / 2;
        scene.add(gridHelper);
        scene.add(new THREE.AmbientLight(0xffffff, 1.0));

        let currentModel = null;
        let textElements = [];
        let importedElevationPoints = []; // điểm cao độ trích từ text số trong DXF import
        let currentSurface = null; // THREE.Group chứa mesh TIN + contour đang hiển thị

        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
            updateTextPositions();
        }
        // LƯU Ý: KHÔNG gọi animate() ở đây — updateTextPositions() (dùng bên trong animate) chỉ được
        // định nghĩa ở file 03-layers-panel.js (tải SAU file này). Việc khởi động vòng lặp render được
        // dời xuống cuối file 14-trim-and-events.js (file tải SAU CÙNG), đảm bảo mọi hàm cần dùng đã
        // sẵn sàng trước khi animate() chạy lần đầu.

        function toggleToolspace() {
            const ts = document.getElementById('toolspace');
            ts.style.display = ts.style.display === 'none' ? 'flex' : 'none';
        }

