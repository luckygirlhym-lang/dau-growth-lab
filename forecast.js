import {addDays,validDate,numeric,rate,demoData,calculatePlan,summarizePlan} from './core.js';

export const CURVE_FIELDS=['curve_type','segment','source','day_offset','active_probability','as_of_date'];
export const METHODS={seasonal_naive:'上周同日基线',weekday_mean:'近四周同星期均值',damped_trend:'同星期衰减趋势'};
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
const daysBetween=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000;
const fail=(condition,message)=>{if(!condition)throw Error(message);};

// Use explicit complete calendar/segment observations. Never impute missing counts as zero.
export function prepareSeries(rows,{minDays=56}={}){
 fail(rows.length>0,'请先导入历史数据。');
 const dates=[...new Set(rows.map(r=>r.date))].sort(),segments=[...new Set(rows.map(r=>r.segment))];
 fail(dates.every(validDate),'历史中存在无效日期。');
 fail(daysBetween(dates[0],dates.at(-1))+1===dates.length,'历史日期不连续。请核对缺失日期，不能将缺失值直接当作 0。');
 fail(dates.length>=minDays,`至少需要 ${minDays} 天完整历史；当前 ${dates.length} 天。`);
 const map=new Map();for(const r of rows){fail(Number.isSafeInteger(r.active_users)&&r.active_users>=0,'历史活跃人数存在无效值。');const key=JSON.stringify([r.date,r.segment]);map.set(key,(map.get(key)||0)+r.active_users);}
 const series=new Map();for(const segment of segments){const points=dates.map(date=>{const key=JSON.stringify([date,segment]);fail(map.has(key),`${date} 缺少“${segment}”分层。请确认真实为零后显式填写 0。`);return {date,value:map.get(key)};});series.set(segment,points);}
 return {dates,segments,series,origin:dates.at(-1)};
}

export function predictSeries(points,horizon,method='damped_trend'){
 fail(Number.isInteger(horizon)&&horizon>0&&horizon<=30,'预测周期须为 1—30 天。');
 fail(Object.hasOwn(METHODS,method),'预测方法无效。');fail(points.length>=28,'单层至少需要四周完整历史。');
 const byDay=Array.from({length:7},()=>[]);points.forEach(p=>byDay[weekday(p.date)].push(p));const origin=points.at(-1).date;
 return Array.from({length:horizon},(_,i)=>{
  const date=addDays(origin,i+1),all=byDay[weekday(date)];let predicted;
  if(method==='seasonal_naive')predicted=all.at(-1).value;
  else if(method==='weekday_mean')predicted=mean(all.slice(-4).map(p=>p.value));
  else {
   const recent=all.slice(-8),ys=recent.map(p=>p.value),mx=(recent.length-1)/2,my=mean(ys);
   let numerator=0,denominator=0;ys.forEach((y,j)=>{numerator+=(j-mx)*(y-my);denominator+=(j-mx)**2;});
   const slope=denominator?numerator/denominator:0,level=my+slope*((recent.length-1)-mx);
   const steps=daysBetween(recent.at(-1).date,date)/7,damping=.85;
   const dampedSteps=damping*(1-damping**steps)/(1-damping);
   predicted=level+slope*dampedSteps;
  }
  return {date,predicted:Math.max(0,predicted)};
 });
}

export function timeSeriesForecast(prepared,horizon,method='damped_trend'){
 const detail=[];for(const [segment,points] of prepared.series){for(const r of predictSeries(points,horizon,method))detail.push({...r,segment,origin:prepared.origin,method});}
 return {detail,daily:aggregatePrediction(detail),origin:prepared.origin,method};
}

function aggregatePrediction(detail){const map=new Map();for(const r of detail){if(!map.has(r.date))map.set(r.date,{date:r.date,predicted:0});map.get(r.date).predicted+=r.predicted;}return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));}

function accuracy(rows){const abs=rows.reduce((s,r)=>s+Math.abs(r.predicted-r.actual),0),actual=rows.reduce((s,r)=>s+r.actual,0);return {wape:actual>0?abs/actual:null,mae:rows.length?abs/rows.length:null,bias:actual>0?rows.reduce((s,r)=>s+r.predicted-r.actual,0)/actual:null,observations:rows.length};}

