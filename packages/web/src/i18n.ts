/**
 * Persian-first localization layer for the ArchGenius web UI.
 *
 * Single locale: fa-IR, direction RTL. Persian is the DEFAULT and only UI
 * language; there is no language switcher by design (product requirement).
 *
 * What is intentionally NOT translated (machine-readable identifiers):
 *   - finding codes (STAIR_MISSING, GEO_OVERLAPPING_ROOMS, …)
 *   - space `type` / `id`, strategy ids, DXF layer names
 *   - numeric values, dimensions, coordinates, JSON payloads
 * Engine-generated messages (validator findings, edit errors, infeasible
 * explanations) are displayed verbatim below their Persian titles — the core
 * package is part of the released v1.0.1 and must not be modified.
 */

export const LOCALE = 'fa';
export const DIR: 'rtl' = 'rtl';

// ---------------------------------------------------------------------------
// Dictionary — the single source of UI strings.
// ---------------------------------------------------------------------------

const fa = {
  // Header
  appName: 'آرچ‌جنیوس',
  headerTagline: 'سامانهٔ طراحی پارامتریک معماری',
  headerMeta: 'نسخه v1.0.1 · آفلاین · خروجی DXF R12 · تولید قطعی (Deterministic)',

  // Project section
  sectionProject: 'پروژه',
  projectName: 'نام پروژه',
  seedLabel: 'بذر تصادفی (Seed) — قطعی',
  seedHint: 'ورودی، بذر و ویرایش‌های یکسان ← خروجی یکسان',
  advancedProject: 'تنظیمات پیشرفتهٔ پروژه',

  // Site section
  sectionSite: 'سایت — هندسهٔ چندضلعی',
  siteShape: 'شکل سایت *',
  shapeRectangle: 'مستطیل',
  shapeLShape: 'شکل L',
  shapePolygon: 'چندضلعی (۳ تا ۸ رأس عمودبرهم)',
  siteShapeHint: 'چندضلعیِ قابل‌ساخت مرجع است و چیدمان داخل محدودهٔ ساخت (buildableBoundary) انجام می‌شود',
  widthM: 'عرض (متر)',
  lengthM: 'طول (متر)',
  accessSide: 'ضلع دسترسی',
  streetWidthM: 'عرض خیابان (متر)',
  lNotchTitle: 'ناچ (بریدگی) شکل L',
  notchWidthM: 'عرض ناچ (متر)',
  notchLengthM: 'طول ناچ (متر)',
  notchCorner: 'گوشهٔ ناچ',
  polygonVertsTitle: 'رئوس چندضلعی (پادساعتگرد، اضلاع عمودبرهم)',
  setbacksTitle: 'عقب‌نشینی‌ها (Setback) — تعریف کاربر',
  setbacksSummary: 'شمال {n} · جنوب {s} · شرق {e} · غرب {w} متر',
  setbackNorthM: 'شمال (متر)',
  setbackSouthM: 'جنوب (متر)',
  setbackEastM: 'شرق (متر)',
  setbackWestM: 'غرب (متر)',
  polygonJsonValid: 'قالب JSON چندضلعی معتبر است.',
  polygonJsonInvalid: 'JSON چندضلعی نامعتبر است — باید آرایه‌ای از مختصات {x,y} باشد.',

  // Building section
  sectionBuilding: 'ساختمان — ۱ تا ۱۰ طبقه',
  buildingType: 'نوع ساختمان',
  typeVilla: 'ویلایی (Villa)',
  typeApartment: 'آپارتمانی (Apartment)',
  floors: 'تعداد طبقات (۱ تا ۱۰)',
  bedrooms: 'اتاق خواب',
  masterBedrooms: 'اتاق خواب مستر',
  bathrooms: 'حمام/سرویس بهداشتی',
  wc: 'توالت مهمان',
  kitchen: 'آشپزخانه',
  kitchenClosed: 'بسته',
  kitchenOpen: 'باز',
  kitchenSemiOpen: 'نیمه‌باز',
  parkingSpaces: 'تعداد پارکینگ',
  hasStair: 'راه‌پله',
  stairRequiredHint: 'در ساختمان چندطبقه، راه‌پله الزامی است.',
  hasElevator: 'آسانسور',
  hasStorage: 'انباری',

  // Generate
  generate: 'تولید پلان',
  generating: 'در حال تولید…',
  generateWithParams: 'تولید پلان {floors} طبقه',
  stageGenerate: 'در حال تولید پلان…',
  stageValidate: 'در حال اعتبارسنجی…',
  stagePrepare: 'در حال آماده‌سازی نتایج…',
  busyHint: 'لطفاً تا پایان عملیات صبر کنید؛ ورودی‌های شما محفوظ می‌ماند.',

  // Plan header
  planTitle: 'پلان — {floors} طبقه — {shape}',
  floorPickerLabel: 'انتخاب طبقهٔ نمایش‌داده‌شده',
  strategyLabel: 'راهبرد',
  floorOf: 'طبقهٔ {current} از {total}',
  floorSelect: 'طبقهٔ {index} (تراز {level})',
  candidateSelect: '{index}: {strategy}',
  downloadDxf: 'خروجی DXF',
  downloadDxfHint: 'خروجی چندضلعی DXF R12',
  dxfReady: 'فایل DXF آماده و دانلود شد.',
  dxfDisabledHint: 'برای فعال‌شدن خروجی، ابتدا پلان تولید کنید.',
  editedBadge: 'ویرایش‌شده',

  // Metrics
  metricUsable: 'سطح قابل‌استفاده',
  metricCirculation: 'سیرکولاسیون',
  metricRoomDev: 'انحراف مساحت اتاق‌ها',
  metricDaylight: 'دسترسی به نور روز',
  metricValid: 'اعتبار',
  yes: 'بله',
  no: 'خیر',

  // Editing
  sectionEditing: 'ویرایش',
  generateFirst: 'ابتدا یک پلان تولید کنید.',
  selectRoom: 'انتخاب فضا (طبقهٔ {floor})',
  selectPlaceholder: '— انتخاب کنید —',
  editHint: 'یک فضا را از پلان یا فهرست «فضاها» انتخاب کنید تا ابزارهای ویرایش فعال شود.',
  editEngineNote: 'ویرایش‌ها توسط هستهٔ طراحی به‌صورت قیدمحور و قطعی اعمال می‌شوند.',
  editMoveTitle: 'جابه‌جایی',
  editResizeTitle: 'تغییر اندازه',
  editLShapeTitle: 'تبدیل به شکل L',
  editLockTitle: 'قفل‌گذاری',
  applyAction: 'اعمال',
  spaceTechTitle: 'جزئیات فنی فضا',
  spaceId: 'شناسه',
  area: 'مساحت',
  shape: 'شکل هندسی',
  verts: 'رئوس',
  privacy: 'حریم',
  zone: 'پهنه',
  constraints: 'قیود پارامتریک',
  locked: 'قفل‌شده',
  lockedPos: 'موقعیت',
  lockedSize: 'اندازه',
  lockedGeom: 'هندسه',
  lockedAdj: 'هم‌جواری',
  moveX: 'جابه‌جایی X',
  moveY: 'جابه‌جایی Y',
  moveRoom: 'جابه‌جایی فضا (هستهٔ طراحی)',
  width: 'عرض',
  height: 'ارتفاع',
  resizeSafe: 'تغییر اندازهٔ ایمن (هستهٔ طراحی)',
  setLShape: 'تبدیل به شکل L',
  setLShapeAction: 'اعمال شکل L (هستهٔ طراحی)',
  lockPos: '🔒 موقعیت',
  lockSize: '🔒 اندازه',
  lockAll: '🔒 همه',
  unlockAll: '🔓 رفع همهٔ قفل‌ها',
  lockAllLabel: 'همهٔ قفل‌ها',
  unlockAllLabel: 'رفع همهٔ قفل‌ها',
  validationAfterEdit: 'اعتبارسنجی پس از ویرایش ({count})',
  editFailed: 'ویرایش ناموفق —',

  // Validation
  sectionValidation: 'اعتبارسنجی — {floors} طبقه',
  generateToValidate: 'برای اعتبارسنجی، ابتدا پلان تولید کنید.',
  validTitle: 'معتبر',
  invalidTitle: 'نامعتبر — خطای بحرانی',
  summaryCounts: '{hard} بحرانی · {soft} هشدار · {advisory} نیازمند بررسی',
  badgeHard: 'بحرانی {count}',
  badgeSoft: 'هشدار {count}',
  badgeAdv: 'بررسی {count}',

  // Result status card
  resultTitle: 'وضعیت نتیجه',
  resultEmptyTitle: 'هنوز پلانی تولید نشده است',
  resultEmptyHint: 'مشخصات پروژه، سایت و نیازها را در پنل ورودی تنظیم کنید، سپس «تولید پلان» را بزنید.',
  resultSuccess: 'پلان با موفقیت تولید شد.',
  resultCandidatesNote: '{count} گزینهٔ معتبر تولید شد — گزینهٔ نخست (بهترین رتبه) انتخاب شده است.',
  resultInfeasibleTitle: 'تولید پلان ممکن نشد',
  resultInfeasibleBody: 'با این سایت و نیازهای داده‌شده، هیچ چیدمانی حداقل‌های هندسی را برآورده نمی‌کند. معمولاً بزرگ‌ترکردن ابعاد سایت، کاهش طبقات یا اتاق‌ها، یا کم‌کردن عقب‌نشینی‌ها مشکل را حل می‌کند. ورودی‌های شما محفوظ است.',
  infeasibleAttemptsTitle: 'نخستین خطای هر راهبرد',
  technicalDetails: 'جزئیات فنی',
  autoCheckNote: 'اعتبارسنجی خودکار است و جایگزین بررسی حرفه‌ای و کنترل مقررات محلی نیست.',

  // Findings groups
  findingsGroupHard: 'خطاهای بحرانی',
  findingsGroupSoft: 'هشدارها',
  findingsGroupAdv: 'نیازمند بررسی',
  findingsNone: 'موردی ثبت نشده است.',
  findingsShowMore: 'نمایش موارد بیشتر ({count})',
  findingsShowLess: 'نمایش کمتر',
  findingEntities: 'شیءهای مرتبط',

  // Candidates
  candidatesTitle: 'گزینه‌های پلان',
  candidateRank: 'گزینه {index}',
  candidateBestBadge: 'بهترین رتبه',
  candidateValidLabel: 'معتبر',
  candidateInvalidLabel: 'نامعتبر',
  candidateHardCount: '{count} بحرانی',
  candidateSoftCount: '{count} هشدار',
  candidateUsable: 'سطح قابل‌استفاده {value}٪',

  // Spaces / stairs
  sectionSpaces: 'فضاها — طبقهٔ {floor}',
  sectionStairs: 'راه‌پله‌ها',
  stairFloor: 'طبقهٔ {level}',
  stairRisers: 'رایزر',
  stairTread: 'کف پله (Tread)',
  stairRiser: 'ارتفاع رایزر (Riser)',
  stairLanding: 'پاگرد',
  stairLandings: 'پاگرد',
  stairFlights: 'بازو',
  stairNoFlights: 'بدون بازو',
  stairCore: 'هسته (Core)',
  stairWidth: 'عرض بازو',
  noStairs: 'راه‌پله‌ای ثبت نشده است.',

  // Canvas
  canvasEmpty: 'هنوز پلانی تولید نشده است. پارامترها را وارد و «تولید پلان» را بزنید.',
  canvasStair: 'راه‌پله',
  canvasFloor: 'طبقهٔ {current} از {last} — {count} فضا — برای انتخاب فضا کلیک کنید',
  canvasNorth: 'شمال',
  canvasAriaLabel: 'نمای پلان طبقهٔ {floor} — کلیک: انتخاب فضا، درگ: جابه‌جایی نما، اسکرول: بزرگ‌نمایی',
  canvasPanHint: 'درگ: جابه‌جایی نما · اسکرول: بزرگ‌نمایی · کلیک: انتخاب فضا',
  zoomInLabel: 'بزرگ‌نمایی',
  zoomOutLabel: 'کوچک‌نمایی',
  resetViewLabel: 'بازنشانی نما',
  legendTitle: 'راهنمای نمای پلان',
  legendRooms: 'فضاها',
  legendBuildable: 'محدودهٔ ساخت',
  legendParking: 'پارکینگ',
  legendStair: 'راه‌پله',
  legendOpenings: 'در و پنجره',

  // Errors
  errorInfeasible: 'ناممکن (INFEASIBLE) — هیچ گزینهٔ از نظر هندسی معتبری برای این سایت/برنامهٔ داده‌شده وجود ندارد.',
  errorInvalidPolygon: 'JSON چندضلعی نامعتبر است — باید آرایه‌ای از مختصات {x,y} باشد.',
  errorDetailsPointer: 'جزئیات در پنل «وضعیت نتیجه».',
  formAriaLabel: 'ورودی‌های پروژه',
} as const;

