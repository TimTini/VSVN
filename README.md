# VSVN - SVN Structure Viewer

Chrome Extension để fetch và hiển thị cây thư mục/file từ SVN repository.
Hỗ trợ cả:
- SVN index XML (WebSVN/VisualSVN)
- HTML directory listing dạng `<a href="...">`
Mục tiêu là chạy không cần backend, thao tác trực tiếp trong extension page.

## Tính năng

- Chạy dạng Chrome Extension để giảm lỗi CORS khi gọi trực tiếp SVN URL.
- Zero dependency: không dùng thư viện/CDN bên ngoài.
- Giao diện tối, gọn, phù hợp dùng nội bộ.
- Fetch trực tiếp từ `SVN URL` và render cây thư mục.
- Download mirror toàn bộ file theo `Depth` vào thư mục local bằng `File System Access API`.
- Xuất file `_vsvn_links.tsv` chứa map `type/path/url` của toàn bộ link đã crawl.
- Trong `treeWrap` có thêm công cụ:
  - Icon nhỏ ngay trên từng item để copy `path` / `url` / download item
  - Search/filter cây thư mục + highlight text match ngay trong `treeWrap`
- Giới hạn độ sâu quét thư mục bằng `Depth`:
  - Mặc định `10`
  - `-1` = không giới hạn
- Cache phiên (biến trong RAM) cho dữ liệu đã fetch:
  - Cùng `SVN URL` + cùng auth, đổi `Depth` sẽ tái dùng cache và chỉ fetch thêm phần thiếu
  - Cache mất khi refresh trang (`F5`)
- Lưu cache `SVN URL` gần nhất bằng `localStorage`.
- Không cần backend cho phần viewer.

## Cai dat extension (Chrome/Edge Chromium)

1. Mở trang `chrome://extensions/` (hoặc `edge://extensions/`).
2. Bật `Developer mode`.
3. Chọn `Load unpacked`.
4. Trỏ đến thư mục: `extension/`.
5. Bấm icon extension `VSVN` để mở tab `app.html` của extension.
6. Nhập:
   - `SVN URL`
   - `Username` (nếu repo cần auth)
   - `Password` (nếu repo cần auth)
   - `Depth` (độ sâu quét thư mục con)
7. Nhấn `Fetch cấu trúc`.
8. Nếu muốn tải toàn bộ, bấm `Download to folder` rồi chọn thư mục đích khi trình duyệt hỏi quyền.

## Public Web Page

Repo đã có workflow deploy GitHub Pages tại:
- `.github/workflows/deploy-pages.yml`

URL public (sau khi workflow chạy thành công):
- `https://timtini.github.io/VSVN/`

## Lưu ý quan trọng

- Không có request telemetry/tracking.
- Network policy: chỉ fetch tới `SVN URL` bạn nhập và các link con cùng origin; link ngoài origin sẽ bị bỏ qua.
- Extension đã khai báo `host_permissions` để giảm lỗi CORS khi fetch.
- Tính năng download cần trình duyệt hỗ trợ `File System Access API` (`showDirectoryPicker`).
- Trình duyệt sẽ hiện hộp thoại chọn thư mục, đây là bước cấp quyền ghi file.
- Nếu dùng HTTPS self-signed, bạn vẫn cần trust certificate trước.
- UI của extension chạy cục bộ; chỉ thao tác fetch SVN là cần mạng.

## Test server HTML listing

Để test nhanh crawler với định dạng `HTML directory listing`, chạy server local:

```bash
node test-html-listing-server.js --root ./svn-local/seed --port 8787
```

Để test luôn luồng auth (`Username/Password`), chạy:

```bash
node test-html-listing-server.js --root ./svn-local/seed --port 8787 --user demo --pass demo123
```

Thông tin đăng nhập mẫu:
- Username: `demo`
- Password: `demo123`

Mở URL:
- `http://127.0.0.1:8787/`

Server này trả về dạng:

```html
<ul>
  <li><a href="../"></a></li>
  <li><a href="folder/">folder</a></li>
  <li><a href="index.html">index.html</a></li>
</ul>
```

## Cấu trúc chính

- `extension/manifest.json`: cấu hình extension.
- `extension/background.js`: mở extension page khi click icon.
- `extension/app.html`: giao diện chính.
- `extension/app.css`: style trang extension.
- `extension/app.js`: logic fetch/crawl/render/cache/download.
- `extension/popup.*`: bản cũ (không dùng mặc định).
- `index.html`: bản standalone cũ.
- `test-html-listing-server.js`: server local trả về HTML directory listing để test.
- `setup-visualsvn-http.ps1`: script hỗ trợ setup VisualSVN HTTP.
- `enable-visualsvn-cors.ps1`: script hỗ trợ bật CORS.

## Bảo mật

- Mật khẩu **không** lưu trong code hoặc `localStorage`.
- Auth header Basic chỉ tạo tại runtime khi bạn bấm fetch.

## License

Bạn có thể thêm license tùy nhu cầu (ví dụ MIT) trước khi public chính thức.