// Holdout windows do not overlap. Every forecast is fitted only on dates <= origin.
export function rollingBacktest(prepared,horizon,method='damped_trend',{maxFolds=4,minTrain=42}={}){
 fail(Number.isInteger(horizon)&&horizon>0&&horizon<=30,'回测周期须为 1—30 天。');
 const n=prepared.dates.length,detail=[],folds=[],daily=[];
 for(let f=0;f<maxFolds;f++){
  const trainCount=n-horizon*(f+1);if(trainCount<minTrain)break;
  const origin=prepared.dates[trainCount-1],fold=f+1,dailyMap=new Map();
  for(const [segment,points] of prepared.series){
   const training=points.slice(0,trainCount),pred=predictSeries(training,horizon,method),baseline=predictSeries(training,horizon,'seasonal_naive');
   pred.forEach((r,k)=>{const actual=points[trainCount+k].value,row={fold,origin,date:r.date,segment,actual,predicted:r.predicted,benchmark:baseline[k].predicted,method};detail.push(row);if(!dailyMap.has(r.date))dailyMap.set(r.date,{fold,origin,date:r.date,actual:0,predicted:0,benchmark:0});const d=dailyMap.get(r.date);d.actual+=actual;d.predicted+=r.predicted;d.benchmark+=baseline[k].predicted;});
  }
  const local=[...dailyMap.values()];daily.push(...local);folds.push({fold,origin,train_days:trainCount,test_start:local[0].date,test_end:local.at(-1).date,...accuracy(local),benchmark_wape:accuracy(local.map(r=>({...r,predicted:r.benchmark}))).wape});
 }
 fail(folds.length>0,`当前历史不足以进行 ${horizon} 天回测；至少需要 ${minTrain+horizon} 天，且训练段至少 ${minTrain} 天。`);
 const metrics=accuracy(daily),benchmark=accuracy(daily.map(r=>({...r,predicted:r.benchmark})));
 const bySegment=prepared.segments.map(segment=>{const selected=detail.filter(r=>r.segment===segment);return {segment,...accuracy(selected),benchmark_wape:accuracy(selected.map(r=>({...r,predicted:r.benchmark}))).wape};});
 return {method,horizon,detail,daily:daily.sort((a,b)=>a.date.localeCompare(b.date)),folds,metrics,benchmark,bySegment};
}

export function changeContribution(rows,date,dimension='segment'){
 fail(validDate(date),'请选择有效的分析日期。');fail(['segment','platform','channel','app_version'].includes(dimension),'拆解维度无效。');
 const referenceDates=[7,14,21,28].map(n=>addDays(date,-n)),dates=new Set(rows.map(r=>r.date));
 fail(dates.has(date),'历史数据中没有这个分析日期。');for(const d of referenceDates)fail(dates.has(d),`基线缺少 ${d}，需要过去四个同星期的完整数据。`);
 const groups=new Map(),references=new Set(referenceDates);
 for(const r of rows){if(r.date!==date&&!references.has(r.date))continue;const group=String(r[dimension]||'未提供');if(!groups.has(group))groups.set(group,{group,actual:0,baseline:0});const g=groups.get(group);if(r.date===date)g.actual+=r.active_users;else g.baseline+=r.active_users/4;}
 const detail=[...groups.values()].map(r=>({...r,delta:r.actual-r.baseline,change_rate:r.baseline>0?(r.actual-r.baseline)/r.baseline:null})).sort((a,b)=>a.delta-b.delta),actual=detail.reduce((s,r)=>s+r.actual,0),baseline=detail.reduce((s,r)=>s+r.baseline,0),delta=actual-baseline;
 return {date,dimension,referenceDates,detail,actual,baseline,delta,change_rate:baseline>0?delta/baseline:null};
}

export function validateCurves(parsed){
 const issues=[],rows=[],keys=new Set(),asOf=new Set();
 const issue=(row,text)=>issues.push({level:'error',row,text});
 for(const f of ['curve_type','day_offset','active_probability','as_of_date'])if(!parsed.headers.includes(f))issue(0,`缺少必填字段：${f}`);
 const typeMap={'存量':'existing','新增':'new'},sourceMap={'投放':'paid','自然':'organic'};
 parsed.rows.forEach((r,i)=>{const row=i+2,n={...r,curve_type:typeMap[r.curve_type]||String(r.curve_type||'').toLowerCase(),segment:String(r.segment||''),source:sourceMap[r.source]||String(r.source||'').toLowerCase(),day_offset:numeric(r.day_offset),active_probability:rate(r.active_probability),as_of_date:String(r.as_of_date||'')};
  if(!['existing','new'].includes(n.curve_type))issue(row,'curve_type 须为 existing（存量）或 new（新增）。');
  if(n.curve_type==='existing'&&(!n.segment||n.source))issue(row,'存量曲线填写 segment，并将 source 留空。');
  if(n.curve_type==='new'&&(!['paid','organic'].includes(n.source)||n.segment))issue(row,'新增曲线填写 source=paid/organic，并将 segment 留空。');
  if(!Number.isInteger(n.day_offset)||n.day_offset<0||n.day_offset>365)issue(row,'day_offset 必须为 0—365 的整数。');
  if(!Number.isFinite(n.active_probability)||n.active_probability<0||n.active_probability>1)issue(row,'active_probability 须为 0—1，支持 0.5 或 50%。');
  if(!validDate(n.as_of_date))issue(row,'as_of_date 应为 YYYY-MM-DD。');else asOf.add(n.as_of_date);
  if(n.curve_type==='new'&&n.day_offset===0&&n.active_probability!==1)issue(row,'新增首次活跃当天的概率须为 1。');
  const key=JSON.stringify([n.curve_type,n.segment,n.source,n.day_offset]);if(keys.has(key))issue(row,'曲线人群与 day_offset 重复。');keys.add(key);rows.push(n);
 });
 if(asOf.size>1)issue(0,'一个文件仅支持一个预测起点 as_of_date。请勿混入不同历史版本。');
 return {rows,issues,valid:issues.length===0,dates:[...asOf],segments:[...new Set(rows.filter(r=>r.curve_type==='existing').map(r=>r.segment))]};
}

