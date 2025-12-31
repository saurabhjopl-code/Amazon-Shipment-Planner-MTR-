// ================= GLOBAL STATE =================
const state = {
  sale: null,
  fba: null,
  uniware: null,
  mapping: null,
  working: []
};

// ================= REQUIRED HEADERS =================
const REQUIRED_HEADERS = {
  sale: ["Transaction Type","Sku","Quantity","Warehouse Id","Fulfillment Channel"],
  fba: ["Date","MSKU","Disposition","Ending Warehouse Balance","Location"],
  uniware: ["Sku Code","Total Inventory"],
  mapping: ["Amazon Seller SKU","Uniware SKU"]
};

// ================= EVENTS =================
["sale","fba","uniware"].forEach(t=>{
  document.getElementById(t+"File").addEventListener("change",e=>loadFile(e,t));
});
document.getElementById("generateBtn").addEventListener("click", generateReport);

// ================= FILE LOAD =================
function loadFile(e,type){
  const file=e.target.files[0];
  const status=document.getElementById(type+"Status");
  if(!file) return;

  const r=new FileReader();
  r.onload=()=>{
    try{
      const p=parseCSV(r.result);
      validateHeaders(p.headers,REQUIRED_HEADERS[type]);
      state[type]=p;
      status.textContent="Validated";
      status.className="status valid";
    }catch(err){
      state[type]=null;
      status.textContent=err.message;
      status.className="status error";
    }
    checkReady();
  };
  r.readAsText(file);
}

// ================= SKU MAP =================
fetch("data/sku_mapping.csv")
  .then(r=>r.text())
  .then(t=>{
    const p=parseCSV(t);
    validateHeaders(p.headers,REQUIRED_HEADERS.mapping);
    state.mapping=p;
    checkReady();
  });

// ================= CSV PARSER (HARD LOCKED) =================
function parseCSV(text){
  text=text.replace(/^\uFEFF/,"").trim();
  const lines=text.split(/\r?\n/);
  const d=lines[0].includes("\t")?"\t":lines[0].includes(";")?";":",";
  const headers=lines[0].split(d).map(h=>normalize(h));
  const rows=lines.slice(1).map(l=>l.split(d).map(c=>normalize(c)));
  const index={}; headers.forEach((h,i)=>index[h]=i);
  return {headers,rows,index};
}
function normalize(v){
  return v.replace(/^"|"$/g,"").replace(/^\uFEFF/,"").trim();
}
function validateHeaders(h,r){
  r.forEach(x=>{
    if(!h.includes(x)) throw new Error("Missing header: "+x);
  });
}
function checkReady(){
  document.getElementById("generateBtn").disabled = !(
    state.sale && state.fba && state.uniware && state.mapping
  );
}

// ================= REPORT =================
function generateReport(){
  state.working=[];
  const skuMap={}, uniware={}, sales={}, returns={}, fba={};

  state.mapping.rows.forEach(r=>{
    skuMap[r[state.mapping.index["Amazon Seller SKU"]]] =
      r[state.mapping.index["Uniware SKU"]];
  });

  state.uniware.rows.forEach(r=>{
    uniware[r[state.uniware.index["Sku Code"]]] =
      Number(r[state.uniware.index["Total Inventory"]])||0;
  });

  // -------- SALES --------
  state.sale.rows.forEach(r=>{
    const txn=r[state.sale.index["Transaction Type"]];
    if(txn.startsWith("Cancel")) return;

    const sku=r[state.sale.index["Sku"]];
    const qty=Number(r[state.sale.index["Quantity"]])||0;
    const fc=r[state.sale.index["Warehouse Id"]] || "";
    const channel=r[state.sale.index["Fulfillment Channel"]];

    const key=sku+"||"+fc+"||"+channel;

    if(txn.startsWith("Shipment")||txn.startsWith("FreeReplacement"))
      sales[key]=(sales[key]||0)+qty;
    if(txn.startsWith("Refund"))
      returns[key]=(returns[key]||0)+qty;
  });

  // -------- FBA STOCK (AFN ONLY) --------
  const parseDate=d=>{
    const[a,b,c]=d.split("-");
    return new Date(`${c}-${b}-${a}`).getTime();
  };
  const f=state.fba;
  const latest=Math.max(...f.rows.map(r=>parseDate(r[f.index["Date"]])));

  f.rows.forEach(r=>{
    if(parseDate(r[f.index["Date"]])!==latest) return;
    if(r[f.index["Disposition"]]!=="SELLABLE") return;

    const sku=r[f.index["MSKU"]];
    const fc=r[f.index["Location"]];
    const key=sku+"||"+fc+"||AFN";

    fba[key]=(fba[key]||0)+(Number(r[f.index["Ending Warehouse Balance"]])||0);
  });

  const keys=new Set([...Object.keys(sales),...Object.keys(returns),...Object.keys(fba)]);

  keys.forEach(k=>{
    const [sku,fc,channel]=k.split("||");

    const sale=sales[k]||0;
    const ret=returns[k]||0;
    const stock=fba[k]||0;
    if(!sale && !stock) return;

    const drr=sale/30;
    const target=45*drr;
    const sc=drr?stock/drr:0;
    const uw=uniware[skuMap[sku]]||0;

    let send=0, recall=0, decision="DISCUSS";
    if(sc<45){
      send=Math.max(0,Math.ceil(target-stock));
      decision=send>0?"SEND":"DISCUSS";
    }else if(sc>45){
      recall=Math.max(0,Math.floor(stock-target));
      decision=recall>0?"DO NOT SEND":"DISCUSS";
    }

    state.working.push({
      sku,
      fc: fc || "Seller",
      channel,
      stock,
      uw,
      sale,
      drr,
      sc,
      send,
      recall,
      decision
    });
  });

  renderSections();
}

