import {addDays,validDate,numeric} from './core.js';
import {retentionDemo} from './forecast.js';

export const DIMENSIONS=['segment','platform','channel','app_version','os_version','country','user_type'];
export const DIMENSION_NAMES={segment:'用户分层',platform:'Android / iOS',channel:'渠道',app_version:'产品版本',os_version:'OS 版本',country:'国家地区',user_type:'新老用户'};
export const METRIC_FIELDS=['date','entity','metric','value','unit','scope',...DIMENSIONS,'source_url'];
export const EVENT_FIELDS=['date','end_date','event_type','title',...DIMENSIONS,'evidence_url','notes'];
export const METRICS={
 dau_reference:['独立参考 DAU','users'],new_active_users:['首次活跃人数','users'],continuing_active_users:['昨日延续活跃人数','users'],returning_active_users:['回流活跃人数','users'],
 spend:['实际投放费用','CNY'],impressions:['实际曝光','count'],clicks:['实际点击','count'],installs:['实际安装','count'],first_activations:['安装批次首次激活','users'],
 push_sent:['Push 发送','count'],push_delivered:['Push 送达','count'],push_opened:['Push 打开','count'],login_attempts:['登录尝试','count'],login_successes:['登录成功','count'],
 sessions:['会话数','sessions'],crash_sessions:['崩溃会话','sessions'],requests:['请求数','requests'],request_errors:['失败请求','requests'],
 d1_cohort_users:['昨日首活批次人数','users'],d1_retained_users:['昨日首活批次今日活跃','users'],d7_cohort_users:['七日前首活批次人数','users'],d7_retained_users:['七日前首活批次今日活跃','users'],
 loaded_partitions:['已到齐分区','count'],expected_partitions:['应到分区','count'],dau:['外部 DAU / 活跃指数','users']
};
export const EVENT_TYPES={release:'版本 / 功能发布',incident:'服务故障',push:'Push / 召回调整',campaign:'投放 / 运营活动',tracking:'埋点 / 口径变更',holiday:'节假日 / 季节',industry:'行业变化',competitor:'竞品动态',other:'其他记录'};
export const RATE_RULES=[
 ['点击率','clicks','impressions','down',.003,'acquisition'],['安装转化率','installs','clicks','down',.03,'acquisition'],['首次激活率','first_activations','installs','down',.03,'acquisition'],
 ['Push 送达率','push_delivered','push_sent','down',.03,'push'],['Push 打开率','push_opened','push_delivered','down',.01,'push'],
 ['登录成功率','login_successes','login_attempts','down',.03,'stability'],['崩溃会话率','crash_sessions','sessions','up',.005,'stability'],['请求失败率','request_errors','requests','up',.01,'stability'],
 ['D1 留存率','d1_retained_users','d1_cohort_users','down',.03,'retention'],['D7 留存率','d7_retained_users','d7_cohort_users','down',.03,'retention']
];
const mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
const sum=(rows,key='active_users')=>rows.reduce((s,r)=>s+(Number.isFinite(r[key])?r[key]:0),0);
const fail=(condition,message)=>{if(!condition)throw Error(message);};
export function safeHttp(s){if(!s)return true;try{return ['http:','https:'].includes(new URL(s).protocol);}catch{return false;}}
const scopeName=s=>DIMENSIONS.filter(k=>s[k]).map(k=>`${DIMENSION_NAMES[k]}=${s[k]}`).join(' / ')||'全量';
const scopeKey=s=>JSON.stringify(DIMENSIONS.map(k=>String(s[k]||'')));
const matchScope=(r,s)=>DIMENSIONS.every(k=>!s[k]||r[k]===s[k]);
const refs=date=>[7,14,21,28].map(n=>addDays(date,-n));

