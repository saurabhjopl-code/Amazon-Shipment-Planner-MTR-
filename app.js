// ==================================================
// GLOBAL STATE
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
// FILE HANDLERS
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
      state[type] = null;
      statusEl.textContent = err.message;
      statusEl.className = "status error";
      log(err.message);
    }
  };
  reader.readAsText(file);
}

// ==================================================
// LOAD SKU MAPPING
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
// ROBUST CSV PARSER (LOCKED)
// ==================================================
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  const lines = text.split(/\r?\n/);
  const delimiter = detectDelimiter(lines[0]);

  const headers = normalize(lines[0].split(delimiter));
  const rows = lines.slice(1).map(l => normalize(l.split(delimiter)));

  return { headers, rows };
}

function detectDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

function normalize(arr) {
  return arr.map(v =>
    v.replace(/^"|"$/g, "").replace(/^\uFEFF/, "").trim()
  );
}

// ==================================================
// VALIDATION
// ==================================================
function validateHeaders(headers, required) {
  required.forEach(h => {
    if (!headers.includes(h)) {
      throw new Error(`Missing required header: ${h}`);
    }
  });
}

function checkAllValidated() {
  document.getElementById("generateBtn").disabled = !(
    state.sale &&
    state.fba &&
    state.uniware &&
    state.mapping
  );
}

// ==================================================
// PHASE 2 – CORRECT AGGREGATION (UNION LOGIC)
// ==================================================
function generateAggregation() {
  log("Phase 2 aggregation started");

  const skuMap = {};
  state.mapping.forEach(r => skuMap[r[0]] = r[1]);

  const uniwareStock = {};
  state.uniware.forEach(r => uniwareStock[r[0]] = Number(r[1]) || 0);

  const salesAgg = {};
  const returnAgg = {};

  state.sale.forEach(r => {
    const txn = r[0];
    const sku = r[1];
    const qty = Number(r[2]) || 0;
    const fc = r[5];
    const key = `${sku}||${fc}`;

    if (txn === "Shipment" || txn === "FreeReplacement") {
      salesAgg[key] = (salesAgg[key] || 0) + qty;
    }
    if (txn === "Refund") {
      returnAgg[key] = (returnAgg[key] || 0) + qty;
    }
  });

  const latestDate = Math.max(...state.fba.map(r => new Date(r[0]).getTime()));
  const fbaAgg = {};

  state.fba.forEach(r => {
    if (new Date(r[0]).getTime() !== latestDate) return;
    if (r[2] !== "SELLABLE") return;

    const key = `${r[1]}||${r[4]}`;
    fbaAgg[key] = (fbaAgg[key] || 0) + (Number(r[3]) || 0);
  });

  const allKeys = new Set([
    ...Object.keys(salesAgg),
    ...Object.keys(returnAgg),
    ...Object.keys(fbaAgg)
  ]);

  state.working = [];

  allKeys.forEach(key => {
    const [sku, fc] = key.split("||");
    const sale = salesAgg[key] || 0;
    const ret = returnAgg[key] || 0;
    const stock = fbaAgg[key] || 0;

    if (sale === 0 && stock === 0) return;

    state.working.push({
      sku,
      fc,
      sale30d: sale,
      drr: sale / 30,
      returnPct: sale + ret ? (ret / (sale + ret)) * 100 : 0,
      fcStock: stock,
      uniwareStock: uniwareStock[skuMap[sku]] || 0
    });
  });

  log(`Phase 2 completed: ${state.working.length} rows`);
  console.table(state.working);
}

// ==================================================
// LOG
// ==================================================
function log(msg) {
  document.getElementById("logBox").textContent += msg + "\n";
}