// ================= RENDER =================
function renderSections(){
  const afn={}, mfn={ Seller: [] };

  state.working.forEach(r=>{
    if(r.channel==="MFN" && r.fc==="Seller"){
      mfn.Seller.push(r);
    }else{
      afn[r.fc]=afn[r.fc]||[];
      afn[r.fc].push(r);
    }
  });

  renderTabs("afnTabs","afnContent",afn);
  renderTabs("mfnTabs","mfnContent",mfn);
}

function renderTabs(tabId,contentId,groups){
  const tabs=document.getElementById(tabId);
  const content=document.getElementById(contentId);
  tabs.innerHTML=""; content.innerHTML="";

  const fcs=Object.keys(groups);
  if(!fcs.length) return;

  fcs.forEach((fc,i)=>{
    const t=document.createElement("div");
    t.className="tab"+(i===0?" active":"");
    t.textContent=fc;
    t.onclick=()=>showTable(fc,groups,tabId,contentId);
    tabs.appendChild(t);
  });

  showTable(fcs[0],groups,tabId,contentId);
}

function showTable(fc,groups,tabId,contentId){
  document.querySelectorAll(`#${tabId} .tab`).forEach(t=>{
    t.classList.toggle("active",t.textContent===fc);
  });

  const rows=groups[fc];
  let limit=25;
  const container=document.getElementById(contentId);

  const render=()=>{
    container.innerHTML = buildSummary(rows) + buildTable(rows.slice(0,limit));
    if(limit < rows.length){
      const btn=document.createElement("button");
      btn.className="load-btn";
      btn.textContent="Load More";
      btn.onclick=()=>{limit+=25; render();};
      container.appendChild(btn);
    }
  };
  render();
}

// ================= TABLES =================
function buildSummary(rows){
  const sum=k=>rows.reduce((a,r)=>a+(r[k]||0),0);
  const sale=sum("sale"), stock=sum("stock");
  const drr=sale/30;
  const sc=drr?stock/drr:0;

  return `
  <table class="summary-table">
    <tr>
      <th>Current FC Stock</th><th>Uniware Stock</th><th>30D Sale</th>
      <th>DRR</th><th>Stock Cover</th><th>SEND QTY</th><th>RECALL QTY</th>
    </tr>
    <tr>
      <td>${stock}</td><td>${sum("uw")}</td><td>${sale}</td>
      <td>${drr.toFixed(2)}</td><td>${sc.toFixed(1)}</td>
      <td>${sum("send")}</td><td>${sum("recall")}</td>
    </tr>
  </table>`;
}

function buildTable(rows){
  let h=`<table><tr>
    <th>Amazon Seller SKU</th><th>Current FC Stock</th><th>Uniware Stock</th>
    <th>30D Sale</th><th>DRR</th><th>Stock Cover</th>
    <th>Decision</th><th>Send Qty</th><th>Recall Qty</th>
  </tr>`;
  rows.forEach(r=>{
    h+=`<tr>
      <td>${r.sku}</td><td>${r.stock}</td><td>${r.uw}</td>
      <td>${r.sale}</td><td>${r.drr.toFixed(2)}</td><td>${r.sc.toFixed(1)}</td>
      <td>${r.decision}</td><td>${r.send}</td><td>${r.recall}</td>
    </tr>`;
  });
  return h+"</table>";
}