export function validateMetrics(parsed){
 const issues=[],rows=[],keys=new Set(),units=new Map();const error=(row,text)=>issues.push({level:'error',row,text});
 for(const f of ['date','metric','value'])if(!parsed.headers.includes(f))error(0,`缺少必填字段：${f}`);
 parsed.rows.forEach((r,i)=>{const n={...r,date:r.date||'',entity:r.entity||'self',metric:r.metric||'',value:numeric(r.value),unit:r.unit||METRICS[r.metric]?.[1]||'',scope:r.scope||'',source_url:r.source_url||''};for(const k of DIMENSIONS)n[k]=r[k]||'';
  if(!validDate(n.date))error(i+2,'日期应为 YYYY-MM-DD。');if(!n.metric)error(i+2,'metric 不能为空。');if(!Number.isFinite(n.value)||n.value<0)error(i+2,'value 须为非负数。');
  if(n.entity==='self'&&Object.hasOwn(METRICS,n.metric)&&!['spend','dau'].includes(n.metric)&&!Number.isSafeInteger(n.value))error(i+2,'人数与次数指标须为非负安全整数。');
  if(!safeHttp(n.source_url))error(i+2,'source_url 仅接受完整的 http/https 来源链接。');
  const key=JSON.stringify([n.date,n.entity,n.metric,n.scope,scopeKey(n)]);if(keys.has(key))error(i+2,'同日期、主体、指标和范围重复，不能叠加总计与明细。');keys.add(key);
  const series=JSON.stringify([n.entity,n.metric,n.scope,scopeKey(n)]);if(units.has(series)&&units.get(series)!==n.unit)error(i+2,'同一指标序列的单位不一致。');units.set(series,n.unit);rows.push(n);
 });
 if(!issues.length){const index=buildMetricIndex(rows);for(const r of rows)if(r.entity==='self')for(const [,num,den] of RATE_RULES)if(r.metric===num){const d=index.get(r.date,den,r,'self');if(d.present){if(r.scope!==d.scope||!(r.unit===d.unit||(r.unit===METRICS[num][1]&&d.unit===METRICS[den][1])))error(0,`${r.date} ${scopeName(r)}：${num} 与 ${den} 的统计范围须一致，单位须与指标定义兼容。`);if(r.value>d.value)error(0,`${r.date} ${scopeName(r)}：${num} 不能大于 ${den}。`);}}}
 const unknown=[...new Set(rows.filter(r=>r.entity==='self'&&!Object.hasOwn(METRICS,r.metric)).map(r=>r.metric))];if(unknown.length)issues.push({level:'warning',row:0,text:`${unknown.length} 种自有指标未配置诊断规则，会保留数据但不推断其含义。`});
 return {rows,issues,valid:!issues.some(i=>i.level==='error'),dates:[...new Set(rows.filter(r=>validDate(r.date)).map(r=>r.date))].sort()};
}

export function validateEvents(parsed){
 const issues=[],rows=[],keys=new Set();const error=(row,text)=>issues.push({level:'error',row,text});
 for(const f of ['date','event_type','title'])if(!parsed.headers.includes(f))error(0,`缺少必填字段：${f}`);
 const aliases={'版本发布':'release','故障':'incident','推送':'push','投放':'campaign','埋点':'tracking','节假日':'holiday','行业':'industry','竞品':'competitor','其他':'other'};
 parsed.rows.forEach((r,i)=>{const n={...r,date:r.date||'',end_date:r.end_date||r.date||'',event_type:aliases[r.event_type]||r.event_type||'',title:r.title||'',evidence_url:r.evidence_url||'',notes:r.notes||''};for(const k of DIMENSIONS)n[k]=r[k]||'';
  if(!validDate(n.date)||!validDate(n.end_date)||n.end_date<n.date)error(i+2,'事件开始 / 结束日期无效，结束时间不能早于开始。');if(!Object.hasOwn(EVENT_TYPES,n.event_type))error(i+2,'event_type 不在支持范围内。');if(!n.title)error(i+2,'事件标题不能为空。');if(!safeHttp(n.evidence_url))error(i+2,'evidence_url 仅接受 http/https 链接。');
  const key=JSON.stringify([n.date,n.event_type,n.title,scopeKey(n)]);if(keys.has(key))error(i+2,'同一事件记录重复。');keys.add(key);rows.push(n);
 });return {rows,issues,valid:!issues.some(i=>i.level==='error'),dates:[...new Set(rows.filter(r=>validDate(r.date)).map(r=>r.date))].sort()};
}

// Read a single exact scope; never add a global total to platform/version details.
export function buildMetricIndex(rows){const map=new Map();for(const r of rows){const key=JSON.stringify([r.date,r.entity||'self',r.metric,scopeKey(r)]);if(!map.has(key))map.set(key,[]);map.get(key).push(r);}
 return {rows,get(date,metric,scope={},entity='self'){const candidates=map.get(JSON.stringify([date,entity,metric,scopeKey(scope)]))||[];if(candidates.length!==1)return {present:false,reason:candidates.length?'存在多个统计范围，未合并':'未提供'};const r=candidates[0];return {...r,present:Number.isFinite(r.value)};}};
}

export function buildHistoryIndex(rows){
 fail(rows.length>0,'请先上传每日分层活跃人数。');const byDate=new Map(),segments=new Set(),available=DIMENSIONS.filter(k=>rows.some(r=>r[k]));
 for(const r of rows){fail(validDate(r.date)&&Number.isSafeInteger(r.active_users)&&r.active_users>=0,'历史数据存在无效日期或人数。');if(!byDate.has(r.date))byDate.set(r.date,[]);byDate.get(r.date).push(r);segments.add(r.segment);}
 const dates=[...byDate.keys()].sort(),days=new Map();for(const date of dates){const local=byDate.get(date),have=new Set(local.map(r=>r.segment));days.set(date,{date,actual:sum(local),complete:[...segments].every(s=>have.has(s)),rows:local});}
 return {rows,byDate,days,dates,segments:[...segments],available};
}

