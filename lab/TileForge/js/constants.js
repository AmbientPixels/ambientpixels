// TileForge Constants and Configuration
// W-count character limits (based on widest character 'W')
const LIMITS = {
  title: {
    max: 15,      // WWWWWWWWWWWWWWW
    warning: 12   // Warning threshold
  },
  subtitle: {
    max: 15,      // WWWWWWWWWWWWWWW
    warning: 12   // Warning threshold
  }
};

// Default CSV data for initial load (Fortnite OG localization)
const DEFAULT_CSV_DATA = `Locale,items/0/title,items/0/subtitle
AR-SA,Fortnite OG,موسم جديد
BG-BG,Fortnite OG,Нов сезон
CS-CZ,Fortnite OG,Nová sezóna
DA-DK,Fortnite OG,Ny sæson
DE-DE,Fortnite OG,Neue Saison
EL-GR,Fortnite OG,Νέα σεζόν
EN-US,Fortnite OG,New season
ES-ES,Fortnite OG,Nueva temporada
ES-MX,Fortnite OG,Nueva temporada
FI-FI,Fortnite OG,Uusi kausi
FR-FR,Fortnite OG,Nouvelle saison
FR-CA,Fortnite OG,Nouvelle saison
HE-IL,Fortnite OG,עונה חדשה
HR-HR,Fortnite OG,Nova sezona
HU-HU,Fortnite OG,Új évad
IT-IT,Fortnite OG,Nuova stagione
JA-JP,Fortnite OG,新シーズン
KO-KR,Fortnite OG,새 시즌
NB-NO,Fortnite OG,Ny sesong
NL-NL,Fortnite OG,Nieuw seizoen
PL-PL,Fortnite OG,Nowy sezon
PT-BR,Fortnite OG,Nova temporada
PT-PT,Fortnite OG,Nova época
RO-RO,Fortnite OG,Sezon nou
RU-RU,Fortnite OG,Новый сезон
SK-SK,Fortnite OG,Nová sezóna
SL-SI,Fortnite OG,Nova sezona
SV-SE,Fortnite OG,Ny säsong
TH-TH,Fortnite OG,ซีซันใหม่
TR-TR,Fortnite OG,Yeni sezon
UK-UA,Fortnite OG,Новий сезон
VI-VN,Fortnite OG,Mùa mới
ZH-CN,Fortnite OG,新赛季
ZH-TW,Fortnite OG,全新賽季`;

// Locale display names mapping
const LOCALE_NAMES = {
  'AR-SA': 'Arabic Saudi Arabia',
  'BG-BG': 'Bulgarian Bulgaria',
  'CS-CZ': 'Czech Czech Republic',
  'DA-DK': 'Danish Denmark',
  'DE-DE': 'German Germany',
  'EL-GR': 'Greek Greece',
  'EN-US': 'English United States',
  'ES-ES': 'Spanish Spain',
  'ES-MX': 'Spanish Mexico',
  'FI-FI': 'Finnish Finland',
  'FR-FR': 'French France',
  'FR-CA': 'French Canada',
  'HE-IL': 'Hebrew Israel',
  'HR-HR': 'Croatian Croatia',
  'HU-HU': 'Hungarian Hungary',
  'IT-IT': 'Italian Italy',
  'JA-JP': 'Japanese Japan',
  'KO-KR': 'Korean South Korea',
  'NB-NO': 'Norwegian Norway',
  'NL-NL': 'Dutch Netherlands',
  'PL-PL': 'Polish Poland',
  'PT-BR': 'Portuguese Brazil',
  'PT-PT': 'Portuguese Portugal',
  'RO-RO': 'Romanian Romania',
  'RU-RU': 'Russian Russia',
  'SK-SK': 'Slovak Slovakia',
  'SL-SI': 'Slovenian Slovenia',
  'SV-SE': 'Swedish Sweden',
  'TH-TH': 'Thai Thailand',
  'TR-TR': 'Turkish Turkey',
  'UK-UA': 'Ukrainian Ukraine',
  'VI-VN': 'Vietnamese Vietnam',
  'ZH-CN': 'Chinese China',
  'ZH-TW': 'Chinese Taiwan'
};

// Global state
let currentCsvData = null;
let currentImageSrc = null;
