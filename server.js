require("dotenv").config();
const express    = require("express");
const bodyParser = require("body-parser");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const fetch      = require("node-fetch");
const ExcelJS    = require("exceljs");
const path       = require("path");
const fs         = require("fs");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false, limit: "50mb" }));
app.use(bodyParser.json({ limit: "50mb" }));
app.set("trust proxy", 1);
app.use("/api", rateLimit({ windowMs: 60000, max: 300 }));

// ── DATABASE ──────────────────────────────────────────────
const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const Memory   = require("lowdb/adapters/Memory");
const { Client } = require("pg");

let pg = null;
let db = null;

async function initDB() {
  if (process.env.DATABASE_URL) {
    try {
      pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
      await pg.connect();
      await pg.query(`
        CREATE TABLE IF NOT EXISTS employees (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
          dept TEXT DEFAULT '', role TEXT DEFAULT '', email TEXT DEFAULT '',
          city TEXT DEFAULT '', state TEXT DEFAULT '',
          lim_travel INT DEFAULT 0, lim_food INT DEFAULT 0,
          lim_hotel INT DEFAULT 0, lim_total INT DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS claims (
          id TEXT PRIMARY KEY, emp_id TEXT, emp_name TEXT,
          description TEXT, category TEXT, amount NUMERIC,
          claim_date TEXT, status TEXT DEFAULT 'pending',
          source TEXT DEFAULT 'whatsapp', raw_message TEXT,
          note TEXT DEFAULT '', confidence NUMERIC DEFAULT 0.9,
          image_data TEXT DEFAULT '',
          received_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS counter (id INT PRIMARY KEY DEFAULT 1, val INT DEFAULT 1);
        INSERT INTO counter VALUES (1,1) ON CONFLICT DO NOTHING;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS state TEXT DEFAULT '';
        ALTER TABLE claims ADD COLUMN IF NOT EXISTS image_data TEXT DEFAULT '';
      `);
      const { rows } = await pg.query("SELECT COUNT(*) as c FROM employees");
      if (parseInt(rows[0].c) === 0) await seedPG();
      console.log("PostgreSQL connected!");
      return;
    } catch(e) { console.warn("PG failed:", e.message); pg = null; }
  }
  try { db = low(new FileSync(path.join(__dirname, "db.json"))); }
  catch(e) { db = low(new Memory()); }
  db.defaults({ employees: [], claims: [], counter: 1 }).write();
  if (db.get("employees").value().length === 0) seedLow();
  console.log("Using lowdb");
}

async function seedPG() {
  await pg.query(`INSERT INTO employees (id,name,phone,dept,role,email,city,state,lim_travel,lim_food,lim_hotel,lim_total) VALUES
    ('EMP001','Priya Sharma','+919876543210','Sales','Sales Manager','priya@company.com','Mumbai','Maharashtra',5000,2000,8000,15000),
    ('EMP002','Rahul Mehta','+918765432109','Engineering','Software Engineer','rahul@company.com','Bangalore','Karnataka',4000,1500,6000,12000),
    ('EMP003','Anita Nair','+917654321098','Marketing','Brand Manager','anita@company.com','Chennai','Tamil Nadu',6000,2500,10000,18000)
    ON CONFLICT DO NOTHING`);
}
function seedLow() {
  db.get("employees").push(
    {id:"EMP001",name:"Priya Sharma",phone:"+919876543210",dept:"Sales",role:"Sales Manager",email:"priya@company.com",city:"Mumbai",state:"Maharashtra",limits:{travel:5000,food:2000,hotel:8000,total:15000}},
    {id:"EMP002",name:"Rahul Mehta",phone:"+918765432109",dept:"Engineering",role:"Software Engineer",email:"rahul@company.com",city:"Bangalore",state:"Karnataka",limits:{travel:4000,food:1500,hotel:6000,total:12000}},
    {id:"EMP003",name:"Anita Nair",phone:"+917654321098",dept:"Marketing",role:"Brand Manager",email:"anita@company.com",city:"Chennai",state:"Tamil Nadu",limits:{travel:6000,food:2500,hotel:10000,total:18000}}
  ).write();
}

