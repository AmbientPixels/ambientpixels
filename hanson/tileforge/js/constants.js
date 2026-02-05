// TileForge Constants and Configuration

// Default CSV data for initial load (Fortnite OG localization - comprehensive)
const DEFAULT_CSV_DATA = `Locale,items/0/title,items/0/subtitle,items/0/narratorText
Locale,Sample Title,Sample Subtitle,Narrator Text
AR-AE,Fortnite OG,موسم جديد ,
AR-SA,Fortnite OG,موسم جديد ,
CS-CZ,Fortnite OG,Nová sezóna ,
DA-DK,Fortnite OG,Ny sæson ,
DE-AT,Fortnite OG,Neue Staffel,
DE-CH,Fortnite OG,Neue Staffel,
DE-DE,Fortnite OG,Neue Staffel,
EL-GR,Fortnite OG,Νέα σεζόν ,
EN-AE,Fortnite OG,New season,
EN-AU,Fortnite OG,New season,
EN-CA,Fortnite OG,New season,
EN-CZ,Fortnite OG,New season,
EN-GB,Fortnite OG,New season,
EN-GR,Fortnite OG,New season,
EN-HK,Fortnite OG,New season,
EN-HU,Fortnite OG,New season,
EN-IE,Fortnite OG,New season,
EN-IL,Fortnite OG,New season,
EN-IN,Fortnite OG,New season,
EN-NZ,Fortnite OG,New season,
EN-SA,Fortnite OG,New season,
EN-SG,Fortnite OG,New season,
EN-SK,Fortnite OG,New season,
EN-US,Fortnite OG,New season,
EN-ZA,Fortnite OG,New season,
ES-AR,Fortnite OG,Nueva temporada,
ES-CL,Fortnite OG,Nueva temporada,
ES-CO,Fortnite OG,Nueva temporada,
ES-ES,Fortnite OG,Nueva temporada,
ES-MX,Fortnite OG,Nueva temporada,
FI-FI,Fortnite OG,Uusi kausi,
FR-BE,Fortnite OG,Nouvelle saison ,
FR-CA,Fortnite OG,Nouvelle saison ,
FR-CH,Fortnite OG,Nouvelle saison ,
FR-FR,Fortnite OG,Nouvelle saison ,
HE-IL,Fortnite OG,העונה החדשה כאן,
HU-HU,Fortnite OG,Új évad ,
IT-CH,Fortnite OG,Nuova stagione,
IT-IT,Fortnite OG,Nuova stagione,
JA-JP,Fortnite OG,新シーズン到来,
KO-KR,Fortnite OG,새로운 시즌 출시,
NB-NO,Fortnite OG,Ny sesong,
NL-BE,Fortnite OG,Nieuw seizoen ,
NL-NL,Fortnite OG,Nieuw seizoen ,
PL-PL,Fortnite OG,Nowy sezon,
PT-BR,Fortnite OG,Nova temporada,
PT-PT,Fortnite OG,Nova Temporada,
SK-SK,Fortnite OG,Nová sezóna ,
SV-SE,Fortnite OG,Ny säsong,
TR-TR,Fortnite OG,Yeni Sezon çıktı,
UK-UA,Fortnite OG,Новий сезон ,
ZH-HK,Fortnite OG,全新賽季 ,
ZH-SG,Fortnite OG,新赛季 ,
ZH-TW,Fortnite OG,全新賽季 ,`;

