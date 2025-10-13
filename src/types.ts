export interface Holiday {
  date: string;
  name: string;
  isHoliday: boolean; // 是否放假（包含週末和特殊假日）
  isWeekend: boolean; // 是否為週末（六日）
  isSpecialHoliday: boolean; // 是否為特殊假日（國定假日、節日等，不含一般週末）
  description: string;
}

export interface CalendarData {
  year: number;
  month: number;
  holidays: Holiday[];
  generatedAt: string;
  license?: {
    name: string;
    url: string;
    attribution: string;
  };
}

export interface YearlyCalendarData {
  year: number;
  months: {
    month: number;
    holidays: Holiday[];
  }[];
  generatedAt: string;
  license?: {
    name: string;
    url: string;
    attribution: string;
  };
}
