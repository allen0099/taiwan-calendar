import axios from 'axios';
import * as cheerio from 'cheerio';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs/promises';
import * as path from 'path';
import iconv from 'iconv-lite';
import type { Holiday, CalendarData, YearlyCalendarData } from './types.js';

/**
 * Debug 模式控制 (透過環境變數 DEBUG=true 啟用)
 */
const DEBUG_MODE = process.env.DEBUG === 'true';

/**
 * Debug log 函式 - 只在 DEBUG 模式下輸出
 */
function debug(...args: any[]): void {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

/**
 * 政府資料開放平台的行事曆資料集 URL
 */
const DATA_GOV_DATASET_URL = 'https://data.gov.tw/dataset/14718';

/**
 * 資料來源資訊
 */
interface CalendarSource {
  year: number;
  title: string;
  url: string;
  isGoogle: boolean;
  isRevised: boolean;
}

/**
 * 從檔案名稱中提取年份
 */
function extractYearFromTitle(title: string): number | null {
  // 比對格式: "114年中華民國政府行政機關辦公日曆表"
  const match = title.match(/(\d{3})年/);
  if (match) {
    const taiwanYear = parseInt(match[1], 10);
    return taiwanYear + 1911; // 轉換為西元年
  }
  return null;
}

/**
 * 判斷是否為 Google 版本
 */
function isGoogleVersion(title: string): boolean {
  return title.includes('Google') || title.includes('google');
}

/**
 * 判斷是否為修正版、修訂版或更新版（即任何已修改的版本）
 */
function isRevisedVersion(title: string): boolean {
  return title.includes('修正') || title.includes('修訂') || title.includes('更新');
}

/**
 * 從 data.gov.tw 抓取所有可用的行事曆 CSV 連結
 */
async function fetchCalendarSources(): Promise<CalendarSource[]> {
  console.log(`Fetching calendar sources from: ${DATA_GOV_DATASET_URL}`);
  
  try {
    const response = await axios.get(DATA_GOV_DATASET_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const sources: CalendarSource[] = [];

    // 根據您提供的 CSS 選擇器，找到資料表格區域
    // 每個 ul 元素代表一個資料資源
    $('.od-table ul').each((_, ulElement) => {
      const $ul = $(ulElement);
      
      // 在 ul 中查找標題和下載連結
      $ul.find('li').each((_, liElement) => {
        const $li = $(liElement);
        const $span = $li.find('span');
        const $link = $li.find('a[href*="FileConversion"], a[href*=".csv"]');
        
        const title = $span.text().trim();
        const href = $link.attr('href');
        
        if (title && href) {
          const year = extractYearFromTitle(title);
          
          if (year) {
            const url = href.startsWith('http') ? href : `https://www.dgpa.gov.tw${href}`;
            sources.push({
              year,
              title,
              url,
              isGoogle: isGoogleVersion(title),
              isRevised: isRevisedVersion(title),
            });
            console.log(`  Found: ${title}`);
          }
        }
      });
    });

    // 如果上面的選擇器沒找到，嘗試其他方式
    if (sources.length === 0) {
      console.log('Trying alternative selector...');
      
      $('a[href*="FileConversion"]').each((_, element) => {
        const $link = $(element);
        const href = $link.attr('href');
        
        // 找相鄰的文字作為標題
        const title = $link.text().trim() || $link.closest('li').find('span').text().trim();
        
        if (title && href) {
          const year = extractYearFromTitle(title);
          
          if (year) {
            const url = href.startsWith('http') ? href : `https://www.dgpa.gov.tw${href}`;
            
            // 避免重複
            if (!sources.some(s => s.url === url)) {
              sources.push({
                year,
                title,
                url,
                isGoogle: isGoogleVersion(title),
                isRevised: isRevisedVersion(title),
              });
              console.log(`  Found: ${title}`);
            }
          }
        }
      });
    }

    console.log(`Found ${sources.length} calendar sources`);
    return sources;
  } catch (error) {
    console.error('Failed to fetch calendar sources:', error);
    throw error;
  }
}

/**
 * 下載並解析 CSV 檔案
 */
async function fetchCalendarCSV(source: CalendarSource): Promise<string> {
  console.log(`Fetching: ${source.title}`);
  
  try {
    const response = await axios.get(source.url, {
      responseType: 'arraybuffer', // 改用 arraybuffer 以便處理編碼
      headers: {
        'User-Agent': 'Taiwan-Calendar-Bot/1.0',
        'Referer': DATA_GOV_DATASET_URL
      }
    });
    
    // 嘗試檢測和處理不同的編碼
    const buffer = Buffer.from(response.data);
    
    // 檢查是否有 BOM
    let content: string;
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      // UTF-8 with BOM
      content = buffer.toString('utf-8');
      debug('Detected UTF-8 with BOM');
    } else {
      // 先嘗試 UTF-8
      content = buffer.toString('utf-8');
      
      // 檢查是否有亂碼 (如果前 100 個字符中有大量的 � 或非常見字符)
      const sample = content.substring(0, 200);
      const hasGarbage = sample.includes('�') || !/[\u4e00-\u9fa5]/.test(sample);
      
      if (hasGarbage) {
        debug('UTF-8 decoding failed, trying Big5...');
        // 嘗試 Big5 編碼
        content = iconv.decode(buffer, 'big5');
        debug('Successfully decoded as Big5');
        debug('Sample:', content.substring(0, 100));
      } else {
        debug('Detected UTF-8 without BOM');
      }
    }
    
    return content;
  } catch (error) {
    console.error(`Failed to fetch ${source.title}:`, error);
    throw error;
  }
}

/**
 * 判斷日期是否為週末（六日）
 */
function isWeekendDay(dateStr: string, weekdayStr?: string): boolean {
  // 優先使用 CSV 中的星期欄位
  if (weekdayStr) {
    const weekday = weekdayStr.trim();
    return weekday === '六' || weekday === '日';
  }
  
  // 如果沒有星期欄位，從日期計算
  if (dateStr.length === 8) {
    const year = parseInt(dateStr.substring(0, 4), 10);
    const month = parseInt(dateStr.substring(4, 6), 10) - 1;
    const day = parseInt(dateStr.substring(6, 8), 10);
    const date = new Date(year, month, day);
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6; // 0=Sunday, 6=Saturday
  }
  
  return false;
}

/**
 * 解析 CSV 內容轉換為 JSON
 * CSV 格式: 西元日期,星期,是否放假,備註
 */
function parseCSVToJSON(csvContent: string, source: CalendarSource): CalendarData[] {
  debug(`Parsing CSV for year ${source.year}`);
  debug(`CSV content length: ${csvContent.length}`);
  debug(`CSV first 500 chars: ${csvContent.substring(0, 500)}`);
  
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true, // 處理 BOM (Byte Order Mark)
  });
  
  debug(`Parsed ${records.length} records`);
  if (records.length > 0) {
    debug('First record:', records[0]);
    debug('Column names:', Object.keys(records[0] as object));
  }

  // 按月份分組
  const monthlyData: Map<number, Holiday[]> = new Map();
  let processedCount = 0;
  let skippedCount = 0;

  records.forEach((record: any, index: number) => {
    const dateStr = record['西元日期'] || record['日期'] || record['date'] || record['Date'];
    
    if (index < 3) {
      debug(`Processing record ${index}:`, record);
      debug(`Extracted dateStr: ${dateStr}`);
    }
    if (!dateStr) {
      skippedCount++;
      if (index < 5) {
        debug(`Skipped record ${index} - no dateStr`);
      }
      return;
    }

    // 解析日期格式 YYYYMMDD
    let month: number;
    if (dateStr.length === 8) {
      month = parseInt(dateStr.substring(4, 6), 10);
    } else if (dateStr.includes('/')) {
      // 處理 YYYY/MM/DD 格式
      const parts = dateStr.split('/');
      month = parseInt(parts[1], 10);
    } else {
      skippedCount++;
      if (index < 5) {
        debug(`Skipped record ${index} - invalid date format: ${dateStr}`);
      }
      return;
    }
    
    if (index < 3) {
      debug(`Parsed month: ${month} from dateStr: ${dateStr}`);
    }

    // 取得各欄位資料
    const weekdayStr = record['星期'] || record['weekday'] || record['Weekday'] || '';
    const isHolidayStr = record['是否放假'] || record['isHoliday'] || record['IsHoliday'] || '0';
    const description = record['備註'] || record['description'] || record['Description'] || '';

    // 判斷是否放假
    const isHoliday = isHolidayStr === '2';
    
    // 判斷是否為週末
    const isWeekend = isWeekendDay(dateStr, weekdayStr);
    
    // 判斷是否為特殊假日（放假但不是週末，或是週末但有特殊說明）
    const isSpecialHoliday = isHoliday && (description.trim() !== '' || !isWeekend);

    const holiday: Holiday = {
      date: dateStr.replace(/\//g, ''),
      name: description,
      isHoliday: isHoliday,
      isWeekend: isWeekend,
      isSpecialHoliday: isSpecialHoliday,
      description: description,
    };

    if (!monthlyData.has(month)) {
      monthlyData.set(month, []);
    }
    monthlyData.get(month)!.push(holiday);
    processedCount++;
    
    if (index < 3) {
      debug(`Added holiday for month ${month}:`, holiday);
    }
  });
  
  debug(`Processing complete: ${processedCount} processed, ${skippedCount} skipped`);
  debug('Months with data:', Array.from(monthlyData.keys()).sort((a, b) => a - b));
  monthlyData.forEach((holidays, month) => {
    debug(`  Month ${month}: ${holidays.length} holidays`);
  });

  // 轉換為 CalendarData 陣列
  const result: CalendarData[] = [];
  for (let month = 1; month <= 12; month++) {
    const holidays = monthlyData.get(month) || [];
    result.push({
      year: source.year,
      month,
      holidays,
      generatedAt: new Date().toISOString(),
      license: {
        name: '政府資料開放授權條款',
        url: 'https://data.gov.tw/license',
        attribution: '資料來源：行政院人事行政總處',
      },
    });
  }

  return result;
}

