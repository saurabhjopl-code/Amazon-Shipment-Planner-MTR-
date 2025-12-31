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
  sale: ["Transaction Type","Sku","Quantity","Warehouse Id"],
  fba: ["Date","MSKU","Disposition","Ending Warehouse Balance","Location"],
  uniware: ["Sku Code","Total Inventory"],
  mapping: ["Amazon Seller SKU","Uniware SKU"]
};

// ==================================================
document.getElementById("saleFile").addEventListener("change", e => handleFile(e,"sale"));
document.getElementById("fbaFile").addEventListener("change", e => handleFile(e,"fba"));
document.getElementById("uniwareFile").addEventListener("change", e => handleFile(e,"uniware"));
document.getElementById("generateBtn").addEventListener("click", generateReport);

// ==================================================
function handleFile(e,type){
  const r=new FileReader();
  r.onload=()=>{
    const p=parseCSV(r.result);
    validateHeaders(p.headers,REQUIRED_HEADERS[type]);
    state[type]=p;
    document.getElementById(type+"Status").textContent="Validated";
    document.getElementById(type+"Status").className="status valid";
    log(type.toUpperCase()+" validated");
    checkReady();
  };
  r.readAsText(e.target.files[0]);
}

// ==================================================
fetch("data/sku_mapping.csv").then(r=>r.text()).then(t=>{
  const p=parseCSV(t);
  validateHeaders(p.headers,REQUIRED_HEADERS.mapping);
  state.mapping=p;
  log("SKU Mapping loaded");
  checkReady();
});

// ==================================================
function parseCSV(text){
  text=text.replace(/^\uFEFF/,"").trim();
  const lines=text.split(/\r?\n/);
  const d=detectDelimiter(lines[0]);
  const headers=normalize(lines[0].split(d));
  const rows=lines.slice(1).map(l=>normalize(l.split(d)));
  const index={}; headers.forEach((h,i)=>index[h]=i);
  return {headers,rows,index};
}
function detectDelimiter(l){return l.includes("\t")?"\t":l.includes(";")?";":",";}
function normalize(a){return a.map(v=>v.replace(/^"|"$/g,"").trim());}
function validateHeaders(h,r){r.forEach(x=>{if(!h.includes(x))throw Error("Missing required header: "+x);});}
function checkReady(){
  document.getElementById("generateBtn").disabled=!(
    state.sale&&state.fba&&state.uniware&&state.mapping
  );
}

// ==================================================
// 🔥 PHASE 3 – DECISION ENGINE
// ==================================================
function generateReport(){
  log("Phase 3 started");

  const skuMap={}, uniwareStock={}, sales={}, returns={}, fba={};

  state.mapping.rows.forEach(r=>{
    skuMap[r[state.mapping.index["Amazon Seller SKU"]]]=r[state.mapping.index["Uniware SKU"]];
  });

  state.uniware.rows.forEach(r=>{
    uniwareStock[r[state.uniware.index["Sku Code"]]]=Number(r[state.uniware.index["Total Inventory"]])||0;
  });

  state.sale.rows.forEach(r=>{
    const txn=r[state.sale.index["Transaction Type"]];
    const sku=r[state.sale.index["Sku"]];
    const qty=Number(r[state.sale.index["Quantity"]])||0;
    const fc=r[state.sale.index["Warehouse Id"]];
    const k=sku+"||"+fc;

    if(txn.startsWith("Shipment")||txn.startsWith("FreeReplacement")) sales[k]=(sales[k]||0)+qty;
    if(txn.startsWith("Refund")) returns[k]=(returns[k]||0)+qty;
  });

  const parseDate=d=>{const[x,y,z]=d.split("-");return new Date(`${z}-${y}-${x}`).getTime();};
  const f=state.fba;
  const latest=Math.max(...f.rows.map(r=>parseDate(r[f.index["Date"]])));

  f.rows.forEach(r=>{
    if(parseDate(r[f.index["Date"]])!==latest) return;
    if(r[f.index["Disposition"]]!=="SELLABLE") return;
    const sku=r[f.index["MSKU"]];
    const fc=r[f.index["Location"]];
    const k=sku+"||"+fc;
    fba[k]=(fba[k]||0)+(Number(r[f.index["Ending Warehouse Balance"]])||0);
  });

  const keys=new Set([...Object.keys(sales),...Object.keys(returns),...Object.keys(fba)]);
  state.working=[];

  keys.forEach(k=>{
    const [sku,fc]=k.split("||");
    const sale=sales[k]||0;
    const ret=returns[k]||0;
    const stock=fba[k]||0;
    if(!sale&&!stock) return;

    const drr=sale/30;
    const sc=drr?stock/drr:0;
    const rp=sale+ret?ret/(sale+ret)*100:0;
    const uw=uniwareStock[skuMap[sku]]||0;

    let decision="DISCUSS", send=0, recall=0, remarks="";

    if(sc<45 && uw>=45 && rp<=30){
      decision="SEND";
      send=Math.ceil((45*drr)-stock);
      remarks="Low stock cover";
    } else {
      decision="DO NOT SEND";
      if(sc>45 || rp>30){
        recall=Math.floor(stock-(45*drr));
        if(recall<0) recall=0;
        remarks="Overstock or high returns";
      } else {
        remarks="Uniware constraint";
      }
    }

    state.working.push({
      sku, fc,
      sale30d:sale,
      drr:+drr.toFixed(2),
      stockCover:+sc.toFixed(1),
      returnPct:+rp.toFixed(1),
      fcStock:stock,
      uniwareStock:uw,
      decision,
      sendQty:send<0?0:send,
      recallQty:recall
    });
  });

  log("Phase 3 completed: "+state.working.length+" rows");
  console.table(state.working);
}

// ==================================================
function log(m){document.getElementById("logBox").textContent+=m+"\n";}