export function retentionForecast(historyRows,planRows,curveRows,horizon,{costFactor=1,activationFactor=1,probabilityLift=0}={}){
 fail(Number.isInteger(horizon)&&horizon>0&&horizon<=30,'预测周期须为 1—30 天。');fail(Number.isFinite(probabilityLift)&&probabilityLift>=-.5&&probabilityLift<=.5,'活跃概率调整须为 -50%—50%。');
 const origin=[...new Set(historyRows.map(r=>r.date))].sort().at(-1),latest=historyRows.filter(r=>r.date===origin);fail(latest.length>0,'请提供预测起点的用户池数据。');
 const stocks=new Map();for(const r of latest){fail(Number.isSafeInteger(r.segment_users)&&r.segment_users>=r.active_users,`预测起点的“${r.segment}”缺少有效 segment_users。请填写包括未活跃用户在内的用户池规模。`);stocks.set(r.segment,(stocks.get(r.segment)||0)+r.segment_users);}
 fail(curveRows.length>0,'请上传活跃概率曲线。');fail(curveRows.every(r=>r.as_of_date===origin),`曲线 as_of_date 必须与历史最后一天 ${origin} 一致。`);
 const existing=new Map(),fresh=new Map();for(const r of curveRows){const map=r.curve_type==='existing'?existing:fresh,key=JSON.stringify([r.curve_type==='existing'?r.segment:r.source,r.day_offset]);fail(!map.has(key),'曲线键重复。');fail(Number.isFinite(r.active_probability)&&r.active_probability>=0&&r.active_probability<=1,'曲线概率须在 0—1。');map.set(key,r.active_probability);}
 const probability=(map,group,offset,dayZero=false)=>{const key=JSON.stringify([group,offset]);fail(map.has(key),`缺少“${group}”第 ${offset} 天活跃概率；本版不会自动插值或外推。`);const p=map.get(key);if(dayZero){fail(p===1,'新增第 0 天概率须为 1。');return 1;}return Math.min(1,p*(1+probabilityLift));};
 for(const [segment] of stocks)for(let k=1;k<=horizon;k++)probability(existing,segment,k);
 const future=planRows.filter(r=>r.date>origin&&r.date<=addDays(origin,horizon));
 const coverage=new Map();for(const r of future){if(!coverage.has(r.date))coverage.set(r.date,new Set());coverage.get(r.date).add(r.source);}
 for(let k=1;k<=horizon;k++){const date=addDays(origin,k);for(const source of ['paid','organic'])fail(coverage.get(date)?.has(source),`${date} 缺少 ${source==='paid'?'投放':'自然'}新增计划；确认为零时请显式填写 0。`);}
 const planDaily=summarizePlan(calculatePlan(future,{costFactor,activationFactor}));
 for(const source of ['paid','organic'])for(let k=0;k<horizon;k++)probability(fresh,source,k,k===0);
 const detail=[],daily=[];
 for(let k=1;k<=horizon;k++){
  const date=addDays(origin,k);let existingUsers=0,paidUsers=0,organicUsers=0;
  for(const [segment,stock] of stocks){const p=probability(existing,segment,k),predicted=stock*p;existingUsers+=predicted;detail.push({date,component:'existing',segment,cohort_date:origin,day_offset:k,population:stock,probability:p,predicted});}
  for(const cohort of planDaily){if(cohort.date>date)break;const age=daysBetween(cohort.date,date);for(const source of ['paid','organic']){const count=cohort[source==='paid'?'paid_new':'organic_new'],p=probability(fresh,source,age,age===0),predicted=count*p;if(source==='paid')paidUsers+=predicted;else organicUsers+=predicted;detail.push({date,component:source,segment:'',cohort_date:cohort.date,day_offset:age,population:count,probability:p,predicted});}}
  daily.push({date,existing:existingUsers,paid_contribution:paidUsers,organic_contribution:organicUsers,predicted:existingUsers+paidUsers+organicUsers});
 }
 return {origin,method:'retention',daily,detail};
}

export function retentionDemo(){
 const d=demoData(),rates={'活跃用户':.62,'潜在活跃用户':.23,'沉默用户':.06,'流失用户':.012};
 d.history=d.history.map(r=>({...r,segment_users:Math.ceil(r.active_users/rates[r.segment])}));const origin=d.history.at(-1).date,curves=[];
 for(const [segment,p] of Object.entries(rates))for(let k=1;k<=30;k++)curves.push({curve_type:'existing',segment,source:'',day_offset:k,active_probability:Math.min(1,p*Math.exp(-k/250)*(weekday(addDays(origin,k))===0||weekday(addDays(origin,k))===6?.86:1)),as_of_date:origin});
 for(const source of ['paid','organic'])for(let k=0;k<=30;k++)curves.push({curve_type:'new',segment:'',source,day_offset:k,active_probability:k===0?1:Math.min(1,Math.pow(1+k*.32,-.58)*(source==='organic'?1.06:1)),as_of_date:origin});
 return {...d,curves};
}
