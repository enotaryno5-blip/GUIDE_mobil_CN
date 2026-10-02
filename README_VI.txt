QR -> WINDOWS ANDROID v1.0 - SOURCE
===================================

MUC TIEU
- Hai nut: KET NOI MAY TINH va QUET QR.
- Ket noi: quet QR do iPhone QR Receiver v1.0 tren Windows hien thi.
- Quet: quet QR / barcode va gui JSON {"text":"..."} bang HTTP POST toi Receiver.
- Khong co tai khoan, khong can server trung gian; du lieu gui trong LAN/Wi-Fi.

YEU CAU SU DUNG
- Android 7.0 tro len (minSdk 24).
- Dien thoai va Windows cung mang LAN/Wi-Fi.
- Windows dang chay iPhone QR Receiver v1.0.

LUU Y BAO MAT
- App luu URL ket noi (co token Receiver) trong bo nho rieng cua ung dung.
- Receiver chi cho phep ket noi LAN va yeu cau token.
- App cho phep HTTP cleartext de lam viec voi dia chi noi bo 192.168.x.x/10.x.x.x/172.16-31.x.x.

BUILD
1) Cach de nhat: dung GitHub Actions file .github/workflows/build-apk.yml.
2) Hoac mo project bang Android Studio co SDK 35 + JDK 17 va Build APK.

FILE APK sau khi build bang Gradle:
app/build/outputs/apk/debug/app-debug.apk

GHI CHU
- Ban debug APK van cai truc tiep duoc tren Android (sideload).
- Neu phat hanh rong, nen tao release keystore rieng va ky ban release.
