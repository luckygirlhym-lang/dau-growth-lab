export const HISTORY_FIELDS=['date','segment','active_users','segment_users','platform','channel','app_version','os_version','country','user_type'];
export const PLAN_FIELDS=['date','channel','source','mode','budget','cpi','cpm','ctr','install_rate','activation_rate','new_users'];
const aliases={os_version:['OS版本','os版本','操作系统版本'],country:['国家','国家地区','国家/地区'],user_type:['新老用户','用户新老类型'],entity:['主体','数据主体'],metric:['指标','指标名称'],value:['指标值','数值'],unit:['单位'],scope:['统计范围'],source_url:['来源链接'],end_date:['结束日期'],event_type:['事件类型'],title:['事件标题'],evidence_url:['证据链接'],notes:['事件说明'],curve_type:['曲线类型'],day_offset:['间隔天数','第几天'],active_probability:['活跃概率','逐日活跃概率'],as_of_date:['预测起点','曲线起点'],date:['日期','时间','统计日期','开始日期'],segment:['用户分层','分层','用户类型'],active_users:['活跃人数','日活跃人数','每日活跃用户量','每日用户量','用户量','人数','dau'],segment_users:['分层总人数','分层用户池人数'],platform:['平台','操作系统'],channel:['渠道','投放渠道'],app_version:['版本','产品版本'],source:['来源','来源类型'],mode:['测算方式','测算模式'],budget:['预算','投放预算'],cpi:['安装成本','单安装成本'],cpm:['千次曝光成本'],ctr:['点击率'],install_rate:['安装转化率'],activation_rate:['首次激活率','新增活跃转化率','激活率'],new_users:['新增活跃人数','自然新增活跃人数','直接新增人数']};
export function canonicalHeader(s){s=String(s??'').replace(/^\uFEFF/,'').trim().toLowerCase();return Object.keys(aliases).find(k=>k===s||aliases[k].includes(s))||s;}
export function parseDelimited(input){
 const text=input.replace(/^\uFEFF/,'');const first=text.split(/\r?\n/)[0];const delimiter=first.includes('\t')?'\t':',';const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell.length){throw Error('引号前存在无效字符，请检查 CSV 格式。');}else quoted=!quoted;}
 else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV 引号未闭合。');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);if(rows.length<2)throw Error('文件需要一行表头及至少一行数据。');
 const headers=rows.shift().map(canonicalHeader);if(new Set(headers).size!==headers.length)throw Error('字段重复，或中英文表头映射到了同一个字段。');
 const result=rows.map((r,i)=>{if(r.length!==headers.length)throw Error(`第 ${i+2} 行列数与表头不一致。`);return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]));});return {headers,rows:result};
}
export function toCSV(rows,fields){const q=v=>{if(typeof v==='number'&&!Number.isFinite(v))v='';let s=String(v??'');if(typeof v==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+[fields,...rows.map(r=>fields.map(f=>r[f]??''))].map(r=>r.map(q).join(',')).join('\r\n');}
export function validDate(s){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function numeric(v){if(v==null||String(v).trim()==='')return NaN;return Number(String(v).replaceAll(',',''));}
export function rate(v){const s=String(v??'').trim();return s.endsWith('%')?numeric(s.slice(0,-1))/100:numeric(s);}
const issue=(issues,level,row,text)=>issues.push({level,row,text});
export function validateHistory(parsed){
 const issues=[],rows=[];for(const f of ['date','segment','active_users'])if(!parsed.headers.includes(f))issue(issues,'error',0,`缺少必填字段：${f}`);
 const keys=new Set(),dates=new Set(),segments=new Set(),dateSegments=new Map();let stockRows=0;
 parsed.rows.forEach((r,i)=>{const n={...r,date:r.date??'',segment:r.segment??'',active_users:numeric(r.active_users)};const row=i+2;
 if(!validDate(n.date))issue(issues,'error',row,'日期应为有效的 YYYY-MM-DD。');else dates.add(n.date);
 if(!n.segment)issue(issues,'error',row,'用户分层不能为空。');else segments.add(n.segment);
 if(!Number.isSafeInteger(n.active_users)||n.active_users<0)issue(issues,'error',row,'活跃人数必须是非负安全整数。');
 if(r.segment_users!==undefined&&r.segment_users!==''){n.segment_users=numeric(r.segment_users);stockRows++;if(!Number.isSafeInteger(n.segment_users)||n.segment_users<0)issue(issues,'error',row,'分层用户池人数必须是非负安全整数。');if(n.active_users>n.segment_users)issue(issues,'error',row,'活跃人数不能大于分层用户池人数。');}
 const key=JSON.stringify([n.date,n.segment,...['platform','channel','app_version','os_version','country','user_type'].map(k=>r[k]||'')]);if(keys.has(key))issue(issues,'error',row,'日期、分层及维度组合重复；请删除重复或合计行。');keys.add(key);if(!dateSegments.has(n.date))dateSegments.set(n.date,new Set());dateSegments.get(n.date).add(n.segment);rows.push(n);});
 const sorted=[...dates].sort();if(sorted.length){const span=(Date.parse(sorted.at(-1))-Date.parse(sorted[0]))/86400000+1;if(span>sorted.length)issue(issues,'warning',0,`日期范围内缺少 ${span-sorted.length} 天；缺失日期不会按 0 补齐。`);if(sorted.length<56)issue(issues,'warning',0,'历史少于 56 天，可查看数据；后续短期预测需要更多历史来检验周周期。');
 const all=[...segments];const missing=sorted.filter(d=>all.some(s=>!dateSegments.get(d).has(s)));if(missing.length)issue(issues,'warning',0,`${missing.length} 天没有覆盖全部分层；请核对是缺数还是分层规则变化，真实为零请显式填 0。`);}
 if(stockRows&&stockRows!==rows.length)issue(issues,'warning',0,'只有部分行包含分层用户池人数，暂不能比较所有分层的活跃比例。');
 return {rows,issues,valid:!issues.some(x=>x.level==='error'),dates:sorted,segments:[...segments],hasStock:stockRows===rows.length&&rows.length>0};
}
export function validatePlan(parsed){
 const issues=[],rows=[],keys=new Set();for(const f of ['date','channel','source','mode'])if(!parsed.headers.includes(f))issue(issues,'error',0,`缺少必填字段：${f}`);
 const sourceMap={'投放':'paid','付费':'paid','自然':'organic'},modeMap={'安装成本':'cpi','安装成本法':'cpi','漏斗':'funnel','漏斗法':'funnel','直接填写':'direct'};
 parsed.rows.forEach((r,i)=>{const row=i+2,n={...r,date:r.date??'',channel:r.channel??'',source:sourceMap[r.source]||String(r.source??'').toLowerCase(),mode:modeMap[r.mode]||String(r.mode??'').toLowerCase()};
 if(!validDate(n.date))issue(issues,'error',row,'日期应为有效的 YYYY-MM-DD。');if(!n.channel)issue(issues,'error',row,'渠道不能为空。');if(!['paid','organic'].includes(n.source))issue(issues,'error',row,'source 仅支持 paid（投放）或 organic（自然）。');
 if(!['cpi','funnel','direct'].includes(n.mode))issue(issues,'error',row,'mode 仅支持 cpi、funnel 或 direct。');if(n.source==='organic'&&n.mode!=='direct')issue(issues,'error',row,'自然新增请直接填写 new_users，mode 设为 direct。');
 for(const f of ['budget','cpi','cpm','new_users'])n[f]=numeric(r[f]);for(const f of ['ctr','install_rate','activation_rate'])n[f]=rate(r[f]);
 const nonnegative=(f)=>{if(!Number.isFinite(n[f])||n[f]<0)issue(issues,'error',row,`${f} 必须为非负数。`);};
 const positive=f=>{if(!Number.isFinite(n[f])||n[f]<=0)issue(issues,'error',row,`${f} 必须大于 0。`);};
 const probability=f=>{if(!Number.isFinite(n[f])||n[f]<0||n[f]>1)issue(issues,'error',row,`${f} 须在 0—1 之间，例如 0.05 或 5%。`);};
 if(n.mode==='direct'){nonnegative('new_users');if(!Number.isSafeInteger(n.new_users))issue(issues,'error',row,'直接填写的新增活跃人数须为整数。');if(Number.isFinite(n.budget)&&n.budget!==0)issue(issues,'error',row,'direct 模式不参与预算反推，请将 budget 留空或填 0。');}
 if(n.mode==='cpi'){nonnegative('budget');positive('cpi');probability('activation_rate');}
 if(n.mode==='funnel'){nonnegative('budget');positive('cpm');for(const f of ['ctr','install_rate','activation_rate'])probability(f);}
 const key=JSON.stringify([n.date,n.source,n.channel]);if(keys.has(key))issue(issues,'error',row,'同一日期、来源及渠道出现多行；请先合并，避免重复计算。');keys.add(key);rows.push(n);
 });
 const dates=[...new Set(rows.filter(r=>validDate(r.date)).map(r=>r.date))].sort(),organicDates=new Set(rows.filter(r=>r.source==='organic').map(r=>r.date));if(dates.length){const span=(Date.parse(dates.at(-1))-Date.parse(dates[0]))/86400000+1;if(span>dates.length)issue(issues,'warning',0,'计划日期不连续，缺失日期不代表零投放；请确认覆盖范围。');if(dates.some(d=>!organicDates.has(d)))issue(issues,'warning',0,'部分日期未提供自然新增；合计只覆盖已填写来源，不代表完整新增计划。');}
 if(!issues.some(x=>x.level==='error'))calculatePlan(rows).forEach((r,i)=>{if(!Number.isFinite(r.estimated_new_users)||r.estimated_new_users>1e12||r.budget>1e12||[r.impressions,r.clicks,r.installs].some(v=>v!==null&&(!Number.isFinite(v)||v>1e15)))issue(issues,'error',i+2,'测算数量超出可用范围，请核对预算、成本或金额单位。');});
 return {rows,issues,valid:!issues.some(x=>x.level==='error'),dates};
}
export function calculatePlan(rows,{costFactor=1,activationFactor=1}={}){
 if(!Number.isFinite(costFactor)||costFactor<=0||!Number.isFinite(activationFactor)||activationFactor<0)throw Error('情景参数无效。');
 return rows.map(r=>{let impressions=null,clicks=null,installs=null,newUsers,clipped=false;
 if(r.mode==='direct')newUsers=r.new_users;else {const activation=Math.min(1,r.activation_rate*activationFactor);clipped=r.activation_rate*activationFactor>1;if(r.mode==='cpi')installs=r.budget/(r.cpi*costFactor);else{impressions=r.budget/(r.cpm*costFactor)*1000;clicks=impressions*r.ctr;installs=clicks*r.install_rate;}newUsers=installs*activation;}
 if(!Number.isFinite(newUsers))newUsers=Infinity;return {...r,impressions,clicks,installs,estimated_new_users:newUsers,clipped,budget:r.mode==='direct'?0:r.budget};});
}
export function summarizePlan(calculated){const map=new Map();for(const r of calculated){if(!map.has(r.date))map.set(r.date,{date:r.date,budget:0,paid_new:0,organic_new:0,total_new:0});const d=map.get(r.date);d.budget+=r.budget;d[r.source==='paid'?'paid_new':'organic_new']+=r.estimated_new_users;d.total_new+=r.estimated_new_users;}return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));}
export function summarizeHistory(rows){const map=new Map();for(const r of rows){if(!map.has(r.date))map.set(r.date,{date:r.date,total:0});map.get(r.date).total+=r.active_users;}return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));}
export function demoData(){const history=[],plan=[],segments=[['活跃用户',40000],['潜在活跃用户',12500],['沉默用户',4200],['流失用户',900]];for(let i=0;i<84;i++){const date=addDays('2026-09-01',i),week=new Date(date+'T00:00:00Z').getUTCDay(),season=week===0||week===6?.84:1;for(let j=0;j<segments.length;j++)for(const [platform,factor] of [['Android',.62],['iOS',.38]])history.push({date,segment:segments[j][0],active_users:Math.round(segments[j][1]*factor*season*(1+i*.002)*(1+.035*Math.sin(i*1.1+j))*(i===75&&platform==='Android'?.83:1)),platform});}
 for(let i=0;i<30;i++){const date=addDays('2026-11-24',i);plan.push({date,channel:'Meta',source:'paid',mode:'cpi',budget:8000+i*50,cpi:16,activation_rate:.7});plan.push({date,channel:'TikTok',source:'paid',mode:'funnel',budget:5000,cpm:40,ctr:.025,install_rate:.18,activation_rate:.65});plan.push({date,channel:'自然渠道',source:'organic',mode:'direct',new_users:600+Math.round(i*2)});}return {history,plan};}
