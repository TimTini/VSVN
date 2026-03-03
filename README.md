# VSVN - SVN Structure Viewer

Ứng dụng HTML tĩnh để fetch và hiển thị cây thư mục/file từ SVN repository (WebSVN/VisualSVN index XML).

## Tính năng

- Giao diện tối, gọn, phù hợp dùng nội bộ.
- Fetch trực tiếp từ `SVN URL` và render cây thư mục.
- Lưu cache `SVN URL` gần nhất bằng `localStorage`.
- `Username` và `Password` dùng cơ chế Password Manager của trình duyệt (autocomplete + Credential API nếu trình duyệt hỗ trợ).
- Không cần backend cho phần viewer.

## Cách chạy

1. Mở trực tiếp file `index.html` trong trình duyệt.
2. Nhập:
   - `SVN URL`
   - `Username` (nếu repo cần auth)
   - `Password` (nếu repo cần auth)
3. Nhấn `Fetch cấu trúc`.

## Lưu ý quan trọng

- Nếu gặp lỗi `CORS`, cần bật CORS trên VisualSVN/Apache reverse proxy.
- Nếu dùng HTTPS self-signed, cần trust certificate trước.
- Password Manager thường hoạt động ổn định hơn khi chạy qua `http://` hoặc `https://` thay vì `file://`.

## Cấu trúc chính

- `index.html`: UI + logic fetch SVN index + render tree.
- `setup-visualsvn-http.ps1`: script hỗ trợ setup VisualSVN HTTP.
- `enable-visualsvn-cors.ps1`: script hỗ trợ bật CORS.

## Bảo mật

- Mật khẩu **không** lưu trong code hoặc `localStorage`.
- Auth header Basic chỉ tạo tại runtime khi bạn bấm fetch.

## License

Bạn có thể thêm license tùy nhu cầu (ví dụ MIT) trước khi public chính thức.