export function contribution(index,date,dimensions){
 const refDates=refs(date);fail(index.days.get(date)?.complete,'分析日期缺少分层或没有数据。');for(const d of refDates)fail(index.days.get(d)?.complete,`基线日期 ${d} 缺失或分层不完整；不按 0 处理。`);
 const groups=new Map();const add=(row,current)=>{const values=dimensions.map(k=>row[k]||'未提供'),key=JSON.stringify(values);if(!groups.has(key))groups.set(key,{group:values.join(' / '),values,scope:Object.fromEntries(dimensions.filter((k,i)=>values[i]!=='未提供').map((k)=>[k,row[k]])),actual:0,baseline:0,current_pool:0,baseline_pool:0,pool_known:true});const g=groups.get(key),div=current?1:4;g[current?'actual':'baseline']+=row.active_users/div;if(Number.isSafeInteger(row.segment_users))g[current?'current_pool':'baseline_pool']+=row.segment_users/div;else g.pool_known=false;};
 index.days.get(date).rows.forEach(r=>add(r,true));for(const d of refDates)index.days.get(d).rows.forEach(r=>add(r,false));
 return [...groups.values()].map(g=>{const delta=g.actual-g.baseline,baseRate=g.pool_known&&g.baseline_pool>0?g.baseline/g.baseline_pool:null,currentRate=g.pool_known&&g.current_pool>0?g.actual/g.current_pool:null;let volume_effect=null,rate_effect=null;
  if(baseRate!==null){volume_effect=(g.current_pool-g.baseline_pool)*baseRate;rate_effect=g.current_pool===0?0:(currentRate-baseRate)*g.current_pool;}
  const structural=g.baseline===0||(volume_effect!==null&&Math.abs(volume_effect)>=Math.abs(delta)*.8&&(g.current_pool===0||Math.abs((currentRate??0)-baseRate)<.02));
  return {...g,current_pool:g.pool_known?g.current_pool:null,baseline_pool:g.pool_known?g.baseline_pool:null,delta,change_rate:g.baseline>0?delta/g.baseline:null,baseline_rate:baseRate,current_rate:currentRate,volume_effect,rate_effect,kind:structural?'结构变化':'活跃变化'};
 }).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
}

export function scanAnomalies(rows,{relative=.05,absolute=500,includeLocal=true}={}){
 fail(Number.isFinite(relative)&&relative>=0&&Number.isFinite(absolute)&&absolute>=0,'异动阈值须为非负数。');const index=buildHistoryIndex(rows),entries=[];
 for(const date of index.dates){const day=index.days.get(date),refDates=refs(date);if(!day.complete||!refDates.every(d=>index.days.get(d)?.complete)){entries.push({date,actual:day.actual,eligible:false,reason:'缺少完整分析日或四个同星期基线'});continue;}
  const baseline=mean(refDates.map(d=>index.days.get(d).actual)),delta=day.actual-baseline,change_rate=baseline>0?delta/baseline:null;
  const totalHit=Math.abs(delta)>=absolute&&(change_rate===null?delta!==0:Math.abs(change_rate)>=relative),locals=[],structures=[];
  if(includeLocal)for(const dim of index.available)for(const g of contribution(index,date,[dim]))if(Math.abs(g.delta)>=absolute&&(g.change_rate===null?g.delta!==0:Math.abs(g.change_rate)>=relative)){const row={dimension:dim,...g};if(g.kind==='结构变化')structures.push(row);else locals.push(row);}
  locals.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));structures.sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta));
  entries.push({date,eligible:true,actual:day.actual,baseline,delta,change_rate,totalHit,hit:totalHit||locals.length>0,locals:locals.slice(0,20),localCount:locals.length,structures:structures.slice(0,20),structureCount:structures.length,kind:totalHit?'总体异动':locals.length?'局部异动':'未触发',referenceDates:refDates});
 }
 return {index,entries,hits:entries.filter(r=>r.hit),skipped:entries.filter(r=>!r.eligible),config:{relative,absolute,includeLocal}};
}

function scopeContribution(index,date,scope){const current=index.days.get(date)?.rows.filter(r=>matchScope(r,scope))||[],baseline=refs(date).map(d=>sum((index.days.get(d)?.rows||[]).filter(r=>matchScope(r,scope))));return {actual:sum(current),baseline:mean(baseline),delta:sum(current)-mean(baseline)};}

