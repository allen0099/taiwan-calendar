# Taiwan Government Holiday Calendar API

![Update Calendar](https://github.com/YOUR_USERNAME/taiwan-calendar/workflows/Update%20Taiwan%20Calendar/badge.svg)

自動更新的台灣政府行事曆 API,資料來源為[政府資料開放平台 - 中華民國政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718)。

## 📋 功能特色

- ✅ 自動從政府資料開放平台抓取所有可用年度的行事曆資料
- ✅ 智慧過濾：自動排除 Google 專用版本，優先使用修正版
- ✅ 自動轉換為 JSON 格式，按年月分檔儲存
- ✅ 透過 GitHub Pages 提供公開 API
- ✅ TypeScript 開發，類型安全
- ✅ 使用 pnpm 管理套件
- ✅ 每月自動更新，確保資料最新

## 🚀 API 使用方式

### 基礎 URL

```
https://YOUR_USERNAME.github.io/taiwan-calendar/
```

### 端點 (Endpoints)

#### 1. 取得索引列表

```
GET https://YOUR_USERNAME.github.io/taiwan-calendar/index.json
```

回應範例:
```json
{
  "availableCalendars": [
    {
      "year": 2024,
      "month": 10,
      "file": "2024-10.json",
      "url": "./2024-10.json"
    }
  ],
  "generatedAt": "2024-10-07T12:00:00.000Z"
}
```

#### 2. 取得特定月份行事曆

```
GET https://YOUR_USERNAME.github.io/taiwan-calendar/YYYY-MM.json
```

範例:
```
GET https://YOUR_USERNAME.github.io/taiwan-calendar/2024-10.json
```

回應範例:
```json
{
  "year": 2024,
  "month": 10,
  "holidays": [
    {
      "date": "20241010",
      "name": "國慶日",
      "isHoliday": true,
      "holidayCategory": "國定假日",
      "description": ""
    }
  ],
  "generatedAt": "2024-10-07T12:00:00.000Z"
}
```

## 🛠️ 本地開發

### 環境需求

- Node.js 20+
- pnpm 10.14.0+

### 安裝

```bash
# 安裝依賴
pnpm install

# 開發模式執行
pnpm run dev

# 編譯 TypeScript
pnpm run build

# 執行編譯後的程式
pnpm run start

# 手動抓取資料
pnpm run fetch
```

### 專案結構

```
taiwan-calendar/
├── .github/
│   └── workflows/
│       └── update-calendar.yml   # GitHub Actions 工作流程
├── src/
│   ├── index.ts                  # 主程式（網頁爬蟲 + CSV 解析）
│   └── types.ts                  # TypeScript 類型定義
├── docs/                         # GitHub Pages 輸出目錄（將推送到 gh-pages 分支）
│   ├── index.html               # API 說明頁面
│   ├── index.json               # API 索引
│   └── YYYY-MM.json             # 各月份資料
├── package.json
├── tsconfig.json
└── README.md
```

## 🤖 自動化

此專案使用 GitHub Actions 自動化流程:

1. **定時執行**: 每月 1 號自動執行
2. **手動觸發**: 可透過 GitHub Actions 介面手動執行
3. **推送觸發**: 推送到 main 分支時執行

工作流程:
1. 抓取政府資料開放平台的所有行事曆資料
2. 解析並轉換為 JSON 格式
3. 儲存到 `docs/` 目錄
4. 自動推送到 `gh-pages` 分支（不會污染 main 分支）
5. 部署到 GitHub Pages

## 📝 資料格式

### Holiday 物件

```typescript
interface Holiday {
  date: string;              // 日期 (YYYYMMDD 格式)
  name: string;              // 假日名稱（與 description 相同）
  isHoliday: boolean;        // 是否放假（包含週末和特殊假日）
  isWeekend: boolean;        // 是否為週末（六、日）
  isSpecialHoliday: boolean; // 是否為特殊假日（國定假日、節日等，不含一般週末）
  description: string;       // 說明（例如："國慶日"、"中秋節"）
}
```

**欄位說明：**
- `isHoliday`: 只要是放假日就為 `true`（包含週末和國定假日）
- `isWeekend`: 週六、週日為 `true`
- `isSpecialHoliday`: 國定假日、節日等特殊假日為 `true`，一般週末為 `false`

**使用範例：**
```javascript
// 只取得國定假日（不含一般週末）
const specialHolidays = data.holidays.filter(day => day.isSpecialHoliday);

// 只取得週末
const weekends = data.holidays.filter(day => day.isWeekend);

// 取得所有放假日
const allHolidays = data.holidays.filter(day => day.isHoliday);
```

### CalendarData 物件

```typescript
interface CalendarData {
  year: number;              // 年份
  month: number;             // 月份
  holidays: Holiday[];       // 假日列表（包含該月所有日期）
  generatedAt: string;       // 產生時間 (ISO 8601)
}
```

## 🔄 資料更新機制

本專案採用智慧爬蟲技術，從[政府資料開放平台](https://data.gov.tw/dataset/14718)自動抓取：

1. 🔍 掃描所有可用的行事曆檔案（包含各年度及修正版）
2. 🎯 自動過濾 Google 專用版本
3. ✨ 優先使用修正版資料
4. 📦 下載並解析所有年度的 CSV 檔案
5. 📊 按年月分檔儲存為 JSON 格式
6. 🔄 每月 1 號自動執行更新

## 🛠️ 技術架構

- **網頁爬蟲**: cheerio - 解析政府資料開放平台的 HTML
- **HTTP 客戶端**: axios - 下載網頁和 CSV 檔案  
- **CSV 解析**: csv-parse - 解析行事曆 CSV 資料
- **語言**: TypeScript - 提供類型安全
- **套件管理**: pnpm - 高效的套件管理器
- **CI/CD**: GitHub Actions - 自動化部署
- **託管**: GitHub Pages - 提供靜態 API 服務

## 📄 授權

MIT License

## 🙏 致謝

資料來源: 
- [政府資料開放平台 - 中華民國政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718)
- [行政院人事行政總處](https://www.dgpa.gov.tw/)

## 📮 聯絡方式

如有問題或建議，歡迎開 Issue 或 Pull Request。

---

**注意事項**:
- 本 API 資料僅供參考，正式資料請以[行政院人事行政總處](https://www.dgpa.gov.tw/)公告為準
- API 更新時間可能因 GitHub Actions 執行時間而有所延遲
