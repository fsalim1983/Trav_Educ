# FET Desktop

تطبيق سطح مكتب لبناء ملفات `.fet` ومعاينة الجداول وتوليدها وطباعتها وتصديرها.

## المتطلبات

- Node.js
- Windows
- محرك `fet-cl.exe` داخل مجلد `bin/` (لا يُرفع إلى GitHub)

## التشغيل

```bat
npm install
start.bat
```

أو من PowerShell:

```powershell
npm install
.\start.ps1
```

للمعاينة في المتصفح دون Electron:

```bat
start-local.bat
```

## هيكل المشروع

```text
FET_Desktop/
├── main.js          عملية Electron الرئيسية
├── preload.js       جسر آمن بين الواجهة والنظام
├── index.html       واجهة المدير (بناء ملف .fet)
├── assets/          أنماط وسكربتات المدير
├── viewer/          واجهة المعاينة والتوليد والطباعة
└── bin/             ضع هنا fet-cl.exe محليًا
```