export function assessQuality(index,date,metrics){
 const checks=[],push=(id,status,text)=>checks.push({id,status,text});let blocked=false;
 for(const d of [date,...refs(date)])if(!index.days.get(d)?.complete){push('calendar-'+d,'不通过',`${d} 缺失或分层不完整`);blocked=true;}
 if(!blocked)push('calendar','通过','分析日与四个同星期基线均存在且覆盖全部分层。');
 let referenceCount=0,referenceBad=false,partitionCount=0,partitionBad=false;
 for(const day of [date,...refs(date)]){
  const reference=metrics.get(day,'dau_reference');if(reference.present&&index.days.has(day)){referenceCount++;const delta=reference.value-index.days.get(day).actual;if(Math.abs(delta)>1){push('reference-'+day,'不通过',`${day} 汇总 DAU 与参考源相差 ${delta.toFixed(0)} 人，需要先核对口径或到齐情况。`);blocked=true;referenceBad=true;}}
  const loaded=metrics.get(day,'loaded_partitions'),expected=metrics.get(day,'expected_partitions');if(loaded.present&&expected.present){partitionCount++;if(loaded.value!==expected.value){push('partitions-'+day,'不通过',`${day} 数据分区到齐 ${loaded.value} / ${expected.value}，业务原因分析暂停。`);blocked=true;partitionBad=true;}}
 }
 if(!referenceBad)push('reference',referenceCount===5?'通过':'待补充',referenceCount===5?'分析日与四个基线日的 DAU 均与导入参考值一致；未独立连接源系统验证。':`仅 ${referenceCount} / 5 个日期提供了参考 DAU，真实性核对不完整。`);
 if(!partitionBad)push('partitions',partitionCount===5?'通过':'待补充',partitionCount===5?'分析日与四个基线日的数据分区均到齐。':`仅 ${partitionCount} / 5 个日期提供了分区到齐指标。`);
 for(const d of [date,...refs(date)]){const components=['new_active_users','continuing_active_users','returning_active_users'].map(m=>metrics.get(d,m));if(components.every(v=>v.present)&&index.days.has(d)){const diff=components.reduce((s,v)=>s+v.value,0)-index.days.get(d).actual;if(Math.abs(diff)>1){push('lifecycle-'+d,'不通过',`${d} 首次活跃、昨日延续活跃和回流人数之和与 DAU 不一致。`);blocked=true;}}}
 if(!checks.some(r=>r.id.startsWith('lifecycle-'))){const c=['new_active_users','continuing_active_users','returning_active_users'].map(m=>metrics.get(date,m));push('lifecycle',c.every(v=>v.present)?'通过':'待补充',c.every(v=>v.present)?'当日生命周期人数与 DAU 可加总。':'未提供完整的新增 / 延续 / 回流实际人数，不能从分层边际人数反推。');}
 if(index.days.has(date))for(const dim of index.available){const missing=sum(index.days.get(date).rows.filter(r=>!r[dim])),total=index.days.get(date).actual;if(total>0&&missing/total>.2)push('missing-'+dim,'提醒',`${DIMENSION_NAMES[dim]} 超过 20% 活跃人数缺少维度值，分组定位需谨慎。`);}
 return {blocked,checks};
}

function comparableMetric(index,date,metric,scope={},entity='self'){
 const current=index.get(date,metric,scope,entity),past=refs(date).map(d=>index.get(d,metric,scope,entity));if(!current.present||past.some(v=>!v.present))return null;
 if(past.some(v=>v.unit!==current.unit||v.scope!==current.scope))return null;
 const baseline=mean(past.map(r=>r.value));return {actual:current.value,baseline,delta:current.value-baseline,change_rate:baseline>0?(current.value-baseline)/baseline:null,unit:current.unit,source_url:current.source_url,scope:current.scope};
}

export function operationalEvidence(metrics,date,scopes=[{}]){
 const result=[];let counter=0;for(const scope of scopes){
  for(const [name,num,den,direction,threshold,category] of RATE_RULES){const n=comparableMetric(metrics,date,num,scope),d=comparableMetric(metrics,date,den,scope);if(!n||!d||n.scope!==d.scope||!(n.unit===d.unit||(n.unit===METRICS[num][1]&&d.unit===METRICS[den][1]))||d.actual<=0||d.baseline<=0)continue;const actual=n.actual/d.actual,baseline=n.baseline/d.baseline,delta=actual-baseline,small=d.actual<30||d.baseline<30;
   result.push({id:'M'+(++counter),name,scope,scope_name:scopeName(scope),category,actual,baseline,delta,unit:'ratio',denominator:d.actual,baseline_denominator:d.baseline,flag:!small&&(direction==='down'?delta<=-threshold:delta>=threshold),small,threshold,source_url:n.source_url||d.source_url});}
  for(const metric of ['spend','impressions','clicks','installs','first_activations','new_active_users','continuing_active_users','returning_active_users','push_sent']){const v=comparableMetric(metrics,date,metric,scope);if(!v)continue;result.push({id:'M'+(++counter),name:METRICS[metric][0],metric,scope,scope_name:scopeName(scope),category:metric.startsWith('push')?'push':metric==='continuing_active_users'||metric==='returning_active_users'?'lifecycle':'acquisition',...v,flag:v.baseline>0&&v.change_rate<=-.15&&Math.abs(v.delta)>=(metric==='spend'?1:100),threshold:.15});}
 }return result;
}

