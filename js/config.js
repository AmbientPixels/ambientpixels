// File: js/config.js
const useProd = window.location.hostname.includes("ambientpixels.ai");

const config = {
  apiBase: useProd
    ? "https://ambientpixels-nova-api.azurewebsites.net/api"
    : "http://localhost:7071/api",

  keys: {
    generateNovaQuote: localStorage.getItem("generateNovaQuoteKey"),
    dreamLogWriter: localStorage.getItem("dreamLogWriterKey"),
  },
};

export default config;
