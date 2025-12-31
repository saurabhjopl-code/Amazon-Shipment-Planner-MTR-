// ==================================================
// GLOBAL STATE (PHASE 1 + PHASE 2)
// ==================================================
const state = {
  sale: null,
  fba: null,
  uniware: null,
  mapping: null,
  working: []
};

// ==================================================
// REQUIRED HEADERS (LOCKED)
// ==================================================
const REQUIRED_HEADERS = {
  sale: [
    "Transaction Type",
    "Sku",
    "Quantity",
    "Ship To State",
    "Fulfillment Channel",
    "Warehouse Id"
  ],
  fba: [
    "Date",
    "MSKU",
    "Disposition",
    "Ending Warehouse Balance",
    "Location"
  ],
  uniware: [
    "Sku Code",
    "Total Inventory"
  ],
  mapping: [
    "Amazon Seller SKU",
    "Uniware SKU"
  ]
};

// ==================================================
// FILE INPUT HANDLERS
// ==================================================
document.getElementById("saleFile").addEventListener("change", e => handleFile(e, "sale"));
document.getElementById("fbaFile").addEventListener("change", e => handleFile(e, "fba"));
document.getElementById("uniwareFile").addEventListener("change", e => handleFile(e, "uniware"));
document.getElementById("generateBtn").addEventListener("click", generateAggregation);

// ==================================================
// HANDLE FILE
// ==================================================
function handleFile(event, type) {
  const file = event.target.files[0];
  const statusEl = document.getElementById(type + "Status");

  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseCSV(reader.result);
      validateHeaders(parsed.headers, REQUIRED_HEADERS[type]);
      state[type] = parsed.rows;
      statusEl.textContent = "Validated";
      statusEl.className = "status valid";
      log(`${type.toUpperCase()} validated`);
      checkAllValidated();
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = "status error";
      state[type] = null;
      log(err.message);
    }
  };
  reader.readAsText(file);
}

// ==================================================
// LOAD SKU MAPPING (STATIC)
// ==================================================
fetch("data/sku_mapping.csv")
  .then(res => res.text())
  .then(text => {
    const parsed = parseCSV(text);
    validateHeaders(parsed.headers, REQUIRED_HEADERS.mapping);
    state.mapping = parsed.rows;
    log("SKU Mapping loaded");
    checkAllValidated();
  });

// ==================================================
// CSV PARSER (AUTO DELIMITER)
// ==================================================
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  const lines = text.split(/\r?\n/);
  const delimiter = detectDelimiter(lines[0]);

  const headers = lines[0].split(delimiter).map(h => h.trim());
  const rows =