export function diagnoseAnomaly(rows,date,{metricsRows=[],eventsRows=[],relative=.05,absolute=500}={}){
 const index=buildHistoryIndex(rows),metrics=buildMetricIndex(metricsRows),quality=assessQuality(index,date,metrics),refDates=refs(date),eligible=index.days.get(date)?.complete&&refDates.every(d=>index.days.get(d)?.complete);
 const actual=index.days.get(date)?.actual??null,baseline=eligible?mean(refDates.map(d=>index.days.get(d).actual)):null,delta=baseline===null?null:actual-baseline;
 const dimensions=eligible?index.available.map(d=>({dimension:d,groups:contribution(index,date,[d])})):[];
 const pairs=[['platform','app_version'],['platform','segment'],['channel','segment'],['platform','channel'],['platform','os_version'],['country','platform'],['app_version','segment']].filter(ds=>ds.every(d=>index.available.includes(d)));
 const intersections=eligible?pairs.map(ds=>({dimensions:ds,groups:contribution(index,date,ds)})):[];
 const candidates=[...intersections.flatMap(p=>p.groups),...dimensions.flatMap(p=>p.groups)].filter(g=>g.delta<0&&Object.keys(g.scope).length>0).sort((a,b)=>a.delta-b.delta);
 const priority=[...(intersections.find(p=>p.dimensions.join(',')==='platform,app_version')?.groups.filter(g=>g.delta<0).slice(0,2)||[]),...(dimensions.find(p=>p.dimension==='platform')?.groups.filter(g=>g.delta<0).slice(0,2)||[]),...candidates];
 const scopes=[{}],seen=new Set([scopeKey({})]);for(const g of priority){const key=scopeKey(g.scope);if(!seen.has(key)){seen.add(key);scopes.push(g.scope);}if(scopes.length>=15)break;}
 const evidence=eligible?operationalEvidence(metrics,date,scopes):[];
 const comparisons=[['较昨日',addDays(date,-1)],['较上周同日',addDays(date,-7)],['较去年同月同日',String(Number(date.slice(0,4))-1)+date.slice(4)]].map(([name,d])=>{const past=validDate(d)?index.days.get(d):null;return {name,date:d,available:!!past?.complete,baseline:past?.complete?past.actual:null,actual,change_rate:past?.complete&&past.actual>0?(actual-past.actual)/past.actual:null,reason:past?.complete?'':'缺少可比历史，不填充或推算'};});
 const events=eventsRows.filter(e=>e.date<=date&&(e.date>=addDays(date,-7)||e.end_date>=date)).map((e,i)=>{const scoped=eligible?scopeContribution(index,date,e):null;return {...e,id:'E'+(i+1),scope_name:scopeName(e),delta:scoped?.delta??null,aligned:scoped!==null&&(delta<0?scoped.delta<0:scoped.delta>0),source_status:e.evidence_url?'提供了来源链接，尚需核验':'未提供来源链接'};});
 const external=[];const externalKeys=new Map();for(const r of metricsRows)if(r.entity!=='self'&&r.metric==='dau')externalKeys.set(JSON.stringify([r.entity,scopeKey(r)]),r);
 for(const r of externalKeys.values()){const v=comparableMetric(metrics,date,'dau',r,r.entity);external.push({entity:r.entity,scope_name:r.scope||scopeName(r),available:!!v,...(v||{}),verified_context:!!v?.source_url&&!!r.scope,reason:v?'导入外部指标只作背景参照，不作为产品下降的因果证据':'缺少完整同窗口数据或单位 / 范围不一致'});}
 const hypotheses=[];if(!quality.blocked&&eligible){
  for(const [category,title,next] of [['stability','登录或稳定性问题待核查','按平台与版本核对登录失败、崩溃和请求日志，并比较未受影响人群。'],['retention','留存转弱待核查','核对成熟首活批次、用户质量与同期产品体验，区分渠道结构和留存变化。'],['push','Push 触达 / 召回变化待核查','核对发送计划、送达与打开链路，使用未触达人群或实验验证增量影响。'],['acquisition','获客规模或转化变化待核查','核对实际投放费用、曝光、点击、安装与首次激活，未来投放计划不能替代实际数据。']]){
   const matched=evidence.filter(e=>e.category===category&&e.flag);if(matched.length)hypotheses.push({title,evidence_ids:matched.map(e=>e.id),basis:matched.slice(0,4).map(e=>`${e.scope_name}：${e.name}`).join('；'),status:'数据线索，原因待验证',next});}
  const version=(intersections.find(p=>p.dimensions.includes('app_version'))?.groups||dimensions.find(p=>p.dimension==='app_version')?.groups||[]).filter(g=>g.delta<0);
  if(version.length){const g=version[0],related=events.filter(e=>e.event_type==='release'&&e.aligned&&matchScope(g.scope,e));hypotheses.push({title:g.kind==='结构变化'?'版本覆盖变化，需区分用户迁移':'版本相关体验问题待核查',evidence_ids:related.map(e=>e.id),basis:`${g.group} 净变化 ${g.delta.toFixed(0)} 人；${g.pool_known?'已提供用户池，可进一步拆分规模与活跃比例影响':'未提供用户池，无法区分版本覆盖和活跃比例变化'}。${related.length?'同窗存在匹配的版本事件。':'缺少匹配版本事件证据。'}`,status:'相关性线索，不能直接认定版本原因',next:'比较同平台相同用户类型的稳定版本，并检查升级覆盖、登录和崩溃表现。'});}
 }
 const coverage=[
  {angle:'数据完整性与真实性',status:quality.blocked?'需先修复':quality.checks.some(c=>c.status==='待补充')?'部分可核查':'已核查输入',detail:'检查日期、分层、参考 DAU、分区与生命周期人数一致性；不等于独立审计。'},
  {angle:'日 / 周 / 年同比与星期效应',status:comparisons.every(c=>c.available)?'已分析':'部分可比',detail:'使用过去四个同星期作主基线；缺少年同比时明确留空。'},
  ...DIMENSIONS.map(d=>({angle:DIMENSION_NAMES[d],status:index.available.includes(d)?'已定位':'待补充',detail:index.available.includes(d)?'维度内贡献可加总，不与其他维度重复相加。':`历史表缺少 ${d} 字段。`})),
  {angle:'新增 / 延续 / 回流与实际留存',status:evidence.some(e=>e.category==='retention'||e.category==='lifecycle')?'已有实际指标':'待补充',detail:'使用实际生命周期人数及成熟 D1/D7 批次；预测曲线不能替代实际留存。'},
  {angle:'投放规模与获客漏斗',status:evidence.some(e=>e.category==='acquisition')?'已有实际指标':'待补充',detail:'核对实际费用、曝光、点击、安装和首次激活；不使用未来计划冒充实际。'},
  {angle:'Push 触达与召回',status:evidence.some(e=>e.category==='push')?'已有实际指标':'待补充',detail:'发送、送达、打开及对应运营事件。'},
  {angle:'登录 / 崩溃 / 服务质量',status:evidence.some(e=>e.category==='stability')?'已有实际指标':'待补充',detail:'登录成功率、崩溃会话率和请求失败率。'},
  {angle:'版本 / 运营 / 埋点 / 节假日事件',status:events.length?'存在同窗事件':'待补充',detail:'仅关联分析日前七天或仍在持续的事件，时间相邻不代表因果。'},
  {angle:'行业与竞品',status:external.some(e=>e.available)?'存在可比输入':'待补充',detail:'需要来源、同范围及同窗口的外部序列；只比较各自变化率，不混加绝对规模。'}
 ];
 const direction=delta<0?'减少':delta>0?'增加':'持平',versionGroups=intersections.find(p=>p.dimensions.join(',')==='platform,app_version')?.groups||[],top=versionGroups.filter(g=>delta<0?g.delta<0:delta>0?g.delta>0:false).sort((a,b)=>Math.abs(b.delta)-Math.abs(a.delta))[0];
 const overview=quality.blocked?'数据核对未通过，先暂停业务原因判断':delta===null?'基线不足，暂不能生成完整诊断':`${date} 的 DAU 较四个同星期均值${direction}${delta===0?'':' '+Math.abs(delta).toFixed(0)+' 人'}${top?`；平台与版本交叉中，主要${direction}群体为 ${top.group}`:''}。`;
 return {date,actual,baseline,delta,change_rate:baseline>0?delta/baseline:null,referenceDates:refDates,eligible,quality,comparisons,dimensions,intersections,evidence,events,external,hypotheses,coverage,overview,config:{relative,absolute}};
}