/**
 * 儲存 JSON 檔案
 */
async function saveJSON(data: CalendarData, outputDir: string): Promise<void> {
  const { year, month } = data;
  const yearDir = path.join(outputDir, year.toString());
  const fileName = `${month.toString().padStart(2, '0')}.json`;
  const filePath = path.join(yearDir, fileName);

  // 確保年份目錄存在
  await fs.mkdir(yearDir, { recursive: true });

  // 寫入檔案
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Saved: ${year}/${fileName}`);
}

/**
 * 批次儲存多個月份的資料
 */
async function saveAllMonths(monthlyData: CalendarData[], outputDir: string): Promise<void> {
  debug(`saveAllMonths called with ${monthlyData.length} months`);
  let savedCount = 0;
  let emptyCount = 0;
  
  for (const data of monthlyData) {
    if (data.holidays.length > 0) {
      await saveJSON(data, outputDir);
      savedCount++;
    } else {
      emptyCount++;
      debug(`Skipped saving empty month: ${data.year}/${data.month}`);
    }
  }
  
  debug(`Saved ${savedCount} months, skipped ${emptyCount} empty months`);
}

/**
 * 儲存整年份的 JSON 檔案
 */
async function saveYearlyData(monthlyData: CalendarData[], outputDir: string): Promise<void> {
  if (monthlyData.length === 0) return;
  
  const year = monthlyData[0].year;
  const yearDir = path.join(outputDir, year.toString());
  const fileName = `all.json`;
  const filePath = path.join(yearDir, fileName);
  
  // 確保年份目錄存在
  await fs.mkdir(yearDir, { recursive: true });
  
  // 建立整年份的資料結構
  const yearlyData: YearlyCalendarData = {
    year,
    months: monthlyData.map(data => ({
      month: data.month,
      holidays: data.holidays,
    })),
    generatedAt: new Date().toISOString(),
    license: {
      name: '政府資料開放授權條款',
      url: 'https://data.gov.tw/license',
      attribution: '資料來源：行政院人事行政總處',
    },
  };
  
  // 寫入檔案
  await fs.writeFile(filePath, JSON.stringify(yearlyData, null, 2), 'utf-8');
  console.log(`Saved: ${year}/${fileName}`);
}

/**
 * 產生 index.json 列出所有可用的月份
 */
async function generateIndex(outputDir: string): Promise<void> {
  const yearDirs = await fs.readdir(outputDir);
  const availableCalendars: any[] = [];
  
  // 遍歷每個年份目錄
  for (const yearDir of yearDirs) {
    const yearPath = path.join(outputDir, yearDir);
    const stats = await fs.stat(yearPath);
    
    // 只處理目錄且為數字年份
    if (!stats.isDirectory() || !/^\d{4}$/.test(yearDir)) {
      continue;
    }
    
    const year = parseInt(yearDir, 10);
    const files = await fs.readdir(yearPath);
    
    // 找到該年份的所有月份檔案
    const monthFiles = files
      .filter(file => file.match(/^\d{2}\.json$/))
      .sort();
    
    // 加入月份資料
    for (const file of monthFiles) {
      const month = parseInt(file.replace('.json', ''), 10);
      availableCalendars.push({
        year,
        month,
        file: `${year}/${file}`,
        url: `./${year}/${file}`,
      });
    }
    
    // 加入整年份資料
    const yearFile = `${year}.json`;
    const yearFilePath = path.join(yearPath, yearFile);
    try {
      await fs.access(yearFilePath);
      availableCalendars.push({
        year,
        month: null,
        file: `${year}/${yearFile}`,
        url: `./${year}/${yearFile}`,
        isYearly: true,
      });
    } catch {
      // 年份檔案不存在，跳過
    }
  }
  
  // 按年份和月份排序（最新的在前面）
  availableCalendars.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    if (a.isYearly && !b.isYearly) return -1;
    if (!a.isYearly && b.isYearly) return 1;
    return (b.month || 0) - (a.month || 0);
  });

  const index = {
    availableCalendars,
    generatedAt: new Date().toISOString(),
    license: {
      name: '政府資料開放授權條款',
      url: 'https://data.gov.tw/license',
      attribution: '資料來源：行政院人事行政總處',
      note: '此開放資料依政府資料開放授權條款 (Open Government Data License) 進行公眾釋出，使用者於遵守本條款各項規定之前提下，得利用之。',
    },
  };

  const indexPath = path.join(outputDir, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`Generated index file: ${indexPath}`);
}

/**
 * 主程式
 */
async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Taiwan Government Holiday Calendar Scraper');
    console.log('='.repeat(60));

    // 1. 從 data.gov.tw 抓取所有可用的行事曆來源
    const sources = await fetchCalendarSources();
    
    if (sources.length === 0) {
      console.error('No calendar sources found!');
      process.exit(1);
    }

    // 2. 過濾出最新的年度資料（優先使用修正版，避免 Google 版）
    const latestSources = sources
      .filter(s => !s.isGoogle) // 排除 Google 專用版
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year; // 年份由大到小
        if (a.isRevised !== b.isRevised) return a.isRevised ? -1 : 1; // 修正版優先
        return 0;
      });

    console.log(`\nProcessing ${latestSources.length} calendar sources...\n`);

    // 3. 設定輸出目錄
    const outputDir = path.join(process.cwd(), 'public');
    await fs.mkdir(outputDir, { recursive: true });

    // 4. 下載並處理每個來源
    const processedYears = new Set<number>();
    
    for (const source of latestSources) {
      // 只處理每個年份一次（使用最新/修正版）
      if (processedYears.has(source.year)) {
        continue;
      }

      try {
        console.log(`\n📥 Processing: ${source.title}`);
        
        // 下載 CSV
        const csvContent = await fetchCalendarCSV(source);
        
        // 解析 CSV 並分月儲存
        const monthlyData = parseCSVToJSON(csvContent, source);
        
        // 儲存所有月份
        await saveAllMonths(monthlyData, outputDir);
        
        // 儲存整年份資料
        await saveYearlyData(monthlyData, outputDir);
        
        processedYears.add(source.year);
        console.log(`✅ Completed: ${source.year}`);
        
      } catch (error) {
        console.error(`❌ Error processing ${source.title}:`, error);
        // 繼續處理其他來源
      }
    }

    // 5. 產生索引檔案
    console.log('\n📝 Generating index...');
    await generateIndex(outputDir);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Calendar data updated successfully!');
    console.log(`📁 Output directory: ${outputDir}`);
    console.log(`📊 Processed years: ${Array.from(processedYears).sort((a, b) => b - a).join(', ')}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ Error updating calendar:', error);
    process.exit(1);
  }
}

// 執行主程式
main();
