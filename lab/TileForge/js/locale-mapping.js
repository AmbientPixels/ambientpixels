// locale-mapping.js
// Backend locale management logic for TileForge
// Provides: locale mapping, utility functions, and default sets for ToH and Mobile

window.TileForgeLocales = (function() {
  // Locale mapping table auto-generated from ToH-template.csv
  const LOCALE_MAP = {
    "AR-AE": { language: "Arabic", country: "United Arab Emirates" },
    "AR-SA": { language: "Arabic", country: "Saudi Arabia" },
    "CS-CZ": { language: "Czech", country: "Czech Republic" },
    "DA-DK": { language: "Danish", country: "Denmark" },
    "DE-AT": { language: "German", country: "Austria" },
    "DE-CH": { language: "German", country: "Switzerland" },
    "DE-DE": { language: "German", country: "Germany" },
    "EL-GR": { language: "Greek", country: "Greece" },
    "EN-AE": { language: "English", country: "United Arab Emirates" },
    "EN-AU": { language: "English", country: "Australia" },
    "EN-CA": { language: "English", country: "Canada" },
    "EN-CZ": { language: "English", country: "Czech Republic" },
    "EN-GB": { language: "English", country: "United Kingdom" },
    "EN-GR": { language: "English", country: "Greece" },
    "EN-HK": { language: "English", country: "Hong Kong" },
    "EN-HU": { language: "English", country: "Hungary" },
    "EN-IE": { language: "English", country: "Ireland" },
    "EN-IL": { language: "English", country: "Israel" },
    "EN-IN": { language: "English", country: "India" },
    "EN-NZ": { language: "English", country: "New Zealand" },
    "EN-SA": { language: "English", country: "Saudi Arabia" },
    "EN-SG": { language: "English", country: "Singapore" },
    "EN-SK": { language: "English", country: "Slovakia" },
    "EN-US": { language: "English", country: "United States" },
    "EN-ZA": { language: "English", country: "South Africa" },
    "ES-AR": { language: "Spanish", country: "Argentina" },
    "ES-CL": { language: "Spanish", country: "Chile" },
    "ES-CO": { language: "Spanish", country: "Colombia" },
    "ES-ES": { language: "Spanish", country: "Spain" },
    "ES-MX": { language: "Spanish", country: "Mexico" },
    "FI-FI": { language: "Finnish", country: "Finland" },
    "FR-BE": { language: "French", country: "Belgium" },
    "FR-CA": { language: "French", country: "Canada" },
    "FR-CH": { language: "French", country: "Switzerland" },
    "FR-FR": { language: "French", country: "France" },
    "HE-IL": { language: "Hebrew", country: "Israel" },
    "HU-HU": { language: "Hungarian", country: "Hungary" },
    "IT-CH": { language: "Italian", country: "Switzerland" },
    "IT-IT": { language: "Italian", country: "Italy" },
    "JA-JP": { language: "Japanese", country: "Japan" },
    "KO-KR": { language: "Korean", country: "South Korea" },
    "NB-NO": { language: "Norwegian Bokmål", country: "Norway" },
    "NL-BE": { language: "Dutch", country: "Belgium" },
    "NL-NL": { language: "Dutch", country: "Netherlands" },
    "PL-PL": { language: "Polish", country: "Poland" },
    "PT-BR": { language: "Portuguese", country: "Brazil" },
    "PT-PT": { language: "Portuguese", country: "Portugal" },
    "SK-SK": { language: "Slovak", country: "Slovakia" },
    "SV-SE": { language: "Swedish", country: "Sweden" },
    "TR-TR": { language: "Turkish", country: "Turkey" },
    "UK-UA": { language: "Ukrainian", country: "Ukraine" },
    "ZH-HK": { language: "Chinese", country: "Hong Kong" },
    "ZH-SG": { language: "Chinese", country: "Singapore" },
    "ZH-TW": { language: "Chinese", country: "Taiwan" },
    "INVARIANT": { language: "Invariant", country: "Invariant" }
  };


  // Default sets (auto-generated from LOCALE_MAP)
  const DEFAULT_TOH = Object.keys(LOCALE_MAP);
  const DEFAULT_MOBILE = Object.keys(LOCALE_MAP);

  // Utility: get all supported locales
  function getAllLocales() {
    return Object.keys(LOCALE_MAP);
  }

  // Utility: filter by language
  function filterByLanguage(lang) {
    return getAllLocales().filter(loc => LOCALE_MAP[loc].language === lang);
  }

  // Utility: filter by country
  function filterByCountry(country) {
    return getAllLocales().filter(loc => LOCALE_MAP[loc].country === country);
  }

  // Utility: get info for a locale
  function getLocaleInfo(locale) {
    return LOCALE_MAP[locale] || null;
  }

  // Utility: get default sets
  function getDefaultSet(type) {
    return type === 'mobile' ? DEFAULT_MOBILE : DEFAULT_TOH;
  }

  // Exported API
  return {
    getAllLocales,
    filterByLanguage,
    filterByCountry,
    getLocaleInfo,
    getDefaultSet,
    LOCALE_MAP
  };
})();