export function diagnosticMarkdown(d,{simulated=false}={}){
 const clean=s=>String(s??'').replace(/[\r\n]+/g,' ').replace(/[<>]/g,'');const f=n=>Number.isFinite(n)?n.toFixed(2):'未提供';
 const percent=n=>Number.isFinite(n)?f(n*100)+'%':'不适用';
 const groupLine=g=>`- ${clean(g.group)}：实际 ${f(g.actual)}，基线 ${f(g.baseline)}，变化 ${f(g.delta)}（${percent(g.change_rate)}），${g.kind}。`;
 const versions=d.intersections.find(p=>p.dimensions.join(',')==='platform,app_version')?.groups||d.dimensions.find(p=>p.dimension==='app_version')?.groups||[];
 return [
  `# DAU 异动诊断 ${d.date}`,simulated?'数据来源：模拟数据，仅用于演示。':'数据来源：用户导入，结论依赖上传口径。','',clean(d.overview),
  `主基线日期：${d.referenceDates.join('、')}；筛查阈值：相对变化 ${percent(d.config.relative)} 且绝对变化 ${f(d.config.absolute)} 人。`,
  '','## 数据核对',...d.quality.checks.map(c=>`- ${c.status}：${clean(c.text)}`),
  '','## 日 / 周 / 年比较',...d.comparisons.map(c=>`- ${c.name}（${c.date}）：${c.available?'基线 '+f(c.baseline)+'，实际 '+f(c.actual)+'，变化率 '+percent(c.change_rate):clean(c.reason)}。`),
  '','## 多维变化',...d.dimensions.flatMap(p=>[`### ${DIMENSION_NAMES[p.dimension]}`,...p.groups.slice(0,5).map(groupLine)]),
  '','## 交叉群体',...d.intersections.flatMap(p=>[`### ${p.dimensions.map(k=>DIMENSION_NAMES[k]).join(' × ')}`,...p.groups.slice(0,5).map(groupLine)]),
  '','## 版本规模与活跃比例',...versions.slice(0,12).map(g=>`- ${clean(g.group)}：用户池 ${f(g.baseline_pool)} → ${f(g.current_pool)}；活跃比例 ${percent(g.baseline_rate)} → ${percent(g.current_rate)}；规模项 ${f(g.volume_effect)}，活跃比例项 ${f(g.rate_effect)}。${g.pool_known?'固定顺序算术分解，仍受人群结构影响。':'用户池未完整提供，两项不计算。'}`),
  '','## 自动排查线索',...(d.hypotheses.length?d.hypotheses.map(h=>`- ${clean(h.title)}：${clean(h.basis)} ${clean(h.status)}。依据：${h.evidence_ids.join('、')||'群体变化与用户池数据'}。下一步：${clean(h.next)}`):['- 没有足够业务证据，或数据核对未通过，未输出确定原因。']),
  '','## 支撑指标',...d.evidence.filter(e=>e.flag).map(e=>`- [${e.id}] ${clean(e.scope_name)} ${clean(e.name)}：实际 ${e.unit==='ratio'?percent(e.actual):f(e.actual)}，基线 ${e.unit==='ratio'?percent(e.baseline):f(e.baseline)}，变化 ${e.unit==='ratio'?f(e.delta*100)+' 个百分点':f(e.delta)+' '+clean(e.unit)}。${e.unit==='ratio'?'分母：实际 '+f(e.denominator)+'，基线均值 '+f(e.baseline_denominator)+'。':''}${e.source_url?'来源：'+clean(e.source_url):''}`),
  '','## 关联事件',...d.events.map(e=>`- [${e.id}] ${e.date} ${clean(e.title)}，范围 ${clean(e.scope_name)}，${e.aligned?'同范围有同向变化':'未见同范围同向变化'}；${e.source_status}。${clean(e.evidence_url)}`),
  '','## 行业与竞品',...d.external.map(e=>`- ${clean(e.entity)}：${e.available?'同窗口变化率 '+percent(e.change_rate):'数据不足'}，${clean(e.reason)}。${clean(e.source_url)}`),
  '','## 分析覆盖与待补充',...d.coverage.map(c=>`- ${clean(c.angle)}：${c.status}。${clean(c.detail)}`),
  '','## 结论边界','各维度与交叉群体存在重叠，贡献不能跨视角相加。规则命中不是显著性检验，相关性线索不是因果证明。源系统真实性、事件内容和外部来源仍需核验。报告由固定规则和计算结果自动生成。'
 ].join('\n');
}