function pgEmp(r) {
  return { id:r.id,name:r.name,phone:r.phone,dept:r.dept,role:r.role,email:r.email,
    city:r.city||"",state:r.state||"",
    limits:{travel:r.lim_travel,food:r.lim_food,hotel:r.lim_hotel,total:r.lim_total} };
}
function pgClaim(r) {
  return { id:r.id,empId:r.emp_id,empName:r.emp_name,desc:r.description,category:r.category,
    amount:parseFloat(r.amount),date:r.claim_date,status:r.status,source:r.source,
    rawMessage:r.raw_message,note:r.note,confidence:parseFloat(r.confidence||0),
    imageData:r.image_data||"",receivedAt:r.received_at,updatedAt:r.updated_at };
}

async function dbGetEmployees(f={}) {
  if(pg){let q="SELECT * FROM employees WHERE 1=1";const p=[];if(f.state){p.push(f.state);q+=` AND state=$${p.length}`;}if(f.city){p.push(f.city);q+=` AND city=$${p.length}`;}q+=" ORDER BY created_at";const{rows}=await pg.query(q,p);return rows.map(pgEmp);}
  let e=db.get("employees").value();if(f.state)e=e.filter(x=>x.state===f.state);if(f.city)e=e.filter(x=>x.city===f.city);return e;
}
async function dbGetEmpById(id){
  if(pg){const{rows}=await pg.query("SELECT * FROM employees WHERE id=$1",[id]);return rows[0]?pgEmp(rows[0]):null;}
  return db.get("employees").find({id}).value()||null;
}
async function dbFindEmpByPhone(phone){
  const last10=phone.replace(/\D/g,"").slice(-10);
  const emps=await dbGetEmployees();
  return emps.find(e=>e.phone.replace(/\D/g,"").slice(-10)===last10)||null;
}
async function dbAddEmployee(e){
  if(pg){await pg.query(`INSERT INTO employees (id,name,phone,dept,role,email,city,state,lim_travel,lim_food,lim_hotel,lim_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[e.id,e.name,e.phone,e.dept||"",e.role||"",e.email||"",e.city||"",e.state||"",e.limits?.travel||0,e.limits?.food||0,e.limits?.hotel||0,e.limits?.total||0]);return dbGetEmpById(e.id);}
  db.get("employees").push(e).write();return e;
}
async function dbUpdateEmployee(id,u){
  if(pg){const l=u.limits||{};await pg.query(`UPDATE employees SET name=$1,phone=$2,dept=$3,role=$4,email=$5,city=$6,state=$7,lim_travel=$8,lim_food=$9,lim_hotel=$10,lim_total=$11 WHERE id=$12`,[u.name,u.phone,u.dept||"",u.role||"",u.email||"",u.city||"",u.state||"",l.travel||0,l.food||0,l.hotel||0,l.total||0,id]);return dbGetEmpById(id);}
  db.get("employees").find({id}).assign(u).write();return dbGetEmpById(id);
}
async function dbDeleteEmployee(id){
  if(pg){await pg.query("DELETE FROM employees WHERE id=$1",[id]);return;}
  db.get("employees").remove({id}).write();
}
async function dbNextId(){
  if(pg){const{rows}=await pg.query("UPDATE counter SET val=val+1 WHERE id=1 RETURNING val");return "CLM"+String(rows[0].val).padStart(4,"0");}
  const n=db.get("counter").value();db.set("counter",n+1).write();return "CLM"+String(n).padStart(4,"0");
}
async function dbGetClaims(f={}){
  if(pg){let q="SELECT * FROM claims WHERE 1=1";const p=[];if(f.empId){p.push(f.empId);q+=` AND emp_id=$${p.length}`;}if(f.status){p.push(f.status);q+=` AND status=$${p.length}`;}if(f.from){p.push(f.from);q+=` AND claim_date>=$${p.length}`;}if(f.to){p.push(f.to);q+=` AND claim_date<=$${p.length}`;}q+=" ORDER BY received_at DESC";const{rows}=await pg.query(q,p);return rows.map(pgClaim);}
  let c=db.get("claims").value();if(f.empId)c=c.filter(x=>x.empId===f.empId);if(f.status)c=c.filter(x=>x.status===f.status);if(f.from)c=c.filter(x=>x.date>=f.from);if(f.to)c=c.filter(x=>x.date<=f.to);return c.sort((a,b)=>new Date(b.receivedAt)-new Date(a.receivedAt));
}
async function dbAddClaim(c){
  if(pg){await pg.query(`INSERT INTO claims (id,emp_id,emp_name,description,category,amount,claim_date,status,source,raw_message,confidence,image_data) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10,$11)`,[c.id,c.empId,c.empName,c.desc,c.category,c.amount,c.date,c.source,c.rawMessage,c.confidence,c.imageData||""]);const{rows}=await pg.query("SELECT * FROM claims WHERE id=$1",[c.id]);return pgClaim(rows[0]);}
  const claim={...c,status:"pending",note:"",receivedAt:new Date().toISOString(),updatedAt:null};db.get("claims").push(claim).write();return claim;
}
async function dbGetClaimById(id){
  if(pg){const{rows}=await pg.query("SELECT * FROM claims WHERE id=$1",[id]);return rows[0]?pgClaim(rows[0]):null;}
  return db.get("claims").find({id}).value()||null;
}
async function dbUpdateClaim(id,status,note){
  if(pg){await pg.query("UPDATE claims SET status=$1,note=$2,updated_at=NOW() WHERE id=$3",[status,note,id]);return dbGetClaimById(id);}
  db.get("claims").find({id}).assign({status,note,updatedAt:new Date().toISOString()}).write();return dbGetClaimById(id);
}
async function dbBulkUpdate(empId,status,note){
  if(pg){const{rowCount}=await pg.query("UPDATE claims SET status=$1,note=$2,updated_at=NOW() WHERE emp_id=$3 AND status='pending'",[status,note,empId]);return rowCount;}
  const p=db.get("claims").filter({empId,status:"pending"}).value();p.forEach(c=>db.get("claims").find({id:c.id}).assign({status,note}).write());return p.length;
}

// ── TWILIO ────────────────────────────────────────────────
const twilio = require("twilio");
let twilioClient = null;
if(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN){try{twilioClient=twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);}catch(e){console.warn("Twilio:",e.message);}}
const TWILIO_WA = process.env.TWILIO_WHATSAPP_NUMBER||"whatsapp:+14155238886";
async function sendWA(to,body){
  if(!twilioClient){console.log("WA:",body.substring(0,60));return;}
  try{await twilioClient.messages.create({from:TWILIO_WA,to:to.startsWith("whatsapp:")?to:`whatsapp:${to}`,body});}
  catch(e){console.error("Twilio:",e.message);}
}

// ── PARSER ────────────────────────────────────────────────
async function parseExpense(text, mediaBase64, mediaType) {
  if(mediaBase64 && process.env.ANTHROPIC_API_KEY) {
    try {
      const content = [];
      if(mediaType==="application/pdf") {
        content.push({type:"document",source:{type:"base64",media_type:"application/pdf",data:mediaBase64}});
      } else {
        const mt=mediaType.includes("png")?"image/png":mediaType.includes("gif")?"image/gif":mediaType.includes("webp")?"image/webp":"image/jpeg";
        content.push({type:"image",source:{type:"base64",media_type:mt,data:mediaBase64}});
      }
      content.push({type:"text",text:`Extract the TOTAL amount from this receipt. Return ONLY JSON: {"description":"brief desc","amount":NUMBER_IN_RUPEES,"category":"travel|food|hotel|misc","date":"YYYY-MM-DD or null"}. Amount must be a plain number.`});
      const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:200,messages:[{role:"user",content}]})});
      const d=await r.json();
      const parsed=JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());
      if(parsed.amount>0) return parsed;
    } catch(e){console.error("Claude vision:",e.message);}
  }
  const t=(text||"").toLowerCase();
  const nums=[...(text||"").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(m=>parseFloat(m[0].replace(/,/g,"")));
  const amount=nums.length>0?Math.max(...nums):0;
  const cat=/cab|uber|ola|auto|flight|train|bus|taxi|airport|petrol|rapido/.test(t)?"travel":/lunch|dinner|food|meal|restaurant|cafe|coffee|swiggy|zomato/.test(t)?"food":/hotel|stay|lodge|room|oyo/.test(t)?"hotel":"misc";
  const desc=(text||"").replace(/\d[\d,]*(?:\.\d+)?/g,"").replace(/[₹]/g,"").replace(/\s+/g," ").trim()||(text||"");
  if(process.env.ANTHROPIC_API_KEY && text && amount===0){
    try{const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:150,messages:[{role:"user",content:`Parse expense: "${text}"\nReturn ONLY JSON: {"description":"desc","amount":number,"category":"travel|food|hotel|misc","date":"YYYY-MM-DD or null"}`}]})});const d=await r.json();return JSON.parse((d.content?.[0]?.text||"{}").replace(/```json|```/g,"").trim());}catch(e){}
  }
  return {description:desc,amount,category:cat,date:null,confidence:amount>0?0.9:0.3};
}

function cycleStart(d){const dt=new Date(d);return(dt.getDate()<=15?new Date(dt.getFullYear(),dt.getMonth(),1):new Date(dt.getFullYear(),dt.getMonth(),16)).toISOString().split("T")[0];}
function cycleEnd(d){const dt=new Date(d),day=dt.getDate(),y=dt.getFullYear(),m=dt.getMonth();return(day<=15?new Date(y,m,15):new Date(y,m+1,0)).toISOString().split("T")[0];}

const pendingReceipts = new Map();

// ── WHATSAPP MENU ─────────────────────────────────────────
async function handleMenu(From, Body, emp) {
  const t=(Body||"").toLowerCase().trim();
  const today=new Date().toISOString().split("T")[0];
  if(["hi","hello","hey","menu","help","start","claims","my claims"].includes(t)){
    await sendWA(From,`👋 Hi ${emp.name}! Welcome to Claim Buddy\n\n1️⃣ Reply 1 — This cycle claims\n2️⃣ Reply 2 — Last cycle claims\n3️⃣ Reply 3 — All my claims\n4️⃣ Reply 4 — Summary\n\nOr send expense: _Cab 450_`);
    return true;
  }
  if(t==="1"){
    const s=cycleStart(today),e=cycleEnd(today);
    const c=await dbGetClaims({empId:emp.id,from:s,to:e});
    const total=c.reduce((x,y)=>x+y.amount,0);
    if(!c.length){await sendWA(From,`No claims this cycle (${s} to ${e})`);return true;}
    let msg=`📋 This Cycle (${s} to ${e})\n\n`;
    c.slice(0,8).forEach(x=>{const st=x.status==="approved"?"✅":x.status==="rejected"?"❌":"⏳";msg+=`${st} ${x.desc} — Rs.${x.amount} · ${x.status}\n`;});
    msg+=`\n💰 Total: Rs.${total.toLocaleString("en-IN")}`;
    if(emp.limits&&emp.limits.total)msg+=`\nRemaining: Rs.${Math.max(0,emp.limits.total-total).toLocaleString("en-IN")}`;
    await sendWA(From,msg);return true;
  }
  if(t==="3"){
    const c=await dbGetClaims({empId:emp.id});
    const total=c.reduce((x,y)=>x+y.amount,0);
    const approved=c.filter(x=>x.status==="approved").reduce((x,y)=>x+y.amount,0);
    let msg=`📋 All My Claims\n\n`;
    c.slice(0,10).forEach(x=>{const st=x.status==="approved"?"✅":x.status==="rejected"?"❌":"⏳";msg+=`${st} ${x.desc} — Rs.${x.amount}\n`;});
    if(c.length>10)msg+=`...+${c.length-10} more\n`;
    msg+=`\nTotal: Rs.${total.toLocaleString("en-IN")}\nApproved: Rs.${approved.toLocaleString("en-IN")}`;
    await sendWA(From,msg);return true;
  }
  if(t==="4"){
    const s=cycleStart(today);
    const c=await dbGetClaims({empId:emp.id,from:s});
    const total=c.reduce((x,y)=>x+y.amount,0);
    const approved=c.filter(x=>x.status==="approved").reduce((x,y)=>x+y.amount,0);
    const pending=c.filter(x=>x.status==="pending").length;
    const remaining=Math.max(0,(emp.limits&&emp.limits.total||0)-total);
    await sendWA(From,`📊 Summary — This Cycle\n\nTotal: Rs.${total.toLocaleString("en-IN")}\nApproved: Rs.${approved.toLocaleString("en-IN")}\nPending: ${pending} claims\n${emp.limits&&emp.limits.total?`Limit: Rs.${emp.limits.total}\nRemaining: Rs.${remaining.toLocaleString("en-IN")}`:""}` );
    return true;
  }
  return false;
}

// ── WEBHOOK ───────────────────────────────────────────────
app.post("/webhook/whatsapp", async (req, res) => {
  const { Body, From, MediaUrl0, MediaContentType0, NumMedia } = req.body;
  console.log(`WA ${From}: ${Body||"(media)"}`);
  res.set("Content-Type","text/xml").send("<Response></Response>");
  const phone=From.replace("whatsapp:","");
  const emp=await dbFindEmpByPhone(phone);
  if(!emp){
    await sendWA(From,`👋 Welcome to Claim Buddy!\n\nYour number (${phone}) is not registered.\n\nAsk your finance team to add you first.`);
    return;
  }
  const isMenu=await handleMenu(From,Body,emp);
  if(isMenu) return;

  const pendingKey=`pending_${phone}`;
  const pendingClaim=pendingReceipts.get(pendingKey);
  if(pendingClaim){
    const t2=(Body||"").toLowerCase().trim();
    if(["no","n","skip"].includes(t2)){pendingReceipts.delete(pendingKey);await sendWA(From,`OK! Claim ${pendingClaim.id} saved without receipt.`);return;}
    if(MediaUrl0&&parseInt(NumMedia||0)>0){
      try{
        const r=await fetch(MediaUrl0,{headers:{Authorization:"Basic "+Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}});
        const buf=await r.buffer();
        const imgData=`data:${MediaContentType0||"image/jpeg"};base64,${buf.toString("base64")}`;
        if(pg)await pg.query("UPDATE claims SET image_data=$1,source='image_receipt' WHERE id=$2",[imgData,pendingClaim.id]);
        else if(db)db.get("claims").find({id:pendingClaim.id}).assign({imageData:imgData,source:"image_receipt"}).write();
        pendingReceipts.delete(pendingKey);
        await sendWA(From,`📸 Receipt attached to claim ${pendingClaim.id}!`);
      }catch(e){console.error("Receipt attach:",e.message);}
      return;
    }
    if(["yes","y","sure","ok"].includes(t2)){await sendWA(From,`Please send the photo or PDF for claim ${pendingClaim.id}`);return;}
  }

  let mediaBase64=null,mediaType="image/jpeg";
  if(MediaUrl0&&parseInt(NumMedia||0)>0){
    mediaType=MediaContentType0||"image/jpeg";
    try{const r=await fetch(MediaUrl0,{headers:{Authorization:"Basic "+Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}});const buf=await r.buffer();mediaBase64=buf.toString("base64");}
    catch(e){console.error("Media:",e.message);}
  }

  const parsed=await parseExpense(Body||"",mediaBase64,mediaType);
  if(!parsed.amount||parsed.amount===0){
    await sendWA(From,`Hi ${emp.name}! Could not find an amount.\n\nTry: Cab to office 450\nOr send a receipt photo 📸`);
    return;
  }

  const today=new Date().toISOString().split("T")[0];
  const claimDate=parsed.date||today;
  const id=await dbNextId();
  const imageData=mediaBase64?`data:${mediaType};base64,${mediaBase64}`:"";
  await dbAddClaim({id,empId:emp.id,empName:emp.name,desc:parsed.description||Body,category:parsed.category||"misc",amount:parsed.amount,date:claimDate,source:mediaBase64?"image_receipt":"whatsapp",rawMessage:Body||"",confidence:parsed.confidence||0.9,imageData});
  console.log(`Saved ${id} Rs.${parsed.amount} by ${emp.name}`);

  const cycleClaims=await dbGetClaims({empId:emp.id,from:cycleStart(claimDate)});
  const totalSpent=cycleClaims.filter(c=>c.status!=="rejected").reduce((s,c)=>s+c.amount,0);
  const totalLimit=emp.limits&&emp.limits.total||0;
  let limitMsg="";
  if(totalLimit&&(totalSpent+parsed.amount)>totalLimit*0.9){const rem=totalLimit-totalSpent;limitMsg=rem>0?`\n\nLimit Alert: Rs.${Math.max(0,Math.round(rem))} remaining`:`\n\nLimit Exceeded: Cycle limit of Rs.${totalLimit} reached.`;}

  const emo={travel:"Cab/Travel",food:"Food/Meal",hotel:"Hotel/Stay",misc:"Expense"};
  if(mediaBase64){
    await sendWA(From,`Claim Logged!\n\n${emo[parsed.category]}: ${parsed.description}\nAmount: Rs.${parsed.amount}\nDate: ${claimDate}\nID: ${id}\nStatus: Pending Approval\nReceipt: Attached${limitMsg}\n\nType hi to view claims`);
  } else {
    pendingReceipts.set(pendingKey,{id,amount:parsed.amount,desc:parsed.description||Body});
    setTimeout(()=>pendingReceipts.delete(pendingKey),10*60*1000);
    await sendWA(From,`Claim Logged!\n\n${emo[parsed.category]}: ${parsed.description}\nAmount: Rs.${parsed.amount}\nDate: ${claimDate}\nID: ${id}\nStatus: Pending Approval${limitMsg}\n\nDo you have a receipt?\nReply Yes to upload\nReply No to skip`);
  }
});

// ── EMPLOYEES API ─────────────────────────────────────────
app.get("/api/employees",async(req,res)=>{const f={};if(req.query.state)f.state=req.query.state;if(req.query.city)f.city=req.query.city;res.json(await dbGetEmployees(f));});
app.post("/api/employees",async(req,res)=>{const{id,name,phone,dept="",role="",email="",city="",state="",limits={}}=req.body;if(!id||!name||!phone)return res.status(400).json({error:"id, name and phone required"});if(await dbGetEmpById(id))return res.status(409).json({error:"Employee ID already exists"});try{res.status(201).json(await dbAddEmployee({id,name,phone,dept,role,email,city,state,limits}));}catch(e){res.status(500).json({error:e.message});}});
app.put("/api/employees/:id",async(req,res)=>{try{res.json(await dbUpdateEmployee(req.params.id,req.body));}catch(e){res.status(500).json({error:e.message});}});
app.delete("/api/employees/:id",async(req,res)=>{await dbDeleteEmployee(req.params.id);res.json({success:true});});

// ── CLAIMS API ────────────────────────────────────────────
app.get("/api/claims",async(req,res)=>{const f={};if(req.query.empId)f.empId=req.query.empId;if(req.query.status)f.status=req.query.status;if(req.query.from)f.from=req.query.from;if(req.query.to)f.to=req.query.to;if(req.query.cycle==="current"){f.from=cycleStart(new Date().toISOString().split("T")[0]);f.to=cycleEnd(new Date().toISOString().split("T")[0]);}res.json(await dbGetClaims(f));});
app.patch("/api/claims/bulk/:empId",async(req,res)=>{const{status,note=""}=req.body;if(!["approved","rejected"].includes(status))return res.status(400).json({error:"Invalid"});res.json({updated:await dbBulkUpdate(req.params.empId,status,note),status});});
app.patch("/api/claims/:id",async(req,res)=>{const{status,note=""}=req.body;const claim=await dbUpdateClaim(req.params.id,status,note);if(!claim)return res.status(404).json({error:"Not found"});const emp=await dbGetEmpById(claim.empId);if(emp&&status){const msg=status==="approved"?`Claim Approved!\n\nID: ${claim.id}\nRs.${claim.amount}\n${claim.desc}${note?"\nNote: "+note:""}\n\nReimbursement next cycle`:`Claim Rejected\n\nID: ${claim.id}\nRs.${claim.amount}${note?"\nReason: "+note:""}\n\nContact finance for details`;sendWA(`whatsapp:${emp.phone}`,msg);}res.json(claim);});
app.post("/api/claims/manual",async(req,res)=>{const{empId,message}=req.body;const emp=await dbGetEmpById(empId);if(!emp)return res.status(404).json({error:"Not found"});const parsed=await parseExpense(message);const id=await dbNextId();const claim=await dbAddClaim({id,empId:emp.id,empName:emp.name,desc:parsed.description||message,category:parsed.category||"misc",amount:parsed.amount||0,date:parsed.date||new Date().toISOString().split("T")[0],source:"manual",rawMessage:message,confidence:parsed.confidence||0.9,imageData:""});res.status(201).json(claim);});

// ── ANALYTICS ─────────────────────────────────────────────
app.get("/api/analytics",async(_,res)=>{const s=cycleStart(new Date().toISOString().split("T")[0]);const[cycle,emps]=await Promise.all([dbGetClaims({from:s}),dbGetEmployees()]);res.json({cycleStart:s,totalClaims:cycle.length,totalAmount:cycle.reduce((s,c)=>s+c.amount,0),pendingCount:cycle.filter(c=>c.status==="pending").length,approvedAmount:cycle.filter(c=>c.status==="approved").reduce((s,c)=>s+c.amount,0),byCategory:{travel:cycle.filter(c=>c.category==="travel").reduce((s,c)=>s+c.amount,0),food:cycle.filter(c=>c.category==="food").reduce((s,c)=>s+c.amount,0),hotel:cycle.filter(c=>c.category==="hotel").reduce((s,c)=>s+c.amount,0),misc:cycle.filter(c=>c.category==="misc").reduce((s,c)=>s+c.amount,0)},byEmployee:Object.fromEntries(emps.map(e=>{const ec=cycle.filter(c=>c.empId===e.id);return[e.id,{name:e.name,count:ec.length,total:ec.reduce((s,c)=>s+c.amount,0),pending:ec.filter(c=>c.status==="pending").length,limits:e.limits}];}))});});

// ── PDF EXPORT ────────────────────────────────────────────
app.get("/api/export/pdf/:empId",async(req,res)=>{
  try{
    const{PDFDocument,rgb,StandardFonts}=require("pdf-lib");
    const from=req.query.from||cycleStart(new Date().toISOString().split("T")[0]);
    const to=req.query.to||cycleEnd(new Date().toISOString().split("T")[0]);
    const claims=await dbGetClaims({empId:req.params.empId,from,to});
    const emp=await dbGetEmpById(req.params.empId);
    const pdfDoc=await PDFDocument.create();
    const font=await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold=await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const page=pdfDoc.addPage([595,842]);
    page.drawRectangle({x:0,y:750,width:595,height:92,color:rgb(0.09,0.07,0.29)});
    page.drawText("CLAIM BUDDY",{x:40,y:800,size:24,font:bold,color:rgb(1,1,1)});
    page.drawText("Expense Claims Report",{x:40,y:775,size:13,font,color:rgb(0.8,0.8,1)});
    page.drawText(`Employee: ${emp&&emp.name||req.params.empId}`,{x:40,y:720,size:12,font:bold,color:rgb(0.1,0.1,0.1)});
    page.drawText(`Period: ${from} to ${to}`,{x:40,y:700,size:11,font,color:rgb(0.4,0.4,0.4)});
    const total=claims.reduce((s,c)=>s+c.amount,0);
    page.drawText(`Total: Rs.${total.toLocaleString("en-IN")} (${claims.length} claims)`,{x:40,y:680,size:12,font:bold,color:rgb(0.09,0.07,0.29)});
    let y=640;
    page.drawRectangle({x:40,y:y-2,width:515,height:20,color:rgb(0.09,0.07,0.29)});
    page.drawText("ID",{x:45,y,size:9,font:bold,color:rgb(1,1,1)});
    page.drawText("Description",{x:100,y,size:9,font:bold,color:rgb(1,1,1)});
    page.drawText("Category",{x:280,y,size:9,font:bold,color:rgb(1,1,1)});
    page.drawText("Amount",{x:360,y,size:9,font:bold,color:rgb(1,1,1)});
    page.drawText("Date",{x:430,y,size:9,font:bold,color:rgb(1,1,1)});
    page.drawText("Status",{x:500,y,size:9,font:bold,color:rgb(1,1,1)});
    y-=22;
    for(const c of claims){
      if(y<60){break;}
      page.drawText(c.id,{x:45,y,size:8,font,color:rgb(0.2,0.2,0.2)});
      page.drawText((c.desc||"").substring(0,30),{x:100,y,size:8,font,color:rgb(0.2,0.2,0.2)});
      page.drawText(c.category,{x:280,y,size:8,font,color:rgb(0.2,0.2,0.2)});
      page.drawText(`Rs.${c.amount}`,{x:360,y,size:8,font,color:rgb(0.09,0.49,0.31)});
      page.drawText(c.date,{x:430,y,size:8,font,color:rgb(0.2,0.2,0.2)});
      const sc=c.status==="approved"?rgb(0.1,0.5,0.2):c.status==="rejected"?rgb(0.8,0.1,0.1):rgb(0.6,0.4,0);
      page.drawText(c.status,{x:500,y,size:8,font,color:sc});
      page.drawLine({start:{x:40,y:y-4},end:{x:555,y:y-4},thickness:0.3,color:rgb(0.9,0.9,0.9)});
      y-=18;
    }
    const pdfBytes=await pdfDoc.save();
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",`attachment; filename=claims-${req.params.empId}-${from}.pdf`);
    res.send(Buffer.from(pdfBytes));
  }catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/export",async(_,res)=>{const wb=new ExcelJS.Workbook();const ws=wb.addWorksheet("Claims");ws.columns=[{header:"Claim ID",key:"id",width:12},{header:"Employee",key:"empName",width:22},{header:"Description",key:"desc",width:32},{header:"Category",key:"category",width:12},{header:"Amount",key:"amount",width:14},{header:"Date",key:"date",width:14},{header:"Status",key:"status",width:12}];ws.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};ws.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF1E1B4B"}};(await dbGetClaims()).forEach(c=>ws.addRow(c));res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");res.setHeader("Content-Disposition",`attachment; filename=claims-${Date.now()}.xlsx`);await wb.xlsx.write(res);res.end();});
app.get("/health",async(_,res)=>{const c=await dbGetClaims();const e=await dbGetEmployees();res.json({status:"ok",claims:c.length,employees:e.length,uptime:Math.round(process.uptime())+"s",db:pg?"postgresql":"lowdb",node:process.version});});

// ── SERVE DASHBOARD ──────────────────────────────────────
const staticPath = path.join(__dirname, "public");
app.use(express.static(staticPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(staticPath, "index.html"));
});

app.get("*", (_, res) => {
  res.status(404).json({ app:"Claim Buddy v5", health:"/health", api:"/api", webhook:"/webhook/whatsapp" });
});

initDB().then(()=>{
  app.listen(PORT,"0.0.0.0",()=>{
    console.log(`\nClaim Buddy running on port ${PORT}`);
    if(!process.env.ANTHROPIC_API_KEY)console.warn("No ANTHROPIC_API_KEY");
    if(!process.env.TWILIO_ACCOUNT_SID)console.warn("No Twilio");
  });
}).catch(e=>{console.error("Startup failed:",e.message);process.exit(1);});