// Locale display names mapping (comprehensive)
const LOCALE_NAMES = {
  'AR-AE': 'Arabic UAE',
  'AR-SA': 'Arabic Saudi Arabia',
  'CS-CZ': 'Czech Czech Republic',
  'DA-DK': 'Danish Denmark',
  'DE-AT': 'German Austria',
  'DE-CH': 'German Switzerland',
  'DE-DE': 'German Germany',
  'EL-GR': 'Greek Greece',
  'EN-AE': 'English UAE',
  'EN-AU': 'English Australia',
  'EN-CA': 'English Canada',
  'EN-CZ': 'English Czech Republic',
  'EN-GB': 'English United Kingdom',
  'EN-GR': 'English Greece',
  'EN-HK': 'English Hong Kong',
  'EN-HU': 'English Hungary',
  'EN-IE': 'English Ireland',
  'EN-IL': 'English Israel',
  'EN-IN': 'English India',
  'EN-NZ': 'English New Zealand',
  'EN-SA': 'English Saudi Arabia',
  'EN-SG': 'English Singapore',
  'EN-SK': 'English Slovakia',
  'EN-US': 'English United States',
  'EN-ZA': 'English South Africa',
  'ES-AR': 'Spanish Argentina',
  'ES-CL': 'Spanish Chile',
  'ES-CO': 'Spanish Colombia',
  'ES-ES': 'Spanish Spain',
  'ES-MX': 'Spanish Mexico',
  'FI-FI': 'Finnish Finland',
  'FR-BE': 'French Belgium',
  'FR-CA': 'French Canada',
  'FR-CH': 'French Switzerland',
  'FR-FR': 'French France',
  'HE-IL': 'Hebrew Israel',
  'HU-HU': 'Hungarian Hungary',
  'IT-CH': 'Italian Switzerland',
  'IT-IT': 'Italian Italy',
  'JA-JP': 'Japanese Japan',
  'KO-KR': 'Korean South Korea',
  'NB-NO': 'Norwegian Norway',
  'NL-BE': 'Dutch Belgium',
  'NL-NL': 'Dutch Netherlands',
  'PL-PL': 'Polish Poland',
  'PT-BR': 'Portuguese Brazil',
  'PT-PT': 'Portuguese Portugal',
  'SK-SK': 'Slovak Slovakia',
  'SV-SE': 'Swedish Sweden',
  'TR-TR': 'Turkish Turkey',
  'UK-UA': 'Ukrainian Ukraine',
  'ZH-HK': 'Chinese Hong Kong',
  'ZH-SG': 'Chinese Singapore',
  'ZH-TW': 'Chinese Taiwan'
};

// Language mapping for filtering
const LANGUAGE_MAP = {
  'AR': 'Arabic',
  'CS': 'Czech',
  'DA': 'Danish',
  'DE': 'German',
  'EL': 'Greek',
  'EN': 'English',
  'ES': 'Spanish',
  'FI': 'Finnish',
  'FR': 'French',
  'HE': 'Hebrew',
  'HU': 'Hungarian',
  'IT': 'Italian',
  'JA': 'Japanese',
  'KO': 'Korean',
  'NB': 'Norwegian',
  'NL': 'Dutch',
  'PL': 'Polish',
  'PT': 'Portuguese',
  'RU': 'Russian',
  'SK': 'Slovak',
  'SV': 'Swedish',
  'TH': 'Thai',
  'TR': 'Turkish',
  'UK': 'Ukrainian',
  'ZH': 'Chinese'
};

// Region mapping for filtering
const REGION_MAP = {
  'AE': 'Middle East',
  'AR': 'South America',
  'AT': 'Europe',
  'AU': 'Oceania',
  'BE': 'Europe',
  'BR': 'South America',
  'CA': 'North America',
  'CH': 'Europe',
  'CL': 'South America',
  'CN': 'Asia',
  'CO': 'South America',
  'CZ': 'Europe',
  'DE': 'Europe',
  'DK': 'Europe',
  'ES': 'Europe',
  'FI': 'Europe',
  'FR': 'Europe',
  'GB': 'Europe',
  'GR': 'Europe',
  'HK': 'Asia',
  'HU': 'Europe',
  'IE': 'Europe',
  'IL': 'Middle East',
  'IN': 'Asia',
  'IT': 'Europe',
  'JP': 'Asia',
  'KR': 'Asia',
  'MX': 'North America',
  'NL': 'Europe',
  'NO': 'Europe',
  'NZ': 'Oceania',
  'PE': 'South America',
  'PL': 'Europe',
  'PT': 'Europe',
  'RU': 'Europe/Asia',
  'SA': 'Middle East',
  'SE': 'Europe',
  'SG': 'Asia',
  'SK': 'Europe',
  'TH': 'Asia',
  'TR': 'Europe/Asia',
  'TW': 'Asia',
  'UA': 'Europe',
  'US': 'North America',
  'ZA': 'Africa'
};

// Helper functions for locale parsing
function getLanguageFromLocale(locale) {
  return locale.split('-')[0].toUpperCase();
}

function getRegionFromLocale(locale) {
  return locale.split('-')[1];
}

// Text length limits for tile analysis (legacy - now handled by template system)
const LIMITS = {
  title: {
    max: 40,        // Maximum characters before overflow
    warning: 30     // Warning threshold for near-limit
  },
  subtitle: {
    max: 40,        // Maximum characters before overflow  
    warning: 30     // Warning threshold for near-limit
  }
};

// Get current template limits (template-aware)
function getCurrentLimits() {
  if (typeof window.templateSystem !== 'undefined') {
    return window.templateSystem.getCurrentLimits();
  }
  return LIMITS; // Fallback to legacy limits
}

// Global state
window.currentCsvData = null;
window.currentImageSrc = null;