export function anomalyDemo(){
 const d=retentionDemo(),history=[],metrics=[],events=[],anomalyDate=addDays('2026-09-01',75);
 const allocate=(n,weights)=>{const exact=weights.map(w=>w*n),out=exact.map(Math.floor),left=n-sum(out.map(value=>({value})),'value'),order=exact.map((v,i)=>({i,f:v-out[i]})).sort((a,b)=>b.f-a.f);for(let i=0;i<left;i++)out[order[i].i]++;return out;};
 for(const row of d.history){const i=(Date.parse(row.date)-Date.parse('2026-09-01'))/86400000,share=Math.min(.35,Math.max(0,(i-38)*.035));const cells=[['Meta',.35],['TikTok',.25],['自然渠道',.4]].flatMap(([channel,w])=>[['1.8.0',1-share],['2.0.0',share]].flatMap(([app_version,v])=>[['US',.65],['ID',.35]].flatMap(([country,c])=>[['new',.2],['existing',.8]].map(([user_type,t])=>({channel,app_version,country,user_type,w:w*v*c*t})))));
  const active=allocate(row.active_users,cells.map(c=>c.w)),inactive=allocate(row.segment_users-row.active_users,cells.map(c=>c.w));
  cells.forEach((c,j)=>{const shock=i>=75&&i<=77&&row.platform==='Android'&&c.app_version==='2.0.0';history.push({...row,...c,os_version:row.platform==='Android'?'Android 14':'iOS 17',active_users:shock?Math.round(active[j]*.45):active[j],segment_users:active[j]+inactive[j]});});}
 const groups=new Map();for(const r of history){const scopes=[{}, {platform:r.platform},{platform:r.platform,app_version:r.app_version}];for(const scope of scopes){const key=JSON.stringify([r.date,scopeKey(scope)]);if(!groups.has(key))groups.set(key,{date:r.date,scope,actual:0});groups.get(key).actual+=r.active_users;}}
 const put=(date,scope,metric,value)=>metrics.push({date,entity:'self',metric,value:Math.max(0,metric==='spend'?value:Math.round(value)),unit:METRICS[metric][1],scope:'',...scope,source_url:''});
 for(const {date,scope,actual} of groups.values()){
  const i=(Date.parse(date)-Date.parse('2026-09-01'))/86400000,shock=i>=75&&i<=77&&(!scope.platform||scope.platform==='Android')&&(!scope.app_version||scope.app_version==='2.0.0');
  const sessions=Math.round(actual*1.5),attempts=Math.round(actual*.8),newUsers=Math.round(actual*(shock?.13:.19)),continuing=Math.round(actual*.65),returning=actual-newUsers-continuing;
  const scale=actual/65000,cohort=Math.round(actual*.04);
  const vals={dau_reference:actual,new_active_users:newUsers,continuing_active_users:continuing,returning_active_users:returning,spend:12000*scale*(shock?.65:1),impressions:200000*scale*(shock?.65:1),clicks:5000*scale*(shock?.7:1),installs:1000*scale*(shock?.6:1),first_activations:600*scale*(shock?.5:1),push_sent:actual*(shock?.5:.8),login_attempts:attempts,login_successes:attempts*(shock?.72:.97),sessions,crash_sessions:sessions*(shock?.04:.005),requests:actual*6,request_errors:actual*6*(shock?.035:.004),d1_cohort_users:cohort,d1_retained_users:cohort*(shock?.25:.36),d7_cohort_users:cohort,d7_retained_users:cohort*(shock?.15:.22),loaded_partitions:24,expected_partitions:24};
  vals.push_delivered=vals.push_sent*(shock?.82:.96);vals.push_opened=vals.push_delivered*(shock?.06:.1);for(const [metric,value] of Object.entries(vals))put(date,scope,metric,value);
 }
 for(let i=0;i<84;i++)for(const [entity,base] of [['行业指数',100],['竞品A',90000]])metrics.push({date:addDays('2026-09-01',i),entity,metric:'dau',value:base*(1+i*.001),unit:entity==='行业指数'?'index':'users',scope:'US与ID移动端日活示例',source_url:'https://example.com/simulated-benchmark'});
 events.push({date:addDays(anomalyDate,-1),end_date:addDays(anomalyDate,2),event_type:'release',title:'模拟：Android 2.0.0 登录组件灰度调整',platform:'Android',app_version:'2.0.0',evidence_url:'https://example.com/simulated-release',notes:'模拟事件，仅用于展示时间和范围关联。'},
 {date:anomalyDate,event_type:'incident',title:'模拟：Android 登录错误与崩溃告警',platform:'Android',app_version:'2.0.0',evidence_url:'https://example.com/simulated-incident'},
 {date:anomalyDate,event_type:'push',title:'模拟：召回 Push 发送策略调整',platform:'Android',notes:'事件不能单独证明 DAU 增减由 Push 导致。'},
 {date:addDays(anomalyDate,-2),end_date:addDays(anomalyDate,2),event_type:'campaign',title:'模拟：Meta 投放预算收缩',channel:'Meta'},
 {date:addDays(anomalyDate,5),event_type:'release',title:'模拟：后续 iOS 发布，不应解释此前异动',platform:'iOS'},
 {date:addDays(anomalyDate,-15),event_type:'tracking',title:'模拟：早期埋点变更，不在当前事件窗口'});
 return {...d,history,metrics,events:events.map(e=>({...e,end_date:e.end_date||e.date})),anomalyDate};
}