export type Dict = typeof fa;
export type DictKey = keyof Dict;

/** Access a dictionary string. Persian is the default and only locale. */
export function t<K extends DictKey>(key: K): Dict[K] {
  return fa[key];
}

/** Simple {placeholder} interpolation. */
export function tf<K extends DictKey>(key: K, vars: Record<string, string | number> = {}): string {
  let s: string = fa[key];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// ---------------------------------------------------------------------------
// Enum-ish value labels
// ---------------------------------------------------------------------------

export const SIDE_FA: Record<string, string> = {
  south: 'جنوب', north: 'شمال', east: 'شرق', west: 'غرب',
  'south-east': 'جنوب‌شرقی', 'south-west': 'جنوب‌غربی',
  'north-east': 'شمال‌شرقی', 'north-west': 'شمال‌غربی',
};

export const SHAPE_FA: Record<string, string> = {
  rectangle: 'مستطیل',
  'l-shape': 'شکل L',
  polygon: 'چندضلعی',
};

export const SEVERITY_FA: Record<string, string> = {
  hard: 'خطای بحرانی',
  soft: 'هشدار',
  advisory: 'نیازمند بررسی',
};

export const STRATEGY_FA: Record<string, string> = {
  'area-efficiency': 'بهره‌وری مساحت',
  'functional-circulation': 'سیرکولاسیون کارکردی',
  'daylight-orientation': 'جهت‌گیری نور روز',
  'alternative-zoning': 'زون‌بندی جایگزین',
};

export const STAIR_TYPE_FA: Record<string, string> = {
  straight: 'مستقیم',
  'u-stair': 'دو بازویی (U)',
  'l-stair': 'الگوی L',
};

export const SPACE_TYPE_FA: Record<string, string> = {
  living: 'نشیمن',
  dining: 'غذاخوری',
  kitchen: 'آشپزخانه',
  bedroom: 'اتاق خواب',
  'master-bedroom': 'اتاق خواب مستر',
  bathroom: 'سرویس بهداشتی',
  'master-bathroom': 'سرویس مستر',
  'guest-wc': 'توالت مهمان',
  'guest-room': 'اتاق مهمان',
  'family-room': 'اتاق خانواده',
  corridor: 'راهرو',
  'stair-hall': 'هال راه‌پله',
  'elevator-hall': 'هال آسانسور',
  entrance: 'ورودی',
  foyer: 'لابی ورودی',
  storage: 'انباری',
  balcony: 'بالکن',
  yard: 'حیاط',
  parking: 'پارکینگ',
  utility: 'فضای تأسیسات',
};

/**
 * Translate a core-generated English space label ("Bedroom 2", "Stair Hall", …)
 * to Persian. Machine ids and unknown labels are returned unchanged.
 */
export function spaceLabel(label: string): string {
  if (!label) return label;
  let m = label.match(/^(Bedroom|Bathroom) (\d+)$/);
  if (m) return m[1] === 'Bedroom' ? `اتاق خواب ${m[2]}` : `سرویس بهداشتی ${m[2]}`;
  const known: Record<string, string> = {
    'Living Room': 'نشیمن',
    'Dining': 'غذاخوری',
    'Kitchen': 'آشپزخانه',
    'Master Bedroom': 'اتاق خواب مستر',
    'Master Bathroom': 'سرویس مستر',
    'Guest WC': 'توالت مهمان',
    'Guest Room': 'اتاق مهمان',
    'Family Room': 'اتاق خانواده',
    'Corridor': 'راهرو',
    'Stair Hall': 'هال راه‌پله',
    'Elevator Hall': 'هال آسانسور',
    'Entrance': 'ورودی',
    'Foyer': 'لابی ورودی',
    'Storage': 'انباری',
    'Balcony': 'بالکن',
    'Yard': 'حیاط',
    'Parking': 'پارکینگ',
    'Utility': 'فضای تأسیسات',
  };
  return known[label] ?? label;
}

/** Persian label for a space's machine `type` (unknown types fall back to the code). */
export function spaceTypeFromLabel(s: { type: string }): string {
  return SPACE_TYPE_FA[s.type] ?? s.type;
}

// ---------------------------------------------------------------------------
// Finding codes — Persian titles. The CODE itself is never translated
// (machine-readable); this map only provides a human-readable Persian title.
// Engine message bodies are shown verbatim below the title.
// ---------------------------------------------------------------------------

export const FINDING_CODE_FA: Record<string, string> = {
  // Geometric
  GEO_OVERLAPPING_ROOMS: 'هم‌پوشانی فضاها',
  GEO_OVERLAPPING_WALLS: 'هم‌پوشانی دیوارها',
  GEO_SELF_INTERSECTION: 'خودتقاطعی هندسی',
  GEO_ZERO_AREA_SPACE: 'فضای با مساحت صفر',
  GEO_INVALID_DIMENSION: 'ابعاد نامعتبر',
  GEO_INVALID_COORDINATE: 'مختصات نامعتبر',
  GEO_DUPLICATE_GEOMETRY: 'هندسهٔ تکراری',
  GEO_INCONSISTENT_AREA: 'ناسازگاری مساحت',
  GEO_ROOM_OUTSIDE_FOOTPRINT: 'فضا خارج از محدودهٔ بنا',
  SITE_ROOM_OUTSIDE_BUILDABLE: 'فضا خارج از محدودهٔ ساخت',
  SITE_CORRIDOR_OUTSIDE_BUILDABLE: 'راهرو خارج از محدودهٔ ساخت',
  // Openings
  OPENING_DOOR_COLLISION: 'برخورد درها',
  OPENING_WINDOW_COLLISION: 'برخورد پنجره‌ها',
  OPENING_DOOR_SWING_BLOCKED: 'مانع در مسیر بازشدن در',
  OPENING_INVALID_WALL: 'دهانه با ارجاع به دیوار نامعتبر',
  // Circulation
  CIRC_INACCESSIBLE_SPACE: 'فضای خارج از دسترس (سیرکولاسیون)',
  CIRC_DISCONNECTED: 'قطع سیرکولاسیون',
  CIRC_CORRIDOR_TOO_NARROW: 'عرض ناکافی راهرو',
  CIRC_STAIR_OBSTRUCTED: 'انسداد مسیر راه‌پله',
  // Program
  PROG_MISSING_SPACE: 'فضای لازم در برنامه وجود ندارد',
  PROG_ROOM_TOO_SMALL: 'اتاق کوچک‌تر از حد مجاز',
  PROG_ROOM_TOO_NARROW: 'اتاق باریک‌تر از حد مجاز',
  // Parking
  PARK_BLOCKED_ACCESS: 'مسیر دسترسی پارکینگ مسدود است',
  PARK_INFEASIBLE_STALL: 'پارکینگ قابل‌ساخت نیست',
  PARK_AISLE_TOO_NARROW: 'عرض ناکافی مسیر تردد پارکینگ',
  // Regulation
  REG_SETBACK_VIOLATION: 'نقض عقب‌نشینی',
  REG_COVERAGE_VIOLATION: 'نقض درصد اشغال',
  REG_HEIGHT_VIOLATION: 'نقض حد ارتفاع',
  REG_PARKING_SHORTFALL: 'کمبود پارکینگ الزامی',
  REG_RULE_UNVERIFIED: 'قاعدهٔ تأییدنشده',
  // Architectural QA
  ARCH_ADJACENCY_VIOLATION: 'نقض هم‌جواری کارکردی',
  ARCH_DAYLIGHT_MISSING: 'نورگیر لازم وجود ندارد',
  ARCH_PRIVACY_VIOLATION: 'نقض حریم خصوصی',
  ARCH_ORIENTATION_MISSING: 'جهت‌گیری لازم رعایت نشده',
  // Furniture
  FURN_OUTSIDE_ROOM: 'مبل خارج از اتاق',
  FURN_COLLISION: 'برخورد مبلمان',
  FURN_CLEARANCE_BLOCKED: 'مانع در فضای کاربردی مبلمان',
  FURN_ON_STAIR: 'مبل روی راه‌پله',
  FURN_ON_LANDING: 'مبل روی پاگرد',
  FURN_BLOCKS_STAIR_ACCESS: 'مبلمان مانع دسترسی راه‌پله',
  FURNITURE_BLOCKS_DOOR: 'مبلمان مانع بازشدن در',
  FURNITURE_BLOCKS: 'مانع مبلمان',
  ROOM_UNUSABLE: 'اتاق غیرقابل‌استفاده',
  PRIVACY_WEAK: 'حریم خصوصی ضعیف',
  EXCESSIVE_RESIDUAL: 'فضای باقی‌ماندهٔ بیش از حد',
  ROOM_TOO_NARROW: 'اتاق بیش‌ازحد باریک',
  ROOM_BAD_PROPORTION: 'تناسب نامناسب اتاق',
  CIRCULATION_DEAD_END: 'بن‌بست سیرکولاسیون',
  CIRCULATION_EXCESSIVE: 'سیرکولاسیون بیش‌ازحد',
  DOOR_COLLISION: 'برخورد درها',
  WINDOW_COLLISION: 'برخورد پنجره‌ها',
  PARKING_ACCESS_BLOCKED: 'مسدودشدن دسترسی پارکینگ',
  SERVICE_EXPOSURE: 'قرارگیری ناصحیح فضای خدماتی',
  // Stairs
  STAIR_ZERO_AREA: 'راه‌پله با مساحت صفر',
  STAIR_INVALID_RISER_COUNT: 'تعداد رایزر نامعتبر',
  STAIR_INVALID_TREAD_COUNT: 'تعداد کف پله نامعتبر',
  STAIR_INVALID_RUN: 'طول دهانهٔ راه‌پله نامعتبر',
  STAIR_RISE_MISMATCH: 'ناسازگاری ارتفاع کل راه‌پله',
  STAIR_FLIGHT_TOO_LONG: 'بازوی راه‌پله بیش‌ازحد بلند',
  STAIR_FLIGHT_OVER_MAX_RISERS: 'بازوی راه‌پله بیش از حد مجاز رایزر',
  STAIR_MISSING_LANDING: 'پاگرد لازم وجود ندارد',
  STAIR_LANDING_COLLISION: 'برخورد پاگرد',
  STAIR_FLIGHT_COLLISION: 'برخورد بازوهای راه‌پله',
  STAIR_DISCONNECTED: 'راه‌پله پیوسته نیست',
  STAIR_ACCESS_BLOCKED: 'دسترسی به راه‌پله مسدود است',
  STAIR_OUTSIDE_BUILDING: 'راه‌پله خارج از محدودهٔ بنا',
  STAIR_SELF_INTERSECTION: 'خودتقاطعی راه‌پله',
  STAIR_NARROW_WIDTH: 'عرض ناکافی راه‌پله',
  STAIR_MISSING: 'نبود راه‌پله (سیرکولاسیون عمودی)',
  STAIR_CORE_MISALIGNED: 'ناهم‌راستایی هستهٔ راه‌پله بین طبقات',
  NO_FEASIBLE_STAIR_CONFIGURATION: 'هیچ پیکربندی منطبق بر مقررات برای راه‌پله ممکن نیست',
  // Regulation pack rule ids (also shown as code)
  'MBH4-STAIR-001': 'راه‌پله — الزامات عمومی (مبحث ۴)',
  'MBH4-STAIR-002': 'راه‌پله — کف پله و ارتفاع رایزر (مبحث ۴)',
  'MBH4-STAIR-003': 'راه‌پله — حداکثر رایزر در هر بازو (مبحث ۴)',
  'MBH4-STAIR-004': 'راه‌پله — عرض و پاگرد (مبحث ۴)',
  'MBH15-LIFT-001': 'آسانسور — الزام مبحث ۱۵ برای بناهای بلندمرتبه',
  'MBH15-LIFT-002': 'آسانسور — مشخصات کابین (مبحث ۱۵)',
  'MBH4-ROOM-001': 'اتاق — حداقل ابعاد (مبحث ۴)',
  'MBH4-ROOM-002': 'اتاق — حداقل مساحت (مبحث ۴)',
  'MBH4-ROOM-003': 'اتاق — نسبت ابعاد (مبحث ۴)',
  'MBH4-ROOM-004': 'اتاق — الزامات کارکردی (مبحث ۴)',
  'MBH4-ROOM-007': 'اتاق — سایر الزامات (مبحث ۴)',
  'MBH4-DYL-001': 'نور روز — حداقل نسبت پنجره (مبحث ۴)',
  'MBH4-DYL-002': 'نور روز — حداقل مساحت بازشو (مبحث ۴)',
  'MBH4-DYL-003': 'نور روز — جهت‌گیری (مبحث ۴)',
  'MBH4-VENT-001': 'تهویه — حداقل هوای تازه (مبحث ۴)',
  'MUN-PARK-001': 'پارکینگ — الزامات شهرداری',
  'MUN-SET-001': 'عقب‌نشینی — الزامات شهرداری',
  'THN-000': 'قواعد تهران — مورد عمومی',
};

/** Persian title for a finding code/ruleId; unknown codes fall back to the code itself. */
export function findingCodeTitle(code: string): string {
  return FINDING_CODE_FA[code] ?? code;
}

// ---------------------------------------------------------------------------
// Engine output helpers
// ---------------------------------------------------------------------------

/**
 * Persian summary of a validation result (UI-side replacement for the core
 * `summarize()` string, which is English).
 */
export function persianSummary(vr: { ok: boolean; hard: unknown[]; soft: unknown[]; advisory: unknown[] }): string {
  const counts = tf('summaryCounts', { hard: vr.hard.length, soft: vr.soft.length, advisory: vr.advisory.length });
  return vr.ok ? `${t('validTitle')} — ${counts}` : `${t('invalidTitle')} — ${counts}`;
}

// ---------------------------------------------------------------------------
// Message-template translation (shared machinery)
// ---------------------------------------------------------------------------

/**
 * One engine message template: an anchored regex over the English message the
 * core emits, plus the Persian replacement. `{n}` placeholders receive capture
 * groups; groups listed in `labels` are additionally mapped through the
 * Persian space-label table; `maps` performs exact-match lookups per group.
 */
interface MsgRule {
  re: RegExp;
  fa: string;
  /** 1-based capture groups holding human space labels ("Corridor / Stair Hall"). */
  labels?: number[];
  /** 1-based capture groups → exact-match translation maps (e.g. pack descriptions). */
  maps?: Record<number, Record<string, string>>;
}

/** Apply one rule; returns null when the regex does not match. */
function applyMsgRule(rule: MsgRule, msg: string): string | null {
  const m = msg.match(rule.re);
  if (!m) return null;
  let out = rule.fa;
  for (let i = 1; i < m.length; i++) {
    let v = m[i] ?? '';
    if (rule.labels?.includes(i)) v = faLabelRuns(v);
    if (rule.maps?.[i]) v = rule.maps[i][v] ?? v;
    if (v === '') {
      // Drop an empty trailing "— {n}" segment (e.g. constraint notes that are empty).
      out = out.replace(new RegExp(`\\s*—\\s*\\{${i}\\}\\s*$`), '');
      continue;
    }
    out = out.split(`{${i}}`).join(v);
  }
  return out;
}

/** "Corridor / Stair Hall" → Persian per segment; unknown segments unchanged. */
function faLabelRuns(s: string): string {
  return s.split(' / ').map(seg => spaceLabel(seg.trim())).join(' / ');
}

/** Common engine edit-error patterns → Persian; anything else is returned unchanged. */
export function translateEngineError(err: string): string {
  if (!err) return err;
  const patterns: MsgRule[] = [
    // move / lock / unlock
    [/^Floor (\S+) not found$/, 'طبقهٔ {1} پیدا نشد.'],
    [/^Space (\S+) not found$/, 'فضای {1} پیدا نشد.'],
    [/^Space (\S+) is locked for position\/geometry$/, 'فضای {1} برای موقعیت/هندسه قفل شده است.'],
    [/^Space (\S+) locked for size\/geometry$/, 'فضای {1} برای اندازه/هندسه قفل شده است.'],
    [/^Space (\S+) locked for geometry\/size$/, 'فضای {1} برای هندسه/اندازه قفل شده است.'],
    [/^Move would place room outside buildable boundary$/, 'جابه‌جایی، فضا را از محدودهٔ ساخت خارج می‌کند.'],
    [/^Move outside footprint$/, 'جابه‌جایی فضا را از محدودهٔ بنا خارج می‌کند.'],
    [/^Move would overlap locked room (\S+)$/, 'جابه‌جایی با فضای قفل‌شدهٔ {1} هم‌پوشانی می‌کند.'],
    [/^Move results in invalid polygon: (.*)$/, 'نتیجهٔ جابه‌جایی، چندضلعی نامعتبر است: {1}'],
    [/^Move results in HARD site containment: (.*)$/, 'جابه‌جایی منجر به نقض سختِ محدودهٔ سایت می‌شود: {1}'],
    [/^Move violates HARD parametric constraints: (.*)$/, 'جابه‌جایی قیود پارامتریک سخت را نقض می‌کند: {1}'],
    // resize
    [/^Resize outside footprint$/, 'تغییر اندازه فضا را از محدودهٔ بنا خارج می‌کند.'],
    [/^Resize would overlap locked room (\S+)$/, 'تغییر اندازه با فضای قفل‌شدهٔ {1} هم‌پوشانی می‌کند.'],
    [/^Resize overlaps locked room (\S+)$/, 'تغییر اندازه با فضای قفل‌شدهٔ {1} هم‌پوشانی می‌کند.'],
    [/^Resize too small (\S+)x(\S+) < 1\.0$/, 'تغییر اندازه بیش از حد کوچک است: {1}×{2} < 1.0'],
    [/^Resize violates minWidth (\S+)$/, 'تغییر اندازه minWidth {1} را نقض می‌کند.'],
    [/^Resize violates minLength (\S+)$/, 'تغییر اندازه minLength {1} را نقض می‌کند.'],
    [/^Resize violates maxArea (\S+)$/, 'تغییر اندازه maxArea {1} را نقض می‌کند.'],
    [/^Resize failed to preserve L-shape for (\S+)$/, 'تغییر اندازه نتوانست شکل L را برای {1} حفظ کند.'],
    [/^Resize cannot infer L-shape notch for (\S+)$/, 'نمی‌توان شکاف شکل L را برای {1} استنباط کرد.'],
    [/^Resize failed to create polygon$/, 'تغییر اندازه نتوانست چندضلعی بسازد.'],
    [/^Resize invalid polygon: (.*)$/, 'چندضلعی حاصل از تغییر اندازه نامعتبر است: {1}'],
    [/^Resize area ([\d.]+) < minArea (\S+)$/, 'مساحت حاصل از تغییر اندازه {1} < minArea {2}'],
    [/^Resize area ([\d.]+) > maxArea (\S+)$/, 'مساحت حاصل از تغییر اندازه {1} > maxArea {2}'],
    [/^Resize outside buildable$/, 'تغییر اندازه فضا را از محدودهٔ ساخت خارج می‌کند.'],
    [/^Resize results in HARD site containment$/, 'تغییر اندازه منجر به نقض سختِ محدودهٔ سایت می‌شود.'],
    [/^Resize violates HARD parametric constraints: (.*)$/, 'تغییر اندازه قیود پارامتریک سخت را نقض می‌کند: {1}'],
    // L-shape editing
    [/^Failed to create L-shape polygon with notch (\S+)x(\S+) corner (\S+)$/, 'ساخت چندضلعی شکل L با شکاف {1}×{2} و گوشهٔ {3} ناموفق بود.'],
    [/^L-shape area ([\d.]+) < minArea (\S+)$/, 'مساحت شکل L برابر {1} است — < minArea {2}'],
    [/^L-shape area ([\d.]+) > maxArea (\S+)$/, 'مساحت شکل L برابر {1} است — > maxArea {2}'],
    [/^L-shape outside buildable$/, 'شکل L از محدودهٔ ساخت خارج می‌شود.'],
    // bounded repair
    [/^Unresolvable overlap between locked rooms (\S+) and (\S+)$/, 'هم‌پوشانی حل‌نشدنی بین فضاهای قفل‌شدهٔ {1} و {2}'],
    [/^Overlap but no movable room (\S+) vs (\S+)$/, 'هم‌پوشانی بدون فضای قابل جابه‌جایی: {1} و {2}'],
    [/^Repair failed, overlap remains with locked room (\S+) vs (\S+)$/, 'تعمیر ناموفق بود؛ هم‌پوشانی با فضای قفل‌شده باقی مانده است: {1} و {2}'],
  ].map(([re, fa]) => ({ re: re as RegExp, fa: fa as string }) as MsgRule);
  for (const rule of patterns) {
    const out = applyMsgRule(rule, err);
    if (out !== null) return out;
  }
  return err;
}

// ---------------------------------------------------------------------------
// Finding message translation (UI layer, keyed by finding code)
// ---------------------------------------------------------------------------
//
// The core validator/regulator emits English finding `message` bodies from a
// fixed template set. The UI translates them here via code-keyed regex
// templates; capture groups preserve dynamic values verbatim (room labels are
// additionally mapped through the Persian label table). Unknown codes,
// non-matching templates and already-Persian text fall back to the original
// message — engine output is never mangled or guessed at.

/** Known regulation-pack descriptions (English boilerplate) → Persian. */
const PACK_DESCRIPTION_FA: Record<string, string> = {
  'Iranian National Building Code (Mabhas) clauses for residential construction. Rules marked VERIFIED have been cross-checked against Tier-1 BHRC PDFs held in sources/mabhas4-96.pdf and sources/mabhas-15.pdf (hashes recorded in source-registry). Findings with status VERIFIED are backed by clause, page, and snippet. Municipal parking/setback remain advisory and require local detailed plan.':
    'مفاد مبحث‌های ملی ساختمان ایران برای ساخت‌وساز مسکونی. قواعد علامت‌خوردهٔ VERIFIED با فایل‌های PDF ردهٔ ۱ مرکز تحقیقات راه، مسکن و شهرسازی (sources/mabhas4-96.pdf و sources/mabhas-15.pdf) تطبیق داده شده‌اند (هش‌ها در source-registry ثبت است). یافته‌های با وضعیت VERIFIED با بند، صفحه و متن پشتیبانی می‌شوند. عقب‌نشینی و پارکینگ شهرداری صرفاً توصیه‌ای است و به طرح تفصیلی محلی نیاز دارد.',
};

/** Site-shape enum values inside engine messages → Persian (unknown values unchanged). */
const SITE_SHAPE_FA: Record<string, string> = { ...SHAPE_FA };

/** Constraint templates shared by CONSTRAINT_DIRECT_ACCESS / CONSTRAINT_MUST_ADJACENT. */
const CONSTRAINT_MUST_ADJACENT_RULES: MsgRule[] = [{
  re: /^Constraint (\S+): (.+?) must be adjacent to (.+?)(?: — ?(.*))?$/,
  fa: 'قید {1}: «{2}» باید مجاور «{3}» باشد — {4}',
  labels: [2, 3],
}];

const FINDING_MESSAGE_FA: Record<string, MsgRule[]> = {
  // --- validation/architectural-qa.ts ---
  ROOM_UNUSABLE: [{ re: /^Room "(.+)" is unusable: area ([\d.]+) m², min side ([\d.]+) m below ([\d.]+) m\.$/, fa: 'فضای «{1}» غیرقابل استفاده است: مساحت {2} مترمربع، کم‌ترین ضلع {3} متر — کمتر از حداقل {4} متر.', labels: [1] }],
  ROOM_TOO_NARROW: [{ re: /^Room "(.+)" is too narrow: min side ([\d.]+) m\.$/, fa: 'فضای «{1}» بیش از حد باریک است: کم‌ترین ضلع {2} متر.', labels: [1] }],
  ROOM_BAD_PROPORTION: [{ re: /^Room "(.+)" has bad proportion: ([\d.]+) \/ ([\d.]+) = ([\d.]+)\.$/, fa: 'فضای «{1}» نسبت ابعاد نامناسب دارد: {2} / {3} = {4}.', labels: [1] }],
  CIRC_CORRIDOR_TOO_NARROW: [{ re: /^Corridor "(.+)" width ([\d.]+) m below minimum ([\d.]+) m\.$/, fa: 'عرض راهرو «{1}» برابر {2} متر است — کمتر از حداقل {3} متر.', labels: [1] }],
  CIRCULATION_EXCESSIVE: [
    { re: /^Circulation ratio ([\d.]+)% exceeds 35% — inefficient layout\.$/, fa: 'نسبت سیرکولاسیون {1}٪ از ۳۵٪ فراتر است — چیدمان ناکارآمد.' },
    { re: /^Circulation ratio ([\d.]+)% >35%$/, fa: 'نسبت سیرکولاسیون {1}٪ بیشتر از ۳۵٪ است.' },
  ],
  CIRCULATION_DEAD_END: [
    { re: /^Corridor "(.+)" appears to be a dead-end with ≤1 door\.$/, fa: 'راهرو «{1}» به‌ظاهر بن‌بست است (حداکثر یک در).', labels: [1] },
    { re: /^(\d+) dead-end corridor\(s\)$/, fa: '{1} راهروی بن‌بست.' },
  ],
  DOOR_COLLISION: [{ re: /^Doors (\S+) and (\S+) collide on wall (\S+)\.$/, fa: 'درهای {1} و {2} روی دیوار {3} با هم تداخل دارند.' }],
  WINDOW_COLLISION: [{ re: /^Window collides with door on wall (\S+): (\S+) vs (\S+)\.$/, fa: 'پنجره با در روی دیوار {1} تداخل دارد: {2} و {3}.' }],
  WINDOW_OUTSIDE: [
    { re: /^Window (\S+) references missing wall\.$/, fa: 'پنجرهٔ {1} به دیوار ناموجود ارجاع می‌دهد.' },
    { re: /^Window (\S+) is not on exterior wall \(found (\S+)\)\.$/, fa: 'پنجرهٔ {1} روی دیوار بیرونی نیست ({2}).' },
  ],
  PARKING_ACCESS_BLOCKED: [{ re: /^Parking stalls exist but no aisle defined — access may be blocked\.$/, fa: 'جای پارک موجود است اما مسیر تردد تعریف نشده — دسترسی ممکن است مسدود باشد.' }],
  FURNITURE_BLOCKS_DOOR: [
    { re: /^Furniture (\S+) may block door (\S+)\.$/, fa: 'مبلمان {1} ممکن است درِ {2} را مسدود کند.' },
    { re: /^Furniture (\S+) blocks door in (.+)$/, fa: 'مبلمان {1} درِ فضای «{2}» را مسدود می‌کند.', labels: [2] },
  ],
  SERVICE_EXPOSURE: [
    { re: /^Service room (.+) opens directly to public (.+) — privacy concern\.$/, fa: 'فضای خدماتی «{1}» مستقیماً به فضای عمومی «{2}» باز می‌شود — مسئلهٔ حریم خصوصی.', labels: [1, 2] },
    { re: /^Service (.+) opens to living$/, fa: 'فضای خدماتی «{1}» به نشیمن باز می‌شود.', labels: [1] },
    { re: /^Guest WC opens to living$/, fa: 'توالت مهمان به نشیمن باز می‌شود.' },
    { re: /^Kitchen opens to entrance$/, fa: 'آشپزخانه مستقیماً به ورودی باز می‌شود.' },
  ],
  PRIVACY_WEAK: [
    { re: /^Private room (.+) directly adjacent to entrance\/foyer — privacy weak\.$/, fa: 'فضای خصوصی «{1}» مستقیماً مجاور ورودی/لابی است — حریم خصوصی ضعیف.', labels: [1] },
    { re: /^Bedroom (.+) directly opens to (.+)$/, fa: 'اتاق خواب «{1}» مستقیماً به «{2}» باز می‌شود.', labels: [1, 2] },
    { re: /^Bedroom (.+) opens to living$/, fa: 'اتاق خواب «{1}» به نشیمن باز می‌شود.', labels: [1] },
    { re: /^(\d+) bedroom\(s\) exposed to entrance$/, fa: '{1} اتاق خواب در معرض دید ورودی است.' },
  ],
  EXCESSIVE_RESIDUAL: [{ re: /^Residual unassigned area ([\d.]+) m² is >15% of footprint \(([\d.]+) m²\)\.$/, fa: 'سطح باقی‌ماندهٔ بدون تخصیص {1} مترمربع است — بیش از ۱۵٪ سطح زیربنا ({2} مترمربع).' }],

  // --- validation/circulation.ts ---
  OPENING_INVALID_WALL: [{ re: /^Opening (\S+) references missing wall (\S+)\.$/, fa: 'دهانهٔ {1} به دیوار ناموجود {2} ارجاع می‌دهد.' }],
  CIRC_DISCONNECTED: [{ re: /^No circulation seed \(entrance\/foyer\/corridor\) found on floor\.$/, fa: 'هیچ نقطهٔ آغاز سیرکولاسیون (ورودی/لابی/راهرو) در این طبقه یافت نشد.' }],
  CIRC_INACCESSIBLE_SPACE: [{ re: /^Space "(.+)" is not reachable from the entrance\/circulation\.$/, fa: 'فضای «{1}» از ورودی/سیرکولاسیون قابل دسترس نیست.', labels: [1] }],
  OPENING_DOOR_SWING_BLOCKED: [{ re: /^Door of (.+) may swing into obstruction\.$/, fa: 'درِ {1} ممکن است هنگام بازشدن به مانع برخورد کند.', labels: [1] }],

  // --- validation/furniture.ts ---
  FURN_OUTSIDE_ROOM: [
    { re: /^Furniture (\S+) references missing space (\S+)\.$/, fa: 'مبلمان {1} به فضای ناموجود {2} ارجاع می‌دهد.' },
    { re: /^(\S+) extends outside "(.+)"\.$/, fa: '{1} از محدودهٔ «{2}» بیرون می‌زند.', labels: [2] },
  ],
  FURN_COLLISION: [
    { re: /^(\S+) overlaps (\S+) in the same room\.$/, fa: '{1} با {2} در یک فضا هم‌پوشانی دارد.' },
    { re: /^Collision in (.+)$/, fa: 'برخورد در «{1}».', labels: [1] },
  ],

  // --- validation/geometric.ts ---
  GEO_INVALID_DIMENSION: [
    { re: /^Space "(.+)" has invalid polygon \(verts (\d+)\)\.$/, fa: 'فضای «{1}» چندضلعی نامعتبر دارد ({2} رأس).', labels: [1] },
    { re: /^Space "(.+)" polygon invalid: (.*)\.$/, fa: 'چندضلعی فضای «{1}» نامعتبر است: {2}.', labels: [1] },
    { re: /^Space "(.+)" bounding too narrow \(([\d.]+) m < ([\d.]+) m\)\.$/, fa: 'مستطیل محیطی فضای «{1}» بیش از حد باریک است ({2} متر < {3} متر).', labels: [1] },
  ],
  GEO_INCONSISTENT_RECT: [{ re: /^Space "(.+)" rect not equal to polygon bounding rect \(canonical is polygon\)\.$/, fa: 'مستطیل فضای «{1}» با مستطیل محیطی چندضلعی برابر نیست (مرجع، چندضلعی است).', labels: [1] }],
  GEO_INCONSISTENT_AREA: [
    { re: /^Space "(.+)" area mismatch \(stored ([\d.]+) vs polygon ([\d.]+)\)\.$/, fa: 'ناسازگاری مساحت فضای «{1}» (ذخیره‌شده {2} در برابر چندضلعی {3}).', labels: [1] },
    { re: /^Space "(.+)" rectangle area mismatch \(polygon ([\d.]+) vs rect ([\d.]+)\)\.$/, fa: 'ناسازگاری مساحت مستطیل فضای «{1}» (چندضلعی {2} در برابر مستطیل {3}).', labels: [1] },
  ],
  GEO_ZERO_AREA_SPACE: [{ re: /^Space "(.+)" has near-zero area \(([\d.]+) m²\)\.$/, fa: 'فضای «{1}» مساحت تقریباً صفر دارد ({2} مترمربع).', labels: [1] }],
  GEO_ROOM_OUTSIDE_FOOTPRINT: [{ re: /^Space "(.+)" bounding extends outside the buildable footprint\.$/, fa: 'محدودهٔ فضای «{1}» از سطح قابل‌ساخت بیرون می‌زند.', labels: [1] }],
  GEO_OVERLAPPING_ROOMS: [{ re: /^Overlap between "(.+)" and "(.+)" \(bounding overlap ([\d.]+) m², polygon overlap detected\)\.$/, fa: 'هم‌پوشانی بین «{1}» و «{2}» (هم‌پوشانی محیطی {3} مترمربع؛ هم‌پوشانی چندضلعی تشخیص داده شد).', labels: [1, 2] }],
  GEO_OVERLAPPING_WALLS: [{ re: /^Walls (\S+) and (\S+) cross each other\.$/, fa: 'دیوارهای {1} و {2} از هم عبور می‌کنند.' }],

  // --- room size constraints (geometric.ts + model/room-constraints.ts) ---
  ROOM_CONSTRAINT_MIN_AREA: [
    { re: /^Space "(.+)" area ([\d.]+) < minArea ([\d.]+)\.$/, fa: 'مساحت فضای «{1}» برابر {2} است — کمتر از minArea {3}.', labels: [1] },
    { re: /^Area ([\d.]+) below min ([\d.]+)$/, fa: 'مساحت {1} کمتر از حداقل {2} است.' },
  ],
  ROOM_CONSTRAINT_MAX_AREA: [
    { re: /^Space "(.+)" area ([\d.]+) > maxArea ([\d.]+)\.$/, fa: 'مساحت فضای «{1}» برابر {2} است — بیش از maxArea {3}.', labels: [1] },
    { re: /^Area ([\d.]+) above max ([\d.]+)$/, fa: 'مساحت {1} بیش از حداکثر {2} است.' },
  ],
  ROOM_CONSTRAINT_MIN_WIDTH: [
    { re: /^Space "(.+)" min side ([\d.]+) < minWidth ([\d.]+)\.$/, fa: 'کم‌ترین ضلع فضای «{1}» برابر {2} است — کمتر از minWidth {3}.', labels: [1] },
    { re: /^Min side ([\d.]+) below minWidth ([\d.]+)$/, fa: 'کم‌ترین ضلع {1} کمتر از minWidth {2} است.' },
  ],
  ROOM_CONSTRAINT_MIN_LENGTH: [{ re: /^Max side ([\d.]+) below minLength ([\d.]+)$/, fa: 'بیش‌ترین ضلع {1} کمتر از minLength {2} است.' }],
  ROOM_CONSTRAINT_ASPECT_RATIO: [{ re: /^Aspect ([\d.]+) differs from preferred ([\d.]+)$/, fa: 'نسبت ابعاد {1} با مقدار ترجیحی {2} متفاوت است.' }],

  // --- validation/stair.ts ---
  STAIR_MISSING: [{ re: /^Multi-floor building: floor (\d+) has no vertical circulation element \(no stair\) connecting it to the floor above\.$/, fa: 'ساختمان چندطبقه: طبقهٔ {1} هیچ عضو سیرکولاسیون عمودی (راه‌پله) برای اتصال به طبقهٔ بالا ندارد.' }],
  STAIR_CORE_MISALIGNED: [{ re: /^Stair core (\S+): stairs on floors (\d+) and (\d+) do not stack vertically \(footprints do not overlap in plan\)\.$/, fa: 'هستهٔ راه‌پله {1}: راه‌پله‌های طبقات {2} و {3} روی هم قرار نمی‌گیرند (ردپاها در پلان هم‌پوشانی ندارند).' }],
  STAIR_OUTSIDE_BUILDING: [{ re: /^Stair (\S+) extends outside the floor footprint\.$/, fa: 'راه‌پلهٔ {1} از سطح طبقه بیرون می‌زند.' }],
  STAIR_ZERO_AREA: [
    { re: /^Stair (\S+) footprint is implausibly small \(([\d.]+) m²\)\.$/, fa: 'ردپای راه‌پلهٔ {1} به‌طرز غیرممکنی کوچک است ({2} مترمربع).' },
    { re: /^Flight (\S+) has zero area\.$/, fa: 'بازوی {1} مساحت صفر دارد.' },
    { re: /^Landing (\S+) has zero area\.$/, fa: 'پاگرد {1} مساحت صفر دارد.' },
  ],
  STAIR_INVALID_RISER_COUNT: [
    { re: /^Stair (\S+) has invalid total risers \((\d+)\)\.$/, fa: 'راه‌پلهٔ {1} تعداد رایزر نامعتبر دارد ({2}).' },
    { re: /^Flight (\S+) has (\d+) risers \(minimum 2\)\.$/, fa: 'بازوی {1} دارای {2} رایزر است (حداقل ۲).' },
  ],
  STAIR_INVALID_TREAD_COUNT: [
    { re: /^Stair (\S+) has zero\/negative riser \((\S+)\) or tread \((\S+)\)\.$/, fa: 'راه‌پلهٔ {1} رایزر ({2}) یا کف پله ({3}) صفر/منفی دارد.' },
    { re: /^Flight (\S+) tread count (\d+) ≠ risers-1 = (\d+)\.$/, fa: 'تعداد کف پلهٔ بازوی {1} برابر {2} است — ≠ رایزر−۱ = {3}.' },
  ],
  STAIR_RISE_MISMATCH: [
    { re: /^Stair (\S+) flight risers sum to (\d+), expected (\d+)\.$/, fa: 'مجموع رایزرهای بازوهای راه‌پلهٔ {1} برابر {2} است؛ مقدار مورد انتظار {3}.' },
    { re: /^Stair (\S+) total rise ([\d.]+) m ≠ (\d+)×([\d.]+) = ([\d.]+) m\.$/, fa: 'ارتفاع کل راه‌پلهٔ {1} برابر {2} متر است — ≠ {3}×{4} = {5} متر.' },
  ],
  STAIR_FLIGHT_COLLISION: [
    { re: /^Flight (\S+) extends outside the stairwell footprint\.$/, fa: 'بازوی {1} از محدودهٔ چاه راه‌پله بیرون می‌زند.' },
    { re: /^Flights (\S+) and (\S+) overlap in plan by ([\d.]+) m²\.$/, fa: 'بازوهای {1} و {2} در پلان به میزان {3} مترمربع هم‌پوشانی دارند.' },
  ],
  STAIR_LANDING_COLLISION: [
    { re: /^Landing (\S+) depth ([\d.]+) m is narrower than the stair width \(([\d.]+) m\)\.$/, fa: 'عمق پاگرد {1} برابر {2} متر است — باریک‌تر از عرض راه‌پله ({3} متر).' },
    { re: /^Landing (\S+) is outside the stairwell\.$/, fa: 'پاگرد {1} بیرون از چاه راه‌پله است.' },
    { re: /^Landing (\S+) overlaps flight (\S+)\.$/, fa: 'پاگرد {1} با بازوی {2} هم‌پوشانی دارد.' },
  ],
  STAIR_MISSING_LANDING: [{ re: /^Stair (\S+) has (\d+) flights but only (\d+) intermediate landing\(s\)\.$/, fa: 'راه‌پلهٔ {1} دارای {2} بازو اما تنها {3} پاگرد میانی است.' }],
  STAIR_DISCONNECTED: [{ re: /^Stair (\S+) entrance does not adjoin corridor\/foyer circulation\.$/, fa: 'ورودی راه‌پلهٔ {1} به سیرکولاسیون راهرو/لابی نمی‌رسد.' }],
  STAIR_INVALID_RUN: [
    { re: /^Flight (\S+) run length ([\d.]+) ≠ treads×going = ([\d.]+)\.$/, fa: 'طول دهانهٔ بازوی {1} برابر {2} است — ≠ کف‌پله×دم = {3}.' },
    { re: /^Flight (\S+) centerline length ([\d.]+) m ≠ declared run ([\d.]+) m\.$/, fa: 'طول خط مرکزی بازوی {1} برابر {2} متر است — ≠ دهانهٔ اعلان‌شده {3} متر.' },
  ],
  STAIR_NARROW_WIDTH: [{ re: /^Flight (\S+) width ([\d.]+) m is below 0\.90 m \(MBH4 §4-5-1-7-3 0\.90 m for small villas\)\.$/, fa: 'عرض بازوی {1} برابر {2} متر است — کمتر از ۰٫۹۰ متر (مبحث ۴ §4-5-1-7-3: ۰٫۹۰ متر برای ویلاهای کوچک).' }],
  FURN_ON_STAIR: [{ re: /^Furniture (\S+) occupies stair flight (\S+)\.$/, fa: 'مبلمان {1} بازوی راه‌پله {2} را اشغال کرده است.' }],
  FURN_ON_LANDING: [{ re: /^Furniture (\S+) occupies stair landing (\S+)\.$/, fa: 'مبلمان {1} پاگرد راه‌پله {2} را اشغال کرده است.' }],

  // --- layout/parametric-constraints.ts ---
  CONSTRAINT_DIRECT_ACCESS: CONSTRAINT_MUST_ADJACENT_RULES,
  CONSTRAINT_MUST_ADJACENT: CONSTRAINT_MUST_ADJACENT_RULES,
  CONSTRAINT_MUST_SEPARATED: [{ re: /^Constraint (\S+): (.+?) must be separated from (.+?)(?: — ?(.*))?$/, fa: 'قید {1}: «{2}» باید از «{3}» جدا باشد — {4}', labels: [2, 3] }],
  CONSTRAINT_PREFER_ADJACENT: [{ re: /^Constraint (\S+): (.+?) prefer adjacent to (.+)$/, fa: 'قید {1}: «{2}» ترجیحاً باید مجاور «{3}» باشد', labels: [2, 3] }],
  CONSTRAINT_PREFER_SEPARATED: [{ re: /^Constraint (\S+): (.+?) prefer separated from (.+)$/, fa: 'قید {1}: «{2}» ترجیحاً باید از «{3}» جدا باشد', labels: [2, 3] }],
  CONSTRAINT_PRIVACY: [{ re: /^Constraint (\S+): (.+?) privacy required from (.+) — direct adjacency$/, fa: 'قید {1}: «{2}» نیاز به حفظ حریم از «{3}» دارد — مجاورت مستقیم', labels: [2, 3] }],

  // --- generator / pipeline / regulations engine ---
  REG_RULE_UNVERIFIED: [
    { re: /^([A-Z0-9_-]+): Applied setbacks N=([\d.]+) S=([\d.]+) E=([\d.]+) W=([\d.]+) m\. Site shape (\S+), siteArea ([\d.]+) m², buildableArea ([\d.]+) m²\. Errors: (.*) — REQUIRES SOURCE VERIFICATION\.$/, fa: '{1}: عقب‌نشینی‌های اعمال‌شده N={2}، S={3}، E={4}، W={5} متر. شکل سایت {6}، مساحت سایت {7} مترمربع، سطح قابل‌ساخت {8} مترمربع. خطاها: {9} — نیازمند راستی‌آزمایی منبع.' , maps: { 6: SITE_SHAPE_FA } },
    { re: /^([A-Z0-9_-]+): Applied setbacks N=([\d.]+) S=([\d.]+) E=([\d.]+) W=([\d.]+) m\. Site shape (\S+), siteArea ([\d.]+) m², buildableArea ([\d.]+) m²\.\s*— REQUIRES SOURCE VERIFICATION\.$/, fa: '{1}: عقب‌نشینی‌های اعمال‌شده N={2}، S={3}، E={4}، W={5} متر. شکل سایت {6}، مساحت سایت {7} مترمربع، سطح قابل‌ساخت {8} مترمربع. — نیازمند راستی‌آزمایی منبع.' , maps: { 6: SITE_SHAPE_FA } },
    { re: /^([A-Z0-9_-]+): Applied assumed setbacks N=([\d.]+) S=([\d.]+) E=([\d.]+) W=([\d.]+) m\. Fallback due to error: (.*)$/, fa: '{1}: عقب‌نشینی‌های فرضیِ اعمال‌شده N={2}، S={3}، E={4}، W={5} متر. بازگشت به حالت جایگزین به‌دلیل خطا: {6}' },
    { re: /^([A-Z0-9_-]+): (.*) — REQUIRES SOURCE VERIFICATION\.$/, fa: '{1}: {2} — نیازمند راستی‌آزمایی منبع.' },
  ],
  'DEF-SETBACK-001': [{ re: /^Using default assumed setbacks; verify against municipal detailed plan\.$/, fa: 'از عقب‌نشینی‌های پیش‌فرض (فرضی) استفاده شده است؛ با طرح تفصیلی شهرداری تطبیق داده شود.' }],
  'DEF-PARK-001': [{ re: /^Parking (\d+)\/(\d+) stalls \(default assumption: 1 stall per residential unit — verify with municipality\)\.$/, fa: 'پارکینگ: {1} جای پارک از {2} جای لازم (فرض پیش‌فرض: یک جای پارک به ازای هر واحد مسکونی — با شهرداری تطبیق داده شود).' }],
  SITE_GEOM_INVALID: [{ re: /^Site\/buildable geometry invalid: (.*)$/, fa: 'هندسهٔ سایت/سطح قابل‌ساخت نامعتبر است: {1}' }],
  HARD_CONSTRAINT_INFEASIBLE_DIMENSION: [{ re: /^Phase13\.2 infeasible dimension: (.*) — candidate excluded from usable candidates \(diagnostic only\); when no valid candidate exists the result is INFEASIBLE with bestCandidate=null$/, fa: 'ابعاد غیرقابل‌حل (Phase13.2): {1} — گزینه از گزینه‌های قابل‌استفاده کنار گذاشته شد (صرفاً تشخیصی)؛ در نبودِ گزینهٔ معتبر، نتیجه INFEASIBLE با bestCandidate=null است' }],

  // --- validation/site.ts ---
  SITE_INVALID_POLYGON: [{ re: /^Site polygon invalid: (.*) — shape (\S+)$/, fa: 'چندضلعی سایت نامعتبر است: {1} — شکل {2}', maps: { 2: SITE_SHAPE_FA } }],
  SITE_ZERO_AREA: [{ re: /^Site area too small ([\d.]+) m² < 10 m²$/, fa: 'مساحت سایت بیش از حد کوچک است: {1} مترمربع < ۱۰ مترمربع' }],
  SITE_INSUFFICIENT_BUILDABLE: [{ re: /^Insufficient buildable area ([\d.]+) m² < 5 m² after setbacks$/, fa: 'سطح قابل‌ساخت ناکافی است: {1} مترمربع < ۵ مترمربع (پس از عقب‌نشینی)' }],
  SITE_WALL_OUTSIDE_BUILDABLE: [{ re: /^Wall (\S+) outside buildable boundary — startInside=(\S+) endInside=(\S+) midInside=(\S+) — site shape (\S+)$/, fa: 'دیوار {1} بیرون از محدودهٔ ساخت است — startInside={2}، endInside={3}، midInside={4} — شکل سایت {5}', maps: { 5: SITE_SHAPE_FA } }],
  SITE_OPENING_OUTSIDE_BUILDABLE: [{ re: /^Opening (\S+) center outside buildable boundary — site shape (\S+), center ([\d.,]+)$/, fa: 'مرکز دهانهٔ {1} بیرون از محدودهٔ ساخت است — شکل سایت {2}، مرکز {3}', maps: { 2: SITE_SHAPE_FA } }],
  SITE_OPENING_HOST_WALL_OUTSIDE: [{ re: /^Opening (\S+) host wall (\S+) outside buildable — site shape (\S+)$/, fa: 'دیوار میزبان دهانهٔ {1} ({2}) بیرون از محدودهٔ ساخت است — شکل سایت {3}', maps: { 3: SITE_SHAPE_FA } }],
  SITE_FURNITURE_OUTSIDE_BUILDABLE: [{ re: /^Furniture (\S+) in space (\S+) outside buildable boundary — site shape (\S+)$/, fa: 'مبلمان {1} در فضای {2} بیرون از محدودهٔ ساخت است — شکل سایت {3}', maps: { 3: SITE_SHAPE_FA } }],
  SITE_FURNITURE_OUTSIDE_ROOM: [{ re: /^Furniture (\S+) outside its containing room (.+) polygon — site shape (\S+)$/, fa: 'مبلمان {1} بیرون از چندضلعی فضای دربرگیرندهٔ «{2}» است — شکل سایت {3}', labels: [2], maps: { 3: SITE_SHAPE_FA } }],
  SITE_STAIR_OUTSIDE_BUILDABLE: [{ re: /^Stair (\S+) outside buildable boundary — site shape (\S+)$/, fa: 'راه‌پلهٔ {1} بیرون از محدودهٔ ساخت است — شکل سایت {2}', maps: { 2: SITE_SHAPE_FA } }],
  SITE_STAIR_FLIGHT_OUTSIDE_BUILDABLE: [{ re: /^Stair flight (.+) outside buildable — site shape (\S+)$/, fa: 'بازوی راه‌پله {1} بیرون از محدودهٔ ساخت است — شکل سایت {2}', maps: { 2: SITE_SHAPE_FA } }],
  SITE_PARKING_OUTSIDE_SITE: [{ re: /^Parking stall (\d+) outside site boundary — site shape (\S+)$/, fa: 'جای پارک {1} بیرون از محدودهٔ سایت است — شکل سایت {2}', maps: { 2: SITE_SHAPE_FA } }],
  SITE_PARKING_OVERLAPS_BUILDING: [
    { re: /^Parking stall (\d+) overlaps building footprint \(buildableBoundary\) — site-aware check, buildableRects empty due to decomposition failure$/, fa: 'جای پارک {1} با سطح زیربنا هم‌پوشانی دارد — بررسی site-aware (buildableBoundary)؛ buildableRects به‌دلیل شکست تجزیه خالی است' },
    { re: /^Parking stall (\d+) overlaps building footprint — site-aware check$/, fa: 'جای پارک {1} با سطح زیربنا هم‌پوشانی دارد — بررسی site-aware' },
  ],
  SITE_ROOM_OUTSIDE_BUILDABLE: [
    { re: /^Room "(.+)" polygon outside buildable boundary — site shape (\S+), poly verts (\d+), area ([\d.]+) not inside buildable polygon$/, fa: 'چندضلعی اتاق «{1}» بیرون از محدودهٔ ساخت است — شکل سایت {2}، {3} رأس، مساحت {4} مترمربع داخل چندضلعی قابل‌ساخت نیست', labels: [1], maps: { 2: SITE_SHAPE_FA } },
    { re: /^Room "(.+)" bounding rect outside buildable — site shape (\S+), rect ([\d.,]+) ([\d.]+x[\d.]+) not inside buildable polygon$/, fa: 'مستطیل محیطی اتاق «{1}» بیرون از محدودهٔ ساخت است — شکل سایت {2}، مستطیل {3} {4} داخل چندضلعی قابل‌ساخت نیست', labels: [1], maps: { 2: SITE_SHAPE_FA } },
  ],
  SITE_CORRIDOR_OUTSIDE_BUILDABLE: [
    { re: /^Corridor "(.+)" polygon outside buildable boundary — site shape (\S+), poly verts (\d+), area ([\d.]+) not inside buildable polygon$/, fa: 'چندضلعی راهرو «{1}» بیرون از محدودهٔ ساخت است — شکل سایت {2}، {3} رأس، مساحت {4} مترمربع داخل چندضلعی قابل‌ساخت نیست', labels: [1], maps: { 2: SITE_SHAPE_FA } },
    { re: /^Corridor "(.+)" bounding rect outside buildable — site shape (\S+), rect ([\d.,]+) ([\d.]+x[\d.]+) not inside buildable polygon$/, fa: 'مستطیل محیطی راهرو «{1}» بیرون از محدودهٔ ساخت است — شکل سایت {2}، مستطیل {3} {4} داخل چندضلعی قابل‌ساخت نیست', labels: [1], maps: { 2: SITE_SHAPE_FA } },
  ],

  // --- intelligence heuristics (soft/advisory) ---
  ARCH_DAYLIGHT_MISSING: [{ re: /^Room (.+) depth ([\d.]+)m >7m may have weak daylight$/, fa: 'فضای «{1}» با عمق {2} متر (>۷ متر) ممکن است نور روز ضعیفی داشته باشد', labels: [1] }],
  INTERFLOOR_ENTRANCE_VERTICAL_LONG: [{ re: /^Entrance to vertical circulation long path (\d+) steps \(HEURISTIC\)$/, fa: 'مسیر طولانی از ورودی تا سیرکولاسیون عمودی: {1} گام (تخمینی)' }],
  INTERFLOOR_CIRCULATION_MISSING: [{ re: /^(\d+) floor\(s\) missing corridor\/stair-hall \(HEURISTIC\)$/, fa: '{1} طبقه فاقد راهرو/هال راه‌پله است (تخمینی)' }],
  INTERFLOOR_PRIVACY_WEAK: [{ re: /^(\d+) bedroom\(s\) directly open to stair-hall on upper floors \(HEURISTIC\)$/, fa: '{1} اتاق خواب در طبقات بالا مستقیماً به هال راه‌پله باز می‌شود (تخمینی)' }],
  INTERFLOOR_ACCESS_MISSING: [{ re: /^(\d+) upper floor\(s\) not accessible via stair — vertical access broken \(HEURISTIC\)$/, fa: '{1} طبقهٔ بالا از طریق راه‌پله قابل دسترس نیست — دسترسی عمودی قطع است (تخمینی)' }],
  STACKING_INEFFICIENT: [{ re: /^Vertical stacking inefficient (\d+)% — kitchen ([\d.]+), bathroom ([\d.]+), wet ([\d.]+), circ ([\d.]+) \(HEURISTIC\)$/, fa: 'هم‌ترازی عمودی ناکارآمد است: {1}٪ — آشپزخانه {2}، سرویس بهداشتی {3}، نواحی تر {4}، سیرکولاسیون {5} (تخمینی)' }],
  VERT_CIRC_MISSING_STAIR: [{ re: /^Floor (\d+) missing stair where required for (\d+)-floor building — vertical access compromised \(HEURISTIC\)$/, fa: 'طبقهٔ {1} فاقد راه‌پلهٔ لازم برای ساختمان {2} طبقه است — دسترسی عمودی مخدوش است (تخمینی)' }],
  VERT_CIRC_MISALIGNED: [{ re: /^Stair footprint misalignment between floor (\d+) and (\d+) — overlap (\d+)% \(HEURISTIC\)$/, fa: 'عدم انطباق ردپای راه‌پله بین طبقات {1} و {2} — هم‌پوشانی {3}٪ (تخمینی)' }],
  VERT_CIRC_INVALID_STAIR: [{ re: /^Invalid stair on floor (\d+) — (.*) \(HEURISTIC\)$/, fa: 'راه‌پلهٔ نامعتبر در طبقهٔ {1} — {2} (تخمینی)' }],
};

/** Code-agnostic advisory frames (tried after the code-keyed rules). */
const UNIVERSAL_MESSAGE_FA: MsgRule[] = [
  { re: /^Rule "(.+)" is marked NOT_IMPLEMENTED\. (.+)$/, fa: 'قاعدهٔ «{1}» پیاده‌سازی نشده است (NOT_IMPLEMENTED). {2}', maps: { 2: PACK_DESCRIPTION_FA } },
  { re: /^Rule evaluator threw: (.*)$/, fa: 'ارزیاب قاعده با خطا مواجه شد: {1}' },
];

/**
 * Persian translation of a core finding `message` body, keyed by the finding
 * code. Dynamic values (ids, numbers, dimensions) are preserved verbatim;
 * room names are mapped through the Persian label table. Unknown or unmapped
 * messages fall back to the original text — never a guess.
 */
export function findingMessageFa(f: { code?: string | null; message: string }): string {
  const msg = f?.message ?? '';
  if (!msg) return msg;
  for (const rule of FINDING_MESSAGE_FA[f.code ?? ''] ?? []) {
    const out = applyMsgRule(rule, msg);
    if (out !== null) return out;
  }
  for (const rule of UNIVERSAL_MESSAGE_FA) {
    const out = applyMsgRule(rule, msg);
    if (out !== null) return out;
  }
  return msg;
}

/** Persian translation of the Phase13.2 INFEASIBLE explanation (fixed frame;
 *  the per-strategy diagnostic summary is preserved verbatim). */
export function translateInfeasibleExplanation(s: string): string {
  if (!s) return s;
  const rule: MsgRule = {
    re: /^Phase13\.2 INFEASIBLE: no geometrically valid candidate — (\d+)\/(\d+) strategy attempts, 0 satisfy the minimum-geometry contract \(every room w>0, h>0, area>0, polygon>=3 vertices, minWidth, minLength, minArea\)\. First failure per strategy: (.*)\. bestCandidate is null and no usable candidate is exposed; diagnostic candidates carry HARD_CONSTRAINT_INFEASIBLE_DIMENSION findings\. This result must NOT be treated as a normal architectural plan\.$/,
    fa: 'Phase13.2 INFEASIBLE: هیچ گزینهٔ هندسی معتبری وجود ندارد — {1} از {2} تلاش راهبردی، هیچ‌یک قرارداد حداقل هندسه را برآورده نمی‌کند (هر فضا w>0، h>0، area>0، چندضلعی با ≥3 رأس، minWidth، minLength، minArea). نخستین شکست هر راهبرد: {3}. bestCandidate برابر null است و هیچ گزینهٔ قابل‌استفاده‌ای ارائه نمی‌شود؛ گزینه‌های تشخیصی حامل یافته‌های HARD_CONSTRAINT_INFEASIBLE_DIMENSION هستند. این نتیجه را نباید پلان معماری عادی تلقی کرد.',
  };
  return applyMsgRule(rule, s) ?? s;
}

/** True when the string contains Persian script (used by tests). */
export function isPersianText(s: string): boolean {
  return /[\u0600-\u06FF]/.test(s);
}

/**
 * Format a count/step number with Persian digits — display-layer only.
 * Technical values (dimensions, coordinates, ids, metrics) intentionally keep
 * Western digits and stay in LTR runs; this is used for UI counts and steps
 * (e.g. «۳ خطای بحرانی»).
 */
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function faNum(n: number | string): string {
  return String(n).replace(/[0-9]/g, d => FA_DIGITS[+d]);
}

/** Persian-capable font stack — no external dependencies; falls back per glyph. */
export const PERSIAN_FONT_STACK = "'Vazirmatn', 'Segoe UI', Tahoma, 'Inter', ui-sans-serif, system-ui, sans-serif";
