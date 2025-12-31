/* ===========================
   (PHASE 1–4 CODE UNCHANGED)
   =========================== */

/* ⬆⬆⬆
   KEEP EVERYTHING YOU HAVE
   FROM PHASE 4 EXACTLY SAME
   ⬆⬆⬆ */

// ==================================================
// EXPORT BUTTONS
// ==================================================
document.getElementById("exportShipmentBtn").onclick = () =>
  exportCSV("shipment", r => r.decision === "SEND" && r.send > 0);

document.getElementById("exportRecallBtn").onclick = () =>
  exportCSV("recall", r => r.recall > 0);

document.getElementById("exportAllBtn").onclick = () =>
  exportCSV("full", () => true);

// ==================================================
// ENABLE EXPORTS AFTER REPORT
// ==================================================
function enableExports() {
  document.getElementById("exportShipmentBtn").disabled = false;
  document.getElementById("exportRecallBtn").disabled = false;
  document.getElementById("exportAllBtn").disabled = false;
}

// Call this at END of generateReport()
/* ADD THIS LINE AT VERY END OF generateReport():
   enableExports();
*/

// ==================================================
// CSV EXPORT CORE (LOCKED)
// ==================================================
function exportCSV(type, filterFn) {
  const rows = state.working.filter(filterFn);
  if (!rows.length) {
    alert("No data to export");
    return;
  }

  const headers = [
    "Amazon Seller SKU",
    "FC",
    "Current FC Stock",
    "Uniware Stock",
    "30D Sale",
    "DRR",
    "Stock Cover",
    "Decision",
    "Send Qty",
    "Recall Qty",
    "Remarks"
  ];

  let csv = headers.join(",") + "\n";

  rows.forEach(r => {
    csv += [
      r.sku,
      r.fc,
      r.stock,
      r.uw,
      r.sale,
      r.drr.toFixed(2),
      r.sc.toFixed(1),
      r.decision,
      r.send,
      r.recall,
      r.remarks
    ].join(",") + "\n";
  });

  downloadCSV(csv, `amazon_${type}_export.csv`);
}

// ==================================================
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
